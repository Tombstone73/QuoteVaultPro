export function parseBooleanLikeConfigValue(value: unknown): boolean | null {
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

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function pricingConfigHasRotationState(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const formulaVariables = isRecord(config.formulaVariables) ? config.formulaVariables : null;
  return Object.prototype.hasOwnProperty.call(config, "allowRotation")
    || Boolean(formulaVariables && Object.prototype.hasOwnProperty.call(formulaVariables, "allow_rotation"));
}

export function getAllowRotationFromPricingConfig(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const formulaVariables = isRecord(config.formulaVariables) ? config.formulaVariables : null;
  const fromFormulaVariables = parseBooleanLikeConfigValue(formulaVariables?.allow_rotation);
  if (fromFormulaVariables !== null) return fromFormulaVariables;
  const fromTopLevel = parseBooleanLikeConfigValue(config.allowRotation);
  if (fromTopLevel !== null) return fromTopLevel;
  return false;
}

export function buildPricingConfigWithAllowRotation(config: unknown, allowRotation: boolean): Record<string, any> {
  const currentRecord = isRecord(config) ? { ...config } : {};
  const currentFormulaVariables = isRecord(currentRecord.formulaVariables)
    ? currentRecord.formulaVariables
    : {};

  return {
    ...currentRecord,
    allowRotation,
    formulaVariables: {
      ...currentFormulaVariables,
      allow_rotation: allowRotation,
    },
  };
}

export function pricingFormulaUsesSheetConsumption(formula: unknown): boolean {
  return /\bsheet_consumption_sqft\s*\(/i.test(String(formula || ""));
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
