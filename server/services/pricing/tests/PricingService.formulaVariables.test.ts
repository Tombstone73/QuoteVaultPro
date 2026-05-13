/**
 * Tests for formula-scoped variables injected via formulaVariables.
 *
 * Verifies: variables are accessible in the formula, missing variables fail
 * clearly, existing formulas without variables continue to work, and
 * built-in scope variables (w, h, q, base_price) cannot be shadowed by
 * formula variables.
 */

import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree } from "../PricingService";

function makeTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["root"],
    nodes: {
      root: {
        id: "root",
        kind: "question" as const,
        label: "Root",
        input: { type: "boolean" as const },
      },
    },
    meta: {
      pricingV2: { base: { perSqftCents: 100 } },
    },
  };
}

function runFormula(
  formula: string,
  w = 24,
  h = 36,
  q = 1,
  formulaVariables?: Record<string, number>,
) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeTree(),
    widthIn: w,
    heightIn: h,
    quantity: q,
    pricingFormulaOverride: formula,
    formulaVariables,
    debug: true,
  });
}

function runFormulaExpectError(
  formula: string,
  w = 24,
  h = 36,
  q = 1,
  formulaVariables?: Record<string, number>,
): any {
  try {
    runFormula(formula, w, h, q, formulaVariables);
    return null;
  } catch (e: any) {
    return e;
  }
}

describe("formula-scoped variables", () => {
  // ── variables are injected and usable ──────────────────────────────────────

  test("formula can reference a formula variable by name", () => {
    const result = runFormula("sqft * rate", 24, 36, 1, { rate: 2.5 });
    // sqft = (24*36)/144 = 6; 6 * 2.5 = 15
    expect(result.unitPrice).toBeCloseTo(15, 2);
  });

  test("sheet_consumption_sqft uses formula variables for sheet dimensions", () => {
    const vars = {
      sheet_width: 48,
      sheet_length: 96,
      usable_drop_min: 0,
      billable_length_increment: 1,
      minimum_billable_sqft: 0,
    };
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft)",
      24, 36, 2,
      vars,
    );
    // 24×36, q=2, sheet=48" wide: normal packs 2 across → row height=36, sqft=12
    expect(result.totalPrice).toBeCloseTo(12, 1);
  });

  test("multiple formula variables are all available simultaneously", () => {
    const result = runFormula("sqft * rate + fixed_fee", 24, 36, 1, {
      rate: 1,
      fixed_fee: 5,
    });
    // sqft=6; 6*1 + 5 = 11
    expect(result.unitPrice).toBeCloseTo(11, 2);
  });

  // ── missing variable produces a clear error ────────────────────────────────

  test("referencing an undefined variable throws PBV2_FORMULA_ERROR", () => {
    const err = runFormulaExpectError("sqft * missing_rate", 24, 36, 1, {});
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
  });

  test("sheet_consumption_sqft with undefined variable throws PBV2_FORMULA_ERROR", () => {
    // sheet_width is not supplied as a variable
    const err = runFormulaExpectError(
      "sheet_consumption_sqft(w, h, q, sheet_width, 96, 0, 1, 0)",
      24, 36, 1,
      {}, // no sheet_width
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
  });

  // ── existing formulas without variables still work ─────────────────────────

  test("formula without formulaVariables argument works unchanged", () => {
    const result = runFormula("sqft * base_price", 24, 36, 1);
    // sqft=6, base_price=1 ($1/sqft from 100 cents)
    expect(result.unitPrice).toBeCloseTo(6, 2);
  });

  test("formulaVariables=undefined does not break standard formulas", () => {
    const result = runFormula("sqft * base_price * q", 24, 36, 2, undefined);
    // sqft=6, base_price=1, q=2 → totalPrice=12
    expect(result.totalPrice).toBeCloseTo(12, 2);
  });

  test("formulaVariables={} (empty object) does not break standard formulas", () => {
    const result = runFormula("ceil(sqft) * base_price", 24, 36, 1, {});
    expect(result.unitPrice).toBeCloseTo(Math.ceil((24 * 36) / 144), 2);
  });

  // ── built-in scope variables take precedence over formula variables ────────

  test("formula variable named 'w' cannot shadow the built-in width", () => {
    // built-in w=24; variable w=999 — built-in must win
    const result = runFormula("w * 1", 24, 36, 1, { w: 999 });
    expect(result.unitPrice).toBeCloseTo(24, 1);
  });

  test("formula variable named 'base_price' cannot shadow the built-in rate", () => {
    // built-in base_price=1 (perSqftCents=100); variable base_price=999
    const result = runFormula("base_price * 1", 24, 36, 1, { base_price: 999 });
    expect(result.unitPrice).toBeCloseTo(1, 2);
  });
});
