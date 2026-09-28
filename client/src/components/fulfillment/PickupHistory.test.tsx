import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { PickupHistory } from "./PickupHistory";

let root: Root;
let container: HTMLDivElement;
let detail: any;
let save: jest.Mock<(id: string, text: string) => Promise<void>>;
const reprint = jest.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  detail = {
    orderId: "order", status: "operationally_complete", remainingQuantity: 0, fulfilledQuantity: 400,
    permissions: { canEditHistoryNotes: true },
    pickupTravelers: [{ id: "traveler", pickupHandoffId: "a", createdAt: "2026-09-28T12:00:00Z", lines: [{ quantity: 250, description: "Signs" }] }],
    pickupHandoffs: ["a", "b"].map((id, i) => ({ id, status: i ? "REVERSED" : "COMPLETED", handedOffAt: "2026-09-28T12:00:00Z", notes: "Original pickup note", items: [{ orderLineItemId: id, quantity: i ? 150 : 250, productName: "Signs" }], reversals: i ? [{ id: "r", reason: "Quantity entered incorrectly" }] : [] })),
  };
  save = jest.fn(async (id: string, text: string) => {
    detail = { ...detail, pickupHandoffs: detail.pickupHandoffs.map((h: any) => h.id === id ? { ...h, historyNote: text ? { text, updatedAt: "2026-09-28T13:00:00Z", actorName: "Dale", actorUserId: "staff" } : null } : h) };
    render();
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
function render() { root.render(<PickupHistory detail={detail} selectedTravelerIds={[]} onToggle={() => {}} onReverse={() => {}} onReprint={reprint} onSaveHistoryNote={save} />); }
function noteRow(id: string) { return container.querySelector(`[data-testid="pickup-note-${id}"]`)!; }
async function click(id: string, text: string) { const button = Array.from(noteRow(id).querySelectorAll("button")).find(b => b.textContent === text)!; await act(async () => { Simulate.click(button); }); }
function fill(id: string, value: string) { act(() => { Simulate.change(noteRow(id).querySelector("textarea")!, { target: { value } } as any); }); }

test("completed/reversed pickups support isolated add, edit, and clear without altering workflow or Traveler", async () => {
  act(render);
  const before = JSON.stringify(detail);
  expect(container.textContent).toContain("Completed");
  expect(container.textContent).toContain("Reversed");
  expect(noteRow("a").textContent).toBe("Add note");
  await click("a", "Add note"); fill("a", "  3 boxes  "); await click("a", "Save note");
  expect(save).toHaveBeenLastCalledWith("a", "3 boxes");
  expect(noteRow("a").textContent).toContain("3 boxes");
  expect(noteRow("a").textContent).toContain("Dale");
  expect(noteRow("b").textContent).not.toContain("3 boxes");
  await click("a", "Edit note"); fill("a", "2 pallets\nJohn picked up"); await click("a", "Save note");
  expect(noteRow("a").textContent).toContain("2 pallets\nJohn picked up");
  await click("b", "Add note"); fill("b", "Customer returned before leaving"); await click("b", "Save note");
  expect(container.textContent).toContain("Quantity entered incorrectly");
  expect(container.textContent).toContain("Reversed");
  await click("a", "Edit note"); fill("a", "  "); await click("a", "Save note");
  expect(noteRow("a").textContent).toBe("Add note");
  expect(noteRow("b").textContent).toContain("Customer returned before leaving");
  const withoutNotes = { ...detail, pickupHandoffs: detail.pickupHandoffs.map(({ historyNote, ...rest }: any) => rest) };
  expect(JSON.stringify(withoutNotes)).toBe(before);
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Reprint Traveler")!;
  act(() => Simulate.click(button));
  expect(reprint).toHaveBeenCalledWith(detail.pickupTravelers[0]);
});
test("plain text escapes HTML and wraps long content; viewers cannot edit", () => {
  const text = '<script>alert("x")</script><img src=x onerror=alert(1)>' + "x".repeat(1000);
  detail.pickupHandoffs[0].historyNote = { text, updatedAt: "2026-09-28T13:00:00Z", actorName: null, actorUserId: null };
  detail.permissions.canEditHistoryNotes = false;
  act(render);
  expect(noteRow("a").textContent).toContain(text);
  expect(noteRow("a").querySelector("script,img")).toBeNull();
  expect(noteRow("a").querySelector(".whitespace-pre-wrap")).not.toBeNull();
  expect(container.textContent).not.toContain("Add note");
  expect(container.textContent).not.toContain("Edit note");
});
test("failed save retains the draft for retry; Cancel makes no mutation; length is bounded", async () => {
  save.mockRejectedValueOnce(new Error("Save failed"));
  act(render);
  await click("a", "Add note"); fill("a", "3 boxes");
  expect(noteRow("a").querySelector("textarea")!.maxLength).toBe(2000);
  await click("a", "Save note");
  expect(noteRow("a").querySelector('[role="alert"]')!.textContent).toBe("Save failed");
  expect(noteRow("a").querySelector("textarea")!.value).toBe("3 boxes");
  await click("a", "Save note");
  expect(noteRow("a").textContent).toContain("3 boxes");
  await click("a", "Edit note"); fill("a", "discard"); await click("a", "Cancel");
  expect(save).toHaveBeenCalledTimes(2);
  expect(noteRow("a").textContent).not.toContain("discard");
});
