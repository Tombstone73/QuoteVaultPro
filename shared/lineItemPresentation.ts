export type LineItemPresentationProduct = {
  measurementMode?: "dimensions_required" | "quantity_only" | null;
} | null | undefined;

/**
 * PBV2 may use neutral geometry internally for quantity pricing. That internal
 * value is never a customer-facing finished size.
 */
export function shouldDisplayLineItemDimensions(product: LineItemPresentationProduct): boolean {
  return product?.measurementMode !== "quantity_only";
}

export function formatLineItemMeasurementLabel(
  product: LineItemPresentationProduct,
  width: unknown,
  height: unknown,
): string {
  if (!shouldDisplayLineItemDimensions(product)) return "Quantity only";
  return `${width ?? 0}\" × ${height ?? 0}\"`;
}
