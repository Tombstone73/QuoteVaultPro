import {
  getProductAllowRotation,
  normalizeProductPricingRotationConfig,
  pricingFormulaUsesSheetConsumption,
  productPricingConfigHasRotation,
} from "@shared/pbv2/productPricingRotation";

export {
  mergeFormulaLibraryConfigWithProductConfig,
  normalizeProductPricingRotationConfig,
  parseProductPricingBoolean as parseBooleanLikeConfigValue,
} from "@shared/pbv2/productPricingRotation";

export function pricingConfigHasRotationState(config: unknown): boolean {
  return productPricingConfigHasRotation(config);
}

export function getAllowRotationFromPricingConfig(config: unknown): boolean {
  return getProductAllowRotation(config) ?? false;
}

export function buildPricingConfigWithAllowRotation(config: unknown, allowRotation: boolean): Record<string, any> {
  return normalizeProductPricingRotationConfig({
    ...(config && typeof config === "object" && !Array.isArray(config) ? config : {}),
    allowRotation,
  }, allowRotation);
}

export function shouldShowPricingEngineRotationControl(input: {
  pricingProfileKey?: string | null;
  pricingFormula?: unknown;
  pricingProfileConfig?: unknown;
}): boolean {
  return input.pricingProfileKey === "flat_goods"
    || pricingFormulaUsesSheetConsumption(input.pricingFormula)
    || pricingConfigHasRotationState(input.pricingProfileConfig);
}
