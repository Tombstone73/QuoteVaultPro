import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newBusinessRequestId, type UiBootstrap } from "./api";
import { SelectionField } from "./SelectionField";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { emptyQuoteLineDraft, type QuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import { workspaceNavigationEvent } from "./workspaceNavigation";
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
  capabilities: Pick<UiBootstrap["capabilities"], "quoteCreate" | "orderCreate" | "quoteOverridePrice" | "orderOverridePrice" | "artworkView" | "artworkAdopt" | "artworkAssign" | "orderView" | "orderEdit">;
  csrfReady: boolean;
  workspaceId?: string;
  onWorkspaceIdChange?: (workspaceId: string | undefined) => void;
  sourceOrderId?: string;
  onReturnToOrder?: () => void;
  openCanonical: (receipt: NonNullable<WorkspaceView["promotion"]>) => void;
}>;

const owns = (workspace: WorkspaceView, props: TransactionalSalesWorkspaceProps) =>
  workspace.organizationId === props.organizationId && workspace.creatorUserId === props.userId;
const matchesSource = (workspace: WorkspaceView, props: TransactionalSalesWorkspaceProps) => props.sourceOrderId
  ? workspace.kind === "order_edit" && workspace.sourceDocumentKind === "order" && workspace.sourceDocumentId === props.sourceOrderId && (!workspace.promotion || (workspace.promotion.target === "order" && workspace.promotion.documentId === props.sourceOrderId))
  : workspace.kind === "new_sales";
const urlWorkspaceId = () => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("workspaceId") ?? "";

/** Session changes remount local drafts as well as isolate every workspace cache key. */
export const TransactionalSalesWorkspace = (props: TransactionalSalesWorkspaceProps) => {
  if (!props.organizationId || !props.sessionScope || !props.userId)
    return <p className="notice">An authenticated organization and staff session are required.</p>;
  if (props.sourceOrderId && (props.capabilities.orderView !== true || props.capabilities.orderEdit !== true))
    return <p className="notice error" role="alert">Order view and edit permission are required to open this edit workspace.</p>;
  if (!props.sourceOrderId && props.capabilities.quoteCreate !== true && props.capabilities.orderCreate !== true)
    return <p className="notice">You do not have permission to create a Sales workspace.</p>;
  return <WorkspaceSession key={JSON.stringify([props.organizationId, props.sessionScope, props.userId, props.sourceOrderId])} {...props} />;
};

const WorkspaceSession = (props: TransactionalSalesWorkspaceProps) => {
  const { client, organizationId, sessionScope, userId } = props;
  const cache = useQueryClient();
  const [activeId, setActiveId] = useState(() => props.workspaceId ?? urlWorkspaceId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const leaveAllowed = useRef(false);
  const creating = useRef(false);
  const creationRequest = useRef("");
  const mounted = useRef(false);
  const scopeKey = salesWorkspaceKeys.scope(sessionScope, organizationId, userId);
  const list = useQuery({ queryKey: [...scopeKey, "list"], queryFn: () => client.list(organizationId), enabled: !activeId && !props.sourceOrderId, retry: false, refetchOnWindowFocus: false });
  const read = useQuery({ queryKey: salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, activeId), queryFn: () => client.read(organizationId, activeId), enabled: Boolean(activeId), retry: false, refetchOnWindowFocus: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editorVisible = Boolean(read.data && !read.isError && owns(read.data, props) && matchesSource(read.data, props));
  useEffect(() => {
    if (!activeId || !editorVisible) return;
    const beforeNavigation = (event: Event) => {
      if (leaveAllowed.current) return;
      event.preventDefault();
      setNavigationError("Local edits or an uncertain Save are still open. Save Draft, complete Save, or discard before leaving this workspace.");
    };
    window.addEventListener(workspaceNavigationEvent, beforeNavigation);
    return () => window.removeEventListener(workspaceNavigationEvent, beforeNavigation);
  }, [activeId, editorVisible]);
  useEffect(() => {
    const resume = () => {
      const incoming = props.workspaceId ?? urlWorkspaceId();
      if (incoming === activeId) return;
      if (activeId && !leaveAllowed.current) {
        const url = new URL(window.location.href); url.searchParams.set("workspaceId", activeId);
        window.history.replaceState(window.history.state, "", url);
        setNavigationError("Local edits or an uncertain Save are still open. Save Draft, complete Save, or discard before switching workspaces.");
        props.onWorkspaceIdChange?.(activeId);
        return;
      }
      leaveAllowed.current = false; setNavigationError(""); setActiveId(incoming);
    };
    if (props.workspaceId !== undefined) { resume(); return; }
    window.addEventListener("popstate", resume);
    return () => window.removeEventListener("popstate", resume);
  }, [props.workspaceId, activeId]);
  const navigate = (id?: string) => {
    if (!mounted.current) return;
    leaveAllowed.current = false; setNavigationError("");
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
    if (read.isError) return <section className="lab"><p className="notice error" role="alert">{workspaceError(read.error).message}</p><button className="button" onClick={() => void read.refetch()}>Retry workspace load</button>{!props.sourceOrderId && <button className="button secondary" onClick={() => navigate()}>Back to drafts</button>}</section>;
    if (!read.data) return <p role="status">Loading Sales workspace...</p>;
    if (!owns(read.data, props)) return <p className="notice error" role="alert">Workspace identity did not match the current session.</p>;
    if (!matchesSource(read.data, props)) return <p className="notice error" role="alert">Workspace source conflict: this draft does not belong to the Order in this path. No draft fields have been opened.</p>;
    return <>{navigationError && <p className="notice error" role="alert">{navigationError}</p>}<WorkspaceEditor key={activeId} {...props} initialWorkspace={read.data} onLeaveStateChange={allowed => { leaveAllowed.current = allowed; }} onBack={() => { void cache.invalidateQueries({ queryKey: [...scopeKey, "list"] }); navigate(); }} /></>;
  }
  if (props.sourceOrderId) return <p className="notice error" role="alert">An existing Order edit workspace ID is required. Open Edit Order from the Order view.</p>;
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

const WorkspaceEditor = (props: TransactionalSalesWorkspaceProps & Readonly<{ initialWorkspace: WorkspaceView; onBack: () => void; onLeaveStateChange: (allowed: boolean) => void }>) => {
  const { client, organizationId, sessionScope, userId, capabilities, csrfReady } = props;
  const cache = useQueryClient();
  const [workspace, setWorkspace] = useState(props.initialWorkspace);
  const [header, setHeader] = useState<WorkspaceHeader>(props.initialWorkspace.header);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [editor, setEditor] = useState<Readonly<{ key: string; line?: WorkspaceLineView; presentation?: boolean; description?: string; operationalNote?: string }>>();
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
  const [draftAcknowledged, setDraftAcknowledged] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const request = useRef<Readonly<{ fingerprint: string; id: string }>>();
  const queryKey = salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, workspace.id);
  const customerId = header.customerContact?.customerId ?? "";
  const customers = useQuery({ queryKey: [...queryKey, "customers", customerQuery], queryFn: () => client.customers(organizationId, workspace.id, customerQuery), enabled: workspace.state === "draft", retry: false });
  const needsProducts = workspace.kind !== "order_edit" || Boolean(editor && !editor.presentation);
  const products = useQuery({ queryKey: [...queryKey, "products"], queryFn: () => client.products(organizationId, workspace.id), enabled: workspace.state === "draft" && needsProducts, retry: false });
  const contacts = useQuery({ queryKey: [...queryKey, "contacts", customerId], queryFn: () => client.contacts(organizationId, workspace.id, customerId), enabled: Boolean(customerId) && workspace.state === "draft", retry: false });
  const canReadArtwork = capabilities.artworkView === true;
  const canAssignArtwork = canReadArtwork && capabilities.artworkAssign === true;
  const canRemoveArtwork = canAssignArtwork;
  // Uploads need a readable recovery surface; binding a file also requires assignment authority.
  const canUploadArtwork = canReadArtwork && capabilities.artworkAdopt === true && (!uploadLineId || canAssignArtwork);
  const artwork = useQuery({ queryKey: [...queryKey, "artwork"], queryFn: () => client.listArtwork(organizationId, workspace.id), enabled: canReadArtwork, retry: false });
  const editArtwork = useQuery({ queryKey: [...queryKey, "artwork-edit"], queryFn: () => {
    if (!client.readEditRefs) throw new Error("Artwork edit references are not configured. Existing files remain unchanged.");
    return client.readEditRefs(organizationId, workspace.id);
  }, enabled: workspace.kind === "order_edit" && canReadArtwork, retry: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = JSON.stringify(header) !== JSON.stringify(workspace.header);
  const promotionReceipt = receipt ?? workspace.promotion;
  const orderEdit = workspace.kind === "order_edit";
  const editable = workspace.state === "draft" && matchesSource(workspace, props) && !receipt;
  const disabled = !editable || !csrfReady || Boolean(busy) || conflict || Boolean(promotionAttempt);
  const hasOverride = workspace.lines.some((line) => line.input.selling && line.input.selling.kind !== "calculated" && (!orderEdit || !line.sourceLineSnapshot || line.previews?.order));
  useEffect(() => {
    if (!orderEdit || !editable) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (!dirty && !editor && !upload && !promotionAttempt && !busy && draftAcknowledged) return;
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [orderEdit, editable, dirty, editor, upload, promotionAttempt, busy, draftAcknowledged]);
  const mutation = (operation: string, payload: unknown, revision = workspace.revision) => {
    const fingerprint = JSON.stringify([operation, revision, payload]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: newBusinessRequestId() };
    return { requestId: request.current.id, expectedRevision: revision };
  };
  const accept = (next: WorkspaceView) => {
    if (!owns(next, props) || next.id !== workspace.id || !matchesSource(next, props)) throw new Error("Workspace identity or source did not match the current session.");
    if (!mounted.current) return;
    setWorkspace(next); setHeader(next.header); setDraftAcknowledged(false);
    cache.setQueryData(queryKey, next);
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork"] });
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork-edit"] });
    request.current = undefined;
  };
  const run = async (label: string, work: () => Promise<void>) => {
    if (lock.current || !mounted.current) return;
    props.onLeaveStateChange(false);
    lock.current = true; setBusy(label); setError(""); setNotice("");
    try { await work(); }
    catch (failure) {
      if (mounted.current) {
        const detail = workspaceError(failure);
        setError(`${detail.message}${detail.reason ? ` Block reason: ${detail.reason}.` : ""}`);
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
    if (orderEdit ? target !== "order" || capabilities.orderView !== true || capabilities.orderEdit !== true || (hasOverride && !capabilities.orderOverridePrice)
      : target === "quote" ? capabilities.quoteCreate !== true || (hasOverride && !capabilities.quoteOverridePrice) : capabilities.orderCreate !== true || (hasOverride && !capabilities.orderOverridePrice)) return;
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
    if (result.receipt.workspaceId !== workspace.id || result.receipt.organizationId !== organizationId || result.receipt.target !== target || (orderEdit && result.receipt.documentId !== props.sourceOrderId)) throw new Error("Promotion receipt did not match this workspace and source Order.");
    setReceipt(result.receipt);
    setPromotionAttempt(undefined);
    setWorkspace({ ...saved, state: "promoted", promotion: result.receipt });
    cache.setQueryData(queryKey, { ...saved, state: "promoted", promotion: result.receipt });
    props.onLeaveStateChange(true);
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
  const storePresentation = () => run("Store line details", async () => {
    if (disabled || !editor?.line || !editor.presentation) return;
    const line = { ...editor.line.input, description: editor.description ?? editor.line.input.description };
    const payload = { header, line, lineId: editor.line.id, operationalNote: editor.operationalNote ?? "" };
    accept(await client.updateLine(organizationId, workspace.id, { ...mutation("update-line", payload), ...payload }));
    if (mounted.current) { setEditor(undefined); setNotice("Line description and note stored in TEMP. Historical pricing and configuration are retained."); }
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
    setWorkspace(next); setDraftAcknowledged(false); cache.setQueryData(queryKey, next);
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork"] });
    void cache.invalidateQueries({ queryKey: [...queryKey, "artwork-edit"] });
  };
  const stage = () => run("Upload PDF", async () => {
    if (disabled || !upload || !canUploadArtwork || editor) return;
    const result = await client.uploadArtwork(organizationId, workspace.id, { requestId: upload.requestId, expectedRevision: workspace.revision, file: upload.file, ...(uploadLineId ? { workspaceLineId: uploadLineId } : {}) });
    applyArtworkRevision(result.workspaceRevision);
    if (mounted.current) { setUpload(undefined); setNotice("PDF staged in the workspace. No canonical Artwork was created."); }
  });
  const changeHeader = (patch: Partial<WorkspaceHeader>) => { props.onLeaveStateChange(false); setHeader((current) => ({ ...current, ...patch })); setDraftAcknowledged(false); setNotice(""); };
  const fulfillment = header.requestedFulfillment;
  const patchDestination = (field: string, value: string) => changeHeader({ requestedFulfillment: { ...fulfillment!, destination: { addressLine1: "", city: "", ...fulfillment?.destination, [field]: value } } });
  const finalDisabled = !editable || !csrfReady || Boolean(busy) || Boolean(editor) || Boolean(upload) || conflict;
  const canLeave = !busy && !dirty && !editor && !upload && !promotionAttempt && (!orderEdit || draftAcknowledged || workspace.state !== "draft");
  useEffect(() => {
    props.onLeaveStateChange(canLeave);
    return () => props.onLeaveStateChange(false);
  }, [canLeave, props.onLeaveStateChange]);
  const canDiscard = editable && csrfReady && !busy && !promotionAttempt;
  return <section className="lab v2-sales-entry" aria-label="Transactional Sales workspace" aria-busy={Boolean(busy)}>
    <header className="v2-sales-entry-header"><div><button className="link-button" disabled={!canLeave} onClick={orderEdit ? props.onReturnToOrder : props.onBack}>{orderEdit ? "Back to Order" : "Back to drafts"}</button><h1>{orderEdit ? `Editing ${workspace.sourceHeader?.orderNumber ?? props.sourceOrderId}` : header.jobLabel || "Sales Workspace"}</h1><p>{promotionReceipt ? `Promoted from draft revision ${promotionReceipt.inputRevision}.` : orderEdit ? `TEMP draft revision ${workspace.revision}. Source revision ${workspace.baseRevision}. Save applies the whole edit to the same Order; Cancel leaves it unchanged.` : `Draft revision ${workspace.revision}. Expires ${workspace.expiresAt.slice(0, 10)}. Nothing is a Quote or Order until explicitly saved as one.`}</p></div>
      <div className="actions"><button className="button secondary" disabled={finalDisabled || Boolean(promotionAttempt)} onClick={() => void run("Save Draft", async () => { if (disabled || editor) return; await persist(); if (mounted.current) { setDraftAcknowledged(true); setNotice("Draft saved. Resume it from this workspace URL or Edit Order."); } })}>Save Draft</button>
        {!orderEdit && <button className="button" disabled={finalDisabled || capabilities.quoteCreate !== true || (hasOverride && !capabilities.quoteOverridePrice) || promotionAttempt === "order"} onClick={() => void promote("quote")}>Save Quote</button>}
        <button className="button" disabled={finalDisabled || (orderEdit ? capabilities.orderView !== true || capabilities.orderEdit !== true : capabilities.orderCreate !== true) || (hasOverride && !capabilities.orderOverridePrice) || promotionAttempt === "quote"} onClick={() => void promote("order")}>{orderEdit ? "Save" : "Save Order"}</button>
        <button className="button secondary" disabled={!canDiscard} onClick={() => setConfirmDiscard(true)}>{orderEdit ? "Cancel" : "Discard"}</button></div>
    </header>
    {busy && <p role="status">{busy}...</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error} Your local fields have not been replaced.</p>}
    {(conflict || promotionAttempt) && !receipt && <section className="notice" aria-label="Workspace recovery"><p>{conflict ? `${orderEdit ? "Save is blocked by an owner rule or stale evidence." : "The draft or its pricing evidence changed."} Local edits are retained. Review the latest saved version before continuing.${orderEdit ? " A stale source cannot be rebased automatically. Keep this draft for comparison, or Cancel and reopen Edit Order to capture a fresh source." : ""}` : "Promotion may have completed. Retry the same Save action or review the server version before making further changes. Do not Cancel or leave until the Save outcome is confirmed."}</p><button className="button secondary" disabled={Boolean(busy)} onClick={() => void run("Read latest", async () => { const value = await client.read(organizationId, workspace.id); if (!owns(value, props) || !matchesSource(value, props) || value.id !== workspace.id) throw new Error("Workspace identity or source did not match the current session."); if (mounted.current) setLatest(value); })}>Review latest saved version</button>
      {latest && <div><h3>Latest Saved Version</h3><p>Revision {latest.revision}: {latest.header.jobLabel || "Untitled"}. {latest.lines.length} items. State: {latest.state}.</p><pre>{JSON.stringify(latest.header, null, 2)}</pre><button className="button secondary" disabled={Boolean(busy)} onClick={() => { accept(latest); setEditor(undefined); setUpload(undefined); setConflict(false); setPromotionAttempt(undefined); setLatest(undefined); setError(""); }}>Use latest and discard local changes</button></div>}
    </section>}
    {confirmDiscard && <section className="notice" aria-label="Discard confirmation"><p>Discard this TEMP workspace and release staged files? This does not delete any canonical Quote or Order.</p><button className="button" disabled={!canDiscard} onClick={() => void run("Discard", async () => {
      if (!canDiscard) return;
      const current = conflict ? await client.read(organizationId, workspace.id) : workspace;
      if (!owns(current, props) || !matchesSource(current, props) || current.id !== workspace.id || current.state !== "draft") throw new Error("The draft state must be confirmed before it can be discarded.");
      accept(await client.discard(organizationId, workspace.id, mutation("discard", null, current.revision)));
      if (mounted.current) { props.onLeaveStateChange(true); setConfirmDiscard(false); setEditor(undefined); setUpload(undefined); setNotice("Workspace discarded. No canonical document was changed."); if (orderEdit) props.onReturnToOrder?.(); }
    })}>{orderEdit ? "Confirm Cancel" : "Confirm Discard"}</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => setConfirmDiscard(false)}>Keep draft</button></section>}
    {promotionReceipt && <p className="notice">Saved as {promotionReceipt.target} {promotionReceipt.displayNumber ?? promotionReceipt.documentId}.<button className="button" onClick={() => props.openCanonical(promotionReceipt)}>Open saved document</button></p>}
    {!editable && <p className="notice">Workspace state: {workspace.state}.</p>}
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
      {orderEdit && workspace.sourceHeader?.sellingAdjustment && <p className="notice">Existing selling adjustment {money({ cents: workspace.sourceHeader.sellingAdjustment.cents, currency: workspace.sourceHeader.currency })}: {workspace.sourceHeader.sellingAdjustment.reason}. It is retained unchanged; adjustment editing is not exposed by this TEMP header contract.</p>}
      <label className="field v2-sales-entry-notes">Workspace notes<textarea value={header.notes ?? ""} maxLength={4000} onChange={(event) => changeHeader({ notes: event.target.value })} /></label>
    </fieldset>
    <section className="v2-sales-entry-items"><header><div><h2>Items</h2><p>Stable TEMP lines belong only to this workspace.</p></div><span>{workspace.lines.length} stored</span></header>
      {JSON.stringify(header.customerContact) !== JSON.stringify(workspace.header.customerContact) && <p className="notice">The customer or contact has unsaved changes. Displayed previews use the saved workspace context.{orderEdit ? " Historical source prices remain frozen. Save may block a combined customer and commercial-line change pending owner reconciliation." : " Store line or Refresh server previews saves the current header and recalculates on the server."}</p>}
      <ol className="v2-sales-entry-list">{workspace.lines.map((line, index) => <li key={line.id} data-workspace-line-id={line.id}><div><b>{line.input.description || products.data?.find((product) => product.productId === line.input.productId)?.displayName || line.input.productId}</b><small>Quantity {line.input.quantity}{line.input.dimensions ? ` / ${line.input.dimensions.width} x ${line.input.dimensions.height} ${line.input.dimensions.unit}` : ""}</small>
        {orderEdit && line.sourceLineSnapshot && !line.previews?.order ? <small>Historical {line.sourceLineSnapshot.sellingPriceDecision.kind} price: {money(line.sourceLineSnapshot.sellingLineAmount)}. Frozen configuration and Product version retained.</small> : (orderEdit ? ["order"] as const : ["quote", "order"] as const).map((target) => { const preview = line.previews?.[target]; return <small key={target}>{target === "quote" ? "Quote" : "Order"} server preview: {preview ? money(preview.sellingPriceDecision.resultingLineAmount) : "Refresh required"}</small>; })}
      </div><div className="actions"><button disabled={disabled || Boolean(editor)} onClick={() => { props.onLeaveStateChange(false); setEditor({ key: newBusinessRequestId(), line, ...(orderEdit && line.sourceLineSnapshot ? { presentation: true, description: line.input.description ?? "", operationalNote: line.operationalNote ?? "" } : {}) }); }}>Edit item {index + 1}</button><button disabled={disabled || Boolean(editor) || index === 0} onClick={() => void changeLine(line.id, -1)}>Move item {index + 1} up</button><button disabled={disabled || Boolean(editor) || index === workspace.lines.length - 1} onClick={() => void changeLine(line.id, 1)}>Move item {index + 1} down</button><button disabled={disabled || Boolean(editor)} onClick={() => void changeLine(line.id)}>Remove item {index + 1}</button></div></li>)}</ol>
      {needsProducts && products.isError && <p className="notice error" role="alert">Products could not be loaded.<button onClick={() => void products.refetch()}>Retry Products</button></p>}
      <button className="button secondary" disabled={disabled || Boolean(editor)} onClick={() => { props.onLeaveStateChange(false); setEditor({ key: newBusinessRequestId() }); }}>Add Item</button>
      {!orderEdit && <button className="button secondary" disabled={disabled || Boolean(editor) || !workspace.lines.length} onClick={() => void run("Refresh previews", async () => { if (disabled) return; accept(await client.refreshLines(organizationId, workspace.id, { ...mutation("refresh", header), header })); })}>Refresh server previews</button>}
      {editor && <fieldset className="v2-sales-entry-composer" disabled={disabled}><legend>{editor.line ? "Edit TEMP item" : "Add TEMP item"}</legend><p className="notice">Store this line or cancel it before {orderEdit ? "Save Draft or Save" : "Save Draft, Save Quote or Save Order"}. Store line also saves the current header atomically.</p>
        {editor.presentation && editor.line ? <>
          <label className="field">Line description<input value={editor.description ?? ""} maxLength={2000} onChange={event => setEditor({ ...editor, description: event.target.value })} /></label>
          <label className="field">Operational line note<textarea value={editor.operationalNote ?? ""} maxLength={4000} onChange={event => setEditor({ ...editor, operationalNote: event.target.value })} /></label>
          <p>Historical quantity {editor.line.input.quantity} and {editor.line.sourceLineSnapshot?.sellingPriceDecision.kind} price are retained without resolving ACTIVE Product defaults.</p>
          <button className="button" disabled={!editor.description?.trim()} onClick={() => void storePresentation()}>Store line details</button>
          {editor.line.input.selling && <button className="button secondary" disabled={editor.description !== (editor.line.input.description ?? "") || editor.operationalNote !== (editor.line.operationalNote ?? "")} onClick={() => setEditor({ key: newBusinessRequestId(), line: editor.line })}>Change quantity or price</button>}
          {!editor.line.input.selling && <p className="notice">Locked or discounted source pricing cannot be replaced by a calculated price automatically. This surface supports description, note and order changes; repricing requires an explicit owner-supported selling instruction.</p>}
          <button className="button secondary" onClick={() => setEditor(undefined)}>Cancel line changes</button>
        </> : <QuoteLineEditor organizationId={organizationId} sessionScope={sessionScope} draftKey={editor.key} initialDraft={editor.line ? lineDraft(editor.line.input) : emptyQuoteLineDraft()} initializeFromPersistedLine={Boolean(editor.line)} products={products.data ?? []} configurationApi={configurationApi} configurationScope={`sales-workspace:${userId}:${workspace.id}`} canOverridePrice={orderEdit ? capabilities.orderOverridePrice === true : (capabilities.quoteCreate === true && capabilities.quoteOverridePrice === true) || (capabilities.orderCreate === true && capabilities.orderOverridePrice === true)} csrfReady={csrfReady} busy={Boolean(busy)} submitLabel="Store line" onSubmit={(input) => void storeLine(input)} onCancel={() => setEditor(undefined)} />}
      </fieldset>}
      {hasOverride && <p className="notice">Each final target requires its own price-override permission. Preview amounts are server evidence, not a guarantee if pricing changes before promotion.</p>}
    </section>
    {orderEdit && <section className="v2-sales-entry-items" aria-label="Existing Artwork edit references">
      <h2>Existing Artwork</h2>
      <p>Keep or remove is a TEMP intent only. Save applies Artwork-owner guards; files, assignments and history remain unchanged before Save.</p>
      <p>Replacement and production designation are unavailable here without an Artwork-owner edit contract. No proof retirement is performed by this editor.</p>
      {canReadArtwork && !client.stageIntent && <p className="notice error">Artwork intent commands are not configured. Existing references remain unchanged.</p>}
      {!canReadArtwork && <p className="notice">Artwork view permission is required to display source references.</p>}
      {canReadArtwork && editArtwork.isLoading && <p role="status">Loading source Artwork...</p>}
      {canReadArtwork && editArtwork.isError && <p className="notice error" role="alert">{workspaceError(editArtwork.error).message}<button disabled={Boolean(busy)} onClick={() => void editArtwork.refetch()}>Retry source Artwork</button></p>}
      {canReadArtwork && <ul>{(editArtwork.data ?? []).map(reference => <li key={reference.sourceAssignmentId}>
        <span>{reference.filename}: {reference.status}. TEMP intent: {reference.action === "REMOVE" ? "remove on Save" : "keep"}.</span>
        <button disabled={disabled || Boolean(editor) || !canAssignArtwork || !client.stageIntent || reference.status !== "current"} onClick={() => void run("Stage Artwork intent", async () => {
          if (disabled || editor || !canAssignArtwork || !client.stageIntent || reference.status !== "current") return;
          const action = reference.action === "REMOVE" ? "keep" : "remove";
          const result = await client.stageIntent(organizationId, workspace.id, { ...mutation("artwork-intent", { sourceAssignmentId: reference.sourceAssignmentId, action }), sourceAssignmentId: reference.sourceAssignmentId, action });
          applyArtworkRevision(result.workspaceRevision);
          if (mounted.current) setNotice("Artwork intent staged. The canonical assignment and file are unchanged.");
        })}>{reference.action === "REMOVE" ? "Keep" : "Remove existing"} {reference.filename}</button>
      </li>)}</ul>}
    </section>}
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
        <label className="field">PDF file<input type="file" accept="application/pdf,.pdf" onChange={(event) => { props.onLeaveStateChange(false); const file = event.target.files?.[0]; setUpload(file ? { file, requestId: newBusinessRequestId() } : undefined); }} /></label>
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
