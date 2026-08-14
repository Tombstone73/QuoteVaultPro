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

jest.mock("@/hooks/useFulfillment", () => ({
  toFulfillmentError: (error: any) => ({ message: error?.message || "Unexpected error" }),
  useFulfillmentOrderDetailQuery: () => ({ data: detail, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useCreateShipmentMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCreatePickupTicketMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPickupReadyMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAdjustFulfillmentReadyQuantitiesMutation: () => ({ mutateAsync: adjustReady, isPending: false }),
  useRecordPickupHandoffMutation: () => ({ mutateAsync: recordHandoff, isPending: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/lib/artworkAccess", () => ({ openArtworkPreview: jest.fn() }));
jest.mock("@/components/artwork/AuthenticatedArtworkThumbnail", () => ({ AuthenticatedArtworkThumbnail: () => <span /> }));
jest.mock("@/pages/fulfillment-shipment-detail", () => ({ FulfillmentShipmentEditor: () => <div /> }));

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const Page = require("./fulfillment-workspace").default;

function makeDetail() {
  const production = { jobId: null, stationKey: null, stationLabel: null, status: "not_ready", completedAt: null, eligible: false, label: "Not yet marked ready", productionRequired: true, orderedQuantity: 1000, productionCompleteQuantity: 0, fulfilledQuantity: 0, eligibleQuantity: 0, blockedQuantity: 1000, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: 0, notReadyQuantity: 1000, remainingQuantity: 1000 };
  return { orderId: "order-1", orderNumber: "1129", customerName: "Titan Graphics", fulfillmentType: "PICKUP", status: "NOT_READY", itemsRemaining: "1000 item(s)", physicalLineCount: 1, orderedQuantity: 1000, productionCompleteQuantity: 0, fulfilledQuantity: 0, eligibleQuantity: 0, blockedQuantity: 1000, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: 0, notReadyQuantity: 1000, remainingQuantity: 1000, readySince: null, shipTo: "In-Store", overdue: false, isArchived: false, productionJobs: [], customer: { name: "Titan Graphics", email: null, phone: null }, lineItems: [{ id: "line-1", productName: "PVC 3mm", description: null, productType: null, quantity: 1000, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null }, production, artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } }], checklistComplete: false, checklistSummary: { total: 0, checked: 0, unchecked: 0 }, productionSummary: [], pickupTicket: { id: "ticket-1", status: "READY_FOR_PICKUP", readyAt: null, pickedUpAt: null, stagingLocation: null, pickupNotes: null, contactName: null, contactEmail: null, contactPhone: null }, pickupHandoffs: [], shipments: [], events: [] };
}

function render() { const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); const rerender = () => root.render(<MemoryRouter initialEntries={["/fulfillment/orders/order-1"]}><Routes><Route path="/fulfillment/orders/:orderId" element={<Page />} /></Routes></MemoryRouter>); act(rerender); return { container, root, rerender }; }
function change(input: HTMLInputElement, value: string) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); Simulate.change(input, { target: { value } }); }

afterEach(() => { document.body.innerHTML = ""; jest.clearAllMocks(); });

describe("FulfillmentWorkspacePage active pickup route", () => {
  test("allows ready then two immutable pickups while production remains zero", async () => {
    detail = makeDetail(); const { container, root, rerender } = render();
    expect(container.textContent).toContain("Ready for Pickup");
    expect(container.textContent).toContain("Production is informational only");
    const ready = container.querySelector('input[aria-label="Ready quantity: PVC 3mm"]') as HTMLInputElement;
    expect(ready.max).toBe("1000");
    await act(async () => { change(ready, "1000"); });
    await act(async () => { Simulate.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Mark Ready for Pickup")!); });
    act(rerender);
    expect(adjustReady).toHaveBeenCalledWith({ items: [{ orderLineItemId: "line-1", quantityDelta: 1000 }] });
    expect(detail.lineItems[0].production.productionCompleteQuantity).toBe(0);
    expect(container.querySelector('[data-testid="ready-waiting-line-1"]')?.textContent).toBe("1000");
    const pickup = container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]') as HTMLInputElement;
    await act(async () => { change(pickup, "600"); });
    await act(async () => { Simulate.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Complete Pickup")!); await Promise.resolve(); await Promise.resolve(); });
    expect(recordHandoff).toHaveBeenCalledWith(expect.objectContaining({ items: [{ orderLineItemId: "line-1", quantity: 600 }] }));
    act(rerender);
    expect(container.querySelector('[data-testid="pickup-ready-line-1"]')?.textContent).toBe("400");
    expect(container.textContent).toContain("600 PVC 3mm");
    const remaining = container.querySelector('input[aria-label="Pickup quantity: PVC 3mm"]') as HTMLInputElement;
    await act(async () => { change(remaining, "400"); });
    await act(async () => { Simulate.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Complete Pickup")!); await Promise.resolve(); await Promise.resolve(); });
    act(rerender);
    expect(recordHandoff).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("400 PVC 3mm");
    act(() => root.unmount());
  });
});
