/**
 * Product-editor helpers for canonical roll pricing configuration.
 *
 * These functions deliberately do not calculate a layout. The pricing service
 * remains the sole authority for canonical roll layout and formula evaluation.
 */
export const ROLL_LAYOUT_FORMULA_VARIABLE_KEYS = [
  "printable_width",
  "piece_allowance_x",
  "piece_allowance_y",
  "billing_width_increment",
  "billing_length_increment",
  "registration_waste",
  "allow_rotation",
] as const;

export type RollLayoutFormulaVariableKey = typeof ROLL_LAYOUT_FORMULA_VARIABLE_KEYS[number];

// Rotation is shared with sheet-yield pricing, so it is not sufficient by
// itself to identify a roll configuration that should surface this panel.
const ROLL_LAYOUT_DETECTION_KEYS = ROLL_LAYOUT_FORMULA_VARIABLE_KEYS.filter((key) => key !== "allow_rotation");

export type RollPricingValidationError = Partial<Record<
  "printable_width" | "billing_width_increment" | "billing_length_increment" | "linear_foot_rate" | "piece_allowance_x" | "piece_allowance_y" | "registration_waste",
  string
>>;

const numericValue = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/**
 * The Product Editor receives canonical variables from both persisted product
 * configuration and the PBV2 tree while a draft is open. Keep one merge rule
 * for display, validation, edits, and the subsequent product save.
 */
export function mergeRollPricingFormulaVariables(input: {
  treeFormulaVariables?: unknown;
  treePricingFormulaVariables?: unknown;
  pricingProfileConfig?: unknown;
}): Record<string, unknown> {
  const config = recordValue(input.pricingProfileConfig);
  const merged = {
    ...recordValue(input.treeFormulaVariables),
    ...recordValue(input.treePricingFormulaVariables),
    ...recordValue(config.formulaVariables),
  };

  // Existing product writes intentionally keep rotation in its top-level
  // canonical field. Mirror it only in the editor's synchronized tree map.
  if (typeof config.allowRotation === "boolean") {
    merged.allow_rotation = config.allowRotation;
  }

  return merged;
}

export function applyRollPricingFormulaVariable(
  formulaVariables: Record<string, unknown>,
  key: string,
  value: number | boolean | null,
): Record<string, unknown> {
  const next = { ...formulaVariables };
  if (value === null) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function formulaReferencesRollLinearFeet(formula: unknown): boolean {
  return /\b(?:billed_linear_feet|consumed_linear_feet)\b/i.test(String(formula ?? ""));
}

export function formulaReferencesLinearFootRate(formula: unknown): boolean {
  return /\blinear_foot_rate\b/i.test(String(formula ?? ""));
}

export function hasRollLayoutFormulaVariables(variables: unknown): boolean {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return false;
  return ROLL_LAYOUT_DETECTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(variables, key));
}

export function shouldShowRollPricingConfiguration(input: {
  formula: unknown;
  formulaVariables: unknown;
}): boolean {
  return formulaReferencesRollLinearFeet(input.formula) || hasRollLayoutFormulaVariables(input.formulaVariables);
}

/**
 * Validate only product-entered roll configuration. This intentionally leaves
 * derived layout outputs (pieces across, rows, consumed/billed length) to the
 * canonical pricing service.
 */
export function validateRollPricingConfiguration(input: {
  formula: unknown;
  formulaVariables: Record<string, unknown>;
}): RollPricingValidationError {
  const errors: RollPricingValidationError = {};
  const requiresRollLayout = formulaReferencesRollLinearFeet(input.formula);
  const requiresLinearFootRate = formulaReferencesLinearFootRate(input.formula);

  for (const key of ["printable_width", "billing_width_increment", "billing_length_increment"] as const) {
    const value = numericValue(input.formulaVariables[key]);
    if (requiresRollLayout && (value === null || value <= 0)) {
      errors[key] = "Required and must be greater than 0.";
    }
  }

  if (requiresLinearFootRate) {
    const rate = numericValue(input.formulaVariables.linear_foot_rate);
    if (rate === null || rate < 0) {
      errors.linear_foot_rate = "Required and must be 0 or greater.";
    }
  }

  for (const key of ["piece_allowance_x", "piece_allowance_y", "registration_waste"] as const) {
    const value = numericValue(input.formulaVariables[key]);
    if (value !== null && value < 0) {
      errors[key] = "Must be 0 or greater.";
    }
  }

  return errors;
}
