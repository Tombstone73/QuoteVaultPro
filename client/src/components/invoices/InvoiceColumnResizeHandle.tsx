import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  label: string;
  width: number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
};

export function InvoiceColumnResizeHandle({ label, width, onPreview, onCommit }: Props) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const widthAt = (clientX: number) => width + clientX - startX;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) onPreview(widthAt(moveEvent.clientX));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      cleanupRef.current = null;
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      onCommit(widthAt(upEvent.clientX));
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      onCommit(width);
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none border-r border-transparent hover:border-primary focus-visible:border-primary focus-visible:outline-none"
      onPointerDown={startResize}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        onCommit(width + (event.key === "ArrowRight" ? 10 : -10));
      }}
    />
  );
}
