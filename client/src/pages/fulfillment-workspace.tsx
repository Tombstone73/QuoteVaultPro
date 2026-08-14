import { useState } from "react";
import { ArrowLeft, ExternalLink, FileImage, PackagePlus, RefreshCw, Store, Truck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AuthenticatedArtworkThumbnail } from "@/components/artwork/AuthenticatedArtworkThumbnail";
import { ROUTES } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { openArtworkPreview } from "@/lib/artworkAccess";
import { FulfillmentShipmentEditor } from "@/pages/fulfillment-shipment-detail";
import { getFulfillmentWorkspaceLoadState } from "@/lib/fulfillmentWorkspaceState";
import { resolveFulfillmentWorkspaceMode } from "@/lib/fulfillmentWorkspaceMode";
import {
  toFulfillmentError,
  useAdjustFulfillmentReadyQuantitiesMutation,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useMarkPickupReadyMutation,
  useRecordPickupHandoffMutation,
} from "@/hooks/useFulfillment";

/** The Order is the workspace identity. Shipment and pickup records are child execution state. */
export default function FulfillmentWorkspacePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { orderId } = useParams<{ orderId: string }>();
  const detailQuery = useFulfillmentOrderDetailQuery(orderId);
  const createShipment = useCreateShipmentMutation();
  const createPickupTicket = useCreatePickupTicketMutation();
  const markPickupReady = useMarkPickupReadyMutation(orderId);
  const adjustReadyQuantities = useAdjustFulfillmentReadyQuantitiesMutation(orderId);
  const recordPickupHandoff = useRecordPickupHandoffMutation(orderId);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const [pickupQuantityByLine, setPickupQuantityByLine] = useState<Record<string, number>>({});
  const [readyQuantityByLine, setReadyQuantityByLine] = useState<Record<string, number>>({});
  const [unreadyQuantityByLine, setUnreadyQuantityByLine] = useState<Record<string, number>>({});
  const [pickupRequestId, setPickupRequestId] = useState<string | null>(null);
  const detail = detailQuery.data;
  const queryError = detailQuery.isError ? toFulfillmentError(detailQuery.error) : null;
  const loadState = getFulfillmentWorkspaceLoadState({
    orderId,
    isLoading: detailQuery.isLoading,
    isError: detailQuery.isError,
    errorStatus: queryError?.status,
    hasDetail: !!detail,
  });

  if (detailQuery.isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading fulfillment workspace…</main>;
  if (loadState === "not_found") return <main className="p-8 text-sm text-muted-foreground">Fulfillment workspace not found.</main>;
  if (loadState === "error") return <main className="space-y-3 p-8"><h1 className="text-lg font-semibold">Could not load fulfillment workspace</h1><p className="text-sm text-muted-foreground">{queryError?.message || "An unexpected error occurred."}</p><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-1 inline h-4 w-4" />Retry</button></main>;
  if (!detail || !orderId) return null;

  const workspaceMode = resolveFulfillmentWorkspaceMode(detail);
  const isPickup = workspaceMode.mode === "pickup";
  const canStartFulfillment = detail.readyWaitingQuantity > 0;
  const shipmentId = createdShipmentId || workspaceMode.singleDraftShipmentId;
  const pickupPending = recordPickupHandoff.isPending || createPickupTicket.isPending || markPickupReady.isPending;
  const readyPending = adjustReadyQuantities.isPending;

  const showError = (title: string, error: unknown) => toast({ title, description: toFulfillmentError(error).message, variant: "destructive" });

  const startShipment = async () => {
    if (!canStartFulfillment || isPickup) return;
    try {
      const created = await createShipment.mutateAsync({ scope: "SINGLE_ORDER", orderIds: [orderId], primaryOrderId: orderId });
      setCreatedShipmentId(created.shipmentId);
      await detailQuery.refetch();
    } catch (error) {
      showError("Could not start shipment", error);
    }
  };

  const markReady = async () => {
    const items = detail.lineItems.flatMap((item) => {
      const quantityDelta = Math.floor(Number(readyQuantityByLine[item.id] || 0));
      return quantityDelta > 0 ? [{ orderLineItemId: item.id, quantityDelta }] : [];
    });
    if (!items.length) return showError("No ready quantity entered", new Error("Enter the quantity physically ready for fulfillment."));
    try {
      await adjustReadyQuantities.mutateAsync({ items });
      setReadyQuantityByLine({});
    } catch (error) {
      showError("Could not mark items ready", error);
    }
  };

  const unready = async () => {
    const items = detail.lineItems.flatMap((item) => {
      const quantity = Math.floor(Number(unreadyQuantityByLine[item.id] || 0));
      return quantity > 0 ? [{ orderLineItemId: item.id, quantityDelta: -quantity }] : [];
    });
    if (!items.length) return showError("No ready quantity entered", new Error("Enter the quantity to remove from the ready pool."));
    try {
      await adjustReadyQuantities.mutateAsync({ items });
      setUnreadyQuantityByLine({});
    } catch (error) { showError("Could not un-ready items", error); }
  };

  const previewArtwork = async (fileRecordId: string | null, mimeType: string | null, fileName: string) => {
    if (!fileRecordId) return;
    try { await openArtworkPreview(fileRecordId, mimeType); }
    catch (error) { showError(`Could not open ${fileName}`, error); }
  };

  const completePickup = async () => {
    const items = detail.lineItems.flatMap((item) => {
      const quantity = Math.floor(Number(pickupQuantityByLine[item.id] || 0));
      return quantity > 0 ? [{ orderLineItemId: item.id, quantity }] : [];
    });
    if (!items.length) return showError("No pickup quantity entered", new Error("Enter a quantity that is currently available for pickup."));

    try {
      let ticketId = detail.pickupTicket?.id;
      let ticketStatus = detail.pickupTicket?.status;
      if (!ticketId) {
        const ticket = await createPickupTicket.mutateAsync(orderId);
        ticketId = ticket.id;
        ticketStatus = ticket.status;
      }
      // This is a notification-state bootstrap required by the existing handoff API.
      // It is intentionally not displayed as a physical verification step.
      if (ticketStatus === "DRAFT") await markPickupReady.mutateAsync({ ticketId });
      const clientRequestId = pickupRequestId || crypto.randomUUID();
      setPickupRequestId(clientRequestId);
      await recordPickupHandoff.mutateAsync({ ticketId, items, clientRequestId });
      setPickupQuantityByLine({});
      setPickupRequestId(null);
    } catch (error) {
      showError("Could not complete pickup", error);
      await detailQuery.refetch();
    }
  };

  return <main className="w-full space-y-4 p-4 md:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.list)}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1>
        <p className="text-sm text-muted-foreground">{detail.customer.name} · <span className="font-semibold">{isPickup ? "Pickup" : "Shipping"}</span>{isPickup ? "" : ` · ${detail.shipTo}`}</p>
      </div></div>
      <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.orders.detail(orderId))}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button>
        {!isPickup && !shipmentId && <button disabled={!canStartFulfillment || createShipment.isPending} title={canStartFulfillment ? undefined : "Mark a quantity ready before starting shipment."} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void startShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{createShipment.isPending ? "Starting…" : "Start shipment"}</button>}
      </div>
    </header>

    {isPickup ? <>
      <section className="overflow-hidden rounded-xl border bg-card" data-testid="ready-for-pickup-lines">
        <div className="border-b px-4 py-3"><h2 className="font-bold">Ready for Pickup</h2><p className="text-sm text-muted-foreground">Confirm what is physically waiting. Production is informational only.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="border-b bg-muted/30 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Product</th><th className="px-3 py-3 text-right">Ordered</th><th className="px-3 py-3 text-right">Prod. Reported</th><th className="px-3 py-3 text-right">Ready</th><th className="px-3 py-3 text-right">Picked Up</th><th className="px-3 py-3 text-right">Remaining</th><th className="px-4 py-3">Ready Now</th><th className="px-4 py-3">Un-ready</th></tr></thead><tbody className="divide-y">{detail.lineItems.map((item) => { const itemName = item.productName || item.description || "Line item"; const available = item.production.notReadyQuantity; const reducible = item.production.readyWaitingQuantity; return <tr key={item.id} data-testid={`ready-line-${item.id}`}><td className="px-4 py-3 font-semibold">{itemName}</td><td className="px-3 py-3 text-right tabular-nums">{item.production.orderedQuantity}</td><td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{item.production.productionCompleteQuantity}</td><td className="px-3 py-3 text-right font-semibold tabular-nums" data-testid={`ready-waiting-${item.id}`}>{item.production.readyWaitingQuantity}</td><td className="px-3 py-3 text-right tabular-nums">{item.production.pickedUpQuantity}</td><td className="px-3 py-3 text-right tabular-nums">{item.production.remainingQuantity}</td><td className="px-4 py-3"><input aria-label={`Ready quantity: ${itemName}`} type="number" min={0} max={available} value={readyQuantityByLine[item.id] ?? ""} disabled={readyPending || available <= 0} className="w-24 rounded border px-2 py-1.5 tabular-nums" onChange={(event) => { const parsed = Math.floor(Number(event.target.value)); const quantity = Number.isFinite(parsed) ? Math.max(0, Math.min(available, parsed)) : 0; setReadyQuantityByLine((current) => ({ ...current, [item.id]: quantity })); }} /></td><td className="px-4 py-3"><input aria-label={`Un-ready quantity: ${itemName}`} type="number" min={0} max={reducible} value={unreadyQuantityByLine[item.id] ?? ""} disabled={readyPending || reducible <= 0} className="w-24 rounded border px-2 py-1.5 tabular-nums" onChange={(event) => { const parsed = Math.floor(Number(event.target.value)); const quantity = Number.isFinite(parsed) ? Math.max(0, Math.min(reducible, parsed)) : 0; setUnreadyQuantityByLine((current) => ({ ...current, [item.id]: quantity })); }} /></td></tr>; })}</tbody></table></div>
        <div className="flex justify-end gap-2 border-t px-4 py-3"><button type="button" className="rounded border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50" disabled={readyPending} onClick={() => void unready()}>Un-ready</button><button type="button" className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readyPending} onClick={() => void markReady()}>{readyPending ? "Marking…" : "Mark Ready for Pickup"}</button></div>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card" data-testid="pickup-transaction-lines">
        <div className="border-b px-4 py-3"><h2 className="font-bold">Customer Pickup</h2><p className="text-sm text-muted-foreground">Record only what is leaving now.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b bg-muted/30 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Product</th><th className="px-3 py-3 text-right">Ready Waiting</th><th className="px-3 py-3 text-right">Picked Up</th><th className="px-4 py-3">Pickup Now</th></tr></thead><tbody className="divide-y">{detail.lineItems.map((item) => { const itemName = item.productName || item.description || "Line item"; const available = item.production.readyWaitingQuantity; return <tr key={item.id} data-testid={`pickup-line-${item.id}`}><td className="px-4 py-3 font-semibold">{itemName}</td><td className="px-3 py-3 text-right font-semibold tabular-nums" data-testid={`pickup-ready-${item.id}`}>{available}</td><td className="px-3 py-3 text-right tabular-nums">{item.production.pickedUpQuantity}</td><td className="px-4 py-3">{available > 0 ? <div className="flex items-center gap-2"><input aria-label={`Pickup quantity: ${itemName}`} type="number" min={0} max={available} value={pickupQuantityByLine[item.id] ?? ""} disabled={pickupPending} className="w-24 rounded border px-2 py-1.5 tabular-nums" onChange={(event) => { const parsed = Math.floor(Number(event.target.value)); const quantity = Number.isFinite(parsed) ? Math.max(0, Math.min(available, parsed)) : 0; setPickupQuantityByLine((current) => ({ ...current, [item.id]: quantity })); }} /><button type="button" disabled={pickupPending} className="whitespace-nowrap rounded border px-2 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50" onClick={() => setPickupQuantityByLine((current) => ({ ...current, [item.id]: available }))}>All Ready</button></div> : <span className="text-sm text-muted-foreground">—</span>}</td></tr>; })}</tbody></table></div>
        <div className="flex justify-end border-t px-4 py-3"><button type="button" className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={pickupPending} onClick={() => void completePickup()}>{pickupPending ? "Completing…" : "Complete Pickup"}</button></div>
      </section>
      <section className="rounded-xl border bg-card px-4 py-3"><h2 className="font-bold"><Store className="mr-2 inline h-4 w-4" />Pickup History</h2>{detail.pickupHandoffs.length ? <div className="mt-2 divide-y">{detail.pickupHandoffs.map((handoff) => <div key={handoff.id} className="py-3 text-sm"><p className="font-medium">{new Date(handoff.handedOffAt).toLocaleString()}</p>{handoff.items.map((item) => <p key={`${handoff.id}-${item.orderLineItemId}`}>{item.quantity} {item.productName || item.description || "line item"}</p>)}{handoff.handedOffByName ? <p className="text-muted-foreground">{handoff.handedOffByName}</p> : null}{handoff.notes ? <p className="text-muted-foreground">{handoff.notes}</p> : null}</div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No pickup handoffs recorded.</p>}</section>
    </> : <><section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="font-bold">Items leaving the shop</h2><p className="text-sm text-muted-foreground">{detail.readyWaitingQuantity} units marked ready to ship</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{detail.remainingQuantity} remaining</span></div>
      <div className="divide-y">{detail.lineItems.map((item) => {
        const artwork = item.artwork[0] ?? null;
        const available = item.production.readyWaitingQuantity;
        const itemName = item.productName || item.description || "Line item";
        return <article key={item.id} className="grid gap-3 p-4 md:grid-cols-[56px_minmax(0,1fr)_minmax(210px,auto)] md:items-center"><button type="button" className="h-14 w-14 overflow-hidden rounded border bg-muted disabled:cursor-default" disabled={!artwork?.fileRecordId} title={artwork?.fileRecordId ? `Preview ${artwork.fileName}` : artwork ? `${artwork.fileName} has no preview available` : "No artwork attached"} onClick={() => void previewArtwork(artwork?.fileRecordId ?? null, artwork?.mimeType ?? null, artwork?.fileName ?? "artwork")}><AuthenticatedArtworkThumbnail fileRecordId={artwork?.fileRecordId} alt="" className="h-full w-full object-cover" fallback={<span className="flex h-full w-full items-center justify-center text-muted-foreground"><FileImage className="h-5 w-5" /></span>} /></button><div className="min-w-0"><p className="font-semibold">{itemName}</p><p className="text-sm text-muted-foreground">Ordered {item.production.orderedQuantity} · Produced {item.production.productionCompleteQuantity} · Shipped {item.production.shippedQuantity} · Available {available}</p></div><div className="text-sm md:text-right"><p className="font-medium">{available ? `${available} available to ship` : "Waiting"}</p><p className="text-muted-foreground">{available ? "Shipping uses the same produced-quantity cap." : item.production.label}</p></div></article>;
      })}</div>
    </section><section className="space-y-3"><div className="rounded-xl border bg-card p-4"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipping</h2><p className="mt-1 text-sm text-muted-foreground">{shipmentId ? "Ready quantities are packed into the default package. Split only when multiple packages are needed." : canStartFulfillment ? "Start a shipment when at least one item is marked ready." : "Mark a quantity ready before shipping."}</p></div>
      {shipmentId && <FulfillmentShipmentEditor shipmentId={shipmentId} embedded onMutationComplete={() => detailQuery.refetch()} />}
      {workspaceMode.combinedShipments.map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><div><p className="font-semibold">Included in combined shipment {shipment.shipmentReference || shipment.id} · {shipment.status}</p><p className="text-sm text-muted-foreground">Shared by {shipment.orderCount} orders.</p></div><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.shipmentDetail(shipment.id))}>Open Combined Shipment</button></div>)}
    </section></>}
  </main>;
}
