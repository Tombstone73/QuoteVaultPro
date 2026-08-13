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
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useMarkOrderReadyForPickupMutation,
  useMarkPickupPickedUpMutation,
  useUpdateFulfillmentChecklistItemMutation,
} from "@/hooks/useFulfillment";

/** The Order is the workspace identity. Shipment and pickup records are child execution state. */
export default function FulfillmentWorkspacePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const canStartFulfillment = detail.eligibleQuantity > 0;
  const canReadyPickup = detail.remainingQuantity > 0 && detail.blockedQuantity === 0 && detail.checklistComplete;
  const shipmentId = createdShipmentId || workspaceMode.singleDraftShipmentId;
  const readyLineCount = detail.lineItems.filter((item) => item.production.eligible).length;
  const readyQuantity = detail.lineItems.reduce((total, item) => total + item.production.eligibleQuantity, 0);

  const showError = (title: string, error: unknown) => {
    toast({ title, description: toFulfillmentError(error).message, variant: "destructive" });
  };

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

  const togglePhysicalPresence = async (lineItemId: string, checked: boolean) => {
    try {
      await updateChecklist.mutateAsync({ lineItemId, checked });
    } catch (error) {
      showError("Could not update item", error);
    }
  };

  const previewArtwork = async (fileRecordId: string | null, mimeType: string | null, fileName: string) => {
    if (!fileRecordId) return;
    try {
      await openArtworkPreview(fileRecordId, mimeType);
    } catch (error) {
      showError(`Could not open ${fileName}`, error);
    }
  };

  return <main className="w-full space-y-4 p-4 md:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.list)}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1><p className="text-sm text-muted-foreground">{detail.customer.name} · <span className="font-semibold">{isPickup ? "Pickup" : "Shipping"}</span>{isPickup ? "" : ` · ${detail.shipTo}`}</p>
      </div></div>
      <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.orders.detail(orderId))}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button>
        {!isPickup && !shipmentId && <button disabled={!canStartFulfillment || createShipment.isPending} title={canStartFulfillment ? undefined : "No produced quantity is available yet."} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void startShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{createShipment.isPending ? "Starting…" : "Start shipment"}</button>}
      </div>
    </header>

    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><h2 className="font-bold">Items leaving the shop</h2><p className="text-sm text-muted-foreground">{readyLineCount} of {detail.lineItems.length} line items ready · {readyQuantity} units available</p></div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{detail.checklistSummary.checked} physically present</span>
      </div>
      <div className="divide-y">
        {detail.lineItems.map((item) => {
          const artwork = item.artwork[0] ?? null;
          const enabled = item.production.eligible;
          const itemName = item.productName || item.description || "Line item";
          return <article key={item.id} className="grid gap-3 p-4 md:grid-cols-[auto_56px_minmax(0,1fr)_minmax(170px,auto)] md:items-center">
            <input aria-label={`Physically present: ${itemName}`} type="checkbox" checked={item.checklist.checked} disabled={!enabled || updateChecklist.isPending} onChange={(event) => void togglePhysicalPresence(item.id, event.target.checked)} className="mt-1 h-5 w-5 disabled:cursor-not-allowed" />
            <button type="button" className="h-14 w-14 overflow-hidden rounded border bg-muted disabled:cursor-default" disabled={!artwork?.fileRecordId} title={artwork?.fileRecordId ? `Preview ${artwork.fileName}` : artwork ? `${artwork.fileName} has no preview available` : "No artwork attached"} onClick={() => void previewArtwork(artwork?.fileRecordId ?? null, artwork?.mimeType ?? null, artwork?.fileName ?? "artwork")}>
              <AuthenticatedArtworkThumbnail fileRecordId={artwork?.fileRecordId} alt="" className="h-full w-full object-cover" fallback={<span className="flex h-full w-full items-center justify-center text-muted-foreground"><FileImage className="h-5 w-5" /></span>} />
            </button>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{itemName}</p><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${enabled ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{enabled ? "Ready" : "Locked"}</span>{item.checklist.checked ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Present</span> : null}</div><p className="text-sm text-muted-foreground">Ordered {item.production.orderedQuantity} · Ready {item.production.eligibleQuantity} · Shipped {item.production.shippedQuantity}{item.production.blockedQuantity > 0 ? ` · ${item.production.blockedQuantity} still in production` : ""}</p>{artwork ? <button type="button" className="mt-1 text-xs font-semibold text-primary hover:underline" disabled={!artwork.fileRecordId} onClick={() => void previewArtwork(artwork.fileRecordId, artwork.mimeType, artwork.fileName)}>{artwork.fileName}</button> : <p className="mt-1 text-xs text-muted-foreground">No artwork attached</p>}</div>
            <div className="text-sm md:text-right"><p className="font-medium">{enabled ? "Physically present?" : "Unavailable"}</p><p className="text-muted-foreground">{enabled ? "Select when it is at handoff." : item.production.label}</p></div>
          </article>;
        })}
      </div>
    </section>

    {isPickup ? <section className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold"><Store className="mr-2 inline h-4 w-4" />Pickup</h2><p className="mt-1 text-sm text-muted-foreground">{detail.pickupTicket?.status === "PICKED_UP" ? "Customer pickup is complete." : detail.pickupTicket?.status === "READY_FOR_PICKUP" ? "All required goods are ready for customer pickup." : canReadyPickup ? "All physical items are present and ready for handoff." : "Complete production and select each physical item before pickup can be readied."}</p></div><div className="flex flex-wrap gap-2">
      {detail.pickupTicket?.status === "READY_FOR_PICKUP" && <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={markPickedUp.isPending} onClick={() => void markPickedUp.mutateAsync().catch((error) => showError("Could not complete pickup", error))}>{markPickedUp.isPending ? "Marking…" : "Mark Picked Up"}</button>}
      {!detail.pickupTicket || detail.pickupTicket.status === "DRAFT" ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!canReadyPickup || readyForPickup.isPending} onClick={() => void readyForPickup.mutateAsync({}).catch((error) => showError("Could not ready pickup", error))}>{readyForPickup.isPending ? "Marking…" : "Mark Ready for Pickup"}</button> : null}
    </div></div></section> : <section className="space-y-3"><div className="rounded-xl border bg-card p-4"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipping</h2><p className="mt-1 text-sm text-muted-foreground">{shipmentId ? "Selected physically present quantities are packed into the default package. Split only when multiple packages are needed." : canStartFulfillment ? "Start a shipment when at least one produced item is ready to pack." : "No produced quantity is available to ship yet."}</p></div>
      {shipmentId && <FulfillmentShipmentEditor shipmentId={shipmentId} embedded onMutationComplete={() => detailQuery.refetch()} />}
      {workspaceMode.combinedShipments.map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><div><p className="font-semibold">Included in combined shipment {shipment.shipmentReference || shipment.id} · {shipment.status}</p><p className="text-sm text-muted-foreground">Shared by {shipment.orderCount} orders.</p></div><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.shipmentDetail(shipment.id))}>Open Combined Shipment</button></div>)}
    </section>}
  </main>;
}
