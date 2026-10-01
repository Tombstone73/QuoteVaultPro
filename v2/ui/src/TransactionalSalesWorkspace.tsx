import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newBusinessRequestId, type UiBootstrap } from "./api";
import { SelectionField } from "./SelectionField";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { emptyQuoteLineDraft, type QuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import {
  salesWorkspaceKeys, workspaceError,
  type SalesWorkspaceClient, type WorkspaceHeader, type WorkspaceLineInput,
  type WorkspaceLineView, type WorkspacePromotionView, type WorkspaceView,
} from "./salesWorkspaceApi";

export type TransactionalSalesWorkspaceProps = Readonly<{
  organizationId: string;
  sessionScope: string;
  userId: string;
  client: SalesWorkspaceClient;
  capabilities: Pick<UiBootstrap["capabilities"], "quoteCreate" | "orderCreate" | "quoteOverridePrice" | "orderOverridePrice" | "artworkView" | "artworkAdopt" | "artworkAssign">;
  csrfReady: boolean;
  workspaceId?: string;
  onWorkspaceIdChange?: (workspaceId: string | undefined) => void;
  openCanonical: (receipt: NonNullable<WorkspaceView["promotion"]>) => void;
}>;

const owns = (workspace: WorkspaceView, props: TransactionalSalesWorkspaceProps) =>
  workspace.organizationId === props.organizationId && workspace.creatorUserId === props.userId;
const urlWorkspaceId = () => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("workspaceId") ?? "";

/** Session changes remount local drafts as well as isolate every workspace cache key. */
export const TransactionalSalesWorkspace = (props: TransactionalSalesWorkspaceProps) => {
  if (!props.organizationId || !props.sessionScope || !props.userId)
    return <p className="notice">An authenticated organization and staff session are required.</p>;
  if (props.capabilities.quoteCreate !== true && props.capabilities.orderCreate !== true)
    return <p className="notice">You do not have permission to create a Sales workspace.</p>;
  return <WorkspaceSession key={JSON.stringify([props.organizationId, props.sessionScope, props.userId, props.workspaceId])} {...props} />;
};

const WorkspaceSession = (props: TransactionalSalesWorkspaceProps) => {
  const { client, organizationId, sessionScope, userId } = props;
  const cache = useQueryClient();
  const [activeId, setActiveId] = useState(() => props.workspaceId ?? urlWorkspaceId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creating = useRef(false);
  const creationRequest = useRef("");
  const mounted = useRef(false);
  const scopeKey = salesWorkspaceKeys.scope(sessionScope, organizationId, userId);
  const list = useQuery({ queryKey: [...scopeKey, "list"], queryFn: () => client.list(organizationId), enabled: !activeId, retry: false, refetchOnWindowFocus: false });
  const read = useQuery({ queryKey: salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, activeId), queryFn: () => client.read(organizationId, activeId), enabled: Boolean(activeId), retry: false, refetchOnWindowFocus: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (props.workspaceId !== undefined) return;
    const resume = () => setActiveId(urlWorkspaceId());
    window.addEventListener("popstate", resume);
    return () => window.removeEventListener("popstate", resume);
  }, [props.workspaceId]);
  const navigate = (id?: string) => {
    if (!mounted.current) return;
    setActiveId(id ?? "");
    if (props.onWorkspaceIdChange) props.onWorkspaceIdChange(id);
    else {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("workspaceId", id); else url.searchParams.delete("workspaceId");
      window.history.replaceState(window.history.state, "", url);
    }
  };
  const create = async () => {
    if (creating.current || !props.csrfReady) return;
    creating.current = true;
    setBusy(true); setError("");
    creationRequest.current ||= newBusinessRequestId();
    try {
      const workspace = await client.create(organizationId, { requestId: creationRequest.current, kind: "new_sales", header: {} });
      if (!mounted.current) return;
      if (!owns(workspace, props)) throw new Error("Workspace identity did not match the current session.");
      cache.setQueryData(salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, workspace.id), workspace);
      creationRequest.current = "";
      navigate(workspace.id);
    } catch (failure) { if (mounted.current) setError(workspaceError(failure).message); }
    finally { creating.current = false; if (mounted.current) setBusy(false); }
  };
  if (activeId) {
    if (read.isError) return <section className="lab"><p className="notice error" role="alert">{workspaceError(read.error).message}</p><button className="button" onClick={() => void read.refetch()}>Retry workspace load</button><button className="button secondary" onClick={() => navigate()}>Back to drafts</button></section>;
    if (!read.data) return <p role="status">Loading Sales workspace...</p>;
    if (!owns(read.data, props)) return <p className="notice error" role="alert">Workspace identity did not match the current session.</p>;
    return <WorkspaceEditor key={activeId} {...props} initialWorkspace={read.data} onBack={() => { void cache.invalidateQueries({ queryKey: [...scopeKey, "list"] }); navigate(); }} />;
  }
  return <section className="lab v2-sales-entry" aria-label="Sales workspaces">
    <header className="v2-sales-entry-header"><div><h1>Sales Workspace</h1><p>Start with the sale. Choose Quote or Order only when you save the finished entry.</p></div></header>
    <button className="button" disabled={busy || !props.csrfReady} onClick={() => void create()}>{busy ? "Creating workspace..." : "New Sales Entry"}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    <h2>Resume Draft</h2>
    {list.isLoading && <p role="status">Loading your drafts...</p>}
    {list.isError && <p className="notice error" role="alert">{workspaceError(list.error).message}<button onClick={() => void list.refetch()}>Retry drafts</button></p>}
    {list.isSuccess && !list.data.some((workspace) => owns(workspace, props) && workspace.state === "draft") && <p>No resumable drafts.</p>}
    <ul className="v2-sales-entry-list">{(list.data ?? []).filter((workspace) => owns(workspace, props) && workspace.state === "draft" && workspace.kind === "new_sales").map((workspace) => <li key={workspace.id}><div><b>{workspace.header.jobLabel || "Untitled Sales entry"}</b><small>{workspace.lines.length} items. Expires {workspace.expiresAt.slice(0, 10)}.</small></div><button className="button secondary" disabled={busy} onClick={() => navigate(workspace.id)}>Resume {workspace.header.jobLabel || workspace.id}</button></li>)}</ul>
  </section>;
};

const lineDraft = (input: WorkspaceLineInput): QuoteLineDraft => {
  const selling = input.selling;
  return { ...emptyQuoteLineDraft(), productId: input.productId, description: input.description ?? "", quantity: String(input.quantity), selections: input.selections ?? {},
    dimensions: input.dimensions ? { ...input.dimensions } : emptyQuoteLineDraft().dimensions,
    selling: selling?.kind === "unit_override" ? { mode: selling.kind, cents: String(selling.unitCents), reason: selling.reason }
      : selling?.kind === "total_override" ? { mode: selling.kind, cents: String(selling.totalCents), reason: selling.reason }
      : { mode: "calculated", cents: "", reason: "" } };
};
const money = (amount: Readonly<{ cents: number; currency: string }>) =>
  (amount.cents / 100).toLocaleString(undefined, { style: "currency", currency: amount.currency });

const WorkspaceEditor = (props: TransactionalSalesWorkspaceProps & Readonly<{ initialWorkspace: WorkspaceView; onBack: () => void }>) => {
  const { client, organizationId, sessionScope, userId, capabilities, csrfReady } = props;
  const cache = useQueryClient();
  const [workspace, setWorkspace] = useState(props.initialWorkspace);
  const [header, setHeader] = useState<WorkspaceHeader>(props.initialWorkspace.header);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [editor, setEditor] = useState<Readonly<{ key: string; line?: WorkspaceLineView }>>();
  const [configurationApi] = useState(() => client.configurationApi(props.initialWorkspace.id));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<WorkspaceView>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [upload, setUpload] = useState<Readonly<{ file: File; requestId: string }>>();
  const [uploadLineId, setUploadLineId] = useState("");
  const [promotionAttempt, setPromotionAttempt] = useState<"quote" | "order">();
  const [receipt, setReceipt] = useState<WorkspacePromotionView["receipt"]>();
  const lock = useRef(false);
  const mounted = useRef(false);
  const request = useRef<Readonly<{ fingerprint: string; id: string }>>();
  const queryKey = salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, workspace.id);
  const customerId = header.customerContact?.customerId ?? "";
  const customers = useQuery({ queryKey: [...queryKey, "customers", customerQuery], queryFn: () => client.customers(organizationId, workspace.id, customerQuery), enabled: workspace.state === "draft", retry: false });
  const products = useQuery({ queryKey: [...queryKey, "products"], queryFn: () => client.products(organizationId, workspace.id), enabled: workspace.state === "draft", retry: false });
  const contacts = useQuery({ queryKey: [...queryKey, "contacts", customerId], queryFn: () => client.contacts(organizationId, workspace.id, customerId), enabled: Boolean(customerId) && workspace.state === "draft", retry: false });
  const canReadArtwork = capabilities.artworkView === true;
  const canAssignArtwork = canReadArtwork && capabilities.artworkAssign === true;
  const canRemoveArtwork = canAssignArtwork;
  // Uploads need a readable recovery surface; binding a file also requires assignment authority.
  const canUploadArtwork = canReadArtwork && capabilities.artworkAdopt === true && (!uploadLineId || canAssignArtwork);
  const artwork = useQuery({ queryKey: [...queryKey, "artwork"], queryFn: () => client.listArtwork(organizationId, workspace.id), enabled: canReadArtwork, retry: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = JSON.stringify(header) !== JSON.stringify(workspace.header);
  const promotionReceipt = receipt ?? workspace.promotion;
  const editable = workspace.state === "draft" && workspace.kind === "new_sales" && !receipt;
  const disabled = !editable || !csrfReady || Boolean(busy) || conflict || Boolean(promotionAttempt);
  const hasOverride = workspace.lines.some((line) => line.input.selling && line.input.selling.kind !== "calculated");
  const mutation = (operation: string, payload: unknown, revision = workspace.revision) => {
    const fingerprint = JSON.stringify([operation, revision, payload]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: newBusinessRequestId() };
    return { requestId: request.current.id, expectedRevision: revision };
  };
  const accept = (next: WorkspaceView) => {
    if (!owns(next, props) || next.id !== workspace.id) throw new Error("Workspace identity did not match the current session.");
    if (!mounted.current) return;
    setWorkspace(next); setHeader(next.header);
    cache.setQueryData(queryKey, next);
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork"] });
    request.current = undefined;
  };
  const run = async (label: string, work: () => Promise<void>) => {
    if (lock.current || !mounted.current) return;
    lock.current = true; setBusy(label); setError(""); setNotice("");
    try { await work(); }
    catch (failure) {
      if (mounted.current) {
        const detail = workspaceError(failure);
        setError(detail.message);
        if (detail.code === "CONFLICT" || detail.code === "STALE_STATE") setConflict(true);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(""); }
  };
  const persist = async () => {
    const saved = await client.saveDraft(organizationId, workspace.id, { ...mutation("save", header), header });
    accept(saved);
    return saved;
  };
  const promote = (target: "quote" | "order") => run(`Save ${target}`, async () => {
    if (!editable || !csrfReady || editor || upload || conflict || (promotionAttempt && promotionAttempt !== target)) return;
    if (target === "quote" ? capabilities.quoteCreate !== true || (hasOverride && !capabilities.quoteOverridePrice) : capabilities.orderCreate !== true || (hasOverride && !capabilities.orderOverridePrice)) return;
    const saved = dirty ? await persist() : workspace;
    if (!mounted.current) return;
    setPromotionAttempt(target);
    let result: WorkspacePromotionView;
    try {
      result = await client.promote(organizationId, { workspaceId: saved.id, target, ...mutation(`promote:${target}`, target, saved.revision) });
    } catch (failure) {
      // Definite owner rejections permit correction. Unknown outcomes retain the retry identity.
      if (mounted.current && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "WRONG_TENANT", "CONFLICT", "STALE_STATE"].includes(workspaceError(failure).code)) setPromotionAttempt(undefined);
      throw failure;
    }
    if (!mounted.current) return;
    if (result.receipt.workspaceId !== workspace.id || result.receipt.organizationId !== organizationId || result.receipt.target !== target) throw new Error("Promotion receipt did not match this workspace.");
    setReceipt(result.receipt);
    setPromotionAttempt(undefined);
    setWorkspace({ ...saved, state: "promoted", promotion: result.receipt });
    cache.setQueryData(queryKey, { ...saved, state: "promoted", promotion: result.receipt });
    props.openCanonical(result.receipt);
  });
  const storeLine = (input: QuoteLineMutationInput) => run("Store line", async () => {
    if (disabled || !editor) return;
    if (input.selling?.kind === "discount") throw new Error("This workspace does not support editing discounts.");
    const line: WorkspaceLineInput = { ...input, selling: input.selling };
    const payload = { header, line, ...(editor.line ? { lineId: editor.line.id } : {}) };
    const next = editor.line
      ? await client.updateLine(organizationId, workspace.id, { ...mutation("update-line", payload), header, line, lineId: editor.line.id })
      : await client.addLine(organizationId, workspace.id, { ...mutation("add-line", payload), header, line });
    accept(next);
    if (mounted.current) { setEditor(undefined); setNotice("Line and current header saved to the draft."); }
  });
  const changeLine = (lineId: string, direction?: -1 | 1) => run(direction ? "Reorder line" : "Remove line", async () => {
    if (disabled || editor) return;
    const lineIds = workspace.lines.map((line) => line.id);
    if (direction) {
      const index = lineIds.indexOf(lineId); const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= lineIds.length) return;
      [lineIds[index], lineIds[destination]] = [lineIds[destination]!, lineIds[index]!];
      accept(await client.reorderLines(organizationId, workspace.id, { ...mutation("reorder", { header, lineIds }), header, lineIds }));
    } else accept(await client.removeLine(organizationId, workspace.id, { ...mutation("remove", { header, lineId }), header, lineId }));
  });
  const applyArtworkRevision = (revision: number) => {
    if (!mounted.current) return;
    const next = { ...workspace, revision };
    setWorkspace(next); cache.setQueryData(queryKey, next);
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork"] });
  };
  const stage = () => run("Upload PDF", async () => {
    if (disabled || !upload || !canUploadArtwork || editor) return;
    const result = await client.uploadArtwork(organizationId, workspace.id, { requestId: upload.requestId, expectedRevision: workspace.revision, file: upload.file, ...(uploadLineId ? { workspaceLineId: uploadLineId } : {}) });
    applyArtworkRevision(result.workspaceRevision);
    if (mounted.current) { setUpload(undefined); setNotice("PDF staged in the workspace. No canonical Artwork was created."); }
  });
  const changeHeader = (patch: Partial<WorkspaceHeader>) => { setHeader((current) => ({ ...current, ...patch })); setNotice(""); };
  const fulfillment = header.requestedFulfillment;
  const patchDestination = (field: string, value: string) => changeHeader({ requestedFulfillment: { ...fulfillment!, destination: { addressLine1: "", city: "", ...fulfillment?.destination, [field]: value } } });
  const finalDisabled = !editable || !csrfReady || Boolean(busy) || Boolean(editor) || Boolean(upload) || conflict;
  return <section className="lab v2-sales-entry" aria-label="Transactional Sales workspace" aria-busy={Boolean(busy)}>
    <header className="v2-sales-entry-header"><div><button className="link-button" disabled={Boolean(busy) || dirty || Boolean(editor) || Boolean(upload) || Boolean(promotionAttempt)} onClick={props.onBack}>Back to drafts</button><h1>{header.jobLabel || "Sales Workspace"}</h1><p>{promotionReceipt ? `Promoted from draft revision ${promotionReceipt.inputRevision}.` : `Draft revision ${workspace.revision}. Expires ${workspace.expiresAt.slice(0, 10)}. Nothing is a Quote or Order until explicitly saved as one.`}</p></div>
      <div className="actions"><button className="button secondary" disabled={finalDisabled || Boolean(promotionAttempt)} onClick={() => void run("Save Draft", async () => { if (disabled || editor) return; await persist(); if (mounted.current) setNotice("Draft saved. Resume it from this workspace URL."); })}>Save Draft</button>
        <button className="button" disabled={finalDisabled || capabilities.quoteCreate !== true || (hasOverride && !capabilities.quoteOverridePrice) || promotionAttempt === "order"} onClick={() => void promote("quote")}>Save Quote</button>
        <button className="button" disabled={finalDisabled || capabilities.orderCreate !== true || (hasOverride && !capabilities.orderOverridePrice) || promotionAttempt === "quote"} onClick={() => void promote("order")}>Save Order</button>
        <button className="button secondary" disabled={disabled} onClick={() => setConfirmDiscard(true)}>Discard</button></div>
    </header>
    {busy && <p role="status">{busy}...</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error} Your local fields have not been replaced.</p>}
    {(conflict || promotionAttempt) && !receipt && <section className="notice" aria-label="Workspace recovery"><p>{conflict ? "The draft or its pricing evidence changed. Local edits are retained. Review the latest saved version before continuing." : "Promotion may have completed. Retry the same Save action or review the server version before making further changes."}</p><button className="button secondary" disabled={Boolean(busy)} onClick={() => void run("Read latest", async () => { const value = await client.read(organizationId, workspace.id); if (!owns(value, props)) throw new Error("Workspace identity did not match the current session."); if (mounted.current) setLatest(value); })}>Review latest saved version</button>
      {latest && <div><h3>Latest Saved Version</h3><p>Revision {latest.revision}: {latest.header.jobLabel || "Untitled"}. {latest.lines.length} items. State: {latest.state}.</p><pre>{JSON.stringify(latest.header, null, 2)}</pre><button className="button secondary" disabled={Boolean(busy)} onClick={() => { accept(latest); setEditor(undefined); setUpload(undefined); setConflict(false); setPromotionAttempt(undefined); setLatest(undefined); setError(""); }}>Use latest and discard local changes</button></div>}
    </section>}
    {confirmDiscard && <section className="notice" aria-label="Discard confirmation"><p>Discard this TEMP workspace and release staged files? This does not delete any canonical Quote or Order.</p><button className="button" disabled={disabled} onClick={() => void run("Discard", async () => { if (disabled) return; accept(await client.discard(organizationId, workspace.id, mutation("discard", null))); if (mounted.current) { setConfirmDiscard(false); setEditor(undefined); setUpload(undefined); setNotice("Workspace discarded. No canonical document was changed."); } })}>Confirm Discard</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => setConfirmDiscard(false)}>Keep draft</button></section>}
    {promotionReceipt && <p className="notice">Saved as {promotionReceipt.target} {promotionReceipt.displayNumber ?? promotionReceipt.documentId}.<button className="button" onClick={() => props.openCanonical(promotionReceipt)}>Open saved document</button></p>}
    {!editable && <p className="notice">Workspace state: {workspace.state}.{workspace.kind !== "new_sales" ? " Transactional editing of existing documents is not available in this entry." : ""}</p>}
    <fieldset disabled={disabled}>
      <legend>Sales Details</legend>
      <div className="v2-sales-entry-meta">
        <label className="field">Search customers<input value={customerSearch} maxLength={200} onChange={(event) => setCustomerSearch(event.target.value)} /></label>
        <button className="button secondary" onClick={() => setCustomerQuery(customerSearch.trim())}>Search Customers</button>
        <SelectionField label="Customer" value={customerId} identity="customerId" emptyLabel="Select Customer" options={customerId && !(customers.data ?? []).some((customer) => customer.customerId === customerId) ? [{ customerId, displayName: `Saved Customer (${customerId})` }, ...(customers.data ?? [])] : customers.data ?? []} onChange={(value) => changeHeader({ customerContact: value ? { organizationId, customerId: value } : undefined })} />
        <label className="field">Contact<select aria-label="Contact" value={header.customerContact?.contactId ?? ""} disabled={!customerId || contacts.isFetching} onChange={(event) => changeHeader({ customerContact: { organizationId, customerId, ...(event.target.value ? { contactId: event.target.value } : {}) } })}><option value="">No contact selected</option>{header.customerContact?.contactId && !(contacts.data ?? []).some((contact) => contact.contactId === header.customerContact?.contactId) && <option value={header.customerContact.contactId}>Saved contact ({header.customerContact.contactId})</option>}{(contacts.data ?? []).map((contact) => contact.contactId && <option key={contact.contactId} value={contact.contactId}>{contact.displayName}</option>)}</select></label>
        <label className="field">PO #<input value={header.purchaseOrderNumber ?? ""} maxLength={200} onChange={(event) => changeHeader({ purchaseOrderNumber: event.target.value })} /></label>
        <label className="field">Job Label<input value={header.jobLabel ?? ""} maxLength={300} onChange={(event) => changeHeader({ jobLabel: event.target.value })} /></label>
        <label className="field">Requested Due<input type="date" value={header.requestedDueDate?.slice(0, 10) ?? ""} onChange={(event) => changeHeader({ requestedDueDate: event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined })} /></label>
        <label className="field">Fulfillment<select value={fulfillment?.method ?? ""} onChange={(event) => changeHeader({ requestedFulfillment: event.target.value ? { method: event.target.value as NonNullable<WorkspaceHeader["requestedFulfillment"]>["method"], ...(fulfillment?.instructions ? { instructions: fulfillment.instructions } : {}) } : undefined })}><option value="">Not specified</option><option value="pickup">Pickup</option><option value="shipping">Shipping</option><option value="local_delivery">Local delivery</option></select></label>
        {fulfillment && <label className="field">Fulfillment instructions<textarea value={fulfillment.instructions ?? ""} maxLength={2000} onChange={(event) => changeHeader({ requestedFulfillment: { ...fulfillment, instructions: event.target.value } })} /></label>}
        {fulfillment && fulfillment.method !== "pickup" && ([['recipient', 'Recipient'], ['company', 'Company'], ['addressLine1', 'Street'], ['addressLine2', 'Address line 2'], ['city', 'City'], ['region', 'Region'], ['postalCode', 'Postal code'], ['country', 'Country'], ['phone', 'Phone']] as const).map(([field, label]) => <label className="field" key={field}>{label}<input value={fulfillment.destination?.[field] ?? ""} onChange={(event) => patchDestination(field, event.target.value)} /></label>)}
        <label className="field">Terms code<input value={header.terms?.termsCode ?? ""} maxLength={100} onChange={(event) => changeHeader({ terms: { ...header.terms, termsCode: event.target.value } })} /></label>
      </div>
      {contacts.isError && <p className="notice error" role="alert">Contacts could not be loaded. The saved reference is retained.</p>}
      {customers.isError && <p className="notice error" role="alert">Customers could not be loaded.<button onClick={() => void customers.refetch()}>Retry Customers</button></p>}
      <label className="field v2-sales-entry-notes">Commercial notes<textarea value={header.terms?.commercialNotes ?? ""} maxLength={4000} onChange={(event) => changeHeader({ terms: { ...header.terms, commercialNotes: event.target.value } })} /></label>
      <label className="field v2-sales-entry-notes">Workspace notes<textarea value={header.notes ?? ""} maxLength={4000} onChange={(event) => changeHeader({ notes: event.target.value })} /></label>
    </fieldset>
    <section className="v2-sales-entry-items"><header><div><h2>Items</h2><p>Stable TEMP lines belong only to this workspace.</p></div><span>{workspace.lines.length} stored</span></header>
      {JSON.stringify(header.customerContact) !== JSON.stringify(workspace.header.customerContact) && <p className="notice">The customer or contact has unsaved changes. Displayed previews use the saved workspace context. Store line or Refresh server previews saves the current header and recalculates on the server.</p>}
      <ol className="v2-sales-entry-list">{workspace.lines.map((line, index) => <li key={line.id} data-workspace-line-id={line.id}><div><b>{line.input.description || products.data?.find((product) => product.productId === line.input.productId)?.displayName || line.input.productId}</b><small>Quantity {line.input.quantity}{line.input.dimensions ? ` / ${line.input.dimensions.width} x ${line.input.dimensions.height} ${line.input.dimensions.unit}` : ""}</small>
        {(["quote", "order"] as const).map((target) => { const preview = line.previews?.[target]; return <small key={target}>{target === "quote" ? "Quote" : "Order"} server preview: {preview ? money(preview.sellingPriceDecision.resultingLineAmount) : "Refresh required"}</small>; })}
      </div><div className="actions"><button disabled={disabled || Boolean(editor)} onClick={() => setEditor({ key: newBusinessRequestId(), line })}>Edit item {index + 1}</button><button disabled={disabled || Boolean(editor) || index === 0} onClick={() => void changeLine(line.id, -1)}>Move item {index + 1} up</button><button disabled={disabled || Boolean(editor) || index === workspace.lines.length - 1} onClick={() => void changeLine(line.id, 1)}>Move item {index + 1} down</button><button disabled={disabled || Boolean(editor)} onClick={() => void changeLine(line.id)}>Remove item {index + 1}</button></div></li>)}</ol>
      {products.isError && <p className="notice error" role="alert">Products could not be loaded.<button onClick={() => void products.refetch()}>Retry Products</button></p>}
      <button className="button secondary" disabled={disabled || Boolean(editor)} onClick={() => setEditor({ key: newBusinessRequestId() })}>Add Item</button>
      <button className="button secondary" disabled={disabled || Boolean(editor) || !workspace.lines.length} onClick={() => void run("Refresh previews", async () => { if (disabled) return; accept(await client.refreshLines(organizationId, workspace.id, { ...mutation("refresh", header), header })); })}>Refresh server previews</button>
      {editor && <fieldset className="v2-sales-entry-composer" disabled={disabled}><legend>{editor.line ? "Edit TEMP item" : "Add TEMP item"}</legend><p className="notice">Store this line or cancel it before Save Draft, Save Quote or Save Order. Store line also saves the current header atomically.</p><QuoteLineEditor organizationId={organizationId} sessionScope={sessionScope} draftKey={editor.key} initialDraft={editor.line ? lineDraft(editor.line.input) : emptyQuoteLineDraft()} initializeFromPersistedLine={Boolean(editor.line)} products={products.data ?? []} configurationApi={configurationApi} configurationScope={`sales-workspace:${userId}:${workspace.id}`} canOverridePrice={(capabilities.quoteCreate === true && capabilities.quoteOverridePrice === true) || (capabilities.orderCreate === true && capabilities.orderOverridePrice === true)} csrfReady={csrfReady} busy={Boolean(busy)} submitLabel="Store line" onSubmit={(input) => void storeLine(input)} onCancel={() => setEditor(undefined)} /></fieldset>}
      {hasOverride && <p className="notice">Each final target requires its own price-override permission. Preview amounts are server evidence, not a guarantee if pricing changes before promotion.</p>}
    </section>
    <section className="v2-sales-entry-items" aria-label="Staged PDFs">
      <h2>Staged PDFs</h2>
      <p>Hard limit: one unlayered PDF per TEMP line. PDFs stay in this workspace until promotion. Workspace-level files must be assigned to distinct TEMP lines before saving as a Quote or Order.</p>
      {!canReadArtwork && <p className="notice">Artwork view permission is required to list staged PDFs or upload files in this workspace. Other Sales draft actions remain available.</p>}
      {canReadArtwork && capabilities.artworkAdopt !== true && <p className="notice">Artwork adopt permission is required to upload new PDFs. Existing files remain available according to your permissions.</p>}
      {canReadArtwork && !canAssignArtwork && <p className="notice">Artwork assign permission is required to bind uploads to a TEMP line, assign staged files, or remove them. Workspace-level uploads may be staged with Artwork adopt permission, but must be assigned before promotion.</p>}
      <fieldset disabled={disabled || Boolean(editor) || !canReadArtwork || capabilities.artworkAdopt !== true}>
        <legend>Upload PDF</legend>
        <label className="field">Attach to
          <select value={uploadLineId} onChange={(event) => { setUploadLineId(event.target.value); if (upload) setUpload({ ...upload, requestId: newBusinessRequestId() }); }}>
            <option value="">Workspace (assign to a line later)</option>
            {workspace.lines.map((line, index) => <option key={line.id} value={line.id} disabled={!canAssignArtwork}>Item {index + 1}: {line.input.description || line.input.productId}</option>)}
          </select>
        </label>
        <label className="field">PDF file<input type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; setUpload(file ? { file, requestId: newBusinessRequestId() } : undefined); }} /></label>
        <button className="button secondary" disabled={!upload || !canUploadArtwork} onClick={() => void stage()}>Upload staged PDF</button>
      </fieldset>
      {upload && <div><p>{upload.file.name} (not uploaded)</p><button disabled={Boolean(busy)} onClick={() => setUpload(undefined)}>Cancel selected file</button></div>}
      {canReadArtwork && artwork.isError && <p className="notice error" role="alert">Staged files could not be loaded.<button onClick={() => void artwork.refetch()}>Retry staged files</button></p>}
      {canReadArtwork && <ul>{(artwork.data ?? []).filter((claim) => claim.state !== "deleted" && claim.state !== "cleanup_pending").map((claim) => <li key={claim.id}>
        <span>{claim.filename}: {claim.state}</span>
        {!claim.workspaceLineId && claim.state === "uploaded" && <label className="field">Assign {claim.filename}
          <select value="" disabled={disabled || Boolean(editor) || !canAssignArtwork} onChange={(event) => {
            const workspaceLineId = event.target.value;
            if (!workspaceLineId || disabled || editor || !canAssignArtwork) return;
            void run("Assign staged PDF", async () => {
              const result = await client.assignArtwork(organizationId, { workspaceId: workspace.id, claimId: claim.id, workspaceLineId, ...mutation("assign-artwork", { claimId: claim.id, workspaceLineId }) });
              applyArtworkRevision(result.workspaceRevision);
            });
          }}>
            <option value="">Select TEMP line</option>
            {workspace.lines.map((line, index) => <option key={line.id} value={line.id}>Item {index + 1}</option>)}
          </select>
        </label>}
        <button disabled={disabled || Boolean(editor) || !canRemoveArtwork} onClick={() => void run("Remove staged PDF", async () => {
          if (disabled || editor || !canRemoveArtwork) return;
          const result = await client.removeArtwork(organizationId, { workspaceId: workspace.id, claimId: claim.id, ...mutation("remove-artwork", claim.id) });
          applyArtworkRevision(result.workspaceRevision);
        })}>Remove {claim.filename}</button>
      </li>)}</ul>}
    </section>
  </section>;
};
