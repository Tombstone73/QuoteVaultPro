/**
 * Pure formula scope utilities for PBV2 pricing preview evaluation.
 * No DB or network dependencies — safe to import in unit tests.
 */

/**
 * Variables that user-configured formulaVariables cannot override.
 * These are runtime geometry/quantity primitives owned by the system.
 * Note: base_price and its aliases (p, basePricePerSqft, etc.) are protected
 * from formulaVariables but CAN be overridden by pricingMatrixVariables.
 */
export const FORMULA_VARIABLE_PROTECTED_KEYS = new Set([
  "width",
  "w",
  "ordered_width",
  "height",
  "h",
  "ordered_height",
  "quantity",
  "q",
  "base_price",
  "original_base_price",
  "tier_base_price",
  "tier_rate",
  "effective_base_price",
  "basePricePerSqft",
  "pricePerSqft",
  "unitPrice",
  "price",
  "p",
  "sqft",
  "total_sqft",
  "finished_sqft",
  "total_finished_sqft",
  "computed_sheets",
  "billed_sheets",
  "sheet_count",
  "sheet_sqft",
  "billed_sheet_sqft",
  "pieces_per_sheet",
  "full_sheets",
  "partial_sheet_piece_count",
  "partial_sheet_finished_sqft",
  "partial_sheet_billable_sqft",
  "total_sheet_count",
  "allow_rotation",
  "linear_feet",
  "finished_width",
  "fw",
  "finished_height",
  "fh",
  "trim_allowance",
  "trim_allowance_x",
  "trim_allowance_y",
]);

/**
 * Variables that pricingMatrixVariables cannot override.
 * Excludes base_price and its aliases so the pricing matrix can intentionally
 * set base_price for formula evaluation.
 */
export const MATRIX_VARIABLE_PROTECTED_KEYS = new Set([
  "width",
  "w",
  "ordered_width",
  "height",
  "h",
  "ordered_height",
  "quantity",
  "q",
  "original_base_price",
  "tier_base_price",
  "tier_rate",
  "effective_base_price",
  "sqft",
  "total_sqft",
  "finished_sqft",
  "total_finished_sqft",
  "computed_sheets",
  "billed_sheets",
  "sheet_count",
  "sheet_sqft",
  "billed_sheet_sqft",
  "pieces_per_sheet",
  "full_sheets",
  "partial_sheet_piece_count",
  "partial_sheet_finished_sqft",
  "partial_sheet_billable_sqft",
  "total_sheet_count",
  "allow_rotation",
  "linear_feet",
  "finished_width",
  "fw",
  "finished_height",
  "fh",
  "trim_allowance",
  "trim_allowance_x",
  "trim_allowance_y",
]);

/** All aliases that must stay in sync with the canonical base_price. */
const BASE_PRICE_ALIASES = ["p", "basePricePerSqft", "pricePerSqft", "price", "unitPrice"] as const;

export function buildFormulaScope(input: {
  formula: string;
  orderedWidthIn: number;
  orderedHeightIn: number;
  trimAllowanceX: number;
  trimAllowanceY: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
  baseRatePerSqft: number;
  originalBaseRate?: number;
  tierBaseRate?: number | null;
  effectiveBaseRate?: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  computedSheets?: number | null;
  billedSheets?: number | null;
  sheetCount?: number | null;
  sheetSqft?: number | null;
  billedSheetSqft?: number | null;
  piecesPerSheet?: number | null;
  fullSheets?: number | null;
  partialSheetPieceCount?: number | null;
  partialSheetFinishedSqft?: number | null;
  partialSheetBillableSqft?: number | null;
  totalSheetCount?: number | null;
  allowRotation?: boolean | null;
}): Record<string, number | string | boolean | null> {
  const scope: Record<string, number | string | boolean | null> = {
    width: input.orderedWidthIn,
    w: input.orderedWidthIn,
    ordered_width: input.orderedWidthIn,
    height: input.orderedHeightIn,
    h: input.orderedHeightIn,
    ordered_height: input.orderedHeightIn,
    trim_allowance: input.trimAllowanceX,
    trim_allowance_x: input.trimAllowanceX,
    trim_allowance_y: input.trimAllowanceY,
    finished_width: input.finishedWidthIn,
    fw: input.finishedWidthIn,
    finished_height: input.finishedHeightIn,
    fh: input.finishedHeightIn,
    quantity: input.quantity,
    q: input.quantity,
    base_price: input.baseRatePerSqft,
    original_base_price: input.originalBaseRate ?? input.baseRatePerSqft,
    tier_base_price: input.tierBaseRate ?? input.effectiveBaseRate ?? input.baseRatePerSqft,
    tier_rate: input.tierBaseRate ?? input.effectiveBaseRate ?? input.baseRatePerSqft,
    effective_base_price: input.effectiveBaseRate ?? input.baseRatePerSqft,
    basePricePerSqft: input.baseRatePerSqft,
    pricePerSqft: input.baseRatePerSqft,
    unitPrice: input.baseRatePerSqft,
    price: input.baseRatePerSqft,
    p: input.baseRatePerSqft,
    sqft: input.sqftPerItem,
    total_sqft: input.totalSqft,
    finished_sqft: input.sqftPerItem,
    total_finished_sqft: input.totalSqft,
    allow_rotation: input.allowRotation ?? false,
    linear_feet: input.linearFeet,
  };

  const sheetYieldEntries: Array<[string, number | null | undefined]> = [
    ["computed_sheets", input.computedSheets],
    ["billed_sheets", input.billedSheets],
    ["sheet_count", input.sheetCount],
    ["sheet_sqft", input.sheetSqft],
    ["billed_sheet_sqft", input.billedSheetSqft],
    ["pieces_per_sheet", input.piecesPerSheet],
    ["full_sheets", input.fullSheets],
    ["partial_sheet_piece_count", input.partialSheetPieceCount],
    ["partial_sheet_finished_sqft", input.partialSheetFinishedSqft],
    ["partial_sheet_billable_sqft", input.partialSheetBillableSqft],
    ["total_sheet_count", input.totalSheetCount],
  ];

  for (const [key, value] of sheetYieldEntries) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      scope[key] = numeric;
    }
  }

  return scope;
}

/**
 * Build the final formula evaluation scope by layering:
 *   1. Base scope (geometry/rate primitives from buildFormulaScope)
 *   2. User-configured formula variables (protected keys are skipped)
 *   3. Pricing matrix variables (can override base_price and aliases)
 *
 * After all overrides are applied, base_price aliases (p, basePricePerSqft,
 * pricePerSqft, price, unitPrice) are re-synced to the final base_price.
 * This prevents stale alias values when a pricing matrix overrides base_price
 * but does not explicitly set the alias keys.
 */
export function buildFormulaEvaluationScope(input: {
  scope: Record<string, number | string | boolean | null>;
  formulaVariables?: Record<string, number>;
  pricingMatrixVariables?: Record<string, number>;
}): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = { ...input.scope };

  for (const [key, value] of Object.entries(input.formulaVariables ?? {})) {
    if (FORMULA_VARIABLE_PROTECTED_KEYS.has(key)) continue;
    if (Number.isFinite(Number(value))) out[key] = Number(value);
  }

  for (const [key, value] of Object.entries(input.pricingMatrixVariables ?? {})) {
    if (MATRIX_VARIABLE_PROTECTED_KEYS.has(key)) continue;
    if (Number.isFinite(Number(value))) out[key] = Number(value);
  }

  // Re-sync all base_price aliases after all overrides are applied.
  // This ensures p, basePricePerSqft, etc. always reflect the matrix-resolved
  // base_price rather than holding the stale tiered-pricing fallback value.
  const finalBasePrice = typeof out.base_price === "number" ? out.base_price : null;
  if (finalBasePrice !== null) {
    for (const alias of BASE_PRICE_ALIASES) {
      out[alias] = finalBasePrice;
    }
  }

  return out;
}
