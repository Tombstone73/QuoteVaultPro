import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contactApi, customerApi, inboundOrdersApi, newBusinessRequestId, productApi, type ApiError, type InboundOrderDetail, type InboundOrderLineDraft, type InboundOrderStatus } from "./api";

const statuses: readonly (InboundOrderStatus | "all")[] = ["needs_review", "ready", "action_required", "failed", "received", "converted", "duplicate", "rejected", "all"];
const keys = {
  list: (scope: string, organizationId: string, status: string, query: string, cursor: string) => ["v2", scope, organizationId, "inbound-orders", "list", status, query, cursor] as const,
  detail: (scope: string, organizationId: string, inboundOrderId: string) => ["v2", scope, organizationId, "inbound-orders", inboundOrderId] as const,
};
const errorText = (value: unknown, fallback: string) => typeof value === "object" && value !== null && "message" in value ? String((value as ApiError).message) : fallback;
const statusLabel = (status: InboundOrderStatus) => status.replaceAll("_", " ");
const localDate = (value?: string) => value ? new Date(value).toLocaleString() : "Not recorded";
const copyLine = (line: InboundOrderLineDraft): InboundOrderLineDraft => ({ ...line, dimensions: line.dimensions ? { ...line.dimensions } : undefined, configuration: line.configuration ? { ...line.configuration } : undefined, validation: line.validation ? [...line.validation] : undefined });
const emptyLine = (): InboundOrderLineDraft => ({ draftLineId: "draft-" + Math.random().toString(36).slice(2), description: "", quantity: 1, dimensions: { unit: "in" } });

/** Review only; source evidence and all state/Order transitions stay server-owned. */
export const InboundOrdersWorkspace = ({ organizationId, sessionScope, canView, canReview, canConvert, csrfReady, openOrder, openCustomer }: Readonly<{
  organizationId: string; sessionScope: string; canView: boolean; canReview: boolean; canConvert: boolean; csrfReady: boolean;
  openOrder: (orderId: string) => void; openCustomer: (customerId: string) => void;
}>) => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InboundOrderStatus | "all">("needs_review");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState("");
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, status, search, cursor), queryFn: () => inboundOrdersApi.list(organizationId, { status, q: search || undefined, cursor: cursor || undefined, limit: 25 }), enabled: Boolean(organizationId && sessionScope && canView) });
  const activeId = selected || list.data?.items[0]?.inboundOrderId || "";
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, activeId), queryFn: () => inboundOrdersApi.get(organizationId, activeId), enabled: Boolean(organizationId && sessionScope && canView && activeId) });
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "inbound-orders"] }); };
  const review = useMutation({ mutationFn: (input: Readonly<{ draft: InboundOrderDetail["draft"]; state: "needs_review" | "ready" }>) => inboundOrdersApi.review(organizationId, activeId, newBusinessRequestId(), input), onSuccess: refresh });
  const convert = useMutation({ mutationFn: () => inboundOrdersApi.convert(organizationId, activeId, newBusinessRequestId()), onSuccess: async (result) => { await refresh(); openOrder(result.orderId); } });
  const duplicate = useMutation({ mutationFn: (reason?: string) => inboundOrdersApi.markDuplicate(organizationId, activeId, newBusinessRequestId(), reason), onSuccess: refresh });
  const reject = useMutation({ mutationFn: (reason: string) => inboundOrdersApi.reject(organizationId, activeId, newBusinessRequestId(), reason), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => inboundOrdersApi.retry(organizationId, activeId, newBusinessRequestId()), onSuccess: refresh });
  const setFilter = (next: InboundOrderStatus | "all") => { setStatus(next); setCursor(""); setCursorHistory([]); setSelected(""); };
  if (!organizationId) return <section className="v2-inbound-orders"><div className="v2-proof-empty">Inbound Orders are unavailable until an authenticated organization is selected.</div></section>;
  if (!canView) return <section className="v2-inbound-orders"><div className="v2-proof-empty">You do not have permission to view Inbound Orders.</div></section>;
  return <section className="v2-inbound-orders" aria-label="Inbound Orders">
    <aside className="v2-inbound-queue">
      <header><div><small>SALES INTAKE</small><h1>Inbound Orders</h1><p>Review source evidence before creating a canonical Order.</p></div><span>{list.data?.totalMatching ?? "…"}</span></header>
      <div className="v2-inbound-filters"><label>Status<select value={status} onChange={(event) => setFilter(event.target.value as InboundOrderStatus | "all")}>{statuses.map((item) => <option key={item} value={item}>{item === "all" ? "All states" : statusLabel(item)}</option>)}</select></label><label>Search<input aria-label="Search inbound orders" value={search} placeholder="Sender, subject, PO…" onChange={(event) => { setSearch(event.target.value); setCursor(""); setCursorHistory([]); setSelected(""); }} /></label></div>
      <div className="v2-inbound-queue-list">
        {list.isLoading && <p>Loading inbound work…</p>}
        {list.isError && <p role="alert">Inbound work is unavailable. Provider intake remains unchanged.</p>}
        {list.data?.items.map((item) => <button key={item.inboundOrderId} type="button" className={item.inboundOrderId === activeId ? "active" : ""} onClick={() => setSelected(item.inboundOrderId)}>
          <span className={"v2-inbound-status " + item.status}>{statusLabel(item.status)}</span><b>{item.subject || "No subject"}</b>
          <small>{item.senderName || item.senderEmail || "Unknown sender"} · {localDate(item.receivedAt)}</small>
          <small>{item.customerDisplayName || "Customer not matched"}{item.extractedPurchaseOrderNumber ? " · PO " + item.extractedPurchaseOrderNumber : ""}{item.attachmentCount ? " · " + item.attachmentCount + " attachment" + (item.attachmentCount === 1 ? "" : "s") : ""}</small>
          {item.actionRequired && <em>{item.actionRequired}</em>}
        </button>)}
        {list.isSuccess && !list.data.items.length && <p>{search ? "No inbound work matches this search." : "No inbound work is in this queue."}</p>}
      </div>
      <footer><button type="button" disabled={!cursorHistory.length || list.isFetching} onClick={() => { const previous = cursorHistory.at(-1) ?? ""; setCursorHistory((current) => current.slice(0, -1)); setCursor(previous); }}>Previous</button><button type="button" disabled={!list.data?.nextCursor || list.isFetching} onClick={() => { if (!list.data?.nextCursor) return; setCursorHistory((current) => [...current, cursor]); setCursor(list.data.nextCursor); }}>Next</button></footer>
    </aside>
    <main className="v2-inbound-detail">
      {detail.isLoading && <div className="v2-proof-empty">Loading source evidence…</div>}
      {detail.isError && <div className="v2-proof-empty">The selected intake record is unavailable in this organization.</div>}
      {detail.data && <InboundDetail value={detail.data} organizationId={organizationId} canReview={canReview && csrfReady} canConvert={canConvert && csrfReady} busy={review.isPending || convert.isPending || duplicate.isPending || reject.isPending || retry.isPending} error={review.error || convert.error || duplicate.error || reject.error || retry.error} onSave={(input) => review.mutate(input)} onConvert={() => convert.mutate()} onDuplicate={(reason) => duplicate.mutate(reason)} onReject={(reason) => reject.mutate(reason)} onRetry={() => retry.mutate()} openCustomer={openCustomer} />}
      {!activeId && list.isSuccess && <div className="v2-proof-empty">Select inbound work to review its source message and draft.</div>}
    </main>
  </section>;
};

const InboundDetail = ({ value, organizationId, canReview, canConvert, busy, error, onSave, onConvert, onDuplicate, onReject, onRetry, openCustomer }: Readonly<{
  value: InboundOrderDetail; organizationId: string; canReview: boolean; canConvert: boolean; busy: boolean; error: unknown;
  onSave: (input: Readonly<{ draft: InboundOrderDetail["draft"]; state: "needs_review" | "ready" }>) => void; onConvert: () => void; onDuplicate: (reason?: string) => void; onReject: (reason: string) => void; onRetry: () => void; openCustomer: (customerId: string) => void;
}>) => {
  const [customerId, setCustomerId] = useState(value.draft.customerId ?? value.customerId ?? "");
  const [contactId, setContactId] = useState(value.draft.contactId ?? value.contactId ?? "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [po, setPo] = useState(value.draft.purchaseOrderNumber ?? "");
  const [dueDate, setDueDate] = useState(value.draft.requestedDueDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(value.draft.notes ?? "");
  const [lines, setLines] = useState<InboundOrderLineDraft[]>(() => value.draft.lines.map(copyLine));
  const [reason, setReason] = useState("");
  useEffect(() => { setCustomerId(value.draft.customerId ?? value.customerId ?? ""); setContactId(value.draft.contactId ?? value.contactId ?? ""); setPo(value.draft.purchaseOrderNumber ?? ""); setDueDate(value.draft.requestedDueDate?.slice(0, 10) ?? ""); setNotes(value.draft.notes ?? ""); setLines(value.draft.lines.map(copyLine)); }, [value]);
  const customers = useQuery({ queryKey: ["v2", organizationId, "inbound-orders", "customer-match", customerSearch], queryFn: () => customerApi.list(organizationId, customerSearch, { limit: 25 }), enabled: canReview });
  const contacts = useQuery({ queryKey: ["v2", organizationId, "inbound-orders", "contact-match", customerSearch], queryFn: () => contactApi.list(organizationId, customerSearch), enabled: Boolean(canReview && customerId) });
  const products = useQuery({ queryKey: ["v2", organizationId, "inbound-orders", "products"], queryFn: () => productApi.list(organizationId, "", 1), enabled: canReview });
  const customerOptions = useMemo(() => {
    const result = new Map<string, { customerId: string; displayName: string; confidence?: "strong" | "possible" }>(value.customerCandidates.map((candidate) => [candidate.customerId, { customerId: candidate.customerId, displayName: candidate.displayName, ...(candidate.confidence ? { confidence: candidate.confidence } : {}) }] as const));
    for (const candidate of customers.data?.items ?? []) result.set(candidate.customerId, { customerId: candidate.customerId, displayName: candidate.displayName });
    return [...result.values()];
  }, [customers.data?.items, value.customerCandidates]);
  const selectedCustomer = useMemo(() => value.customerCandidates.find((candidate) => candidate.customerId === customerId), [customerId, value.customerCandidates]);
  const contactOptions = useMemo(() => {
    const result = new Map((selectedCustomer?.contactCandidates ?? []).map((contact) => [contact.contactId, contact] as const));
    for (const contact of contacts.data?.items ?? []) if (contact.customerId === customerId) result.set(contact.contactId, { contactId: contact.contactId, displayName: contact.displayName, ...(contact.email ? { email: contact.email } : {}) });
    return [...result.values()];
  }, [contacts.data?.items, customerId, selectedCustomer?.contactCandidates]);
  const save = (state: "needs_review" | "ready") => onSave({ state, draft: { customerId: customerId || undefined, contactId: contactId || undefined, purchaseOrderNumber: po.trim() || undefined, requestedDueDate: dueDate || undefined, requestedFulfillment: value.draft.requestedFulfillment, notes: notes.trim() || undefined, lines: lines.map((line) => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity) || undefined })) } });
  const changeLine = (index: number, patch: Partial<InboundOrderLineDraft>) => setLines((current) => current.map((line, candidate) => candidate === index ? { ...line, ...patch } : line));
  const terminal = value.status === "converted" || value.status === "duplicate" || value.status === "rejected";
  return <div className="v2-inbound-detail-content">
    <header className="v2-inbound-detail-header"><div><small>{value.source.provider} · {value.source.messageId}</small><h1>{value.source.subject || "Inbound customer work"}</h1><p>{value.source.senderName || value.source.senderEmail || "Unknown sender"} · received {localDate(value.source.receivedAt)}</p></div><span className={"v2-inbound-status " + value.status}>{statusLabel(value.status)}</span></header>
    {value.conversion && <section className="v2-inbound-converted"><b>Converted to canonical Order {value.conversion.orderNumber ?? value.conversion.orderId}</b><small>{localDate(value.conversion.convertedAt)}{value.conversion.convertedBy ? " · " + value.conversion.convertedBy : ""}</small></section>}
    {value.draft.blockers?.length ? <section className="v2-inbound-blockers" role="alert"><b>Review blockers</b>{value.draft.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}</section> : null}
    <div className="v2-inbound-columns">
      <section className="v2-inbound-source"><h2>Source message</h2><dl><div><dt>From</dt><dd>{value.source.senderName ? value.source.senderName + " · " : ""}{value.source.senderEmail ?? "Not recorded"}</dd></div><div><dt>To</dt><dd>{value.source.recipientEmail ?? "Not recorded"}</dd></div><div><dt>Received</dt><dd>{localDate(value.source.receivedAt)}</dd></div></dl><pre>{value.source.bodyText || "Source body was not retained in this view."}</pre><h2>Attachments</h2>{value.attachments.length ? <ul>{value.attachments.map((attachment) => <li key={attachment.attachmentId}><div><b>{attachment.filename}</b><small>{attachment.contentType ?? "file"}{attachment.sizeBytes ? " · " + Math.ceil(attachment.sizeBytes / 1024) + " KB" : ""}{attachment.role ? " · " + attachment.role : ""}</small></div><em>{attachment.adoptionState === "adopted" ? "Canonical Artwork adopted" : "Source reference retained · review before adoption"}</em></li>)}</ul> : <p>No attachments retained with this message.</p>}</section>
      <section className="v2-inbound-review"><h2>Reviewed Order draft</h2><p>Extraction is a review aid only. Pricing, Product configuration, and Order workflow remain canonical server decisions.</p>
        <div className="v2-inbound-fields"><label>Find canonical Customer<input disabled={!canReview || terminal} value={customerSearch} placeholder="Name, contact, email…" onChange={(event) => setCustomerSearch(event.target.value)} /></label><label>Customer<select disabled={!canReview || terminal} value={customerId} onChange={(event) => { setCustomerId(event.target.value); setContactId(""); }}><option value="">Select a customer…</option>{customerOptions.map((candidate) => <option key={candidate.customerId} value={candidate.customerId}>{candidate.displayName}{candidate.confidence ? " (" + candidate.confidence + " match)" : ""}</option>)}</select></label>{customerId && <button type="button" className="v2-inbound-link" onClick={() => openCustomer(customerId)}>Open Customer</button>}<label>Contact<select disabled={!canReview || terminal || !customerId} value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">No contact selected</option>{contactOptions.map((contact) => <option key={contact.contactId} value={contact.contactId}>{contact.displayName}{contact.email ? " · " + contact.email : ""}</option>)}</select></label><label>PO / reference<input disabled={!canReview || terminal} value={po} maxLength={160} onChange={(event) => setPo(event.target.value)} /></label><label>Requested due date<input disabled={!canReview || terminal} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label className="wide">Order notes<textarea disabled={!canReview || terminal} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
        <div className="v2-inbound-lines"><header><h2>Proposed lines</h2>{canReview && !terminal && <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</button>}</header>{lines.map((line, index) => <article key={line.draftLineId}><label>Description<input disabled={!canReview || terminal} value={line.description} onChange={(event) => changeLine(index, { description: event.target.value })} /></label><label>Quantity<input disabled={!canReview || terminal} min="1" type="number" value={line.quantity ?? ""} onChange={(event) => changeLine(index, { quantity: Number(event.target.value) || undefined })} /></label><label>Product<select disabled={!canReview || terminal} value={line.productId ?? ""} onChange={(event) => changeLine(index, { productId: event.target.value || undefined })}><option value="">Select canonical Product…</option>{line.productId && !products.data?.items.some((product) => product.productId === line.productId) && <option value={line.productId}>{line.productId}</option>}{products.data?.items.filter((product) => product.lifecycle === "active" || product.lifecycle === "active_with_draft").map((product) => <option key={product.productId} value={product.productId}>{product.displayName}</option>)}</select></label><label>Width<input disabled={!canReview || terminal} value={line.dimensions?.width ?? ""} onChange={(event) => changeLine(index, { dimensions: { ...line.dimensions, width: event.target.value } })} /></label><label>Height<input disabled={!canReview || terminal} value={line.dimensions?.height ?? ""} onChange={(event) => changeLine(index, { dimensions: { ...line.dimensions, height: event.target.value } })} /></label>{canReview && !terminal && <button type="button" className="v2-inbound-remove" onClick={() => setLines((current) => current.filter((_line, candidate) => candidate !== index))}>Remove</button>}{line.validation?.map((message) => <small className="v2-inbound-line-warning" key={message}>{message}</small>)}</article>)}</div>
        {!terminal && <footer className="v2-inbound-actions"><button type="button" disabled={!canReview || busy} onClick={() => save("needs_review")}>Save review</button><button type="button" disabled={!canReview || busy} onClick={() => save("ready")}>Validate &amp; mark ready</button><button type="button" disabled={!canConvert || busy || (value.status !== "ready" && value.status !== "converting")} className="v2-primary-button" onClick={onConvert}>{busy ? "Working…" : value.status === "converting" ? "Resume conversion" : "Convert to Order"}</button>{value.status === "failed" || value.status === "action_required" ? <button type="button" disabled={!canReview || busy} onClick={onRetry}>Retry intake</button> : null}</footer>}
        {!terminal && <section className="v2-inbound-disposition"><label>Duplicate / rejection reason<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Required for a terminal decision" /></label><div><button type="button" disabled={!canReview || busy || !reason.trim()} onClick={() => onDuplicate(reason.trim())}>Mark duplicate</button><button type="button" disabled={!canReview || busy || !reason.trim()} onClick={() => onReject(reason.trim())}>Reject / ignore</button></div></section>}
        {Boolean(error) && <p role="alert" className="v2-inbound-error">{errorText(error, "Inbound action failed. Refresh the record and review the server response.")}</p>}
      </section>
    </div>
  </div>;
};
