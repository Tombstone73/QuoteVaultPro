import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "@shared/optionTreeV2";
import { productOptionRate, productOptionRateTableSchema, validateProductOptionRateCoverage } from "@shared/productOptionRateTable";

const tree = { nodes: {
  size: { id: "size", input: { selectionKey: "size" }, choices: [{ value: "small" }, { value: "large" }] },
} } as unknown as OptionTreeV2;

describe("Product option rate table", () => {
  test("resolves any existing option axis and keeps quantity tiers within its choices", () => {
    const pricing = productOptionRateTableSchema.parse({ unit: "per_square_foot", minimumChargeCents: 0,
      optionRates: { selectionKey: "size", choices: [
        { value: "small", rateCents: 75, quantityTiers: [{ minQuantity: 1, rateCents: 75 }, { minQuantity: 10, rateCents: 70 }] },
        { value: "large", rateCents: 125 },
      ] } });
    expect(() => validateProductOptionRateCoverage(tree, pricing)).not.toThrow();
    expect(productOptionRate(pricing, 1, { size: "small" })).toBe(75);
    expect(productOptionRate(pricing, 10, { size: "small" })).toBe(70);
    expect(productOptionRate(pricing, 10, { size: "large" })).toBe(125);
  });

  test("rejects incomplete option coverage and choices disguised as quantity tiers", () => {
    const incomplete = productOptionRateTableSchema.parse({ unit: "per_piece", minimumChargeCents: 0,
      optionRates: { selectionKey: "size", choices: [{ value: "small", rateCents: 75 }] } });
    expect(() => validateProductOptionRateCoverage(tree, incomplete)).toThrow(/every existing choice/);
    expect(productOptionRateTableSchema.safeParse({ unit: "per_piece", minimumChargeCents: 0, rateCents: 75,
      quantityTiers: [{ minQuantity: 1, rateCents: 75 }, { minQuantity: 1, rateCents: 125 }] }).success).toBe(false);
  });
});
