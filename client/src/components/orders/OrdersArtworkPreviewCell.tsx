import { FileText, Loader2 } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

import type { OrderRow } from "@/hooks/useOrders";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import type { OrdersArtworkViewerTarget } from "@/lib/ordersArtworkViewer";

type OrdersArtworkPreviewCellProps = {
  row: OrderRow;
  includeThumbnails: boolean;
  loading: boolean;
  onOpenArtwork: (orderId: string, target?: OrdersArtworkViewerTarget) => void;
};

/**
 * The live `/orders` Preview-column control. Keeping the event boundary here
 * makes its viewer behavior render-testable without changing the table UI.
 */
export function OrdersArtworkPreviewCell({
  row,
  includeThumbnails,
  loading,
  onOpenArtwork,
}: OrdersArtworkPreviewCellProps) {
  const summary = row.attachmentsSummary;
  const previews = summary?.previews ?? [];
  const totalCount = summary?.totalCount ?? 0;
  const rowPreviewThumbnailUrls = Array.isArray(row.previewThumbnailUrls)
    ? row.previewThumbnailUrls
        .map((url) => getThumbSrc({ thumbnailUrl: url }))
        .filter((url): url is string => typeof url === "string" && url.length > 0)
        .slice(0, 3)
    : [];
  const rowThumbSrc = getThumbSrc(row);

  const openArtwork = (event: MouseEvent<HTMLButtonElement>, target: OrdersArtworkViewerTarget = {}) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenArtwork(row.id, target);
  };

  const stopPointerPropagation = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();

  if (!includeThumbnails || ((!summary || totalCount === 0) && !rowThumbSrc)) {
    return (
      <div className="flex items-center h-8">
        <span className="text-muted-foreground">—</span>
      </div>
    );
  }

  if ((!summary || totalCount === 0) && rowPreviewThumbnailUrls.length > 0) {
    const totalForOverflow = typeof row.previewThumbnailCount === "number"
      ? row.previewThumbnailCount
      : rowPreviewThumbnailUrls.length;
    const extra = Math.max(0, totalForOverflow - rowPreviewThumbnailUrls.length);

    return (
      <div className="flex items-center gap-1.5 h-8" data-stop-row-nav="true">
        {rowPreviewThumbnailUrls.map((src, index) => (
          <button
            key={`${row.id}-preview-${index}`}
            type="button"
            className="w-8 h-8 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center"
            onClick={(event) => openArtwork(event, { thumbnailUrl: src })}
            onPointerDown={stopPointerPropagation}
            disabled={loading}
            aria-label="Open artwork viewer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
              <img
                src={resolveObjectsPublicUrl(src) ?? src}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            )}
          </button>
        ))}
        {extra > 0 ? (
          <button
            type="button"
            className="h-8 px-2 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
            onClick={(event) => openArtwork(event)}
            onPointerDown={stopPointerPropagation}
            disabled={loading}
            aria-label={`Open artwork viewer with ${extra} more files`}
          >
            +{extra}
          </button>
        ) : null}
      </div>
    );
  }

  if ((!summary || totalCount === 0) && rowThumbSrc) {
    return (
      <button
        type="button"
        className="flex items-center h-8"
        onClick={(event) => openArtwork(event, { thumbnailUrl: rowThumbSrc })}
        onPointerDown={stopPointerPropagation}
        disabled={loading}
        data-stop-row-nav="true"
        aria-label="Open artwork viewer"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
          <img src={rowThumbSrc} alt="Preview" className="w-8 h-8 rounded object-cover" />
        )}
      </button>
    );
  }

  const shown = previews.slice(0, 3);
  const extraCount = Math.max(0, totalCount - shown.length);

  return (
    <div className="flex items-center gap-1.5 h-8" data-stop-row-nav="true">
      {shown.map((preview) => {
        const thumbnailUrl = getThumbSrc(preview);
        return (
          <button
            key={preview.id}
            type="button"
            className="w-8 h-8 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center"
            onClick={(event) => openArtwork(event, { attachmentId: preview.id, thumbnailUrl })}
            onPointerDown={stopPointerPropagation}
            disabled={loading}
            aria-label={`Open artwork viewer for ${preview.filename}`}
          >
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt={preview.filename} className="w-full h-full object-cover" />
            ) : (
              <FileText className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        );
      })}
      {extraCount > 0 ? (
        <button
          type="button"
          className="h-8 px-2 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
          onClick={(event) => openArtwork(event)}
          onPointerDown={stopPointerPropagation}
          disabled={loading}
          aria-label={`Open artwork viewer with ${extraCount} more files`}
        >
          +{extraCount}
        </button>
      ) : null}
    </div>
  );
}
