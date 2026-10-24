import * as React from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { floatingViewport, moveFloatingBounds, resizeFloatingBounds, type FloatingBounds, type ResizeDirection } from "./assistantFloatingBounds";

const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: "n", className: "left-4 right-4 top-0 h-2 cursor-n-resize" },
  { direction: "ne", className: "right-0 top-0 h-4 w-4 cursor-ne-resize" },
  { direction: "e", className: "bottom-4 right-0 top-4 w-2 cursor-e-resize" },
  { direction: "se", className: "bottom-0 right-0 h-4 w-4 cursor-se-resize" },
  { direction: "s", className: "bottom-0 left-4 right-4 h-2 cursor-s-resize" },
  { direction: "sw", className: "bottom-0 left-0 h-4 w-4 cursor-sw-resize" },
  { direction: "w", className: "bottom-4 left-0 top-4 w-2 cursor-w-resize" },
  { direction: "nw", className: "left-0 top-0 h-4 w-4 cursor-nw-resize" },
];

export function AssistantFloatingFrame({ bounds, onBoundsChange, onPersist, controls, children }: {
  bounds: FloatingBounds;
  onBoundsChange: (bounds: FloatingBounds) => void;
  onPersist: () => void;
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = React.useState(false);
  const stopInteractionRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => stopInteractionRef.current?.(), []);

  const startInteraction = (event: React.PointerEvent<HTMLElement>, direction?: ResizeDirection) => {
    if (!event.isPrimary || event.button !== 0) return;
    stopInteractionRef.current?.();
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const pointerOrigin = { x: event.clientX, y: event.clientY };
    const boundsOrigin = { ...bounds };
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaX = moveEvent.clientX - pointerOrigin.x;
      const deltaY = moveEvent.clientY - pointerOrigin.y;
      onBoundsChange(direction
        ? resizeFloatingBounds(boundsOrigin, direction, deltaX, deltaY, floatingViewport())
        : moveFloatingBounds(boundsOrigin, deltaX, deltaY, floatingViewport()));
    };
    const finish = () => {
      setDragging(false);
      onPersist();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", finish);
      stopInteractionRef.current = null;
    };
    const onPointerEnd = (endEvent: PointerEvent) => { if (endEvent.pointerId === pointerId) finish(); };
    stopInteractionRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", finish);
  };

  return <section className={cn("fixed z-[70] flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl", dragging && "select-none")}
    style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }} aria-label="PrintersHero assistant workspace">
    <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
      <div className="flex h-full min-w-0 flex-1 cursor-move touch-none items-center gap-2 text-sm font-semibold" onPointerDown={(event) => startInteraction(event)}>
        <Bot className="h-4 w-4 shrink-0 text-primary" /> Assistant
      </div>
      {controls}
    </div>
    {children}
    {RESIZE_HANDLES.map(({ direction, className }) => <div key={direction} data-testid={`assistant-resize-${direction}`}
      role="separator" tabIndex={0} aria-label={`Resize assistant ${direction}`}
      className={cn("absolute z-10 touch-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", className)}
      onPointerDown={(event) => startInteraction(event, direction)} onKeyDown={(event) => {
        const deltaX = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        const deltaY = event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0;
        if ((!deltaX && !deltaY) || (deltaX && !/[ew]/.test(direction)) || (deltaY && !/[ns]/.test(direction))) return;
        event.preventDefault();
        onBoundsChange(resizeFloatingBounds(bounds, direction, deltaX, deltaY, floatingViewport()));
        onPersist();
      }} />)}
  </section>;
}
