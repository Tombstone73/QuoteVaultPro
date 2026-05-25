/**
 * Regression tests for PBV2 formula scope building.
 *
 * Verifies that:
 * 1. resolveProductOptionPricingMatrix correctly resolves base_price for all 2×2 combos.
 * 2. buildFormulaEvaluationScope merges matrix variables into the scope with correct
 *    precedence and keeps base_price aliases (p, basePricePerSqft, …) in sync.
 * 3. The stale-rate bug (combo 4 showing $7.00 instead of $8.75) is fixed.
 */

import { describe, expect, test } from "@jest/globals";
import { resolveProductOptionPricingMatrix, type ProductOptionPricingMatrix } from "../productOptionPricingMatrix";
import { buildFormulaScope, buildFormulaEvaluationScope } from "../pbv2/formulaScope";

// ---------------------------------------------------------------------------
// 2×2 test matrix matching the bug report scenario.
// Values stored as plain decimals (not cents-as-integers) so resolveMatrixVariableValue
// returns them unchanged.
// ---------------------------------------------------------------------------

const ACME_MATRIX: ProductOptionPricingMatrix = {
  dimensions: ["thickness", "sides"],
  rows: [
    { id: "3mm_single", when: { thickness: "3mm", sides: "single" }, variables: { base_price: 5 } },
    { id: "3mm_double", when: { thickness: "3mm", sides: "double" }, variables: { base_price: 5.75 } },
    { id: "6mm_single", when: { thickness: "6mm", sides: "single" }, variables: { base_price: 7 } },
    { id: "6mm_double", when: { thickness: "6mm", sides: "double" }, variables: { base_price: 8.75 } },
  ],
};

// ---------------------------------------------------------------------------
// 1. Matrix resolution — all 4 combinations must resolve the correct base_price
// ---------------------------------------------------------------------------

describe("resolveProductOptionPricingMatrix — 2×2 matrix", () => {
  test.each([
    ["3mm", "single", "3mm_single", 5],
    ["3mm", "double", "3mm_double", 5.75],
    ["6mm", "single", "6mm_single", 7],
    ["6mm", "double", "6mm_double", 8.75],
  ])(
    "%s + %s resolves matchedRow.id=%s and base_price=%s",
    (thickness, sides, expectedRowId, expectedBasePrice) => {
      const result = resolveProductOptionPricingMatrix({
        pricingMatrix: ACME_MATRIX,
        selections: {
          thickness: { value: thickness },
          sides: { value: sides },
        },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.matchedRow?.id).toBe(expectedRowId);
      expect(result.variables.base_price).toBe(expectedBasePrice);
    }
  );

  test("high-precision cents storage resolves fractional-cent rates", () => {
    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: {
        dimensions: ["rate"],
        rows: [
          { id: "precise", when: { rate: "precise" }, variables: { base_price: 137.5 } },
        ],
      },
      selections: { rate: { value: "precise" } },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.variables.base_price).toBe(1.375);
  });
});

// ---------------------------------------------------------------------------
// 2. Formula scope — matrix variables override base_price and all aliases must sync
// ---------------------------------------------------------------------------

describe("buildFormulaEvaluationScope — base_price alias sync", () => {
  // A typical tiered-rate fallback — 7.00/sqft from meta.pricingV2.
  const TIERED_BASE_RATE = 7;

  function makeScope(matrixVars: Record<string, number>) {
    const scope = buildFormulaScope({
      formula: "ceil(total_sqft) * base_price",
      orderedWidthIn: 24,
      orderedHeightIn: 36,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 24,
      finishedHeightIn: 36,
      quantity: 1,
      baseRatePerSqft: TIERED_BASE_RATE,
      sqftPerItem: 6,
      totalSqft: 6,
      linearFeet: 0,
    });
    return buildFormulaEvaluationScope({ scope, pricingMatrixVariables: matrixVars });
  }

  test("without matrix override — base_price and p equal the tiered rate", () => {
    const scope = makeScope({});
    expect(scope.base_price).toBe(TIERED_BASE_RATE);
    expect(scope.p).toBe(TIERED_BASE_RATE);
    expect(scope.basePricePerSqft).toBe(TIERED_BASE_RATE);
  });

  test.each([
    ["3mm + single", { base_price: 5 }, 5],
    ["3mm + double", { base_price: 5.75 }, 5.75],
    ["6mm + single", { base_price: 7 }, 7],
    ["6mm + double", { base_price: 8.75 }, 8.75],
  ])(
    "%s — scope.base_price and scope.p both equal %s after matrix override",
    (_label, matrixVars, expectedRate) => {
      const scope = makeScope(matrixVars);

      expect(scope.base_price).toBe(expectedRate);
      // Regression: p must not retain the stale tiered rate after matrix overrides base_price.
      expect(scope.p).toBe(expectedRate);
      expect(scope.basePricePerSqft).toBe(expectedRate);
      expect(scope.pricePerSqft).toBe(expectedRate);
      expect(scope.price).toBe(expectedRate);
      expect(scope.unitPrice).toBe(expectedRate);
    }
  );

  test("matrix cannot override protected geometry variables (q, sqft, total_sqft)", () => {
    const scope = makeScope({ base_price: 9, q: 999, sqft: 999, total_sqft: 999 });
    expect(scope.base_price).toBe(9);
    // Protected keys must not be overwritten by matrix vars.
    expect(scope.q).toBe(1);
    expect(scope.sqft).toBe(6);
    expect(scope.total_sqft).toBe(6);
  });

  test("formula variables cannot override base_price (protected)", () => {
    const scope = buildFormulaScope({
      formula: "base_price * total_sqft",
      orderedWidthIn: 24,
      orderedHeightIn: 36,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 24,
      finishedHeightIn: 36,
      quantity: 1,
      baseRatePerSqft: TIERED_BASE_RATE,
      sqftPerItem: 6,
      totalSqft: 6,
      linearFeet: 0,
    });
    const evalScope = buildFormulaEvaluationScope({
      scope,
      formulaVariables: { base_price: 999, custom_var: 42 },
      pricingMatrixVariables: { base_price: 8.75 },
    });
    // formulaVariables cannot override base_price (protected), matrix can.
    expect(evalScope.base_price).toBe(8.75);
    expect(evalScope.custom_var).toBe(42);
  });

  test("matrix variables cannot shadow protected tier variables", () => {
    const scope = buildFormulaScope({
      formula: "tier_base_price + original_base_price + effective_base_price",
      orderedWidthIn: 24,
      orderedHeightIn: 36,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 24,
      finishedHeightIn: 36,
      quantity: 1,
      baseRatePerSqft: 4.5,
      originalBaseRate: 1,
      tierBaseRate: 4.5,
      effectiveBaseRate: 4.5,
      sqftPerItem: 6,
      totalSqft: 6,
      linearFeet: 0,
    });
    const evalScope = buildFormulaEvaluationScope({
      scope,
      pricingMatrixVariables: {
        base_price: 4.5,
        tier_base_price: 999,
        tier_rate: 999,
        original_base_price: 999,
        effective_base_price: 999,
      },
    });

    expect(evalScope.base_price).toBe(4.5);
    expect(evalScope.tier_base_price).toBe(4.5);
    expect(evalScope.tier_rate).toBe(4.5);
    expect(evalScope.original_base_price).toBe(1);
    expect(evalScope.effective_base_price).toBe(4.5);
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end: resolved scope produces correct formula result for all 4 combos
// ---------------------------------------------------------------------------

describe("formula result — ceil(total_sqft) * base_price for 24×36 (6 sqft)", () => {
  // total_sqft = 6, ceil(6) = 6.
  // Expected totals: 6 * base_price.
  test.each([
    ["3mm + single", 5, 30],
    ["3mm + double", 5.75, 34.5],
    ["6mm + single", 7, 42],
    ["6mm + double", 8.75, 52.5],
  ])("%s: base_price=%s → formula result=%s", (_label, matrixBasePrice, expectedResult) => {
    const scope = buildFormulaScope({
      formula: "ceil(total_sqft) * base_price",
      orderedWidthIn: 24,
      orderedHeightIn: 36,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 24,
      finishedHeightIn: 36,
      quantity: 1,
      baseRatePerSqft: 7, // tiered fallback (would be stale for combos 1,2,4)
      sqftPerItem: 6,
      totalSqft: 6,
      linearFeet: 0,
    });
    const evalScope = buildFormulaEvaluationScope({
      scope,
      pricingMatrixVariables: { base_price: matrixBasePrice },
    });

    // Verify the scope carries the right base_price (and p alias).
    expect(evalScope.base_price).toBe(matrixBasePrice);
    expect(evalScope.p).toBe(matrixBasePrice);

    // Manually compute what mathjs would compute: ceil(6) * base_price.
    const result = Math.ceil(Number(evalScope.total_sqft)) * Number(evalScope.base_price);
    expect(result).toBe(expectedResult);
  });

  test("6mm + double: resolvedBaseRate = 8.75, not the stale tiered 7.00 (bug regression)", () => {
    const scope = buildFormulaScope({
      formula: "ceil(total_sqft) * base_price",
      orderedWidthIn: 24,
      orderedHeightIn: 36,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 24,
      finishedHeightIn: 36,
      quantity: 1,
      baseRatePerSqft: 7, // tiered fallback — the previously stale rate
      sqftPerItem: 6,
      totalSqft: 6,
      linearFeet: 0,
    });
    const evalScope = buildFormulaEvaluationScope({
      scope,
      pricingMatrixVariables: { base_price: 8.75 },
    });

    const resolvedBaseRate =
      typeof evalScope.base_price === "number" ? evalScope.base_price : 7;

    expect(resolvedBaseRate).toBe(8.75); // was 7.00 before the fix
    expect(resolvedBaseRate).not.toBe(7);

    const formulaResult = Math.ceil(Number(evalScope.total_sqft)) * Number(evalScope.base_price);
    expect(formulaResult).toBe(52.5); // ceil(6) * 8.75
  });
});
