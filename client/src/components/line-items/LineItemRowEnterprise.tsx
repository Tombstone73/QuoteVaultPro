import * as React from "react";

import "./lineItemTheme.css";
import styles from "./lineItemRowEnterprise.module.css";

import LineItemActionButtons from "./LineItemActionButtons";
import LineItemAlertChip from "./LineItemAlertChip";
import LineItemMainBlock from "./LineItemMainBlock";
import LineItemMoneyField from "./LineItemMoneyField";
import LineItemOverrideToggle from "./LineItemOverrideToggle";
import LineItemQtyPill from "./LineItemQtyPill";
import LineItemStatusPill from "./LineItemStatusPill";

export type LineItemEnterpriseRowModel = {
  id: string;
  title?: string | null;
  subtitle?: string | null;

  flags?: string[] | null;

  sku?: string | null;
  descShort?: string | null;
  descLong?: string | null;

  alertText?: string | null;
  statusLabel?: string | null;
  statusTone?: "neutral" | "blue" | "purple" | "green";

  qty?: number | null;
  unitPrice?: number | null;
  isOverride?: boolean | null;
  total?: number | null;
};

export type LineItemStatusOption = {
  value: string;
  label: string;
  tone?: "neutral" | "blue" | "purple" | "green";
};

export type LineItemRowEnterpriseProps = {
  item: LineItemEnterpriseRowModel;

  variant?: "tray" | "flat";

  thumbnail?: React.ReactNode;

  dragHandleProps?: {
    attributes?: Record<string, any> | undefined;
    listeners?: Record<string, any> | undefined;
    disabled?: boolean;
  };

  onRowClick?: (itemId: string) => void;

  onSaveNotes?: (
    itemId: string,
    draft: { sku: string; descShort: string; descLong: string }
  ) => Promise<void> | void;

  onQtyChange?: (itemId: string, nextQty: number) => void;
  onOverrideChange?: (itemId: string, nextChecked: boolean) => void;
  onOverrideTotalCommit?: (itemId: string, nextTotal: number) => Promise<void> | void;
  statusOptions?: LineItemStatusOption[];
  onStatusChange?: (itemId: string, nextStatus: string) => void;
  onDuplicate?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;

  className?: string;
};

export default function LineItemRowEnterprise({
  item,
  variant = "tray",
  thumbnail,
  dragHandleProps,
  onRowClick,
  onSaveNotes,
  onQtyChange,
  onOverrideChange,
  onOverrideTotalCommit,
  statusOptions,
  onStatusChange,
  onDuplicate,
  onDelete,
  className,
}: LineItemRowEnterpriseProps) {
  const totalValue = typeof item.total === "number" && Number.isFinite(item.total) ? item.total : null;

  const canEditTotal = Boolean(item.isOverride) && typeof onOverrideTotalCommit === "function";
  const [totalText, setTotalText] = React.useState<string>(
    totalValue === null ? "" : totalValue.toFixed(2)
  );

  React.useEffect(() => {
    if (!canEditTotal) return;
    setTotalText(totalValue === null ? "" : totalValue.toFixed(2));
  }, [canEditTotal, totalValue, item.id]);

  const handleRowClick = onRowClick ? () => onRowClick(item.id) : undefined;

  const dragDisabled = Boolean(dragHandleProps?.disabled);

  const isInteractiveTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.closest?.('[data-li-interactive="true"]')) return true;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
  };

  const parseCurrency = (raw: string): number | null => {
    const cleaned = raw.replace(/[^0-9.\-]/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const resetTotalText = () => {
    setTotalText(totalValue === null ? "" : totalValue.toFixed(2));
  };

  const commitTotal = () => {
    if (!canEditTotal) return;
    const parsed = parseCurrency(totalText);
    if (parsed == null) {
      resetTotalText();
      return;
    }
    onOverrideTotalCommit?.(item.id, parsed);
  };

  return (
    <div
      className={`liTheme ${styles.li} ${variant === "flat" ? styles.liFlat : ""} ${className ?? ""}`}
      onClick={handleRowClick}
      role={handleRowClick ? "button" : undefined}
      tabIndex={handleRowClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!handleRowClick) return;
        if (isInteractiveTarget(e.target)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleRowClick();
        }
      }}
    >
      <div
        className={`${styles.li__drag} ${dragDisabled ? styles.li__dragDisabled : ""}`}
        title={dragDisabled ? undefined : "Drag"}
        aria-label="Drag"
        {...(dragHandleProps?.attributes || {})}
        {...(dragHandleProps?.listeners || {})}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </div>

      <div className={styles.li__thumb} aria-hidden={!thumbnail} onClick={(e) => e.stopPropagation()}>
        {thumbnail ? thumbnail : <div className={styles.li__thumbInner} />}
      </div>

      <LineItemMainBlock
        title={item.title}
        subtitle={item.subtitle}
        flags={item.flags}
        sku={item.sku}
        descShort={item.descShort}
        descLong={item.descLong}
        onSaveNotes={(draft) => onSaveNotes?.(item.id, draft)}
      />

      <LineItemAlertChip text={item.alertText} placeholder />

      <LineItemQtyPill
        value={typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : null}
        onValueChange={onQtyChange ? (next) => onQtyChange(item.id, next) : undefined}
      />

      <LineItemStatusPill
        label={item.statusLabel}
        tone={item.statusTone ?? "neutral"}
        options={statusOptions}
        onChange={onStatusChange ? (next) => onStatusChange(item.id, next) : undefined}
      />

      <LineItemMoneyField label="Unit" value={item.unitPrice} />

      <LineItemOverrideToggle
        checked={item.isOverride}
        onCheckedChange={onOverrideChange ? (next) => onOverrideChange(item.id, next) : undefined}
      />

      <div className={styles.li__total}>
        <div className={`${styles.li__label} ${styles.li__labelRight}`}>Total</div>
        <div className={styles.li__totalValue} aria-label="Total">
          {canEditTotal ? (
            <div className={styles.li__moneyWrap} data-li-interactive="true" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              <div className={styles.li__moneyPrefix} aria-hidden="true">
                $
              </div>
              <input
                className={`${styles.li__inputMoney} ${styles.li__inputMoneyEditable}`}
                value={totalText}
                onChange={(e) => setTotalText(e.target.value)}
                onBlur={() => commitTotal()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commitTotal();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    resetTotalText();
                  }
                  if (e.key === " ") {
                    e.stopPropagation();
                  }
                }}
                inputMode="decimal"
                aria-label="Total"
              />
            </div>
          ) : totalValue === null ? (
            ""
          ) : (
            new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(totalValue)
          )}
        </div>
      </div>

      <LineItemActionButtons
        onDuplicate={onDuplicate ? () => onDuplicate(item.id) : undefined}
        onDelete={onDelete ? () => onDelete(item.id) : undefined}
      />
    </div>
  );
}

export function LineItemEnterprisePanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`liTheme ${styles.panel} ${className ?? ""}`}>
      {children}
    </div>
  );
}
