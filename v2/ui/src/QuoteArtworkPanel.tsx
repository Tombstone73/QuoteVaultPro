import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { newBusinessRequestId, quoteApi, type QuoteArtworkProjection, type QuoteRead } from "./api";

const metadata = (item: QuoteArtworkProjection): string => {
  const values = [
    item.association.side ? item.association.side === "front" ? "Front" : "Back" : undefined,
    item.association.sourcePageIndex === undefined ? undefined : `Page ${item.association.sourcePageIndex + 1}`,
    item.association.layerKey,
  ].filter((value): value is string => Boolean(value));
  return values.length ? values.join(" · ") : "Line artwork";
};

/**
 * Quote-line artwork is a canonical Artwork file usage.  It intentionally
 * does not calculate, retain, or infer any artwork state in the browser.
 */
export const QuoteArtworkPanel = ({
  organizationId,
  sessionScope,
  quote,
  canEdit,
  csrfReady,
  onQuoteRefresh,
  onError,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  quote: QuoteRead;
  canEdit: boolean;
  csrfReady: boolean;
  onQuoteRefresh: () => void;
  onError: (error: unknown) => void;
}>) => {
  const quoteId = quote.quote.quoteId;
  const mutable = canEdit
    && csrfReady
    && (quote.quote.lifecycleState ?? "open") === "open"
    && quote.quote.deliveryState === "not_sent"
    && quote.quote.acceptanceState === "not_accepted"
    && !quote.quote.convertedOrderId;
  const [lineId, setLineId] = useState(quote.quote.lines[0]?.lineId ?? "");
  const [file, setFile] = useState<File>();
  const [side, setSide] = useState<"front" | "back">("front");
  const artwork = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "quote-artwork", quoteId, quote.revision],
    queryFn: () => quoteApi.artwork(organizationId, quoteId),
    enabled: Boolean(sessionScope && organizationId && quoteId),
  });

  useEffect(() => {
    if (quote.quote.lines.some((line) => line.lineId === lineId)) return;
    setLineId(quote.quote.lines[0]?.lineId ?? "");
  }, [lineId, quote.quote.lines]);

  const upload = useMutation({
    mutationFn: () => quoteApi.uploadArtwork(
      organizationId,
      quoteId,
      newBusinessRequestId(),
      { quoteLineId: lineId, expectedRevision: quote.revision, side, file: file! },
    ),
    onSuccess: (result) => {
      setFile(undefined);
      onQuoteRefresh();
      void artwork.refetch();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (quoteArtworkAssociationId: string) => quoteApi.removeArtwork(
      organizationId,
      quoteId,
      quoteArtworkAssociationId,
      newBusinessRequestId(),
      quote.revision,
    ),
    onSuccess: (result) => {
      onQuoteRefresh();
      void artwork.refetch();
    },
    onError,
  });

  return <section className="v2-sales-quote-artwork" aria-label="Quote artwork">
    <header>
      <div>
        <h2>Artwork</h2>
        <p>Canonical files are associated with this Quote line and are frozen as accepted Quote evidence.</p>
      </div>
      {!mutable && <span>Quote artwork is read only</span>}
    </header>
    {artwork.isLoading && <p className="muted">Loading artwork…</p>}
    {artwork.isError && <p className="v2-product-version-message" role="alert">Artwork is unavailable for this Quote.</p>}
    {artwork.isSuccess && !artwork.data.length && <p className="muted">No artwork is attached to this Quote.</p>}
    {artwork.data?.length ? <ol className="v2-sales-quote-artwork-list">{artwork.data.map((item) => {
      const line = quote.quote.lines.find((candidate) => candidate.lineId === item.association.quoteLineId);
      return <li key={item.association.id}>
        <div><b>{item.file.displayFilename}</b><small>{line?.description || "Quote line"} · {metadata(item)} · No preview available</small></div>
        {mutable && <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.association.id)}>{remove.isPending ? "Removing…" : "Remove"}</button>}
      </li>;
    })}</ol> : null}
    {mutable && <div className="v2-sales-quote-artwork-upload">
      <label>Quote line<select aria-label="Quote artwork line" value={lineId} onChange={(event) => setLineId(event.target.value)}>{quote.quote.lines.map((line) => <option key={line.lineId} value={line.lineId}>Line {line.position} · {line.description || "Product"}</option>)}</select></label>
      <label className="v2-artwork-file-picker"><span>Artwork PDF</span><input aria-label="Quote artwork PDF" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.currentTarget.files?.[0])} /><b>{file ? "Change PDF" : "Choose PDF"}</b></label>
      <label>Side<select aria-label="Quote artwork side" value={side} onChange={(event) => setSide(event.target.value as "front" | "back")}><option value="front">Front</option><option value="back">Back</option></select></label>
      <p className="v2-artwork-selected-file" aria-live="polite">{file ? `Selected: ${file.name}` : "No PDF selected."}</p>
      <button className="button" type="button" disabled={!lineId || !file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Uploading…" : "Upload Artwork"}</button>
    </div>}
    {upload.isError && <p className="v2-product-version-message" role="alert">{(upload.error as Error).message}</p>}
    {remove.isError && <p className="v2-product-version-message" role="alert">{(remove.error as Error).message}</p>}
  </section>;
};
