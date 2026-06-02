export type FormulaOutputMeaning = "billable" | "final_price" | "generic";

export type FormulaOutputMeaningHydration = {
  outputMeaning: FormulaOutputMeaning;
  hasSavedOutputMeaning: boolean;
  rawValue: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeFormulaOutputMeaning(value: unknown): FormulaOutputMeaning {
  const raw = String(value || "").trim().toLowerCase();
  if (
    raw === "billable" ||
    raw === "billable_quantity" ||
    raw === "billable_sqft" ||
    raw === "billable_qty_sqft" ||
    raw === "billable qty / sqft"
  ) {
    return "billable";
  }
  if (
    raw === "final_price" ||
    raw === "final_dollars" ||
    raw === "final dollars" ||
    raw === "final price ($)" ||
    raw === "dollars"
  ) {
    return "final_price";
  }
  if (raw === "generic") return "generic";
  return "final_price";
}

export function getSavedFormulaOutputMeaningRaw(config: unknown): unknown {
  if (!isRecord(config)) return undefined;
  return config.formulaOutputMeaning ?? config.outputMeaning;
}

export function hydrateFormulaOutputMeaning(config: unknown): FormulaOutputMeaningHydration {
  const rawValue = getSavedFormulaOutputMeaningRaw(config);
  const hasSavedOutputMeaning = rawValue != null && String(rawValue).trim().length > 0;
  return {
    outputMeaning: hasSavedOutputMeaning ? normalizeFormulaOutputMeaning(rawValue) : "final_price",
    hasSavedOutputMeaning,
    rawValue,
  };
}

export function setFormulaOutputMeaningInConfig(config: unknown, outputMeaning: FormulaOutputMeaning): Record<string, unknown> {
  const current = isRecord(config) ? config : {};
  return {
    ...current,
    formulaOutputMeaning: outputMeaning,
    outputMeaning,
  };
}

export function buildFormulaSaveConfig(config: unknown): Record<string, unknown> {
  const { outputMeaning } = hydrateFormulaOutputMeaning(config);
  return setFormulaOutputMeaningInConfig(config, outputMeaning);
}
