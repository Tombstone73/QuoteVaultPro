import { describe, expect, test } from "@jest/globals";
import { resolvePricingV2BaseRates } from "../../pricingAdapter";
import {
  validateQuantityOnlyPerPieceTierFamily,
  validateTreeHasBasePrice,
} from "../../validator/validateBasePrice";

function tierOnlyTree(tiers: unknown[] = [
  { id: "tier_1", label: "1-24", minQty: 1, perPieceCents: 300 },
  { id: "tier_25", label: "25-49", minQty: 25, perPieceCents: 250 },
  { id: "tier_50", label: "50+", minQty: 50, perPieceCents: 200 },
]) {
  return {
    schemaVersion: 2,
    status: "DRAFT",
    rootNodeIds: [],
    nodes: {},
    meta: {
      pricingProfileKey: "qty_only",
      pricingV2: {
        tierBasis: "line_item_quantity",
        base: { perSqftCents: null, perPieceCents: null, minimumChargeCents: null },
        qtyTiers: tiers,
      },
    },
  };
}

describe("quantity-only PBV2 tier pricing validation", () => {
  test("accepts a complete per-piece tier family without a scalar base rate", () => {
    const tree = tierOnlyTree();
    expect(validateTreeHasBasePrice(tree).errors).toEqual([]);
    expect(validateQuantityOnlyPerPieceTierFamily(tree.meta.pricingV2).errors).toEqual([]);
  });

  test.each([
    [1, 300, 300, 1],
    [24, 300, 7200, 1],
    [25, 250, 6250, 25],
    [49, 250, 12250, 25],
    [50, 200, 10000, 50],
    [100, 200, 20000, 50],
  ])("selects the correct tier for quantity %i", (quantity, expectedRate, expectedTotal, expectedMinQty) => {
    const result = resolvePricingV2BaseRates(tierOnlyTree(), {}, { quantity, widthIn: 0, heightIn: 0, sqft: 0 });
    expect(result.perSqftCents).toBe(0);
    expect(result.perPieceCents).toBe(expectedRate);
    expect(result.minimumChargeCents).toBe(0);
    expect(result.perPieceCents * quantity).toBe(expectedTotal);
    expect(result.tierResolution.selectedTierMinQty).toBe(expectedMinQty);
  });

  test.each([
    [[], "PBV2_E_QTY_TIER_MISSING"],
    [[{ minQty: 1 }], "PBV2_E_QTY_TIER_RATE_MISSING"],
    [[{ minQty: 1, maxQty: 25, perPieceCents: 300 }, { minQty: 25, perPieceCents: 250 }], "PBV2_E_QTY_TIER_OVERLAP"],
    [[{ minQty: 2, perPieceCents: 300 }], "PBV2_E_QTY_TIER_COVERAGE_INVALID"],
    [[{ minQty: 1, maxQty: 24, perPieceCents: 300 }], "PBV2_E_QTY_TIER_FINAL_INVALID"],
  ])("returns a specific error for invalid quantity tiers", (tiers, code) => {
    const result = validateTreeHasBasePrice(tierOnlyTree(tiers));
    expect(result.errors[0]?.code).toBe(code);
    expect(result.errors[0]?.code).not.toBe("PBV2_E_BASE_PRICE_MISSING");
  });

  test("preserves scalar pricing when a quantity-only product does not use tiers", () => {
    const tree = tierOnlyTree([]);
    tree.meta.pricingV2.base.perPieceCents = 300;
    expect(validateTreeHasBasePrice(tree).errors).toEqual([]);
  });
});
