import { useState } from "react";
import { ArrowLeft, CheckSquare, ExternalLink, PackagePlus, RefreshCw, Store, Truck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { FulfillmentShipmentEditor } from "@/pages/fulfillment-shipment-detail";
import { getFulfillmentWorkspaceLoadState } from "@/lib/fulfillmentWorkspaceState";
import { resolveFulfillmentWorkspaceMode } from "@/lib/fulfillmentWorkspaceMode";
import {
  toFulfillmentError,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useMarkOrderReadyForPickupMutation,
  useMarkPickupPickedUpMutation,
  useUpdateFulfillmentChecklistItemMutation,
} from "@/hooks/useFulfillment";

/** The Order is the workspace identity. Shipment and pickup records are child execution state. */
export default function FulfillmentWorkspacePage() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const detailQuery = useFulfillmentOrderDetailQuery(orderId);
  const updateChecklist = useUpdateFulfillmentChecklistItemMutation(orderId || "");
  const createShipment = useCreateShipmentMutation();
  const readyForPickup = useMarkOrderReadyForPickupMutation(orderId || "");
  const markPickedUp = useMarkPickupPickedUpMutation(detailQuery.data?.pickupTicket?.id || "", orderId);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const detail = detailQuery.data;
  const queryError = detailQuery.isError ? toFulfillmentError(detailQuery.error) : null;
  const loadState = getFulfillmentWorkspaceLoadState({ orderId, isLoading: detailQuery.isLoading, isError: detailQuery.isError, errorStatus: queryError?.status, hasDetail: !!detail });

  if (detailQuery.isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading fulfillment workspace…</main>;
  if (loadState === "not_found") return <main className="p-8 text-sm text-muted-foreground">Fulfillment workspace not found.</main>;
  if (loadState === "error") return <main className="space-y-3 p-8"><h1 className="text-lg font-semibold">Could not load fulfillment workspace</h1><p className="text-sm text-muted-foreground">{queryError?.message || "An unexpected error occurred."}</p><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-1 inline h-4 w-4" />Retry</button></main>;
  if (!detail || !orderId) return null;

  const workspaceMode = resolveFulfillmentWorkspaceMode(detail);
  const isPickup = workspaceMode.mode === "pickup";
  const canStartFulfillment = detail.status !== "AWAITING_PRODUCTION";
  const combinedShipments = workspaceMode.combinedShipments;
  const historicalDrafts = workspaceMode.historicalDrafts;
  const shipmentId = createdShipmentId || workspaceMode.singleDraftShipmentId;

  const startShipment = async () => {
    if (!canStartFulfillment || isPickup) return;
    const created = await createShipment.mutateAsync({ scope: "SINGLE_ORDER", orderIds: [orderId], primaryOrderId: orderId });
    setCreatedShipmentId(created.shipmentId);
    await detailQuery.refetch();
  };

  return <main className="w-full space-y-6 p-4 md:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.list)}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment workspace</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1><p className="text-sm text-muted-foreground">{detail.customer.name} · <span className="font-semibold">{isPickup ? "Pickup" : "Ship"}</span>{isPickup ? "" : ` · ${detail.shipTo}`}</p>
      </div></div>
      <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.orders.detail(orderId))}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button>
        {!isPickup && !shipmentId && <button disabled={!canStartFulfillment || createShipment.isPending} title={canStartFulfillment ? undefined : "Production must be complete before shipment can be created."} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void startShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{createShipment.isPending ? "Starting…" : "Start shipment"}</button>}
      </div>
    </header>

    <section className="rounded-xl border bg-card"><div className="border-b p-5"><h2 className="font-bold">Production readiness and fulfillment verification</h2><p className="text-sm text-muted-foreground">{detail.checklistSummary.checked} of {detail.checklistSummary.total} items independently verified.</p></div><div className="divide-y">
      {detail.lineItems.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-4 p-5"><input aria-label={`Verify ${item.productName || item.description || "line item"}`} type="checkbox" checked={item.checklist.checked} onChange={(event) => updateChecklist.mutate({ lineItemId: item.id, checked: event.target.checked })} className="h-5 w-5" /><div className="min-w-[220px] flex-1"><p className="font-semibold">{item.productName || item.description || "Line item"}</p><p className="text-sm text-muted-foreground">Ordered {item.quantity ?? 0} · {item.size || "Configured to order"}</p></div><div className="text-sm"><span className="font-medium">{item.production.completedAt ? "Production complete" : "Production status"}</span><p className="text-muted-foreground">{item.production.status || "Awaiting production"}</p></div>{item.artwork[0]?.previewUrl ? <a className="text-sm font-semibold text-primary" href={item.artwork[0].previewUrl} target="_blank" rel="noreferrer">Artwork</a> : null}</article>)}
    </div></section>

    {isPickup ? <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold"><Store className="mr-2 inline h-4 w-4" />Pickup</h2><p className="mt-1 text-sm text-muted-foreground">{detail.pickupTicket?.status === "PICKED_UP" ? "Customer pickup is complete." : detail.pickupTicket?.status === "READY_FOR_PICKUP" ? "Ready for customer pickup." : canStartFulfillment ? "Verify all items, then mark this order ready for pickup." : "Awaiting production before pickup can be readied."}</p></div><div className="flex flex-wrap gap-2">
      {detail.pickupTicket?.status === "READY_FOR_PICKUP" && <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={markPickedUp.isPending} onClick={() => void markPickedUp.mutateAsync()}>{markPickedUp.isPending ? "Marking…" : "Mark Picked Up"}</button>}
      {!detail.pickupTicket || detail.pickupTicket.status === "DRAFT" ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!canStartFulfillment || readyForPickup.isPending} onClick={() => void readyForPickup.mutateAsync({})}>{readyForPickup.isPending ? "Marking…" : "Ready for Pickup"}</button> : null}
    </div></div>
      {detail.pickupTicket && <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">Status</dt><dd className="font-semibold">{detail.pickupTicket.status}</dd></div>{detail.pickupTicket.stagingLocation && <div><dt className="text-muted-foreground">Staging location</dt><dd>{detail.pickupTicket.stagingLocation}</dd></div>}{detail.pickupTicket.pickupNotes && <div><dt className="text-muted-foreground">Notes</dt><dd>{detail.pickupTicket.pickupNotes}</dd></div>}</dl>}
      {historicalDrafts.length > 0 && <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><p className="font-semibold">Previous draft shipment retained</p><p className="mt-1 text-muted-foreground">This Order is currently Pickup, so the draft cannot determine shipping actions. It remains auditable until an operator voids it.</p>{historicalDrafts.map((shipment) => <button key={shipment.id} className="mt-2 text-sm font-semibold text-primary" onClick={() => navigate(ROUTES.fulfillment.shipmentDetail(shipment.id))}>Open {shipment.shipmentReference || "draft shipment"}</button>)}</div>}
    </section> : <section className="space-y-4"><div className="rounded-xl border bg-card p-5"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipment</h2><p className="mt-1 text-sm text-muted-foreground">{shipmentId ? "Edit this single-order shipment below. Saving and shipping use the existing canonical shipment operations." : canStartFulfillment ? "No single-order shipment draft exists yet." : "Awaiting production before shipment can be created."}</p></div>
      {shipmentId && <FulfillmentShipmentEditor shipmentId={shipmentId} embedded onMutationComplete={() => detailQuery.refetch()} />}
      {combinedShipments.map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><div><p className="font-semibold">{shipment.shipmentReference || "Combined shipment"} · {shipment.status}</p><p className="text-sm text-muted-foreground">Shared by {shipment.orderCount} orders. Manage shared allocations from the full shipment view.</p></div><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.shipmentDetail(shipment.id))}>Open Full Shipment</button></div>)}
    </section>}

    <section className="rounded-xl border bg-card p-5"><h2 className="font-bold"><CheckSquare className="mr-2 inline h-4 w-4" />Verification</h2><p className="mt-2 text-sm text-muted-foreground">The production gate and the organization’s fulfillment verification policy remain server-enforced for shipment and pickup transitions.</p></section>
  </main>;
}
