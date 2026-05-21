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
  /** True when the displayed price is an unsaved preview (any dirty edit). */
  isPreviewPrice: boolean;
};

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
