import { createHash } from "node:crypto";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, decimalText, type JsonValue } from "../shared/commercialValues.js";
import type { PricingBaseRateOverride, PricingMatrixRow, PricingOptionRule, PricingRules, PricingTierFamily, PricingTierRule } from "../pricing/contracts.js";
import { getPbv2FixedDimensions } from "../../../../shared/pbv2/fixedDimensions.js";
import { extractFormulaVariables, parseFormulaBoolean } from "../../../../shared/pbv2/formulaHelpers.js";
import { extractProductOptionPricingMatrix, resolveProductOptionPricingMatrixBaseRateCents } from "../../../../shared/productOptionPricingMatrix.js";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../../../shared/optionTreeV2Runtime.js";
import type { OptionTreeV2, PricingImpact, PricingV2Tier } from "../../../../shared/optionTreeV2.js";
import type { ResolveActivePricingInput, ResolvedPricingInput, SellableProductConfiguration } from "./contracts.js";
import { resolveProductionRequirementSnapshot } from "../shared/productionRequirements.js";
import { estimatePricingSheetUsage } from "../pricing/pricingNestingEstimate.js";

export type ActivePbv2CompatibilityRecord = Readonly<{
  id: string;
  schemaVersion: number;
  publishedAt: string | null;
  treeJson: unknown;
  productMeasurementMode: "dimensions_required" | "quantity_only";
  productPricingProfileKey: string | null;
  /** Read-only V1 compatibility input; never a target for V2 ProductVersion writes. */
  legacyProductPricingConfig?: JsonValue | null;
  /** Read-only V1 formula fallback; only used when no newer Formula source exists. */
  legacyProductPricingFormula?: string | null;
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
  if (!/^[\s\w.,()+\-*/]+$/u.test(expression)) return false;
  return !/\b(?!ceil\s*\(|sheet_consumption_sqft\s*\(|roll_nesting_billable_sqft\s*\()[A-Za-z_]\w*\s*\(/u.test(expression);
};

const impactRule = (
  impact: PricingImpact,
  id: string,
  selectionKey: string,
  whenValue: string | boolean | number | undefined,
): PricingOptionRule | null => {
  switch (impact.mode) {
    case "addFlat": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "fixed", amount: impact.amountCents };
    case "addCents": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "fixed", amount: impact.cents };
    case "addPerQty": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_unit", amount: impact.amountCents };
    case "addPerSqft": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_square_foot", amount: impact.amountCents };
    case "percentOfBase": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "percent", percentBasisPoints: Math.round(impact.percent * 100) as PricingOptionRule["percentBasisPoints"] };
    case "multiplier": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "multiplier", amount: impact.factor };
    case "addPercent": {
      const kind = impact.basis == null || impact.basis === "base"
        ? "percent"
        : impact.basis === "optionsSubtotal" ? "percent_of_options_subtotal" : "percent_of_line_subtotal";
      return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind, percentBasisPoints: Math.round(impact.percent * 100) as PricingOptionRule["percentBasisPoints"] };
    }
    case "addPerUnit":
      if (impact.unit === "perPiece" || impact.unit === "perQty") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_unit", amount: impact.centsPerUnit };
      if (impact.unit === "perSqft") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_square_foot", amount: impact.centsPerUnit };
      if (impact.unit === "perLinearFoot") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_linear_foot", amount: impact.centsPerUnit };
      if (impact.unit === "perInch") return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "per_inch", amount: impact.centsPerUnit };
      return null;
    case "addFormula": return { id, selectionKey, ...(whenValue === undefined ? {} : { whenValue }), kind: "formula", formula: impact.formula };
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
    const selectedNode = node.input?.type === "boolean"
      ? selectedValue === true
      : selectedValues.length > 0 && selectedValues.some(value => value !== undefined && value !== null && value !== "");
    const impacts: Array<{ impact: PricingImpact; id: string; whenValue?: string | boolean | number }> = [];
    if (selectedNode) for (const [index, impact] of (node.pricingImpact ?? []).entries()) impacts.push({ impact, id: `${node.id}:node:${index}` });
    for (const choice of selectedChoices) {
      if (choice.priceDeltaCents != null) impacts.push({ impact: { mode: "addFlat", amountCents: choice.priceDeltaCents }, id: `${node.id}:${choice.value}:delta`, whenValue: choice.value });
      for (const [index, impact] of (choice.pricingImpact ?? []).entries()) impacts.push({ impact, id: `${node.id}:${choice.value}:${index}`, whenValue: choice.value });
    }
    for (const entry of impacts) {
      // V1's `applyWhenOk` compatibility evaluator intentionally treated these
      // legacy predicates as eligible.  Preserve that behavior here rather
      // than making historical prices depend on a newly interpreted condition.
      const mapped = impactRule(entry.impact, entry.id, selectionKey, entry.whenValue);
      if (!mapped) return validation(`The selected pricing option '${selectionKey}' uses an unsupported pricing impact.`);
      rules.push(mapped);
    }
  }
  return success(rules);
};

const baseRateOverrides = (tree: OptionTreeV2, visibleNodeIds: readonly string[], selections: Record<string, JsonValue>): ApplicationResult<readonly PricingBaseRateOverride[]> => {
  const rules: PricingBaseRateOverride[] = [];
  for (const nodeId of visibleNodeIds) {
    const node = tree.nodes[nodeId];
    if (!node || node.kind !== "question") continue;
    const selectionKey = keyFor(node), selected = selections[selectionKey];
    const values = Array.isArray(selected) ? selected : [selected];
    for (const choice of (node.choices ?? []).filter(choice => values.includes(choice.value))) {
      const override = choice.pricingOverride;
      if (!override || override.mode === "none") continue;
      const amount = override.amount;
      const target = override.unit === "perSqft"
        ? "per_square_foot"
        : override.unit === "perPiece" ? "per_piece"
        : override.unit === "minimumCharge" ? "minimum_charge" : null;
      if (!target || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
        return validation(`The selected pricing option '${selectionKey}' uses an unsupported pricing override.`);
      }
      if ((override.mode === "set_base_rate" || override.mode === "add_base_rate") && !Number.isSafeInteger(amount)) {
        return validation(`The selected pricing option '${selectionKey}' uses an invalid cents-based pricing override.`);
      }
      const kind = override.mode === "set_base_rate"
        ? `set_${target}`
        : override.mode === "add_base_rate" ? `add_${target}`
        : override.mode === "multiply_base_rate" ? `multiply_${target}` : null;
      if (!kind) return validation(`The selected pricing option '${selectionKey}' uses an unsupported pricing override.`);
      rules.push({
        id: `${node.id}:${choice.value}:base-rate`, selectionKey, whenValue: choice.value,
        kind: kind as PricingBaseRateOverride["kind"],
        ...(override.mode === "multiply_base_rate" ? { factor: amount } : { amountCents: amount }),
      });
    }
  }
  return success(rules.sort((left, right) => left.selectionKey.localeCompare(right.selectionKey) || String(left.whenValue).localeCompare(String(right.whenValue)) || left.kind.localeCompare(right.kind)));
};

const validation = (message: string): ApplicationResult<never> => failure(new V2ApplicationError("VALIDATION_ERROR", message));

const formulaNeedsSheetEstimate = (expression: string | undefined): boolean =>
  Boolean(expression && /\bsheet_consumption_sqft\s*\(/u.test(expression));

const numberVariable = (
  variables: Readonly<Record<string, JsonValue>>,
  key: string,
  options: Readonly<{ allowZero?: boolean }> = {},
): number | null => {
  const value = variables[key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && (options.allowZero ? number >= 0 : number > 0) ? number : null;
};

type ResolvedRotationPolicy = Readonly<{
  /** Effective nesting policy after the optional line-item option control. */
  allowRotation: boolean;
  productAllowsRotation: boolean;
  optionAllowsRotation: boolean;
  source: "product_version.pricingV2.allowRotation" | "legacy.pricingFormulaVariables.allow_rotation" | "legacy.formulaVariables.allow_rotation" | "legacy.product.pricing_profile_config.allowRotation" | "legacy.formulaLibrary.allow_rotation" | "default.false";
  rotationControl?: Readonly<{
    optionId: string;
    selectionKey: string;
    selectedChoiceValues: readonly string[];
    allowWhenChoiceValues: readonly string[];
  }>;
}>;

/**
 * Rotation is a typed ProductVersion pricing decision.  Older trees and
 * Formula Library configurations historically placed it among loosely typed
 * variables; read those values only at this compatibility boundary.  New V2
 * writes must use `meta.pricingV2.allowRotation`.
 */
export const resolveProductVersionRotationPolicy = (
  pricingV2: Readonly<Record<string, unknown>>,
  meta: Readonly<Record<string, unknown>>,
  legacyProductPricingConfig: JsonValue | null | undefined,
  formulaConfig: JsonValue | null | undefined,
): ResolvedRotationPolicy => {
  if (typeof pricingV2.allowRotation === "boolean") {
    return { allowRotation: pricingV2.allowRotation, productAllowsRotation: pricingV2.allowRotation, optionAllowsRotation: true, source: "product_version.pricingV2.allowRotation" };
  }
  const legacySources: readonly [unknown, ResolvedRotationPolicy["source"]][] = [
    [record(meta.pricingFormulaVariables)?.allow_rotation ?? record(meta.pricingFormulaVariables)?.allowRotation, "legacy.pricingFormulaVariables.allow_rotation"],
    [record(meta.formulaVariables)?.allow_rotation ?? record(meta.formulaVariables)?.allowRotation, "legacy.formulaVariables.allow_rotation"],
    [record(legacyProductPricingConfig)?.allowRotation ?? record(legacyProductPricingConfig)?.allow_rotation ?? record(record(legacyProductPricingConfig)?.formulaVariables)?.allow_rotation, "legacy.product.pricing_profile_config.allowRotation"],
    [record(record(formulaConfig)?.variables)?.allow_rotation ?? record(record(formulaConfig)?.variables)?.allowRotation ?? record(formulaConfig)?.allowRotation, "legacy.formulaLibrary.allow_rotation"],
  ];
  for (const [value, source] of legacySources) {
    const resolved = parseFormulaBoolean(value);
    if (resolved !== null) return { allowRotation: resolved, productAllowsRotation: resolved, optionAllowsRotation: true, source };
  }
  return { allowRotation: false, productAllowsRotation: false, optionAllowsRotation: true, source: "default.false" };
};

/**
 * Resolves a ProductVersion rotation policy against the already canonicalized
 * runtime selections.  This deliberately refers to the PBV2 node id and
 * choice values only; labels, product type, Material, and Formula identity are
 * not pricing authorities.
 */
const resolveEffectiveRotationPolicy = (
  productPolicy: ResolvedRotationPolicy,
  tree: OptionTreeV2,
  pricingV2: Readonly<Record<string, unknown>>,
  selections: Readonly<Record<string, JsonValue>>,
): ApplicationResult<ResolvedRotationPolicy> => {
  // A ProductVersion-level off switch is absolute. A stale optional control
  // cannot re-enable rotation or alter the price in this state.
  if (!productPolicy.productAllowsRotation) return success(productPolicy);
  const control = record(pricingV2.rotationControl);
  if (!control) return success(productPolicy);
  const optionId = typeof control.optionId === "string" ? control.optionId : null;
  const allowWhenChoiceValues = Array.isArray(control.allowWhenChoiceValues) && control.allowWhenChoiceValues.every(value => typeof value === "string" && value.length > 0)
    ? control.allowWhenChoiceValues as string[]
    : null;
  if (!optionId || !allowWhenChoiceValues?.length) return validation("The configured rotation-control option is invalid.");
  const option = tree.nodes[optionId];
  if (!option || option.kind !== "question") return validation("The configured rotation-control option no longer exists.");
  const choiceValues = new Set((option.choices ?? []).map(choice => choice.value));
  if (allowWhenChoiceValues.some(value => !choiceValues.has(value))) return validation("The configured rotation-control choice no longer exists.");
  const selectionKey = keyFor(option);
  const rawSelection = selections[selectionKey];
  const selectedChoiceValues = (Array.isArray(rawSelection) ? rawSelection : rawSelection == null ? [] : [rawSelection]);
  if (!selectedChoiceValues.length || selectedChoiceValues.some(value => typeof value !== "string")) return validation("The configured rotation-control option requires a selected choice.");
  const selected = selectedChoiceValues as string[];
  const optionAllowsRotation = selected.some(value => allowWhenChoiceValues.includes(value));
  return success({
    allowRotation: productPolicy.productAllowsRotation && optionAllowsRotation,
    productAllowsRotation: productPolicy.productAllowsRotation,
    optionAllowsRotation,
    source: productPolicy.source,
    rotationControl: { optionId, selectionKey, selectedChoiceValues: selected, allowWhenChoiceValues },
  });
};

/**
 * Formula-library sheet consumption needs deterministic pricing facts before the
 * Pricing domain selects its computed-sheet tier. This stays a Product/PBV2
 * compatibility concern: it adapts the published formula configuration to the
 * existing pure Pricing estimator and never consults Recipe, Inventory, or
 * Production state.
 */
const resolveFormulaSheetEstimate = (
  expression: string | undefined,
  variables: Readonly<Record<string, JsonValue>>,
  dimensions: ResolveActivePricingInput["dimensions"] | undefined,
  quantity: number,
  rotation: ResolvedRotationPolicy,
): ApplicationResult<ResolvedPricingInput["nestingEstimate"]> => {
  if (!formulaNeedsSheetEstimate(expression)) return success(undefined);
  if (!dimensions) return validation("The active sheet-pricing formula requires effective dimensions.");
  const scale = dimensions.unit === "in" ? 1 : dimensions.unit === "ft" ? 12 : 1 / 25.4;
  const width = Number(dimensions.width) * scale;
  const height = Number(dimensions.height) * scale;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return validation("The active sheet-pricing formula requires positive effective dimensions.");
  }
  const sheetWidthIn = numberVariable(variables, "sheet_width");
  const sheetLengthIn = numberVariable(variables, "sheet_length");
  const usableDropMinimumIn = numberVariable(variables, "usable_drop_min", { allowZero: true });
  const billableLengthIncrementIn = numberVariable(variables, "billable_length_increment");
  const minimumBillableSqft = numberVariable(variables, "minimum_billable_sqft", { allowZero: true });
  if (sheetWidthIn == null || sheetLengthIn == null || usableDropMinimumIn == null || billableLengthIncrementIn == null || minimumBillableSqft == null) {
    return validation("The active sheet-pricing formula is missing valid sheet-yield variables.");
  }
  try {
    const estimate = estimatePricingSheetUsage({ pieceWidthIn: width, pieceHeightIn: height, quantity, sheetWidthIn, sheetLengthIn, usableDropMinimumIn, billableLengthIncrementIn, minimumBillableSqft, allowRotation: rotation.allowRotation, allowRotationSource: rotation.source });
    return success({
      ...estimate,
      facts: {
        ...estimate.facts,
        productAllowsRotation: rotation.productAllowsRotation,
        optionAllowsRotation: rotation.optionAllowsRotation,
        effectiveRotation: rotation.allowRotation,
        ...(rotation.rotationControl ? {
          rotationControlOptionId: rotation.rotationControl.optionId,
          rotationControlSelectionKey: rotation.rotationControl.selectionKey,
          rotationControlSelectedChoiceValues: rotation.rotationControl.selectedChoiceValues,
          rotationControlAllowWhenChoiceValues: rotation.rotationControl.allowWhenChoiceValues,
        } : {}),
      },
    });
  } catch {
    return validation("The active sheet-pricing formula could not resolve a valid sheet-yield estimate.");
  }
};

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
  // V1 allowed both schedules to be published together.  Preserve both typed
  // families instead of rejecting a valid historical ProductVersion or
  // arbitrarily selecting one at this compatibility boundary.
  const tierFamilies: PricingTierFamily[] = [
    ...(qtyTiers.length ? [{ basis: "quantity" as const, tiers: qtyTiers.map((entry, index) => tier(entry, `quantity-tier-${index}`)) }] : []),
    ...(sqftTiers.length ? [{ basis: "square_foot" as const, tiers: sqftTiers.map((entry, index) => tier(entry, `square-foot-tier-${index}`)) }] : []),
  ];
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
  const embeddedExpression = typeof meta.pricingFormula === "string" && meta.pricingFormula.trim() ? meta.pricingFormula.trim() : undefined;
  const libraryExpression = source.formula?.expression?.trim() || undefined;
  const legacyProductExpression = source.legacyProductPricingFormula?.trim() || undefined;
  // The canonical Formula Library remains the primary configured authority.
  // A ProductVersion embedded expression is the established compatibility
  // fallback, followed only then by the legacy Product row expression.
  const formulaResolution = libraryExpression && source.formula
      ? { expression: libraryExpression, source: "library" as const, id: source.formula.id, version: source.formula.updatedAt }
      : embeddedExpression
        ? { expression: embeddedExpression, source: "embedded" as const, id: `embedded:${source.id}`, version: source.publishedAt ?? `schema-${source.schemaVersion}` }
      : legacyProductExpression
        ? { expression: legacyProductExpression, source: "legacy_product" as const, id: `legacy-product:${source.id}`, version: source.publishedAt ?? `schema-${source.schemaVersion}` }
        : undefined;
  if (source.formula && !libraryExpression && !embeddedExpression) return validation("The active Formula Library entry has no supported expression.");
  const expression = formulaResolution?.expression;
  if (expression && !supportedFormula(expression)) return validation("The active formula uses an unsupported compatibility function.");
  const resolvedOptionImpacts = optionImpacts(tree, visibility.visibleNodeIds, visibility.effectiveSelections as Record<string, JsonValue>);
  if (!resolvedOptionImpacts.ok) return resolvedOptionImpacts;
  const resolvedBaseRateOverrides = baseRateOverrides(tree, visibility.visibleNodeIds, visibility.effectiveSelections as Record<string, JsonValue>);
  if (!resolvedBaseRateOverrides.ok) return resolvedBaseRateOverrides;
  const productRotation = resolveProductVersionRotationPolicy(pricingV2, meta, source.legacyProductPricingConfig, source.formula?.config);
  const resolvedRotation = resolveEffectiveRotationPolicy(productRotation, tree, pricingV2, visibility.effectiveSelections as Record<string, JsonValue>);
  if (!resolvedRotation.ok) return resolvedRotation;
  const rotation = resolvedRotation.value;
  // `allow_rotation` remains a numeric runtime argument for the small Formula
  // evaluator only. Its value is derived from the typed ProductVersion policy,
  // never persisted as a numeric Formula input.
  const legacyConfig = record(source.legacyProductPricingConfig);
  const numericSelections = Object.fromEntries(
    Object.entries(visibility.effectiveSelections).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
  );
  const formulaVariables = {
    ...extractFormulaVariables(record(source.formula?.config)),
    ...record(meta.pricingFormulaVariables),
    ...record(meta.formulaVariables),
    ...record(legacyConfig?.variables),
    ...record(legacyConfig?.formulaVariables),
    ...numericSelections,
    allow_rotation: rotation.allowRotation ? 1 : 0,
  } as Record<string, JsonValue>;
  const isFeeProfile = source.productPricingProfileKey === "fee";
  const flatFeeDollars = numberVariable(formulaVariables, "flatFee", { allowZero: true });
  if (isFeeProfile && flatFeeDollars == null) return validation("Price not configured: Fee / Service products require a Flat Fee Amount.");
  const nestingEstimate = resolveFormulaSheetEstimate(expression, formulaVariables, dimensions, input.quantity, rotation);
  if (!nestingEstimate.ok) return nestingEstimate;
  let productionRequirements;
  try { productionRequirements=resolveProductionRequirementSnapshot(meta.productionUnitSpecification,visibility.effectiveSelections as Record<string,JsonValue>); }
  catch { return validation("The active production-unit specification is invalid."); }
  const rules: PricingRules = {
    base: {
      ...(typeof base.perPieceCents === "number" ? { perPieceCents: Math.round(base.perPieceCents) } : {}),
      ...(decimal(base.perSqftCents) ? { perSquareFootCents: decimal(base.perSqftCents)! } : {}),
      ...(isFeeProfile && flatFeeDollars != null ? { flatFeeCents: Math.round(flatFeeDollars * 100) } : {}),
    },
    ...(typeof base.minimumChargeCents === "number" ? { minimumChargeCents: Math.round(base.minimumChargeCents) } : {}),
    ...(pricingV2.tierBasis === "computed_sheet_usage" ? { tierBasis: "computed_sheet" as const, tiers: qtyTiers.map((entry, index) => tier(entry, `computed-sheet-tier-${index}`)) } : {}),
    ...(tierFamilies.length ? { tierFamilies } : {}),
    // An empty or incomplete persisted matrix is still a Matrix-priced
    // configuration. Carry it to the Pricing boundary so it fails closed
    // instead of silently becoming scalar base pricing.
    ...(matrix ? { matrix: { id: matrix.id ?? `matrix:${source.id}`, dimensions: matrix.dimensions, rows: matrixRows } } : {}),
    ...(expression && !isFeeProfile ? { formula: {
      id: formulaResolution!.id,
      source: formulaResolution!.source,
      version: formulaResolution!.version,
      contentHash: stableHash({ expression, source: formulaResolution!.source, variables: formulaVariables, allowRotation: rotation.allowRotation, formula: source.formula ? { id: source.formula.id, config: source.formula.config, profileKey: source.formula.profileKey } : null }),
      expression,
      variables: formulaVariables,
    } } : {}),
    ...(resolvedOptionImpacts.value.length ? { optionImpacts: resolvedOptionImpacts.value } : {}),
    ...(resolvedBaseRateOverrides.value.length ? { baseRateOverrides: resolvedBaseRateOverrides.value } : {}),
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
      derivedFacts: {
        ...(quantityOnly ? { measurementMode: "quantity_only" } : {}),
        productAllowsRotation: rotation.productAllowsRotation,
        optionAllowsRotation: rotation.optionAllowsRotation,
        effectiveRotation: rotation.allowRotation,
        ...(rotation.rotationControl ? {
          rotationControlOptionId: rotation.rotationControl.optionId,
          rotationControlSelectionKey: rotation.rotationControl.selectionKey,
          rotationControlSelectedChoiceValues: rotation.rotationControl.selectedChoiceValues,
          rotationControlAllowWhenChoiceValues: rotation.rotationControl.allowWhenChoiceValues,
        } : {}),
      } as Record<string, JsonValue>,
      productFacts: { measurementMode: quantityOnly ? "quantity_only" : "dimensions_required", pricingProfileKey: source.productPricingProfileKey ?? "default" },
      productionRequirements,
    },
    rules,
    ...(nestingEstimate.value ? { nestingEstimate: nestingEstimate.value } : {}),
    warnings: [],
  });
};
