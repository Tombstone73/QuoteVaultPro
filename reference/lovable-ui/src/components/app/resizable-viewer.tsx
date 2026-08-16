import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Reusable V2 pattern: a resizable + collapsible artwork viewer container.
 * First used by the Design Workstation; Prepress can adopt it later unchanged.
 */

export const DEFAULT_VIEWER_HEIGHT = 380;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 900;
const STORE_KEY = "ph.artworkViewer";

/** Remembers the operator's preferred viewer height + collapsed state across jobs. */
export function useViewerHeight() {
  const [height, setHeightState] = useState(DEFAULT_VIEWER_HEIGHT);
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { height?: number; collapsed?: boolean };
      if (typeof v.height === "number" && !Number.isNaN(v.height)) {
        setHeightState(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, v.height)));
      }
      if (typeof v.collapsed === "boolean") setCollapsedState(v.collapsed);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((h: number, c: boolean) => {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ height: Math.round(h), collapsed: c }));
  }, []);

  const setHeight = useCallback((v: number) => {
    const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, v));
    setHeightState(clamped);
    setCollapsedState((c) => { persist(clamped, c); return c; });
  }, [persist]);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    setHeightState((h) => { persist(h, v); return h; });
  }, [persist]);

  return { height, setHeight, collapsed, setCollapsed, resetHeight: () => setHeight(DEFAULT_VIEWER_HEIGHT) };
}

export function ArtworkViewerPanel({
  height, onHeightChange, collapsed, onCollapsedChange,
  sideControls, controls, summary, footer, children, className,
}: {
  height: number;
  onHeightChange: (v: number) => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  /** Side / source switchers — shown expanded and collapsed. */
  sideControls?: ReactNode;
  /** Zoom / fit / full screen controls (expanded only). */
  controls?: ReactNode;
  /** Compact context line shown when collapsed. */
  summary?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const top = stageRef.current?.getBoundingClientRect().top;
      if (top == null) return;
      onHeightChange(e.clientY - top);
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onHeightChange]);

  if (collapsed) {
    return (
      <div className={cn("rounded border border-border bg-surface-2/20 px-2.5 py-2", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Artwork</span>
            {summary}
          </div>
          <div className="flex items-center gap-1.5">
            {sideControls}
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => onCollapsedChange(false)}>
              <ChevronDown className="mr-1 size-3.5" />Expand Artwork
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded border border-border bg-surface-2/20 p-2.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">{sideControls}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {controls}
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => onCollapsedChange(true)}>
            <ChevronUp className="mr-1 size-3.5" />Collapse Artwork
          </Button>
        </div>
      </div>

      <div ref={stageRef} className="flex flex-col" style={{ height: `${Math.round(height)}px` }}>
        {children}
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize artwork viewer"
        tabIndex={0}
        onPointerDown={(e) => { e.preventDefault(); setDragging(true); }}
        onDoubleClick={() => onHeightChange(DEFAULT_VIEWER_HEIGHT)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onHeightChange(height - 24);
          if (e.key === "ArrowDown") onHeightChange(height + 24);
        }}
        title="Drag to resize · double-click to reset"
        className={cn(
          "group relative h-2 shrink-0 cursor-row-resize touch-none rounded bg-surface-2/40 transition-colors",
          "hover:bg-primary/20 focus-visible:bg-primary/25 focus-visible:outline-none",
          dragging && "bg-primary/30",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors",
            "group-hover:bg-primary/70",
            dragging && "bg-primary",
          )}
        />
      </div>

      {footer}
    </div>
  );
}
