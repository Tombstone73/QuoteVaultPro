import { describe, expect, test } from "@jest/globals";

import { pbv2ToPricingAddons } from "../pricingAdapter";

function makeMinimalTree(priceComponents: any[]) {
  return {
    rootNodeIds: ["price_root"],
    nodes: [
      {
        id: "price_root",
        type: "PRICE",
        status: "ENABLED",
        title: "Root",
        price: {
          components: priceComponents,
        },
      },
    ],
    edges: [],
  };
}

describe("pbv2 per-component discounts", () => {
  test("discounted material + non-discounted grommets", () => {
    const tree = makeMinimalTree([
      {
        kind: "PER_UNIT",
        quantityRef: { op: "literal", value: 10 },
        unitPriceRef: { op: "literal", value: 1000 },
        discount: {
          discountEligible: true,
          discountScope: "volume",
          volumeTrigger: "componentQty",
          discountMethod: "percentage",
          volumePercentTiers: [{ minQty: 1, percentOff: 10 }],
        },
      },
      {
        kind: "PER_UNIT",
        quantityRef: { op: "literal", value: 10 },
        unitPriceRef: { op: "literal", value: 25 },
        discount: {
          discountEligible: false,
          discountScope: "customerTier+volume",
          volumeTrigger: "productQty",
          discountMethod: "percentage",
          volumePercentTiers: [{ minQty: 1, percentOff: 99 }],
          customerTierPercentByTier: { wholesale: 99 },
        },
      },
    ]);

    const out = pbv2ToPricingAddons(tree as any, { explicitSelections: {} }, { quantity: 10 } as any, {
      pricingContext: { customerTier: "wholesale" },
    });

    // material: 10 * 1000 = 10000 -> 10% off => 9000
    // grommets: 10 * 25 = 250 (not eligible)
    expect(out.addOnCents).toBe(9250);
    expect(out.breakdown.map((b) => b.amountCents)).toEqual([9000, 250]);
  });

  test("extra grommets only discount when enabled", () => {
    const baseComponent = {
      kind: "PER_UNIT",
      quantityRef: { op: "literal", value: 10 },
      unitPriceRef: { op: "literal", value: 25 },
    };

    const treeOff = makeMinimalTree([
      {
        ...baseComponent,
        discount: {
          discountEligible: false,
          discountScope: "volume",
          volumeTrigger: "componentQty",
          discountMethod: "percentage",
          volumePercentTiers: [{ minQty: 1, percentOff: 20 }],
        },
      },
    ]);

    const outOff = pbv2ToPricingAddons(treeOff as any, { explicitSelections: {} }, { quantity: 10 } as any);
    expect(outOff.addOnCents).toBe(250);

    const treeOn = makeMinimalTree([
      {
        ...baseComponent,
        discount: {
          discountEligible: true,
          discountScope: "volume",
          volumeTrigger: "componentQty",
          discountMethod: "percentage",
          volumePercentTiers: [{ minQty: 1, percentOff: 20 }],
        },
      },
    ]);

    const outOn = pbv2ToPricingAddons(treeOn as any, { explicitSelections: {} }, { quantity: 10 } as any);
    expect(outOn.addOnCents).toBe(200);
  });

  test("customer tier then volume stacking order", () => {
    const tree = makeMinimalTree([
      {
        kind: "PER_UNIT",
        quantityRef: { op: "literal", value: 10 },
        unitPriceRef: { op: "literal", value: 100 },
        discount: {
          discountEligible: true,
          discountScope: "customerTier+volume",
          volumeTrigger: "productQty",
          discountMethod: "percentage",
          customerTierPercentByTier: { wholesale: 10 },
          volumePercentTiers: [{ minQty: 10, percentOff: 10 }],
        },
      },
    ]);

    const out = pbv2ToPricingAddons(tree as any, { explicitSelections: {} }, { quantity: 10 } as any, {
      pricingContext: { customerTier: "wholesale" },
    });

    // unit: 100 -> (tier -10%) 90 -> (volume -10%) 81; qty 10 => 810
    expect(out.addOnCents).toBe(810);
    expect(out.breakdown[0].unitPriceCents).toBe(81);
    expect(out.breakdown[0].amountCents).toBe(810);
    expect(out.breakdown[0].discountDebug?.unitPriceCentsBeforeDiscount).toBe(100);
    expect(out.breakdown[0].discountDebug?.unitPriceCentsAfterDiscount).toBe(81);
  });
});
