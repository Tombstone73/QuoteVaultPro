import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type Publication = Readonly<{ checkpointId: string; occurredAt: string;
  customerPresentation: Readonly<{ customerDisplayName?: string; contactDisplayName?: string }>;
  sentEvidence?: Readonly<{ recipientEmail?: string; documentSha256?: string; suppression?: Readonly<{ deliveryMode: "suppressed" }> }>;
  commercial: Readonly<{ jobLabel?: string; terms: Readonly<{ commercialNotes?: string }> }> }>;
export type QuotePublicationPanelProps = Readonly<{
  organizationId: string; sessionScope: string; quoteId: string; revision: string;
  publishedCheckpointId?: string | null; canView: boolean; canResend: boolean; busy: boolean;
  publishedEvidenceStatus?: "modern" | "historical" | null;
  onResend: () => void;
  loadHistory: () => Promise<{ items: readonly Publication[] }>;
  canRevise?: boolean; onRevise?: () => void;
}>;

/** Mounted by the Quote editor. Its resend callback uses the editor's existing
 * exact-request send dialog, never a second provider/command implementation. */
export const QuotePublicationPanel = (props: QuotePublicationPanelProps) => {
  const [selection, setSelection] = useState<Readonly<{ scope: string; checkpointId: string }> | null>(null);
  const selectionScope = JSON.stringify([props.sessionScope, props.organizationId, props.quoteId, props.publishedCheckpointId]);
  const selected = selection?.scope === selectionScope ? selection.checkpointId : "";
  const query = useQuery({ queryKey: ["v2", props.sessionScope, props.organizationId, "quote-publications", props.quoteId, props.revision],
    enabled: Boolean(props.canView && props.organizationId && props.sessionScope && props.quoteId), retry: false, placeholderData: undefined,
    queryFn: props.loadHistory });
  if (!props.canView || !props.organizationId || !props.sessionScope || !props.quoteId)
    return <section className="v2-sales-history"><h2>Customer publication</h2><p role="alert">Publication history is unavailable for the current session.</p></section>;
  const items = !query.isError && !query.isFetching && !query.isPlaceholderData ? query.data?.items ?? [] : [];
  const publication = items.find(item => item.checkpointId === selected) ?? items.find(item => item.checkpointId === props.publishedCheckpointId);
  return <section className="v2-sales-history"><h2>Customer publication</h2><p>Internal revision {props.revision}. Saving changes does not publish them. Acceptance uses the last successful publication.</p>
    {props.publishedEvidenceStatus === "historical" && <p role="status">Historical publication has incomplete modern delivery evidence. Explicitly resend the current draft before acceptance or conversion.</p>}
    {query.isError ? <p role="alert">Publication history is unavailable. <button type="button" onClick={() => void query.refetch()}>Retry publication history</button></p> : query.isPending || query.isFetching ? <p role="status">Loading publication history...</p> : <>
      <p>{publication?.sentEvidence?.suppression ? "Published in DEV QA; email suppressed. No provider call was attempted." : props.publishedCheckpointId ? "A successful sent revision remains customer-visible." : "No canonical publication is confirmed."}</p>
      <label>Sent revision<select value={publication?.checkpointId ?? ""} onChange={event => setSelection({ scope: selectionScope, checkpointId: event.target.value })}><option value="">Choose sent history</option>{items.map(item => <option key={item.checkpointId} value={item.checkpointId}>{item.occurredAt}{item.checkpointId === props.publishedCheckpointId ? " | Published" : " | Historical"}</option>)}</select></label>
      {publication && <div><p>{publication.customerPresentation.customerDisplayName} | {publication.customerPresentation.contactDisplayName}</p><p>{publication.sentEvidence?.recipientEmail ?? "Historical recipient unavailable"}</p><p>{publication.commercial.jobLabel ?? "No frozen Job Label"}</p><p>{publication.commercial.terms.commercialNotes}</p><a href={`/v2/organizations/${encodeURIComponent(props.organizationId)}/quotes/${encodeURIComponent(props.quoteId)}/document.pdf?checkpointId=${encodeURIComponent(publication.checkpointId)}`} target="_blank" rel="noreferrer">View Published PDF Or Historical Preview</a><p>New sends retain original attachment bytes and hash. Older links are labeled checkpoint previews, not reconstructed originals.</p></div>}
    </>}
    <button type="button" className="button" disabled={!props.canResend || props.busy || !props.sessionScope || query.isError || query.isPending || query.isFetching} onClick={props.onResend}>{props.publishedCheckpointId ? "Resend Current Internal Revision" : "Send Current Internal Revision"}</button>
    <button type="button" className="button secondary" disabled={!props.canRevise || !props.onRevise || props.busy || !props.sessionScope || query.isError || query.isPending || query.isFetching} onClick={props.onRevise}>Start Internal Revision</button>
  </section>;
};
