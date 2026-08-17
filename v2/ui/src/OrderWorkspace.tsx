import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { artworkApi, invoiceApi, money, newBusinessRequestId, orderApi, type ApiError, type ArtworkOrderProjection, type OrderRead, type OrderResult } from "./api";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { clearContactForCustomerChange, draftFromQuoteLine, emptyQuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import { quoteFormKeys, salesKeys, useQuoteFormContacts, useQuoteFormCustomers, useQuoteFormProducts } from "./quoteFormQueries";
import { DraftInvoiceSummary, LifecycleBadge, RouteSummary, SalesTotals } from "./SalesDocumentParts";
import { SelectionField } from "./SelectionField";

const message = (error: unknown): string => {
  const value = error as ApiError;
  if (value?.code === "STALE_STATE") return "This Order changed elsewhere. Current state is refreshing; review your draft before saving.";
  if (value?.code === "FORBIDDEN") return "You do not have permission for that Order action.";
  if (value?.code === "CONFLICT") return value.message || "This commercial action is no longer available.";
  return value?.message ?? "The Order service is unavailable.";
};

export const OrderWorkspace = (props: Readonly<{
  organizationId: string; sessionScope: string; orderId: string; canEdit: boolean; canOverridePrice: boolean; canViewInvoice: boolean; csrfReady: boolean;
  onBack: () => void; openCustomer?: (customerId: string) => void; openFulfillment?: (orderId: string) => void;
}>) => {
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: salesKeys.order(props.sessionScope, props.organizationId, props.orderId), queryFn: () => orderApi.get(props.organizationId, props.orderId), enabled: Boolean(props.organizationId && props.sessionScope && props.orderId) });
  const current = order.data;
  const [notice, setNotice] = useState("");
  const [editingLineId, setEditingLineId] = useState("");
  const [addVersion, setAddVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<"items" | "artwork">("items");
  const [customerId, setCustomerId] = useState(""); const [contactId, setContactId] = useState("");
  const [po, setPo] = useState(""); const [dueDate, setDueDate] = useState(""); const [notes, setNotes] = useState("");
  const requests = useRef<Record<string, { payload: string; id: string }>>({});
  const requestId = (operation: string, payload: unknown) => {
    const serialized = JSON.stringify(payload), prior = requests.current[operation];
    if (!prior || prior.payload !== serialized) requests.current[operation] = { payload: serialized, id: newBusinessRequestId() };
    return requests.current[operation]!.id;
  };
  const complete = (operation: string) => { delete requests.current[operation]; };
  const customers = useQuoteFormCustomers(props.sessionScope, props.organizationId);
  const contacts = useQuoteFormContacts(props.sessionScope, props.organizationId, customerId);
  const products = useQuoteFormProducts(props.sessionScope, props.organizationId);
  const invoice = useQuery({ queryKey: ["v2", props.sessionScope, props.organizationId, "invoice", current?.draftInvoice?.invoiceId], queryFn: () => invoiceApi.get(props.organizationId, current!.draftInvoice!.invoiceId), enabled: Boolean(props.canViewInvoice && current?.draftInvoice?.invoiceId) });
  const artwork = useQuery({ queryKey: ["v2", props.sessionScope, props.organizationId, "artwork", "order", props.orderId], queryFn: () => artworkApi.forOrder(props.organizationId, props.orderId), enabled: Boolean(props.organizationId && props.sessionScope && current) });

  useEffect(() => {
    if (!current) return;
    setCustomerId(current.order.customerContact.customerId ?? ""); setContactId(current.order.customerContact.contactId ?? "");
    setPo(current.order.purchaseOrderNumber ?? ""); setDueDate(current.order.requestedDueDate ?? ""); setNotes(current.order.terms.commercialNotes ?? ""); setEditingLineId("");
  }, [current?.order.orderId]);
  const apply = (result: OrderResult) => {
    queryClient.setQueryData(salesKeys.order(props.sessionScope, props.organizationId, result.order.order.orderId), result.order);
    void queryClient.invalidateQueries({ queryKey: salesKeys.orders(props.sessionScope, props.organizationId) });
    complete("header"); complete("line");
  };
  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => orderApi.patch(props.organizationId, props.orderId, requestId("line", input), input),
    onSuccess: (result) => { apply(result); setEditingLineId(""); setAddVersion((value) => value + 1); setNotice("Order repriced and the Draft Invoice synchronized by the server."); },
    onError: (error) => {
      setNotice(message(error));
      if ((error as unknown as ApiError)?.code === "STALE_STATE") {
        // The operation result is intentionally replayable, including a stale
        // conflict. An explicit operator resave after refresh must therefore
        // use a new business request; it is never an automatic retry.
        complete("line");
        void order.refetch();
      }
    },
  });
  const saveHeader = useMutation({
    mutationFn: () => {
      const input = { expectedRevision: current!.revision, patch: { customerContact: { organizationId: props.organizationId, customerId, ...(contactId ? { contactId } : {}) }, purchaseOrderNumber: po.trim() || null, requestedDueDate: dueDate || null, terms: { commercialNotes: notes } } };
      return orderApi.patch(props.organizationId, props.orderId, requestId("header", input), input);
    },
    onSuccess: (result) => { apply(result); setNotice("Order and Draft Invoice saved."); },
    onError: (error) => {
      setNotice(message(error));
      if ((error as unknown as ApiError)?.code === "STALE_STATE") {
        complete("header");
        void order.refetch();
      }
    },
  });
  if (order.isLoading) return <div className="skeleton" />;
  if (order.error || !current) return <div className="notice error">{message(order.error)}</div>;
  const routeFor = (lineId: string) => current.routes.find((route) => route.work.orderLineId === lineId);
  const editable = props.canEdit && current.order.commercialState === "open";
  const change = (lineChanges: unknown[]) => update.mutate({ expectedRevision: current.revision, patch: {}, lineChanges });
  return <section className="lab v2-sales-workspace v2-order-workspace">
    <div className="actions"><button className="button secondary" onClick={props.onBack}>Back to Orders</button></div>
    {notice && <div className="notice">{notice}</div>}
    <div className="card v2-sales-document-card">
      <div className="header v2-document-header"><div><h2>{current.number.display}</h2><p className="muted">Revision {current.revision}{current.order.sourceQuoteId ? " · converted from Quote" : ""}</p></div><LifecycleBadge value={current.order.commercialState} /></div>
      <div className="v2-document-tabs" aria-label="Order workspace sections"><button type="button" className={activeTab === "items" ? "active" : ""} onClick={() => setActiveTab("items")}>Items</button><button type="button" className={activeTab === "artwork" ? "active" : ""} onClick={() => setActiveTab("artwork")}>Artwork</button><span>Notes</span><span>History</span></div>
      <div className="grid v2-document-meta">
        <SelectionField label="Customer" value={customerId} options={customers.data ?? []} identity="customerId" emptyLabel="Select Customer" disabled={!editable} onChange={(value) => { const next = clearContactForCustomerChange(value); setCustomerId(next.customerId); setContactId(next.contactId); }} />
        <SelectionField label="Contact" value={contactId} options={contacts.data ?? []} identity="contactId" emptyLabel="Select Contact" disabled={!editable || !customerId} onChange={setContactId} />
        <label className="field">PO<input value={po} disabled={!editable} onChange={(event) => setPo(event.target.value)} /></label>
        <label className="field">Requested due date<input type="date" value={dueDate} disabled={!editable} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label className="field">Commercial notes<textarea value={notes} disabled={!editable} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <div className="actions v2-document-actions"><button className="button secondary" onClick={() => props.openCustomer?.(current.order.customerContact.customerId)}>Open Customer</button><button className="button secondary" onClick={() => props.openFulfillment?.(current.order.orderId)}>Fulfillment</button><button className="button secondary" disabled={!editable || saveHeader.isPending || !props.csrfReady} onClick={() => saveHeader.mutate()}>Save Order</button></div>
    </div>
    {activeTab === "artwork" ? <OrderArtworkPanel lines={current.order.lines} artwork={artwork.data ?? []} loading={artwork.isLoading} /> : <>
    <DraftInvoiceSummary invoice={current.draftInvoice} detail={invoice.data} />
    <div className="card"><h2>Commercial lines</h2>
      <table className="table"><thead><tr><th>Line</th><th>Qty</th><th>Calculated / Selling</th><th>Routing</th><th>Actions</th></tr></thead><tbody>
        {current.order.lines.map((line) => <Fragment key={line.lineId}><tr><td>{line.description}{line.sellingPriceDecision.kind !== "calculated" && <div className="override">Selling-price decision: {line.sellingPriceDecision.kind}</div>}</td><td>{line.quantity}</td><td>{money(line.calculatedLineAmount)} / <strong>{money(line.sellingLineAmount)}</strong></td><td><RouteSummary route={routeFor(line.lineId)} /></td><td><button className="button secondary" disabled={!editable || update.isPending || !props.csrfReady} onClick={() => setEditingLineId(line.lineId)}>Edit configuration</button>{routeFor(line.lineId) ? <span className="muted"> Cannot remove after routing has been created.</span> : <button className="button danger" disabled={!editable || update.isPending || !props.csrfReady} onClick={() => change([{ kind: "remove", lineId: line.lineId }])}>Remove Line</button>}</td></tr>
          {editingLineId === line.lineId && <tr className="editor-row"><td colSpan={5}><h3>Edit {line.description}</h3><p className="muted">Product identity is frozen once this line has Routing. Current configuration is adopted only explicitly.</p><QuoteLineEditor organizationId={props.organizationId} sessionScope={props.sessionScope} draftKey={`order:${line.lineId}:${current.revision}`} initialDraft={draftFromQuoteLine(line)} initializeFromPersistedLine productEditable={false} products={products.data ?? []} canOverridePrice={props.canOverridePrice} csrfReady={props.csrfReady} busy={update.isPending} submitLabel="Save and reprice line" onSubmit={(input) => change([{ kind: "update", lineId: line.lineId, line: input }])} onCancel={() => setEditingLineId("")} /></td></tr>}</Fragment>)}
      </tbody></table>
      {editable && <><h3>Add commercial line</h3><QuoteLineEditor organizationId={props.organizationId} sessionScope={props.sessionScope} draftKey={`order:add:${current.order.orderId}:${addVersion}`} initialDraft={emptyQuoteLineDraft()} products={products.data ?? []} canOverridePrice={props.canOverridePrice} csrfReady={props.csrfReady} busy={update.isPending} submitLabel="Add line and price" onSubmit={(line: QuoteLineMutationInput) => change([{ kind: "add", line }])} /></>}
      <SalesTotals calculated={current.totals.calculated} selling={current.totals.selling} />
    </div>
    </>}
  </section>;
};

const bytes = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const artworkRole = (value: ArtworkOrderProjection) => [value.assignment.purpose.replaceAll("_", " "), value.assignment.side, value.assignment.sourcePageIndex !== undefined ? `page ${value.assignment.sourcePageIndex + 1}` : undefined, value.assignment.layerKey ? `layer ${value.assignment.layerKey}` : undefined].filter(Boolean).join(" · ");
const OrderArtworkPanel = ({ lines, artwork, loading }: Readonly<{ lines: readonly { lineId: string; description: string }[]; artwork: readonly ArtworkOrderProjection[]; loading: boolean }>) => <div className="card v2-artwork-chain"><h2>Artwork chain</h2>{loading ? <div className="skeleton" /> : <ul>{lines.map((line) => {
  const entries = artwork.filter((entry) => entry.assignment.orderLineId === line.lineId);
  return <li key={line.lineId}><div className="v2-artwork-thumb">{line.description.slice(0, 2)}</div><span className="v2-artwork-line">{line.description}</span>{entries.length ? <span className="v2-artwork-files">{entries.map((entry) => <span key={entry.assignment.id}><strong>{entry.file.displayFilename}</strong><small>{artworkRole(entry)} · {bytes(entry.file.byteSize)}{entry.file.derivedFromArtworkFileId ? " · derived" : ""}</small></span>)}</span> : null}</li>;
})}</ul>}</div>;
