import React, { useEffect, useMemo, useState } from "react";
import { fulfillmentApi, newBusinessRequestId, type ApiError, type FulfillmentShipmentCarrierInput, type FulfillmentShipmentContainer, type FulfillmentShipmentDetail, type FulfillmentWorkspaceOrder } from "./api";

type Selection = Readonly<{ orderId: string; orderNumber: string; orderLineId: string; description: string; available: number; customerId?: string; destination?: unknown; quantity: string }>;
type SelectionByKey = Readonly<Record<string, Selection>>;
const keyOf = (orderId: string, lineId: string) => `${orderId}:${lineId}`;
const message = (error: unknown) => (error as ApiError | undefined)?.message ?? "The shipment operation could not be completed.";
export const shipmentQuantityValid = (quantity: string, available: number) => Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= available;
export const groupShipmentAllocations = (items: readonly Readonly<{ orderId: string; orderLineId: string; quantity: string }>[]) => items.map(item => ({ orderId: item.orderId, orderLineId: item.orderLineId, quantity: Number(item.quantity) }));
const carrierInput = (carrierName: string, carrierService: string, trackingNumber: string, notes: string, packageCount: string): FulfillmentShipmentCarrierInput => ({
  ...(carrierName.trim() ? { carrierName: carrierName.trim() } : {}),
  ...(carrierService.trim() ? { carrierService: carrierService.trim() } : {}),
  ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
  ...(notes.trim() ? { notes: notes.trim() } : {}),
  ...(packageCount.trim() ? { packageCount: Number(packageCount) } : {}),
});

/**
 * Bounded shipment composer. It collects operator intent only: the server
 * persists prepared allocations and validates quantity atomically. It never
 * represents a customer handoff or a shipment until canonical finalization
 * can create both facts in one server-owned transaction.
 */
export const ShipmentBuilder = ({ organizationId, csrfReady, canShip, orders, refresh }: { organizationId: string; csrfReady: boolean; canShip: boolean; orders: readonly FulfillmentWorkspaceOrder[]; refresh: () => Promise<void> }) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<SelectionByKey>({});
  const [shipment, setShipment] = useState<FulfillmentShipmentDetail>();
  const [shipments, setShipments] = useState<readonly FulfillmentShipmentContainer[]>([]);
  const [carrierName, setCarrierName] = useState(""); const [carrierService, setCarrierService] = useState(""); const [trackingNumber, setTrackingNumber] = useState(""); const [notes, setNotes] = useState(""); const [packageCount, setPackageCount] = useState(""); const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"create" | "correct" | "cancel" | "finalize" | "load" | undefined>();
  const [notice, setNotice] = useState("");
  const selections = useMemo(() => Object.values(selected), [selected]);
  const prepared = shipment?.status === "prepared";
  const readOnly = Boolean(shipment && !prepared);
  const editable = canShip && csrfReady && !pending && !readOnly;
  const metadata = () => carrierInput(carrierName, carrierService, trackingNumber, notes, packageCount);
  const allocations = () => groupShipmentAllocations(selections);
  const valid = selections.length > 0 && selections.every(item => shipmentQuantityValid(item.quantity, item.available));
  const resetForm = () => { setShipment(undefined); setSelected({}); setCarrierName(""); setCarrierService(""); setTrackingNumber(""); setNotes(""); setPackageCount(""); setReason(""); setNotice(""); };
  const restore = (detail: FulfillmentShipmentDetail) => {
    const restored: Record<string, Selection> = {};
    for (const allocation of detail.currentPreparedRevision?.allocations ?? []) {
      const order = orders.find(item => item.orderId === allocation.orderId); const line = order?.lines.find(item => item.orderLineId === allocation.orderLineId); if (!order || !line) continue;
      const key = keyOf(order.orderId, line.orderLineId);
      // Prepared allocations are proposed work, not completed fulfillment.
      // Current availability is a UI guard only; correction validation is
      // repeated atomically by the server at save/finalization time.
      restored[key] = { orderId: order.orderId, orderNumber: order.number, orderLineId: line.orderLineId, description: line.description, available: line.availableFulfillmentQuantity, ...(order.customerId ? { customerId: order.customerId } : {}), ...(order.requestedFulfillment?.destination ? { destination: order.requestedFulfillment.destination } : {}), quantity: String(allocation.quantity) };
    }
    const carrier = detail.currentPreparedRevision?.carrier ?? detail.carrier;
    setShipment(detail); setSelected(restored); setCarrierName(carrier.carrierName ?? ""); setCarrierService(carrier.carrierService ?? ""); setTrackingNumber(carrier.trackingNumber ?? ""); setNotes(carrier.notes ?? ""); setPackageCount(carrier.packageCount === undefined ? "" : String(carrier.packageCount)); setReason("");
  };
  const loadShipments = async () => { setPending("load"); try { setShipments(await fulfillmentApi.listShipments(organizationId)); } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  useEffect(() => { if (expanded) void loadShipments(); }, [expanded, organizationId]);
  const setQuantity = (key: string, quantity: string) => setSelected(current => current[key] ? { ...current, [key]: { ...current[key]!, quantity } } : current);
  const toggle = (order: FulfillmentWorkspaceOrder, line: FulfillmentWorkspaceOrder["lines"][number]) => {
    if (readOnly) return; const key = keyOf(order.orderId, line.orderLineId);
    setSelected(current => { if (current[key]) { const { [key]: _removed, ...rest } = current; return rest; } return { ...current, [key]: { orderId: order.orderId, orderNumber: order.number, orderLineId: line.orderLineId, description: line.description, available: line.availableFulfillmentQuantity, ...(order.customerId ? { customerId: order.customerId } : {}), ...(order.requestedFulfillment?.destination ? { destination: order.requestedFulfillment.destination } : {}), quantity: String(line.availableFulfillmentQuantity) } }; });
  };
  const refreshAll = async () => { await Promise.all([refresh(), loadShipments()]); };
  const create = async () => { if (!valid || !editable) return; setPending("create"); setNotice(""); try { const first = selections[0]!; const created = await fulfillmentApi.createShipment(organizationId, newBusinessRequestId(), { ...(first.customerId ? { customerId: first.customerId } : {}), ...(first.destination ? { destination: first.destination } : {}), carrier: metadata(), allocations: allocations() }); restore(created); setNotice(`Prepared shipment ${created.shipmentId}. Its allocations are server-owned and remain correctable until it is shipped.`); await refreshAll(); } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  const correct = async () => { if (!shipment || !prepared || !valid || !reason.trim() || !editable) return; setPending("correct"); setNotice(""); try { const corrected = await fulfillmentApi.correctShipment(organizationId, shipment.shipmentId, newBusinessRequestId(), { allocations: allocations(), reason: reason.trim(), carrier: metadata() }); restore(corrected); setNotice("Prepared shipment correction was saved with an immutable recovery reason."); await refreshAll(); } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  const cancel = async () => { if (!shipment || !prepared || !reason.trim() || !editable) return; setPending("cancel"); setNotice(""); try { const voided = await fulfillmentApi.cancelShipment(organizationId, shipment.shipmentId, newBusinessRequestId(), reason.trim()); restore(voided); setNotice("Prepared shipment voided. Server-authoritative allocations were released and the void remains in history."); await refreshAll(); } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  const finalize = async () => { const revisionId = shipment?.currentPreparedRevision?.revisionId; if (!shipment || !prepared || !revisionId || !editable) return; setPending("finalize"); setNotice(""); try { const finalized = await fulfillmentApi.finalizeShipment(organizationId, shipment.shipmentId, newBusinessRequestId(), revisionId); restore(finalized); setNotice("Shipment finalized. The server atomically created its immutable handoffs, allocations, document snapshots, and shipment history."); await refreshAll(); } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  return <section className="v2-fulfillment-shipment-builder">
    <header><div><small>Shipping</small><h2>Shipment container</h2><p>Prepare one physical shipment from a bounded set of currently loaded fulfillment lines. The server owns allocations, compatibility, and quantity validation; preparing a shipment does not fulfill or mark it shipped.</p></div><button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Close shipment builder" : "Create shipment"}</button></header>
    {expanded && <div className="v2-fulfillment-shipment-body">
      <section className="v2-fulfillment-shipment-history"><header><h3>Prepared shipment recovery</h3><button type="button" disabled={Boolean(pending)} onClick={() => void loadShipments()}>{pending === "load" ? "Refreshing…" : "Refresh shipments"}</button></header>{shipments.length ? <div>{shipments.map(item => <button key={item.shipmentId} type="button" className={shipment?.shipmentId === item.shipmentId ? "active" : ""} onClick={() => void fulfillmentApi.getShipment(organizationId, item.shipmentId).then(restore).catch(error => setNotice(message(error)))}><b>{item.shipmentId}</b><small>{item.status}{item.carrier.trackingNumber ? ` · ${item.carrier.trackingNumber}` : ""}</small></button>)}</div> : <p>No persisted shipment containers are available in this bounded workspace.</p>}<button type="button" onClick={resetForm}>Start a new prepared shipment</button></section>
      <div className="v2-fulfillment-shipment-selection"><h3>{shipment ? "Shipment allocations" : "1. Select fulfillment quantities"}</h3>{readOnly && <p>This {shipment?.status} shipment is historical and read-only. A shipped shipment cannot be edited, cancelled, or turned back into prepared work.</p>}{orders.map(order => <article key={order.orderId}><b>{order.number} · {order.customerName}</b>{order.lines.filter(line => line.availableFulfillmentQuantity > 0 && !line.physicalIntegrityAnomaly || Boolean(selected[keyOf(order.orderId, line.orderLineId)])).map(line => { const key = keyOf(order.orderId, line.orderLineId); const active = selected[key]; return <label key={line.orderLineId} className="v2-fulfillment-shipment-line"><input type="checkbox" checked={Boolean(active)} disabled={readOnly || !canShip} onChange={() => toggle(order, line)} /><span><b>{line.description}</b><small>{line.availableFulfillmentQuantity} currently available · {line.completedFulfillmentQuantity} previously fulfilled</small></span>{active && <input aria-label={`${order.number} ${line.description} shipment quantity`} type="number" min="1" max={active.available} step="1" value={active.quantity} disabled={readOnly} onChange={event => setQuantity(key, event.target.value)} />}</label>; })}</article>)}</div>
      <div className="v2-fulfillment-shipment-details"><h3>{shipment ? "Shipment details" : "2. Manual shipment details"}</h3><label>Carrier<input value={carrierName} disabled={readOnly} onChange={event => setCarrierName(event.target.value)} placeholder="Manual carrier" /></label><label>Service<input value={carrierService} disabled={readOnly} onChange={event => setCarrierService(event.target.value)} placeholder="Service" /></label><label>Tracking<input value={trackingNumber} disabled={readOnly} onChange={event => setTrackingNumber(event.target.value)} placeholder="Tracking number" /></label><label>Package count<input type="number" min="1" step="1" value={packageCount} disabled={readOnly} onChange={event => setPackageCount(event.target.value)} placeholder="Optional" /></label><label>Notes<textarea value={notes} disabled={readOnly} onChange={event => setNotes(event.target.value)} /></label>{prepared && <label>Correction or void reason<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Required before correcting or voiding a prepared shipment" /></label>}<p>Carrier, service, tracking, notes, and package count are manual operator facts, not provider events.</p></div>
      <footer className="v2-fulfillment-shipment-actions"><p>{selections.length ? `${selections.length} line${selections.length === 1 ? "" : "s"} selected` : "Select one or more available lines."}</p>{!shipment ? <button type="button" className="primary" disabled={!editable || !valid} onClick={() => void create()}>{pending === "create" ? "Creating…" : "Create prepared shipment"}</button> : prepared ? <><button type="button" disabled={!editable || !valid || !reason.trim()} onClick={() => void correct()}>{pending === "correct" ? "Saving…" : "Save correction"}</button><button type="button" disabled={!editable || !reason.trim()} onClick={() => void cancel()}>{pending === "cancel" ? "Voiding…" : "Void prepared shipment"}</button><button type="button" className="primary" disabled={!editable || !shipment.currentPreparedRevision} onClick={() => void finalize()}>{pending === "finalize" ? "Finalizing…" : "Mark shipped"}</button><p className="v2-fulfillment-notice">Mark shipped invokes one server transaction: it revalidates the frozen prepared revision, creates immutable handoffs, allocations, snapshots and attachments, then transitions the container to shipped. A conflict leaves this draft prepared.</p></> : <p>{shipment.status === "shipped" ? "This shipment is shipped. Any physical correction must use a future explicit post-shipment correction workflow; this record remains immutable." : "This prepared shipment was voided. Its historical evidence remains available, but it cannot be edited or shipped."}</p>}<p>Pickup remains a separate handoff action and never requires carrier or tracking data.</p>{notice && <p className="v2-fulfillment-notice">{notice}</p>}</footer>
    </div>}
  </section>;
};
