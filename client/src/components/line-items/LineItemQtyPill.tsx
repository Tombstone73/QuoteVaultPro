import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemQtyPillProps = {
  label?: string;
  value?: number | null;
  onValueChange?: (nextValue: number) => Promise<void> | void;
  min?: number;
  step?: number;
  className?: string;
  inputClassName?: string;
};

export default function LineItemQtyPill({
  label = "Qty",
  value,
  onValueChange,
  min = 1,
  step = 1,
  className,
  inputClassName,
}: LineItemQtyPillProps) {
  const isEditable = typeof onValueChange === "function";

  const valueAsString = typeof value === "number" && Number.isFinite(value) ? String(value) : "";

  const [text, setText] = React.useState<string>(valueAsString);
  const [isFocused, setIsFocused] = React.useState(false);
  const [isDirty, setIsDirty] = React.useState(false);

  React.useEffect(() => {
    if (isDirty) return;
    setText(valueAsString);
  }, [valueAsString, isFocused, isDirty]);

  const resetText = () => {
    setText(valueAsString);
    setIsDirty(false);
  };

  const parseQty = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    return n;
  };

  const commit = async () => {
    if (!isEditable) return;

    const parsed = parseQty(text);
    if (parsed == null) {
      resetText();
      return;
    }

    if (!Number.isFinite(parsed) || parsed < min) {
      resetText();
      return;
    }

    if (valueAsString === String(parsed)) {
      setText(String(parsed));
      setIsDirty(false);
      return;
    }

    try {
      await onValueChange?.(parsed);
      setText(String(parsed));
      setIsDirty(false);
    } catch (e) {
      // Fail-soft: caller should toast; keep typed value.
      setIsDirty(true);
      throw e;
    }
  };

  return (
    <div className={`${styles.li__field} ${className ?? ""}`}>
      <div className={`${styles.li__label} ${styles.li__labelCenter}`}>{label}</div>
      <input
        className={`${styles.li__input} ${styles.li__inputQty} ${inputClassName ?? ""}`}
        data-li-interactive="true"
        type="number"
        inputMode="numeric"
        min={min}
        step={step}
        value={text}
        readOnly={!isEditable}
        disabled={!isEditable}
        onChange={(e) => {
          setText(e.target.value);
          setIsDirty(true);
        }}
        onFocus={() => {
          if (!isEditable) return;
          setIsFocused(true);
        }}
        onBlur={() => {
          setIsFocused(false);
          void commit().catch(() => {
            // Keep input value on error.
          });
        }}
        onKeyDown={(e) => {
          if (!isEditable) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void commit().catch(() => {
              // Keep input value on error.
            });
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            resetText();
          }
          if (e.key === " ") {
            e.stopPropagation();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={label}
      />
    </div>
  );
}
