import { describe, expect, test } from "@jest/globals";
import { exportProducts } from "../pbv2ExportMapper";
import { buildImportPlan, buildPbv2ImportProductValues } from "../pbv2ImportMapper";
import { createPbv2BannerProductTreeJson } from "../../../shared/pbv2/starterTree";

const activePriceBreaks = {
  enabled: true,
  type: "quantity" as const,
  tiers: [{ minValue: 1, discountType: "percentage" as const, discountValue: 10 }],
};

const activePbv2Tree = {
  status: "ACTIVE",
  rootNodeIds: ["materials"],
  nodes: [
    {
      id: "materials",
      kind: "group",
      type: "GROUP",
      label: "Banner Weight",
    },
    {
      id: "bannerWeight",
      kind: "question",
      type: "INPUT",
      label: "Banner Weight",
      input: { selectionKey: "bannerWeight", valueType: "ENUM" },
      choices: [
        { value: "13oz", label: "13oz" },
        { value: "18oz", label: "18oz" },
      ],
    },
  ],
  rules: [
    { type: "hide", target: "printSide.double", when: { ref: "bannerWeight", equals: "13oz" } },
  ],
  meta: {
    pricingMatrix: {
      rows: [{ selectionKey: "bannerWeight", value: "18oz", addPerSqftCents: 125 }],
    },
    pricingV2: {
      base: { perSqftCents: 400 },
      qtyTiers: [{ minQty: 1, perSqftCents: 400 }],
    },
  },
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

  test("PBV2 export includes active tree, option rules, and pricing config", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_1",
        name: "Banner Sample 1",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        optionTreeJson: null,
      }],
      new Map([[
        "prod_1",
        {
          active: {
            schemaVersion: 2,
            treeJson: activePbv2Tree,
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    );

    const exported = result.products[0];
    expect(exported.pbv2?.hasActiveTree).toBe(true);
    expect(exported.pbv2?.activeTree?.treeJson).toEqual(activePbv2Tree);
    expect(exported.optionTreeJson).toEqual(activePbv2Tree);
    expect((exported.pbv2?.activeTree?.treeJson as any).rules).toHaveLength(1);
    expect((exported.pbv2?.activeTree?.treeJson as any).meta.pricingV2).toBeDefined();
    expect(exported.optionGroupCount).toBe(1);
    expect(exported.optionCount).toBe(1);
    expect(exported.choiceCount).toBe(2);
    expect(exported.ruleCount).toBe(1);
    expect(exported.pricingConfigPresent).toBe(true);
    expect(exported.matrixCount).toBe(1);
    expect(exported.tierCount).toBe(1);
  });

  test("PBV2 export preserves Banner sample runtime groups and choices", async () => {
    const bannerTree = createPbv2BannerProductTreeJson();
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_banner",
        name: "Banner Sample 1",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        optionTreeJson: null,
      }],
      new Map([[
        "prod_banner",
        {
          active: {
            schemaVersion: 2,
            treeJson: bannerTree,
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    );

    const exported = result.products[0];
    const nodeLabels = Object.values((exported.optionTreeJson as any).nodes).map((node: any) => node.label);
    expect(exported.priceBreaks).toBeUndefined();
    expect(exported.optionTreeJson).toEqual(bannerTree);
    expect(exported.pbv2?.activeTree?.treeJson).toEqual(bannerTree);
    expect(nodeLabels).toEqual(expect.arrayContaining([
      "Banner Weight",
      "Print Side",
      "Hems",
      "Pole Pockets",
      "Grommets",
    ]));
    expect(exported.optionGroupCount).toBeGreaterThan(0);
    expect(exported.optionCount).toBeGreaterThanOrEqual(5);
    expect(exported.choiceCount).toBeGreaterThan(0);
    expect(exported.ruleCount).toBeGreaterThan(0);
    expect(exported.pricingConfigPresent).toBe(true);
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

  test("PBV2 import restores runtime optionTreeJson from active tree", () => {
    const values = buildPbv2ImportProductValues(
      {
        name: "Imported Banner Sample 1",
        description: "Desc",
        pbv2: {
          hasActiveTree: true,
          activeTree: {
            schemaVersion: 2,
            treeJson: activePbv2Tree,
            publishedAt: null,
          },
          hasDraft: false,
        },
      } as any,
      {},
    );

    expect(values.optionTreeJson).toEqual(activePbv2Tree);
  });

  test("PBV2 import preview includes counts for options, matrices, and tiers", async () => {
    const plan = await buildImportPlan(
      {
        db: makeEmptyImportDb() as any,
        organizationId: "org_1",
        userId: "user_1",
        mode: "upsertBySlug",
      },
      {
        schemaVersion: "products-export/v2",
        exportedAt: "2026-01-01T00:00:00.000Z",
        orgId: "source_org",
        products: [{
          name: "Imported Banner Sample 1",
          description: "Desc",
          pbv2: {
            hasActiveTree: true,
            activeTree: {
              schemaVersion: 2,
              treeJson: activePbv2Tree,
              publishedAt: null,
            },
            hasDraft: false,
          },
        } as any],
      },
    );

    expect(plan.errors).toHaveLength(0);
    expect(plan.preview[0]).toMatchObject({
      hasPbv2: true,
      optionGroupCount: 1,
      optionCount: 1,
      choiceCount: 2,
      ruleCount: 1,
      pricingConfigPresent: true,
      matrixCount: 1,
      tierCount: 1,
    });
  });

  test("PBV2 import preview rejects declared option counts that would import as zero options", async () => {
    const plan = await buildImportPlan(
      {
        db: makeEmptyImportDb() as any,
        organizationId: "org_1",
        userId: "user_1",
        mode: "upsertBySlug",
      },
      {
        schemaVersion: "products-export/v2",
        exportedAt: "2026-01-01T00:00:00.000Z",
        orgId: "source_org",
        products: [{
          name: "Broken PBV2 Banner",
          description: "Desc",
          optionCount: 5,
          pbv2: {
            hasActiveTree: true,
            activeTree: {
              schemaVersion: 2,
              treeJson: { rootNodeIds: [], nodes: [] },
              publishedAt: null,
            },
            hasDraft: false,
          },
        } as any],
      },
    );

    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_OPTIONS_MISSING_FROM_TREE" }),
    ]));
  });
});

function makeEmptyImportDb() {
  return {
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  };
}
