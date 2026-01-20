import { useState, useRef, useEffect, useCallback } from "react";

interface ResizablePanelsProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number; // Percentage (30-80)
  minLeftWidth?: number; // Percentage
  maxLeftWidth?: number; // Percentage
  storageKey?: string; // LocalStorage key for persistence
}

/**
 * ResizablePanels - Two-column layout with draggable divider
 * 
 * Features:
 * - Draggable vertical divider between panels
 * - Width percentage stored in localStorage
 * - Clamped between min/max widths
 * - Responsive: stacks on small screens
 */
export default function ResizablePanels({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 55,
  minLeftWidth = 35,
  maxLeftWidth = 75,
  storageKey = "resizablePanelsWidth",
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed) && parsed >= minLeftWidth && parsed <= maxLeftWidth) {
          return parsed;
        }
      }
    }
    return defaultLeftWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save to localStorage when width changes
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(leftWidth));
    }
  }, [leftWidth, storageKey]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const pointerX = e.clientX - containerRect.left;
      const newLeftWidthPct = (pointerX / containerWidth) * 100;

      // Clamp between min and max
      const clamped = Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidthPct));
      setLeftWidth(clamped);
    },
    [isDragging, minLeftWidth, maxLeftWidth]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [isDragging]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [isDragging]);

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row gap-0 min-h-0 flex-1">
      {/* Left panel */}
      <div
        className="flex-shrink-0 overflow-auto"
        style={{
          width: window.innerWidth >= 1024 ? `${leftWidth}%` : "100%",
        }}
      >
        {leftPanel}
      </div>

      {/* Draggable divider - only visible on large screens */}
      <div
        className="hidden lg:block relative flex-shrink-0 w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize group"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ touchAction: "none" }}
      >
        {/* Visual handle */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-primary/30 group-hover:bg-primary group-hover:w-1.5 transition-all" />
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-auto">{rightPanel}</div>
    </div>
  );
}
