import * as React from "react";

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

  React.useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[data-li-status-root="true"]`)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className={styles.li__statusRoot} data-li-status-root="true">
      <button
        type="button"
        className={`${styles.li__status} ${toneClass(tone)} ${className ?? ""}`}
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

      {canChange && open ? (
        <div className={styles.li__statusMenu} role="listbox" aria-label="Change status">
          {options!.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={styles.li__statusMenuItem}
              onClick={(e) => {
                e.stopPropagation();
                onChange?.(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
