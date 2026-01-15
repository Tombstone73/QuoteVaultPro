import { describe, expect, test } from "@jest/globals";
import { buildDuplicatedProductInsert } from "../lib/duplicateProductTransform";
import type { Product } from "@shared/schema";

describe("buildDuplicatedProductInsert", () => {
  test("deep-copies nested JSON fields (no shared references)", () => {
    const original: Product = {
      id: "prod_1",
      organizationId: "org_1",
      name: "Banner",
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
      pricingFormulaId: null,
      useNestingCalculator: true,
      sheetWidth: "48.00" as any,
      sheetHeight: "96.00" as any,
      materialType: "roll" as any,
      minPricePerItem: "1.25" as any,
      nestingVolumePricing: { enabled: true, tiers: [{ minSheets: 1, pricePerSheet: 9.99 }] },
      requiresProductionJob: true,
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
      pricingFormulaId: null,
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet" as any,
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      requiresProductionJob: true,
      isTaxable: true,
      isActive: true,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    } satisfies Product;

    const dup = buildDuplicatedProductInsert(original);
    expect(dup.name).toBe("Widget (Copy)");
    expect(dup.isActive).toBe(false);
  });
});
