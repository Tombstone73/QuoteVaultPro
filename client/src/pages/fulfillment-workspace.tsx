import { useState } from "react";
import { ArrowLeft, ExternalLink, PackagePlus, RefreshCw, Store, Truck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FulfillmentShipmentEditor } from "@/pages/fulfillment-shipment-detail";
import { getFulfillmentWorkspaceLoadState } from "@/lib/fulfillmentWorkspaceState";
import { resolveFulfillmentWorkspaceMode } from "@/lib/fulfillmentWorkspaceMode";
import {
  toFulfillmentError,
  useAddFulfillmentNoteMutation,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useMarkOrderReadyForPickupMutation,
  useRecordPickupHandoffMutation,
} from "@/hooks/useFulfillment";

/** The order is the operator workspace. Shipment and pickup rows are execution evidence. */
export default function FulfillmentWorkspacePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { orderId } = useParams<{ orderId: string }>();
  const detailQuery = useFulfillmentOrderDetailQuery(orderId);
  const createShipment = useCreateShipmentMutation();
  const createPickupTicket = useCreatePickupTicketMutation();
  const markOrderReadyForPickup = useMarkOrderReadyForPickupMutation(orderId);
  const addNote = useAddFulfillmentNoteMutation(orderId);
  const recordPickupHandoff = useRecordPickupHandoffMutation(orderId);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const [pickupQuantityByLine, setPickupQuantityByLine] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [pickupRequestId, setPickupRequestId] = useState<string | null>(null);
  const detail = detailQuery.data;
  const queryError = detailQuery.isError ? toFulfillmentError(detailQuery.error) : null;
  const loadState = getFulfillmentWorkspaceLoadState({ orderId, isLoading: detailQuery.isLoading, isError: detailQuery.isError, errorStatus: queryError?.status, hasDetail: !!detail });

  if (detailQuery.isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading fulfillment workspace…</main>;
  if (loadState === "not_found") return <main className="p-8 text-sm text-muted-foreground">Fulfillment workspace not found.</main>;
  if (loadState === "error") return <main className="space-y-3 p-8"><h1 className="text-lg font-semibold">Could not load fulfillment workspace</h1><p className="text-sm text-muted-foreground">{queryError?.message || "An unexpected error occurred."}</p><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-1 inline h-4 w-4" />Retry</button></main>;
  if (!detail || !orderId) return null;

  const workspaceMode = resolveFulfillmentWorkspaceMode(detail);
  const isPickup = workspaceMode.mode === "pickup";
  const methodLabel = isPickup ? "Pickup" : "Shipping";
  const shipmentId = createdShipmentId || workspaceMode.singleDraftShipmentId;
  const pickupPending = recordPickupHandoff.isPending || createPickupTicket.isPending;
  const fulfillmentNotes = detail.events.filter((event) => event.eventType === "FULFILLMENT_NOTE");

  const showError = (title: string, error: unknown) => toast({ title, description: toFulfillmentError(error).message, variant: "destructive" });
  const bounded = (value: string, max: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
  };
  const startShipment = async () => {
    if (isPickup) return;
    try {
      const created = await createShipment.mutateAsync({ scope: "SINGLE_ORDER", orderIds: [orderId], primaryOrderId: orderId });
      setCreatedShipmentId(created.shipmentId);
      await detailQuery.refetch();
    } catch (error) { showError("Could not start shipment", error); }
  };

  const completePickup = async () => {
    const items = detail.lineItems.flatMap((item) => {
      const quantity = Math.floor(Number(pickupQuantityByLine[item.id] || 0));
      return quantity > 0 ? [{ orderLineItemId: item.id, quantity }] : [];
    });
    if (!items.length) return showError("No pickup quantity entered", new Error("Enter a quantity that physically left with the customer."));
    try {
      let ticketId = detail.pickupTicket?.id;
      if (!ticketId) {
        const ticket = await createPickupTicket.mutateAsync(orderId);
        ticketId = ticket.id;
      }
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

  const markOrderReady = async () => {
    try { await markOrderReadyForPickup.mutateAsync({}); }
    catch (error) { showError("Could not mark order ready for pickup", error); }
  };

  const submitNote = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    try {
      await addNote.mutateAsync(trimmed);
      setNote("");
    } catch (error) { showError("Could not add fulfillment note", error); }
  };

  return <main className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.list)}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1>
        <p className="text-sm text-muted-foreground">{detail.customer.name} · <span className="font-semibold">{methodLabel}</span>{isPickup ? "" : ` · ${detail.shipTo}`}</p>
      </div></div>
      <div className="flex flex-wrap items-center gap-2">{isPickup && detail.pickupTicket?.status === "READY_FOR_PICKUP" && <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold">Ready for Pickup</span>}<button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.orders.detail(orderId))}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button>
        {isPickup && detail.pickupTicket?.status !== "READY_FOR_PICKUP" && detail.remainingQuantity > 0 && <button disabled={markOrderReadyForPickup.isPending} className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50" onClick={() => void markOrderReady()}>{markOrderReadyForPickup.isPending ? "Marking…" : "Mark Order Ready for Pickup"}</button>}
        {!isPickup && !shipmentId && <button disabled={createShipment.isPending || detail.remainingQuantity <= 0} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void startShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{createShipment.isPending ? "Starting…" : "Start shipment"}</button>}
      </div>
    </header>

    <section className="rounded-xl border bg-card" data-testid="fulfillment-line-items">
      <div className="border-b px-4 py-3"><h2 className="font-bold">Fulfillment line items</h2><p className="text-sm text-muted-foreground">Record what physically left. Production reports are informational only.</p></div>
      <div className="divide-y">{detail.lineItems.map((item) => {
        const itemName = item.productName || item.description || "Line item";
        const { orderedQuantity, pickedUpQuantity, shippedQuantity, remainingQuantity, productionCompleteQuantity } = item.production;
        const fulfilledQuantity = isPickup ? pickedUpQuantity : shippedQuantity;
        const isComplete = remainingQuantity <= 0;
        const pickupQuantity = pickupQuantityByLine[item.id] ?? "";
        return <article key={item.id} data-testid={`fulfillment-line-${item.id}`} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{itemName}</h3><p className="mt-1 text-sm text-muted-foreground">Ordered {orderedQuantity} · {isPickup ? "Picked up" : "Shipped"} {fulfilledQuantity} · Remaining {remainingQuantity}</p><p className="mt-1 text-xs text-muted-foreground">Production reports: {productionCompleteQuantity}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{isComplete ? "Completed" : `${remainingQuantity} remaining`}</span></div>
          {!isComplete && isPickup && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm font-medium">Picked up now<Input aria-label={`Pickup quantity: ${itemName}`} type="number" min={0} max={remainingQuantity} value={pickupQuantity} disabled={pickupPending} className="w-28 tabular-nums" onChange={(event) => setPickupQuantityByLine((current) => ({ ...current, [item.id]: bounded(event.target.value, remainingQuantity) }))} /></label><button type="button" disabled={pickupPending} className="rounded border px-3 py-1.5 text-sm font-semibold hover:bg-muted disabled:opacity-50" onClick={() => setPickupQuantityByLine((current) => ({ ...current, [item.id]: remainingQuantity }))}>All Remaining</button></div>}
        </article>;
      })}</div>
      {isPickup && detail.remainingQuantity > 0 && <div className="flex justify-end border-t px-4 py-3"><button type="button" disabled={pickupPending} className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void completePickup()}>{pickupPending ? "Completing…" : "Complete Pickup"}</button></div>}
    </section>

    {!isPickup && <section className="space-y-3"><div className="rounded-xl border bg-card p-4"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipping</h2><p className="mt-1 text-sm text-muted-foreground">{shipmentId ? "Allocate what is leaving in the shipment package." : "Start a shipment to record what physically leaves the shop."}</p></div>{shipmentId && <FulfillmentShipmentEditor shipmentId={shipmentId} embedded onMutationComplete={() => detailQuery.refetch()} />}{workspaceMode.combinedShipments.map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><div><p className="font-semibold">Included in combined shipment {shipment.shipmentReference || shipment.id} · {shipment.status}</p><p className="text-sm text-muted-foreground">Shared by {shipment.orderCount} orders.</p></div><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.shipmentDetail(shipment.id))}>Open Combined Shipment</button></div>)}</section>}

    <section className="rounded-xl border bg-card p-4" data-testid="fulfillment-order-notes"><h2 className="font-bold">Order Notes</h2><p className="mt-1 text-sm text-muted-foreground">Internal fulfillment notes. They do not change fulfillment quantities or status.</p><div className="mt-3 flex gap-2"><Textarea aria-label="Order note" value={note} maxLength={2000} className="min-h-20 flex-1" placeholder="Add a note for the fulfillment team" onChange={(event) => setNote(event.target.value)} /><button type="button" disabled={!note.trim() || addNote.isPending} className="h-fit rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void submitNote()}>{addNote.isPending ? "Adding…" : "Add note"}</button></div>{fulfillmentNotes.length > 0 ? <div className="mt-3 divide-y">{fulfillmentNotes.map((event) => <div key={event.id} className="py-3 text-sm"><p>{String(event.payloadJson?.note || "")}</p><p className="mt-1 text-xs text-muted-foreground">{event.actorName || "Staff"} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No fulfillment notes yet.</p>}</section>

    {isPickup && <section className="rounded-xl border bg-card px-4 py-3" data-testid="pickup-history"><h2 className="font-bold"><Store className="mr-2 inline h-4 w-4" />Pickup History</h2>{detail.pickupHandoffs.length ? <div className="mt-2 divide-y">{detail.pickupHandoffs.map((handoff) => <div key={handoff.id} className="py-3 text-sm"><p className="font-medium">{new Date(handoff.handedOffAt).toLocaleString()}</p>{handoff.items.map((item) => <p key={`${handoff.id}-${item.orderLineItemId}`}>{item.quantity} {item.productName || item.description || "line item"}</p>)}{handoff.handedOffByName && <p className="text-muted-foreground">{handoff.handedOffByName}</p>}{handoff.notes && <p className="text-muted-foreground">{handoff.notes}</p>}</div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No pickup handoffs recorded.</p>}</section>}
  </main>;
}
