import * as React from "react";

import "./lineItemTheme.css";
import styles from "./lineItemRowEnterprise.module.css";

import LineItemActionButtons from "./LineItemActionButtons";
import LineItemAlertChip from "./LineItemAlertChip";
import LineItemMainBlock from "./LineItemMainBlock";
import LineItemQtyPill from "./LineItemQtyPill";
import LineItemStatusPill from "./LineItemStatusPill";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LineItemFlagVM, LineItemOptionSummaryVM } from "@/lib/lineItems/lineItemDerivation";
import type { PBV2Outputs } from "@/lib/pbv2/pbv2Outputs";

export type LineItemEnterpriseRowModel = {
  id: string;
  title?: string | null;
  subtitle?: string | null;

  optionsSummary?: LineItemOptionSummaryVM | null;
  optionsSummaryText?: string | null;

  flags?: LineItemFlagVM[] | null;

  notes?: string | null;

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

  pbv2Outputs?: PBV2Outputs;

  pbv2AcceptedComponents?: Array<{
    id: string;
    kind: string;
    title: string;
    skuRef?: string | null;
    childProductId?: string | null;
    qty: any;
    amountCents?: number | null;
    invoiceVisibility?: string | null;
    pbv2SourceNodeId?: string | null;
    pbv2EffectIndex?: number | null;
  }>;

  onAcceptPbv2Components?: (itemId: string) => Promise<void> | void;
  onVoidPbv2Component?: (componentId: string) => Promise<void> | void;

  variant?: "tray" | "flat";

  thumbnail?: React.ReactNode;

  dragHandleProps?: {
    attributes?: Record<string, any> | undefined;
    listeners?: Record<string, any> | undefined;
    disabled?: boolean;
  };

  onRowClick?: (itemId: string) => void;

  onDescriptionCommit?: (itemId: string, nextDescription: string) => Promise<void> | void;
  onNotesClick?: (itemId: string) => void;

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
  pbv2Outputs,
  pbv2AcceptedComponents,
  onAcceptPbv2Components,
  onVoidPbv2Component,
  variant = "tray",
  thumbnail,
  dragHandleProps,
  onRowClick,
  onDescriptionCommit,
  onNotesClick,
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

  const flagVMs = Array.isArray(item.flags) ? item.flags : [];

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

  const [pbv2Open, setPbv2Open] = React.useState(false);

  const formatUsdFromCents = (cents: number | undefined) => {
    if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  };

  const hasAnyPbv2Outputs = Boolean(
    pbv2Outputs?.pricingAddons || pbv2Outputs?.materialEffects || pbv2Outputs?.childItemProposals
  );

  const acceptedComponents = Array.isArray(pbv2AcceptedComponents) ? pbv2AcceptedComponents : [];
  const hasAcceptedComponents = acceptedComponents.length > 0;
  const canAcceptComponents =
    typeof onAcceptPbv2Components === "function" &&
    Boolean(pbv2Outputs?.childItemProposals?.childItems?.length) &&
    !hasAcceptedComponents;

  return (
    <div className="liTheme">
      <div
        className={`${styles.li} ${variant === "flat" ? styles.liFlat : ""} ${className ?? ""}`}
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
          description={item.subtitle}
          optionsSummary={item.optionsSummary}
          optionsSummaryText={item.optionsSummaryText}
          onDescriptionCommit={
            onDescriptionCommit
              ? (next) => onDescriptionCommit(item.id, next)
              : undefined
          }
        />

        <div className={styles.li__flagLane} aria-label="Flags">
          {item.alertText ? <LineItemAlertChip text={item.alertText} placeholder={false} /> : null}

          {flagVMs.length ? (
            <TooltipProvider delayDuration={150}>
              {flagVMs.map((f) => {
                const canClick =
                  (f.onClick === "expand_notes" && typeof onNotesClick === "function") ||
                  (f.onClick === "expand_artwork" && false);

                const chip = canClick ? (
                  <button
                    key={f.key}
                    type="button"
                    className={styles.li__flagChipVm}
                    data-tone={f.tone}
                    data-li-interactive="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (f.onClick === "expand_notes") onNotesClick?.(item.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={f.label}
                  >
                    {f.label}
                  </button>
                ) : (
                  <div
                    key={f.key}
                    className={styles.li__flagChipVm}
                    data-tone={f.tone}
                    data-li-interactive="true"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={f.label}
                  >
                    {f.label}
                  </div>
                );

                if (typeof f.tooltip === "string" && f.tooltip.trim().length) {
                  return (
                    <Tooltip key={f.key}>
                      <TooltipTrigger asChild>{chip}</TooltipTrigger>
                      <TooltipContent className="max-w-[420px] whitespace-pre-wrap break-words">
                        {f.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return chip;
              })}
            </TooltipProvider>
          ) : null}
        </div>

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

      {hasAnyPbv2Outputs ? (
        <div className="mt-2 rounded-md border border-border/60 bg-background/20 p-2" data-li-interactive="true" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <Collapsible open={pbv2Open} onOpenChange={setPbv2Open}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium">PBV2 Outputs</div>
              <CollapsibleTrigger asChild>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground">
                  {pbv2Open ? "Hide" : "Show"}
                </button>
              </CollapsibleTrigger>
            </div>

            <div className="mt-1 text-[11px] text-muted-foreground">
              Add-ons: {pbv2Outputs?.pricingAddons?.breakdown?.length ?? 0}
              {pbv2Outputs?.pricingAddons
                ? ` (${formatUsdFromCents(pbv2Outputs.pricingAddons.addOnCents)} add-on)`
                : ""}
              {" · "}Materials: {pbv2Outputs?.materialEffects?.materials?.length ?? 0}
              {" · "}Child items: {pbv2Outputs?.childItemProposals?.childItems?.length ?? 0}
            </div>

            <CollapsibleContent className="mt-2 space-y-3">
              {pbv2Outputs?.pricingAddons ? (
                <div className="rounded-md border border-border/60 bg-background/30">
                  <div className="px-3 py-2 text-xs font-medium">Pricing add-ons</div>
                  <div className="px-2 pb-2">
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 px-2">kind</TableHead>
                          <TableHead className="h-8 px-2 text-right">amount</TableHead>
                          <TableHead className="h-8 px-2 text-right">qty</TableHead>
                          <TableHead className="h-8 px-2 text-right">unit</TableHead>
                          <TableHead className="h-8 px-2">source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pbv2Outputs.pricingAddons.breakdown.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="px-2 py-2 text-xs text-muted-foreground">
                              No add-on breakdown lines.
                            </TableCell>
                          </TableRow>
                        ) : (
                          pbv2Outputs.pricingAddons.breakdown.map((b, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="px-2 py-2">{b.kind}</TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">
                                {formatUsdFromCents(b.amountCents)}
                              </TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">
                                {b.quantity === undefined ? "" : String(b.quantity)}
                              </TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">
                                {b.unitPriceCents === undefined ? "" : formatUsdFromCents(b.unitPriceCents)}
                              </TableCell>
                              <TableCell className="px-2 py-2 font-mono">{b.nodeId}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {pbv2Outputs?.materialEffects ? (
                <div className="rounded-md border border-border/60 bg-background/30">
                  <div className="px-3 py-2 text-xs font-medium">Materials</div>
                  <div className="px-2 pb-2">
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 px-2">skuRef</TableHead>
                          <TableHead className="h-8 px-2">uom</TableHead>
                          <TableHead className="h-8 px-2 text-right">qty</TableHead>
                          <TableHead className="h-8 px-2">source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pbv2Outputs.materialEffects.materials.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="px-2 py-2 text-xs text-muted-foreground">
                              No material effects.
                            </TableCell>
                          </TableRow>
                        ) : (
                          pbv2Outputs.materialEffects.materials.map((m, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="px-2 py-2 font-mono">{m.skuRef}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">{m.uom}</TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">{m.qty}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">{m.sourceNodeId}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {pbv2Outputs?.childItemProposals ? (
                <div className="rounded-md border border-border/60 bg-background/30">
                  <div className="px-3 py-2 text-xs font-medium flex items-center justify-between gap-3">
                    <div>Child items</div>
                    {canAcceptComponents ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            await onAcceptPbv2Components?.(item.id);
                          } catch (err) {
                            console.error("Failed to accept PBV2 components", err);
                          }
                        }}
                      >
                        Accept PBV2 components
                      </button>
                    ) : null}
                  </div>
                  <div className="px-2 pb-2">
                    <div className="px-1 py-2 text-[11px] text-muted-foreground">
                      {hasAcceptedComponents ? "Accepted components" : "Proposed components"}
                    </div>
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 px-2">title</TableHead>
                          <TableHead className="h-8 px-2">kind</TableHead>
                          <TableHead className="h-8 px-2">sku/product</TableHead>
                          <TableHead className="h-8 px-2 text-right">qty</TableHead>
                          <TableHead className="h-8 px-2 text-right">amount</TableHead>
                          <TableHead className="h-8 px-2">invoice</TableHead>
                          <TableHead className="h-8 px-2">source</TableHead>
                          {hasAcceptedComponents ? <TableHead className="h-8 px-2 text-right">action</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hasAcceptedComponents ? (
                          acceptedComponents.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="px-2 py-2">{c.title}</TableCell>
                              <TableCell className="px-2 py-2">{c.kind}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">
                                {String(c.kind) === "inlineSku" ? String(c.skuRef ?? "") : String(c.childProductId ?? "")}
                              </TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">{String(c.qty ?? "")}</TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">
                                {c.amountCents == null ? "" : formatUsdFromCents(c.amountCents)}
                              </TableCell>
                              <TableCell className="px-2 py-2">{String(c.invoiceVisibility ?? "")}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">
                                {String(c.pbv2SourceNodeId ?? "")}
                                {typeof c.pbv2EffectIndex === "number" ? `[${c.pbv2EffectIndex}]` : ""}
                              </TableCell>
                              <TableCell className="px-2 py-2 text-right">
                                {typeof onVoidPbv2Component === "function" ? (
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!window.confirm("Void this component?")) return;
                                      try {
                                        await onVoidPbv2Component(c.id);
                                      } catch (err) {
                                        console.error("Failed to void PBV2 component", err);
                                      }
                                    }}
                                  >
                                    Void
                                  </button>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : pbv2Outputs.childItemProposals.childItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="px-2 py-2 text-xs text-muted-foreground">
                              No child item proposals.
                            </TableCell>
                          </TableRow>
                        ) : (
                          pbv2Outputs.childItemProposals.childItems.map((ci, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="px-2 py-2">{ci.title}</TableCell>
                              <TableCell className="px-2 py-2">{ci.kind}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">
                                {ci.kind === "inlineSku" ? ci.skuRef ?? "" : ci.childProductId ?? ""}
                              </TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">{ci.qty}</TableCell>
                              <TableCell className="px-2 py-2 text-right font-mono">
                                {ci.amountCents === undefined ? "" : formatUsdFromCents(ci.amountCents)}
                              </TableCell>
                              <TableCell className="px-2 py-2">{ci.invoiceVisibility}</TableCell>
                              <TableCell className="px-2 py-2 font-mono">{ci.sourceNodeId}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
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
