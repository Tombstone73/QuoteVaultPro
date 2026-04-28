/**
 * Tests for formula variable resolution and function detection in PricingService.
 *
 * Covers:
 * - Lowercase variables (w, h, q, sqft, p, base_price) resolve correctly
 * - Uppercase bracket-style variables [W], [H], [Q] produce a helpful error
 * - Math.ceil / Math.round / Math.max produce a helpful "use ceil() instead" error
 * - ceil(...) evaluates correctly
 */

import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree } from "../PricingService";

// Minimal valid tree for evaluatePricingPreviewFromTree.
// Uses the optionTreeV2Schema-compatible structure (nodes as Record<id, node>,
// schemaVersion: 2, required node fields: id, kind, label).
function makeTree(formula?: string, metaOverrides?: Record<string, unknown>) {
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
      pricingV2: {
        base: {
          perSqftCents: 100, // $1.00/sqft
        },
      },
      ...(metaOverrides ?? {}),
      ...(formula !== undefined ? { pricingFormula: formula } : {}),
    },
  };
}

describe("PricingService formula evaluation", () => {
  // Helper: evaluate with formula override and return result or catch error
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
      return null; // no error thrown
    } catch (e: any) {
      return e;
    }
  }

  test("lowercase variable w resolves to ordered width", () => {
    const result = runFormula("w");
    expect(result.unitPrice).toBeCloseTo(24, 1);
  });

  test("lowercase variable h resolves to ordered height", () => {
    const result = runFormula("h");
    expect(result.unitPrice).toBeCloseTo(36, 1);
  });

  test("lowercase variable q resolves to quantity", () => {
    // Formula "q" contains the token q, so it's treated as a totalPrice formula.
    // totalPrice = q = 5; unitPrice = totalPrice / quantity = 5/5 = 1
    const result = runFormula("q", 24, 36, 5);
    expect(result.totalPrice).toBeCloseTo(5, 1);
  });

  test("sqft variable resolves to (w*h)/144", () => {
    // 24x36 = 864 in^2 / 144 = 6 sqft
    const result = runFormula("sqft");
    expect(result.unitPrice).toBeCloseTo(6, 2);
  });

  test("p variable resolves to base_price rate (per sqft rate)", () => {
    // $1.00/sqft => p = 1.0
    const result = runFormula("p");
    expect(result.unitPrice).toBeCloseTo(1.0, 2);
  });

  test("base_price alias resolves same as p", () => {
    const result = runFormula("base_price");
    expect(result.unitPrice).toBeCloseTo(1.0, 2);
  });

  test("working formula: ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price", () => {
    // (24.25 * 36.25) * 1 / 144 = 6.0977... => ceil = 7
    // 7 * 1.0 = $7.00
    const result = runFormula("ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price");
    expect(result.totalPrice).toBeCloseTo(7.0, 1);
  });

  test("ceil() function evaluates correctly", () => {
    // ceil(6.1) = 7
    const result = runFormula("ceil(6.1)");
    expect(result.unitPrice).toBeCloseTo(7.0, 1);
  });

  test("sqft * p * q produces total price for formula", () => {
    // sqft=6, p=1.0, q=2 => 12
    const result = runFormula("sqft * p * q", 24, 36, 2);
    expect(result.totalPrice).toBeCloseTo(12.0, 1);
  });

  test("Math.ceil produces helpful unsupported-function error", () => {
    const err = runFormulaExpectError("Math.ceil(sqft * q) * p");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    expect(Array.isArray(err.details)).toBe(true);
    const detail = err.details[0];
    expect(detail.code).toBe("PBV2_FORMULA_JS_MATH_UNSUPPORTED");
    expect(detail.message.toLowerCase()).toContain("math.ceil");
    expect(detail.message.toLowerCase()).toContain("use ceil");
  });

  test("Math.round produces helpful unsupported-function error", () => {
    const err = runFormulaExpectError("Math.round(sqft) * p");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    const detail = err.details[0];
    expect(detail.code).toBe("PBV2_FORMULA_JS_MATH_UNSUPPORTED");
    expect(detail.message.toLowerCase()).toContain("math.round");
    expect(detail.message.toLowerCase()).toContain("use round");
  });

  test("Math.max produces helpful unsupported-function error", () => {
    const err = runFormulaExpectError("Math.max(sqft, 1) * p");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    const detail = err.details[0];
    expect(detail.code).toBe("PBV2_FORMULA_JS_MATH_UNSUPPORTED");
    expect(detail.message.toLowerCase()).toContain("math.max");
    expect(detail.message.toLowerCase()).toContain("use max");
  });

  test("bracket variable [W] produces a helpful error", () => {
    const err = runFormulaExpectError("[W] * [H] / 144 * q * p");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    const detail = err.details[0];
    expect(detail.code).toBe("PBV2_FORMULA_MISSING_VARIABLE");
    expect(detail.message.toLowerCase()).toContain("[w]");
    expect(detail.message.toLowerCase()).toContain("use w instead");
  });

  test("bracket variable [H] produces a helpful error", () => {
    const err = runFormulaExpectError("[H]");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    const detail = err.details.find((d: any) => d.message.toLowerCase().includes("[h]"));
    expect(detail).toBeDefined();
    expect(detail.message.toLowerCase()).toContain("use h instead");
  });

  test("bracket variable [Q] produces a helpful error", () => {
    const err = runFormulaExpectError("[Q]");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    const detail = err.details.find((d: any) => d.message.toLowerCase().includes("[q]"));
    expect(detail).toBeDefined();
    expect(detail.message.toLowerCase()).toContain("use q instead");
  });

  test("uppercase undefined variable W (no brackets) produces missing-variable error", () => {
    // mathjs will throw 'Undefined symbol W'
    const err = runFormulaExpectError("W * H / 144 * q * p");
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
  });

  test("formula error debug includes raw formula and variables", () => {
    const err = runFormulaExpectError("Math.ceil(sqft)");
    expect(err.debug?.formulaRaw).toBe("Math.ceil(sqft)");
    expect(err.debug?.variables).toBeDefined();
    expect(typeof err.debug?.variables?.w).toBe("number");
    expect(typeof err.debug?.variables?.h).toBe("number");
    expect(typeof err.debug?.variables?.q).toBe("number");
  });

  test("preview debug normalizes shippingConfig base weight and computes shipping weight", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(undefined, {
        shippingConfig: {
          baseWeight: 0.5,
          weightUnit: "lb",
          weightBasis: "per_item",
        },
      }),
      widthIn: 24,
      heightIn: 36,
      quantity: 2,
      pricingFormulaOverride: "sqft * base_price * q",
      debug: true,
    });

    expect(result.debug?.weight?.baseWeightSource).toBe("shippingConfig.baseWeight");
    expect(result.debug?.weight?.baseWeightOz).toBeCloseTo(8, 4);
    expect(result.debug?.weight?.computedShippingWeightOz).toBeCloseTo(16, 4);
    expect(result.debug?.weight?.warningCode).toBeUndefined();
  });

  test("formula error debug still includes weight debug details", () => {
    try {
      evaluatePricingPreviewFromTree({
        treeJson: makeTree(undefined, {
          shippingConfig: {
            baseWeight: 1,
            weightUnit: "oz",
            weightBasis: "per_order",
          },
        }),
        widthIn: 24,
        heightIn: 36,
        quantity: 1,
        pricingFormulaOverride: "Math.ceil(sqft)",
        debug: true,
      });
      throw new Error("Expected formula error");
    } catch (error: any) {
      expect(error.code).toBe("PBV2_FORMULA_ERROR");
      expect(error.debug?.weight?.baseWeightOz).toBeCloseTo(1, 4);
      expect(error.debug?.weight?.computedShippingWeightOz).toBeCloseTo(1, 4);
    }
  });
});
