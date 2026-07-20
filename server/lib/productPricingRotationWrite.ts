import {
  normalizeProductPricingRotationConfig,
  shouldPersistProductRotation,
} from "@shared/pbv2/productPricingRotation";

/** Normalizes Product Catalog writes to the single persisted allowRotation field. */
export function normalizeProductRotationForWrite(
  productData: Record<string, any>,
  existingProduct?: Record<string, any> | null,
): Record<string, any> {
  if (!Object.prototype.hasOwnProperty.call(productData, "pricingProfileConfig")) return productData;

  const pricingProfileKey = productData.pricingProfileKey ?? existingProduct?.pricingProfileKey ?? null;
  const pricingFormula = productData.pricingFormula ?? existingProduct?.pricingFormula ?? null;
  const pricingProfileConfig = productData.pricingProfileConfig;
  if (!shouldPersistProductRotation({ pricingProfileKey, pricingFormula, pricingProfileConfig })) return productData;

  return {
    ...productData,
    pricingProfileConfig: normalizeProductPricingRotationConfig(pricingProfileConfig, false),
  };
}
