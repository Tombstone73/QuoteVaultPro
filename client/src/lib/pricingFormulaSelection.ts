export type PricingFormulaLibraryEntry = {
  id?: string | null;
  expression?: string | null;
  pricingProfileKey?: string | null;
  config?: unknown;
};

export type PricingFormulaSelectionValues = {
  pricingFormulaId: string | null;
  pricingFormula?: string;
  pricingProfileKey?: string;
  pricingProfileConfig?: unknown;
};

export function getPricingFormulaSelectionValues(
  pricingFormulas: PricingFormulaLibraryEntry[] | null | undefined,
  selectedFormulaId: string | null | undefined,
): PricingFormulaSelectionValues {
  const formulaId = typeof selectedFormulaId === "string" && selectedFormulaId !== "__none__"
    ? selectedFormulaId.trim()
    : "";

  if (!formulaId) {
    return { pricingFormulaId: null };
  }

  const formula = Array.isArray(pricingFormulas)
    ? pricingFormulas.find((entry) => entry?.id === formulaId)
    : null;

  if (!formula) {
    return { pricingFormulaId: formulaId };
  }

  const values: PricingFormulaSelectionValues = {
    pricingFormulaId: formulaId,
    pricingProfileKey: formula.pricingProfileKey || "default",
  };

  if (typeof formula.expression === "string" && formula.expression.trim()) {
    values.pricingFormula = formula.expression;
  }

  if (formula.config != null) {
    values.pricingProfileConfig = formula.config;
  }

  return values;
}
