import { describe, expect, test } from "@jest/globals";

import { pbv2ToPricingAddons } from "../pricingAdapter";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "../validator";

function makeBannerWeightTree() {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["weight", "sides", "price_root"],
    nodes: [
      {
        id: "weight",
        type: "INPUT",
        status: "ENABLED",
        key: "weight",
        input: {
          selectionKey: "weight",
          valueType: "ENUM",
          constraints: {
            enum: {
              options: [
                {
                  value: "13OZ",
                  pricingParams: {
                    baseUnitPriceCentsPerSqftSS: 100,
                    baseUnitPriceCentsPerSqftDS: 150,
                    ssVolumeUnitPriceCentsTiers: [
                      { minQty: 0, unitPriceCents: 100 },
                      // Triggers on sqft-sold (componentQty), not productQty.
                      { minQty: 6, unitPriceCents: 90 },
                    ],
                    dsVolumeUnitPriceCentsTiers: [
                      { minQty: 0, unitPriceCents: 150 },
                      { minQty: 6, unitPriceCents: 140 },
                    ],
                  },
                },
                {
                  value: "18OZ",
                  pricingParams: {
                    baseUnitPriceCentsPerSqftSS: 120,
                    baseUnitPriceCentsPerSqftDS: 180,
                    ssVolumeUnitPriceCentsTiers: [
                      { minQty: 0, unitPriceCents: 120 },
                      { minQty: 100, unitPriceCents: 110 },
                    ],
                    dsVolumeUnitPriceCentsTiers: [
                      { minQty: 0, unitPriceCents: 180 },
                      { minQty: 100, unitPriceCents: 165 },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      {
        id: "sides",
        type: "INPUT",
        status: "ENABLED",
        key: "sides",
        input: {
          selectionKey: "sides",
          valueType: "ENUM",
          defaultValue: "SS",
          constraints: {
            enum: {
              options: [{ value: "SS" }, { value: "DS" }],
            },
          },
        },
      },
      {
        id: "price_root",
        type: "PRICE",
        status: "ENABLED",
        key: "price_root",
        price: {
          components: [
            {
              kind: "PER_UNIT",
              title: "Banner SS",
              appliesWhen: {
                op: "EQ",
                left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "sides" } },
                right: { op: "literal", value: "SS" },
              },
              quantityRef: {
                op: "mul",
                left: { op: "ref", ref: { kind: "envRef", envKey: "sqft" } },
                right: { op: "ref", ref: { kind: "envRef", envKey: "quantity" } },
              },
              unitPriceRef: {
                op: "ref",
                ref: {
                  kind: "optionValueParamRef",
                  selectionKey: "weight",
                  paramPath: "pricingParams.baseUnitPriceCentsPerSqftSS",
                  defaultValue: 0,
                },
              },
              discount: {
                discountEligible: true,
                discountScope: "volume",
                volumeTrigger: "componentQty",
                discountMethod: "tierTable",
                volumeUnitPriceCentsTiersRef: {
                  kind: "optionValueParamJsonRef",
                  selectionKey: "weight",
                  paramPath: "pricingParams.ssVolumeUnitPriceCentsTiers",
                },
              },
            },
            {
              kind: "PER_UNIT",
              title: "Banner DS",
              appliesWhen: {
                op: "EQ",
                left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "sides" } },
                right: { op: "literal", value: "DS" },
              },
              quantityRef: {
                op: "mul",
                left: { op: "ref", ref: { kind: "envRef", envKey: "sqft" } },
                right: { op: "ref", ref: { kind: "envRef", envKey: "quantity" } },
              },
              unitPriceRef: {
                op: "ref",
                ref: {
                  kind: "optionValueParamRef",
                  selectionKey: "weight",
                  paramPath: "pricingParams.baseUnitPriceCentsPerSqftDS",
                  defaultValue: 0,
                },
              },
              discount: {
                discountEligible: true,
                discountScope: "volume",
                volumeTrigger: "componentQty",
                discountMethod: "tierTable",
                volumeUnitPriceCentsTiersRef: {
                  kind: "optionValueParamJsonRef",
                  selectionKey: "weight",
                  paramPath: "pricingParams.dsVolumeUnitPriceCentsTiers",
                },
              },
            },
          ],
        },
      },
    ],
    edges: [],
  };

  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  expect(res.errors).toEqual([]);

  // Warnings are allowed to evolve as validator tightens.

  return tree;
}

describe("PBV2 banner weight option pricing params", () => {
  test("Weight selection drives base $/sqft and sqft-tier pricing (SS)", () => {
    const tree = makeBannerWeightTree();

    const env = { sqft: 10, quantity: 5 } as any; // totalSqft = 50

    const out13 = pbv2ToPricingAddons(
      tree as any,
      { explicitSelections: { weight: "13OZ", sides: "SS" } },
      env
    );

    // totalSqft=50 triggers tier minQty=6 => 90 cents/sqft
    expect(out13.addOnCents).toBe(50 * 90);

    const out18 = pbv2ToPricingAddons(
      tree as any,
      { explicitSelections: { weight: "18OZ", sides: "SS" } },
      env
    );

    // totalSqft=50 does NOT reach 18oz tier minQty=100 => stays 120 cents/sqft
    expect(out18.addOnCents).toBe(50 * 120);
  });

  test("Single vs double-sided pricing can be weight-specific and sqft-tiered (DS)", () => {
    const tree = makeBannerWeightTree();

    const env = { sqft: 10, quantity: 5 } as any; // totalSqft = 50

    const out13ds = pbv2ToPricingAddons(
      tree as any,
      { explicitSelections: { weight: "13OZ", sides: "DS" } },
      env
    );

    // totalSqft=50 triggers DS tier minQty=6 => 140 cents/sqft
    expect(out13ds.addOnCents).toBe(50 * 140);
  });
});
