import { describe, expect, test } from "@jest/globals";
import {
  extractProductOptionPricingMatrix,
  resolveProductOptionPricingMatrix,
  type ProductOptionPricingMatrix,
} from "../productOptionPricingMatrix";

const acmMatrix: ProductOptionPricingMatrix = {
  dimensions: ["thickness", "sides"],
  rows: [
    { id: "3mm_single", when: { thickness: "3mm", sides: "single_sided" }, variables: { base_price: 5 } },
    { id: "3mm_double", when: { thickness: "3mm", sides: "double_sided" }, variables: { base_price: 5.75 } },
    { id: "6mm_single", when: { thickness: "6mm", sides: "single_sided" }, variables: { base_price: 7 } },
    { id: "6mm_double", when: { thickness: "6mm", sides: "double_sided" }, variables: { base_price: 8.25 } },
  ],
};

describe("product option pricing matrix resolution", () => {
  test.each([
    ["3mm", "single_sided", 5],
    ["3mm", "double_sided", 5.75],
    ["6mm", "single_sided", 7],
    ["6mm", "double_sided", 8.25],
  ])("resolves base_price for %s + %s", (thickness, sides, expectedBasePrice) => {
    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: acmMatrix,
      selections: {
        thickness: { value: thickness },
        sides: { value: sides },
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.variables.base_price).toBe(expectedBasePrice);
  });

  test("missing matrix row returns a clear error", () => {
    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: acmMatrix,
      selections: {
        thickness: { value: "10mm" },
        sides: { value: "single_sided" },
      },
    });

    expect(result.variables).toEqual({});
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND",
      }),
    ]);
  });

  test("protected dimensional built-ins cannot be shadowed by matrix variables", () => {
    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: {
        dimensions: ["thickness"],
        rows: [
          {
            when: { thickness: "3mm" },
            variables: { base_price: 5, w: 999, q: 999, sqft: 999, total_sqft: 999 },
          },
        ],
      },
      selections: { thickness: { value: "3mm" } },
    });

    expect(result.variables).toEqual({ base_price: 5 });
    expect(result.ignoredVariables).toEqual(["q", "sqft", "total_sqft", "w"]);
  });

  test("extracts top-level pricingMatrix from tree JSON", () => {
    const tree = {
      pricingMatrix: acmMatrix,
    };

    expect(extractProductOptionPricingMatrix(tree)).toEqual(acmMatrix);
  });
});
