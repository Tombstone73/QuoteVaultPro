import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { artworkApi, proofingApi, type ArtworkOrderProjection, type ProofQueueItem, type ProofWorkProjection } from "./api";

const proofStatus = (item: ProofQueueItem) => !item.latest ? "Draft" : item.latest.outcome === "approved" ? "Approved" : item.latest.outcome === "revision_requested" ? "Revision Requested" : item.latest.issuedAt ? "Sent" : "Draft";
const versionStatus = (entry: ProofWorkProjection["versions"][number]) => entry.response?.outcome?.replaceAll("_", " ") ?? (entry.version.issuedAt ? "Sent" : "Draft");
const when = (value?: string) => value ? new Date(value).toLocaleString() : "Not issued";
const keys = {
  queue: (scope: string, organizationId: string) => ["v2", scope, organizationId, "proofing", "works"] as const,
  work: (scope: string, organizationId: string, proofWorkId: string) => ["v2", scope, organizationId, "proofing", "work", proofWorkId] as const,
  artwork: (scope: string, organizationId: string, orderId: string) => ["v2", scope, organizationId, "artwork", "order", orderId] as const,
};

type Evidence = Readonly<{ assignmentId: string; fileId: string; position: number; source?: ArtworkOrderProjection }>;
const evidenceFor = (projection: ProofWorkProjection, artwork: readonly ArtworkOrderProjection[]) => {
  const assignments = new Map(artwork.map((item) => [item.assignment.id, item]));
  return projection.versions.map((entry) => entry.version.artwork.map((item) => ({ assignmentId: item.artworkAssignmentId, fileId: item.artworkFileId, position: item.position, source: assignments.get(item.artworkAssignmentId) })));
};
const evidenceLabel = (item: Evidence) => item.source ? `${item.source.file.displayFilename} · ${item.source.assignment.purpose.replaceAll("_", " ")}${item.source.assignment.side ? ` · ${item.source.assignment.side}` : ""}` : `Artwork ${item.fileId}`;

export const ProofingWorkspace = ({ organizationId, sessionScope, canView }: { organizationId: string; sessionScope: string; canView: boolean }) => {
  const queue = useQuery({ queryKey: keys.queue(sessionScope, organizationId), queryFn: () => proofingApi.list(organizationId), enabled: Boolean(canView && organizationId && sessionScope) });
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { if (!selectedId && queue.data?.[0]) setSelectedId(queue.data[0].work.proofWorkId); }, [queue.data, selectedId]);
  const selectedQueueItem = queue.data?.find((item) => item.work.proofWorkId === selectedId);
  const work = useQuery({ queryKey: keys.work(sessionScope, organizationId, selectedId), queryFn: () => proofingApi.get(organizationId, selectedId), enabled: Boolean(selectedId && canView) });
  const artwork = useQuery({ queryKey: keys.artwork(sessionScope, organizationId, work.data?.work.orderId ?? ""), queryFn: () => artworkApi.forOrder(organizationId, work.data!.work.orderId), enabled: Boolean(work.data?.work.orderId && canView) });
  const entries = useMemo(() => queue.data?.filter((item) => `${item.orderNumber} ${item.customerDisplayName} ${item.lineDescription}`.toLowerCase().includes(search.toLowerCase())) ?? [], [queue.data, search]);
  if (!organizationId) return <section className="v2-proofing"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Proofing.</div></section>;
  if (!canView) return <section className="v2-proofing"><div className="v2-proof-empty">You do not have permission to view Proofing.</div></section>;
  return <section className="v2-proofing">
    <aside className="v2-proof-queue"><header><div><h2>Proof Queue</h2><span>{queue.data?.length ?? 0} proofs</span></div><input aria-label="Search proof queue" placeholder="Order, customer, item" value={search} onChange={(event) => setSearch(event.target.value)} /></header><div className="v2-proof-queue-list">{queue.isLoading ? <div className="skeleton" /> : entries.map((item) => <button type="button" key={item.work.proofWorkId} onClick={() => setSelectedId(item.work.proofWorkId)} className={selectedId === item.work.proofWorkId ? "active" : ""}><strong>#{item.orderNumber}</strong><b>{item.lineDescription}</b><span>{item.customerDisplayName} · v{item.latest?.sequence ?? 1}</span><em data-status={proofStatus(item)}>{proofStatus(item)}</em></button>)}</div></aside>
    <main className="v2-proof-main">{work.isLoading || artwork.isLoading ? <div className="skeleton" /> : !work.data ? <div className="v2-proof-empty">Select a Proof Work to view its durable version history.</div> : <ProofDetail projection={work.data} queueItem={selectedQueueItem} evidence={evidenceFor(work.data, artwork.data ?? [])} />}</main>
    <aside className="v2-proof-rail">{work.data && <ProofRail projection={work.data} evidence={evidenceFor(work.data, artwork.data ?? [])} />}</aside>
  </section>;
};

const ProofDetail = ({ projection, queueItem, evidence }: { projection: ProofWorkProjection; queueItem?: ProofQueueItem; evidence: readonly (readonly Evidence[])[] }) => {
  const [view, setView] = useState(0);
  const selected = projection.versions[view] ?? projection.versions[0];
  if (!selected) return <div className="v2-proof-empty">This Proof Work has no Version yet.</div>;
  const version = selected.version;
  const displayedEvidence = evidence[view] ?? evidence[0] ?? [];
  return <>
    <header className="v2-proof-header"><div><span>#{queueItem?.orderNumber ?? "Order"}</span><h1>{queueItem?.lineDescription ?? "Order Line Proof"}</h1><p>{queueItem?.customerDisplayName ?? "Customer"} · Proof approval does not advance Prepress or Production.</p></div><b data-status={selected.response?.outcome ?? (version.issuedAt ? "Sent" : "Draft")}>{versionStatus(selected)}</b></header>
    {selected.response?.outcome === "revision_requested" && <section className="v2-proof-feedback-banner"><b>Revision Requested</b><p>{selected.response.comment ?? "A revision was requested for this exact Proof Version."}</p><span>{selected.response.responderPrincipalSubject} · {when(selected.response.respondedAt)}</span></section>}
    <div className="v2-proof-content"><div className="v2-proof-source"><div><small>Design / Source Art</small><strong>{evidenceLabel(displayedEvidence[0] ?? { assignmentId: "", fileId: "", position: 0 })}</strong><span>{displayedEvidence.length} immutable Artwork evidence item{displayedEvidence.length === 1 ? "" : "s"}</span></div><div><small>Proof Version</small><strong>v{version.sequence}</strong><span>{version.issuedAt ? `Issued ${when(version.issuedAt)}` : "Not issued"}</span></div><span>Proofs are for approval only — Prepress prepares production art later.</span></div><div className="v2-proof-viewer"><div className="v2-proof-canvas"><b>Preview unavailable</b><small>Real Artwork rendition is not available in M2.1.5.</small></div><footer>PROOF V{version.sequence} · {displayedEvidence.map(evidenceLabel).join(" · ")}</footer></div><section className="v2-proof-versions"><h2>Proof Versions</h2><div>{projection.versions.map((entry, index) => <button type="button" key={entry.version.proofVersionId} onClick={() => setView(index)} className={entry.version.proofVersionId === version.proofVersionId ? "active" : ""}><strong>v{entry.version.sequence}</strong><span>{versionStatus(entry)}</span><small>{when(entry.response?.respondedAt ?? entry.version.issuedAt)}</small></button>)}</div></section></div>
  </>;
};

const ProofRail = ({ projection, evidence }: { projection: ProofWorkProjection; evidence: readonly (readonly Evidence[])[] }) => {
  const current = projection.versions[0];
  const currentEvidence = evidence[0] ?? [];
  return <>{current && <section><small>Proof Status</small><h2>{versionStatus(current)}</h2><dl><div><dt>Current Version</dt><dd>v{current.version.sequence}</dd></div><div><dt>Issued</dt><dd>{when(current.version.issuedAt)}</dd></div>{current.response && <div><dt>{current.response.outcome === "approved" ? "Approved" : "Revision Requested"}</dt><dd>{when(current.response.respondedAt)}</dd></div>}</dl></section>}<section><small>Artwork Evidence</small>{currentEvidence.length ? <ul className="v2-proof-evidence">{currentEvidence.map((item) => <li key={item.assignmentId}><b>{evidenceLabel(item)}</b><span>Position {item.position + 1}</span><small>Assignment {item.assignmentId}</small></li>)}</ul> : <p>No proof version exists.</p>}</section>{current?.response?.comment && <section><small>Latest Customer Feedback</small><p>“{current.response.comment}”</p><span>{current.response.responderPrincipalSubject} · {when(current.response.respondedAt)}</span></section>}<section><small>Feedback History</small>{projection.versions.filter((entry) => entry.response).map((entry) => <p key={entry.version.proofVersionId}>v{entry.version.sequence} · {versionStatus(entry)}{entry.response!.comment ? `: ${entry.response!.comment}` : ""}</p>)}</section></>;
};
