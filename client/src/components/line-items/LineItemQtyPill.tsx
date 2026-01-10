import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemQtyPillProps = {
  label?: string;
  value?: number | null;
  onValueChange?: (nextValue: number) => void;
  min?: number;
  step?: number;
  className?: string;
  inputClassName?: string;
};

export default function LineItemQtyPill({
  label = "Qty",
  value,
  onValueChange,
  min = 0,
  step = 1,
  className,
  inputClassName,
}: LineItemQtyPillProps) {
  const valueAsString = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const isEditable = typeof onValueChange === "function";

  return (
    <div className={`${styles.li__field} ${className ?? ""}`}>
      <div className={`${styles.li__label} ${styles.li__labelCenter}`}>{label}</div>
      <input
        className={`${styles.li__input} ${styles.li__inputQty} ${inputClassName ?? ""}`}
        type="number"
        inputMode="numeric"
        min={min}
        step={step}
        value={valueAsString}
        readOnly={!isEditable}
        disabled={!isEditable}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!onValueChange) return;
          if (!Number.isFinite(next)) return;
          onValueChange(next);
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={label}
      />
    </div>
  );
}
