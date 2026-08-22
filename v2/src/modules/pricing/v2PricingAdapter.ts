import { createHash } from "node:crypto";
import { evaluate as evaluateMathExpression } from "mathjs";
import { brandedId, canonicalJson, decimalText, money, type JsonValue } from "../shared/commercialValues.js";
import { formulaHelperScope, sheetConsumptionSqft } from "../../../../shared/pbv2/formulaHelpers.js";
import { rollNestingBillableSqft } from "../../../../shared/pbv2/rollMediaLayout.js";
import {
  assertPricingCalculationRequest,
  assertPricingResultEvidence,
  type PricingCalculationRequest,
  type PricingComponent,
  type PricingOptionImpact,
  type PricingPort,
  type PricingResult,
  type PricingTierRule,
} from "./contracts.js";

/**
 * V1's commercial boundary rounds currency with a small epsilon before the
 * final integer-cent conversion.  Keep that one policy at the V2 money
 * boundary instead of teaching individual formula or impact forms about IEEE
 * binary representation.
 */
export const roundCommercialCents = (value: number): number => {
  if (!Number.isFinite(value)) throw new Error("Pricing calculation produced a non-finite amount.");
  return Math.round(value + Number.EPSILON * 100);
};
const roundCents = roundCommercialCents;
const asNumber = (value: string | undefined): number => value == null ? 0 : Number(value);
/** Optional contract fields are semantically absent, not a source of hash drift. */
const canonicalEvidence = (value: unknown): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Pricing evidence cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalEvidence);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, canonicalEvidence(nested)]));
  }
  throw new Error("Pricing evidence must be plain, serializable data.");
};
const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(canonicalEvidence(value))).digest("hex")}`;
const selected = (actual: unknown, expected: unknown): boolean => actual === expected;

const matrixRowNotFound = (matrixId: string): Error & Readonly<{ code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND" }> => {
  const error = new Error(`PBV2 pricing matrix '${matrixId}' has no row for the resolved selection values.`) as Error & { code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND" };
  error.code = "PBV2_PRICING_MATRIX_ROW_NOT_FOUND";
  return error;
};

const resolveMatrixRow = (matrix: NonNullable<PricingCalculationRequest["rules"]["matrix"]>, selections: Readonly<Record<string, JsonValue>>) => {
  // A matrix declares its complete dimensional key. Missing/stale selections
  // are configuration errors, never permission to calculate from scalar base
  // pricing. Rows are also required to cover every declared dimension so a
  // malformed partial row cannot accidentally price a higher-dimensional tree.
  if (!matrix.dimensions.every((key) => Object.hasOwn(selections, key))) return undefined;
  return matrix.rows.find((row) =>
    matrix.dimensions.every((key) => Object.hasOwn(row.when, key) && selected(selections[key], row.when[key]))
    && Object.keys(row.when).length === matrix.dimensions.length,
  );
};

const selectTier = (tiers: readonly PricingTierRule[] | undefined, basis: number): PricingTierRule | undefined =>
  tiers?.filter((tier) => basis >= tier.minQuantity && (tier.maxQuantity == null || basis <= tier.maxQuantity))
    .sort((left, right) => right.minQuantity - left.minQuantity)[0];

/**
 * Evaluates the deliberately small M1.2 formula language. Formula-library
 * resolution happens before this boundary; no tree, database, or global state
 * participates here. Expressions are dollar-valued, matching characterized V1
 * PBV2 formula behavior; the result is rounded once when converted to cents.
 */
/**
 * `allowRotation` is a ProductVersion pricing policy, not a Formula argument.
 * The optional override is supplied by the resolved ProductVersion boundary so
 * a legacy ninth sheet function argument cannot disagree with the nesting
 * evidence used to select computed-sheet tiers. Direct legacy evaluator users
 * without an override retain their historical ninth-argument behavior. The
 * numeric runtime bridge is deliberately normalized here only; it is never a
 * second persisted rotation policy.
 */
export const evaluateResolvedFormula = (expression: string, variables: Record<string, number>, resolvedAllowRotation?: boolean): number => {
  const tokens = expression.match(/\s*(ceil|sheet_consumption_sqft|roll_nesting_billable_sqft|[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)|[(),+\-*/])/gu);
  if (!tokens || tokens.join("").replace(/\s/gu, "") !== expression.replace(/\s/gu, "")) throw new Error("Unsupported pricing formula expression.");
  let cursor = 0;
  const take = (): string | undefined => tokens[cursor++]?.trim();
  const factor = (): number => {
    const token = take();
    if (token === "(") { const value = sum(); if (take() !== ")") throw new Error("Unbalanced pricing formula."); return value; }
    if (token === "ceil") { if (take() !== "(") throw new Error("ceil requires parentheses."); const value = sum(); if (take() !== ")") throw new Error("Unbalanced pricing formula."); return Math.ceil(value); }
    if (token === "sheet_consumption_sqft") {
      if (take() !== "(") throw new Error("sheet_consumption_sqft requires parentheses.");
      const args:number[]=[];
      while (true) { args.push(sum()); const separator=take(); if (separator === ")") break; if (separator !== ",") throw new Error("sheet_consumption_sqft arguments are invalid."); }
      if (args.length !== 8 && args.length !== 9) throw new Error("sheet_consumption_sqft requires eight or nine arguments.");
      const runtimeRotation = typeof variables.allow_rotation === "number"
        ? variables.allow_rotation === 1
        : typeof (variables as Record<string, unknown>).allowRotation === "boolean"
          ? (variables as Record<string, unknown>).allowRotation as boolean
          : undefined;
      return sheetConsumptionSqft(args[0]!,args[1]!,args[2]!,args[3]!,args[4]!,args[5]!,args[6]!,args[7]!,resolvedAllowRotation ?? runtimeRotation ?? args[8] ?? false);
    }
    if (token === "roll_nesting_billable_sqft") {
      if (take() !== "(") throw new Error("roll_nesting_billable_sqft requires parentheses.");
      const args:number[]=[];
      while (true) { args.push(sum()); const separator=take(); if (separator === ")") break; if (separator !== ",") throw new Error("roll_nesting_billable_sqft arguments are invalid."); }
      if (args.length !== 8 && args.length !== 9) throw new Error("roll_nesting_billable_sqft requires eight or nine arguments.");
      const runtimeRotation = typeof variables.allow_rotation === "number"
        ? variables.allow_rotation === 1
        : typeof (variables as Record<string, unknown>).allowRotation === "boolean"
          ? (variables as Record<string, unknown>).allowRotation as boolean
          : undefined;
      return rollNestingBillableSqft(args[0]!,args[1]!,args[2]!,args[3]!,args[4]!,args[5]!,args[6]!,args[7]!,resolvedAllowRotation ?? runtimeRotation ?? args[8] ?? false);
    }
    if (token === "-") return -factor();
    if (token && /^(?:\d|\.)/u.test(token)) return Number(token);
    if (token && Object.hasOwn(variables, token)) return variables[token]!;
    throw new Error(`Unknown pricing formula variable: ${token ?? "end of expression"}.`);
  };
  const product = (): number => { let value = factor(); while (tokens[cursor]?.trim() === "*" || tokens[cursor]?.trim() === "/") { const operator = take(); const right = factor(); value = operator === "*" ? value * right : value / right; } return value; };
  const sum = (): number => { let value = product(); while (tokens[cursor]?.trim() === "+" || tokens[cursor]?.trim() === "-") { const operator = take(); const right = product(); value = operator === "+" ? value + right : value - right; } return value; };
  const result = sum();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error("Invalid pricing formula result.");
  return result;
};

/**
 * V1 Option `addFormula` impacts use mathjs plus the shared PBV2 helper scope.
 * Keep that broader, established expression compatibility isolated to the
 * legacy impact form; Product Formula Library validation remains its own
 * explicit ProductVersion concern.
 */
const evaluateLegacyOptionImpactFormula = (expression: string, variables: Record<string, number>, resolvedAllowRotation?: boolean): number => {
  if (!expression.trim()) throw new Error("Option pricing formula is empty.");
  const value = Number(evaluateMathExpression(expression, {
    ...variables,
    ...formulaHelperScope(resolvedAllowRotation ?? variables.allow_rotation ?? false),
  }));
  if (!Number.isFinite(value)) throw new Error("Option pricing formula produced a non-finite amount.");
  return value;
};

const numericFormulaVariables = (values: Readonly<Record<string, unknown>>): Record<string, number> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "number" && Number.isFinite(value)) as [string, number][]);
/**
 * V1 pricing works in decimal inches. Quantizing conversion at twelve decimal
 * places prevents binary mm/25.4 noise from changing an exact tier boundary,
 * while retaining more precision than any characterized pricing geometry.
 */
const dimensionToInches = (value: number, unit: "in" | "ft" | "mm"): number =>
  Number((unit === "ft" ? value * 12 : unit === "mm" ? value / 25.4 : value).toFixed(12));
const hasAreaRate = (tier: PricingTierRule | undefined): boolean => tier?.perSquareFootCents != null;

/**
 * Calculation-only V2 boundary around characterized PBV2 pricing semantics.
 * A future compatibility reader resolves Product/PBV2 state into `rules` before
 * this adapter is called. It intentionally accepts a caller-supplied Nesting
 * estimate rather than reaching into production or inventory behavior.
 */
export class V2PricingParityAdapter implements PricingPort {
  async calculate(request: PricingCalculationRequest): Promise<PricingResult> {
    assertPricingCalculationRequest(request);
    const { resolvedConfiguration: configuration, rules, sellableProduct } = request;
    const quantityOnly = configuration.productFacts.measurementMode === "quantity_only" || configuration.productFacts.pricingProfileKey === "qty_only";
    const dimensions = configuration.dimensions;
    const selections = configuration.selections;
    const matrixRow = rules.matrix ? resolveMatrixRow(rules.matrix, selections) : undefined;
    const effectiveTierBasis = matrixRow?.tierBasis ?? rules.tierBasis;
    const selectedAreaOption = rules.optionImpacts?.some((rule) => rule.kind === "per_square_foot" && (rule.whenValue === undefined || selected(selections[rule.selectionKey], rule.whenValue)));
    const usesGeometry = Boolean(
      rules.formula || effectiveTierBasis === "square_foot" || selectedAreaOption || rules.base.perSquareFootCents != null || rules.tiers?.some(hasAreaRate) || matrixRow?.perSquareFootCents != null || matrixRow?.tiers?.some(hasAreaRate),
    );
    if (!quantityOnly && (sellableProduct.requiresDimensions || usesGeometry) && !dimensions) throw new Error("Pricing requires resolved effective dimensions for this product.");
    const sourceWidth = dimensions ? Number(dimensions.width) : 0;
    const sourceHeight = dimensions ? Number(dimensions.height) : 0;
    const width = dimensions ? dimensionToInches(sourceWidth, dimensions.unit) : 0;
    const height = dimensions ? dimensionToInches(sourceHeight, dimensions.unit) : 0;
    if (!quantityOnly && dimensions && (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height))) throw new Error("Pricing dimensions must be positive finite decimal values.");

    const totalSqft = quantityOnly ? 0 : (width * height / 144) * configuration.quantity;
    const computedSheetsValue = request.nestingEstimate?.facts.totalSheetCount ?? request.nestingEstimate?.facts.computedSheets;
    const computedSheets = typeof computedSheetsValue === "number" && Number.isFinite(computedSheetsValue) ? computedSheetsValue : undefined;
    const warnings: { code: string; message: string }[] = [];
    const tierBasis = effectiveTierBasis ?? "quantity";
    const basis = tierBasis === "computed_sheet"
      ? computedSheets
      : tierBasis === "square_foot" ? totalSqft : configuration.quantity;
    if (tierBasis === "computed_sheet" && basis == null) warnings.push({ code: "COMPUTED_SHEET_USAGE_UNAVAILABLE", message: "Computed-sheet tiers were not evaluated because no supplied nesting estimate included a sheet count." });

    if (rules.matrix && !matrixRow) throw matrixRowNotFound(rules.matrix.id);
    const matrixTier = basis == null ? undefined : selectTier(matrixRow?.tiers, basis);
    const familyTiers = (rules.tierFamilies ?? []).map((family) => ({
      basis: family.basis,
      tier: selectTier(family.tiers, family.basis === "quantity" ? configuration.quantity : family.basis === "square_foot" ? totalSqft : computedSheets ?? Number.NaN),
    }));
    // V1 resolves the quantity schedule and then lets a matching square-foot
    // schedule override only the rates it declares. Matrix row tiers remain the
    // most-specific schedule for a matched Matrix configuration.
    const productTiers = familyTiers.map((entry) => entry.tier).filter((entry): entry is PricingTierRule => Boolean(entry));
    const legacyTier = basis == null ? undefined : selectTier(rules.tiers, basis);
    const rateTiers = [...productTiers, legacyTier, matrixTier].filter((entry): entry is PricingTierRule => Boolean(entry));
    const lastDefined = <T,>(pick: (tier: PricingTierRule) => T | undefined): T | undefined => {
      for (let index = rateTiers.length - 1; index >= 0; index -= 1) {
        const value = pick(rateTiers[index]!);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    let perPieceCents = lastDefined((tier) => tier.perPieceCents) ?? matrixRow?.perPieceCents ?? rules.base.perPieceCents ?? 0;
    let perSquareFootCents = asNumber(lastDefined((tier) => tier.perSquareFootCents) ?? matrixRow?.perSquareFootCents ?? rules.base.perSquareFootCents);
    let minimumChargeCents = lastDefined((tier) => tier.minimumChargeCents) ?? rules.minimumChargeCents;
    const activeOverrides = (rules.baseRateOverrides ?? []).filter((rule) => selected(selections[rule.selectionKey], rule.whenValue));
    const applyOverrides = (target: "per_square_foot" | "per_piece" | "minimum_charge", initial: number): number => {
      const matching = activeOverrides.filter((rule) => rule.kind.endsWith(target));
      if (matching.length === 0) return initial;
      const setters = matching.filter((rule) => rule.kind === `set_${target}`);
      if (setters.length > 1) throw new Error(`Conflicting PBV2 pricing overrides: multiple active choices set ${target}.`);
      let value = setters[0]?.amountCents ?? initial;
      for (const rule of matching.filter((entry) => entry.kind === `add_${target}`)) value += rule.amountCents ?? 0;
      for (const rule of matching.filter((entry) => entry.kind === `multiply_${target}`)) value *= rule.factor ?? 1;
      // A V1 per-square-foot rate may legitimately retain fractional cents
      // until the final line calculation (for example 137.5¢/sq ft). Fixed
      // piece/minimum targets remain discrete cents when an override changes
      // them.
      return target === "per_square_foot" ? value : roundCents(value);
    };
    perSquareFootCents = applyOverrides("per_square_foot", perSquareFootCents);
    perPieceCents = applyOverrides("per_piece", perPieceCents);
    minimumChargeCents = minimumChargeCents == null ? undefined : applyOverrides("minimum_charge", minimumChargeCents);
    const baseRateDollars = perSquareFootCents / 100;
    const unitPriceDollars = perPieceCents / 100;
    const nestingFacts = request.nestingEstimate?.facts ?? {};
    // ProductVersion nesting evidence is authoritative when supplied. Legacy
    // formula-only products have no estimate, so retain their declared formula
    // variable rather than silently forcing rotation off.
    const resolvedAllowRotation = typeof nestingFacts.allowRotation === "boolean" ? nestingFacts.allowRotation : undefined;
    const billedSqft = typeof nestingFacts.billedSheetSqft === "number" ? nestingFacts.billedSheetSqft : typeof nestingFacts.billableSqft === "number" ? nestingFacts.billableSqft : 0;
    const formulaVariables = {
      ...numericFormulaVariables(rules.formula?.variables ?? {}),
      q: configuration.quantity,
      quantity: configuration.quantity,
      w: width,
      h: height,
      width,
      height,
      sqft: quantityOnly ? 0 : width * height / 144,
      total_sqft: totalSqft,
      totalSqft,
      computed_sheets: computedSheets ?? 0,
      billed_sqft: billedSqft,
      linear_feet: width / 12,
      linearFeet: width / 12,
      inches: width,
      base_price: baseRateDollars,
      basePrice: baseRateDollars,
      p: baseRateDollars,
      sheet_price: unitPriceDollars,
      unitPrice: unitPriceDollars,
    };

    if (quantityOnly && rules.formula) warnings.push({ code: "QUANTITY_ONLY_FORMULA_IGNORED", message: "Quantity-only pricing used its resolved per-piece rate and ignored a stale area/formula path." });
    const rawBaseCents = rules.formula && !quantityOnly
      ? evaluateResolvedFormula(rules.formula.expression, formulaVariables, resolvedAllowRotation) * 100
      : rules.base.flatFeeCents ?? (perPieceCents * configuration.quantity + perSquareFootCents * totalSqft);
    let runningCents = roundCents(rawBaseCents);
    const baseCentsForEffects = runningCents;
    const components: PricingComponent[] = [{ kind: "base", label: rules.formula && !quantityOnly ? "Formula base" : "Base", amount: money(sellableProduct.pricingCurrency, runningCents) }];
    const optionImpacts: PricingOptionImpact[] = [];

    for (const rule of rules.optionImpacts ?? []) {
      if (rule.whenValue !== undefined && !selected(selections[rule.selectionKey], rule.whenValue)) continue;
      const amount = rule.amount ?? 0;
      const optionsSubtotalCents = runningCents - baseCentsForEffects;
      const rawImpactCents = rule.kind === "fixed" ? amount
        : rule.kind === "per_unit" ? amount * configuration.quantity
        : rule.kind === "per_square_foot" ? amount * totalSqft
        : rule.kind === "per_linear_foot" ? amount * (width / 12) * configuration.quantity
        : rule.kind === "per_inch" ? amount * width * configuration.quantity
        : rule.kind === "percent" ? baseCentsForEffects * (Number(rule.percentBasisPoints ?? 0) / 10_000)
        : rule.kind === "percent_of_options_subtotal" ? optionsSubtotalCents * (Number(rule.percentBasisPoints ?? 0) / 10_000)
        : rule.kind === "percent_of_line_subtotal" ? runningCents * (Number(rule.percentBasisPoints ?? 0) / 10_000)
        : baseCentsForEffects * (amount - 1);
      const formulaImpactCents = rule.kind === "formula"
        ? evaluateLegacyOptionImpactFormula(rule.formula ?? "", formulaVariables, resolvedAllowRotation) * 100
        : undefined;
      const impactCents = roundCents(formulaImpactCents ?? rawImpactCents);
      runningCents += impactCents;
      const basisEvidence: Readonly<Record<string, JsonValue>> = rule.kind === "per_unit" ? { quantity: configuration.quantity }
        : rule.kind === "per_square_foot" ? { totalSqft: decimalText(String(totalSqft)) }
        : rule.kind === "percent" ? { baseLineCents: baseCentsForEffects, percentBasisPoints: Number(rule.percentBasisPoints ?? 0) }
        : rule.kind === "percent_of_options_subtotal" ? { optionsSubtotalCents, percentBasisPoints: Number(rule.percentBasisPoints ?? 0) }
        : rule.kind === "percent_of_line_subtotal" ? { lineSubtotalCents: runningCents - impactCents, percentBasisPoints: Number(rule.percentBasisPoints ?? 0) }
        : rule.kind === "per_linear_foot" ? { linearFeet: decimalText(String((width / 12) * configuration.quantity)) }
        : rule.kind === "per_inch" ? { inches: decimalText(String(width * configuration.quantity)) }
        : rule.kind === "formula" ? { formula: rule.formula ?? "" }
        : rule.kind === "multiplier" ? { baseLineCents: baseCentsForEffects, multiplier: amount }
        : {};
      optionImpacts.push({ selectionKey: rule.selectionKey, effectId: rule.id, kind: rule.kind, amount: money(sellableProduct.pricingCurrency, impactCents), ...(rule.percentBasisPoints == null ? {} : { percentBasisPoints: rule.percentBasisPoints }), basis: basisEvidence });
      components.push({ kind: "option", label: rule.id, amount: money(sellableProduct.pricingCurrency, impactCents) });
    }

    const effectiveMinimumChargeCents = minimumChargeCents;
    const beforeMinimumCents = runningCents;
    // Characterized V1 quantity-only pricing ignores stale geometry and a line minimum.
    if (!quantityOnly && effectiveMinimumChargeCents != null && runningCents < effectiveMinimumChargeCents) {
      runningCents = effectiveMinimumChargeCents;
      components.push({ kind: "minimum_charge", label: "Minimum charge", amount: money(sellableProduct.pricingCurrency, runningCents - beforeMinimumCents) });
    }
    const evidence = {
      schemaVersion: 1,
      configuration: {
        id: configuration.pricingConfigurationId,
        version: configuration.pricingConfigurationVersion,
        contentHash: configuration.pricingConfigurationContentHash,
      },
      normalizedInput: configuration,
      rules,
      nestingEstimate: request.nestingEstimate,
      calculationDimensions: dimensions ? { source: dimensions, widthIn: decimalText(String(width)), heightIn: decimalText(String(height)) } : undefined,
      evaluator: { id: "v2-pricing-parity", version: "1" },
      rounding: "v1-math-round-final-and-each-option-impact",
      calculatedLineCents: runningCents,
      warnings,
    };
    const result: PricingResult = {
      schemaVersion: 1,
      id: brandedId<"PricingResultId">(sha256({ kind: "pricing-result", evidence })),
      evidenceFingerprint: sha256({ kind: "pricing-evidence", evidence }),
      organizationId: request.organizationId,
      currency: sellableProduct.pricingCurrency,
      calculatedUnitAmount: money(sellableProduct.pricingCurrency, roundCents(runningCents / configuration.quantity)),
      calculatedLineAmount: money(sellableProduct.pricingCurrency, runningCents),
      unitAmountEvidence: { exactUnitCents: decimalText(String(runningCents / configuration.quantity)), allocation: "rounded_line_total_divided_by_quantity" },
      components,
      optionImpacts,
      minimumChargeApplied: runningCents !== beforeMinimumCents,
      ...((matrixTier ?? productTiers.at(-1) ?? legacyTier) ? { tier: (() => {
        const selectedTier = matrixTier ?? productTiers.at(-1) ?? legacyTier!;
        const source = matrixTier ? tierBasis : (familyTiers.filter((entry) => entry.tier === selectedTier).at(-1)?.basis ?? tierBasis);
        const selectedBasis = source === "quantity" ? configuration.quantity : source === "square_foot" ? totalSqft : computedSheets;
        return { source, basisValue: decimalText(String(selectedBasis)), selectedTierId: selectedTier.id, selectedRate: decimalText(String(selectedTier.perPieceCents ?? selectedTier.perSquareFootCents ?? 0)), fallbackApplied: false };
      })() } : {}),
      ...(matrixRow ? { matrix: { matrixId: rules.matrix!.id, rowId: matrixRow.id, selectedValueKeys: rules.matrix!.dimensions.map((key) => String(selections[key] ?? "")) } } : {}),
      ...(rules.formula && !quantityOnly ? { formula: { source: rules.formula.source, formulaId: rules.formula.id, version: rules.formula.version, contentHash: rules.formula.contentHash, resolvedExpression: rules.formula.expression, resolvedConfiguration: rules.formula.variables, variables: formulaVariables } } : {}),
      ...(request.nestingEstimate ? { nestingEstimate: request.nestingEstimate } : {}),
      ...(dimensions ? { calculationDimensions: { source: dimensions, widthIn: decimalText(String(width)), heightIn: decimalText(String(height)) } } : {}),
      evaluator: { id: "v2-pricing-parity", version: "1" },
      rounding: { policyId: "v1-math-round-final-and-impact", policyVersion: "1", stages: [{ stage: "base-formula-to-line", mode: "Math.round", precision: 2 }, { stage: "each-option-impact", mode: "Math.round", precision: 2 }, { stage: "line-total", mode: "integer-cents", precision: 2 }] },
      normalizedInput: configuration,
      warnings,
    };
    return assertPricingResultEvidence(result);
  }
}
