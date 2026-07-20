function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProductPricingBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on", "allow", "allowed"].includes(normalized)) return true;
    if (["false", "no", "n", "0", "off", "deny", "denied", "disallow", "disallowed"].includes(normalized)) return false;
  }
  return null;
}

/**
 * Product pricing persists rotation at pricingProfileConfig.allowRotation.
 * Nested snake-case values are accepted only to normalize already-stored/formula-library config.
 */
export function getProductAllowRotation(config: unknown): boolean | null {
  if (!isRecord(config)) return null;

  const canonical = parseProductPricingBoolean(config.allowRotation);
  if (canonical !== null) return canonical;

  const formulaVariables = isRecord(config.formulaVariables) ? config.formulaVariables : null;
  const nested = parseProductPricingBoolean(formulaVariables?.allow_rotation);
  if (nested !== null) return nested;

  const legacyVariables = isRecord(config.variables) ? config.variables : null;
  return parseProductPricingBoolean(legacyVariables?.allow_rotation);
}

export function productPricingConfigHasRotation(config: unknown): boolean {
  return getProductAllowRotation(config) !== null;
}

/** Moves any recognized rotation value to the canonical product field without dropping other config. */
export function normalizeProductPricingRotationConfig(
  config: unknown,
  fallbackAllowRotation = false,
): Record<string, any> {
  const current = isRecord(config) ? { ...config } : {};
  const formulaVariables = isRecord(current.formulaVariables) ? { ...current.formulaVariables } : {};
  const legacyVariables = isRecord(current.variables) ? { ...current.variables } : null;
  const resolved = getProductAllowRotation(current) ?? fallbackAllowRotation;

  delete formulaVariables.allow_rotation;
  if (legacyVariables) {
    delete legacyVariables.allow_rotation;
  }
  delete current.variables;

  return {
    ...current,
    allowRotation: resolved,
    formulaVariables: {
      ...(legacyVariables ?? {}),
      ...formulaVariables,
    },
  };
}

/**
 * Formula-library defaults are a base. Persisted product values win, especially allowRotation.
 * This prevents a library refetch from resetting a saved product override.
 */
export function mergeFormulaLibraryConfigWithProductConfig(
  formulaConfig: unknown,
  productConfig: unknown,
): Record<string, any> {
  const library = isRecord(formulaConfig) ? formulaConfig : {};
  const product = isRecord(productConfig) ? productConfig : {};
  const libraryFormulaVariables = isRecord(library.formulaVariables) ? library.formulaVariables : {};
  const productFormulaVariables = isRecord(product.formulaVariables) ? product.formulaVariables : {};
  const libraryVariables = isRecord(library.variables) ? library.variables : {};
  const productVariables = isRecord(product.variables) ? product.variables : {};
  const productRotation = getProductAllowRotation(product);
  const libraryRotation = getProductAllowRotation(library);

  return normalizeProductPricingRotationConfig({
    ...library,
    ...product,
    variables: {
      ...libraryVariables,
      ...productVariables,
    },
    formulaVariables: {
      ...libraryFormulaVariables,
      ...productFormulaVariables,
    },
    allowRotation: productRotation ?? libraryRotation ?? false,
  });
}

export function pricingFormulaUsesSheetConsumption(formula: unknown): boolean {
  return /\bsheet_consumption_sqft\s*\(/i.test(String(formula || ""));
}

export function shouldPersistProductRotation(input: {
  pricingProfileKey?: string | null;
  pricingFormula?: unknown;
  pricingProfileConfig?: unknown;
}): boolean {
  return input.pricingProfileKey === "flat_goods"
    || pricingFormulaUsesSheetConsumption(input.pricingFormula)
    || productPricingConfigHasRotation(input.pricingProfileConfig);
}
