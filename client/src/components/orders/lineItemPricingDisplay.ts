/**
 * Pure pricing-display derivation for order line items.
 *
 * Keeps the displayed total and per-each as a consistent pair so a stale
 * preview total can never be divided by a freshly-changed quantity.
 */

import { resolveLineItemDisplayPriceCents } from "@/components/orders/orderLineItemEditState";

export type LineItemPricingDisplayInput = {
  /** True when this row is the line item currently expanded for editing. */
  isActiveItem: boolean;
  /** True when the line item carries a manual price override. */
  isOverride: boolean;
  /** Persisted (server-authoritative) line total in dollars. */
  persistedTotal: number;
  /** Persisted per-each price in dollars. */
  persistedPerEach: number;
  /** Debounced preview line total in dollars, or null when no preview exists. */
  computedTotal: number | null;
  /** Quantity that `computedTotal` was computed for (never the live draft qty). */
  computedTotalQty: number | null;
  /** True when the expanded line item has unsaved edits. */
  isDirty: boolean;
  /** True while a preview calculation is in flight. */
  isCalculating: boolean;
  /** True when the most recent preview calculation failed. */
  hasCalcError: boolean;
};

export type LineItemPricingDisplay = {
  /** Total to display ($). Preview value when available, else persisted. */
  displayTotal: number;
  /** Per-each to display ($), always consistent with displayTotal. */
  displayPerEach: number;
  /** True when the displayed price is an unsaved preview (any dirty edit). */
  isPreviewPrice: boolean;
};

export type VisibleLineItemPriceDisplayInput = {
  lineItem: Record<string, any>;
  previousLineItem?: Record<string, any> | null;
  aggregateTotalCents?: number | null;
  attachmentState?: string | null;
  source: string;
};

export type VisibleLineItemPriceDisplay = {
  displayTotal: number;
  displayPerEach: number;
  displayTotalCents: number;
  displayPerEachCents: number;
};

const zeroPriceDiagnosticKeys = new Set<string>();

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function toCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n === null ? null : Math.round(n);
}

function toDollarsAsCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n === null ? null : Math.round(n * 100);
}

function getRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function collectPriceEvidenceCents(lineItem: Record<string, any>, aggregateTotalCents?: number | null): Record<string, number> {
  const priceBreakdown = getRecord(lineItem.priceBreakdown);
  const snapshotPricing = getRecord(getRecord(lineItem.pbv2SnapshotJson).pricing);
  const evidence: Record<string, number> = {};
  const entries: Array<[string, number | null]> = [
    ["aggregateTotalCents", aggregateTotalCents ?? null],
    ["effectiveTotalCents", toCents(lineItem.effectiveTotalCents)],
    ["overridePriceCents", toCents(lineItem.overridePriceCents)],
    ["baseCalculatedTotalCents", toCents(lineItem.baseCalculatedTotalCents)],
    ["lineTotalCents", toCents(lineItem.lineTotalCents)],
    ["totalCents", toCents(lineItem.totalCents)],
    ["priceBreakdown.lineTotalCents", toCents(priceBreakdown.lineTotalCents)],
    ["priceBreakdown.totalCents", toCents(priceBreakdown.totalCents)],
    ["priceBreakdown.total", toDollarsAsCents(priceBreakdown.total)],
    ["pbv2SnapshotJson.pricing.effectiveTotalCents", toCents(snapshotPricing.effectiveTotalCents)],
    ["pbv2SnapshotJson.pricing.totalCents", toCents(snapshotPricing.totalCents)],
    ["totalPrice", toDollarsAsCents(lineItem.totalPrice)],
    ["linePrice", toDollarsAsCents(lineItem.linePrice)],
  ];
  for (const [key, value] of entries) {
    if (value !== null && Number.isFinite(value) && value > 0) {
      evidence[key] = value;
    }
  }
  return evidence;
}

function logZeroVisiblePriceDiagnostic(input: VisibleLineItemPriceDisplayInput, resolvedVisibleCents: number) {
  if (process.env.NODE_ENV === "production") return;
  if (resolvedVisibleCents !== 0) return;

  const evidence = {
    ...collectPriceEvidenceCents(input.previousLineItem ?? {}, null),
    ...collectPriceEvidenceCents(input.lineItem, input.aggregateTotalCents),
  };
  if (Object.keys(evidence).length === 0) return;

  const id = String(input.lineItem.id ?? input.lineItem.tempId ?? "unknown");
  const diagnosticKey = `${input.source}:${id}:${Object.keys(evidence).sort().join("|")}`;
  if (zeroPriceDiagnosticKeys.has(diagnosticKey)) return;
  zeroPriceDiagnosticKeys.add(diagnosticKey);

  console.warn("[LineItemPriceDisplay] visible price resolved to zero despite pricing evidence", {
    source: input.source,
    lineItemId: input.lineItem.id ?? null,
    tempId: input.lineItem.tempId ?? null,
    productId: input.lineItem.productId ?? null,
    productName: input.lineItem.productName ?? input.lineItem.description ?? null,
    rowFields: Object.keys(input.lineItem).sort(),
    resolvedVisiblePriceCents: resolvedVisibleCents,
    effectiveTotalEvidenceCents: evidence,
    attachmentState: input.attachmentState ?? null,
  });
}

export function deriveVisibleLineItemPriceDisplay(
  input: VisibleLineItemPriceDisplayInput,
): VisibleLineItemPriceDisplay {
  const previousCents = input.previousLineItem
    ? resolveLineItemDisplayPriceCents(input.previousLineItem)
    : input.aggregateTotalCents ?? null;
  const displayTotalCents = resolveLineItemDisplayPriceCents(input.lineItem, previousCents);
  const quantity = toFiniteNumber(input.lineItem.quantity);
  const safeQuantity = quantity !== null && quantity > 0 ? quantity : 1;
  const displayPerEachCents = Math.round(displayTotalCents / safeQuantity);

  logZeroVisiblePriceDiagnostic(input, displayTotalCents);

  return {
    displayTotal: displayTotalCents / 100,
    displayPerEach: displayPerEachCents / 100,
    displayTotalCents,
    displayPerEachCents,
  };
}

export function deriveLineItemPricingDisplay(
  input: LineItemPricingDisplayInput,
): LineItemPricingDisplay {
  const {
    isActiveItem,
    isOverride,
    persistedTotal,
    persistedPerEach,
    computedTotal,
    computedTotalQty,
    isDirty,
    isCalculating,
    hasCalcError,
  } = input;

  // A preview total only applies to the expanded, non-override line item.
  const previewTotal =
    isActiveItem && !isOverride && computedTotal !== null && Number.isFinite(computedTotal)
      ? computedTotal
      : null;

  // No preview available, or the preview calculation failed: fall back to the
  // persisted (saved) price. On calc error we deliberately show the saved value
  // rather than a stale preview — the failure is surfaced separately as a warning.
  if (previewTotal === null || hasCalcError) {
    return {
      displayTotal: persistedTotal,
      displayPerEach: persistedPerEach,
      isPreviewPrice: false,
    };
  }

  // Per-each is derived from the quantity the preview total was computed for,
  // NOT the live draft quantity. This keeps total and per-each a consistent
  // pair even while a debounced recalculation is still in flight.
  const displayPerEach =
    computedTotalQty !== null && Number.isFinite(computedTotalQty) && computedTotalQty > 0
      ? previewTotal / computedTotalQty
      : persistedPerEach;

  // The preview label reflects UNSAVED state, not whether the number changed.
  // Any dirty line item showing a current (non-erroring) preview is showing an
  // unsaved value — even if that value happens to equal the persisted price.
  // While a recalculation is in flight we suppress the label (the caller shows
  // "Calculating…") so the row never looks saved mid-calculation.
  const isPreviewPrice = isDirty && !isCalculating;

  return {
    displayTotal: previewTotal,
    displayPerEach,
    isPreviewPrice,
  };
}
