import type { PricingResult } from "./contracts.js";

/**
 * Deliberately small, server-owned explanation for an operator-facing preview.
 * It is derived only from the canonical PricingResult, so a UI cannot turn a
 * read model into a second calculator.
 */
export type OperatorPricingExplanation = Readonly<{
  dimensions?: Readonly<{ widthIn: string; heightIn: string; areaPerPieceSqft: string; totalAreaSqft: string }>;
  computedSheetUsage?: Readonly<{ sheetCount: number; billedSquareFeet?: number; allowRotation?: boolean }>;
  tier?: Readonly<{ basis: "quantity" | "square_foot" | "computed_sheet"; value: string; selectedTierId: string; rateCents: number }>;
  matrix?: Readonly<{ rowId: string; selectedValues: readonly string[] }>;
  formula?: Readonly<{ source: "library" | "embedded"; expression: string; baseRateCents?: number }>;
  optionImpacts: readonly Readonly<{ selectionKey: string; kind: string; cents: number }>[];
  minimumChargeApplied: boolean;
}>;

const finiteNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const decimal = (value: number): string => String(Number(value.toFixed(6)));

export const explainPricingResult = (value: PricingResult): OperatorPricingExplanation => {
  const width = value.calculationDimensions ? Number(value.calculationDimensions.widthIn) : undefined;
  const height = value.calculationDimensions ? Number(value.calculationDimensions.heightIn) : undefined;
  const quantity = value.normalizedInput.quantity;
  const facts = value.nestingEstimate?.facts;
  const sheetCount = finiteNumber(facts?.totalSheetCount ?? facts?.computedSheets);
  const billedSquareFeet = finiteNumber(facts?.billedSheetSqft ?? facts?.billableSqft);
  const allowRotation = typeof facts?.allowRotation === "boolean" ? facts.allowRotation : undefined;
  const basePrice = value.formula?.variables.base_price;
  const baseRateCents = typeof basePrice === "number" && Number.isFinite(basePrice) ? Math.round(basePrice * 100) : undefined;
  return {
    ...(width != null && height != null ? { dimensions: { widthIn: decimal(width), heightIn: decimal(height), areaPerPieceSqft: decimal(width * height / 144), totalAreaSqft: decimal(width * height * quantity / 144) } } : {}),
    ...(sheetCount != null ? { computedSheetUsage: { sheetCount, ...(billedSquareFeet == null ? {} : { billedSquareFeet }), ...(allowRotation === undefined ? {} : { allowRotation }) } } : {}),
    ...(value.tier ? { tier: { basis: value.tier.source, value: value.tier.basisValue, selectedTierId: value.tier.selectedTierId, rateCents: Math.round(Number(value.tier.selectedRate)) } } : {}),
    ...(value.matrix ? { matrix: { rowId: value.matrix.rowId, selectedValues: value.matrix.selectedValueKeys } } : {}),
    ...(value.formula ? { formula: { source: value.formula.source, expression: value.formula.resolvedExpression, ...(baseRateCents == null ? {} : { baseRateCents }) } } : {}),
    optionImpacts: value.optionImpacts.map((impact) => ({ selectionKey: impact.selectionKey, kind: impact.kind, cents: impact.amount.cents })),
    minimumChargeApplied: value.minimumChargeApplied,
  };
};
