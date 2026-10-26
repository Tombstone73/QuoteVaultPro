/** PricingService adds three capture clocks on every calculation. Strip only
 * those known locations so changes to the tree, selections, or prices still
 * invalidate the reviewed Quote. */
export function quotePricingSnapshotForFingerprint(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const { pricedAt: _pricedAt, pbv2PricingSnapshot, ...snapshot } = value as Record<string, unknown>;
  if (pbv2PricingSnapshot === null || typeof pbv2PricingSnapshot !== "object" || Array.isArray(pbv2PricingSnapshot))
    return { ...snapshot, pbv2PricingSnapshot };
  const { capturedAt: _capturedAt, tierResolution, ...runtime } = pbv2PricingSnapshot as Record<string, unknown>;
  if (tierResolution === null || typeof tierResolution !== "object" || Array.isArray(tierResolution))
    return { ...snapshot, pbv2PricingSnapshot: { ...runtime, tierResolution } };
  const { capturedAt: _tierCapturedAt, ...tier } = tierResolution as Record<string, unknown>;
  return { ...snapshot, pbv2PricingSnapshot: { ...runtime, tierResolution: tier } };
}

/** Bind review to Product inputs that can affect the line or its tax treatment.
 * A non-pricing metadata save may advance updatedAt without changing these inputs. */
export function quoteProductPricingInputsForFingerprint(product: object) {
  const row = product as Record<string, unknown>;
  const fields = ["id", "name", "productTypeId", "pricingMode", "measurementMode", "allowZeroPrice", "priceBreaks",
    "primaryMaterialId", "optionsJson", "optionTreeJson", "pbv2ActiveTreeVersionId", "pricingProfileKey",
    "pricingProfileConfig", "pricingEngine", "pricingFormula", "pricingFormulaId", "useNestingCalculator",
    "sheetWidth", "sheetHeight", "materialType", "minPricePerItem", "nestingVolumePricing", "isTaxable", "isActive"] as const;
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}
