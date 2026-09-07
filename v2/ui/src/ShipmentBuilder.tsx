import React, { useMemo, useState } from "react";
import { fulfillmentApi, newBusinessRequestId, type ApiError, type FulfillmentShipmentCarrierInput, type FulfillmentShipmentContainer, type FulfillmentWorkspaceOrder } from "./api";

type Selection = Readonly<{ orderId: string; orderNumber: string; orderLineId: string; description: string; available: number; customerId?: string; destination?: unknown; quantity: string }>;
type SelectionByKey = Readonly<Record<string, Selection>>;
const keyOf = (orderId: string, lineId: string) => `${orderId}:${lineId}`;
const message = (error: unknown) => (error as ApiError | undefined)?.message ?? "The shipment operation could not be completed.";
export const shipmentQuantityValid = (quantity: string, available: number) => Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= available;
export const groupShipmentAllocations = (items: readonly Readonly<{ orderId: string; orderLineId: string; quantity: string }>[]) => {
  const grouped = new Map<string, readonly Readonly<{ orderLineId: string; quantity: number }>[]>();
  for (const item of items) grouped.set(item.orderId, [...(grouped.get(item.orderId) ?? []), { orderLineId: item.orderLineId, quantity: Number(item.quantity) }]);
  return grouped;
};
const carrierInput = (carrierName: string, carrierService: string, trackingNumber: string, notes: string, packageCount: string): FulfillmentShipmentCarrierInput => ({
  ...(carrierName.trim() ? { carrierName: carrierName.trim() } : {}),
  ...(carrierService.trim() ? { carrierService: carrierService.trim() } : {}),
  ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
  ...(notes.trim() ? { notes: notes.trim() } : {}),
  ...(packageCount.trim() ? { packageCount: Number(packageCount) } : {}),
});

/**
 * Bounded shipment composer. It only collects operator intent; all allocation,
 * customer and destination compatibility checks remain server-authoritative.
 */
export const ShipmentBuilder = ({ organizationId, csrfReady, canShip, orders, refresh }: { organizationId: string; csrfReady: boolean; canShip: boolean; orders: readonly FulfillmentWorkspaceOrder[]; refresh: () => Promise<void> }) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<SelectionByKey>({});
  const [container, setContainer] = useState<FulfillmentShipmentContainer>();
  const [recordedByOrder, setRecordedByOrder] = useState<Readonly<Record<string, string>>>({});
  const [carrierName, setCarrierName] = useState("");
  const [carrierService, setCarrierService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [pending, setPending] = useState<"create" | "ship" | "allocate" | undefined>();
  const [notice, setNotice] = useState("");
  const selections = useMemo(() => Object.values(selected), [selected]);
  const locked = Boolean(container?.status === "shipped");
  const editable = canShip && csrfReady && !pending;
  const metadata = () => carrierInput(carrierName, carrierService, trackingNumber, notes, packageCount);
  const setQuantity = (key: string, quantity: string) => setSelected(current => current[key] ? { ...current, [key]: { ...current[key]!, quantity } } : current);
  const toggle = (order: FulfillmentWorkspaceOrder, line: FulfillmentWorkspaceOrder["lines"][number]) => {
    if (locked) return;
    const key = keyOf(order.orderId, line.orderLineId);
    setSelected(current => {
      if (current[key]) { const { [key]: _removed, ...rest } = current; return rest; }
      return { ...current, [key]: { orderId: order.orderId, orderNumber: order.number, orderLineId: line.orderLineId, description: line.description, available: line.availableFulfillmentQuantity, ...(order.customerId ? { customerId: order.customerId } : {}), ...(order.requestedFulfillment?.destination ? { destination: order.requestedFulfillment.destination } : {}), quantity: String(line.availableFulfillmentQuantity) } };
    });
  };
  const valid = selections.length > 0 && selections.every(item => shipmentQuantityValid(item.quantity, item.available));
  const create = async () => {
    if (!valid || !editable) return;
    setPending("create"); setNotice("");
    try {
      const first = selections[0]!;
      const created = await fulfillmentApi.createShipment(organizationId, newBusinessRequestId(), { ...(first.customerId ? { customerId: first.customerId } : {}), ...(first.destination ? { destination: first.destination } : {}), carrier: metadata() });
      setContainer(created); setRecordedByOrder({}); setNotice(`Prepared shipment ${created.shipmentId}. Confirm manual details, then mark it shipped.`);
    } catch (error) { setNotice(message(error)); } finally { setPending(undefined); }
  };
  const ship = async () => {
    if (!container || !editable) return;
    setPending("ship"); setNotice("");
    try { const shipped = await fulfillmentApi.markShipmentShipped(organizationId, container.shipmentId, newBusinessRequestId(), metadata()); setContainer(shipped); setNotice("Shipment marked shipped. Record the selected immutable fulfillment allocations next."); }
    catch (error) { setNotice(message(error)); } finally { setPending(undefined); }
  };
  const allocateAndAttach = async () => {
    if (!container || container.status !== "shipped" || !valid || !editable) return;
    setPending("allocate"); setNotice("");
    try {
      const grouped = groupShipmentAllocations(selections);
      const next = { ...recordedByOrder };
      for (const [orderId, allocations] of grouped) {
        if (next[orderId]) continue;
        const result = await fulfillmentApi.complete(organizationId, orderId, "shipment", newBusinessRequestId(), allocations);
        next[orderId] = result.handoff.handoffId;
        setRecordedByOrder({ ...next });
      }
      await fulfillmentApi.attachShipmentHandoffs(organizationId, container.shipmentId, newBusinessRequestId(), Object.values(next));
      setNotice("Shipment allocations were attached. Packing slips are available from each included Order’s immutable handoff history.");
      await refresh();
    } catch (error) { setNotice(`${message(error)} Any handoffs already recorded remain immutable; retrying this shipment only reuses handoffs created in this operator session.`); await refresh(); }
    finally { setPending(undefined); }
  };
  return <section className="v2-fulfillment-shipment-builder">
    <header><div><small>Shipping</small><h2>Shipment container</h2><p>Create one physical shipment from a bounded set of currently loaded fulfillment lines. Final compatibility and availability are checked by the server.</p></div><button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Close shipment builder" : "Create shipment"}</button></header>
    {expanded && <div className="v2-fulfillment-shipment-body">
      <div className="v2-fulfillment-shipment-selection"><h3>1. Select fulfillment quantities</h3>{orders.map(order => <article key={order.orderId}><b>{order.number} · {order.customerName}</b>{order.lines.filter(line => line.availableFulfillmentQuantity > 0 && !line.physicalIntegrityAnomaly).map(line => { const key = keyOf(order.orderId, line.orderLineId); const active = selected[key]; return <label key={line.orderLineId} className="v2-fulfillment-shipment-line"><input type="checkbox" checked={Boolean(active)} disabled={locked || !canShip} onChange={() => toggle(order, line)} /><span><b>{line.description}</b><small>{line.availableFulfillmentQuantity} available · {line.completedFulfillmentQuantity} previously fulfilled</small></span>{active && <input aria-label={`${order.number} ${line.description} shipment quantity`} type="number" min="1" max={line.availableFulfillmentQuantity} step="1" value={active.quantity} disabled={locked} onChange={event => setQuantity(key, event.target.value)} />}</label>; })}</article>)}</div>
      <div className="v2-fulfillment-shipment-details"><h3>2. Manual shipment details</h3><label>Carrier<input value={carrierName} disabled={locked} onChange={event => setCarrierName(event.target.value)} placeholder="Manual carrier" /></label><label>Service<input value={carrierService} disabled={locked} onChange={event => setCarrierService(event.target.value)} placeholder="Service" /></label><label>Tracking<input value={trackingNumber} disabled={locked} onChange={event => setTrackingNumber(event.target.value)} placeholder="Tracking number" /></label><label>Package count<input type="number" min="1" step="1" value={packageCount} disabled={locked} onChange={event => setPackageCount(event.target.value)} placeholder="Optional" /></label><label>Notes<textarea value={notes} disabled={locked} onChange={event => setNotes(event.target.value)} /></label><p>Carrier, service, tracking, notes, and package count are optional for a prepared shipment; they are recorded as manual operator facts, not provider events.</p></div>
      <footer className="v2-fulfillment-shipment-actions"><p>{selections.length ? `${selections.length} line${selections.length === 1 ? "" : "s"} selected` : "Select one or more available lines."}</p>{!container ? <button type="button" className="primary" disabled={!editable || !valid} onClick={() => void create()}>{pending === "create" ? "Creating…" : "Create prepared shipment"}</button> : container.status === "prepared" ? <button type="button" className="primary" disabled={!editable} onClick={() => void ship()}>{pending === "ship" ? "Marking shipped…" : "Mark shipped"}</button> : <button type="button" className="primary" disabled={!editable || !valid} onClick={() => void allocateAndAttach()}>{pending === "allocate" ? "Recording allocations…" : "Record selected allocations"}</button>}<p>Pickup remains a separate handoff action and never requires carrier or tracking data.</p>{notice && <p className="v2-fulfillment-notice">{notice}</p>}</footer>
    </div>}
  </section>;
};
