import type { MouseEvent, PointerEvent } from "react";

import type { OrdersArtworkViewerTarget } from "@/lib/ordersArtworkViewer";

type OrderLineItemArtworkPreviewProps = {
  lineNumber: number;
  thumbnailUrl: string;
  totalCount: number;
  target: OrdersArtworkViewerTarget;
  onOpenArtwork: (target: OrdersArtworkViewerTarget) => void;
};

/** The live Order Detail line-item artwork thumbnail. */
export function OrderLineItemArtworkPreview({
  lineNumber,
  thumbnailUrl,
  totalCount,
  target,
  onOpenArtwork,
}: OrderLineItemArtworkPreviewProps) {
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
      className="w-11 h-11 relative rounded overflow-hidden"
      data-li-interactive="true"
      onClick={openArtwork}
      onPointerDown={stopPointerPropagation}
      aria-label={`View artwork for Line ${lineNumber}`}
      title={`View artwork for Line ${lineNumber}`}
    >
      <img src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
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
