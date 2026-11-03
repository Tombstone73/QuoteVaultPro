import { getPbv2FixedDimensions } from "@shared/pbv2/fixedDimensions";
import type { OptionTreeV2 } from "@shared/optionTreeV2";

export const PRODUCT_MEASUREMENT_MODES = ["dimensions_required", "quantity_only"] as const;
export type ProductMeasurementMode = (typeof PRODUCT_MEASUREMENT_MODES)[number];

type MeasurementProduct = {
  measurementMode?: ProductMeasurementMode | null;
  requiresDimensions?: boolean | null;
  pricingMode?: string | null;
  pricingProfileKey?: string | null;
};

/** `quantity_only` is product-level authority and wins over stale PBV2 metadata. */
export function productRequiresEnteredDimensions(
  product: MeasurementProduct | null | undefined,
  treeJson?: OptionTreeV2 | null,
): boolean {
  if (!product) return true;
  if (product.measurementMode === "quantity_only") return false;
  if (getPbv2FixedDimensions(treeJson)) return false;
  if (treeJson?.meta?.requiresDimensions !== undefined) return treeJson.meta.requiresDimensions;
  if (typeof product.requiresDimensions === "boolean") return product.requiresDimensions;
  if (product.pricingProfileKey === "fee" || product.pricingProfileKey === "hourly" || product.pricingMode === "fee" || product.pricingMode === "addon" || product.pricingMode === "flat") return false;
  return true;
}

/** PBV2 requires positive dimensions; quantity-only products use a neutral 1 × 1 runtime value. */
export function dimensionsForProductPricing(
  product: Pick<MeasurementProduct, "measurementMode" | "pricingProfileKey"> | null | undefined,
  width: unknown,
  height: unknown,
): { widthIn: number; heightIn: number } {
  if (product?.measurementMode === "quantity_only" || product?.pricingProfileKey === "fee" || product?.pricingProfileKey === "hourly") return { widthIn: 1, heightIn: 1 };
  return { widthIn: Number(width), heightIn: Number(height) };
}

/** Resolve entered, physical, and pricing dimensions from the selected product's tree. */
export function resolveProductMeasurement(
  product: MeasurementProduct | null | undefined,
  treeJson: OptionTreeV2 | null | undefined,
  width: unknown,
  height: unknown,
): {
  requiresEnteredDimensions: boolean;
  physicalDimensions: { widthIn: number; heightIn: number };
  pricingDimensions: { widthIn: number; heightIn: number };
} {
  const fixed = getPbv2FixedDimensions(treeJson);
  if (fixed) {
    const dimensions = { widthIn: fixed.widthIn, heightIn: fixed.heightIn };
    return { requiresEnteredDimensions: false, physicalDimensions: dimensions, pricingDimensions: dimensions };
  }

  const requiresEnteredDimensions = productRequiresEnteredDimensions(product, treeJson);
  if (requiresEnteredDimensions) {
    const dimensions = { widthIn: Number(width), heightIn: Number(height) };
    return { requiresEnteredDimensions, physicalDimensions: dimensions, pricingDimensions: dimensions };
  }

  // No user-entered or fixed physical size exists. The pricing engine's
  // existing neutral runtime geometry is never stored on the line item.
  return {
    requiresEnteredDimensions: false,
    physicalDimensions: { widthIn: 0, heightIn: 0 },
    pricingDimensions: dimensionsForProductPricing({ measurementMode: "quantity_only" }, width, height),
  };
}
