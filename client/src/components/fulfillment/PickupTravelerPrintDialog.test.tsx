import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

const mockToast = jest.fn();
const mockApi = jest.fn(async (..._args: unknown[]) => ({ ok: true, json: async () => ({ data: { id: "prepared-job" } }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: mockApi }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [{ id: "printer", displayName: "Thermal", available: true, isDefault: true }], isLoading: false }) }));
import { PickupTravelerPrintDialog } from "./PickupTravelerPrintDialog";
import { PickupHistory } from "./PickupHistory";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "print-key" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
function change(id: string, value: string) { const input = document.getElementById(id) as HTMLInputElement; Simulate.change(input, { target: { value } } as any); }
async function print(label: string) { const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent === label)!; await act(async () => { Simulate.click(button); }); }
const lines = [{ orderLineItemId: "signs", description: "Coroplast", quantity: 150 }];
const saved = { id: "prepared-job", createdAt: "2026-09-25T12:00:00Z", pickupHandoffId: "handoff", box: { current: 2, total: 3 }, lines };

test.each([["", ""], ["1", "1"], ["2", "3"]])("queues manual package pair %s / %s without recording pickup", async (currentBox, totalBoxes) => {
  const queued = jest.fn();
  await act(async () => root.render(<PickupTravelerPrintDialog orderId="order" lines={lines} open onOpenChange={() => {}} onQueued={queued} />));
  act(() => { change("pickup-current-box", currentBox); change("pickup-total-boxes", totalBoxes); });
  await print("Print Traveler");
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockApi.mock.calls[0][0]).toBe("/api/orders/order/direct-print/pickup-travelers");
  expect(JSON.parse((mockApi.mock.calls[0][1] as any).body)).toMatchObject({ currentBox, totalBoxes, lineQuantities: [{ orderLineItemId: "signs", quantity: 150 }] });
  expect(queued).toHaveBeenCalledWith("prepared-job");
});
test.each([["1", ""], ["", "3"], ["4", "3"], ["abc", "3"]])("rejects invalid manual pair %s / %s before queueing", async (currentBox, totalBoxes) => {
  await act(async () => root.render(<PickupTravelerPrintDialog orderId="order" lines={lines} open onOpenChange={() => {}} />));
  act(() => { change("pickup-current-box", currentBox); change("pickup-total-boxes", totalBoxes); });
  await print("Print Traveler");
  expect(mockApi).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid box numbers" }));
});
test("completed/reversed reprint submits only the saved reference, never changed line quantities or box fields", async () => {
  const queued = jest.fn();
  await act(async () => root.render(<PickupTravelerPrintDialog orderId="order" lines={[]} open reprint={saved} onOpenChange={() => {}} onQueued={queued} />));
  expect(document.getElementById("pickup-current-box")).toBeNull();
  expect(document.body.textContent).toContain("Box 2 of 3");
  await print("Reprint Traveler");
  expect(JSON.parse((mockApi.mock.calls[0][1] as any).body)).toEqual({ destinationId: "printer", reprintJobId: "prepared-job", requestKey: "print-key" });
  expect(queued).not.toHaveBeenCalled();
});
test.each(["COMPLETED", "REVERSED", "PARTIALLY_REVERSED"])("history retains %s event and reprint access with zero remaining order quantity", async status => {
  const reprint = jest.fn(), reverse = jest.fn();
  const detail: any = { fulfillmentType: "PICKUP", remainingQuantity: 0, permissions: { canReverseTerminalFulfillment: true }, pickupTravelers: [saved],
    pickupHandoffs: [{ id: "handoff", status, handedOffAt: saved.createdAt, items: lines, reversals: status === "COMPLETED" ? [] : [{ id: "r", createdAt: saved.createdAt, actorName: "Dale", reason: "Entered in error" }] }] };
  await act(async () => root.render(<PickupHistory detail={detail} selectedTravelerIds={[]} onToggle={() => {}} onReprint={reprint} onReverse={reverse} />));
  expect(container.textContent).toContain(status === "REVERSED" ? "Reversed" : status === "PARTIALLY_REVERSED" ? "Partially reversed" : "Completed");
  await print("Reprint Traveler · Box 2 of 3");
  expect(reprint).toHaveBeenCalledWith(saved);
  expect(reverse).not.toHaveBeenCalled();
  if (status !== "COMPLETED") expect(container.textContent).toContain("Dale — Entered in error");
  if (status === "REVERSED") expect(container.textContent).not.toContain("Reverse Pickup");
});
