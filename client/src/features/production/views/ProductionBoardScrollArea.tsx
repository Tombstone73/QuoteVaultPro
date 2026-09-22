import { useEffect, useRef, type ReactNode } from "react";

export const MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH = 320;

export function productionOverviewBoardMinimumWidth(columnCount: number, gap = 16): number {
  return Math.max(0, columnCount * MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH + Math.max(0, columnCount - 1) * gap);
}

export type ProductionBoardLayout = {
  columnWidth: number;
  trackWidth: number;
  requiresHorizontalScroll: boolean;
};

export function calculateProductionBoardLayout({
  containerWidth,
  columnCount,
  fitColumns,
  minimumColumnWidth = MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH,
  normalColumnWidth = 420,
  gap = 16,
}: {
  containerWidth: number;
  columnCount: number;
  fitColumns: boolean;
  minimumColumnWidth?: number;
  normalColumnWidth?: number;
  gap?: number;
}): ProductionBoardLayout {
  const safeContainerWidth = Math.max(0, Math.floor(containerWidth));
  const safeColumnCount = Math.max(0, Math.floor(columnCount));
  const totalGapWidth = Math.max(0, safeColumnCount - 1) * gap;
  if (safeColumnCount === 0) {
    return { columnWidth: normalColumnWidth, trackWidth: safeContainerWidth, requiresHorizontalScroll: false };
  }

  const availableColumnWidth = Math.floor(Math.max(0, safeContainerWidth - totalGapWidth) / safeColumnCount);
  // Fit mode wraps columns into readable rows. It never widens the track just
  // because all stations cannot fit side by side at a useful card width.
  if (fitColumns) {
    return { columnWidth: Math.max(240, availableColumnWidth), trackWidth: safeContainerWidth, requiresHorizontalScroll: false };
  }
  const columnWidth = Math.max(minimumColumnWidth, normalColumnWidth);
  const contentWidth = columnWidth * safeColumnCount + totalGapWidth;
  const trackWidth = Math.max(safeContainerWidth, contentWidth);
  return { columnWidth, trackWidth, requiresHorizontalScroll: contentWidth > safeContainerWidth };
}

export function ProductionBoardScrollArea({
  children,
  minimumWidth,
  trackWidth,
  fitColumns = false,
  onViewportWidthChange,
}: {
  children: ReactNode;
  minimumWidth: number;
  trackWidth: number;
  fitColumns?: boolean;
  onViewportWidthChange?: (width: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const syncScroll = (source: "board" | "rail") => {
    const viewport = viewportRef.current;
    const rail = railRef.current;
    if (!viewport || !rail) return;
    if (source === "board") rail.scrollLeft = viewport.scrollLeft;
    else viewport.scrollLeft = rail.scrollLeft;
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !onViewportWidthChange) return;
    const publishWidth = (candidate?: number) => {
      const width = Math.max(0, Math.floor(candidate || viewport.clientWidth || viewport.getBoundingClientRect().width || 0));
      onViewportWidthChange(width);
    };
    publishWidth();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) publishWidth(entry.contentRect.width);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [onViewportWidthChange]);

  return (
    <div className="w-full min-w-0 max-w-full" data-testid="production-board-width-boundary">
      <div
        ref={viewportRef}
        data-testid="production-board-scroll-viewport"
        onScroll={() => syncScroll("board")}
        className={`block w-full min-w-0 max-w-full overscroll-x-contain pb-1 [touch-action:pan-x_pan-y] ${fitColumns ? "overflow-x-hidden" : "overflow-x-auto [scrollbar-gutter:stable]"}`}
      >
        <div
          data-testid="production-board-column-track"
          className={fitColumns ? "grid w-full min-w-0 items-start gap-2 pb-4" : "flex min-w-full flex-nowrap items-start gap-4 pb-4"}
          style={fitColumns
            ? { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }
            : { minWidth: `${minimumWidth}px`, width: `${trackWidth}px` }}
        >
          {children}
        </div>
      </div>
      {!fitColumns && (
        <div
          ref={railRef}
          aria-label="Scroll production stations"
          data-testid="production-board-bottom-scrollbar"
          onScroll={() => syncScroll("rail")}
          className="sticky bottom-0 z-20 h-4 w-full overflow-x-auto overflow-y-hidden bg-background/95"
        >
          <div style={{ width: `${trackWidth}px`, height: 1 }} />
        </div>
      )}
    </div>
  );
}
