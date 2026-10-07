import { AdministrativeCorrection } from "@/components/fulfillment/AdministrativeCorrection";
import { PickupHistory } from "@/components/fulfillment/PickupHistory";
import type { PickupTravelerHistoryEntry } from "@shared/pickupTravelerProgress";
import { currentLocalPickupDate } from "@shared/pickupEffectiveDate";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, PackagePlus, RefreshCw, Truck } from "lucide-react";
import { useLocation, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FulfillmentShipmentEditor } from "@/pages/fulfillment-shipment-detail";
import { getFulfillmentWorkspaceLoadState } from "@/lib/fulfillmentWorkspaceState";
import { fulfillmentReturnRoute, resolveFulfillmentWorkspaceMode } from "@/lib/fulfillmentWorkspaceMode";
import { buildReferrer, toHref } from "@/lib/nav/smartBack";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import {
  toFulfillmentError,
  useAddFulfillmentNoteMutation,
  useUpdatePickupDetailsMutation,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useMarkOrderReadyForPickupMutation,
  useRecordPickupHandoffMutation,
  useReverseTerminalFulfillmentMutation,
} from "@/hooks/useFulfillment";
import { PickupTravelerPrintDialog } from "@/components/fulfillment/PickupTravelerPrintDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** The order is the operator workspace. Shipment and pickup rows are execution evidence. */
export default function FulfillmentWorkspacePage() {
  const { guardedNavigate: navigate } = useNavigationGuard();
  const location = useLocation();
  const { toast } = useToast();
  const { orderId } = useParams<{ orderId: string }>();
  const detailQuery = useFulfillmentOrderDetailQuery(orderId);
  const updatePickupDetails = useUpdatePickupDetailsMutation(orderId || "");
  const createShipment = useCreateShipmentMutation();
  const createPickupTicket = useCreatePickupTicketMutation();
  const markOrderReadyForPickup = useMarkOrderReadyForPickupMutation(orderId || "");
  const addNote = useAddFulfillmentNoteMutation(orderId || "");
  const recordPickupHandoff = useRecordPickupHandoffMutation(orderId);
  const reverseTerminalFulfillment = useReverseTerminalFulfillmentMutation(orderId);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const [pickupQuantityByLine, setPickupQuantityByLine] = useState<Record<string, number>>({});
  const [pickupDate, setPickupDate] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [note, setNote] = useState("");
  const [pickupRequestId, setPickupRequestId] = useState<string | null>(null);
  const [selectedTravelerIds, setSelectedTravelerIds] = useState<string[]>([]);
  const [reprintTraveler, setReprintTraveler] = useState<PickupTravelerHistoryEntry | null>(null);
  const [pickupTravelerOpen, setPickupTravelerOpen] = useState(false);
  const [pickupReversal, setPickupReversal] = useState<{ handoffId: string; items: Array<{ orderLineItemId: string; quantity: number; label: string }> } | null>(null);
  const [pickupReversalReason, setPickupReversalReason] = useState("");
  const [pickupReversalQuantities, setPickupReversalQuantities] = useState<Record<string, number>>({});
  const [pickupReversalConfirmed, setPickupReversalConfirmed] = useState(false);
  const detail = detailQuery.data;
  const selectedPickupDate = pickupDate || detail?.operationalPickupDate || currentLocalPickupDate();
  const queryError = detailQuery.isError ? toFulfillmentError(detailQuery.error) : null;
  const loadState = getFulfillmentWorkspaceLoadState({ orderId, isLoading: detailQuery.isLoading, isError: detailQuery.isError, errorStatus: queryError?.status, hasDetail: !!detail });
  useEffect(() => { setCreatedShipmentId(null); }, [orderId]);

  if (detailQuery.isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading fulfillment workspace…</main>;
  if (loadState === "not_found") return <main className="p-8 text-sm text-muted-foreground">Fulfillment workspace not found.</main>;
  if (loadState === "error") return <main className="space-y-3 p-8"><h1 className="text-lg font-semibold">Could not load fulfillment workspace</h1><p className="text-sm text-muted-foreground">{queryError?.message || "An unexpected error occurred."}</p><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-1 inline h-4 w-4" />Retry</button></main>;
  if (!detail || !orderId) return null;

  const workspaceMode = resolveFulfillmentWorkspaceMode(detail);
  const isPickup = workspaceMode.mode === "pickup";
  const methodLabel = detail.fulfillmentMethod === "deliver" ? "Delivery" : isPickup ? "Pickup" : "Shipping";
  const singleDrafts = workspaceMode.historicalDrafts.filter(shipment => shipment.scope === "SINGLE_ORDER" && shipment.orderCount === 1);
  const shipmentId = singleDrafts.find(shipment => shipment.id === createdShipmentId)?.id ?? workspaceMode.singleDraftShipmentId;
  const shipmentHistory = detail.shipments.filter((shipment) => shipment.status !== "DRAFT");
  const pickupPending = recordPickupHandoff.isPending || createPickupTicket.isPending;
  const pickupTravelerLines = detail.lineItems.flatMap((item) => {
    const quantity = Math.floor(Number(pickupQuantityByLine[item.id] || 0));
    return quantity > 0 ? [{ orderLineItemId: item.id, description: item.productName || item.description || "Line item", quantity }] : [];
  });
  const fulfillmentNotes = detail.events.filter((event) => event.eventType === "FULFILLMENT_NOTE");
  const orderRoute = fulfillmentReturnRoute(location.state?.referrer, [ROUTES.orders.detail(orderId), ROUTES.orders.edit(orderId)]);
  const returnRoute = orderRoute ?? fulfillmentReturnRoute(location.state?.referrer, [ROUTES.fulfillment.list]);
  const openOrder = (timeline = false) => {
    const target = orderRoute ?? { pathname: ROUTES.orders.detail(orderId), search: "", hash: "" };
    const search = new URLSearchParams(target.search);
    if (timeline) search.set("panel", "timeline");
    navigate(timeline ? toHref({ ...target, search: `?${search.toString()}` }) : toHref(target), { state: orderRoute ? location.state?.orderReturnState : { referrer: buildReferrer(location), referrerState: location.state } });
  };
  const openShipment = (id: string) => navigate(ROUTES.fulfillment.shipmentDetail(id), { state: { referrer: buildReferrer(location), referrerState: location.state } });

  const showError = (title: string, error: unknown) => toast({ title, description: toFulfillmentError(error).message, variant: "destructive" });
  const bounded = (value: string, max: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
  };
  const startShipment = async () => {
    if (isPickup || singleDrafts.length) return;
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
      await recordPickupHandoff.mutateAsync({ ticketId, items, clientRequestId, effectivePickupDate: selectedPickupDate, notes: pickupNote.trim() || null, ...(selectedTravelerIds.length ? { travelerJobIds: selectedTravelerIds } : {}) });
      setSelectedTravelerIds([]);
      setPickupQuantityByLine({});
      setPickupDate("");
      setPickupNote("");
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

  const openPickupReversal = (handoff: NonNullable<typeof detail>["pickupHandoffs"][number]) => {
    const items = handoff.items.map((item) => ({ orderLineItemId: item.orderLineItemId, quantity: handoff.remainingByLine?.[item.orderLineItemId] ?? item.quantity, label: item.productName || item.description || "line item" }));
    setPickupReversal({ handoffId: handoff.id, items });
    setPickupReversalQuantities(Object.fromEntries(items.map((item) => [item.orderLineItemId, item.quantity])));
    setPickupReversalReason("");
    setPickupReversalConfirmed(false);
  };

  const submitPickupReversal = async () => {
    if (!pickupReversal || !pickupReversalConfirmed || !pickupReversalReason.trim()) return;
    const items = pickupReversal.items.flatMap((item) => {
      const quantity = Math.floor(Number(pickupReversalQuantities[item.orderLineItemId] || 0));
      return quantity > 0 ? [{ orderLineItemId: item.orderLineItemId, quantity }] : [];
    });
    if (!items.length) return showError("No pickup quantity selected", new Error("Enter at least one quantity to reverse."));
    try {
      await reverseTerminalFulfillment.mutateAsync({ sourceType: "PICKUP_HANDOFF", sourceId: pickupReversal.handoffId, items, reason: pickupReversalReason.trim(), clientRequestId: crypto.randomUUID() });
      toast({ title: "Pickup reversal recorded", description: "The original pickup history remains; the selected quantity is available for fulfillment again." });
      setPickupReversal(null);
    } catch (error) {
      showError("Pickup reversal failed", error);
      await detailQuery.refetch();
    }
  };

  return <main className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(returnRoute ? toHref(returnRoute) : ROUTES.fulfillment.list, { state: orderRoute ? location.state?.orderReturnState : returnRoute ? location.state?.referrerState : undefined })}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1>
        <p className="text-sm text-muted-foreground">{detail.customer.name} · <span className="font-semibold">{methodLabel}</span>{isPickup ? "" : ` · ${detail.shipTo}`}</p>
      </div></div>
      <div className="flex flex-wrap items-center gap-2">{isPickup && detail.pickupTicket?.status === "READY_FOR_PICKUP" && <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold">Ready for Pickup</span>}<button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => openOrder()}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => openOrder(true)}>View Order Timeline</button>
        {isPickup && detail.pickupTicket?.status !== "READY_FOR_PICKUP" && detail.remainingQuantity > 0 && <button disabled={markOrderReadyForPickup.isPending} className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50" onClick={() => void markOrderReady()}>{markOrderReadyForPickup.isPending ? "Marking…" : "Mark Order Ready for Pickup"}</button>}
        {!isPickup && !singleDrafts.length && <button disabled={createShipment.isPending || detail.remainingQuantity <= 0} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void startShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{createShipment.isPending ? "Starting…" : "Start shipment"}</button>}
      </div>
    </header>

    {(!shipmentId || isPickup) && <section className="rounded-xl border bg-card" data-testid="fulfillment-line-items">
      <div className="border-b px-4 py-3"><h2 className="font-bold">Fulfillment line items</h2><p className="text-sm text-muted-foreground">Record what physically left. Production reports are informational only.</p></div>
      <div className="divide-y">{detail.lineItems.map((item) => {
        const itemName = item.productName || item.description || "Line item";
        const { orderedQuantity, pickedUpQuantity, shippedQuantity, remainingQuantity, productionCompleteQuantity } = item.production;
        const fulfilledQuantity = pickedUpQuantity + shippedQuantity;
        const isComplete = remainingQuantity <= 0;
        const pickupQuantity = pickupQuantityByLine[item.id] ?? "";
        return <article key={item.id} data-testid={`fulfillment-line-${item.id}`} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{itemName}</h3><p className="mt-1 text-sm text-muted-foreground">Ordered {orderedQuantity} · Physically fulfilled {fulfilledQuantity} · Administratively resolved {item.production.administrativelyReconciledQuantity ?? 0} · Remaining {remainingQuantity}</p><p className="mt-1 text-xs text-muted-foreground">Production reports: {productionCompleteQuantity}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{(item.production.administrativelyReconciledQuantity ?? 0) > 0 ? "Administratively Resolved" : detail.administrativeCorrection?.mode === "legacy" ? "Legacy Completion" : isComplete ? "Physically Fulfilled" : `${remainingQuantity} remaining`}</span></div>
          {!isComplete && isPickup && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm font-medium">Picked up now<Input aria-label={`Pickup quantity: ${itemName}`} type="number" min={0} max={remainingQuantity} value={pickupQuantity} disabled={pickupPending} className="w-28 tabular-nums" onChange={(event) => setPickupQuantityByLine((current) => ({ ...current, [item.id]: bounded(event.target.value, remainingQuantity) }))} /></label><button type="button" disabled={pickupPending} className="rounded border px-3 py-1.5 text-sm font-semibold hover:bg-muted disabled:opacity-50" onClick={() => setPickupQuantityByLine((current) => ({ ...current, [item.id]: remainingQuantity }))}>All Remaining</button></div>}
        </article>;
      })}</div>
      {isPickup && detail.remainingQuantity > 0 && <div className="grid gap-3 border-t px-4 py-3 sm:grid-cols-[180px_1fr]">
        <label className="grid gap-1 text-sm font-medium">Pickup date<Input type="date" aria-label="Pickup date" value={selectedPickupDate} max={detail.operationalPickupDate || currentLocalPickupDate()} disabled={pickupPending} onChange={event => setPickupDate(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">Pickup note <span className="sr-only">(optional)</span><Textarea aria-label="Pickup note" value={pickupNote} maxLength={2000} className="min-h-10" placeholder="Optional note for this pickup" disabled={pickupPending} onChange={event => setPickupNote(event.target.value)} /></label>
      </div>}
      {isPickup && detail.remainingQuantity > 0 && <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3"><button type="button" disabled={pickupPending || !pickupTravelerLines.length} className="rounded border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50" onClick={() => { setReprintTraveler(null); setPickupTravelerOpen(true); }}>Print Pickup Travelers</button><button type="button" disabled={pickupPending || !selectedPickupDate} className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void completePickup()}>{pickupPending ? "Completing…" : "Complete Pickup"}</button></div>}
    </section>}

    <PickupTravelerPrintDialog orderId={orderId} lines={pickupTravelerLines} open={pickupTravelerOpen} onOpenChange={setPickupTravelerOpen} reprint={reprintTraveler} onQueued={(id) => { setSelectedTravelerIds(ids => [...ids, id]); void detailQuery.refetch(); }} />

    {!isPickup && <section className="space-y-3">{singleDrafts.length > 1 && <div className="rounded-xl border bg-card p-4"><h2 className="font-bold">Choose a saved draft shipment</h2><div className="mt-3 flex flex-wrap gap-2">{singleDrafts.map(shipment => <button key={shipment.id} type="button" aria-pressed={shipmentId === shipment.id} className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted aria-pressed:border-primary" onClick={() => setCreatedShipmentId(shipment.id)}>{shipment.shipmentReference || shipment.id}</button>)}</div></div>}{!shipmentId && !singleDrafts.length && <div className="rounded-xl border bg-card p-4"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipping</h2><p className="mt-1 text-sm text-muted-foreground">Start a shipment to record what physically leaves the shop.</p></div>}{shipmentId && <FulfillmentShipmentEditor key={shipmentId} shipmentId={shipmentId} embedded onMutationComplete={async () => { await detailQuery.refetch(); }} />}{workspaceMode.combinedShipments.filter((shipment) => shipment.status === "DRAFT").map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><div><p className="font-semibold">Included in combined shipment {shipment.shipmentReference || shipment.id} · {shipment.status}</p><p className="text-sm text-muted-foreground">Shared by {shipment.orderCount} orders.</p></div><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => openShipment(shipment.id)}>Open Combined Shipment</button></div>)}</section>}

    <details className="rounded-xl border bg-card p-4" data-testid="fulfillment-order-notes" open={fulfillmentNotes.length > 0 || !!note || undefined}><summary className="cursor-pointer font-bold">Order Notes{fulfillmentNotes.length ? ` (${fulfillmentNotes.length})` : ""}</summary><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Textarea aria-label="Order note" value={note} maxLength={2000} className="min-h-20 flex-1" placeholder="Add an internal note for the fulfillment team" onChange={(event) => setNote(event.target.value)} /><button type="button" disabled={!note.trim() || addNote.isPending} className="h-fit rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void submitNote()}>{addNote.isPending ? "Adding…" : "Add note"}</button></div>{fulfillmentNotes.length > 0 ? <div className="mt-3 divide-y">{fulfillmentNotes.map((event) => <div key={event.id} className="py-3 text-sm"><p className="whitespace-pre-wrap break-words">{String(event.payloadJson?.note || "")}</p><p className="mt-1 text-xs text-muted-foreground">{event.actorName || "Staff"} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No fulfillment notes yet.</p>}</details>

    {shipmentHistory.length > 0 && <section className="rounded-xl border bg-card p-4">
      <h2 className="font-bold">Shipment History</h2>
      <p className="mt-1 text-sm text-muted-foreground">Open a shipment to review its evidence. Owners and Admins can reverse shipped quantities with a reason; the original record is preserved.</p>
      {shipmentHistory.map((shipment) => <div key={shipment.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div><p className="text-sm font-semibold">{shipment.shipmentReference || shipment.id} · {shipment.status}</p>{shipment.shippedAt && <p className="text-xs text-muted-foreground">Shipped {new Date(shipment.shippedAt).toLocaleString()}</p>}</div>
        <button type="button" className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => openShipment(shipment.id)}>View shipment / corrections</button>
      </div>)}
    </section>}

    <PickupHistory key={orderId} onSaveDetails={(handoffId, changes) => updatePickupDetails.mutateAsync({ handoffId, ...changes })} detail={detail} selectedTravelerIds={selectedTravelerIds}
      onToggle={(id, selected) => setSelectedTravelerIds(ids => selected ? [...ids, id] : ids.filter(value => value !== id))}
      onReprint={traveler => { setReprintTraveler(traveler); setPickupTravelerOpen(true); }} onReverse={openPickupReversal} />

    {detail.administrativeCorrection && <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold text-muted-foreground">Exceptional actions</summary><div className="mt-3"><AdministrativeCorrection key={orderId} detail={detail} /></div></details>}

    <AlertDialog open={!!pickupReversal} onOpenChange={(open) => !open && setPickupReversal(null)}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Reverse Pickup</AlertDialogTitle><AlertDialogDescription>Original pickup history will be retained. The selected quantity will reopen for fulfillment. Invoice and payment records are not changed.</AlertDialogDescription></AlertDialogHeader>
        <div className="space-y-3">{pickupReversal?.items.map((item) => <label key={item.orderLineItemId} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0">{item.label} <span className="text-muted-foreground">(available to reverse: {item.quantity})</span></span><Input type="number" min={0} max={item.quantity} className="w-24" value={pickupReversalQuantities[item.orderLineItemId] ?? 0} onChange={(event) => setPickupReversalQuantities((current) => ({ ...current, [item.orderLineItemId]: bounded(event.target.value, item.quantity) }))} /></label>)}<Textarea aria-label="Pickup reversal reason" value={pickupReversalReason} onChange={(event) => setPickupReversalReason(event.target.value)} placeholder="Reason for correction" /><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={pickupReversalConfirmed} onChange={(event) => setPickupReversalConfirmed(event.target.checked)} /><span>I understand this reopens fulfillment quantity without deleting the original pickup evidence.</span></label></div>
        <AlertDialogFooter><AlertDialogCancel disabled={reverseTerminalFulfillment.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={!pickupReversalReason.trim() || !pickupReversalConfirmed || reverseTerminalFulfillment.isPending} onClick={(event) => { event.preventDefault(); void submitPickupReversal(); }}>{reverseTerminalFulfillment.isPending ? "Reversing…" : "Reverse Pickup"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
