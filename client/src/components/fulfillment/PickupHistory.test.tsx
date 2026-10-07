import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { PickupHistory } from "./PickupHistory";

let root: Root;
let container: HTMLDivElement;
let detail: any;
const save = jest.fn<(id: string, changes: { effectivePickupDate?: string; note?: string }) => Promise<void>>(async () => {});
const reprint = jest.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  detail = {
    orderId: "order", fulfillmentType: "PICKUP", remainingQuantity: 0,
    permissions: { canEditHistoryNotes: true, canEditPickupDate: true },
    pickupTravelers: [{ id: "traveler", pickupHandoffId: "a", createdAt: "2026-10-07T12:00:00Z", lines: [{ quantity: 250, description: "Signs" }] }],
    pickupHandoffs: [
      { id: "a", status: "COMPLETED", handedOffAt: "2026-10-07T12:00:00Z", recordedAt: "2026-10-07T12:00:00Z", effectivePickupDate: "2026-10-02", handedOffByName: "Dale", notes: "Confirmed by email", items: [{ orderLineItemId: "line-a", quantity: 250, productName: "Signs" }], dateAdjustments: [{ previousEffectiveDate: "2026-10-07", newEffectiveDate: "2026-10-02", editedAt: "2026-10-07T13:00:00Z", actorName: "Dale" }], reversals: [] },
      { id: "b", status: "REVERSED", handedOffAt: "2026-10-07T14:00:00Z", recordedAt: "2026-10-07T14:00:00Z", effectivePickupDate: "2026-10-07", notes: null, items: [{ orderLineItemId: "line-b", quantity: 150, productName: "Signs" }], reversals: [{ id: "r", reason: "Wrong quantity" }] },
    ],
  };
  save.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
function render() { root.render(<PickupHistory detail={detail} selectedTravelerIds={[]} onToggle={() => {}} onReverse={() => {}} onReprint={reprint} onSaveDetails={save} />); }
function row(id: string) { return container.querySelector(`[data-testid="pickup-${id}"]`)!; }
async function click(id: string, label: string) {
  const button = Array.from(row(id).querySelectorAll("button")).find(button => button.textContent === label)!;
  await act(async () => { Simulate.click(button); });
}

test("shows effective and recorded dates, adjustment attribution, quantity and note without altering traveler", async () => {
  act(render);
  expect(row("a").textContent).toContain("250 Signs picked up");
  expect(row("a").textContent).toContain("Oct 2, 2026");
  expect(row("a").textContent).toContain("Recorded");
  expect(row("a").textContent).toContain("Pickup date adjusted from Oct 7, 2026 to Oct 2, 2026");
  expect(row("a").textContent).toContain("Confirmed by email");
  expect(row("b").textContent).toContain("Reversed");
  await click("a", "Edit details");
  expect(row("a").querySelector('input[type="number"]')).toBeNull();
  act(() => {
    Simulate.change(row("a").querySelector('input[type="date"]')!, { target: { value: "2026-10-03" } } as any);
    Simulate.change(row("a").querySelector("textarea")!, { target: { value: "Updated note" } } as any);
  });
  await click("a", "Save details");
  expect(save).toHaveBeenCalledWith("a", { effectivePickupDate: "2026-10-03", note: "Updated note" });
  const traveler = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Reprint Traveler")!;
  act(() => Simulate.click(traveler));
  expect(reprint).toHaveBeenCalledWith(detail.pickupTravelers[0]);
});

test("ordinary fulfillment staff can edit notes but not historical dates; viewers cannot edit", async () => {
  detail.permissions.canEditPickupDate = false;
  act(render);
  await click("a", "Edit details");
  expect(row("a").querySelector('input[type="date"]')).toBeNull();
  act(() => Simulate.change(row("a").querySelector("textarea")!, { target: { value: "Staff note" } } as any));
  await click("a", "Save details");
  expect(save).toHaveBeenCalledWith("a", { note: "Staff note" });
  detail.permissions.canEditHistoryNotes = false;
  act(render);
  expect(row("a").textContent).not.toContain("Edit details");
});
