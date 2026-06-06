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
        listRecent: async () => [],
      },
    });

    expect(brief.source).toBe("rule_based_fallback");
    expect(brief.fallbackReason).toContain("schema validation");
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
    expect(JSON.stringify(diagnostics[0])).not.toMatch(/apiKey|sk-/i);
  });
});
