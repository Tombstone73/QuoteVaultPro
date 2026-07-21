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
  const columnWidth = fitColumns
    ? Math.max(minimumColumnWidth, availableColumnWidth)
    : Math.max(minimumColumnWidth, normalColumnWidth);
  const contentWidth = columnWidth * safeColumnCount + totalGapWidth;
  const trackWidth = Math.max(safeContainerWidth, contentWidth);
  return { columnWidth, trackWidth, requiresHorizontalScroll: contentWidth > safeContainerWidth };
}

export function ProductionBoardScrollArea({
  children,
  minimumWidth,
  trackWidth,
  onViewportWidthChange,
}: {
  children: ReactNode;
  minimumWidth: number;
  trackWidth: number;
  onViewportWidthChange?: (width: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);

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
        className="block w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-gutter:stable] [touch-action:pan-x_pan-y]"
      >
        <div
          data-testid="production-board-column-track"
          className="flex min-w-full flex-nowrap items-start gap-4 pb-4"
          style={{ minWidth: `${minimumWidth}px`, width: `${trackWidth}px` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
