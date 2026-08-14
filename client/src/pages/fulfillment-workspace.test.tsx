import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "pickup-request-1" } });

let detail: any;
const createTicket = jest.fn(async () => ({ id: "ticket-1", status: "DRAFT" }));
const markOrderReady = jest.fn(async () => {
  detail = { ...detail, pickupTicket: { ...detail.pickupTicket, id: "ticket-1", status: "READY_FOR_PICKUP" } };
});
const recordHandoff = jest.fn(async ({ items }: any) => {
  const byLine = new Map(items.map((item: any) => [item.orderLineItemId, item.quantity]));
  const handoffItems = detail.lineItems.flatMap((line: any) => {
    const quantity = byLine.get(line.id);
    return quantity ? [{ orderLineItemId: line.id, quantity, productName: line.productName, description: line.description }] : [];
  });
  const total = handoffItems.reduce((sum: number, item: any) => sum + item.quantity, 0);
  detail = {
    ...detail,
    pickedUpQuantity: detail.pickedUpQuantity + total,
    fulfilledQuantity: detail.fulfilledQuantity + total,
    remainingQuantity: detail.remainingQuantity - total,
    lineItems: detail.lineItems.map((line: any) => {
      const quantity = byLine.get(line.id) || 0;
      return { ...line, production: { ...line.production, pickedUpQuantity: line.production.pickedUpQuantity + quantity, fulfilledQuantity: line.production.fulfilledQuantity + quantity, remainingQuantity: line.production.remainingQuantity - quantity } };
    }),
    pickupHandoffs: [...detail.pickupHandoffs, { id: `handoff-${detail.pickupHandoffs.length + 1}`, handedOffAt: "2026-08-14T12:00:00Z", handedOffByUserId: "user-1", handedOffByName: "Dale", notes: null, items: handoffItems }],
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
  useCreatePickupTicketMutation: () => ({ mutateAsync: createTicket, isPending: false }),
  useMarkOrderReadyForPickupMutation: () => ({ mutateAsync: markOrderReady, isPending: false }),
  useAddFulfillmentNoteMutation: () => ({ mutateAsync: addNote, isPending: false }),
  useRecordPickupHandoffMutation: () => ({ mutateAsync: recordHandoff, isPending: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/pages/fulfillment-shipment-detail", () => ({ FulfillmentShipmentEditor: () => <div /> }));

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const Page = require("./fulfillment-workspace").default;

function makeDetail({ fulfillmentType = "PICKUP", production = 0, ready = 0 }: { fulfillmentType?: "PICKUP" | "SHIP"; production?: number; ready?: number } = {}) {
  const line = (id: string, name: string, quantity: number) => ({ id, productName: name, description: null, productType: null, quantity, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null }, production: { jobId: null, stationKey: null, stationLabel: null, status: "not_ready", completedAt: null, eligible: ready > 0, label: "Not yet marked ready", productionRequired: true, orderedQuantity: quantity, productionCompleteQuantity: production, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: quantity - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: quantity - ready, remainingQuantity: quantity }, artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } });
  const lineItems = [line("line-1", "Economy Yard Sign Stakes", 1000)];
  return { orderId: "order-1", orderNumber: "1129", customerName: "Titan Graphics", fulfillmentType, status: "NOT_READY", itemsRemaining: "1000 item(s)", physicalLineCount: 1, orderedQuantity: 1000, productionCompleteQuantity: production, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: 1000 - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: 1000 - ready, remainingQuantity: 1000, readySince: null, shipTo: fulfillmentType === "PICKUP" ? "In-Store" : "123 Main Street", overdue: false, isArchived: false, productionJobs: [], customer: { name: "Titan Graphics", email: null, phone: null }, lineItems, checklistComplete: false, checklistSummary: { total: 0, checked: 0, unchecked: 0 }, productionSummary: [], pickupTicket: fulfillmentType === "PICKUP" ? { id: "ticket-1", status: "DRAFT", readyAt: null, pickedUpAt: null, stagingLocation: null, pickupNotes: null, contactName: null, contactEmail: null, contactPhone: null } : null, pickupHandoffs: [], shipments: [], events: [] };
}

function render() { const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); const rerender = () => root.render(<MemoryRouter initialEntries={["/fulfillment/orders/order-1"]}><Routes><Route path="/fulfillment/orders/:orderId" element={<Page />} /></Routes></MemoryRouter>); act(rerender); return { container, root, rerender }; }
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter?.call(input, value); Simulate.change(input, { target: { value } }); }
function button(container: HTMLElement, label: string) { return Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label) as HTMLButtonElement; }

afterEach(() => { document.body.innerHTML = ""; jest.clearAllMocks(); });

describe("FulfillmentWorkspacePage direct fulfillment route", () => {
  test("allows pickup without ready status or production quantity", async () => {
    detail = makeDetail({ production: 0, ready: 0 }); const { container, root, rerender } = render();
    const pickup = container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement;
    expect(pickup.disabled).toBe(false);
    expect(pickup.max).toBe("1000");
    expect(button(container, "All Remaining")).toBeTruthy();
    expect(button(container, "Complete Pickup")).toBeTruthy();
    expect(container.textContent).toContain("Production reports: 0");
    expect(container.textContent).not.toContain("Mark ready now");
    await act(async () => { change(pickup, "100"); });
    await act(async () => { Simulate.click(button(container, "Complete Pickup")); await Promise.resolve(); });
    act(rerender);
    expect(recordHandoff).toHaveBeenCalledWith(expect.objectContaining({ items: [{ orderLineItemId: "line-1", quantity: 100 }] }));
    expect(detail.lineItems[0].production.pickedUpQuantity).toBe(100);
    expect(detail.lineItems[0].production.remainingQuantity).toBe(900);
    expect(detail.lineItems[0].production.productionCompleteQuantity).toBe(0);
    expect(container.textContent).toContain("100 Economy Yard Sign Stakes");
    act(() => root.unmount());
  });

  test("allows pickup above production reports and keeps immutable visits", async () => {
    detail = makeDetail({ production: 50, ready: 0 }); const { container, root, rerender } = render();
    for (const quantity of [100, 300, 600]) {
      const pickup = container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement;
      await act(async () => { change(pickup, String(quantity)); });
      await act(async () => { Simulate.click(button(container, "Complete Pickup")); await Promise.resolve(); });
      act(rerender);
    }
    expect(recordHandoff).toHaveBeenCalledTimes(3);
    expect(detail.lineItems[0].production.productionCompleteQuantity).toBe(50);
    expect(detail.lineItems[0].production.pickedUpQuantity).toBe(1000);
    expect(detail.lineItems[0].production.remainingQuantity).toBe(0);
    expect(detail.pickupHandoffs).toHaveLength(3);
    expect(container.textContent).toContain("Completed");
    expect(container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]')).toBeNull();
    act(() => root.unmount());
  });

  test("records multiple line quantities in one immutable pickup handoff", async () => {
    detail = makeDetail({ production: 0, ready: 0 });
    const second = JSON.parse(JSON.stringify(detail.lineItems[0]));
    second.id = "line-2"; second.productName = "Coroplast"; second.quantity = 250;
    second.production.orderedQuantity = 250; second.production.remainingQuantity = 250; second.production.notReadyQuantity = 250;
    detail = { ...detail, lineItems: [...detail.lineItems, second], orderedQuantity: 1250, remainingQuantity: 1250 };
    const { container, root } = render();
    await act(async () => { change(container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement, "100"); });
    await act(async () => { change(container.querySelector('input[aria-label="Pickup quantity: Coroplast"]') as HTMLInputElement, "75"); });
    await act(async () => { Simulate.click(button(container, "Complete Pickup")); await Promise.resolve(); });
    expect(recordHandoff).toHaveBeenCalledWith(expect.objectContaining({ items: [
      { orderLineItemId: "line-1", quantity: 100 },
      { orderLineItemId: "line-2", quantity: 75 },
    ] }));
    expect(detail.pickupHandoffs).toHaveLength(1);
    expect(detail.pickupHandoffs[0].items).toHaveLength(2);
    act(() => root.unmount());
  });

  test("marks the order ready separately without modifying pickup quantities", async () => {
    detail = makeDetail({ ready: 0 }); const { container, root, rerender } = render();
    await act(async () => { Simulate.click(button(container, "Mark Order Ready for Pickup")); await Promise.resolve(); });
    act(rerender);
    expect(markOrderReady).toHaveBeenCalledWith({});
    expect(detail.lineItems[0].production.pickedUpQuantity).toBe(0);
    expect(detail.pickupHandoffs).toHaveLength(0);
    expect(container.textContent).toContain("Ready for Pickup");
    expect(container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]')).not.toBeNull();
    act(() => root.unmount());
  });

  test("keeps notes themed and available", async () => {
    detail = makeDetail(); const { container, root, rerender } = render();
    const note = container.querySelector('textarea[aria-label="Order note"]') as HTMLTextAreaElement;
    expect(note.className).toContain("bg-background");
    expect(note.className).toContain("focus-visible:ring-ring");
    await act(async () => { change(note, "Customer will arrive after 4 PM"); });
    await act(async () => { Simulate.click(button(container, "Add note")); await Promise.resolve(); });
    act(rerender);
    expect(addNote).toHaveBeenCalledWith("Customer will arrive after 4 PM");
    expect(container.textContent).toContain("Customer will arrive after 4 PM");
    act(() => root.unmount());
  });

  test("starts shipping with remaining quantity even when production and legacy ready are zero", () => {
    detail = makeDetail({ fulfillmentType: "SHIP", production: 0, ready: 0 }); const { container, root } = render();
    expect(button(container, "Start shipment").disabled).toBe(false);
    expect(container.textContent).not.toContain("marked ready before shipping");
    act(() => root.unmount());
  });
});
