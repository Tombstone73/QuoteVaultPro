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
      product_index: 0,
      dropdown_count: 3,
      conditional_dropdown_count: 1,
      total_fields: 10,
      total_conditional_fields: 3,
      has_conditional_fields: true,
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
      productName: "Acrylic Panel",
      product_type: "modal_configurable",
      active: true,
      form_fields: [
        { field_id: "unnamed", field_label: "Width", field_type: "input", input_type: "number", required: true },
        { field_id: "unnamed", field_label: "Height", field_type: "input", input_type: "number", required: true },
        { field_id: "unnamed", field_type: "input", input_type: "number", min: 1, step: 1 },
        { field_id: "unnamed", field_label: "Special Instructions", field_type: "textarea" },
        { field_id: "unnamed", field_label: "Special Instructions", field_type: "textarea" },
        { field_id: "unnamed", field_label: "Bill To email", field_type: "input", input_type: "email" },
      ],
    },
    {
      productName: "Coro Yard Sign",
      product_type: "modal_configurable",
      form_fields: [
        { field_id: "unnamed", field_label: "Stake", field_type: "select", options: ["None", "H Stake"] },
      ],
    },
    {
      productName: "Mesh Banner",
      product_type: "modal_configurable",
      form_fields: [
        { field_id: "unnamed", field_label: "Square Footage", field_type: "input", input_type: "number" },
      ],
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
    expect(parsed.products).toHaveLength(6);
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
    expect(parsed.products[1].sourceFields.find((field) => field.isQuantityCandidate)).toMatchObject({
      fieldLabel: "Quantity candidate",
      normalizedFieldLabel: "Quantity candidate",
      normalizedGroup: "Quantity",
    });
    expect(parsed.products[1].sourceFields.find((field) => field.fieldLabel === "Bill To email")).toMatchObject({
      normalizedGroup: "Customer Metadata",
      isCustomerMetadata: true,
    });
    expect(parsed.products[3].sourceFields.find((field) => field.fieldLabel === "Square Footage")).toMatchObject({
      normalizedGroup: "Size / Pricing Signal",
      isPricingSignal: true,
    });
    expect(parsed.conditionalLogic).toEqual(expect.arrayContaining([
      expect.objectContaining({ productName: "13oz Banner", parentField: "Size", parentOption: "Custom Size", childField: "Width" }),
      expect.objectContaining({ productName: "13oz Banner", parentOption: "grommets", childField: "Grommet Spacing" }),
    ]));
    expect(parsed.warnings.map((warning) => warning.code)).toContain("UNNAMED_FIELD_ID");
    const coroplastSign = parsed.products.find((product) => product.name === "Coroplast Sign");
    expect(coroplastSign?.pricingFields.map((field) => field.fieldName)).toEqual(
      expect.arrayContaining(["height", "priceBreaks", "width"]),
    );
    expect(parsed.warnings.some((warning) => warning.code === "DUPLICATE_PRODUCT_NAME")).toBe(true);
    expect(parsed.unsupportedFields.map((field) => field.fieldName)).toEqual(
      expect.arrayContaining(["infoFloInternalId"]),
    );
    expect(parsed.unsupportedFields.map((field) => field.fieldName)).not.toEqual(
      expect.arrayContaining(["product_index", "dropdown_count", "conditional_dropdown_count", "total_fields", "total_conditional_fields", "has_conditional_fields"]),
    );
    expect(parsed.productDefinitionMetadata).toMatchObject({
      productIndexFieldCount: 1,
      dropdownCount: expect.any(Number),
      conditionalDropdownCount: expect.any(Number),
      totalFields: expect.any(Number),
      totalConditionalFields: expect.any(Number),
      hasConditionalFields: true,
    });
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
      totalProducts: 6,
      activeProducts: 2,
      inactiveProducts: 1,
      unknownStatusProducts: 3,
    });
    expect(result.categories.map((category) => category.category)).toEqual(["(missing category)", "Banners", "Rigid Signs"]);
    expect(result.optionPatterns.find((option) => option.optionName === "Size")?.likelyReusableGroup).toBe(true);
    expect(result.optionPatterns.find((option) => option.optionName === "Other Product Field")).toBeUndefined();
    expect(result.optionPatterns.find((option) => option.optionName === "Unknown")).toBeUndefined();
    expect(result.optionPatterns.find((option) => option.optionName === "Customer Metadata")).toBeUndefined();
    expect(result.materialCandidates.find((material) => material.reference === "13oz Scrim Banner")?.matchedMaterial?.id).toBe("mat-banner");
    expect(result.pricingPatterns.map((pattern) => pattern.bucket)).toEqual(
      expect.arrayContaining(["flat_price", "tiered_pricing", "missing_pricing"]),
    );
    expect(result.productStructures[0]).toMatchObject({
      productName: "13oz Banner",
      productType: "modal_configurable",
      suggestedCategory: "Banners",
      categoryConfidence: "source",
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
    expect(result.source.productDefinitionMetadata).toMatchObject({
      productIndexFieldCount: 1,
      hasConditionalFields: true,
    });
    const acrylic = result.productStructures.find((product) => product.productName === "Acrylic Panel");
    const coro = result.productStructures.find((product) => product.productName === "Coro Yard Sign");
    const meshBanner = result.productStructures.find((product) => product.productName === "Mesh Banner");
    expect(acrylic).toMatchObject({
      suggestedCategory: "Acrylic / Rigid Sheet",
      categoryConfidence: "high",
      quantityFieldDetected: true,
      pricingSourceStatus: "definition_only_no_pricing",
    });
    expect(acrylic?.infoCount).toBeGreaterThan(0);
    expect(coro).toMatchObject({ suggestedCategory: "Coroplast / Yard Signs", categoryConfidence: "high" });
    expect(meshBanner).toMatchObject({ suggestedCategory: "Banners", categoryConfidence: "high" });
    expect(result.warningCounts.actionable).toBe(result.warningCounts.blockers + result.warningCounts.warnings);
    expect(result.warningCounts.info).toBeGreaterThan(result.warningCounts.actionable);
    expect(result.warnings.every((warning) => warning.severity === "info" || warning.severity === "warning" || warning.severity === "blocker")).toBe(true);
    expect(result.warnings.find((warning) => warning.code === "MISSING_PRICING" && warning.productName === "Acrylic Panel")?.severity).toBe("info");
    expect(result.warnings.find((warning) => warning.code === "UNNAMED_FIELD_ID" && warning.productName === "13oz Banner" && warning.fieldLabel === "Size")).toMatchObject({
      severity: "info",
      occurrences: 1,
    });
    expect(result.warnings.find((warning) => warning.code === "UNNAMED_FIELD_ID" && warning.productName === "Acrylic Panel" && warning.fieldLabel === "Special Instructions")).toMatchObject({
      occurrences: 2,
    });
    expect(result.migrationWorksheets.productSummary).toContain("product_name,product_type,blocker_count,warning_count,info_count,suggested_category,category_confidence");
    expect(result.migrationWorksheets.productSummary).toContain("Acrylic Panel,modal_configurable,0,0,");
    expect(result.migrationWorksheets.productFields).toContain("product_name,field_label,normalized_field_label,field_type,required,option_text");
    expect(result.migrationWorksheets.productFields).toContain("Acrylic Panel,Quantity candidate,Quantity candidate,input,no,,,,,0,no,Quantity,Quantity,yes,no,no");
    expect(result.migrationWorksheets.optionGroupDiscovery).toContain("option_group_name,usage_count,products_using_group,sample_values");
    expect(result.migrationWorksheets.optionGroupDiscovery).toContain("Size");
    const bannerReadiness = result.migrationReadiness.find((product) => product.sourceProductName === "13oz Banner");
    const acrylicReadiness = result.migrationReadiness.find((product) => product.sourceProductName === "Acrylic Panel");
    const coroReadiness = result.migrationReadiness.find((product) => product.sourceProductName === "Coro Yard Sign");
    const meshReadiness = result.migrationReadiness.find((product) => product.sourceProductName === "Mesh Banner");
    expect(bannerReadiness).toMatchObject({
      suggestedProductTemplate: "Banner Product",
      templateConfidence: "high",
      suggestedRoutingTemplate: "Prepress -> Roll Print -> Finishing",
      routingConfidence: "high",
      suggestedMaterial: "13oz Scrim Banner",
      matchedMaterial: expect.objectContaining({ id: "mat-banner" }),
      materialMatchConfidence: "high",
    });
    expect(typeof bannerReadiness?.migrationConfidence).toBe("number");
    expect(bannerReadiness?.migrationConfidence).toBeGreaterThan(0);
    expect(acrylicReadiness).toMatchObject({
      suggestedProductTemplate: "Rigid Sheet Product",
      suggestedRoutingTemplate: "Prepress -> Flatbed -> Finishing",
    });
    expect(coroReadiness).toMatchObject({
      suggestedProductTemplate: "Rigid Sheet Product",
      suggestedRoutingTemplate: "Prepress -> Flatbed -> Finishing",
    });
    expect(meshReadiness).toMatchObject({
      suggestedProductTemplate: "Banner Product",
      suggestedRoutingTemplate: "Prepress -> Roll Print -> Finishing",
    });
    expect(result.migrationReadiness.every((product) => product.migrationConfidence >= 0 && product.migrationConfidence <= 100)).toBe(true);
    expect(result.migrationReadiness.every((product) =>
      ["Ready", "Needs Review", "Complex", "Manual Build Recommended"].includes(product.readyForImport),
    )).toBe(true);
    expect(result.migrationWorksheets.catalogMigrationWorksheet).toContain(
      "Source Product Name,Suggested TitanOS Product Name,Suggested Category,Category Confidence,Suggested Product Template,Suggested Routing Template,Suggested Material,Detected Materials,Detected Option Groups,Detected Size Fields,Detected Quantity Field,Conditional Logic Present,Complexity Score,Migration Confidence,Ready For Import,Migration Notes",
    );
    expect(result.migrationWorksheets.catalogMigrationWorksheet).toContain("Acrylic Panel,Acrylic Panel,Acrylic / Rigid Sheet,high,Rigid Sheet Product,Prepress -> Flatbed -> Finishing");
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["MISSING_PRICING", "MISSING_OPTIONS", "DUPLICATE_PRODUCT_NAME", "UNNAMED_FIELD_ID"]),
    );
  });
});
