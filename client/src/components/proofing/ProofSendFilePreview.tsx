import { useState } from "react";
import { FileImage, Loader2 } from "lucide-react";
import { openAuthenticatedImagePreview, openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview";

/** Uses the same version-owned bytes and authenticated reader as the main viewer. */
export function ProofSendFilePreview({ versionId, url, previewUrl, isPdf, ready, error }: {
  versionId: string;
  url: string | null;
  previewUrl: string | null;
  isPdf: boolean;
  ready: boolean;
  error: string | null;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const open = async () => {
    if (!url || !ready || opening) return;
    setOpening(true); setOpenError(null);
    try {
      if (isPdf) await openAuthenticatedPdfPreview(url);
      else await openAuthenticatedImagePreview(url);
    } catch (failure) {
      setOpenError(failure instanceof Error ? failure.message : "Unable to open proof. Retry file access in the main viewer.");
    } finally { setOpening(false); }
  };
  return <div className="flex shrink-0 flex-col items-start gap-1" data-proof-version-id={versionId}>
    {previewUrl && !imageFailed ? <img src={previewUrl} alt="Proof thumbnail" className="h-16 w-16 rounded border bg-background object-contain" onError={() => setImageFailed(true)}/>
      : <div className="flex h-16 w-16 items-center justify-center rounded border bg-muted" title="Proof thumbnail unavailable"><FileImage aria-hidden="true" className="h-7 w-7 text-muted-foreground"/><span className="sr-only">Proof thumbnail unavailable</span></div>}
    <button type="button" onClick={() => void open()} disabled={!ready || !url || opening}
      className="rounded text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline">
      {opening && <Loader2 aria-hidden="true" className="mr-1 inline h-3 w-3 animate-spin"/>}Open / Download
    </button>
    {error || openError ? <p role="alert" className="max-w-64 text-xs text-destructive">{error || openError}</p> : null}
  </div>;
}
