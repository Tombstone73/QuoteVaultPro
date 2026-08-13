import { describe, expect, jest, test } from "@jest/globals";
import { exportProducts } from "../pbv2ExportMapper";
import { applyImport, buildImportPlan, buildPbv2ImportProductValues, remapPbv2TreeMaterialIds, resolvePortableMaterialReferences } from "../pbv2ImportMapper";
import { createPbv2BannerProductTreeJson } from "../../../shared/pbv2/starterTree";
import { normalizePbv2ExportOptions } from "../../../shared/pbv2ExportOptionNormalizer";
import { validateTreeHasBasePrice } from "../../../shared/pbv2/validator/validateBasePrice";

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

const installationRuntimeTree = {
  schemaVersion: 2,
  root: {
    id: "installation-root",
    type: "GROUP",
    label: "Installation",
    children: [
      {
        id: "install-location-group",
        kind: "group",
        label: "Location",
        questions: [
          {
            id: "install-location",
            component: "SELECT",
            label: "Installation Location",
            key: "installation.location",
            defaultValue: "indoor",
            options: [
              { value: "indoor", label: "Indoor" },
              { value: "outdoor", label: "Outdoor", pricingImpact: [{ mode: "addFlat", amountCents: 2500 }] },
            ],
            visibilityRules: [{ type: "truthy", selectionKey: "installation.required" }],
          },
        ],
      },
      {
        id: "install-requirements",
        type: "GROUP",
        label: "Requirements",
        options: [
          {
            id: "installation-required",
            type: "INPUT",
            label: "Installation Required",
            input: { type: "boolean", selectionKey: "installation.required", defaultValue: true },
            choices: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "installation-hardware",
            kind: "question",
            label: "Hardware",
            input: { type: "radio", selectionKey: "installation.hardware" },
            choices: [
              { value: "standard", label: "Standard Hardware" },
              { value: "premium", label: "Premium Hardware", priceDeltaCents: 1500 },
            ],
            edges: { children: [{ toNodeId: "install-location" }] },
          },
          {
            id: "installation-access",
            component: "RADIO_GROUP",
            label: "Access Type",
            key: "installation.access",
            options: [
              { value: "standard", label: "Standard Access" },
              {
                value: "ladder",
                label: "Ladder Access",
                pricing: { mode: "addFlat", amountCents: 3500 },
                children: [
                  {
                    id: "installation-ladder-height",
                    component: "NUMBER_INPUT",
                    label: "Ladder Height",
                    key: "installation.ladderHeight",
                    defaultValue: 8,
                    routing: { requires: "ladder" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  meta: {
    pricingV2: {
      base: { perPieceCents: 10000 },
    },
  },
};

const installationServicePricingTree = {
  schemaVersion: 2,
  root: {
    id: "installation-root",
    type: "GROUP",
    label: "Installation",
  },
  meta: {
    pricingV2: {
      base: { flatFeeCents: 10000 },
      formula: "flatFee",
    },
  },
};

const brokenPopulatedZeroOptionTree = {
  schemaVersion: 2,
  root: {
    id: "broken-root",
    type: "GROUP",
    label: "Broken product shell",
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
        optionTreeJson: activePbv2Tree,
      }],
      new Map([["prod_1", { active: { schemaVersion: 2, treeJson: activePbv2Tree } }]]),
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

  test("PBV2 export extracts Installation options from nested runtime tree shapes", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_install",
        name: "Installation",
        description: "Desc",
        priceBreaks: activePriceBreaks,
        optionTreeJson: null,
      }],
      new Map([[
        "prod_install",
        {
          active: {
            schemaVersion: 2,
            treeJson: installationRuntimeTree,
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    );

    const exported = result.products[0];
    expect(exported.optionTreeJson).toEqual(installationRuntimeTree);
    expect(exported.optionGroupCount).toBe(4);
    expect(exported.optionCount).toBe(5);
    expect(exported.choiceCount).toBe(8);
    expect(exported.pricingConfigPresent).toBe(true);
  });

  test("PBV2 export treats pricing-only Installation service as a valid simple product", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_install_service",
        name: "Installation",
        description: "Installation service",
        pricingMode: "flat",
        pricingFormula: "flatFee",
        isService: true,
        optionTreeJson: null,
      }],
      new Map([[
        "prod_install_service",
        {
          active: {
            schemaVersion: 2,
            treeJson: installationServicePricingTree,
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    );

    const exported = result.products[0];
    expect(exported.optionTreeJson).toEqual(installationServicePricingTree);
    expect(exported.pbv2?.activeTree?.treeJson).toEqual(installationServicePricingTree);
    expect(exported.optionGroupCount).toBe(1);
    expect(exported.optionCount).toBe(0);
    expect(exported.choiceCount).toBe(0);
    expect(exported.pricingConfigPresent).toBe(true);
    expect(exported.exportWarnings).toContain("NO_CUSTOMER_OPTIONS");
    expect(exported.productKind).toBe("service");
  });

  test("PBV2 export-all can include normal option products and simple service products", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [
        {
          id: "prod_banner",
          name: "Banner",
          description: "Option product",
          optionTreeJson: null,
        },
        {
          id: "prod_install_service",
          name: "Installation",
          description: "Installation service",
          pricingMode: "flat",
          pricingFormula: "flatFee",
          isService: true,
          optionTreeJson: null,
        },
      ],
      new Map([
        ["prod_banner", { active: { schemaVersion: 2, treeJson: activePbv2Tree } }],
        ["prod_install_service", { active: { schemaVersion: 2, treeJson: installationServicePricingTree } }],
      ]),
      [],
      [],
    );

    expect(result.products.map((product) => product.name)).toEqual(["Banner", "Installation"]);
    expect(result.products[0]).toMatchObject({ optionCount: 1, pricingConfigPresent: true });
    expect(result.products[1]).toMatchObject({
      optionCount: 0,
      pricingConfigPresent: true,
      exportWarnings: ["NO_CUSTOMER_OPTIONS"],
      productKind: "service",
    });
  });

  test("PBV2 selected export works for a simple service product", async () => {
    const result = await exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_install_service",
        name: "Installation",
        description: "Installation service",
        pricingMode: "flat",
        pricingFormula: "flatFee",
        isService: true,
        optionTreeJson: null,
      }],
      new Map([["prod_install_service", { active: { schemaVersion: 2, treeJson: installationServicePricingTree } }]]),
      [],
      [],
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      name: "Installation",
      optionCount: 0,
      pricingConfigPresent: true,
      exportWarnings: ["NO_CUSTOMER_OPTIONS"],
    });
  });

  test("PBV2 option export normalization preserves Installation option metadata", () => {
    const normalized = normalizePbv2ExportOptions(installationRuntimeTree);

    expect(normalized.diagnostics).toMatchObject({
      rootKeys: ["children", "id", "label", "type"],
      totalTraversedNodes: 10,
      detectedOptionLikeNodes: 5,
      optionGroupCount: 4,
      choiceCount: 8,
    });
    expect(normalized.options).toEqual([
      expect.objectContaining({
        id: "install-location",
        label: "Installation Location",
        key: "installation.location",
        type: "select",
        default: "indoor",
        choices: [
          expect.objectContaining({ value: "indoor", label: "Indoor" }),
          expect.objectContaining({ value: "outdoor", label: "Outdoor", pricing: [{ mode: "addFlat", amountCents: 2500 }] }),
        ],
        routing: expect.objectContaining({ visibilityRules: [{ type: "truthy", selectionKey: "installation.required" }] }),
      }),
      expect.objectContaining({
        id: "installation-required",
        label: "Installation Required",
        key: "installation.required",
        type: "checkbox",
        default: true,
      }),
      expect.objectContaining({
        id: "installation-hardware",
        label: "Hardware",
        key: "installation.hardware",
        type: "radio",
        choices: [
          expect.objectContaining({ value: "standard", label: "Standard Hardware" }),
          expect.objectContaining({ value: "premium", label: "Premium Hardware", pricing: 1500 }),
        ],
        routing: expect.objectContaining({ edges: { children: [{ toNodeId: "install-location" }] } }),
      }),
      expect.objectContaining({
        id: "installation-access",
        label: "Access Type",
        key: "installation.access",
        type: "radio_group",
        choices: [
          expect.objectContaining({ value: "standard", label: "Standard Access" }),
          expect.objectContaining({ value: "ladder", label: "Ladder Access", pricing: { mode: "addFlat", amountCents: 3500 } }),
        ],
      }),
      expect.objectContaining({
        id: "installation-ladder-height",
        label: "Ladder Height",
        key: "installation.ladderHeight",
        type: "number_input",
        default: 8,
        routing: { routing: { requires: "ladder" } },
      }),
    ]);
  });

  test("PBV2 export still aborts truly empty active PBV2 trees", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_empty",
        name: "Empty PBV2",
        description: "Desc",
        optionTreeJson: null,
      }],
      new Map([[
        "prod_empty",
        {
          active: {
            schemaVersion: 2,
            treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: [] },
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    )).rejects.toMatchObject({
      message: expect.stringContaining("no exportable PBV2 options"),
      code: "PBV2_EXPORT_ZERO_OPTIONS",
      metadata: expect.objectContaining({
        productId: "prod_empty",
        productName: "Empty PBV2",
        totalTraversedNodes: 0,
        detectedOptionLikeNodes: 0,
      }),
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[PBV2 Export] Zero-option runtime tree",
      expect.objectContaining({
        productId: "prod_empty",
        productName: "Empty PBV2",
        rootKeys: ["nodes", "rootNodeIds", "schemaVersion"],
        totalTraversedNodes: 0,
        detectedOptionLikeNodes: 0,
      }),
    );
    consoleError.mockRestore();
  });

  test("PBV2 export still aborts populated trees with no serializable options or pricing config", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(exportProducts(
      { db: {} as any, organizationId: "org_1" },
      [{
        id: "prod_broken",
        name: "Broken Service Shell",
        description: "Desc",
        optionTreeJson: null,
      }],
      new Map([[
        "prod_broken",
        {
          active: {
            schemaVersion: 2,
            treeJson: brokenPopulatedZeroOptionTree,
            publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      ]]),
      [],
      [],
    )).rejects.toMatchObject({
      message: expect.stringContaining("produced zero options from a populated runtime tree"),
      code: "PBV2_EXPORT_ZERO_OPTIONS",
      metadata: expect.objectContaining({
        productId: "prod_broken",
        productName: "Broken Service Shell",
        totalTraversedNodes: 1,
        detectedOptionLikeNodes: 0,
      }),
    });
    consoleError.mockRestore();
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

  test("imported qty_only metadata does not make direct matrix base prices require tiers", () => {
    const importedTree = {
      schemaVersion: 2,
      meta: {
        pricingProfileKey: "qty_only",
        pricingV2: {
          tierBasis: "line_item_quantity",
          base: { perSqftCents: 0, perPieceCents: 0, minimumChargeCents: 0 },
          qtyTiers: [],
        },
      },
      pricingMatrix: {
        dimensions: ["finish"],
        rows: [
          { when: { finish: "economy" }, variables: { base_price: 7500 } },
          { when: { finish: "deluxe" }, variables: { base_price: 15000 } },
        ],
      },
    };
    const values = buildPbv2ImportProductValues({
      name: "Imported Banner Stand",
      description: "",
      pricingProfileKey: "qty_only",
      pbv2: { hasActiveTree: true, activeTree: { schemaVersion: 2, treeJson: importedTree, publishedAt: null }, hasDraft: false },
    } as any, {});

    expect(values.pricingProfileKey).toBe("qty_only");
    expect(validateTreeHasBasePrice(values.optionTreeJson).errors).toEqual([]);
  });

  test("PBV2 import remaps nested source material UUIDs to destination materials", () => {
    const tree = {
      schemaVersion: 2,
      nodes: {
        substrate: {
          id: "substrate",
          label: "Substrate",
          choices: [{
            value: "banner",
            materialOverride: { materialId: "source-material-id" },
            inventoryConsumption: [{ materialId: "source-material-id", quantityBasis: "area_sqft" }],
          }],
        },
      },
      effects: [{ type: "setMaterial", materialId: "source-material-id" }],
    };
    const resolution = resolvePortableMaterialReferences(
      { name: "Imported banner", description: "", pbv2: { hasActiveTree: true, activeTree: { schemaVersion: 2, treeJson: tree, publishedAt: null }, hasDraft: false } } as any,
      [{ id: "source-material-id", sku: "BANNER-13OZ", name: "13oz Banner" }],
      new Map([["banner-13oz", [{ id: "destination-material-id", sku: "BANNER-13OZ" }]]]),
    );
    expect(resolution.issues).toHaveLength(0);
    expect(resolution.resolved.treeMaterialIdMap).toEqual({ "source-material-id": "destination-material-id" });
    expect(remapPbv2TreeMaterialIds(tree, resolution.resolved.treeMaterialIdMap)).toMatchObject({
      nodes: { substrate: { choices: [{ materialOverride: { materialId: "destination-material-id" }, inventoryConsumption: [{ materialId: "destination-material-id" }] }] } },
      effects: [{ type: "setMaterial", materialId: "destination-material-id" }],
    });
  });

  test("PBV2 import rejects missing or ambiguous portable material dependencies", () => {
    const item = { name: "Imported banner", description: "", primaryMaterialSku: "BANNER-13OZ" } as any;
    expect(resolvePortableMaterialReferences(item, [], new Map())).toMatchObject({
      issues: [expect.objectContaining({ code: "MATERIAL_REFERENCE_UNRESOLVED" })],
    });
    expect(resolvePortableMaterialReferences(item, [], new Map([["banner-13oz", [{ id: "a" }, { id: "b" }]]]))).toMatchObject({
      issues: [expect.objectContaining({ code: "MATERIAL_REFERENCE_AMBIGUOUS" })],
    });
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

  test("PBV2 import accepts exported simple service product without orphaning tree rows", async () => {
    const exported = await exportProducts(
      { db: {} as any, organizationId: "source_org" },
      [{
        id: "prod_install_service",
        name: "Installation",
        description: "Installation service",
        pricingMode: "flat",
        pricingFormula: "flatFee",
        isService: true,
        optionTreeJson: null,
      }],
      new Map([["prod_install_service", { active: { schemaVersion: 2, treeJson: installationServicePricingTree } }]]),
      [],
      [],
    );
    const db = makeTransactionalImportDb();

    const result = await applyImport(
      {
        db: db.client as any,
        organizationId: "target_org",
        userId: "user_1",
        mode: "upsertBySlug",
      },
      exported,
    );

    expect(result.success).toBe(true);
    expect(result.counts.created).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(db.productInserts).toHaveLength(1);
    expect(db.treeInserts).toHaveLength(2);
    expect(db.treeInserts.map((row: any) => row.status).sort()).toEqual(["ACTIVE", "DRAFT"]);
    expect(db.treeInserts.every((row: any) => row.productId === db.productInserts[0].id)).toBe(true);
    expect(db.productUpdates.at(-1)).toMatchObject({
      optionTreeJson: installationServicePricingTree,
    });
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

function makeQueryResult(rows: any[]) {
  return {
    then: (resolve: (value: any[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
    limit: async () => rows,
    orderBy: async () => rows,
  };
}

function makeTransactionalImportDb() {
  const productInserts: any[] = [];
  const treeInserts: any[] = [];
  const productUpdates: any[] = [];

  const makeClient = (): any => ({
    select: () => ({
      from: () => ({
        where: () => makeQueryResult([]),
        limit: async () => [],
      }),
    }),
    insert: () => ({
      values: async (value: any) => {
        if (value?.status === "ACTIVE" || value?.status === "DRAFT") {
          treeInserts.push(value);
        } else {
          productInserts.push(value);
        }
      },
    }),
    delete: () => ({
      where: async () => undefined,
    }),
    update: () => ({
      set: (value: any) => {
        productUpdates.push(value);
        return { where: async () => undefined };
      },
    }),
    transaction: async (callback: (tx: any) => Promise<void>) => callback(makeClient()),
  });

  return {
    client: makeClient(),
    productInserts,
    treeInserts,
    productUpdates,
  };
}
