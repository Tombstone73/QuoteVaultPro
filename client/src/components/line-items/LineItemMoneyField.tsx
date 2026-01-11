import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemMoneyFieldProps = {
  label?: string;
  value?: number | null;
  className?: string;
};

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function LineItemMoneyField({
  label = "Unit",
  value,
  className,
}: LineItemMoneyFieldProps) {
  return (
    <div className={`${styles.li__field} ${className ?? ""}`}>
      <div className={styles.li__label}>{label}</div>
      <div className={styles.li__moneyWrap} aria-label={label}>
        <div className={styles.li__moneyPrefix} aria-hidden="true">
          $
        </div>
        <input
          className={styles.li__inputMoney}
          value={formatMoney(value)}
          readOnly
          tabIndex={-1}
          aria-label={label}
        />
      </div>
    </div>
  );
}
