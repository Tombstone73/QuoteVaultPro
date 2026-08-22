import { describe, expect, test } from "@jest/globals";
import { evaluateResolvedFormula, V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { estimatePricingSheetUsage } from "../../src/modules/pricing/pricingNestingEstimate";
import type { PricingCalculationRequest, PricingRules, ResolvedProductConfiguration } from "../../src/modules/pricing/contracts";
import { brandedId, currencyCode, decimalText, percentageBasisPoints, type OrganizationId } from "../../src/modules/shared/commercialValues";

const adapter = new V2PricingParityAdapter();
const usd = currencyCode("USD");
const org = brandedId<"OrganizationId">("pricing-fixture-org");

const requestFor = (input: Readonly<{
  id: string;
  quantity: number;
  rules: PricingRules;
  width?: string;
  height?: string;
  dimensionUnit?: "in" | "ft" | "mm";
  requiresDimensions?: boolean;
  selections?: Record<string, string | boolean | number>;
  facts?: Record<string, string | boolean>;
  nestingEstimate?: PricingCalculationRequest["nestingEstimate"];
}>): PricingCalculationRequest => {
  const productId = brandedId<"ProductId">(`product-${input.id}`);
  const configurationId = brandedId<"PricingConfigurationId">(`config-${input.id}`);
  const resolved: ResolvedProductConfiguration = {
    schemaVersion: 1, organizationId: org, productId, pricingConfigurationId: configurationId,
    pricingConfigurationVersion: "characterized-v1", pricingConfigurationContentHash: `content-${input.id}`,
    quantity: input.quantity,
    ...(input.width && input.height ? { dimensions: { width: decimalText(input.width), height: decimalText(input.height), unit: input.dimensionUnit ?? "in" } } : {}),
    selections: input.selections ?? {}, derivedFacts: {}, productFacts: input.facts ?? {},
  };
  return {
    organizationId: org,
    sellableProduct: { organizationId: org, productId, displayName: input.id, lifecycle: "active", pricingConfiguration: { id: configurationId, version: "characterized-v1", contentHash: `content-${input.id}` }, requiresDimensions: input.requiresDimensions ?? Boolean(input.width), pricingCurrency: usd },
    resolvedConfiguration: resolved, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" }, rules: input.rules,
    ...(input.nestingEstimate ? { nestingEstimate: input.nestingEstimate } : {}),
  };
};

describe("M1.2 Pricing parity adapter", () => {
  test.each([
    [8, 4400, 1, "tier-1"], [10, 4400, 1, "tier-1"], [91, 32960, 10, "tier-10"], [100, 32960, 10, "tier-10"], [101, 36256, 11, "tier-10"],
  ])("Coroplast 24x18 q%s retains V1 sheet-tier vector", async (quantity, expectedCents, expectedSheets, tierId) => {
    const nestingEstimate = estimatePricingSheetUsage({ pieceWidthIn: 24, pieceHeightIn: 18, quantity, sheetWidthIn: 48, sheetLengthIn: 96, usableDropMinimumIn: 0, billableLengthIncrementIn: 1, minimumBillableSqft: 32 });
    const result = await adapter.calculate(requestFor({ id: `coroplast-${quantity}`, quantity, width: "24", height: "18", nestingEstimate, rules: {
      base: { perSquareFootCents: decimalText("137.5") }, tierBasis: "computed_sheet",
      tiers: [{ id: "tier-1", minQuantity: 1, perSquareFootCents: decimalText("137.5") }, { id: "tier-10", minQuantity: 10, perSquareFootCents: decimalText("103") }, { id: "tier-51", minQuantity: 51, perSquareFootCents: decimalText("94") }],
      formula: { id: "sheet-consumption", source: "library", version: "coroplast-v1", contentHash: "sha256:coroplast-v1", expression: "billed_sqft * base_price", variables: { formulaLibraryVersion: "coroplast-v1" } },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(expectedCents);
    expect(result.tier?.selectedTierId).toBe(tierId);
    expect(result.nestingEstimate?.facts.totalSheetCount).toBe(expectedSheets);
    expect(result.formula?.resolvedExpression).toBe("billed_sqft * base_price");
  });

  test("Banner per-square-foot base and flat production option preserve characterized totals", async () => {
    const result = await adapter.calculate(requestFor({ id: "banner", quantity: 1, width: "36", height: "42", selections: { polePocket: "yes" }, rules: {
      base: { perSquareFootCents: decimalText("125") },
      optionImpacts: [{ id: "pole-pocket-3in", selectionKey: "polePocket", whenValue: "yes", kind: "fixed", amount: 600 }],
    } }));
    expect(result.components.map((component) => component.amount.cents)).toEqual([1313, 600]);
    expect(result.calculatedLineAmount.cents).toBe(1913);
  });

  test("declared feet and millimeters normalize to inches without changing area pricing", async () => {
    const rules: PricingRules = { base: { perSquareFootCents: decimalText("100") } };
    const feet = await adapter.calculate(requestFor({ id: "feet", quantity: 1, width: "2", height: "3", dimensionUnit: "ft", rules }));
    const millimeters = await adapter.calculate(requestFor({ id: "millimeters", quantity: 1, width: "609.6", height: "914.4", dimensionUnit: "mm", rules }));
    expect(feet.calculatedLineAmount.cents).toBe(600);
    expect(millimeters.calculatedLineAmount.cents).toBe(600);
    expect(feet.calculationDimensions?.widthIn).toBe(decimalText("24"));
    expect(millimeters.calculationDimensions?.heightIn).toBe(decimalText("36"));
  });

  test("millimeter conversion remains on an exact square-foot tier boundary", async () => {
    const result = await adapter.calculate(requestFor({ id: "millimeter-tier", quantity: 1, width: "609.6", height: "914.4", dimensionUnit: "mm", rules: {
      base: { perSquareFootCents: decimalText("100") }, tierBasis: "square_foot", tiers: [{ id: "six-sqft", minQuantity: 6, perSquareFootCents: decimalText("200") }],
    } }));
    expect(result.tier?.selectedTierId).toBe("six-sqft");
    expect(result.calculatedLineAmount.cents).toBe(1200);
  });

  test("Contour sticker pricing consumes only supplied pricing nesting evidence", async () => {
    const result = await adapter.calculate(requestFor({ id: "contour-sticker", quantity: 100, width: "4", height: "4", nestingEstimate: { estimateId: "v1-roll-layout", calculatorVersion: "v1-roll-layout", facts: { billableSqft: 16, actualConsumedLinearFeet: 3.875 } }, rules: {
      base: { perSquareFootCents: decimalText("100") }, formula: { id: "roll-nesting", source: "embedded", version: "v1", contentHash: "sha256:roll-v1", expression: "billed_sqft * base_price", variables: {} },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(1600);
    expect(result.nestingEstimate?.facts.actualConsumedLinearFeet).toBe(3.875);
  });

  test("Coroplast rotation changes supplied sheet evidence and therefore price", async () => {
    const withoutRotation = estimatePricingSheetUsage({ pieceWidthIn: 24, pieceHeightIn: 36, quantity: 5, sheetWidthIn: 48, sheetLengthIn: 96, usableDropMinimumIn: 0, billableLengthIncrementIn: 1, minimumBillableSqft: 32, allowRotation: false });
    const withRotation = estimatePricingSheetUsage({ pieceWidthIn: 24, pieceHeightIn: 36, quantity: 5, sheetWidthIn: 48, sheetLengthIn: 96, usableDropMinimumIn: 0, billableLengthIncrementIn: 1, minimumBillableSqft: 32, allowRotation: true });
    expect(withoutRotation.facts.totalSheetCount).toBe(2);
    expect(withRotation.facts.totalSheetCount).toBe(1);
    const rules: PricingRules = { base: { perSquareFootCents: decimalText("137.5") }, formula: { id: "sheet", source: "library", version: "v1", contentHash: "sha256:sheet", expression: "billed_sqft * base_price", variables: {} } };
    expect((await adapter.calculate(requestFor({ id: "rotation-off", quantity: 5, width: "24", height: "36", nestingEstimate: withoutRotation, rules }))).calculatedLineAmount.cents).toBe(8800);
    expect((await adapter.calculate(requestFor({ id: "rotation-on", quantity: 5, width: "24", height: "36", nestingEstimate: withRotation, rules }))).calculatedLineAmount.cents).toBe(4400);
  });

  test("quantity-only ignores stale geometry, formula, and line minimum", async () => {
    const result = await adapter.calculate(requestFor({ id: "quantity-only", quantity: 6, width: "24", height: "36", facts: { pricingProfileKey: "qty_only" }, rules: {
      base: { perPieceCents: 100, perSquareFootCents: decimalText("999") }, minimumChargeCents: 99999,
      formula: { id: "stale-library-formula", source: "library", version: "v1", contentHash: "sha256:stale-v1", expression: "total_sqft * base_price", variables: {} },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(600);
    expect(result.formula).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("QUANTITY_ONLY_FORMULA_IGNORED");
  });

  test("matrix selection uses stable choice values and its quantity tier", async () => {
    const rules: PricingRules = {
      base: { perPieceCents: 999 }, tierBasis: "quantity",
      matrix: { id: "coroplast-matrix", dimensions: ["thickness", "sides"], rows: [
        { id: "4mm-single", when: { thickness: "4mm", sides: "choice_single" }, perPieceCents: 440, tiers: [{ id: "matrix-101", minQuantity: 101, perPieceCents: 330 }] },
      ] },
    };
    const q100 = await adapter.calculate(requestFor({ id: "matrix-100", quantity: 100, selections: { thickness: "4mm", sides: "choice_single" }, rules }));
    const q101 = await adapter.calculate(requestFor({ id: "matrix-101", quantity: 101, selections: { thickness: "4mm", sides: "choice_single" }, rules }));
    expect(q100.calculatedLineAmount.cents).toBe(44000);
    expect(q101.calculatedLineAmount.cents).toBe(33330);
    expect(q101.matrix?.rowId).toBe("4mm-single");
    expect(q101.tier?.selectedTierId).toBe("matrix-101");
  });

  test("a matrix-row computed-sheet tier basis overrides the product quantity basis", async () => {
    const result = await adapter.calculate(requestFor({ id: "matrix-row-sheet-basis", quantity: 100, selections: { material: "sheet" }, nestingEstimate: { estimateId: "one-sheet", calculatorVersion: "v1", facts: { totalSheetCount: 1 } }, rules: {
      base: { perPieceCents: 999 }, tierBasis: "quantity", tiers: [{ id: "product-quantity-tier", minQuantity: 100, perPieceCents: 100 }],
      matrix: { id: "matrix", dimensions: ["material"], rows: [{ id: "sheet-row", when: { material: "sheet" }, tierBasis: "computed_sheet", tiers: [{ id: "row-sheet-tier", minQuantity: 1, perPieceCents: 300 }] }] },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(30000);
    expect(result.tier).toMatchObject({ source: "computed_sheet", selectedTierId: "row-sheet-tier", basisValue: decimalText("1") });
  });

  test("fixed effective dimensions must arrive in resolved configuration; missing geometry is rejected", async () => {
    const fixed = await adapter.calculate(requestFor({ id: "fixed-matrix", quantity: 1, width: "24", height: "18", requiresDimensions: false, selections: { thickness: "4mm" }, rules: {
      base: { perSquareFootCents: decimalText("100") }, matrix: { id: "fixed", dimensions: ["thickness"], rows: [{ id: "4mm", when: { thickness: "4mm" }, perSquareFootCents: decimalText("200") }] },
    } }));
    expect(fixed.calculatedLineAmount.cents).toBe(600);
    await expect(adapter.calculate(requestFor({ id: "missing-fixed-effective-dimensions", quantity: 1, requiresDimensions: false, rules: { base: { perSquareFootCents: decimalText("100") } } }))).rejects.toThrow(/effective dimensions/i);
  });

  test("area options and square-foot tier selection cannot silently price without effective dimensions", async () => {
    await expect(adapter.calculate(requestFor({ id: "missing-area-option-dimensions", quantity: 1, requiresDimensions: false, selections: { lamination: true }, rules: {
      base: { flatFeeCents: 100 }, optionImpacts: [{ id: "area", selectionKey: "lamination", whenValue: true, kind: "per_square_foot", amount: 50 }],
    } }))).rejects.toThrow(/effective dimensions/i);
    await expect(adapter.calculate(requestFor({ id: "missing-square-foot-tier-dimensions", quantity: 1, requiresDimensions: false, rules: {
      base: { perPieceCents: 100 }, tierBasis: "square_foot", tiers: [{ id: "area-tier", minQuantity: 1, perPieceCents: 50 }],
    } }))).rejects.toThrow(/effective dimensions/i);
  });

  test("formula result remains dollar-valued until its final cents conversion", async () => {
    const result = await adapter.calculate(requestFor({ id: "formula", quantity: 1, width: "24", height: "36", rules: {
      base: { perSquareFootCents: decimalText("100") },
      formula: { id: "ceil-formula", source: "library", version: "v1", contentHash: "sha256:ceil-v1", expression: "ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price", variables: { formulaLibraryVersion: "v1" } },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(700);
    expect(result.formula?.variables.base_price).toBe(1);
  });

  test("percent impacts are additive against calculated base and retain impact evidence", async () => {
    const result = await adapter.calculate(requestFor({ id: "options", quantity: 1, rules: {
      base: { flatFeeCents: 10000 }, optionImpacts: [
        { id: "contour", selectionKey: "contour", whenValue: true, kind: "percent", percentBasisPoints: percentageBasisPoints(1000) },
        { id: "weed-tape", selectionKey: "weed", whenValue: true, kind: "percent", percentBasisPoints: percentageBasisPoints(2500) },
      ],
    }, selections: { contour: true, weed: true } }));
    expect(result.calculatedLineAmount.cents).toBe(13500);
    expect(result.optionImpacts.map((impact) => impact.amount.cents)).toEqual([1000, 2500]);
    expect(result.optionImpacts[1]?.basis?.baseLineCents).toBe(10000);
  });

  test("flat, per-unit, area, percent, and multiplier impacts retain discrete cent evidence", async () => {
    const result = await adapter.calculate(requestFor({ id: "impact-kinds", quantity: 3, width: "12", height: "12", selections: { enabled: true }, rules: {
      base: { flatFeeCents: 100 }, optionImpacts: [
        { id: "flat", selectionKey: "enabled", whenValue: true, kind: "fixed", amount: 50 },
        { id: "per-unit", selectionKey: "enabled", whenValue: true, kind: "per_unit", amount: 10 },
        { id: "area", selectionKey: "enabled", whenValue: true, kind: "per_square_foot", amount: 20 },
        { id: "percentage", selectionKey: "enabled", whenValue: true, kind: "percent", percentBasisPoints: percentageBasisPoints(1000) },
        { id: "multiplier", selectionKey: "enabled", whenValue: true, kind: "multiplier", amount: 1.25 },
      ],
    } }));
    expect(result.optionImpacts.map((impact) => impact.amount.cents)).toEqual([50, 30, 60, 10, 25]);
    expect(result.calculatedLineAmount.cents).toBe(275);
  });

  test("minimum applies once at line level and fractional cents round at the recorded boundary", async () => {
    const minimum = await adapter.calculate(requestFor({ id: "minimum", quantity: 1, width: "12", height: "12", rules: { base: { perSquareFootCents: decimalText("400") }, minimumChargeCents: 444 } }));
    const fractional = await adapter.calculate(requestFor({ id: "fractional", quantity: 1, width: "48", height: "96", rules: { base: { perSquareFootCents: decimalText("133.33") } } }));
    expect(minimum.calculatedLineAmount.cents).toBe(444);
    expect(minimum.minimumChargeApplied).toBe(true);
    expect(fractional.calculatedLineAmount.cents).toBe(4267);
  });

  test("computed-sheet tiers never fall back to raw quantity when the estimate is absent", async () => {
    const result = await adapter.calculate(requestFor({ id: "missing-sheet", quantity: 101, width: "24", height: "18", rules: {
      base: { perSquareFootCents: decimalText("137.5") }, tierBasis: "computed_sheet", tiers: [{ id: "wrong-if-quantity", minQuantity: 100, perSquareFootCents: decimalText("1") }],
    } }));
    expect(result.tier).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("COMPUTED_SHEET_USAGE_UNAVAILABLE");
  });

  test("unmatched matrix fails closed instead of pricing from the scalar base", async () => {
    await expect(adapter.calculate(requestFor({ id: "matrix-fallback", quantity: 1, width: "12", height: "12", selections: { thickness: "unknown" }, rules: {
      base: { perSquareFootCents: decimalText("500") }, matrix: { id: "matrix", dimensions: ["thickness"], rows: [{ id: "known", when: { thickness: "known" }, perSquareFootCents: decimalText("450") }] },
    } }))).rejects.toMatchObject({ code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND" });
  });

  test("a matrix with a missing required dimension fails closed", async () => {
    await expect(adapter.calculate(requestFor({ id: "matrix-missing-dimension", quantity: 1, rules: {
      base: { perPieceCents: 500 }, matrix: { id: "matrix", dimensions: ["thickness", "sides"], rows: [{ id: "known", when: { thickness: "4mm", sides: "single" }, perPieceCents: 450 }] },
      }, selections: { thickness: "4mm" } }))).rejects.toMatchObject({ code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND" });
  });

  test("V1 roll nesting formula uses the shared roll layout helper", async () => {
    const result = await adapter.calculate(requestFor({ id: "roll-nesting", quantity: 100, width: "4", height: "4", rules: {
      base: { perSquareFootCents: decimalText("100") },
      formula: {
        id: "roll-nesting", source: "embedded", version: "v1", contentHash: "sha256:roll-v1",
        expression: "roll_nesting_billable_sqft(w,h,q,printable_width,piece_allowance_x,piece_allowance_y,billing_width_increment,billing_length_increment) * base_price",
        variables: { printable_width: 50, piece_allowance_x: 0.25, piece_allowance_y: 0.25, billing_width_increment: 12, billing_length_increment: 12, allow_rotation: 0 },
      },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(1600);
    expect(result.formula?.variables).toMatchObject({ printable_width: 50, piece_allowance_x: 0.25, billing_width_increment: 12 });
  });

  test("formula dollars use V1 epsilon-safe final-cent rounding", async () => {
    expect(evaluateResolvedFormula("1.005", {})).toBe(1.005);
    const result = await adapter.calculate(requestFor({ id: "half-cent", quantity: 1, width: "1", height: "1", rules: {
      base: {}, formula: { id: "half-cent", source: "embedded", version: "v1", contentHash: "sha256:half-cent", expression: "1.005", variables: {} },
    } }));
    expect(result.calculatedLineAmount.cents).toBe(101);
  });

  test("evidence fingerprint is stable for identical input and changes with meaningful rules", async () => {
    const request = requestFor({ id: "fingerprint", quantity: 2, rules: { base: { perPieceCents: 275 } } });
    const first = await adapter.calculate(request);
    const replay = await adapter.calculate(request);
    const changed = await adapter.calculate({ ...request, rules: { base: { perPieceCents: 300 } } });
    expect(first.evidenceFingerprint).toBe(replay.evidenceFingerprint);
    expect(first.evidenceFingerprint).not.toBe(changed.evidenceFingerprint);
    expect(first.evidenceFingerprint).toMatch(/^sha256:/);
  });
});
