import * as React from "react";
import { createPortal } from "react-dom";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemStatusTone = "neutral" | "blue" | "purple" | "green";

export type LineItemStatusPillProps = {
  label?: string | null;
  tone?: LineItemStatusTone;
  onClick?: () => void;
  options?: Array<{ value: string; label: string }>;
  onChange?: (nextValue: string) => void;
  className?: string;
};

function toneClass(tone: LineItemStatusTone | undefined) {
  switch (tone) {
    case "blue":
      return styles.li__statusBlue;
    case "purple":
      return styles.li__statusPurple;
    case "green":
      return styles.li__statusGreen;
    default:
      return "";
  }
}

export default function LineItemStatusPill({
  label,
  tone = "neutral",
  onClick,
  options,
  onChange,
  className,
}: LineItemStatusPillProps) {
  const safeLabel = (label ?? "Status").trim() || "Status";

  const canChange = Array.isArray(options) && options.length > 0 && typeof onChange === "function";
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [menuRect, setMenuRect] = React.useState<{ top: number; left: number; width: number } | null>(null);

  const syncMenuPosition = React.useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuRect({
      top: r.bottom + 8,
      left: r.left,
      width: Math.max(160, r.width),
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    syncMenuPosition();

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[data-li-status-root="true"]`)) return;
      if (target.closest(`[data-li-status-portal="true"]`)) return;
      setOpen(false);
    };

    const onWin = () => syncMenuPosition();
    document.addEventListener("mousedown", onDocMouseDown);

    document.addEventListener("scroll", onWin, true);
    window.addEventListener("resize", onWin);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("scroll", onWin, true);
      window.removeEventListener("resize", onWin);
    };
  }, [open, syncMenuPosition]);

  return (
    <div className={styles.li__statusRoot} data-li-status-root="true">
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.li__status} ${toneClass(tone)} ${className ?? ""}`}
        data-li-interactive="true"
        onClick={(e) => {
          e.stopPropagation();
          if (canChange) {
            setOpen((v) => !v);
            return;
          }
          onClick?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={canChange ? false : !onClick}
        aria-haspopup={canChange ? "listbox" : undefined}
        aria-expanded={canChange ? open : undefined}
      >
        <span>{safeLabel}</span>
        <span className={styles.li__caret} aria-hidden="true">
          ▾
        </span>
      </button>

      {canChange && open && menuRect
        ? createPortal(
            <div
              className={styles.li__statusMenu}
              data-li-status-portal="true"
              role="listbox"
              aria-label="Change status"
              style={{
                position: "fixed",
                top: menuRect.top,
                left: menuRect.left,
                minWidth: menuRect.width,
                zIndex: 9999,
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {options!.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={styles.li__statusMenuItem}
                  data-li-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange?.(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
