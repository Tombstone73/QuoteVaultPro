/**
 * Canonical audit metadata for the quantity value used by PBV2 products.
 *
 * This describes where the application obtains quantity; it deliberately does
 * not participate in pricing evaluation. Pricing still reads the request's
 * line-item quantity and the selected PBV2 pricing profile/matrix.
 */
export type ProductIntakeQuantitySourceOption = {
  label: string;
  normalizedGroup: string;
  required: boolean;
  confidence: number;
  sampleValues: string[];
  sourcePaths: string[];
};

export type ProductIntakeQuantityPricingBehavior = "per_piece" | "quantity_tiers" | "flat_fee" | "per_hour" | "per_square_foot";

export type ProductIntakeQuantityMetadata = {
  configured: boolean;
  behavior: string;
  confidence: number;
  notes: string | null;
  lineItemQuantitySource: boolean;
  customerFacingOptionGenerated: boolean;
  quantityOnly: boolean;
  sourceOptions: ProductIntakeQuantitySourceOption[];
  mapping: {
    source: "line_item_quantity" | "fixed_quantity" | "not_applicable";
    variable: "q" | null;
    pricingBehavior: ProductIntakeQuantityPricingBehavior;
    pricingPreviewField: "quantity" | null;
    quoteLineItemField: "quantity" | null;
    orderLineItemField: "quantity" | null;
    matrixAxes: string[];
    fixedQuantity?: number;
  };
  warning: string | null;
};

export function buildProductIntakeQuantityMetadata(input: {
  behavior: string;
  confidence: number;
  notes?: string | null;
  quantityOnly: boolean;
  sourceOptions?: readonly ProductIntakeQuantitySourceOption[];
  pricingBehavior: ProductIntakeQuantityPricingBehavior;
  matrixAxes?: readonly string[];
  fixedQuantity?: number;
  customerFacingOptionGenerated?: boolean;
}): ProductIntakeQuantityMetadata {
  const normalizedBehavior = input.behavior.trim() || "unknown";
  const fixedQuantity = Number.isInteger(input.fixedQuantity) && input.fixedQuantity! > 0 ? input.fixedQuantity : undefined;
  const source = normalizedBehavior === "not_applicable"
    ? "not_applicable"
    : fixedQuantity !== undefined
      ? "fixed_quantity"
      : "line_item_quantity";
  const lineItemQuantitySource = source === "line_item_quantity";
  const mapsQuantityToPricing = input.pricingBehavior === "per_piece" || input.pricingBehavior === "quantity_tiers";
  const variable = source === "not_applicable" || !mapsQuantityToPricing ? null : "q";
  const usesLineItem = source === "line_item_quantity";

  return {
    // A fixed quantity is fully configured too; not-applicable deliberately
    // reports false because it has no quantity input or q mapping to validate.
    configured: source !== "not_applicable",
    behavior: normalizedBehavior,
    confidence: input.confidence,
    notes: input.notes?.trim() || (usesLineItem ? "Quantity is entered on the quote or order line item." : null),
    lineItemQuantitySource,
    customerFacingOptionGenerated: input.customerFacingOptionGenerated ?? false,
    quantityOnly: input.quantityOnly,
    sourceOptions: [...(input.sourceOptions ?? [])],
    mapping: {
      source,
      variable,
      pricingBehavior: input.pricingBehavior,
      pricingPreviewField: usesLineItem ? "quantity" : null,
      quoteLineItemField: usesLineItem ? "quantity" : null,
      orderLineItemField: usesLineItem ? "quantity" : null,
      matrixAxes: [...(input.matrixAxes ?? [])],
      ...(fixedQuantity === undefined ? {} : { fixedQuantity }),
    },
    warning: usesLineItem
      ? "Quantity is captured on quote/order line items and is not a PBV2 customer-facing option."
      : null,
  };
}
