import React, { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { artworkApi, newBusinessRequestId, type ArtworkOrderProjection, type ArtworkRemovalResult } from "./api";

export type ArtworkRemovalAction = Readonly<{ orderNumber: string; onRemoved: (result: ArtworkRemovalResult) => Promise<void> }>;
const RemoveArtwork = ({ organizationId, entry, action }: Readonly<{ organizationId: string; entry: ArtworkOrderProjection; action: ArtworkRemovalAction }>) => {
  const requestId = useRef<string>();
  const mutation = useMutation({
    mutationFn: () => artworkApi.remove(organizationId, requestId.current!, entry.assignment),
    onSuccess: action.onRemoved,
  });
  const error = mutation.error as { code?: string; message?: string } | null;
  return <div><button type="button" className="button secondary" aria-label={`Remove Artwork: ${entry.file.displayFilename}`} disabled={mutation.isPending} onClick={() => {
    if (!window.confirm(`Remove "${entry.file.displayFilename}" from Order #${action.orderNumber.replace(/^#/, "")}? This removes it from the current job. The file and historical evidence are retained.`)) return;
    requestId.current ??= newBusinessRequestId();
    mutation.mutate();
  }}>{mutation.isPending ? "Removing…" : "Remove"}</button>
    {error && <p role="alert">{error.code === "CONFLICT" ? error.message : error.code === "FORBIDDEN" ? "You do not have permission to remove Artwork." : "Artwork removal could not be confirmed. Refresh the Order or retry this action."}</p>}
  </div>;
};

/** The V2 streaming route enforces tenant and artwork.view; never use storage URLs. */
export const loadArtworkPdf = async (organizationId: string, fileId: string, signal: AbortSignal): Promise<Blob> => {
  const response = await fetch(artworkApi.contentUrl(organizationId, fileId), { credentials: "include", cache: "no-store", signal });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) throw new Error("Artwork preview unavailable.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("Artwork preview unavailable.");
  return blob;
};

export const ArtworkFileViewer = ({ organizationId, entry, onClose }: Readonly<{
  organizationId: string; entry: ArtworkOrderProjection; onClose: () => void;
}>) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(undefined); setFailed(false);
    void loadArtworkPdf(organizationId, entry.file.id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [organizationId, entry.file.id, attempt]);
  return <dialog className="v2-artwork-viewer" ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{entry.file.displayFilename}</h2><button type="button" className="button secondary" onClick={onClose}>Close Artwork viewer</button></header>
    {failed ? <div role="alert"><p>Artwork could not be opened. Check your access or retry.</p><button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>Retry preview</button></div>
      : !url ? <p role="status">Loading Artwork PDF…</p>
        : <><nav aria-label="PDF actions"><a href={url} target="_blank" rel="noreferrer">Open PDF in new tab</a><a href={url} download={entry.file.displayFilename}>Download PDF</a></nav>
          <object aria-label={`PDF ${entry.file.displayFilename}`} data={`${url}#page=${(entry.assignment.sourcePageIndex ?? 0) + 1}&view=FitH`} type="application/pdf">
            <p>Your browser cannot display this PDF here. Use Open PDF in new tab or Download PDF.</p>
          </object></>}
  </dialog>;
};

/** Shared per-file action for line detail, the Order-wide tab and compact previews. */
export const OrderArtworkFile = ({ organizationId, entry, canView, compact = false, removal }: Readonly<{
  organizationId: string; entry: ArtworkOrderProjection; canView: boolean; compact?: boolean; removal?: ArtworkRemovalAction;
}>) => {
  const [open, setOpen] = useState(false);
  if (!canView) return null;
  const filename = entry.file.displayFilename;
  return <div className={compact ? "v2-artwork-file is-compact" : "v2-artwork-file"}>
    <button type="button" className="v2-artwork-thumbnail" aria-label={`View thumbnail: ${filename}`} onClick={() => setOpen(true)}>
      <iframe tabIndex={-1} aria-hidden="true" title={`Artwork preview ${filename}`} className="v2-order-line-artwork-preview" src={`${artworkApi.contentUrl(organizationId, entry.file.id)}#page=${(entry.assignment.sourcePageIndex ?? 0) + 1}`} />
    </button>
    {!compact && <><span><button type="button" className="v2-sales-inline-button" onClick={() => setOpen(true)}>{filename}</button><small>{entry.assignment.purpose.replaceAll("_", " ")} · {entry.assignment.side ?? "unspecified side"}</small></span><button type="button" className="button secondary" aria-label={`View Artwork: ${filename}`} onClick={() => setOpen(true)}>View Artwork</button></>}
    {!compact && removal && <RemoveArtwork organizationId={organizationId} entry={entry} action={removal} />}
    {open && <ArtworkFileViewer organizationId={organizationId} entry={entry} onClose={() => setOpen(false)} />}
  </div>;
};
