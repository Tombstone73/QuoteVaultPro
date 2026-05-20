import { describe, expect, test } from "@jest/globals";
import {
  extractProductOptionPricingMatrix,
  resolveProductOptionPricingMatrix,
  type ProductOptionPricingMatrix,
} from "../productOptionPricingMatrix";

const acmMatrix: ProductOptionPricingMatrix = {
  dimensions: ["thickness", "sides"],
  rows: [
    { id: "3mm_single", when: { thickness: "3mm", sides: "choice_single" }, variables: { base_price: 500 } },
    { id: "3mm_double", when: { thickness: "3mm", sides: "choice_double" }, variables: { base_price: 575 } },
    { id: "6mm_single", when: { thickness: "6mm", sides: "choice_single" }, variables: { base_price: 700 } },
    { id: "6mm_double", when: { thickness: "6mm", sides: "choice_double" }, variables: { base_price: 825 } },
  ],
};

describe("product option pricing matrix resolution", () => {
  test.each([
    ["3mm", "choice_single", 5],
    ["3mm", "choice_double", 5.75],
    ["6mm", "choice_single", 7],
    ["6mm", "choice_double", 8.25],
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
        sides: { value: "choice_single" },
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

  test("keeps legacy decimal matrix currency variables working", () => {
    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: {
        dimensions: ["thickness"],
        rows: [{ when: { thickness: "3mm" }, variables: { base_price: 5.75 } }],
      },
      selections: { thickness: { value: "3mm" } },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.variables.base_price).toBe(5.75);
  });

  test("extracts top-level pricingMatrix from tree JSON", () => {
    const tree = {
      pricingMatrix: acmMatrix,
    };

    expect(extractProductOptionPricingMatrix(tree)).toEqual(acmMatrix);
  });

  test("preserves row-level quantity tiers on the matched matrix row", () => {
    const matrix: ProductOptionPricingMatrix = {
      dimensions: ["thickness"],
      rows: [
        {
          id: "3mm",
          when: { thickness: "3mm" },
          variables: { base_price: 500 },
          qtyTiers: [{ id: "row_tier_10", label: "10+", minQty: 10, perSqftCents: 450 }],
        },
      ],
    };

    const result = resolveProductOptionPricingMatrix({
      pricingMatrix: matrix,
      selections: { thickness: { value: "3mm" } },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.variables.base_price).toBe(5);
    expect(result.matchedRow?.qtyTiers).toEqual([
      expect.objectContaining({ id: "row_tier_10", minQty: 10, perSqftCents: 450 }),
    ]);
  });
});
