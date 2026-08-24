/**
 * Formula-language runtime symbols shared by authoring validation and the
 * Product pricing boundary. Expressions are dollar-valued; `base_price` is
 * the documented spelling for the resolved dollar rate. `basePrice` and `p`
 * remain supported aliases for existing Formula compatibility.
 */
export const canonicalFormulaBasePriceVariable = "base_price" as const;
export const formulaRuntimeVariables = [
  "q",
  "w",
  "h",
  "sqft",
  "total_sqft",
  "computed_sheets",
  "billed_sqft",
  canonicalFormulaBasePriceVariable,
  "basePrice",
  "p",
  "sheet_price",
  "unitPrice",
  "allow_rotation",
] as const;

export type FormulaRuntimeVariable = (typeof formulaRuntimeVariables)[number];

/** Synthetic, non-commercial values used only to validate an expression. */
export const formulaRuntimeProbeValues = (): Record<FormulaRuntimeVariable, number> =>
  Object.fromEntries(formulaRuntimeVariables.map((key) => [key, 1])) as Record<FormulaRuntimeVariable, number>;
