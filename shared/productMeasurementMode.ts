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
