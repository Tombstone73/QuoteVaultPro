import { forwardRef, type ReactNode } from "react";

export const MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH = 320;

export function productionOverviewBoardMinimumWidth(columnCount: number, gap = 16): number {
  return Math.max(0, columnCount * MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH + Math.max(0, columnCount - 1) * gap);
}

export const ProductionBoardScrollArea = forwardRef<HTMLDivElement, {
  children: ReactNode;
  minimumWidth: number;
  trackWidth?: number;
}>(({ children, minimumWidth, trackWidth }, ref) => (
  <div
    ref={ref}
    data-testid="production-board-scroll-viewport"
    className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-gutter:stable] [touch-action:pan-x_pan-y]"
  >
    <div
      data-testid="production-board-column-track"
      className="flex w-max min-w-full flex-nowrap items-start gap-4 pb-4"
      style={{
        minWidth: `${minimumWidth}px`,
        ...(trackWidth ? { width: `${trackWidth}px` } : {}),
      }}
    >
      {children}
    </div>
  </div>
));

ProductionBoardScrollArea.displayName = "ProductionBoardScrollArea";
