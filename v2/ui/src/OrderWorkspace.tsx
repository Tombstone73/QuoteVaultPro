import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { artworkApi, fulfillmentApi, invoiceApi, money, newBusinessRequestId, orderApi, quoteApi, type ApiError, type ArtworkOrderProjection, type OrderRead, type OrderResult, type SalesLine } from "./api";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { clearContactForCustomerChange, draftFromQuoteLine, emptyQuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import { salesKeys, useQuoteFormContacts, useQuoteFormCustomers, useQuoteFormProducts } from "./quoteFormQueries";
import { LifecycleBadge, SalesTotals } from "./SalesDocumentParts";
import { SalesDocumentEmpty, SalesDocumentFrame, SalesDocumentSplit } from "./SalesDocumentWorkspace";

const message = (error: unknown): string => {
  const value = error as ApiError;
  if (value?.code === "STALE_STATE") return "This Order changed elsewhere. Reload and try again.";
  if (value?.code === "FORBIDDEN") return "You do not have permission for that Order action.";
  if (value?.code === "CONFLICT") return value.message || "That change is no longer available.";
  return value?.message ?? "The Order service is unavailable.";
};

const lineConfiguration = (line: SalesLine) => {
  const resolved = line.resolvedConfiguration;
  const dimensions = resolved.dimensions;
  const selections = resolved.selections;
  const parts: string[] = [];
  if (dimensions && typeof dimensions === "object" && !Array.isArray(dimensions)) {
    const value = dimensions as Record<string, unknown>;
    const size = [value.width, value.height].filter((item) => typeof item === "string" || typeof item === "number").join(" × ");
    if (size) parts.push(`${size}${typeof value.unit === "string" ? ` ${value.unit}` : ""}`);
  }
  if (selections && typeof selections === "object" && !Array.isArray(selections)) Object.entries(selections as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") parts.push(`${key}: ${String(value)}`);
  });
  return parts.join(" · ") || "No additional configuration";
};

export const OrderWorkspace = (props: Readonly<{
  organizationId: string; sessionScope: string; orderId: string; canEdit: boolean; canOverridePrice: boolean; canViewInvoice: boolean; csrfReady: boolean;
  onBack: () => void; openCustomer?: (customerId: string) => void; openFulfillment?: (orderId: string) => void; openInvoice?: (invoiceId: string) => void; openQuote?: (quoteId: string) => void;
}>) => {
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: salesKeys.order(props.sessionScope, props.organizationId, props.orderId), queryFn: () => orderApi.get(props.organizationId, props.orderId), enabled: Boolean(props.organizationId && props.sessionScope && props.orderId) });
  const current = order.data;
  const [notice, setNotice] = useState("");
  const [editingLineId, setEditingLineId] = useState("");
  const [addVersion, setAddVersion] = useState(0);
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
  const fulfillment = useQuery({ queryKey: ["v2", props.sessionScope, props.organizationId, "fulfillment", "order", props.orderId], queryFn: () => fulfillmentApi.get(props.organizationId, props.orderId), enabled: Boolean(props.organizationId && props.sessionScope && current) });
  const sourceQuote = useQuery({ queryKey: ["v2", props.sessionScope, props.organizationId, "order-source-quote", current?.order.sourceQuoteId], queryFn: () => quoteApi.get(props.organizationId, current!.order.sourceQuoteId!), enabled: Boolean(current?.order.sourceQuoteId) });

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
    onSuccess: (result) => { apply(result); setEditingLineId(""); setAddVersion((value) => value + 1); setNotice("Order saved."); },
    onError: (error) => { setNotice(message(error)); if ((error as unknown as ApiError)?.code === "STALE_STATE") { complete("line"); void order.refetch(); } },
  });
  const saveHeader = useMutation({
    mutationFn: () => {
      const input = { expectedRevision: current!.revision, patch: { customerContact: { organizationId: props.organizationId, customerId, ...(contactId ? { contactId } : {}) }, purchaseOrderNumber: po.trim() || null, requestedDueDate: dueDate || null, terms: { commercialNotes: notes } } };
      return orderApi.patch(props.organizationId, props.orderId, requestId("header", input), input);
    },
    onSuccess: (result) => { apply(result); setNotice("Order saved."); },
    onError: (error) => { setNotice(message(error)); if ((error as unknown as ApiError)?.code === "STALE_STATE") { complete("header"); void order.refetch(); } },
  });
  if (order.isLoading) return <div className="skeleton" />;
  if (order.error || !current) return <div className="notice error">{message(order.error)}</div>;
  const routeFor = (lineId: string) => current.routes.find((route) => route.work.orderLineId === lineId);
  const editable = props.canEdit && current.order.commercialState === "open";
  const change = (lineChanges: unknown[]) => update.mutate({ expectedRevision: current.revision, patch: {}, lineChanges });
  const selectedLine = current.order.lines.find((line) => line.lineId === editingLineId);
  const isAdding = editingLineId === "__add__";
  const fulfillmentRemaining = fulfillment.data?.lines.reduce((total, line) => total + line.remainingFulfillmentQuantity, 0);
  const headerMetadata = <><div className="v2-sales-compact-meta">
    <div className="v2-sales-identity"><select className="v2-sales-customer-select" aria-label="Customer" value={customerId} disabled={!editable} onChange={(event) => { const next = clearContactForCustomerChange(event.target.value); setCustomerId(next.customerId); setContactId(next.contactId); }}><option value="">Select Customer</option>{(customers.data ?? []).map((customer) => customer.customerId ? <option key={customer.customerId} value={customer.customerId}>{customer.displayName}</option> : null)}</select><label className="v2-sales-contact-select"><small>Contact</small><select aria-label="Contact" value={contactId} disabled={!editable || !customerId} onChange={(event) => setContactId(event.target.value)}><option value="">Select Contact</option>{(contacts.data ?? []).map((contact) => contact.contactId ? <option key={contact.contactId} value={contact.contactId}>{contact.displayName}</option> : null)}</select></label></div>
    <label className="v2-sales-inline-fact"><small>PO #</small><input aria-label="PO #" value={po} disabled={!editable} onChange={(event) => setPo(event.target.value)} /></label>
    <label className="v2-sales-inline-fact"><small>Requested Due</small><input aria-label="Requested Due" type="date" value={dueDate} disabled={!editable} onChange={(event) => setDueDate(event.target.value)} /></label>
    <div className="v2-sales-inline-fact"><small>Sales Rep</small><span>—</span></div><div className="v2-sales-inline-fact"><small>Terms</small><span>—</span></div>
    <div className="v2-sales-inline-fact"><small>Fulfillment</small><button type="button" className="v2-sales-inline-button" onClick={() => props.openFulfillment?.(current.order.orderId)}>{fulfillment.isSuccess ? `${fulfillmentRemaining ?? 0} remaining` : "Open Fulfillment"}</button></div>
    <div className="v2-sales-inline-fact"><small>Job Name</small><span>—</span></div>
  </div><OrderLifecycle order={current} /></>;
  const items = <SalesDocumentSplit left={<section className="v2-sales-items"><header><div><h2>Items</h2><p>{current.order.lines.length} line{current.order.lines.length === 1 ? "" : "s"}</p></div>{editable && <button type="button" className="v2-sales-add-line" disabled={update.isPending || !props.csrfReady} onClick={() => setEditingLineId("__add__")}>Add line</button>}</header><div className="v2-sales-items-table-wrap"><table><thead><tr><th>Product</th><th>Configuration</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>{current.order.lines.map((line) => <tr key={line.lineId} className={line.lineId === selectedLine?.lineId ? "is-selected" : ""} onClick={() => editable && setEditingLineId((value) => value === line.lineId ? "" : line.lineId)}><td><button type="button"><i>{line.description.slice(0, 1).toUpperCase() || "P"}</i><span><b>{line.description || "Product"}</b>{line.sellingPriceDecision.kind !== "calculated" && <em>Manual price</em>}</span></button></td><td>{lineConfiguration(line)}</td><td className="num">{line.quantity}</td><td className="num">{money(line.sellingUnitAmount)}</td><td className="num strong">{money(line.sellingLineAmount)}</td></tr>)}</tbody></table></div><footer><SalesTotals calculated={current.totals.calculated} selling={current.totals.selling} /></footer></section>} right={selectedLine && editable ? <OrderLineEditor line={selectedLine} routed={Boolean(routeFor(selectedLine.lineId))} {...props} products={products.data ?? []} busy={update.isPending} onSave={(line) => change([{ kind: "update", lineId: selectedLine.lineId, line }])} onRemove={() => change([{ kind: "remove", lineId: selectedLine.lineId }])} onClose={() => setEditingLineId("")} /> : isAdding && editable ? <section className="v2-sales-line-editor"><header><div><small>NEW LINE</small><h2>Add item</h2></div></header><QuoteLineEditor organizationId={props.organizationId} sessionScope={props.sessionScope} draftKey={`order:add:${current.order.orderId}:${addVersion}`} initialDraft={emptyQuoteLineDraft()} products={products.data ?? []} canOverridePrice={props.canOverridePrice} csrfReady={props.csrfReady} busy={update.isPending} submitLabel="Add line" onSubmit={(line: QuoteLineMutationInput) => change([{ kind: "add", line }])} onCancel={() => setEditingLineId("")} /></section> : null} />;
  return <section className="v2-sales-workspace v2-order-workspace"><button className="v2-sales-back" type="button" onClick={props.onBack}>← Orders</button>{notice && <div className="notice">{notice}</div>}<SalesDocumentFrame documentType="Order" number={current.number.display} status={<><LifecycleBadge value={current.order.commercialState} />{current.order.sourceQuoteId && <button className="v2-sales-source-link" type="button" onClick={() => props.openQuote?.(current.order.sourceQuoteId!)}>from Quote #{sourceQuote.data?.number.display ?? "…"}</button>}</>} headerActions={<><button className="button secondary" type="button" onClick={() => props.openCustomer?.(current.order.customerContact.customerId)}>Open Customer</button><button className="button secondary" type="button" onClick={() => props.openFulfillment?.(current.order.orderId)}>Fulfillment</button><button className="button" type="button" disabled={!editable || saveHeader.isPending || !props.csrfReady} onClick={() => saveHeader.mutate()}>{saveHeader.isPending ? "Saving…" : "Save"}</button></>} metadata={headerMetadata} panels={{ Items: items, Artwork: <OrderArtworkPanel lines={current.order.lines} artwork={artwork.data ?? []} loading={artwork.isLoading} />, Notes: <section className="v2-sales-notes"><label className="field">Notes<textarea aria-label="Commercial notes" value={notes} disabled={!editable} onChange={(event) => setNotes(event.target.value)} /></label>{editable && <button className="button" type="button" disabled={saveHeader.isPending || !props.csrfReady} onClick={() => saveHeader.mutate()}>{saveHeader.isPending ? "Saving…" : "Save notes"}</button>}</section>, Billing: <OrderBilling invoice={invoice.data} draft={current.draftInvoice} canView={props.canViewInvoice} onOpen={() => current.draftInvoice && props.openInvoice?.(current.draftInvoice.invoiceId)} />, Fulfillment: <OrderFulfillment loading={fulfillment.isLoading} fulfillment={fulfillment.data} onOpen={() => props.openFulfillment?.(current.order.orderId)} />, History: <SalesDocumentEmpty>No order history is available.</SalesDocumentEmpty> }} /></section>;
};

const OrderLifecycle = ({ order }: Readonly<{ order: OrderRead }>) => <div className="v2-order-lifecycle" aria-label="Order status"><span data-state="active">Order <b>{order.order.commercialState}</b></span><span data-state={order.routes.length ? "active" : "neutral"}>Routing <b>{order.routes.length ? "Active" : "No route"}</b></span>{order.draftInvoice && <span data-state="neutral">Invoice <b>{order.draftInvoice.lifecycle}</b></span>}</div>;

const OrderLineEditor = ({ line, routed, organizationId, sessionScope, canOverridePrice, csrfReady, products, busy, onSave, onRemove, onClose }: Readonly<{ line: SalesLine; routed: boolean; organizationId: string; sessionScope: string; canOverridePrice: boolean; csrfReady: boolean; products: readonly { productId?: string; displayName: string }[]; busy: boolean; onSave: (line: QuoteLineMutationInput) => void; onRemove: () => void; onClose: () => void }>) => <section className="v2-sales-line-editor"><header><div><small>LINE {line.position}</small><h2>{line.description || line.productId}</h2></div>{routed ? <span className="v2-sales-route-note">Routing has already started for this line.</span> : <button className="v2-sales-remove-line" type="button" disabled={busy || !csrfReady} onClick={onRemove}>Remove</button>}</header>{!canOverridePrice && <p className="v2-sales-permission-note">Price overrides are unavailable for this permission set.</p>}<QuoteLineEditor organizationId={organizationId} sessionScope={sessionScope} draftKey={`order:edit:${line.lineId}`} initialDraft={draftFromQuoteLine(line)} initializeFromPersistedLine productEditable={!routed} products={products as never} canOverridePrice={canOverridePrice} csrfReady={csrfReady} busy={busy} submitLabel="Save line" onSubmit={onSave} onCancel={onClose} /></section>;

const OrderBilling = ({ invoice, draft, canView, onOpen }: Readonly<{ invoice?: import("./api").InvoiceRead; draft?: OrderRead["draftInvoice"]; canView: boolean; onOpen: () => void }>) => !draft ? <SalesDocumentEmpty>No invoice is available for this Order.</SalesDocumentEmpty> : <section className="v2-order-tab"><header><div><h2>Billing</h2><p>{canView ? "Draft invoice" : "Invoice access is unavailable."}</p></div>{canView && <button className="button secondary" type="button" onClick={onOpen}>Open Invoice</button>}</header><dl><div><dt>Status</dt><dd>{invoice?.lifecycle ?? draft.lifecycle}</dd></div><div><dt>Lines</dt><dd>{invoice?.lines.length ?? draft.lineCount}</dd></div><div><dt>Total</dt><dd>{money(invoice?.total ?? draft.total)}</dd></div></dl></section>;

const OrderFulfillment = ({ loading, fulfillment, onOpen }: Readonly<{ loading: boolean; fulfillment?: import("./api").FulfillmentWorkspaceOrder; onOpen: () => void }>) => <section className="v2-order-tab"><header><div><h2>Fulfillment</h2><p>{loading ? "Loading…" : fulfillment ? `${fulfillment.handoffs.length} recorded handoff${fulfillment.handoffs.length === 1 ? "" : "s"}` : "Fulfillment details are unavailable."}</p></div><button className="button secondary" type="button" onClick={onOpen}>Open Fulfillment</button></header>{fulfillment && <dl>{fulfillment.lines.map((line) => <div key={line.orderLineId}><dt>{line.description}</dt><dd>{line.remainingFulfillmentQuantity} remaining</dd></div>)}</dl>}</section>;

const bytes = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const artworkRole = (value: ArtworkOrderProjection) => [value.assignment.purpose.replaceAll("_", " "), value.assignment.side, value.assignment.sourcePageIndex !== undefined ? `page ${value.assignment.sourcePageIndex + 1}` : undefined].filter(Boolean).join(" · ");
const OrderArtworkPanel = ({ lines, artwork, loading }: Readonly<{ lines: readonly { lineId: string; description: string }[]; artwork: readonly ArtworkOrderProjection[]; loading: boolean }>) => <section className="v2-order-tab"><header><div><h2>Artwork</h2><p>{loading ? "Loading…" : artwork.length ? `${artwork.length} file${artwork.length === 1 ? "" : "s"}` : "No artwork is attached."}</p></div></header>{!loading && artwork.length > 0 && <ul className="v2-order-artwork">{artwork.map((entry) => <li key={entry.assignment.id}><b>{lines.find((line) => line.lineId === entry.assignment.orderLineId)?.description ?? "Order line"}</b><span>{entry.file.displayFilename} · {artworkRole(entry)} · {bytes(entry.file.byteSize)}</span></li>)}</ul>}</section>;
