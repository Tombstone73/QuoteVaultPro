import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { artworkApi, orderApi } from "./api";
import { ArtworkUploadPanel } from "./ArtworkUploadPanel";

const usage = (item: Readonly<{ purpose: string; side?: string; sourcePageIndex?: number; layerKey?: string; layerOrder?: number }>) => [item.purpose.replaceAll("_", " "), item.side, item.sourcePageIndex === undefined ? undefined : `page ${item.sourcePageIndex + 1}`, item.layerKey ? `${item.layerKey} ${item.layerOrder! + 1}` : undefined].filter(Boolean).join(" · ");

/** Canonical Artwork files shown through their real typed assignments, not a second file universe. */
export const ArtworkWorkspace = ({ organizationId, sessionScope, canView, orderId, lineId }: Readonly<{ organizationId: string; sessionScope: string; canView: boolean; orderId?: string; lineId?: string }>) => {
  const [search, setSearch] = useState("");
  const workspace = useQuery({ queryKey: ["v2", sessionScope, organizationId, "artwork", "workspace", search], queryFn: () => artworkApi.workspace(organizationId, search), enabled: Boolean(organizationId && sessionScope && canView) });
  const order = useQuery({ queryKey: ["v2", sessionScope, organizationId, "artwork", "target-order", orderId], queryFn: () => orderApi.get(organizationId, orderId!), enabled: Boolean(organizationId && sessionScope && canView && orderId && lineId) });
  const items = (workspace.data?.items ?? []).filter((item) => (!orderId || item.assignment.orderId === orderId) && (!lineId || item.assignment.orderLineId === lineId));
  const targetLine = order.data?.order.lines.find((line) => line.lineId === lineId);
  if (!organizationId) return <section className="v2-artwork"><p className="v2-proof-empty">Enter an authenticated organization in Sales before opening Artwork.</p></section>;
  if (!canView) return <section className="v2-artwork"><p className="v2-proof-empty">You do not have permission to view Artwork.</p></section>;
  return <section className="v2-artwork"><header className="v2-artwork-heading"><div><p className="eyebrow">Operational evidence</p><h1>Artwork</h1><p>{orderId ? lineId ? "Canonical Artwork for this Order line." : "Canonical Artwork for this Order." : "Canonical files and their typed OrderLine usages."}</p></div><span>{orderId ? "Order context" : "Read-only catalog"}</span></header>
    <div className="v2-artwork-tools"><label>Search Artwork<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="File, order, customer, line…" /></label><small>{orderId ? "This view is scoped from Sales; Artwork still owns the file relationships." : "Each row is an assignment; one file can legitimately appear in several usages."}</small></div>
    {orderId && lineId && order.isLoading && <section className="v2-artwork-note"><p>Loading the selected Order line…</p></section>}
    {orderId && lineId && order.isError && <section className="v2-artwork-note"><p className="v2-product-version-message">The selected Order line is unavailable for Artwork upload.</p></section>}
    {orderId && lineId && order.data && !targetLine && <section className="v2-artwork-note"><p className="v2-product-version-message">The selected Order line is unavailable for Artwork upload.</p></section>}
    {orderId && lineId && targetLine && <ArtworkUploadPanel organizationId={organizationId} target={{ orderId, orderLineId: lineId, orderNumber: order.data!.number.display, lineDescription: targetLine.description || `Line ${targetLine.position}` }} onUploaded={() => void workspace.refetch()} />}
    {!orderId && <section className="v2-artwork-note"><h2>Upload Artwork</h2><p>Open Artwork from an Order line to upload and assign a canonical PDF without entering internal IDs.</p></section>}
    <div className="v2-artwork-table-wrap"><table><thead><tr><th>File</th><th>Order / line</th><th>Usage</th><th>Evidence</th><th>Lineage</th></tr></thead><tbody>{workspace.isLoading && <tr><td colSpan={5}>Loading Artwork…</td></tr>}{workspace.isError && <tr><td colSpan={5}>Artwork is unavailable in this organization.</td></tr>}{workspace.isSuccess && !items.length && <tr><td colSpan={5}>No canonical Artwork assignments match this context.</td></tr>}{items.map((item) => <tr key={item.assignment.id}><td><div className="v2-artwork-file"><i>{item.file.displayFilename.slice(0, 2).toUpperCase()}</i><span><b>{item.file.displayFilename}</b><small>{item.file.contentType} · {item.file.byteSize.toLocaleString()} bytes</small></span></div></td><td><b>#{item.orderNumber}</b><small>{item.customerDisplayName} · {item.lineDescription}</small></td><td><em>{usage(item.assignment)}</em></td><td className="v2-artwork-mono">File {item.file.id}<br />Assignment {item.assignment.id}</td><td>{item.file.derivedFromArtworkFileId ? <small className="v2-artwork-mono">Derived from {item.file.derivedFromArtworkFileId}</small> : <small>Original canonical file</small>}</td></tr>)}</tbody></table></div>
    <section className="v2-artwork-note"><h2>Workflow context</h2><p>Proofing records immutable evidence from these assignments. Prepress evaluates exact production-assignment coverage against frozen requirements. The upload control creates one canonical file and its typed OrderLine assignment; replacement and derived-artwork workflows remain explicit Artwork operations.</p></section>
  </section>;
};
