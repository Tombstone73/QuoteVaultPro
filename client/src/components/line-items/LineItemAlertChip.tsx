import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemAlertChipProps = {
  text?: string | null;
  placeholder?: boolean;
  className?: string;
};

export default function LineItemAlertChip({
  text,
  placeholder = true,
  className,
}: LineItemAlertChipProps) {
  const safeText = (text ?? "").trim();

  if (!safeText) {
    if (!placeholder) return null;
    return <div className={`${styles.li__alert} ${styles.li__alertEmpty} ${className ?? ""}`} />;
  }

  return (
    <div className={`${styles.li__alert} ${className ?? ""}`}
      title={safeText}
      aria-label={safeText}
    >
      <span className={styles.li__alertDot} aria-hidden="true" />
      <span className={styles.li__alertText}>{safeText}</span>
    </div>
  );
}
