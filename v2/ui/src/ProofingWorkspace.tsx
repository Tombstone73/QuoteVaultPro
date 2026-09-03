import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { artworkApi, newBusinessRequestId, orderApi, proofingApi, type ApiError, type ArtworkOrderProjection, type OrderRead, type ProofQueueItem, type ProofWorkProjection } from "./api";

const keys = {
  queue: (scope: string, organizationId: string) => ["v2", scope, organizationId, "proofing", "works"] as const,
  work: (scope: string, organizationId: string, proofWorkId: string) => ["v2", scope, organizationId, "proofing", "work", proofWorkId] as const,
  artwork: (scope: string, organizationId: string, orderId: string) => ["v2", scope, organizationId, "artwork", "order", orderId] as const,
};

const proofStatus = (item: ProofQueueItem) => !item.latest ? "Draft" : item.latest.outcome === "approved" ? "Approved" : item.latest.outcome === "revision_requested" ? "Revision requested" : item.latest.deliveryState === "failed" || item.latest.deliveryState === "ambiguous" ? "Delivery action required" : item.latest.issuedAt ? "Awaiting customer" : "Draft";
const versionStatus = (entry: ProofWorkProjection["versions"][number]) => entry.response?.outcome === "approved" ? "Approved" : entry.response?.outcome === "revision_requested" ? "Revision requested" : entry.delivery?.state === "failed" || entry.delivery?.state === "ambiguous" ? "Delivery action required" : entry.version.issuedAt ? "Awaiting customer" : "Draft";
const errorText = (error: unknown) => (error as ApiError | undefined)?.message ?? "The Proofing operation could not be completed.";
const usage = (assignment: Readonly<{ purpose: string; side?: string; sourcePageIndex?: number; layerKey?: string; layerOrder?: number }>) => [assignment.purpose.replaceAll("_", " "), assignment.side, assignment.sourcePageIndex === undefined ? undefined : `page ${assignment.sourcePageIndex + 1}`, assignment.layerKey ? assignment.layerOrder === undefined ? assignment.layerKey : `${assignment.layerKey} ${assignment.layerOrder + 1}` : undefined].filter(Boolean).join(" · ");

export const proofWorkSelectionForScope = (queue: readonly ProofQueueItem[], proofWorkId?: string, orderId?: string, lineId?: string): string => {
  if (proofWorkId) return proofWorkId;
  if (orderId && lineId) return queue.find((item) => item.work.orderId === orderId && item.work.orderLineId === lineId)?.work.proofWorkId ?? "";
  return queue[0]?.work.proofWorkId ?? "";
};

export type ProofingOrderLineContext = Readonly<{ order: OrderRead; line: OrderRead["order"]["lines"][number]; sourceArtwork: readonly ArtworkOrderProjection[] }>;
type ProofingWorkspaceProps = Readonly<{ organizationId: string; sessionScope: string; canView: boolean; canPrepare?: boolean; canIssue?: boolean; canRespond?: boolean; proofWorkId?: string; orderId?: string; lineId?: string; openOrder?: (orderId: string) => void; openCustomer?: (customerId: string) => void; openArtwork?: (artworkFileId: string) => void }>;

/** Presents immutable Proofing evidence, not a file viewer, delivery inbox, or recipient manager. */
export const ProofingWorkspace = ({ organizationId, sessionScope, canView, canPrepare = false, canIssue = false, canRespond = false, proofWorkId, orderId, lineId, openOrder, openCustomer, openArtwork }: ProofingWorkspaceProps) => {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const queue = useQuery({ queryKey: keys.queue(sessionScope, organizationId), queryFn: () => proofingApi.list(organizationId), enabled: Boolean(canView && organizationId && sessionScope) });
  const scopedWork = useMemo(() => orderId && lineId ? queue.data?.find((item) => item.work.orderId === orderId && item.work.orderLineId === lineId) : undefined, [lineId, orderId, queue.data]);
  const scopedSelection = useMemo(() => proofWorkSelectionForScope(queue.data ?? [], proofWorkId, orderId, lineId), [lineId, orderId, proofWorkId, queue.data]);
  useEffect(() => {
    if (proofWorkId || (orderId && lineId)) {
      setSelectedId(scopedSelection);
      return;
    }
    if (!selectedId && scopedSelection) setSelectedId(scopedSelection);
  }, [lineId, orderId, proofWorkId, scopedSelection, selectedId]);
  const work = useQuery({ queryKey: keys.work(sessionScope, organizationId, selectedId), queryFn: () => proofingApi.get(organizationId, selectedId), enabled: Boolean(selectedId && canView) });
  useEffect(() => { if (work.data?.versions[0]) setSelectedVersionId(work.data.versions[0].version.proofVersionId); }, [work.data?.work.proofWorkId, work.data?.versions.length]);
  const contextOrderId = orderId ?? work.data?.work.orderId ?? "";
  const contextLineId = lineId ?? work.data?.work.orderLineId ?? "";
  const order = useQuery({ queryKey: ["v2", sessionScope, organizationId, "orders", contextOrderId], queryFn: () => orderApi.get(organizationId, contextOrderId), enabled: Boolean(contextOrderId && canView) });
  const artwork = useQuery({ queryKey: keys.artwork(sessionScope, organizationId, contextOrderId), queryFn: () => artworkApi.forOrder(organizationId, contextOrderId), enabled: Boolean(contextOrderId && canView) });
  const line = order.data?.order.lines.find((candidate) => candidate.lineId === contextLineId);
  const sourceArtwork = useMemo(() => {const all=(artwork.data??[]).filter(item=>item.assignment.orderLineId===contextLineId&&(item.assignment.purpose==="customer_supplied"||item.assignment.purpose==="reference"));const superseded=new Set(all.flatMap(item=>item.assignment.supersedesArtworkAssignmentId?[item.assignment.supersedesArtworkAssignmentId]:[]));return all.filter(item=>!superseded.has(item.assignment.id));}, [artwork.data, contextLineId]);
  const context = order.data && line ? { order: order.data, line, sourceArtwork } : undefined;
  const selectedQueueItem = queue.data?.find((item) => item.work.proofWorkId === selectedId);
  const entries = useMemo(() => queue.data?.filter((item) => `${item.orderNumber} ${item.customerDisplayName} ${item.lineDescription}`.toLowerCase().includes(search.toLowerCase())) ?? [], [queue.data, search]);
  const groups = useMemo(() => {
    const byOrder = new Map<string, ProofQueueItem[]>();
    for (const item of entries) byOrder.set(item.orderNumber, [...(byOrder.get(item.orderNumber) ?? []), item]);
    return [...byOrder.entries()];
  }, [entries]);
  const refresh = async (nextWorkId?: string) => {
    if (nextWorkId) setSelectedId(nextWorkId);
    await client.invalidateQueries({ queryKey: keys.queue(sessionScope, organizationId) });
    await client.invalidateQueries({ queryKey: keys.work(sessionScope, organizationId, nextWorkId ?? selectedId) });
  };
  if (!organizationId || !canView) return <section className="v2-proofing"><div className="v2-proof-empty">{!organizationId ? "Enter an authenticated organization in Sales before opening Proofing." : "You do not have permission to view Proofing."}</div></section>;
  const loading = work.isLoading || order.isLoading || artwork.isLoading;
  return <section className="v2-proofing">
    <aside className="v2-proof-queue" aria-label="Proof queue"><header><div><h2>Proof Queue</h2><span>{queue.data?.length ?? 0} proofs</span></div><input aria-label="Search proof queue" placeholder="Order, customer, item" value={search} onChange={(event) => setSearch(event.target.value)} /></header><div className="v2-proof-queue-list">{queue.isLoading && <p>Loading proof queue…</p>}{queue.isError && <p>Proof queue is unavailable.</p>}{queue.isSuccess && !groups.length && <p>No proof work matches this search.</p>}{groups.map(([orderNumber, items]) => <section className="v2-proof-order-group" key={orderNumber}><header><strong>Order #{orderNumber}</strong><span>{items[0]?.customerDisplayName}</span></header>{items.map((item) => <button type="button" key={item.work.proofWorkId} onClick={() => setSelectedId(item.work.proofWorkId)} className={selectedId === item.work.proofWorkId ? "active" : ""}><b>{item.lineDescription}</b><small>Proof v{item.latest?.sequence ?? 0}</small><em data-status={proofStatus(item)}>{proofStatus(item)}</em></button>)}</section>)}</div></aside>
    <main className="v2-proof-main">{loading ? <div className="skeleton" /> : !work.data && !context ? <div className="v2-proof-empty">Open Proofing from an Order line to start canonical Proof Work.</div> : <><ProofHeader context={context} item={selectedQueueItem} projection={work.data} onOpenOrder={openOrder} /><div className="v2-proof-content">{context && <SourceToVersion context={context} projection={work.data} onOpenOrder={openOrder} onOpenCustomer={openCustomer} onOpenArtwork={openArtwork} />}<PreviewUnavailable />{work.data && <ProofVersionHistory projection={work.data} artwork={artwork.data ?? []} selectedVersionId={selectedVersionId} onSelectVersion={setSelectedVersionId} onOpenArtwork={openArtwork} />}</div></>}</main>
    <aside className="v2-proof-rail" aria-label="Proof evidence and actions">{work.data && <ProofEvidenceRail projection={work.data} />}<ProofWorkflowActions organizationId={organizationId} context={context} projection={work.data} canPrepare={canPrepare} canIssue={canIssue} canRespond={canRespond} onRefresh={refresh} /></aside>
  </section>;
};

const ProofHeader = ({ context, item, projection, onOpenOrder }: Readonly<{ context?: ProofingOrderLineContext; item?: ProofQueueItem; projection?: ProofWorkProjection; onOpenOrder?: (orderId: string) => void }>) => {
  const latest = projection?.versions[0];
  return <header className="v2-proof-header"><div><small>Proofing work</small><h1>{context?.line.description ?? item?.lineDescription ?? "Proof work"}</h1><p>{item ? `Order #${item.orderNumber} · ${item.customerDisplayName}` : context ? `Order #${context.order.number.display}` : "Authenticated Proofing context"}</p></div><div className="v2-proof-header-actions">{context && onOpenOrder && <button type="button" onClick={() => onOpenOrder(context.order.order.orderId)}>Open Order</button>}{latest && <span data-status={versionStatus(latest)}>{versionStatus(latest)}</span>}</div></header>;
};

const SourceToVersion = ({ context, projection, onOpenOrder, onOpenCustomer, onOpenArtwork }: Readonly<{ context: ProofingOrderLineContext; projection?: ProofWorkProjection; onOpenOrder?: (orderId: string) => void; onOpenCustomer?: (customerId: string) => void; onOpenArtwork?: (artworkFileId: string) => void }>) => {
  const latest = projection?.versions[0];
  return <section className="v2-proof-source"><div><small>Source Artwork</small><strong>{context.sourceArtwork.length ? context.sourceArtwork.map((item) => item.file.displayFilename).join(", ") : "No eligible source Artwork"}</strong><span>{context.sourceArtwork.length ? `${context.sourceArtwork.length} canonical assignment${context.sourceArtwork.length === 1 ? "" : "s"} on this Order line` : "Customer-supplied or reference Artwork is required before starting Proof Work."}</span></div><span className="v2-proof-source-arrow" aria-hidden>→</span><div><small>Proof Version</small><strong>{latest ? `Proof v${latest.version.sequence}` : "Not created"}</strong><span>{latest ? `${latest.version.artwork.length} exact Artwork assignment${latest.version.artwork.length === 1 ? "" : "s"} bound as immutable evidence` : "Create a version only from canonical Artwork evidence."}</span></div><div className="v2-proof-context-links">{onOpenOrder && <button type="button" onClick={() => onOpenOrder(context.order.order.orderId)}>Open Order</button>}{onOpenCustomer && <button type="button" onClick={() => onOpenCustomer(context.order.order.customerContact.customerId)}>Open Customer</button>}{onOpenArtwork && context.sourceArtwork.map((item) => <button type="button" key={item.file.id} onClick={() => onOpenArtwork(item.file.id)}>Open {item.file.displayFilename}</button>)}</div><p>Proofing owns approval evidence. Prepress and Routing remain separate owner workflows.</p></section>;
};

const PreviewUnavailable = () => <section className="v2-proof-preview-unavailable"><h2>Exact proof evidence</h2><p>Open a bound Artwork file below to inspect the exact immutable artifact. Customers receive the same revision through the authenticated portal.</p></section>;

const ProofVersionHistory = ({ projection, artwork, selectedVersionId, onSelectVersion, onOpenArtwork }: Readonly<{ projection: ProofWorkProjection; artwork: readonly ArtworkOrderProjection[]; selectedVersionId: string; onSelectVersion: (proofVersionId: string) => void; onOpenArtwork?: (artworkFileId: string) => void }>) => {
  const files = new Map(artwork.map((item) => [item.file.id, item]));
  return <section className="v2-proof-versions"><header><div><h2>Immutable Proof History</h2><p>Approval and revision feedback apply only to the exact version shown.</p></div><span>{projection.versions.length}</span></header><div className="v2-proof-version-grid">{projection.versions.map((entry, index) => {
    const selected = entry.version.proofVersionId === selectedVersionId;
    return <article className={selected ? "active" : ""} key={entry.version.proofVersionId}><button type="button" onClick={() => onSelectVersion(entry.version.proofVersionId)} aria-pressed={selected}><span>Proof v{entry.version.sequence}</span><em>{versionStatus(entry)}</em></button><dl><div><dt>Created</dt><dd>{entry.version.createdAt}</dd></div><div><dt>Issued</dt><dd>{entry.version.issuedAt ?? "Not issued"}</dd></div>{entry.delivery && <><div><dt>Recipient</dt><dd>{entry.delivery.recipient.displayName} · {entry.delivery.recipient.email}</dd></div><div><dt>Delivery</dt><dd>{entry.delivery.state.replaceAll("_"," ")}{entry.delivery.deliveredAt ? ` · ${entry.delivery.deliveredAt}` : ""}</dd></div></>}</dl>{entry.delivery?.lastError && <p role="alert">{entry.delivery.lastError}</p>}<section className="v2-proof-version-artwork"><small>Bound Artwork</small>{entry.version.artwork.length ? <ul>{entry.version.artwork.map((bound) => { const item = files.get(bound.artworkFileId); return <li key={bound.artworkAssignmentId}>{item && onOpenArtwork ? <button type="button" className="v2-proof-artwork-link" onClick={() => onOpenArtwork(item.file.id)}>{item.file.displayFilename}</button> : <b>{item?.file.displayFilename ?? "Artwork evidence"}</b>}<span>{item ? usage(item.assignment) : "Exact assignment retained in Proof history"}</span></li>; })}</ul> : <p>No Artwork evidence is bound to this version.</p>}</section>{entry.response && <section className="v2-proof-response-evidence"><small>{entry.response.outcome.replaceAll("_", " ")}</small>{entry.response.comment && <p>“{entry.response.comment}”</p>}<span>{entry.response.origin === "direct" ? "Direct response" : "Staff-recorded customer response"}{` · ${entry.response.respondedAt}`}</span></section>}{index === 0 && <p className="v2-proof-current-version">Current version</p>}</article>;
  })}</div></section>;
};

const ProofEvidenceRail = ({ projection }: Readonly<{ projection: ProofWorkProjection }>) => {
  const latest = projection.versions[0];
  if (!latest) return null;
  return <section className="v2-proof-evidence-card"><small>Proof status</small><h2>{versionStatus(latest)}</h2><dl><div><dt>Current version</dt><dd>v{latest.version.sequence}</dd></div><div><dt>Evidence</dt><dd>{latest.version.artwork.length} assignment{latest.version.artwork.length === 1 ? "" : "s"}</dd></div><div><dt>Issued</dt><dd>{latest.version.issuedAt ?? "Not issued"}</dd></div><div><dt>Delivery</dt><dd>{latest.delivery?.state.replaceAll("_"," ") ?? "Not issued"}</dd></div><div><dt>Response</dt><dd>{latest.response?.outcome?.replaceAll("_", " ") ?? "Awaiting response"}</dd></div></dl>{latest.response?.comment && <p className="v2-proof-latest-response">“{latest.response.comment}”</p>}</section>;
};

export const ProofWorkflowActions = ({ organizationId, context, projection, canPrepare, canIssue, canRespond, onRefresh }: Readonly<{ organizationId: string; context?: ProofingOrderLineContext; projection?: ProofWorkProjection; canPrepare: boolean; canIssue: boolean; canRespond: boolean; onRefresh: (proofWorkId?: string) => Promise<void> }>) => {
  const [notice, setNotice] = useState("");
  const [comment, setComment] = useState("");
  const [recipientContactId,setRecipientContactId]=useState("");
  const latest = projection?.versions[0];
  const assignments = context?.sourceArtwork.map((item) => item.assignment.id) ?? [];
  const start = useMutation({ mutationFn: () => proofingApi.start(organizationId, newBusinessRequestId(), context!.order.order.orderId, context!.line.lineId), onSuccess: async (result) => { setNotice("Proof Work started from canonical Artwork."); await onRefresh(result.work.proofWorkId); }, onError: (error) => setNotice(errorText(error)) });
  const createVersion = useMutation({ mutationFn: () => proofingApi.createVersion(organizationId, projection!.work.proofWorkId, newBusinessRequestId(), assignments), onSuccess: async () => { setNotice("Proof Version created from immutable Artwork evidence."); await onRefresh(projection!.work.proofWorkId); }, onError: (error) => setNotice(errorText(error)) });
  const recipients=projection?.recipients??[];
  useEffect(()=>{if(recipients.length&&!recipients.some(recipient=>recipient.contactId===recipientContactId))setRecipientContactId(recipients[0]!.contactId);},[recipients,recipientContactId]);
  const issue = useMutation({ mutationFn: () => proofingApi.issue(organizationId, latest!.version.proofVersionId, newBusinessRequestId(),recipientContactId), onSuccess: async () => { setNotice("Proof issued. Customer notification is queued for durable delivery."); await onRefresh(projection!.work.proofWorkId); }, onError: (error) => setNotice(errorText(error)) });
  const retry=useMutation({mutationFn:()=>proofingApi.retryDelivery(organizationId,latest!.version.proofVersionId,newBusinessRequestId()),onSuccess:async()=>{setNotice("Proof notification requeued for delivery.");await onRefresh(projection!.work.proofWorkId);},onError:(error)=>setNotice(errorText(error))});
  const respond = useMutation({ mutationFn: (outcome: "approved" | "revision_requested") => proofingApi.respond(organizationId, latest!.version.proofVersionId, newBusinessRequestId(), outcome, comment, context?.order.order.customerContact.customerId), onSuccess: async (_, outcome) => { setNotice(outcome === "approved" ? "Approval recorded as canonical Proofing evidence." : "Revision request recorded; create the next Proof Version when ready."); setComment(""); await onRefresh(projection!.work.proofWorkId); }, onError: (error) => setNotice(errorText(error)) });
  const pending = start.isPending || createVersion.isPending || issue.isPending || respond.isPending || retry.isPending;
  if (!context) return <div className="v2-proof-empty">The selected Proof Work has no readable Order-line context.</div>;
  if (!projection) return <Action title="Proofing workflow" notice={notice}>{assignments.length ? <><p>Canonical Artwork is ready. Start durable Proof Work for this Order line.</p>{canPrepare ? <button type="button" className="button" disabled={pending} onClick={() => start.mutate()}>{start.isPending ? "Starting…" : "Start Proofing"}</button> : <Permission />}</> : <p>Canonical customer-supplied or reference Artwork is required before Proofing can start.</p>}</Action>;
  if (!latest) return <Action title="Proofing workflow" notice={notice}><p>Create the first immutable Proof Version from the canonical Artwork shown above.</p>{canPrepare ? <button type="button" className="button" disabled={!assignments.length || pending} onClick={() => createVersion.mutate()}>Create Proof Version</button> : <Permission />}</Action>;
  if (latest.response?.outcome === "approved") return <Action title="Proofing complete" notice={notice}><p>Issued Proof Version v{latest.version.sequence} has canonical approval evidence. Routing may now evaluate its own frozen prerequisite.</p></Action>;
  if (latest.response?.outcome === "revision_requested") return <Action title="Revision requested" notice={notice}><p>Version v{latest.version.sequence} remains immutable.</p>{canPrepare && <button type="button" className="button" disabled={pending} onClick={() => createVersion.mutate()}>Create Next Proof Version</button>}</Action>;
  if (!latest.version.issuedAt && latest.version.artwork.length === 0) return <Action title={`Proof Version v${latest.version.sequence}`} notice={notice}><p>This unissued Proof Version has no immutable Artwork evidence. Add a new version from canonical Artwork before it can be issued.</p>{canPrepare && <button type="button" className="button" disabled={pending || !assignments.length} onClick={() => createVersion.mutate()}>Create Proof Version from Artwork</button>}</Action>;
  if (!latest.version.issuedAt) return <Action title={`Proof Version v${latest.version.sequence}`} notice={notice}><p>Issue this exact immutable revision and notify an authorized customer contact.</p>{recipients.length?<label className="field">Proof recipient<select aria-label="Proof recipient" value={recipientContactId} onChange={event=>setRecipientContactId(event.target.value)}>{recipients.map(recipient=><option key={recipient.contactId} value={recipient.contactId}>{recipient.displayName} · {recipient.email}</option>)}</select></label>:<p role="alert">Add an active customer contact with a valid email address before issuing this Proof.</p>}{canIssue ? <button type="button" className="button" disabled={pending||!recipientContactId} onClick={() => issue.mutate()}>{issue.isPending?"Issuing…":"Issue & Notify Customer"}</button> : <Permission />}</Action>;
  if(latest.delivery&&(latest.delivery.state==="failed"||latest.delivery.state==="ambiguous"))return <Action title="Delivery action required" notice={notice}><p>{latest.delivery.lastError??"The notification was not confirmed delivered."}</p><p>Recipient: {latest.delivery.recipient.displayName} · {latest.delivery.recipient.email}</p>{canIssue&&<button type="button" className="button" disabled={pending} onClick={()=>retry.mutate()}>{retry.isPending?"Requeueing…":"Retry Notification"}</button>}</Action>;
  return <Action title="Awaiting customer" notice={notice}><p>Notification: {latest.delivery?.state.replaceAll("_"," ")??"queued"}. The customer can approve this exact revision or request changes in the secure portal.</p><label className="field">Staff-recorded response note (optional)<textarea aria-label="Proof response note" value={comment} maxLength={8000} onChange={(event) => setComment(event.target.value)} /></label>{canRespond ? <div className="v2-order-context-actions"><button type="button" className="button" disabled={pending} onClick={() => respond.mutate("approved")}>Record Customer Approval</button><button type="button" className="button secondary" disabled={pending} onClick={() => respond.mutate("revision_requested")}>Record Request for Changes</button></div> : <Permission />}</Action>;
};

const Action = ({ title, notice, children }: Readonly<{ title: string; notice: string; children: React.ReactNode }>) => <section className="v2-proof-actions"><h2>{title}</h2>{children}{notice && <p role="status">{notice}</p>}</section>;
const Permission = () => <p className="v2-sales-permission-note">You do not have permission for this Proofing action.</p>;
