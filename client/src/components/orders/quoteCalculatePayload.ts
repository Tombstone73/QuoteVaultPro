/**
 * Builds the request body for POST /api/quotes/calculate (live preview pricing).
 *
 * Always sourced from the current line item DRAFT state — never from the
 * persisted line item — so an in-progress quantity / dimension / option edit is
 * priced before Save Item.
 */

export type QuoteCalculatePayloadInput = {
  productId: string;
  variantId?: string | null;
  /** Draft width (inches). */
  widthNum: number;
  /** Draft height (inches). */
  heightNum: number;
  /** Draft quantity. */
  qtyNum: number;
  /** True when the product prices via a PBV2 option tree. */
  isPbv2Mode: boolean;
  /** Draft PBV2 selections (the `.selected` map of LineItemOptionSelectionsV2). */
  optionSelectionsV2Selected: Record<string, unknown>;
  /** Draft legacy (v1) option selections. */
  optionSelectionsV1: Record<string, unknown>;
  customerId?: string | null;
  debugSource?: string;
};

export function buildQuoteCalculatePayload(
  input: QuoteCalculatePayloadInput,
): Record<string, unknown> {
  const {
    productId,
    variantId,
    widthNum,
    heightNum,
    qtyNum,
    isPbv2Mode,
    optionSelectionsV2Selected,
    optionSelectionsV1,
    customerId,
    debugSource,
  } = input;

  return {
    productId,
    variantId: variantId || undefined,
    width: widthNum,
    height: heightNum,
    quantity: qtyNum,
    // PBV2 products send the selected option map; legacy products send v1 options.
    ...(isPbv2Mode
      ? { optionSelectionsJson: optionSelectionsV2Selected || {} }
      : { selectedOptions: optionSelectionsV1 || {} }),
    customerId,
    debugSource: debugSource ?? "OrderLineItemsSection.debounced",
  };
}
