import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemOverrideToggleProps = {
  label?: string;
  checked?: boolean | null;
  onCheckedChange?: (nextChecked: boolean) => void;
  className?: string;
};

export default function LineItemOverrideToggle({
  label = "Override",
  checked,
  onCheckedChange,
  className,
}: LineItemOverrideToggleProps) {
  const isOn = Boolean(checked);
  const isEditable = typeof onCheckedChange === "function";

  return (
    <div className={`${styles.li__override} ${className ?? ""}`}>
      <div className={`${styles.li__label} ${styles.li__labelCenter} ${styles.li__overrideLabel}`}>{label}</div>
      <button
        type="button"
        className={`${styles.li__toggle} ${isOn ? styles.li__toggleOn : ""}`}
        data-li-interactive="true"
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditable) return;
          onCheckedChange?.(!isOn);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={!isEditable}
        aria-pressed={isOn}
        aria-label={label}
      >
        <span className={styles.li__toggleKnob} aria-hidden="true">
          ✓
        </span>
      </button>
    </div>
  );
}
