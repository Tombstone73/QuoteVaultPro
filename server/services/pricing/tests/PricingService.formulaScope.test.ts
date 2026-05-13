/**
 * Tests for PBV2 formula scope registration.
 *
 * Verifies: sheet_consumption_sqft is accepted by the evaluator, unknown
 * functions are still rejected with PBV2_FORMULA_ERROR, built-in math
 * functions (ceil, floor, max, min, abs) remain available.
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

function runFormula(formula: string, w = 24, h = 36, q = 1) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeTree(),
    widthIn: w,
    heightIn: h,
    quantity: q,
    pricingFormulaOverride: formula,
    debug: true,
  });
}

function runFormulaExpectError(formula: string, w = 24, h = 36, q = 1): any {
  try {
    runFormula(formula, w, h, q);
    return null;
  } catch (e: any) {
    return e;
  }
}

describe("PBV2 formula scope", () => {
  // ── sheet_consumption_sqft registration ────────────────────────────────────

  test("formula validator accepts sheet_consumption_sqft", () => {
    // Any valid call that returns a finite number must not throw
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0)",
      24, 36, 1,
    );
    expect(result).toBeDefined();
  });

  test("sheet_consumption_sqft preview evaluation returns a finite price", () => {
    // 24×36, q=2, sheet=48" wide: normal packs 2 across → sqft=12
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0)",
      24, 36, 2,
    );
    expect(Number.isFinite(result.totalPrice)).toBe(true);
    expect(result.totalPrice).toBeGreaterThan(0);
  });

  test("sheet_consumption_sqft composes with base_price", () => {
    // base_price=1 (perSqftCents=100 → $1), sqft=12 → totalPrice=12
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0) * base_price",
      24, 36, 2,
    );
    expect(result.totalPrice).toBeCloseTo(12, 1);
  });

  // ── unknown function still fails ──────────────────────────────────────────

  test("unknown function throws PBV2_FORMULA_ERROR", () => {
    const err = runFormulaExpectError("notAFunction(w, h)");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
  });

  test("Math.max() style call throws PBV2_FORMULA_ERROR", () => {
    const err = runFormulaExpectError("Math.max(w, h)");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
  });

  // ── built-in math functions remain available ───────────────────────────────

  test("ceil() is available", () => {
    const result = runFormula("ceil(sqft)", 24, 36, 1);
    expect(result.unitPrice).toBeCloseTo(Math.ceil((24 * 36) / 144), 2);
  });

  test("floor() is available", () => {
    const result = runFormula("floor(sqft)", 24, 36, 1);
    expect(result.unitPrice).toBeCloseTo(Math.floor((24 * 36) / 144), 2);
  });

  test("max() is available", () => {
    const result = runFormula("max(25, sqft)", 24, 36, 1);
    expect(result.unitPrice).toBeCloseTo(Math.max(25, (24 * 36) / 144), 2);
  });

  test("min() is available", () => {
    const result = runFormula("min(25, sqft)", 24, 36, 1);
    expect(result.unitPrice).toBeCloseTo(Math.min(25, (24 * 36) / 144), 2);
  });

  test("abs() is available", () => {
    const result = runFormula("abs(sqft)", 24, 36, 1);
    expect(result.unitPrice).toBeCloseTo((24 * 36) / 144, 2);
  });

  test("ternary operator is available", () => {
    // q=5: formula returns 100, q=1: returns sqft
    const resultHigh = runFormula("q >= 5 ? 100 : sqft", 24, 36, 5);
    expect(resultHigh.totalPrice).toBeCloseTo(100, 1);

    const resultLow = runFormula("q >= 5 ? 100 : sqft", 24, 36, 1);
    expect(resultLow.unitPrice).toBeCloseTo((24 * 36) / 144, 2);
  });
});
