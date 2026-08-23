import assert from "node:assert/strict";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { estimatePricingSheetUsage } from "../../src/modules/pricing/pricingNestingEstimate.js";
import { resolveActivePbv2PricingInput } from "../../src/modules/products/pbv2CompatibilityResolution.js";
import { brandedId, currencyCode, decimalText, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { PricingCalculationRequest, PricingRules, ResolvedProductConfiguration } from "../../src/modules/pricing/contracts.js";
import type { SellableProductConfiguration } from "../../src/modules/products/contracts.js";

const organizationId = brandedId<"OrganizationId">("pricing-parity-pure-org") as OrganizationId;
const usd = currencyCode("USD");
const adapter = new V2PricingParityAdapter();

const request = (id: string, rules: PricingRules, input: Readonly<{ quantity?: number; width?: string; height?: string; selections?: Record<string, string | number | boolean>; nestingEstimate?: PricingCalculationRequest["nestingEstimate"] }> = {}): PricingCalculationRequest => {
  const productId = brandedId<"ProductId">(`product-${id}`);
  const configurationId = brandedId<"PricingConfigurationId">(`configuration-${id}`);
  const quantity = input.quantity ?? 1;
  const resolved: ResolvedProductConfiguration = {
    schemaVersion: 1, organizationId, productId, pricingConfigurationId: configurationId, pricingConfigurationVersion: "v1", pricingConfigurationContentHash: `hash-${id}`,
    quantity, ...(input.width && input.height ? { dimensions: { width: decimalText(input.width), height: decimalText(input.height), unit: "in" } } : {}),
    selections: input.selections ?? {}, derivedFacts: {}, productFacts: {},
  };
  return {
    organizationId,
    sellableProduct: { organizationId, productId, displayName: id, lifecycle: "active", pricingConfiguration: { id: configurationId, version: "v1", contentHash: `hash-${id}` }, requiresDimensions: Boolean(input.width), pricingCurrency: usd },
    resolvedConfiguration: resolved, pricingContext: { channel: "staff", effectiveAt: "2026-08-22T00:00:00.000Z" }, rules,
    ...(input.nestingEstimate ? { nestingEstimate: input.nestingEstimate } : {}),
  };
};

const sellable = (id: string): SellableProductConfiguration => ({
  organizationId, productId: brandedId<"ProductId">(id), displayName: id, lifecycle: "active",
  pricingConfiguration: { id: brandedId<"PricingConfigurationId">(`${id}-config`), version: "v1", contentHash: `${id}-hash` }, requiresDimensions: true, pricingCurrency: usd,
});

const activeTree = (meta: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  rootNodeIds: ["base-choice"],
  nodes: {
    "base-choice": { id: "base-choice", kind: "question", label: "Base choice", input: { type: "select", selectionKey: "base-choice", defaultValue: "default" }, choices: [{ value: "default", label: "Default" }] },
  },
  meta,
});

const run = async (): Promise<void> => {
  await assert.rejects(
    adapter.calculate(request("matrix-miss", { base: { perPieceCents: 500 }, matrix: { id: "matrix", dimensions: ["size"], rows: [{ id: "known", when: { size: "known" }, perPieceCents: 500 }] } }, { selections: { size: "unknown" } })),
    (error: unknown) => (error as { code?: string }).code === "PBV2_PRICING_MATRIX_ROW_NOT_FOUND",
  );
  const matrixMatch = await adapter.calculate(request("matrix-match", { base: { perPieceCents: 500 }, matrix: { id: "matrix", dimensions: ["size"], rows: [{ id: "known", when: { size: "known" }, perPieceCents: 450 }] } }, { selections: { size: "known" } }));
  assert.equal(matrixMatch.calculatedLineAmount.cents, 450);
  const matrixThreeDimensionMatch = await adapter.calculate(request("matrix-3d", { base: { perPieceCents: 500 }, matrix: { id: "matrix-3d", dimensions: ["thickness", "sides", "finish"], rows: [{ id: "4mm-single-gloss", when: { thickness: "4mm", sides: "single", finish: "gloss" }, perPieceCents: 333 }] } }, { selections: { thickness: "4mm", sides: "single", finish: "gloss" } }));
  assert.equal(matrixThreeDimensionMatch.calculatedLineAmount.cents, 333);

  const coroplastRules: PricingRules = {
    base: { perSquareFootCents: decimalText("137.5") }, tierBasis: "computed_sheet",
    tiers: [{ id: "sheet-1", minQuantity: 1, perSquareFootCents: decimalText("137.5") }, { id: "sheet-10", minQuantity: 10, perSquareFootCents: decimalText("103") }, { id: "sheet-51", minQuantity: 51, perSquareFootCents: decimalText("94") }],
    formula: { id: "sheet", source: "library", version: "v1", contentHash: "sheet", expression: "billed_sqft * base_price", variables: {} },
  };
  for (const [allowRotation, expectedCents] of [[false, 8800], [true, 4400]] as const) {
    const nestingEstimate = estimatePricingSheetUsage({ pieceWidthIn: 24, pieceHeightIn: 36, quantity: 5, sheetWidthIn: 48, sheetLengthIn: 96, usableDropMinimumIn: 0, billableLengthIncrementIn: 1, minimumBillableSqft: 32, allowRotation });
    const result = await adapter.calculate(request(`coroplast-24x36-${allowRotation}`, coroplastRules, { quantity: 5, width: "24", height: "36", nestingEstimate }));
    assert.equal(result.calculatedLineAmount.cents, expectedCents);
  }
  for (const [quantity, expectedCents] of [[8, 4400], [10, 4400], [91, 32960], [100, 32960], [101, 36256]] as const) {
    const nestingEstimate = estimatePricingSheetUsage({ pieceWidthIn: 24, pieceHeightIn: 18, quantity, sheetWidthIn: 48, sheetLengthIn: 96, usableDropMinimumIn: 0, billableLengthIncrementIn: 1, minimumBillableSqft: 32, allowRotation: false });
    const result = await adapter.calculate(request(`coroplast-24x18-${quantity}`, coroplastRules, { quantity, width: "24", height: "18", nestingEstimate }));
    assert.equal(result.calculatedLineAmount.cents, expectedCents);
  }

  const dualTiers = await adapter.calculate(request("dual-tiers", {
    base: { perSquareFootCents: decimalText("100") },
    tierFamilies: [
      { basis: "quantity", tiers: [{ id: "qty-10", minQuantity: 10, perSquareFootCents: decimalText("90") }] },
      { basis: "square_foot", tiers: [{ id: "sqft-6", minQuantity: 6, perSquareFootCents: decimalText("80") }] },
    ],
  }, { quantity: 10, width: "36", height: "24" }));
  assert.equal(dualTiers.calculatedLineAmount.cents, 4800, "the V1 square-foot family overrides its declared rate after quantity selection");

  const impacts = await adapter.calculate(request("impact-forms", {
    base: { perSquareFootCents: decimalText("100") },
    optionImpacts: [
      { id: "linear", selectionKey: "linear", whenValue: "yes", kind: "per_linear_foot", amount: 100 },
      { id: "inch", selectionKey: "inch", whenValue: "yes", kind: "per_inch", amount: 10 },
      { id: "formula", selectionKey: "formula", whenValue: "yes", kind: "formula", formula: "max(q, 3) * 1.25" },
      { id: "options-percent", selectionKey: "pct", whenValue: "yes", kind: "percent_of_options_subtotal", percentBasisPoints: 1000 as never },
      { id: "line-percent", selectionKey: "line", whenValue: "yes", kind: "percent_of_line_subtotal", percentBasisPoints: 1000 as never },
    ],
  }, { quantity: 2, width: "12", height: "12", selections: { linear: "yes", inch: "yes", formula: "yes", pct: "yes", line: "yes" } }));
  assert.equal(impacts.calculatedLineAmount.cents, 1207, "V1 linear/inch/formula/subtotal impact ordering is retained");

  const overrides = await adapter.calculate(request("override-targets", {
    base: { perPieceCents: 100, perSquareFootCents: decimalText("100"), }, minimumChargeCents: 300,
    baseRateOverrides: [
      { id: "piece", selectionKey: "piece", whenValue: "yes", kind: "set_per_piece", amountCents: 200 },
      { id: "area", selectionKey: "area", whenValue: "yes", kind: "multiply_per_square_foot", factor: 1.5 },
      { id: "minimum", selectionKey: "minimum", whenValue: "yes", kind: "set_minimum_charge", amountCents: 700 },
    ],
  }, { quantity: 1, width: "12", height: "12", selections: { piece: "yes", area: "yes", minimum: "yes" } }));
  assert.equal(overrides.calculatedLineAmount.cents, 700, "V1 choice overrides retain piece, area, and minimum-charge targets");

  for (const [expression, expectedCents] of [["1.004", 100], ["1.005", 101], ["1.006", 101]] as const) {
    const result = await adapter.calculate(request(`round-${expression}`, { base: {}, formula: { id: "round", source: "embedded", version: "v1", contentHash: expression, expression, variables: {} } }, { width: "1", height: "1" }));
    assert.equal(result.calculatedLineAmount.cents, expectedCents);
  }

  const legacyFormula = resolveActivePbv2PricingInput(sellable("legacy-formula"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z", treeJson: activeTree({ pricingV2: { base: { perSqftCents: 300 } } }), productMeasurementMode: "dimensions_required", productPricingProfileKey: "square_foot",
    legacyProductPricingFormula: "ceil((((w+.25)*(h+.25))*q)/144)*p", formula: null,
  }, { organizationId, productId: brandedId<"ProductId">("legacy-formula"), quantity: 1, dimensions: { width: decimalText("12"), height: decimalText("12"), unit: "in" } });
  assert.equal(legacyFormula.ok, true);
  if (legacyFormula.ok) {
    assert.equal(legacyFormula.value.rules.formula?.source, "legacy_product");
    const priced = await adapter.calculate(request("legacy-formula-pricing", legacyFormula.value.rules, { width: "12", height: "12" }));
    assert.equal(priced.calculatedLineAmount.cents, 600, "the V1 Stickers-style Product formula remains a compatibility source");
  }

  const libraryWins = resolveActivePbv2PricingInput(sellable("library-wins"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z", treeJson: activeTree({ pricingFormula: "2" }), productMeasurementMode: "dimensions_required", productPricingProfileKey: "square_foot",
    legacyProductPricingFormula: "3", formula: { id: "library", code: "library", profileKey: "square_foot", expression: "1", config: null, updatedAt: "2026-08-22T00:00:00.000Z" },
  }, { organizationId, productId: brandedId<"ProductId">("library-wins"), quantity: 1, dimensions: { width: decimalText("1"), height: decimalText("1"), unit: "in" } });
  assert.equal(libraryWins.ok, true);
  if (libraryWins.ok) assert.equal(libraryWins.value.rules.formula?.source, "library");

  // A shared Formula Library supplies its expression and defaults, never a
  // ProductVersion's commercial input values.  These two ProductVersions use
  // the same legacy expression but deliberately retain different sheet policy.
  const sheetExpression = "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price";
  const librarySheetDefaults = {
    sheet_width: 48,
    sheet_length: 96,
    usable_drop_min: 24,
    billable_length_increment: 12,
    minimum_billable_sqft: 3,
  };
  const productAInputs = {
    sheet_width: 48,
    sheet_length: 96,
    usable_drop_min: 0,
    billable_length_increment: 1,
    minimum_billable_sqft: 32,
  };
  const productBInputs = {
    sheet_width: 60,
    sheet_length: 120,
    usable_drop_min: 2,
    billable_length_increment: 6,
    minimum_billable_sqft: 20,
  };
  const librarySheetFormula = {
    id: "shared-sheet-formula", code: "SHEET", profileKey: "formula", expression: sheetExpression,
    config: { variables: librarySheetDefaults }, updatedAt: "2026-08-23T00:00:00.000Z",
  };
  const resolveSharedSheetFormula = (id: string, treeMeta: Record<string, unknown>, legacyProductPricingConfig?: Record<string, unknown>, formulaRevision?: any) =>
    resolveActivePbv2PricingInput(sellable(id), {
      id: `${id}-tree`, schemaVersion: 2, publishedAt: "2026-08-23T00:00:00.000Z",
      treeJson: activeTree(treeMeta), productMeasurementMode: "dimensions_required", productPricingProfileKey: "flat_goods",
      ...(legacyProductPricingConfig ? { legacyProductPricingConfig } : {}),
      ...(formulaRevision ? { formulaRevision } : {}), formula: librarySheetFormula,
    }, { organizationId, productId: brandedId<"ProductId">(id), quantity: 1, dimensions: { width: decimalText("24"), height: decimalText("18"), unit: "in" } });
  const productA = resolveSharedSheetFormula("product-a-inputs", { formulaVariables: productAInputs });
  const productB = resolveSharedSheetFormula("product-b-inputs", { pricingFormulaVariables: productBInputs });
  assert.equal(productA.ok, true);
  assert.equal(productB.ok, true);
  if (productA.ok) {
    assert.equal(productA.value.rules.formula?.source, "library");
    assert.deepEqual(productA.value.rules.formula?.variables, { ...productAInputs, allow_rotation: 0 }, "Product A's ProductVersion input values override shared Formula defaults");
  }
  if (productB.ok) assert.deepEqual(productB.value.rules.formula?.variables, { ...productBInputs, allow_rotation: 0 }, "Product B retains its own ProductVersion input values for the same shared Formula");

  const compatibilityFallback = resolveSharedSheetFormula("compatibility-input-fallback", {}, { formulaVariables: productBInputs });
  const libraryFallback = resolveSharedSheetFormula("library-input-fallback", {});
  assert.equal(compatibilityFallback.ok, true);
  assert.equal(libraryFallback.ok, true);
  if (compatibilityFallback.ok) assert.deepEqual(compatibilityFallback.value.rules.formula?.variables, { ...productBInputs, allow_rotation: 0 }, "an older ProductVersion without tree inputs retains the Product compatibility fallback");
  if (libraryFallback.ok) assert.deepEqual(libraryFallback.value.rules.formula?.variables, { ...librarySheetDefaults, allow_rotation: 0 }, "shared Formula defaults are used only when no ProductVersion or Product compatibility inputs exist");

  const declaredSheetInputs = Object.keys(productAInputs).map((key) => ({ key, label: key, type: "number" as const, required: true, minimum: 0, authorable: true }));
  const boundRevision = resolveSharedSheetFormula("bound-sheet-inputs", { formulaVariables: productBInputs }, { formulaVariables: librarySheetDefaults }, {
    id: "sheet-revision-1", formulaId: "sheet-formula-identity", revisionNumber: 1, expression: sheetExpression,
    declaredInputs: declaredSheetInputs, inputValues: productAInputs, createdAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(boundRevision.ok, true);
  if (boundRevision.ok) {
    assert.equal(boundRevision.value.rules.formula?.source, "formula_revision");
    assert.deepEqual(boundRevision.value.rules.formula?.variables, { ...productAInputs, allow_rotation: 0 }, "a FormulaRevision binding preserves its ProductVersion-owned input map after the shared Formula changes");
  }

  // Exercise the resolver and canonical adapter together: the shared library
  // still has conflicting defaults, but these ProductVersion-owned sheet
  // inputs preserve the established Coroplast-style commercial vectors.
  const coroplastStyleTree = (allowRotation: boolean) => activeTree({
    formulaVariables: productAInputs,
    pricingV2: {
      base: { perSqftCents: 137.5 },
      tierBasis: "computed_sheet_usage",
      allowRotation,
      qtyTiers: [
        { id: "sheet-1", minQty: 1, perSqftCents: 137.5 },
        { id: "sheet-10", minQty: 10, perSqftCents: 103 },
        { id: "sheet-51", minQty: 51, perSqftCents: 94 },
      ],
    },
  });
  const resolveCoroplastStyle = (id: string, width: string, height: string, quantity: number, allowRotation: boolean) =>
    resolveActivePbv2PricingInput(sellable(id), {
      id: `${id}-tree`, schemaVersion: 2, publishedAt: "2026-08-23T00:00:00.000Z",
      treeJson: coroplastStyleTree(allowRotation), productMeasurementMode: "dimensions_required", productPricingProfileKey: "flat_goods",
      formula: librarySheetFormula,
    }, { organizationId, productId: brandedId<"ProductId">(id), quantity, dimensions: { width: decimalText(width), height: decimalText(height), unit: "in" } });
  const priceResolvedFormula = async (resolved: ReturnType<typeof resolveCoroplastStyle>) => {
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error(resolved.error.publicMessage);
    return adapter.calculate({
      organizationId,
      sellableProduct: {
        ...resolved.value.sellableProduct,
        pricingConfiguration: {
          ...resolved.value.sellableProduct.pricingConfiguration,
          version: resolved.value.resolvedConfiguration.pricingConfigurationVersion,
          contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash,
        },
      },
      resolvedConfiguration: resolved.value.resolvedConfiguration,
      rules: resolved.value.rules,
      nestingEstimate: resolved.value.nestingEstimate,
      pricingContext: { channel: "staff", effectiveAt: "2026-08-23T00:00:00.000Z" },
    });
  };
  const rotationOff = resolveCoroplastStyle("coroplast-style-off", "24", "36", 5, false);
  const rotationOn = resolveCoroplastStyle("coroplast-style-on", "24", "36", 5, true);
  assert.equal(rotationOff.ok && rotationOff.value.nestingEstimate?.facts.effectiveRotation, false);
  assert.equal(rotationOn.ok && rotationOn.value.nestingEstimate?.facts.effectiveRotation, true);
  assert.equal((await priceResolvedFormula(rotationOff)).calculatedLineAmount.cents, 8800);
  assert.equal((await priceResolvedFormula(rotationOn)).calculatedLineAmount.cents, 4400);
  for (const [quantity, expectedCents] of [[8, 4400], [10, 4400], [91, 32960], [100, 32960], [101, 36256]] as const) {
    const resolved = resolveCoroplastStyle(`coroplast-style-default-${quantity}`, "24", "18", quantity, false);
    assert.equal(resolved.ok && resolved.value.nestingEstimate?.facts.effectiveRotation, false);
    assert.equal((await priceResolvedFormula(resolved)).calculatedLineAmount.cents, expectedCents);
  }

  const revisionWins = resolveActivePbv2PricingInput(sellable("revision-wins"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z", treeJson: activeTree({ pricingV2: { base: { perSqftCents: 300 } }, pricingFormula: "3" }), productMeasurementMode: "dimensions_required", productPricingProfileKey: "square_foot",
    formulaRevision: { id: "revision-1", formulaId: "identity-1", revisionNumber: 1, expression: "ceil((((w+.25)*(h+.25))*q)/144)*p", declaredInputs: [], inputValues: {}, createdAt: "2026-08-22T00:00:00.000Z" },
    legacyProductPricingFormula: "4", formula: { id: "legacy-library", code: "legacy", profileKey: "square_foot", expression: "5", config: null, updatedAt: "2026-08-22T00:00:00.000Z" },
  }, { organizationId, productId: brandedId<"ProductId">("revision-wins"), quantity: 1, dimensions: { width: decimalText("12"), height: decimalText("12"), unit: "in" } });
  assert.equal(revisionWins.ok, true);
  if (revisionWins.ok) {
    assert.equal(revisionWins.value.rules.formula?.source, "formula_revision", "an immutable ProductVersion FormulaRevision wins over mutable/legacy sources");
    const priced = await adapter.calculate(request("revision-wins", revisionWins.value.rules, { width: "12", height: "12" }));
    assert.equal(priced.calculatedLineAmount.cents, 600, "revision binding preserves the established Formula result");
  }

  const fee = resolveActivePbv2PricingInput(sellable("fee"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z", treeJson: activeTree(), productMeasurementMode: "quantity_only", productPricingProfileKey: "fee",
    legacyProductPricingConfig: { formulaVariables: { flatFee: 74.99 } }, formula: null,
  }, { organizationId, productId: brandedId<"ProductId">("fee"), quantity: 3 });
  assert.equal(fee.ok, true);
  if (fee.ok) {
    const priced = await adapter.calculate(request("fee-flat", fee.value.rules, { quantity: 3 }));
    assert.equal(priced.calculatedLineAmount.cents, 7499);
  }
  const workflowFee = resolveActivePbv2PricingInput(sellable("workflow-fee"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z",
    treeJson: activeTree({ general: { workflowIntent: "service_fee" }, pricingFormulaVariables: { flatFee: 74.99 } }),
    productMeasurementMode: "quantity_only", productPricingProfileKey: "default", formula: null,
  }, { organizationId, productId: brandedId<"ProductId">("workflow-fee"), quantity: 3 });
  assert.equal(workflowFee.ok, true);
  if (workflowFee.ok) {
    const priced = await adapter.calculate(request("workflow-fee-flat", workflowFee.value.rules, { quantity: 3 }));
    assert.equal(priced.calculatedLineAmount.cents, 7499, "service_fee workflow intent uses the ProductVersion flat fee exactly once per line");
  }
  const invalidFee = resolveActivePbv2PricingInput(sellable("bad-fee"), {
    id: "tree", schemaVersion: 2, publishedAt: "2026-08-22T00:00:00.000Z", treeJson: activeTree(), productMeasurementMode: "quantity_only", productPricingProfileKey: "fee", formula: null,
  }, { organizationId, productId: brandedId<"ProductId">("bad-fee"), quantity: 3 });
  assert.equal(invalidFee.ok, false);
};

void run().then(() => console.log("V1/V2 pricing parity correction pure tests passed."));
