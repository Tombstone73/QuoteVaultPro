import { describe, expect, test } from "@jest/globals";
import { analyzeCatalogMigrationSource } from "../services/catalogMigrationLab/analyzer";
import { parseInfoFloJsonSource } from "../services/catalogMigrationLab/adapters/infoFloJsonAdapter";

const infoFloFixture = {
  exportName: "InfoFlo Products",
  products: [
    {
      productName: "13oz Banner",
      sku: "BNR-13",
      categoryName: "Banners",
      active: true,
      basePrice: 45,
      materials: [{ name: "13oz Scrim Banner" }],
      optionGroups: [
        { name: "Size", choices: ["Custom"] },
        { name: "Finishing", choices: ["Hem", "Grommets"] },
      ],
      infoFloInternalId: "if-100",
    },
    {
      productName: "Coroplast Sign",
      itemNo: "CORO-4MM",
      categoryName: "Rigid Signs",
      status: "Inactive",
      width: 24,
      height: 18,
      priceBreaks: [{ minQty: 1, price: 18 }],
      material: "4mm White Coroplast",
      options: [{ optionName: "Size" }, { optionName: "Lamination" }],
      infoFloInternalId: "if-200",
    },
    {
      productName: "13oz Banner",
      categoryName: "Banners",
      customExportBlob: { nested: true },
    },
  ],
};

describe("InfoFlo catalog migration adapter", () => {
  test("normalizes product-like records from an InfoFlo-style JSON export", () => {
    const parsed = parseInfoFloJsonSource(infoFloFixture);

    expect(parsed.detectedProductPath).toBe("$.products");
    expect(parsed.products).toHaveLength(3);
    expect(parsed.products[0]).toMatchObject({
      name: "13oz Banner",
      sku: "BNR-13",
      category: "Banners",
      status: "active",
      optionNames: ["Finishing", "Size"],
      materialReferences: ["13oz Scrim Banner"],
    });
    expect(parsed.products[1].pricingFields.map((field) => field.fieldName)).toEqual(
      expect.arrayContaining(["height", "priceBreaks", "width"]),
    );
    expect(parsed.warnings.some((warning) => warning.code === "DUPLICATE_PRODUCT_NAME")).toBe(true);
    expect(parsed.unsupportedFields.map((field) => field.fieldName)).toEqual(
      expect.arrayContaining(["infoFloInternalId"]),
    );
  });

  test("fails safely for an unknown source shape", () => {
    const parsed = parseInfoFloJsonSource({ company: "Titan Graphics", exportedAt: "2026-06-05" });

    expect(parsed.products).toEqual([]);
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["NO_PRODUCTS_FOUND", "UNKNOWN_SOURCE_SHAPE"]),
    );
  });
});

describe("Catalog Migration Lab analyzer", () => {
  test("returns catalog intelligence without creating drafts or imports", () => {
    const result = analyzeCatalogMigrationSource(
      {
        adapter: "infoflo-json",
        fileName: "infoflo-products.json",
        sourceJson: infoFloFixture,
      },
      {
        materials: [
          { id: "mat-banner", sku: "BNR13", name: "13oz Scrim Banner" },
          { id: "mat-coro", sku: "CORO4MM", name: "4mm White Coroplast" },
        ],
      },
    );

    expect(result.source.adapter).toBe("infoflo-json");
    expect(result.source.fingerprint).toHaveLength(64);
    expect(result.counts).toMatchObject({
      totalProducts: 3,
      activeProducts: 1,
      inactiveProducts: 1,
      unknownStatusProducts: 1,
    });
    expect(result.categories.map((category) => category.category)).toEqual(["Banners", "Rigid Signs"]);
    expect(result.optionPatterns.find((option) => option.optionName === "Size")?.likelyReusableGroup).toBe(true);
    expect(result.materialCandidates.find((material) => material.reference === "13oz Scrim Banner")?.matchedMaterial?.id).toBe("mat-banner");
    expect(result.pricingPatterns.map((pattern) => pattern.bucket)).toEqual(
      expect.arrayContaining(["flat_price", "tiered_pricing", "missing_pricing"]),
    );
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["MISSING_PRICING", "MISSING_OPTIONS", "DUPLICATE_PRODUCT_NAME"]),
    );
  });
});
