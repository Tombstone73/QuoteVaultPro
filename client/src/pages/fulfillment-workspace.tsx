import { ArrowLeft, CheckSquare, ExternalLink, PackagePlus, RefreshCw, Truck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { getFulfillmentWorkspaceLoadState } from "@/lib/fulfillmentWorkspaceState";
import {
  toFulfillmentError,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useUpdateFulfillmentChecklistItemMutation,
} from "@/hooks/useFulfillment";

/** A normal page, deliberately not the former scrollable detail drawer. */
export default function FulfillmentWorkspacePage() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const detailQuery = useFulfillmentOrderDetailQuery(orderId);
  const updateChecklist = useUpdateFulfillmentChecklistItemMutation(orderId || "");
  const createShipment = useCreateShipmentMutation();
  const createPickup = useCreatePickupTicketMutation();
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
  if (loadState === 'not_found') return <main className="p-8 text-sm text-muted-foreground">Fulfillment workspace not found.</main>;
  if (loadState === 'error') return <main className="space-y-3 p-8"><h1 className="text-lg font-semibold">Could not load fulfillment workspace</h1><p className="text-sm text-muted-foreground">{queryError?.message || 'An unexpected error occurred.'}</p><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-1 inline h-4 w-4" />Retry</button></main>;
  if (!detail || !orderId) return null;

  const canStartFulfillment = detail.status !== 'AWAITING_PRODUCTION';

  const openShipment = async () => {
    if (!canStartFulfillment) return;
    const existing = detail.shipments.find((shipment) => shipment.status === "DRAFT");
    if (existing) return navigate(ROUTES.fulfillment.shipmentDetail(existing.id));
    if (detail.fulfillmentType === "PICKUP") {
      await createPickup.mutateAsync(orderId);
      return detailQuery.refetch();
    }
    const created = await createShipment.mutateAsync({ scope: "SINGLE_ORDER", orderIds: [orderId], primaryOrderId: orderId });
    navigate(ROUTES.fulfillment.shipmentDetail(created.shipmentId));
  };

  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="flex gap-3"><button aria-label="Back to fulfillment" className="rounded p-2 hover:bg-muted" onClick={() => navigate(ROUTES.fulfillment.list)}><ArrowLeft className="h-5 w-5" /></button><div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment workspace</p>
        <h1 className="text-2xl font-bold">Order #{detail.orderNumber}</h1><p className="text-sm text-muted-foreground">{detail.customer.name} · {detail.fulfillmentType === "SHIP" ? detail.shipTo : "Pickup"}</p>
      </div></div>
      <div className="flex gap-2"><button className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(ROUTES.orders.detail(orderId))}><ExternalLink className="mr-1 inline h-4 w-4" />Open Order</button><button disabled={!canStartFulfillment} title={canStartFulfillment ? undefined : 'Production must be complete before fulfillment can begin.'} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void openShipment()}><PackagePlus className="mr-1 inline h-4 w-4" />{canStartFulfillment ? (detail.fulfillmentType === "SHIP" ? "Pack / ship" : "Open pickup") : "Awaiting production"}</button></div>
    </header>
    <section className="rounded-xl border bg-card"><div className="border-b p-5"><h2 className="font-bold">Production readiness and fulfillment verification</h2><p className="text-sm text-muted-foreground">{detail.checklistSummary.checked} of {detail.checklistSummary.total} items independently verified.</p></div><div className="divide-y">
      {detail.lineItems.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-4 p-5"><input aria-label={`Verify ${item.productName || item.description || "line item"}`} type="checkbox" checked={item.checklist.checked} onChange={(event) => updateChecklist.mutate({ lineItemId: item.id, checked: event.target.checked })} className="h-5 w-5" /><div className="min-w-[220px] flex-1"><p className="font-semibold">{item.productName || item.description || "Line item"}</p><p className="text-sm text-muted-foreground">Ordered {item.quantity ?? 0} · {item.size || "Configured to order"}</p></div><div className="text-sm"><span className="font-medium">{item.production.completedAt ? "Production complete" : "Production status"}</span><p className="text-muted-foreground">{item.production.status || "Awaiting production"}</p></div>{item.artwork[0]?.previewUrl ? <a className="text-sm font-semibold text-primary" href={item.artwork[0].previewUrl} target="_blank" rel="noreferrer">Artwork</a> : null}</article>)}
    </div></section>
    <section className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border bg-card p-5"><h2 className="font-bold"><CheckSquare className="mr-2 inline h-4 w-4" />Verification</h2><p className="mt-2 text-sm text-muted-foreground">Use the checklist here in strict organizations. Packing and shipment allocation are available without returning to the fulfillment list.</p></div><div className="rounded-xl border bg-card p-5"><h2 className="font-bold"><Truck className="mr-2 inline h-4 w-4" />Shipment / pickup</h2>{detail.shipments.length ? <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{detail.shipments.map((shipment) => <li key={shipment.id}>{shipment.shipmentReference || "Shipment"} · {shipment.status} · {shipment.packages.length} package{shipment.packages.length === 1 ? "" : "s"}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{detail.status === "AWAITING_PRODUCTION" ? "Awaiting production before shipment can be created." : "No shipment created yet."}</p>}</div></section>
  </main>;
}
