import * as React from "react";

import "./lineItemTheme.css";
import styles from "./lineItemRowEnterprise.module.css";

import LineItemActionButtons from "./LineItemActionButtons";
import LineItemAlertChip from "./LineItemAlertChip";
import LineItemMainBlock from "./LineItemMainBlock";
import LineItemQtyPill from "./LineItemQtyPill";
import LineItemStatusPill from "./LineItemStatusPill";

export type LineItemEnterpriseRowModel = {
  id: string;
  title?: string | null;
  subtitle?: string | null;

  optionsSummary?: string | null;

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

  onQtyChange?: (itemId: string, nextQty: number) => Promise<void> | void;
  onOverrideChange?: (itemId: string, nextChecked: boolean) => void;
  onOverrideUnitCommit?: (itemId: string, nextUnitPrice: number) => Promise<void> | void;
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
  onOverrideUnitCommit,
  onOverrideTotalCommit,
  statusOptions,
  onStatusChange,
  onDuplicate,
  onDelete,
  className,
}: LineItemRowEnterpriseProps) {
  const unitValue =
    typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) ? item.unitPrice : null;
  const totalValue = typeof item.total === "number" && Number.isFinite(item.total) ? item.total : null;

  const canEditUnit = Boolean(item.isOverride) && typeof onOverrideUnitCommit === "function";
  const canEditTotal = Boolean(item.isOverride) && typeof onOverrideTotalCommit === "function";

  const canToggleOverride = typeof onOverrideChange === "function";
  const isOverrideOn = Boolean(item.isOverride);

  const [unitText, setUnitText] = React.useState<string>(unitValue === null ? "" : unitValue.toFixed(2));
  const [totalText, setTotalText] = React.useState<string>(
    totalValue === null ? "" : totalValue.toFixed(2)
  );

  React.useEffect(() => {
    if (!canEditUnit) return;
    setUnitText(unitValue === null ? "" : unitValue.toFixed(2));
  }, [canEditUnit, unitValue, item.id]);

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

  const resetUnitText = () => {
    setUnitText(unitValue === null ? "" : unitValue.toFixed(2));
  };

  const commitUnit = async () => {
    if (!canEditUnit) return;
    const parsed = parseCurrency(unitText);
    if (parsed == null) {
      resetUnitText();
      return;
    }
    try {
      await onOverrideUnitCommit?.(item.id, parsed);
    } catch (e) {
      console.error("Failed to update override unit price", e);
    }
  };

  const commitTotal = async () => {
    if (!canEditTotal) return;
    const parsed = parseCurrency(totalText);
    if (parsed == null) {
      resetTotalText();
      return;
    }
    try {
      await onOverrideTotalCommit?.(item.id, parsed);
    } catch (e) {
      console.error("Failed to update override total", e);
    }
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
        optionsSummary={item.optionsSummary}
        flags={item.flags}
        sku={item.sku}
        descShort={item.descShort}
        descLong={item.descLong}
        onSaveNotes={(draft) => onSaveNotes?.(item.id, draft)}
      />

      <LineItemAlertChip text={item.alertText} placeholder />

      <LineItemStatusPill
        label={item.statusLabel}
        tone={item.statusTone ?? "neutral"}
        options={statusOptions}
        onChange={onStatusChange ? (next) => onStatusChange(item.id, next) : undefined}
      />

      <LineItemQtyPill
        value={typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : null}
        onValueChange={onQtyChange ? (next) => onQtyChange(item.id, next) : undefined}
      />

      <div className={styles.li__field}>
        <div className={styles.li__label}>Unit</div>
        <div className={styles.li__moneyWrap} aria-label="Unit" data-li-interactive="true" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <div className={styles.li__moneyPrefix} aria-hidden="true">
            $
          </div>
          <input
            className={`${styles.li__inputMoney} ${canEditUnit ? styles.li__inputMoneyEditable : ""}`}
            value={canEditUnit ? unitText : unitValue === null ? "" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(unitValue)}
            placeholder={unitValue === null ? "—" : undefined}
            readOnly={!canEditUnit}
            tabIndex={canEditUnit ? 0 : -1}
            onChange={canEditUnit ? (e) => setUnitText(e.target.value) : undefined}
            onBlur={canEditUnit ? () => void commitUnit() : undefined}
            onKeyDown={
              canEditUnit
                ? (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      void commitUnit();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      resetUnitText();
                    }
                    if (e.key === " ") {
                      e.stopPropagation();
                    }
                  }
                : undefined
            }
            inputMode="decimal"
            aria-label="Unit"
          />
        </div>
      </div>

      <div className={styles.li__overrideInline} data-li-interactive="true" aria-label="Override pricing">
        <span className={styles.li__overrideMiniLabel} aria-hidden="true">
          OVR
        </span>
        <button
          type="button"
          className={`${styles.li__toggle} ${isOverrideOn ? styles.li__toggleOn : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!canToggleOverride) return;
            onOverrideChange?.(item.id, !isOverrideOn);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!canToggleOverride}
          aria-pressed={isOverrideOn}
          aria-label="Override pricing"
        >
          <span className={styles.li__toggleKnob} aria-hidden="true">
            ✓
          </span>
        </button>
      </div>

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
                onBlur={() => {
                  void commitTotal();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    void commitTotal();
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
