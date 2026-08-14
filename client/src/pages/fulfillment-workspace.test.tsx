import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "pickup-request-1" } });

let detail: any;
const adjustReady = jest.fn(async ({ items }: any) => {
  for (const item of items) detail = {
    ...detail,
    readyWaitingQuantity: detail.readyWaitingQuantity + item.quantityDelta,
    notReadyQuantity: detail.notReadyQuantity - item.quantityDelta,
    lineItems: detail.lineItems.map((line: any) => line.id === item.orderLineItemId ? {
      ...line,
      production: { ...line.production, readyWaitingQuantity: line.production.readyWaitingQuantity + item.quantityDelta, notReadyQuantity: line.production.notReadyQuantity - item.quantityDelta },
    } : line),
  };
});
const recordHandoff = jest.fn(async ({ items }: any) => {
  const quantity = items[0].quantity;
  detail = {
    ...detail,
    readyWaitingQuantity: detail.readyWaitingQuantity - quantity,
    pickedUpQuantity: detail.pickedUpQuantity + quantity,
    fulfilledQuantity: detail.fulfilledQuantity + quantity,
    remainingQuantity: detail.remainingQuantity - quantity,
    lineItems: detail.lineItems.map((line: any) => ({ ...line, production: { ...line.production, readyWaitingQuantity: line.production.readyWaitingQuantity - quantity, pickedUpQuantity: line.production.pickedUpQuantity + quantity, fulfilledQuantity: line.production.fulfilledQuantity + quantity, remainingQuantity: line.production.remainingQuantity - quantity } })),
    pickupHandoffs: [...detail.pickupHandoffs, { id: `handoff-${detail.pickupHandoffs.length + 1}`, handedOffAt: "2026-08-14T12:00:00Z", handedOffByUserId: "user-1", handedOffByName: "Dale", notes: null, items: [{ orderLineItemId: "line-1", quantity, productName: "PVC 3mm", description: null }] }],
  };
  return { terminal: detail.remainingQuantity === 0 };
});
const addNote = jest.fn(async (note: string) => {
  detail = { ...detail, events: [{ id: `note-${detail.events.length + 1}`, eventType: "FULFILLMENT_NOTE", entityType: "ORDER", entityId: "order-1", actorUserId: "user-1", actorName: "Dale", payloadJson: { note }, createdAt: "2026-08-14T12:00:00Z" }, ...detail.events] };
});

jest.mock("@/hooks/useFulfillment", () => ({
  toFulfillmentError: (error: any) => ({ message: error?.message || "Unexpected error" }),
  useFulfillmentOrderDetailQuery: () => ({ data: detail, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useCreateShipmentMutation: () => ({ mutateAsync: jest.fn(async () => ({ shipmentId: "shipment-1" })), isPending: false }),
  useCreatePickupTicketMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPickupReadyMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAdjustFulfillmentReadyQuantitiesMutation: () => ({ mutateAsync: adjustReady, isPending: false }),
  useAddFulfillmentNoteMutation: () => ({ mutateAsync: addNote, isPending: false }),
  useRecordPickupHandoffMutation: () => ({ mutateAsync: recordHandoff, isPending: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/pages/fulfillment-shipment-detail", () => ({ FulfillmentShipmentEditor: () => <div /> }));

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const Page = require("./fulfillment-workspace").default;

function makeDetail({ ready = 0, fulfillmentType = "PICKUP" }: { ready?: number; fulfillmentType?: "PICKUP" | "SHIP" } = {}) {
  const production = { jobId: null, stationKey: null, stationLabel: null, status: ready ? "ready" : "not_ready", completedAt: null, eligible: ready > 0, label: ready ? "Ready for fulfillment" : "Not yet marked ready", productionRequired: true, orderedQuantity: 1000, productionCompleteQuantity: 0, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: 1000 - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: 1000 - ready, remainingQuantity: 1000 };
  return { orderId: "order-1", orderNumber: "1129", customerName: "Titan Graphics", fulfillmentType, status: ready ? "READY" : "NOT_READY", itemsRemaining: "1000 item(s)", physicalLineCount: 1, orderedQuantity: 1000, productionCompleteQuantity: 0, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: 1000 - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: 1000 - ready, remainingQuantity: 1000, readySince: null, shipTo: fulfillmentType === "PICKUP" ? "In-Store" : "123 Main Street", overdue: false, isArchived: false, productionJobs: [], customer: { name: "Titan Graphics", email: null, phone: null }, lineItems: [{ id: "line-1", productName: "PVC 3mm", description: null, productType: null, quantity: 1000, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null }, production, artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } }], checklistComplete: false, checklistSummary: { total: 0, checked: 0, unchecked: 0 }, productionSummary: [], pickupTicket: fulfillmentType === "PICKUP" ? { id: "ticket-1", status: "READY_FOR_PICKUP", readyAt: null, pickedUpAt: null, stagingLocation: null, pickupNotes: null, contactName: null, contactEmail: null, contactPhone: null } : null, pickupHandoffs: [], shipments: [], events: [] };
}

function render() { const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); const rerender = () => root.render(<MemoryRouter initialEntries={["/fulfillment/orders/order-1"]}><Routes><Route path="/fulfillment/orders/:orderId" element={<Page />} /></Routes></MemoryRouter>); act(rerender); return { container, root, rerender }; }
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter?.call(input, value); Simulate.change(input, { target: { value } }); }
function button(container: HTMLElement, label: string) { return Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label) as HTMLButtonElement; }

afterEach(() => { document.body.innerHTML = ""; jest.clearAllMocks(); });

describe("FulfillmentWorkspacePage active routed workflow", () => {
  test("shows only readiness controls when nothing is ready and production is zero", () => {
    detail = makeDetail(); const { container, root } = render();
    expect(container.textContent).toContain("Fulfillment line items");
    expect(container.textContent).toContain("Production reports: 0");
    expect(container.querySelector('input[aria-label="Ready quantity: PVC 3mm"]')).not.toBeNull();
    expect(button(container, "All Remaining")).toBeTruthy();
    expect(button(container, "Mark Selected Ready for Pickup")).toBeTruthy();
    expect(container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Adjust ready quantity: PVC 3mm"]')).toBeNull();
    const readyInput = container.querySelector('input[aria-label="Ready quantity: PVC 3mm"]') as HTMLInputElement;
    const noteInput = container.querySelector('textarea[aria-label="Order note"]') as HTMLTextAreaElement;
    for (const control of [readyInput, noteInput]) {
      expect(control.className).toContain("bg-background");
      expect(control.className).toContain("border-input");
      expect(control.className).toContain("placeholder:text-muted-foreground");
      expect(control.className).toContain("focus-visible:ring-ring");
    }
    expect(container.textContent).toContain("Order Notes");
    act(() => root.unmount());
  });

  test("allows production-zero readiness then two immutable partial pickup handoffs", async () => {
    detail = makeDetail(); const { container, root, rerender } = render();
    const ready = container.querySelector('input[aria-label="Ready quantity: PVC 3mm"]') as HTMLInputElement;
    await act(async () => { change(ready, "1000"); });
    await act(async () => { Simulate.click(button(container, "Mark Selected Ready for Pickup")); });
    act(rerender);
    expect(adjustReady).toHaveBeenCalledWith({ items: [{ orderLineItemId: "line-1", quantityDelta: 1000 }] });
    expect(detail.lineItems[0].production.productionCompleteQuantity).toBe(0);
    const pickupInput = container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]') as HTMLInputElement;
    expect(pickupInput).not.toBeNull();
    expect(pickupInput.className).toContain("bg-background");
    expect(pickupInput.className).toContain("focus-visible:ring-ring");
    expect(button(container, "All Ready")).toBeTruthy();
    expect(button(container, "Complete Pickup")).toBeTruthy();
    expect(button(container, "Adjust ready qty")).toBeTruthy();
    expect(container.querySelector('input[aria-label="Un-ready quantity: PVC 3mm"]')).toBeNull();
    const pickup = container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]') as HTMLInputElement;
    await act(async () => { change(pickup, "600"); });
    await act(async () => { Simulate.click(button(container, "Complete Pickup")); await Promise.resolve(); });
    act(rerender);
    expect(recordHandoff).toHaveBeenCalledWith(expect.objectContaining({ items: [{ orderLineItemId: "line-1", quantity: 600 }] }));
    const remaining = container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]') as HTMLInputElement;
    await act(async () => { change(remaining, "400"); });
    await act(async () => { Simulate.click(button(container, "Complete Pickup")); await Promise.resolve(); });
    act(rerender);
    expect(recordHandoff).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("600 PVC 3mm");
    expect(container.textContent).toContain("400 PVC 3mm");
    act(() => root.unmount());
  });

  test("uses the canonical fulfillment note mutation and shows the newest note", async () => {
    detail = makeDetail(); const { container, root, rerender } = render();
    const note = container.querySelector('textarea[aria-label="Order note"]') as HTMLTextAreaElement;
    await act(async () => { change(note, "Customer will arrive after 4 PM"); });
    await act(async () => { Simulate.click(button(container, "Add note")); await Promise.resolve(); });
    act(rerender);
    expect(addNote).toHaveBeenCalledWith("Customer will arrive after 4 PM");
    expect(container.textContent).toContain("Customer will arrive after 4 PM");
    expect(container.textContent).toContain("Dale");
    act(() => root.unmount());
  });

  test("keeps shipping readiness independent from production reports", () => {
    detail = makeDetail({ fulfillmentType: "SHIP" }); const { container, root } = render();
    expect(container.querySelector('input[aria-label="Ready quantity: PVC 3mm"]')).not.toBeNull();
    expect(button(container, "Mark Selected Ready for Shipping")).toBeTruthy();
    expect(container.textContent).not.toContain("produced-quantity cap");
    act(() => root.unmount());
  });
});
