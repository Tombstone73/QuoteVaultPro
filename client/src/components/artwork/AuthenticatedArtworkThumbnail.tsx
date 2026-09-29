import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { getArtworkObjectUrl, type ArtworkAccessVariant } from "@/lib/artworkAccess";
import { isEpsArtwork, isVectorArtwork, artworkPreviewMessage } from '@shared/artworkPreview';

type AuthenticatedArtworkThumbnailProps = {
  fileRecordId: string | null | undefined;
  alt: string;
  className?: string;
  onClick?: () => void;
  fallback: ReactNode;
  variant?: Exclude<ArtworkAccessVariant, "original">;
  fileName?: string | null;
  mimeType?: string | null;
  previewStatus?: string | null;
  previewError?: string | null;
};

/**
 * Renders a canonical artwork thumbnail through the authenticated artwork access
 * route. The object URL exists only for the lifetime of this component.
 */
export function AuthenticatedArtworkThumbnail({
  fileRecordId,
  alt,
  className,
  onClick,
  fallback,
  variant = "thumbnail",
  fileName,
  mimeType,
  previewStatus,
  previewError,
}: AuthenticatedArtworkThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [waitExpired, setWaitExpired] = useState(false);
  const vectorArtwork = isVectorArtwork(fileName, mimeType);
  const epsArtwork = isEpsArtwork(fileName, mimeType);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setSrc(null);
    setWaitExpired(false);

    if (!fileRecordId || epsArtwork) return undefined;

    const load = () => { void getArtworkObjectUrl(fileRecordId, variant)
      .then((url) => {
        objectUrl = url;
        if (active) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setSrc(null);
        if (active && vectorArtwork && ['uploaded', 'thumb_pending', 'pending'].includes(previewStatus ?? '')) {
          if (++attempts < 12) retryTimer = setTimeout(load, 5000);
          else setWaitExpired(true);
        }
      }); };
    load();

    return () => {
      active = false;
      clearTimeout(retryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileRecordId, variant, vectorArtwork, epsArtwork, previewStatus]);

  if (epsArtwork) return <div className={`flex flex-col items-center justify-center gap-1 text-center text-muted-foreground ${className || ''}`} data-testid="eps-artwork-fallback">
    <FileText className={variant === 'preview' ? 'h-9 w-9' : 'h-5 w-5'} />
    <span className="rounded border px-1.5 py-0.5 text-xs font-semibold">EPS</span>
    {variant === 'preview' && <><span className="max-w-full break-all text-sm">{fileName}</span><span className="text-xs">Preview unavailable</span></>}
  </div>;

  if (!src) return vectorArtwork ? <div className={`flex items-center justify-center p-3 text-center text-sm text-muted-foreground ${className || ''}`}>{waitExpired ? 'Preview unavailable. Refresh to check again or download the original.' : artworkPreviewMessage(previewStatus, previewError)}</div> : <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setSrc(null)}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}
