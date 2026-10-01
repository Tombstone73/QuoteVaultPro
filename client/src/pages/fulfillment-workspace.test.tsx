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
const guardedNavigate = jest.fn();
const createShipment = jest.fn(async () => {
  const shipmentId = `shipment-${detail.shipments.length + 1}`;
  detail = { ...detail, shipments: [...detail.shipments, { id: shipmentId, shipmentReference: shipmentId, status: 'DRAFT', scope: 'SINGLE_ORDER', orderCount: 1 }] };
  return { shipmentId };
});
const reopenAdministrative = jest.fn(async (_input: any) => ({ orderId: 'order-1' }));
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
      const quantity = Number(byLine.get(line.id) || 0);
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
  useReopenAdministrativeFulfillmentMutation: () => ({ mutateAsync: reopenAdministrative, isPending: false }),
  toFulfillmentError: (error: any) => ({ message: error?.message || "Unexpected error" }),
  useFulfillmentOrderDetailQuery: () => ({ data: detail, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useCreateShipmentMutation: () => ({ mutateAsync: createShipment, isPending: false }),
  useCreatePickupTicketMutation: () => ({ mutateAsync: createTicket, isPending: false }),
  useMarkOrderReadyForPickupMutation: () => ({ mutateAsync: markOrderReady, isPending: false }),
  useUpdatePickupHistoryNoteMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAddFulfillmentNoteMutation: () => ({ mutateAsync: addNote, isPending: false }),
  useReverseTerminalFulfillmentMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRecordPickupHandoffMutation: () => ({ mutateAsync: recordHandoff, isPending: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/contexts/NavigationGuardContext", () => ({ useNavigationGuard: () => ({ guardedNavigate }) }));
jest.mock("@/pages/fulfillment-shipment-detail", () => ({ FulfillmentShipmentEditor: ({ shipmentId, onMutationComplete }: any) => <div data-testid="shipment-editor" data-shipment-id={shipmentId}><button onClick={async () => { detail = { ...detail, shipments: detail.shipments.map((shipment: any) => shipment.id === shipmentId ? { ...shipment, status: 'SHIPPED' } : shipment) }; await onMutationComplete(); }}>Mock saved partial shipment</button><button onClick={async () => { detail = { ...detail, shipments: detail.shipments.map((shipment: any) => shipment.id === shipmentId ? { ...shipment, status: 'VOIDED' } : shipment) }; await onMutationComplete(); }}>Mock void draft</button></div> }));
jest.mock("@/components/fulfillment/PickupTravelerPrintDialog", () => ({ PickupTravelerPrintDialog: ({ lines, open }: any) => open ? <div data-testid="pickup-traveler-dialog">{JSON.stringify(lines)}</div> : null }));

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const Page = require("./fulfillment-workspace").default;

function makeDetail({ fulfillmentType = "PICKUP", production = 0, ready = 0 }: { fulfillmentType?: "PICKUP" | "SHIP"; production?: number; ready?: number } = {}) {
  const line = (id: string, name: string, quantity: number) => ({ id, productName: name, description: null, productType: null, quantity, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null }, production: { jobId: null, stationKey: null, stationLabel: null, status: "not_ready", completedAt: null, eligible: ready > 0, label: "Not yet marked ready", productionRequired: true, orderedQuantity: quantity, productionCompleteQuantity: production, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: quantity - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: quantity - ready, remainingQuantity: quantity }, artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } });
  const lineItems = [line("line-1", "Economy Yard Sign Stakes", 1000)];
  return { orderId: "order-1", orderNumber: "1129", customerName: "Titan Graphics", fulfillmentType, status: "NOT_READY", itemsRemaining: "1000 item(s)", physicalLineCount: 1, orderedQuantity: 1000, productionCompleteQuantity: production, fulfilledQuantity: 0, eligibleQuantity: ready, blockedQuantity: 1000 - ready, shippedQuantity: 0, pickedUpQuantity: 0, readyWaitingQuantity: ready, notReadyQuantity: 1000 - ready, remainingQuantity: 1000, readySince: null, shipTo: fulfillmentType === "PICKUP" ? "In-Store" : "123 Main Street", overdue: false, isArchived: false, productionJobs: [], customer: { name: "Titan Graphics", email: null, phone: null }, lineItems, checklistComplete: false, checklistSummary: { total: 0, checked: 0, unchecked: 0 }, productionSummary: [], pickupTicket: fulfillmentType === "PICKUP" ? { id: "ticket-1", status: "DRAFT", readyAt: null, pickedUpAt: null, stagingLocation: null, pickupNotes: null, contactName: null, contactEmail: null, contactPhone: null } : null, pickupHandoffs: [], shipments: [], events: [] };
}

function render(state: any = null) { const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); const rerender = () => root.render(<MemoryRouter initialEntries={[{ pathname: "/fulfillment/orders/order-1", search: '?debug=1', hash: '#packing', state }]}><Routes><Route path="/fulfillment/orders/:orderId" element={<Page />} /></Routes></MemoryRouter>); act(rerender); return { container, root, rerender }; }
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter?.call(input, value); Simulate.change(input, { target: { value } } as any); }
function button(container: HTMLElement, label: string) { return Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label) as HTMLButtonElement; }

afterEach(() => { document.body.innerHTML = ""; jest.clearAllMocks(); });

describe("FulfillmentWorkspacePage direct fulfillment route", () => {
  test("administrative completion displays separate quantities and requires reason/preview before reopening", async () => {
    detail = makeDetail({ production: 1000 });
    detail.remainingQuantity = 0;
    Object.assign(detail.lineItems[0].production, { remainingQuantity: 0, administrativelyReconciledQuantity: 1000 });
    detail.permissions = { canReverseTerminalFulfillment: true };
    detail.administrativeCorrection = { mode: 'administrative', method: 'pickup', blockedReason: null, expectedState: 'snapshot', lines: [{ orderLineItemId: 'line-1', orderedQuantity: 1000, physicallyFulfilledQuantity: 0, administrativelyResolvedQuantity: 1000, legacyClosedQuantity: 0, reopenableQuantity: 1000 }] };
    const { container, root } = render();
    expect(container.textContent).toContain('Physically fulfilled 0 · Administratively resolved 1000 · Remaining 0');
    expect(button(container, 'Reopen administrative resolution').closest('details')?.open).toBe(false);
    act(() => Simulate.click(button(container, 'Reopen administrative resolution')));
    expect(button(container, 'Confirm reopen fulfillment').disabled).toBe(true);
    act(() => change(container.querySelector('textarea[aria-label="Administrative correction reason"]') as HTMLTextAreaElement, 'Wrong administrative closure'));
    await act(async () => { Simulate.click(button(container, 'Confirm reopen fulfillment')); });
    expect(reopenAdministrative).toHaveBeenCalledWith(expect.objectContaining({ expectedState: 'snapshot', reason: 'Wrong administrative closure', items: [{ orderLineItemId: 'line-1', quantity: 1000 }] }));
    act(() => root.unmount());
  });

  test("legacy completion explains missing authority instead of hiding correction capability", () => {
    detail = makeDetail({ production: 1000 });
    detail.administrativeCorrection = { mode: 'legacy', blockedReason: null, method: 'pickup', expectedState: 'snapshot', lines: [] };
    detail.permissions = { canReverseTerminalFulfillment: false };
    const { container, root } = render();
    expect(container.textContent).toContain('Legacy Completion');
    expect(container.textContent).toContain('Owner or Admin authority is required');
    expect(button(container, 'Reconcile legacy completion')).toBeUndefined();
    act(() => root.unmount());
  });

  test("completed single and combined shipments expose the canonical correction detail", () => {
    detail = makeDetail({ fulfillmentType: "SHIP" });
    detail.remainingQuantity = 0;
    detail.shipments = [
      { id: "shipped-1", status: "SHIPPED", scope: "SINGLE_ORDER", orderCount: 1, shipmentReference: "20306-S1", shippedAt: "2026-09-01T12:00:00Z" },
      { id: "shipped-2", status: "SHIPPED", scope: "MULTI_ORDER", orderCount: 2 },
    ];
    const { container, root } = render();
    expect(container.textContent).toContain("Shipment History");
    expect(container.textContent).toContain("20306-S1");
    const actions = Array.from(container.querySelectorAll("button")).filter(item => item.textContent === "View shipment / corrections");
    expect(actions).toHaveLength(2);
    expect(button(container, "Start shipment").disabled).toBe(true);
    act(() => root.unmount());
  });

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

  test("prints the current unsaved pickup quantities without recording a handoff", async () => {
    detail = makeDetail(); const { container, root } = render();
    await act(async () => { change(container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement, "250"); });
    await act(async () => { Simulate.click(button(container, "Print Pickup Travelers")); });
    expect(container.querySelector('[data-testid="pickup-traveler-dialog"]')?.textContent).toContain('"quantity":250');
    expect(recordHandoff).not.toHaveBeenCalled();
    expect(detail.lineItems[0].production.pickedUpQuantity).toBe(0);
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

  test('navigation reuses a saved single draft and never creates another', () => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    detail.shipments = [{ id: 'existing', status: 'DRAFT', scope: 'SINGLE_ORDER', orderCount: 1 }];
    const { container, root } = render();
    expect(container.querySelector('[data-testid="shipment-editor"]')?.getAttribute('data-shipment-id')).toBe('existing');
    expect(button(container, 'Start shipment')).toBeUndefined();
    expect(createShipment).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test('all multiple saved drafts are selectable without creating or silently picking one', () => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    detail.shipments = ['draft-one', 'draft-two'].map(id => ({ id, shipmentReference: id, status: 'DRAFT', scope: 'SINGLE_ORDER', orderCount: 1 }));
    const { container, root } = render();
    expect(container.textContent).toContain('Choose a saved draft shipment');
    expect(container.querySelector('[data-testid="shipment-editor"]')).toBeNull();
    expect(button(container, 'Start shipment')).toBeUndefined();
    act(() => Simulate.click(button(container, 'draft-two')));
    expect(container.querySelector('[data-testid="shipment-editor"]')?.getAttribute('data-shipment-id')).toBe('draft-two');
    act(() => Simulate.click(button(container, 'draft-one')));
    expect(container.querySelector('[data-testid="shipment-editor"]')?.getAttribute('data-shipment-id')).toBe('draft-one');
    expect(createShipment).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test.each(['Mock saved partial shipment', 'Mock void draft'])('newly created draft stops overriding current detail after %s', async terminalAction => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    const { container, root, rerender } = render();
    await act(async () => Simulate.click(button(container, 'Start shipment')));
    expect(container.querySelector('[data-testid="shipment-editor"]')?.getAttribute('data-shipment-id')).toBe('shipment-1');
    await act(async () => Simulate.click(button(container, terminalAction)));
    act(rerender);
    expect(container.querySelector('[data-testid="shipment-editor"]')).toBeNull();
    expect(button(container, 'Start shipment').disabled).toBe(false);
    await act(async () => Simulate.click(button(container, 'Start shipment')));
    expect(container.querySelector('[data-testid="shipment-editor"]')?.getAttribute('data-shipment-id')).toBe('shipment-2');
    expect(createShipment).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  test.each(['/orders/order-1', '/orders/order-1/edit'])('Back and Open Order restore exact %s query/hash and original state', pathname => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    const originalState = { referrer: { pathname: '/orders', search: '?page=4' }, listContext: 'original' };
    const { container, root } = render({ referrer: { pathname, search: '?returnTo=%2Forders%3Fpage%3D4&search=two%20words', hash: '#line-items' }, orderReturnState: originalState });
    act(() => Simulate.click(container.querySelector('button[aria-label="Back to fulfillment"]')!));
    expect(guardedNavigate).toHaveBeenLastCalledWith(`${pathname}?returnTo=%2Forders%3Fpage%3D4&search=two%20words#line-items`, { state: originalState });
    act(() => Simulate.click(button(container, 'Open Order')));
    expect(guardedNavigate).toHaveBeenLastCalledWith(`${pathname}?returnTo=%2Forders%3Fpage%3D4&search=two%20words#line-items`, { state: originalState });
    act(() => Simulate.click(button(container, 'View Order Timeline')));
    expect(guardedNavigate).toHaveBeenLastCalledWith(expect.stringContaining('panel=timeline'), { state: originalState });
    expect(createShipment).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test.each(['//evil.example/orders/order-1', 'https://evil.example', '/orders/foreign-order'])('Back rejects unsafe/unbound return %s', pathname => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    const { container, root } = render({ referrer: { pathname }, orderReturnState: { unsafe: true } });
    act(() => Simulate.click(container.querySelector('button[aria-label="Back to fulfillment"]')!));
    expect(guardedNavigate).toHaveBeenLastCalledWith('/fulfillment', { state: undefined });
    act(() => root.unmount());
  });

  test('combined/history child referrer keeps workspace and original Order context', () => {
    detail = makeDetail({ fulfillmentType: 'SHIP' });
    detail.shipments = [{ id: 'combined', status: 'DRAFT', scope: 'MULTI_ORDER', orderCount: 2 }, { id: 'shipped', status: 'SHIPPED', scope: 'SINGLE_ORDER', orderCount: 1 }];
    const original = { referrer: { pathname: '/orders/order-1', search: '?page=4', hash: '#notes' }, orderReturnState: { listContext: 'kept' } };
    const { container, root } = render(original);
    act(() => Simulate.click(button(container, 'Open Combined Shipment')));
    expect(guardedNavigate).toHaveBeenLastCalledWith('/fulfillment/shipments/combined', { state: { referrer: { pathname: '/fulfillment/orders/order-1', search: '?debug=1', hash: '#packing' }, referrerState: original } });
    act(() => Simulate.click(button(container, 'View shipment / corrections')));
    expect(guardedNavigate).toHaveBeenLastCalledWith('/fulfillment/shipments/shipped', { state: { referrer: { pathname: '/fulfillment/orders/order-1', search: '?debug=1', hash: '#packing' }, referrerState: original } });
    expect(createShipment).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
