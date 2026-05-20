import { describe, expect, test } from "@jest/globals";
import { exportProducts } from "../pbv2ExportMapper";
import { buildPbv2ImportProductValues } from "../pbv2ImportMapper";

const activePriceBreaks = {
  enabled: true,
  type: "quantity" as const,
  tiers: [{ minValue: 1, discountType: "percentage" as const, discountValue: 10 }],
};

describe("PBV2 import/export legacy priceBreaks cleanup", () => {
  test("PBV2 export omits legacy priceBreaks", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_1",
        name: "PBV2 Banner",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        optionTreeJson: { schemaVersion: 2, nodes: {}, rootNodeIds: [] },
      }],
      new Map([["prod_1", { active: { schemaVersion: 2, treeJson: { meta: { pricingV2: { qtyTiers: [] } } } } }]]),
      [],
      [],
    );

    expect(result.products[0].priceBreaks).toBeUndefined();
  });

  test("non-PBV2 export keeps legacy priceBreaks", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_1",
        name: "Static Product",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        optionTreeJson: null,
      }],
      new Map(),
      [],
      [],
    );

    expect(result.products[0].priceBreaks).toEqual(activePriceBreaks);
  });

  test("PBV2 import ignores legacy priceBreaks", () => {
    const values = buildPbv2ImportProductValues(
      {
        name: "Imported PBV2",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        pbv2: {
          hasActiveTree: true,
          activeTree: {
            schemaVersion: 2,
            treeJson: { meta: { pricingV2: { qtyTiers: [] } } },
            publishedAt: null,
          },
        },
      } as any,
      {},
    );

    expect(values.priceBreaks).toEqual({ enabled: false, type: "quantity", tiers: [] });
  });
});
