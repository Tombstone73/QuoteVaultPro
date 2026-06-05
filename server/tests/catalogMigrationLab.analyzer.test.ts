import { describe, expect, test } from "@jest/globals";
import { analyzeCatalogMigrationSource } from "../services/catalogMigrationLab/analyzer";
import { parseInfoFloJsonSource } from "../services/catalogMigrationLab/adapters/infoFloJsonAdapter";

const infoFloFixture = {
  exportName: "InfoFlo Products",
  products: [
    {
      productName: "13oz Banner",
      product_type: "modal_configurable",
      sku: "BNR-13",
      categoryName: "Banners",
      active: true,
      basePrice: 45,
      materials: [{ name: "13oz Scrim Banner" }],
      optionGroups: [
        { name: "Size", choices: ["Custom"] },
        { name: "Finishing", choices: ["Hem", "Grommets"] },
      ],
      form_fields: [
        {
          field_id: "unnamed",
          field_label: "Size",
          field_type: "select",
          required: true,
          options: [
            { option_text: "Standard 3x5", option_value: "3x5" },
            {
              option_text: "Custom Size",
              option_value: "custom",
              reveal_fields: [
                { field_id: "unnamed", field_label: "Width", field_type: "number", input_type: "decimal", required: true },
                { field_id: "unnamed", field_label: "Height", field_type: "number", input_type: "decimal", required: true },
              ],
            },
          ],
        },
        {
          field_id: "unnamed",
          field_label: "Finishing",
          field_type: "checkbox",
          options: [
            { option_text: "Hems", option_value: "hems" },
            { option_text: "Grommets", option_value: "grommets" },
          ],
        },
        {
          field_id: "unnamed",
          field_label: "Material",
          field_type: "select",
          options: [
            { option_text: "13oz Scrim Banner", option_value: "13oz" },
            { option_text: "18oz Blockout Banner", option_value: "18oz" },
          ],
        },
      ],
      conditional_fields_map: {
        unnamed: {
          grommets: [
            { field_id: "unnamed", field_label: "Grommet Spacing", field_type: "select", options: ["Every 2 ft", "Corners only"] },
          ],
        },
      },
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
      productType: "modal_configurable",
      status: "active",
      materialReferences: ["13oz Scrim Banner"],
    });
    expect(parsed.products[0].optionNames).toEqual(expect.arrayContaining(["Finishing", "Grommet Spacing", "Height", "Material", "Size", "Width"]));
    expect(parsed.products[0].sourceFields.length).toBeGreaterThanOrEqual(10);
    expect(parsed.products[0].sourceFields.every((field) => !field.analyzerId.includes("unnamed"))).toBe(true);
    expect(parsed.products[0].sourceFields.find((field) => field.fieldLabel === "Width")).toMatchObject({
      parentField: "Size",
      parentOption: "Custom Size",
      level: 1,
      conditional: true,
    });
    expect(parsed.conditionalLogic).toEqual(expect.arrayContaining([
      expect.objectContaining({ productName: "13oz Banner", parentField: "Size", parentOption: "Custom Size", childField: "Width" }),
      expect.objectContaining({ productName: "13oz Banner", parentOption: "grommets", childField: "Grommet Spacing" }),
    ]));
    expect(parsed.warnings.map((warning) => warning.code)).toContain("UNNAMED_FIELD_ID");
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
    expect(result.productStructures[0]).toMatchObject({
      productName: "13oz Banner",
      productType: "modal_configurable",
      quantityFieldDetected: false,
      detectedConditionalLogic: true,
    });
    expect(result.productStructures[0].sizeFieldsDetected).toEqual(expect.arrayContaining(["Height", "Size", "Width"]));
    expect(result.productStructures[0].finishingOptionsDetected).toEqual(expect.arrayContaining(["Grommets", "Hems"]));
    expect(result.productStructures[0].materialsDetected).toEqual(expect.arrayContaining(["13oz Scrim Banner", "18oz Blockout Banner"]));
    expect(result.conditionalLogic.map((logic) => logic.childField)).toEqual(expect.arrayContaining(["Width", "Height", "Grommet Spacing"]));
    expect(result.optionPatterns.find((option) => option.optionName === "Size")?.sampleValues).toEqual(
      expect.arrayContaining(["Standard 3x5", "Custom Size"]),
    );
    expect(result.migrationWorksheets.productSummary).toContain("product_name,product_type,suggested_category");
    expect(result.migrationWorksheets.productSummary).toContain("13oz Banner,modal_configurable,Banners");
    expect(result.migrationWorksheets.productFields).toContain("product_name,field_label,field_type,required,option_text");
    expect(result.migrationWorksheets.productFields).toContain("13oz Banner,Size,select,yes,Custom Size,custom");
    expect(result.migrationWorksheets.optionGroupDiscovery).toContain("option_group_name,usage_count,products_using_group,sample_values");
    expect(result.migrationWorksheets.optionGroupDiscovery).toContain("Size");
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["MISSING_PRICING", "MISSING_OPTIONS", "DUPLICATE_PRODUCT_NAME", "UNNAMED_FIELD_ID"]),
    );
  });
});
