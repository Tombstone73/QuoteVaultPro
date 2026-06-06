import { describe, expect, test } from "@jest/globals";
import {
  productIntakeBriefSchema,
  productIntakeWizardAnalyzeRequestSchema,
} from "../../shared/productIntakeWizardSchemas";
import { analyzeCatalogMigrationSource } from "../services/catalogMigrationLab/analyzer";
import {
  type ProductIntakeAiDiagnosticInput,
} from "../services/productIntakeWizard/productIntakeDiagnosticsService";
import {
  detectRedundantFields,
  generateProductIntakeBrief,
  matchOptionTemplates,
  normalizeProductIntakeBehaviorAlias,
  normalizeProductIntakeConfidence,
  repairProductIntakeBriefShape,
  type ProductIntakeTemplateReference,
} from "../services/productIntakeWizard/productIntakeBriefService";

const templates: ProductIntakeTemplateReference[] = [
  {
    id: "tpl_grommets",
    name: "Grommets",
    slug: "grommets",
    category: "finishing",
    tags: ["banner", "hardware", "finishing"],
    workflowMetadata: { finishing_required: true },
    templateTree: {
      nodes: {
        group_grommets: { label: "Grommets", name: "Grommets" },
        opt_grommet_placement: {
          label: "Grommet Placement",
          input: { choices: [{ label: "Corners" }, { label: "Every 2 Feet" }] },
        },
      },
    },
  },
  {
    id: "tpl_turnaround",
    name: "Turnaround",
    slug: "turnaround",
    category: "scheduling",
    tags: ["rush", "service"],
    workflowMetadata: { scheduling_impact: true },
    templateTree: {
      nodes: {
        group_turnaround: { label: "Turnaround", name: "Turnaround" },
        opt_turnaround: {
          label: "Turnaround",
          input: { choices: [{ label: "Standard" }, { label: "Rush" }] },
        },
      },
    },
  },
];

const sourceJson = {
  products: [
    {
      productName: "Foam Board Sign",
      product_type: "modal_configurable",
      categoryName: "Foam Board",
      active: true,
      material: "3/16 White Foam Board",
      priceBreaks: [{ minQty: 1, price: 20 }],
      form_fields: [
        { field_id: "width", field_label: "Width", field_type: "input", input_type: "number", required: true },
        { field_id: "height", field_label: "Height", field_type: "input", input_type: "number", required: true },
        {
          field_id: "grommets",
          field_label: "Grommets",
          field_type: "select",
          required: false,
          options: [{ option_text: "None" }, { option_text: "Corners" }],
        },
        { field_id: "instructions_a", field_label: "Special Instructions", field_type: "textarea" },
        { field_id: "instructions_b", field_label: "Special Instructions", field_type: "textarea" },
        { field_id: "customer_email", field_label: "Bill To Email", field_type: "input", input_type: "email" },
      ],
      infoFloInternalId: "if_123",
    },
  ],
};

describe("Product Intake Wizard schemas", () => {
  test("accepts JSON and text-description requests", () => {
    expect(productIntakeWizardAnalyzeRequestSchema.parse({
      sourceType: "pasted_json",
      jsonText: JSON.stringify(sourceJson),
    }).sourceType).toBe("pasted_json");

    expect(productIntakeWizardAnalyzeRequestSchema.parse({
      sourceType: "text_description",
      description: "Foam board signs with optional grommets",
    }).sourceType).toBe("text_description");
  });
});

describe("Product Intake Brief service", () => {
  test("matches existing option templates with threshold recommendations", () => {
    const matches = matchOptionTemplates({
      optionLabel: "Grommets",
      sampleValues: ["Corners", "Every 2 Feet"],
      sourcePaths: ["$.products[0].form_fields[2]"],
      templates,
    });

    expect(matches[0]).toMatchObject({
      templateId: "tpl_grommets",
      recommendation: "suggest_reuse",
    });
    expect(matches.every((match) => match.score >= 0.65)).toBe(true);
  });

  test("classifies duplicate labels, customer metadata, and internal IDs as redundant candidates", () => {
    const analyzer = analyzeCatalogMigrationSource(
      { adapter: "infoflo-json", sourceJson },
      { materials: [{ id: "mat_foam", sku: "FOAM316", name: "3/16 White Foam Board" }] },
    );

    const redundant = detectRedundantFields(analyzer);

    expect(redundant.map((field) => field.category)).toEqual(expect.arrayContaining([
      "duplicate_label",
      "customer_metadata",
      "internal_id",
    ]));
    expect(redundant.every((field) => field.evidence.length > 0)).toBe(true);
  });

  test("generates a review-ready brief without products or PBV2 drafts", async () => {
    const analyzer = analyzeCatalogMigrationSource(
      { adapter: "infoflo-json", sourceJson },
      { materials: [{ id: "mat_foam", sku: "FOAM316", name: "3/16 White Foam Board" }] },
    );

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "pasted_json", jsonText: JSON.stringify(sourceJson) },
      analyzer,
      templates,
      provider: null,
    });

    expect(productIntakeBriefSchema.parse(brief).workflowState).toBe("REVIEW_READY");
    expect(brief.productIdentity.likelyProductName.value).toBe("Foam Board Sign");
    expect(brief.materialAnalysis.likelyMaterialMatches[0]).toMatchObject({ materialId: "mat_foam" });
    expect(brief.optionalOptions.some((option) => option.normalizedGroup === "Finishing")).toBe(true);
    expect(brief.templateMatches.some((match) => match.templateId === "tpl_grommets")).toBe(true);
    expect(brief.sourceEvidence.length).toBeGreaterThan(0);
  });

  test("generates a low-write text-description brief", async () => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "Foam board signs with optional grommets" },
      analyzer: null,
      templates,
      provider: null,
    });

    expect(brief.workflowState).toBe("REVIEW_READY");
    expect(brief.productIdentity.likelyProductName.value).toBe("Foam board signs");
    expect(brief.productIdentity.category.value).toBe("Foam Board");
    expect(brief.missingDecisions.some((decision) => decision.id === "select-material")).toBe(true);
  });

  test("extracts rigid styrene product structure from realistic text", async () => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: {
        sourceType: "text_description",
        description: ".040 rigid styrene sheets\n\nSizes:\n12x18\n18x24\n24x36\n\nSingle sided or double sided.\n\nFull color printing.\n\nOptional rounded corners.",
      },
      analyzer: null,
      templates,
      materials: [
        { id: "mat_020", sku: "STY020", name: "Styrene .020" },
        { id: "mat_030", sku: "STY030", name: "Styrene .030" },
        { id: "mat_040", sku: "STY040", name: "Styrene .040" },
        { id: "mat_060", sku: "STY060", name: "Styrene .060" },
      ],
      provider: null,
    });

    expect(brief.productIdentity.likelyProductName.value).toBe("Styrene Signs");
    expect(brief.productIdentity.category.value).toBe("Rigid Signs");
    expect(brief.materialAnalysis.detectedMaterialReferences).toContain("Styrene .040");
    expect(brief.materialAnalysis.likelyMaterialMatches[0]).toMatchObject({ materialId: "mat_040", name: "Styrene .040" });
    expect(brief.sizeBehavior.behavior).toBe("fixed_size");
    expect(brief.sizeBehavior.evidence[0].value).toContain("12x18");
    expect(brief.quantityBehavior.behavior).toBe("per_piece");
    expect(brief.pricingAnalysis.behavior).toBe("matrix_or_tiered");
    expect(brief.requiredOptions.find((option) => option.normalizedGroup === "Size")?.sampleValues).toEqual(["12x18", "18x24", "24x36"]);
    expect(brief.requiredOptions.find((option) => option.normalizedGroup === "Printed Sides")?.sampleValues).toEqual(["Single sided", "Double sided"]);
    expect(brief.optionalOptions.find((option) => option.normalizedGroup === "Finishing")?.sampleValues).toContain("Rounded corners");
  });

  test("extracts banner setup signals from realistic text", async () => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: {
        sourceType: "text_description",
        description: [
          "13oz banner",
          "Custom width and height",
          "Single sided",
          "Hemming optional",
          "Grommets optional",
          "Pole pockets optional",
          "Quantity based pricing",
          "Route to roll printer",
          "Proof required",
        ].join("\n"),
      },
      analyzer: null,
      templates,
      materials: [{ id: "mat_banner", sku: "BAN13", name: "13oz Scrim Banner" }],
      provider: null,
    });

    expect(brief.productIdentity.likelyProductName.value).toBe("13oz Banner");
    expect(brief.productIdentity.category.value).toBe("Banners");
    expect(brief.materialAnalysis.likelyMaterialMatches[0]).toMatchObject({ materialId: "mat_banner" });
    expect(brief.sizeBehavior.behavior).toBe("custom_size");
    expect(brief.quantityBehavior.behavior).toBe("quantity_tiers");
    expect(brief.pricingAnalysis.behavior).toBe("quantity_tiers");
    expect(brief.requiredOptions.find((option) => option.normalizedGroup === "Printed Sides")?.sampleValues).toContain("Single sided");
    expect(brief.optionalOptions.find((option) => option.normalizedGroup === "Finishing")?.sampleValues).toEqual(expect.arrayContaining(["Hemming", "Grommets", "Pole pockets"]));
    expect(brief.draftWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["proof_required", "routing_signal"]));
  });

  test("normalizes common behavior and confidence aliases", () => {
    expect(normalizeProductIntakeBehaviorAlias("quantity-tier", "pricing")).toBe("quantity_tiers");
    expect(normalizeProductIntakeBehaviorAlias("quantity tiers", "pricing")).toBe("quantity_tiers");
    expect(normalizeProductIntakeBehaviorAlias("tiered", "pricing")).toBe("quantity_tiers");
    expect(normalizeProductIntakeBehaviorAlias("custom width and height", "size")).toBe("custom_size");
    expect(normalizeProductIntakeBehaviorAlias("width_height", "size")).toBe("custom_size");
    expect(normalizeProductIntakeBehaviorAlias("roll-to-roll", "routing")).toBe("roll_printer");
    expect(normalizeProductIntakeConfidence("85%")).toBe(85);
    expect(normalizeProductIntakeConfidence("high")).toBe(85);
  });

  test("repairs aliases, missing arrays, and source text evidence into a valid brief", async () => {
    const deterministic = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "13oz banner custom width and height quantity tier pricing" },
      analyzer: null,
      templates,
      provider: null,
    });

    const repair = repairProductIntakeBriefShape({
      productName: "13oz Banner",
      productCategory: "Banners",
      productType: "banner",
      pricingModel: "quantity tiers",
      sizeBehavior: "custom width and height",
      confidence: "85%",
      options: {
        required: ["Custom width and height"],
        optional: ["Grommets", "Pole pockets"],
      },
    }, deterministic, { sourcePath: "$.source_text" });

    const parsed = productIntakeBriefSchema.parse(repair.repaired);
    expect(parsed.productIdentity.likelyProductName.value).toBe("13oz Banner");
    expect(parsed.productIdentity.category.value).toBe("Banners");
    expect(parsed.productIdentity.productType.value).toBe("banner");
    expect(parsed.pricingAnalysis.behavior).toBe("quantity_tiers");
    expect(parsed.sizeBehavior.behavior).toBe("custom_size");
    expect(parsed.overallConfidence).toBe(85);
    expect(parsed.requiredOptions).toEqual(expect.any(Array));
    expect(parsed.optionalOptions).toEqual(expect.any(Array));
    expect(parsed.redundantFields).toEqual(expect.any(Array));
    expect(parsed.productIdentity.likelyProductName.evidence[0].sourcePath).toBe("$.source_text");
    expect(repair.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      "productIdentity.likelyProductName",
      "pricingAnalysis",
      "requiredOptions",
      "optionalOptions",
    ]));
  });

  test("repairs simple AI schema shape before falling back", async () => {
    const diagnostics: ProductIntakeAiDiagnosticInput[] = [];
    const provider = {
      generateJson: async () => ({
        rawText: JSON.stringify({ name: "AI Styrene Signs", category: "Rigid Signs", material: "styrene", sizes: ["12x18"] }),
        provider: "openai",
        model: "test-model",
        requestMetadata: {},
      }),
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "styrene signs" },
      analyzer: null,
      templates,
      provider,
      diagnosticsStore: {
        recordSchemaValidationFailure: async (input) => {
          diagnostics.push(input);
        },
        attachRecentToSession: async () => undefined,
        listRecent: async () => [],
      },
    });

    expect(brief.source).toBe("live_ai");
    expect(brief.aiRepair?.accepted).toBe(true);
    expect(brief.productIdentity.likelyProductName.value).toBe("AI Styrene Signs");
    expect(brief.materialAnalysis.detectedMaterialReferences).toContain("styrene");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].validationErrors).toEqual([]);
    expect(diagnostics[0].repairActions?.length).toBeGreaterThan(0);
  });

  test("repairs representative banner AI output and avoids fallback", async () => {
    const diagnostics: ProductIntakeAiDiagnosticInput[] = [];
    const provider = {
      generateJson: async () => ({
        rawText: JSON.stringify({
          productName: "13oz Banner",
          productCategory: "Banners",
          productType: "banner",
          materials: ["13oz Banner"],
          pricingModel: "quantity tiers",
          sizeBehavior: "custom width and height",
          quantityBehavior: "tiers",
          options: {
            required: ["Custom width and height"],
            optional: ["Grommets", "Pole pockets", "Double-sided"],
          },
          warnings: ["Roll printer routing", "Proof required"],
          confidence: "85%",
        }),
        provider: "openai",
        model: "test-model",
        requestMetadata: {},
      }),
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "13oz banner custom width and height quantity tier pricing route to roll printer proof required" },
      analyzer: null,
      templates,
      materials: [{ id: "mat_banner", sku: "BAN13", name: "13oz Scrim Banner" }],
      provider,
      diagnosticsStore: {
        recordSchemaValidationFailure: async (input) => {
          diagnostics.push(input);
        },
        attachRecentToSession: async () => undefined,
        listRecent: async () => [],
      },
    });

    expect(brief.source).toBe("live_ai");
    expect(brief.fallbackReason).toBeNull();
    expect(brief.aiRepair?.accepted).toBe(true);
    expect(brief.productIdentity.likelyProductName.value).toBe("13oz Banner");
    expect(brief.productIdentity.category.value).toBe("Banners");
    expect(brief.pricingAnalysis.behavior).toBe("quantity_tiers");
    expect(brief.sizeBehavior.behavior).toBe("custom_size");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].validationErrors).toEqual([]);
    expect(diagnostics[0].repairActions?.map((action) => action.path)).toEqual(expect.arrayContaining(["pricingAnalysis", "overallConfidence"]));
  });

  test("records AI schema validation diagnostics without changing fallback behavior", async () => {
    const diagnostics: ProductIntakeAiDiagnosticInput[] = [];
    const provider = {
      generateJson: async () => ({
        rawText: JSON.stringify({ workflowState: "REVIEW_READY", source: "live_ai" }),
        provider: "openai",
        model: "test-model",
        requestMetadata: {},
      }),
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "Foam board signs" },
      analyzer: null,
      templates,
      provider,
      createdByUserId: "user_1",
      diagnosticsStore: {
        recordSchemaValidationFailure: async (input) => {
          diagnostics.push(input);
        },
        attachRecentToSession: async () => undefined,
        listRecent: async () => [],
      },
    });

    expect(brief.source).toBe("rule_based_fallback");
    expect(brief.fallbackReason).toContain("could not be safely normalized");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      organizationId: "org_1",
      sourceType: "text_description",
      provider: "openai",
      model: "test-model",
      createdByUserId: "user_1",
    });
    expect(diagnostics[0].rawAiResponse).toContain("workflowState");
    expect(diagnostics[0].failedSchemaPaths.length).toBeGreaterThan(0);
    expect(diagnostics[0].repairActions).toEqual(expect.any(Array));
    expect(diagnostics[0].repairActions).toHaveLength(0);
    expect(JSON.stringify(diagnostics[0])).not.toMatch(/apiKey|sk-/i);
  });
});
