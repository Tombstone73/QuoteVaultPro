/**
 * Pure pricing-display derivation for order line items.
 *
 * Keeps the displayed total and per-each as a consistent pair so a stale
 * preview total can never be divided by a freshly-changed quantity.
 */

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
  /** True when displayed price is an unsaved preview that differs from persisted. */
  isPreviewPrice: boolean;
};

/** Tolerance ($) below which a preview total is considered unchanged. */
const PRICE_EPSILON = 0.005;

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

  if (previewTotal === null) {
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

  const previewPriceChanged = Math.abs(previewTotal - persistedTotal) > PRICE_EPSILON;

  return {
    displayTotal: previewTotal,
    displayPerEach,
    isPreviewPrice: isDirty && previewPriceChanged && !isCalculating && !hasCalcError,
  };
}
