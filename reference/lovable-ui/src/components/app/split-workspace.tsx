import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared Sales Workspace split: list on the left, editor on the right.
 * Used by Orders today and by Quotes later — no lifecycle-specific behavior lives here.
 */

export const DEFAULT_SPLIT = 45; // % given to the list
const MIN_SPLIT = 30;
const MAX_SPLIT = 65;
const STORE_KEY = "ph.sales.splitPct";

/** Remembers the user's preferred split for the session (prototype-level persistence). */
export function useSplitPreference() {
  const [pct, setPct] = useState(DEFAULT_SPLIT);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v = raw ? Number(raw) : NaN;
    if (!Number.isNaN(v)) setPct(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, v)));
  }, []);

  const update = useCallback((v: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, v));
    setPct(clamped);
    window.localStorage.setItem(STORE_KEY, String(Math.round(clamped)));
  }, []);

  return [pct, update] as const;
}

export function SplitWorkspace({
  pct, onChange, left, right,
}: {
  pct: number;
  onChange: (v: number) => void;
  left: ReactNode;
  /** When null the list takes the full width and the divider disappears. */
  right: ReactNode | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      onChange(((e.clientX - box.left) / box.width) * 100);
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onChange]);

  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1" style={right ? { flex: `0 0 ${pct}%` } : undefined}>{left}</div>

      {right && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize line item editor"
            tabIndex={0}
            onPointerDown={(e) => { e.preventDefault(); setDragging(true); }}
            onDoubleClick={() => onChange(DEFAULT_SPLIT)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onChange(pct - 2);
              if (e.key === "ArrowRight") onChange(pct + 2);
            }}
            className={cn(
              "group relative w-2 shrink-0 cursor-col-resize touch-none border-x border-border/60 bg-surface-2/40 transition-colors",
              "hover:bg-primary/20 focus-visible:outline-none focus-visible:bg-primary/25",
              dragging && "bg-primary/30",
            )}
            title="Drag to resize · double-click to reset"
          >
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors",
                "group-hover:bg-primary/70",
                dragging && "bg-primary",
              )}
            />
          </div>
          <div className="min-w-0 flex-1">{right}</div>
        </>
      )}
    </div>
  );
}
