import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { FileText } from "lucide-react";

import type { OrdersArtworkViewerTarget } from "@/lib/ordersArtworkViewer";

type OrderLineItemArtworkPreviewProps = {
  lineNumber: number;
  thumbnailUrl: string;
  totalCount: number;
  target: OrdersArtworkViewerTarget;
  onOpenArtwork: (target: OrdersArtworkViewerTarget) => void;
  size?: "compact" | "expanded";
};

/** The live Order Detail line-item artwork thumbnail. */
export function OrderLineItemArtworkPreview({
  lineNumber,
  thumbnailUrl,
  totalCount,
  target,
  onOpenArtwork,
  size = "compact",
}: OrderLineItemArtworkPreviewProps) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [thumbnailUrl]);
  const openArtwork = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenArtwork(target);
  };

  const stopPointerPropagation = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();
  const overflowCount = Math.max(0, totalCount - 1);

  return (
    <button
      type="button"
      className={size === "expanded"
        ? "h-24 w-32 sm:h-28 sm:w-36 shrink-0 relative rounded border border-border/60 bg-muted/30 overflow-hidden"
        : "w-11 h-11 shrink-0 relative rounded overflow-hidden"}
      data-li-interactive="true"
      onClick={openArtwork}
      onPointerDown={stopPointerPropagation}
      aria-label={`View artwork for Line ${lineNumber}`}
      title={`View artwork for Line ${lineNumber}`}
    >
      {imageFailed ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" title="Thumbnail unavailable">
          <FileText className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : (
        <img src={thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain pointer-events-none" onError={() => setImageFailed(true)} />
      )}
      {overflowCount > 0 ? (
        <div
          className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-background/90 border border-border text-[11px] text-foreground flex items-center justify-center"
          aria-hidden
        >
          +{overflowCount}
        </div>
      ) : null}
    </button>
  );
}
