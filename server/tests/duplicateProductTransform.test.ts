import { describe, expect, test } from "@jest/globals";
import { buildDuplicatedProductInsert } from "../lib/duplicateProductTransform";
import type { Product } from "@shared/schema";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";

describe("buildDuplicatedProductInsert", () => {
  test("deep-copies nested JSON fields (no shared references)", () => {
    const original: Product = {
      id: "prod_1",
      organizationId: "org_1",
      name: "Banner",
      shopName: "Banner",
      description: "Desc",
      productTypeId: null,
      pricingFormula: "sqft * p * q",
      variantLabel: "Variant",
      category: "Signs",
      storeUrl: "https://example.com",
      showStoreLink: true,
      thumbnailUrls: ["a.png"],
      priceBreaks: { enabled: true, type: "quantity", tiers: [{ minValue: 1, discountType: "percentage", discountValue: 10 }] },
      pricingMode: "area",
      isService: false,
      primaryMaterialId: null,
      optionsJson: [{ id: "opt_1", name: "Size", type: "select", required: true, choices: [{ value: "S", label: "Small" }] } as any],
      optionTreeJson: { nodes: [{ id: "n1", type: "root" }], edges: [] } as any,
      pbv2ActiveTreeVersionId: null,
      artworkPolicy: "not_required" as any,
      pricingProfileKey: "default",
      pricingProfileConfig: { pbv2Override: { enabled: true, treeVersionId: "tv_1" }, nested: { a: 1 } } as any,
      pricingEngine: "formulaLibrary" as any,
      pricingFormulaId: null,
      useNestingCalculator: true,
      sheetWidth: "48.00" as any,
      sheetHeight: "96.00" as any,
      materialType: "roll" as any,
      minPricePerItem: "1.25" as any,
      nestingVolumePricing: { enabled: true, tiers: [{ minSheets: 1, pricePerSheet: 9.99 }] },
      requiresProductionJob: true,
      requiresProofApproval: true,
      isTaxable: true,
      isActive: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    };

    const dup = buildDuplicatedProductInsert(original);

    // mutate duplicate payload
    (dup.optionsJson as any)[0].name = "CHANGED";
    (dup as any).optionTreeJson.nodes[0].type = "changed";
    (dup.priceBreaks as any).tiers[0].discountValue = 99;
    (dup.pricingProfileConfig as any).nested.a = 999;
    (dup.thumbnailUrls as any).push("b.png");

    // original should remain unchanged
    expect((original.optionsJson as any)[0].name).toBe("Size");
    expect((original as any).optionTreeJson.nodes[0].type).toBe("root");
    expect((original.priceBreaks as any).tiers[0].discountValue).toBe(10);
    expect((original.pricingProfileConfig as any).nested.a).toBe(1);
    expect(original.thumbnailUrls).toEqual(["a.png"]);
    expect((dup as any).pricingEngine).toBe("formulaLibrary");
    expect(dup.shopName).toBe("Banner");
    expect((dup as any).requiresProofApproval).toBe(true);
  });

  test("sets name suffix and isActive=false", () => {
    const original = {
      id: "p1",
      organizationId: "org_1",
      name: "Widget",
      description: "Desc",
      productTypeId: null,
      pricingFormula: null,
      variantLabel: "Variant",
      category: null,
      storeUrl: null,
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: { enabled: false, type: "quantity", tiers: [] },
      pricingMode: "area",
      isService: false,
      primaryMaterialId: null,
      optionsJson: null,
      optionTreeJson: null,
      pbv2ActiveTreeVersionId: null,
      artworkPolicy: "not_required" as any,
      pricingProfileKey: "default",
      pricingProfileConfig: null,
      pricingEngine: "pricingProfile" as any,
      pricingFormulaId: null,
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet" as any,
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      requiresProductionJob: true,
      requiresProofApproval: false,
      isTaxable: true,
      isActive: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    } satisfies Product;

    const dup = buildDuplicatedProductInsert(original);
    expect(dup.name).toBe("Widget (Copy)");
    expect(dup.isActive).toBe(false);
  });

  test("clears legacy priceBreaks when duplicating PBV2 products", () => {
    const original = {
      id: "pbv2_1",
      organizationId: "org_1",
      name: "PBV2 Banner",
      description: "Desc",
      productTypeId: null,
      pricingFormula: null,
      variantLabel: "Variant",
      category: null,
      storeUrl: null,
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: { enabled: true, type: "quantity", tiers: [{ minValue: 1, discountType: "percentage", discountValue: 10 }] },
      pricingMode: "area",
      isService: false,
      primaryMaterialId: null,
      optionsJson: null,
      optionTreeJson: { schemaVersion: 2, nodes: {}, rootNodeIds: [] },
      pbv2ActiveTreeVersionId: null,
      artworkPolicy: "not_required" as any,
      pricingProfileKey: "default",
      pricingProfileConfig: null,
      pricingEngine: "pricingProfile" as any,
      pricingFormulaId: null,
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet" as any,
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      requiresProductionJob: true,
      requiresProofApproval: false,
      isTaxable: true,
      isActive: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    } satisfies Product;

    const dup = buildDuplicatedProductInsert(original);

    expect(dup.priceBreaks).toEqual({ enabled: false, type: "quantity", tiers: [] });
  });

  test("does not carry a stale choice consumption material into a PBV2 duplicate", () => {
    const original: any = {
      id: "pbv2_material_authority", organizationId: "org_1", name: "Foam Board", description: "", productTypeId: null, pricingFormula: null, variantLabel: "Variant", category: null, storeUrl: null, showStoreLink: true, thumbnailUrls: [], priceBreaks: { enabled: false, type: "quantity", tiers: [] }, pricingMode: "area", isService: false, primaryMaterialId: null, optionsJson: null,
      optionTreeJson: { schemaVersion: 2, nodes: { thickness: { id: "thickness", choices: [{ value: "3mm", materialOverride: { materialId: "oppbogga_3mm" }, inventoryConsumption: [{ materialId: "foam_half", quantityBasis: "area_sqft", multiplier: 2, wastePercent: 5 }] }] } }, edges: [] },
      pbv2ActiveTreeVersionId: null, artworkPolicy: "not_required", pricingProfileKey: "default", pricingProfileConfig: null, pricingEngine: "pricingProfile", pricingFormulaId: null, useNestingCalculator: false, sheetWidth: null, sheetHeight: null, materialType: "sheet", minPricePerItem: null, nestingVolumePricing: { enabled: false, tiers: [] }, requiresProductionJob: true, requiresProofApproval: false, isTaxable: true, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    };
    const duplicate: any = buildDuplicatedProductInsert(original);
    expect(duplicate.optionTreeJson.nodes.thickness.choices[0].inventoryConsumption[0]).toMatchObject({ materialId: "oppbogga_3mm", quantityBasis: "area_sqft", multiplier: 2, wastePercent: 5 });
    expect(original.optionTreeJson.nodes.thickness.choices[0].inventoryConsumption[0].materialId).toBe("foam_half");
  });

  test("preserves product option enabled states while keeping duplicate JSON independent", () => {
    const original = {
      id: "pbv2_disabled_option",
      organizationId: "org_1",
      name: "PBV2 Banner",
      description: "Desc",
      productTypeId: null,
      pricingFormula: null,
      variantLabel: "Variant",
      category: null,
      storeUrl: null,
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: { enabled: false, type: "quantity", tiers: [] },
      pricingMode: "area",
      isService: false,
      primaryMaterialId: null,
      optionsJson: null,
      optionTreeJson: {
        schemaVersion: 2,
        rootNodeIds: ["material"],
        nodes: {
          material: { id: "material", kind: "question", type: "INPUT", status: "ENABLED", input: { type: "select", selectionKey: "material" } },
          grommets: { id: "grommets", kind: "question", type: "INPUT", status: "DISABLED", input: { type: "boolean", selectionKey: "grommets" } },
        },
        edges: [],
      },
      pbv2ActiveTreeVersionId: null,
      artworkPolicy: "not_required" as any,
      pricingProfileKey: "default",
      pricingProfileConfig: null,
      pricingEngine: "pricingProfile" as any,
      pricingFormulaId: null,
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet" as any,
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      requiresProductionJob: true,
      requiresProofApproval: false,
      isTaxable: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
      isActive: true,
    } satisfies Product;

    const dup = buildDuplicatedProductInsert(original);

    expect((dup.optionTreeJson as any).nodes.grommets.status).toBe("DISABLED");
    (dup.optionTreeJson as any).nodes.grommets.status = "ENABLED";

    expect((original.optionTreeJson as any).nodes.grommets.status).toBe("DISABLED");
    expect((dup.optionTreeJson as any).nodes.grommets.status).toBe("ENABLED");
  });

  test("preserves canonical allowRotation when duplicating a product", () => {
    const original = {
      id: "rotation_product",
      organizationId: "org_1",
      name: "ACM",
      description: "Aluminum composite",
      productTypeId: null,
      pricingFormula: "sheet_consumption_sqft(w,h,q,48,96,24,12,3) * base_price",
      variantLabel: "Variant",
      category: "Rigid media",
      storeUrl: null,
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: { enabled: false, type: "quantity", tiers: [] },
      pricingMode: "area",
      isService: false,
      primaryMaterialId: null,
      optionsJson: null,
      optionTreeJson: null,
      pbv2ActiveTreeVersionId: null,
      artworkPolicy: "not_required" as any,
      pricingProfileKey: "default",
      pricingProfileConfig: { allowRotation: true, formulaVariables: { sheet_width: 48 } } as any,
      pricingEngine: "formulaLibrary" as any,
      pricingFormulaId: null,
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet" as any,
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      requiresProductionJob: true,
      requiresProofApproval: false,
      isTaxable: true,
      isActive: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    } satisfies Product;

    const duplicate = buildDuplicatedProductInsert(original);
    expect(duplicate.pricingProfileConfig).toEqual({
      allowRotation: true,
      formulaVariables: { sheet_width: 48 },
    });
  });

  test("preserves direct matrix pricing semantics for a qty_only PBV2 duplicate", () => {
    const tree = {
      schemaVersion: 2,
      status: "ACTIVE",
      meta: {
        pricingProfileKey: "qty_only",
        pricingV2: { tierBasis: "line_item_quantity", base: { perSqftCents: 0, perPieceCents: 0, minimumChargeCents: 0 }, qtyTiers: [] },
      },
      pricingMatrix: { dimensions: ["finish"], rows: [{ when: { finish: "economy" }, variables: { base_price: 7500 } }] },
    };
    const original = { id: "matrix_product", organizationId: "org_1", name: "Banner Stand", description: "", productTypeId: null, pricingFormula: null, variantLabel: null, category: null, storeUrl: null, showStoreLink: false, thumbnailUrls: [], priceBreaks: { enabled: false, type: "quantity", tiers: [] }, pricingMode: "quantity", isService: false, primaryMaterialId: null, optionsJson: null, optionTreeJson: tree, pbv2ActiveTreeVersionId: null, artworkPolicy: "not_required" as any, pricingProfileKey: "qty_only", pricingProfileConfig: null, pricingEngine: "pricingProfile" as any, pricingFormulaId: null, useNestingCalculator: false, sheetWidth: null, sheetHeight: null, materialType: "sheet" as any, minPricePerItem: null, nestingVolumePricing: { enabled: false, tiers: [] }, requiresProductionJob: true, requiresProofApproval: false, isTaxable: true, isActive: true, createdAt: new Date() as any, updatedAt: new Date() as any } satisfies Product;

    const duplicate = buildDuplicatedProductInsert(original);
    expect(validateTreeHasBasePrice(duplicate.optionTreeJson).errors).toEqual([]);
    expect((duplicate.optionTreeJson as any).pricingMatrix.rows[0].variables.base_price).toBe(7500);
    expect((duplicate.optionTreeJson as any).meta.pricingV2.qtyTiers).toEqual([]);
  });
});
