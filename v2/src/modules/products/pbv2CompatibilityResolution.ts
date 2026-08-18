import { createHash } from "node:crypto";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, decimalText, type JsonValue } from "../shared/commercialValues.js";
import type { PricingMatrixRow, PricingOptionRule, PricingRules, PricingTierRule } from "../pricing/contracts.js";
import { getPbv2FixedDimensions } from "../../../../shared/pbv2/fixedDimensions.js";
import { extractProductOptionPricingMatrix, resolveProductOptionPricingMatrixBaseRateCents } from "../../../../shared/productOptionPricingMatrix.js";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../../../shared/optionTreeV2Runtime.js";
import type { OptionTreeV2, PricingImpact, PricingV2Tier } from "../../../../shared/optionTreeV2.js";
import type { ResolveActivePricingInput, ResolvedPricingInput, SellableProductConfiguration } from "./contracts.js";
import { resolveProductionRequirementSnapshot } from "../shared/productionRequirements.js";

export type ActivePbv2CompatibilityRecord = Readonly<{
  id: string;
  schemaVersion: number;
  publishedAt: string | null;
  treeJson: unknown;
  productMeasurementMode: "dimensions_required" | "quantity_only";
  productPricingProfileKey: string | null;
  formula: Readonly<{ id: string; code: string | null; profileKey: string; expression: string | null; config: JsonValue | null; updatedAt: string }> | null;
}>;

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Database JSON cannot retain undefined fields; normalize test/in-memory inputs to the same persisted representation before hashing. */
const stableHash = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(value)) as JsonValue)).digest("hex")}`;
const decimal = (value: unknown): ReturnType<typeof decimalText> | undefined => typeof value === "number" && Number.isFinite(value) ? decimalText(String(value)) : undefined;
const tier = (input: PricingV2Tier, fallbackId: string): PricingTierRule => ({
  id: input.id ?? fallbackId,
  minQuantity: input.minQty ?? input.minSqft ?? 1,
  ...(input.maxQty == null ? {} : { maxQuantity: input.maxQty }),
  ...(input.perPieceCents == null ? {} : { perPieceCents: Math.round(input.perPieceCents) }),
  ...(decimal(input.perSqftCents) == null ? {} : { perSquareFootCents: decimal(input.perSqftCents)! }),
  ...(input.minimumChargeCents == null ? {} : { minimumChargeCents: Math.round(input.minimumChargeCents) }),
});
const keyFor = (node: any): string => typeof node?.input?.selectionKey === "string" ? node.input.selectionKey : typeof node?.key === "string" ? node.key : node.id;
const supportedFormula = (expression: string): boolean => {
  if (!/^[\s\w.()+\-*/]+$/u.test(expression)) return false;
  return !/\b(?!ceil\s*\()[A-Za-z_]\w*\s*\(/u.test(expression);
};

const impactRule = (
  impact: PricingImpact,
  id: string,
  selectionKey: string,
  whenValue: string | boolean | number | undefined,
): PricingOptionRule | null => {
  if (impact.applyWhen) return null;
  switch (impact.mode) {
    case "addFlat": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "fixed", amount: impact.amountCents };
    case "addCents": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "fixed", amount: impact.cents };
    case "addPerQty": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_unit", amount: impact.amountCents };
    case "addPerSqft": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_square_foot", amount: impact.amountCents };
    case "percentOfBase": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "percent", percentBasisPoints: Math.round(impact.percent * 100) as PricingOptionRule["percentBasisPoints"] };
    case "multiplier": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "multiplier", amount: impact.factor };
    case "addPercent":
      return impact.basis == null || impact.basis === "base"
        ? { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "percent", percentBasisPoints: Math.round(impact.percent * 100) as PricingOptionRule["percentBasisPoints"] }
        : null;
    case "addPerUnit":
      if (impact.unit === "perPiece" || impact.unit === "perQty") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_unit", amount: impact.centsPerUnit };
      if (impact.unit === "perSqft") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_square_foot", amount: impact.centsPerUnit };
      return null;
    case "addFormula": return null;
  }
};

const optionImpacts = (tree: OptionTreeV2, visibleNodeIds: readonly string[], selections: Record<string, JsonValue>): ApplicationResult<readonly PricingOptionRule[]> => {
  const rules: PricingOptionRule[] = [];
  for (const nodeId of visibleNodeIds) {
    const node = tree.nodes[nodeId];
    // Pricing option impacts represent selectable questions. Computed/group nodes can
    // be visible and carry a legacy key, but they never supply an option selection.
    if (!node || node.kind !== "question") continue;
    const selectionKey = keyFor(node);
    const selectedValue = selections[selectionKey];
    // Runtime visibility already applies valid defaults and the caller has already
    // rejected missing required fields. An absent optional answer is not a malformed
    // selected value and must not create an unconditional option impact.
    if ((selectedValue === undefined || selectedValue === null || (Array.isArray(selectedValue) && selectedValue.length === 0)) && !node.input?.required) continue;
    const selectedValues = Array.isArray(selectedValue) ? selectedValue : [selectedValue];
    if (selectedValues.some((value) => typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return validation(`The selected pricing option '${selectionKey}' has an unsupported value.`);
    const selectedChoices = (node.choices ?? []).filter((choice) => selectedValues.includes(choice.value));
    const impacts: Array<{ impact: PricingImpact; id: string; whenValue?: string | boolean | number }> = [];
    for (const [index, impact] of (node.pricingImpact ?? []).entries()) impacts.push({ impact, id: `${node.id}:node:${index}` });
    for (const choice of selectedChoices) {
      if (choice.priceDeltaCents != null) impacts.push({ impact: { mode: "addFlat", amountCents: choice.priceDeltaCents }, id: `${node.id}:${choice.value}:delta`, whenValue: choice.value });
      for (const [index, impact] of (choice.pricingImpact ?? []).entries()) impacts.push({ impact, id: `${node.id}:${choice.value}:${index}`, whenValue: choice.value });
      if (choice.pricingOverride && choice.pricingOverride.mode !== "none") return validation(`The selected pricing option '${selectionKey}' uses an unsupported pricing override.`);
    }
    for (const entry of impacts) {
      const mapped = impactRule(entry.impact, entry.id, selectionKey, entry.whenValue);
      if (!mapped) return validation(`The selected pricing option '${selectionKey}' uses an unsupported pricing impact.`);
      rules.push(mapped);
    }
  }
  return success(rules);
};

const validation = (message: string): ApplicationResult<never> => failure(new V2ApplicationError("VALIDATION_ERROR", message));

/** Pure anti-corruption mapper: tree JSON is consumed here and never crosses the Sales/Pricing DTO boundary. */
export const resolveActivePbv2PricingInput = (
  sellableProduct: SellableProductConfiguration,
  source: ActivePbv2CompatibilityRecord,
  input: ResolveActivePricingInput,
): ApplicationResult<ResolvedPricingInput> => {
  const parsed = validateOptionTreeV2(source.treeJson as OptionTreeV2);
  if (!parsed.ok) return validation("The active pricing configuration is invalid.");
  const tree = source.treeJson as OptionTreeV2;
  const explicit = input.selections ?? {};
  const visibility = resolveRuntimeVisibility(tree, explicit);
  if (visibility.hiddenSelectionWarnings.length) return validation("A selection is unknown, hidden, or unavailable for this product configuration.");
  const visible = new Set(visibility.visibleNodeIds);
  for (const node of Object.values(tree.nodes)) {
    if (!visible.has(node.id) || node.kind === "group" || !node.input?.required) continue;
    const value = visibility.effectiveSelections[keyFor(node)];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return validation(`Required selection '${keyFor(node)}' is missing.`);
  }
  const quantityOnly = source.productMeasurementMode === "quantity_only";
  const fixed = getPbv2FixedDimensions(tree);
  const dimensions = quantityOnly ? undefined : fixed
    ? { width: decimalText(String(fixed.widthIn)), height: decimalText(String(fixed.heightIn)), unit: "in" as const }
    : input.dimensions;
  if (!quantityOnly && sellableProduct.requiresDimensions && !dimensions) return validation("This product requires effective dimensions.");

  const meta = record(tree.meta) ?? {};
  const pricingV2 = record(meta.pricingV2) ?? {};
  const base = record(pricingV2.base) ?? {};
  const qtyTiers = Array.isArray(pricingV2.qtyTiers) ? pricingV2.qtyTiers as PricingV2Tier[] : [];
  const sqftTiers = Array.isArray(pricingV2.sqftTiers) ? pricingV2.sqftTiers as PricingV2Tier[] : [];
  if (qtyTiers.length && sqftTiers.length) return validation("This active configuration combines quantity and square-foot tier systems; compatibility mapping is not yet proven.");
  const matrix = extractProductOptionPricingMatrix(tree);
  const matrixRows: PricingMatrixRow[] = (matrix?.rows ?? []).map((row, index) => {
    const variables = row.variables ?? row.values ?? {};
    const unit = pricingV2.optionMatrixPricingUnit === "per_piece" ? "piece" : "area";
    const baseRate = resolveProductOptionPricingMatrixBaseRateCents(row);
    const rowTiers = Array.isArray(row.qtyTiers) ? row.qtyTiers.map((entry, tierIndex) => tier(entry, `matrix-${index}-tier-${tierIndex}`)) : undefined;
    return {
      id: row.id ?? `matrix-row-${index}`,
      when: (row.when ?? row.match ?? row.combination ?? {}) as Record<string, string | boolean | number>,
      ...(row.tierBasis === "computed_sheet_usage" ? { tierBasis: "computed_sheet" as const } : {}),
      ...(rowTiers?.length ? { tiers: rowTiers } : {}),
      ...(baseRate == null ? {} : unit === "piece" ? { perPieceCents: baseRate } : { perSquareFootCents: decimalText(String(baseRate)) }),
      // Variables are resolved formula inputs, not raw matrix data; only base_price is carried through rates above.
    };
  });
  const expression = source.formula?.expression ?? (typeof meta.pricingFormula === "string" ? meta.pricingFormula : undefined);
  if (source.formula && (!source.formula.expression || !source.formula.expression.trim())) return validation("The active Formula Library entry has no supported expression.");
  if (expression && !supportedFormula(expression)) return validation("The active formula uses an unsupported compatibility function.");
  const resolvedOptionImpacts = optionImpacts(tree, visibility.visibleNodeIds, visibility.effectiveSelections as Record<string, JsonValue>);
  if (!resolvedOptionImpacts.ok) return resolvedOptionImpacts;
  const formulaVariables = (record(meta.formulaVariables) ?? record(meta.pricingFormulaVariables) ?? {}) as Record<string, JsonValue>;
  let productionRequirements;
  try { productionRequirements=resolveProductionRequirementSnapshot(meta.productionUnitSpecification,visibility.effectiveSelections as Record<string,JsonValue>); }
  catch { return validation("The active production-unit specification is invalid."); }
  const rules: PricingRules = {
    base: {
      ...(typeof base.perPieceCents === "number" ? { perPieceCents: Math.round(base.perPieceCents) } : {}),
      ...(decimal(base.perSqftCents) ? { perSquareFootCents: decimal(base.perSqftCents)! } : {}),
    },
    ...(typeof base.minimumChargeCents === "number" ? { minimumChargeCents: Math.round(base.minimumChargeCents) } : {}),
    ...(pricingV2.tierBasis === "computed_sheet_usage" ? { tierBasis: "computed_sheet" as const } : sqftTiers.length ? { tierBasis: "square_foot" as const } : {}),
    ...((qtyTiers.length || sqftTiers.length) ? { tiers: (qtyTiers.length ? qtyTiers : sqftTiers).map((entry, index) => tier(entry, `tier-${index}`)) } : {}),
    ...(matrix && matrixRows.length ? { matrix: { id: matrix.id ?? `matrix:${source.id}`, dimensions: matrix.dimensions, rows: matrixRows } } : {}),
    ...(expression ? { formula: {
      id: source.formula?.id ?? `embedded:${source.id}`,
      source: source.formula ? "library" as const : "embedded" as const,
      version: source.formula?.updatedAt ?? source.publishedAt ?? `schema-${source.schemaVersion}`,
      contentHash: stableHash({ expression, variables: formulaVariables, formula: source.formula ? { id: source.formula.id, config: source.formula.config, profileKey: source.formula.profileKey } : null }),
      expression,
      variables: formulaVariables,
    } } : {}),
    ...(resolvedOptionImpacts.value.length ? { optionImpacts: resolvedOptionImpacts.value } : {}),
  };
  const configurationContentHash = stableHash(tree);
  return success({
    sellableProduct,
    resolvedConfiguration: {
      schemaVersion: 1,
      organizationId: input.organizationId,
      productId: input.productId,
      pricingConfigurationId: sellableProduct.pricingConfiguration.id,
      pricingConfigurationVersion: source.publishedAt ?? `schema-${source.schemaVersion}`,
      pricingConfigurationContentHash: configurationContentHash,
      quantity: input.quantity,
      ...(dimensions ? { dimensions } : {}),
      selections: visibility.effectiveSelections as Record<string, JsonValue>,
      derivedFacts: quantityOnly ? { measurementMode: "quantity_only" } as Record<string, JsonValue> : {} as Record<string, JsonValue>,
      productFacts: { measurementMode: quantityOnly ? "quantity_only" : "dimensions_required", pricingProfileKey: source.productPricingProfileKey ?? "default" },
      productionRequirements,
    },
    rules,
    warnings: [],
  });
};
