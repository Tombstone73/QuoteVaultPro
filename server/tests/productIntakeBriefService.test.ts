import { describe, expect, test } from "@jest/globals";
import { AiProviderTimeoutError, AiProviderUnavailableError, type AiProviderRequest } from "../services/ai/providers/AiProviderAdapter";
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
  generateProductIntakeBriefWithRun,
  matchOptionTemplates,
  normalizeProductIntakeBehaviorAlias,
  normalizeProductIntakeConfidence,
  repairProductIntakeBriefShape,
  resolveProductIntakeAiTimeoutMs,
  type ProductIntakeTemplateReference,
} from "../services/productIntakeWizard/productIntakeBriefService";
import {
  computeProductIntakeReadiness,
  generateProductIntakeQuestions,
} from "../services/productIntakeWizard/productIntakeSessionService";

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

  test("keeps arbitrary requested options product-specific when no template exists", async () => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: {
        sourceType: "text_description",
        description: "Polystyrene Signs. Add installation options: Customer installs, Shop installs. Add rounded corners.",
      },
      analyzer: null,
      templates: [],
      provider: null,
    });

    const installation = brief.optionalOptions.find((option) => option.normalizedGroup === "Installation");
    expect(installation).toMatchObject({
      source: "product_specific",
      selectionMode: "single",
      sampleValues: ["Customer installs", "Shop installs"],
      templateMatches: [],
    });
    expect(brief.optionalOptions.find((option) => option.normalizedGroup.toLowerCase() === "rounded corners")).toBeTruthy();
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

    expect(brief.productIdentity.likelyProductName.value).toBe(".040 Styrene Signs");
    expect(brief.productIdentity.category.value).toBe("Rigid Signs");
    expect(brief.materialAnalysis.detectedMaterialReferences).toContain("Styrene .040");
    expect(brief.materialAnalysis.likelyMaterialMatches[0]).toMatchObject({ materialId: "mat_040", name: "Styrene .040" });
    expect(brief.sizeBehavior.behavior).toBe("fixed_size");
    expect(brief.sizeBehavior.evidence[0].value).toContain("12x18");
    expect(brief.quantityBehavior.behavior).toBe("per_piece");
    expect(brief.pricingAnalysis.behavior).toBe("matrix_or_tiered");
    expect(brief.requiredOptions.find((option) => option.normalizedGroup === "Size")?.sampleValues).toEqual(["12x18", "18x24", "24x36"]);
    expect(brief.requiredOptions.find((option) => option.normalizedGroup === "Printed Sides")?.sampleValues).toEqual(["Single sided", "Double sided"]);
    expect(brief.optionalOptions.find((option) => option.normalizedGroup === "Rounded corners")?.sampleValues).toContain("Rounded corners");
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
    expect(brief.optionalOptions.map((option) => option.normalizedGroup)).toEqual(expect.arrayContaining(["Hemming", "Grommets", "Pole pockets"]));
    expect(brief.draftWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["proof_required", "routing_signal"]));
    expect(generateProductIntakeQuestions(brief).some((question) => question.questionKey === "confirm-routing-proof-prepress")).toBe(false);
  });

  test("matches 4mm coroplast text to Coroplast material candidates", async () => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: {
        sourceType: "text_description",
        description: "4mm coroplast yard signs, full color, single sided, stakes optional",
      },
      analyzer: null,
      templates,
      materials: [
        { id: "mat_10mm", sku: "10mmCoro", name: "Coroplast - 10mm" },
        { id: "mat_4mm", sku: "4mmCoro", name: "Coroplast 4mm" },
      ],
      provider: null,
    });

    expect(brief.productIdentity.category.value).toBe("Coroplast / Yard Signs");
    expect(brief.materialAnalysis.detectedMaterialReferences).toContain("Coroplast 4mm");
    expect(brief.materialAnalysis.likelyMaterialMatches[0]).toMatchObject({
      materialId: "mat_4mm",
      name: "Coroplast 4mm",
      confidence: 90,
    });
    expect(brief.missingDecisions.some((decision) => decision.id === "select-material")).toBe(false);
  });

  test.each([
    {
      label: "4mm Coroplast Yard Signs",
      description: [
        "4mm coroplast yard signs.",
        "Sizes 18x24 and 24x36.",
        "Single sided or double sided.",
        "Optional H-wire stakes.",
        "Quantity tier pricing.",
        "Route to flatbed printer.",
        "Proof required.",
      ].join("\n"),
      materials: [{ id: "mat_coro", sku: "CORO4", name: "4mm White Coroplast" }],
      expectedName: "4mm Coroplast Yard Signs",
      expectedMaterialId: "mat_coro",
      expectedRequired: ["Size", "Printed Sides"],
      expectedOptional: ["H-wire Stakes"],
    },
    {
      label: "13oz Banner",
      description: "13oz banner custom width and height, single sided, optional grommets and pole pockets, quantity tier pricing, route to roll printer, proof required.",
      materials: [{ id: "mat_banner", sku: "BAN13", name: "13oz Scrim Banner" }],
      expectedName: "13oz Banner",
      expectedMaterialId: "mat_banner",
      expectedRequired: ["Size", "Printed Sides"],
      expectedOptional: ["Grommets", "Pole pockets"],
    },
    {
      label: ".040 Styrene Signs",
      description: ".040 rigid styrene sheets. Sizes 12x18, 18x24, 24x36. Single sided or double sided. Full color printing. Optional rounded corners.",
      materials: [{ id: "mat_styrene", sku: "STY040", name: "Styrene .040" }],
      expectedName: ".040 Styrene Signs",
      expectedMaterialId: "mat_styrene",
      expectedRequired: ["Size", "Printed Sides"],
      expectedOptional: ["Rounded corners"],
    },
    {
      label: "Contour-Cut Stickers",
      description: "Contour-cut vinyl stickers. Custom size. Full color. Optional laminate. Quantity tier pricing.",
      materials: [{ id: "mat_vinyl", sku: "VINYL", name: "White Print Vinyl" }],
      expectedName: "Contour-Cut Stickers",
      expectedMaterialId: "mat_vinyl",
      expectedRequired: ["Size"],
      expectedOptional: ["Printing", "Laminate"],
    },
    {
      label: "3mm Acrylic Signs",
      description: "3mm acrylic signs. Sizes 12x18 and 24x36. Single sided. Optional white ink and rounded corners. Quantity tier pricing.",
      materials: [{ id: "mat_acrylic", sku: "ACR3", name: "3mm Clear Acrylic" }],
      expectedName: "3mm Acrylic Signs",
      expectedMaterialId: "mat_acrylic",
      expectedRequired: ["Size", "Printed Sides"],
      expectedOptional: ["White Ink", "Rounded corners"],
    },
  ])("normalizes quality signals for $label", async (testCase) => {
    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: testCase.description },
      analyzer: null,
      templates,
      materials: testCase.materials,
      provider: null,
    });

    expect(brief.productIdentity.likelyProductName.value).toBe(testCase.expectedName);
    expect(brief.materialAnalysis.likelyMaterialMatches[0]?.materialId).toBe(testCase.expectedMaterialId);
    expect(brief.requiredOptions.map((option) => option.normalizedGroup)).toEqual(expect.arrayContaining(testCase.expectedRequired));
    expect(brief.optionalOptions.map((option) => option.normalizedGroup)).toEqual(expect.arrayContaining(testCase.expectedOptional));
    expect(brief.optionalOptions.map((option) => option.normalizedGroup)).not.toContain("Proof Required");
    expect(brief.optionalOptions.map((option) => option.normalizedGroup)).not.toContain("Routing");
    expect(generateProductIntakeQuestions(brief).some((question) => question.questionKey === "confirm-routing-proof-prepress")).toBe(false);
  });

  test("computes readiness penalties and review states without enabling draft creation", async () => {
    const readyBrief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "13oz banner custom width and height single sided $5.00 per sqft proof required route to roll printer" },
      analyzer: null,
      templates,
      materials: [{ id: "mat_banner", sku: "BAN13", name: "13oz Scrim Banner" }],
      provider: null,
    });
    const readyQuestions = generateProductIntakeQuestions(readyBrief).map((question, index) => ({
      ...question,
      id: `q_ready_${index}`,
      organizationId: "org_1",
      sessionId: "sess_ready",
      createdAt: new Date().toISOString(),
    }));
    const readyAnswers = readyQuestions
      .filter((question) => question.required)
      .map((question, index) => ({
        id: `answer_ready_${index}`,
        organizationId: "org_1",
        sessionId: "sess_ready",
        questionId: question.id,
        questionKey: question.questionKey,
        answer: question.questionType === "select" ? question.options?.[0]?.value ?? "square_foot" : "1, 10, 25",
        answeredByUserId: "user_1",
        answeredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    const readyReadiness = computeProductIntakeReadiness({
      session: {
        id: "sess_ready",
        organizationId: "org_1",
        sourceType: "text_description",
        sourceFingerprint: null,
        brief: readyBrief,
        confidence: { currentConfidence: readyBrief.overallConfidence },
        missingDecisions: readyBrief.missingDecisions,
        status: "ready_for_draft",
        createdProductId: null,
        createdPbv2TreeVersionId: null,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        abandonedAt: null,
      },
      questions: readyQuestions,
      answers: readyAnswers,
    });

    expect(readyReadiness.canCreateDraft).toBe(true);
    expect(readyReadiness.reviewState).toBe("ready_for_draft");
    expect(readyReadiness.penalties).toEqual([]);

    const notReadyBrief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "Mystery sign with unknown pricing" },
      analyzer: null,
      templates,
      provider: null,
    });
    const notReadyQuestions = generateProductIntakeQuestions(notReadyBrief).map((question, index) => ({
      ...question,
      id: `q_not_ready_${index}`,
      organizationId: "org_1",
      sessionId: "sess_not_ready",
      createdAt: new Date().toISOString(),
    }));
    const notReadyReadiness = computeProductIntakeReadiness({
      session: {
        id: "sess_not_ready",
        organizationId: "org_1",
        sourceType: "text_description",
        sourceFingerprint: null,
        brief: notReadyBrief,
        confidence: { currentConfidence: notReadyBrief.overallConfidence },
        missingDecisions: notReadyBrief.missingDecisions,
        status: "needs_answers",
        createdProductId: null,
        createdPbv2TreeVersionId: null,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        abandonedAt: null,
      },
      questions: notReadyQuestions,
      answers: [],
    });

    expect(notReadyReadiness.reviewState).toBe("not_ready");
    expect(notReadyReadiness.penalties?.map((penalty) => penalty.code)).toEqual(expect.arrayContaining(["material_unresolved", "pricing_unresolved"]));
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

  test("Product Intake prompt contract accepts a full Coroplast AI brief shape", async () => {
    const description = [
      "4mm coroplast yard signs.",
      "Sizes 18x24 and 24x36.",
      "Single sided or double sided.",
      "Optional H-wire stakes.",
      "Quantity tier pricing.",
      "Route to flatbed printer.",
      "Proof required.",
    ].join("\n");
    const deterministic = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description },
      analyzer: null,
      templates,
      materials: [{ id: "mat_coro_4mm", sku: "CORO4", name: "4mm White Coroplast" }],
      provider: null,
    });
    const aiBrief = productIntakeBriefSchema.parse({
      ...deterministic,
      workflowState: "REVIEW_READY",
      source: "live_ai",
      fallbackReason: null,
      optionalOptions: [
        ...deterministic.optionalOptions,
        {
          label: "H-wire Stakes",
          normalizedGroup: "H-wire Stakes",
          required: false,
          confidence: 86,
          sampleValues: ["Optional H-wire stakes"],
          sourcePaths: ["$.source_text"],
          templateMatches: [],
          evidence: [{ sourcePath: "$.source_text", label: "H-wire stakes", value: "Optional H-wire stakes", reason: "The source lists H-wire stakes as optional." }],
        },
      ],
      overallConfidence: Math.max(deterministic.overallConfidence, 90),
    });
    const capturedRequests: AiProviderRequest[] = [];
    const provider = {
      generateJson: async (request: AiProviderRequest) => {
        capturedRequests.push(request);
        return {
          rawText: JSON.stringify(aiBrief),
          provider: "openai",
          model: "gpt-test",
          requestMetadata: { latencyMs: 1234, timeoutMs: 60000 },
        };
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "gpt-test", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "gpt-test", requestMetadata: {} }),
    };

    const result = await generateProductIntakeBriefWithRun({
      orgId: "org_1",
      request: { sourceType: "text_description", description },
      analyzer: null,
      templates,
      materials: [{ id: "mat_coro_4mm", sku: "CORO4", name: "4mm White Coroplast" }],
      provider,
    });

    expect(productIntakeBriefSchema.safeParse(JSON.parse(JSON.stringify(result.brief))).success).toBe(true);
    expect(result.brief.source).toBe("live_ai");
    expect(result.brief.fallbackReason).toBeNull();
    expect(result.brief.productIdentity.likelyProductName.value).toMatch(/Coroplast|Yard/i);
    expect(result.brief.materialAnalysis.detectedMaterialReferences.join(" ")).toMatch(/coroplast/i);
    expect(result.brief.sizeBehavior.behavior).toBe("fixed_size");
    expect(result.brief.quantityBehavior.behavior).toBe("quantity_tiers");
    expect(result.brief.pricingAnalysis.behavior).toBe("quantity_tiers");
    expect(result.brief.requiredOptions.length).toBeGreaterThan(0);
    expect(result.brief.optionalOptions.some((option) => /stake/i.test(option.label))).toBe(true);
    expect(result.aiRun).toMatchObject({
      attempted: true,
      reachedProvider: true,
      provider: "openai",
      model: "gpt-test",
      reason: "live_ai",
      sourceResult: "live_ai",
    });
    expect(capturedRequests[0]?.feature).toBe("feature_review");
    expect(capturedRequests[0]?.system).toContain("The only allowed top-level keys are");
    expect(capturedRequests[0]?.system).toContain("Do not return a wrapper object");
    expect(capturedRequests[0]?.user).toContain("Valid output example");
    expect(capturedRequests[0]?.user).toContain("Do not echo this input envelope");
    expect(capturedRequests[0]?.user).toContain("Draft ProductIntakeBrief to improve");
  });

  test("resolves Product Intake AI timeout precedence with 60 second default", () => {
    expect(resolveProductIntakeAiTimeoutMs({} as NodeJS.ProcessEnv)).toBe(60000);
    expect(resolveProductIntakeAiTimeoutMs({ AI_BUG_REVIEW_TIMEOUT_MS: "31000" } as NodeJS.ProcessEnv)).toBe(31000);
    expect(resolveProductIntakeAiTimeoutMs({
      AI_PROVIDER_TIMEOUT_MS: "45000",
      AI_BUG_REVIEW_TIMEOUT_MS: "31000",
    } as NodeJS.ProcessEnv)).toBe(45000);
    expect(resolveProductIntakeAiTimeoutMs({
      PRODUCT_INTAKE_AI_TIMEOUT_MS: "90000",
      AI_PROVIDER_TIMEOUT_MS: "45000",
      AI_BUG_REVIEW_TIMEOUT_MS: "31000",
    } as NodeJS.ProcessEnv)).toBe(90000);
  });

  test("passes Product Intake timeout and use case to the AI provider", async () => {
    const providerRequests: AiProviderRequest[] = [];
    const previousTimeout = process.env.PRODUCT_INTAKE_AI_TIMEOUT_MS;
    process.env.PRODUCT_INTAKE_AI_TIMEOUT_MS = "65000";
    const provider = {
      generateJson: async (request: AiProviderRequest) => {
        providerRequests.push(request);
        return {
          rawText: JSON.stringify({
            ...productIntakeBriefSchema.parse(await generateProductIntakeBrief({
              orgId: "org_inner",
              request: { sourceType: "text_description", description: "13oz banner" },
              analyzer: null,
              templates,
              provider: null,
            })),
            source: "live_ai",
          }),
          provider: "openai",
          model: "test-model",
          requestMetadata: {},
        };
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    try {
      await generateProductIntakeBrief({
        orgId: "org_1",
        request: { sourceType: "text_description", description: "13oz banner" },
        analyzer: null,
        templates,
        provider,
      });
    } finally {
      if (previousTimeout === undefined) delete process.env.PRODUCT_INTAKE_AI_TIMEOUT_MS;
      else process.env.PRODUCT_INTAKE_AI_TIMEOUT_MS = previousTimeout;
    }

    expect(providerRequests[0]?.timeoutMs).toBe(65000);
    expect(providerRequests[0]?.timeoutUseCase).toBe("product_intake");
  });

  test("provider timeout falls back with user-friendly Product Intake message", async () => {
    const provider = {
      generateJson: async () => {
        throw new AiProviderTimeoutError({
          timeoutMs: 60000,
          elapsedMs: 60001,
          provider: "openai",
          model: "gpt-test",
          useCase: "product_intake",
        });
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "13oz banner" },
      analyzer: null,
      templates,
      provider,
    });

    expect(brief.source).toBe("rule_based_fallback");
    expect(brief.fallbackReason).toBe("Live AI timed out after 60 seconds. Analyzer fallback returned.");
  });

  test("provider unavailable falls back with explicit Product Intake message", async () => {
    const provider = {
      generateJson: async () => {
        throw new AiProviderUnavailableError("AI provider is not configured.");
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const brief = await generateProductIntakeBrief({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "4mm coroplast yard signs" },
      analyzer: null,
      templates,
      provider,
    });

    expect(brief.source).toBe("rule_based_fallback");
    expect(brief.fallbackReason).toBe("Live AI unavailable: provider_unavailable. Analyzer fallback returned.");
  });

  test("AI readiness blocks provider call and returns explicit aiRun metadata", async () => {
    let providerCalled = false;
    const diagnostics: ProductIntakeAiDiagnosticInput[] = [];
    const result = await generateProductIntakeBriefWithRun({
      orgId: "org_1",
      request: { sourceType: "text_description", description: "4mm coroplast yard signs" },
      analyzer: null,
      templates,
      provider: {
        generateJson: async () => {
          providerCalled = true;
          return { rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} };
        },
        generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
        generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      },
      diagnosticsStore: {
        recordSchemaValidationFailure: async (input) => {
          diagnostics.push(input);
        },
        attachRecentToSession: async () => undefined,
        listRecent: async () => [],
      },
      aiReadiness: {
        organizationId: "org_1",
        userId: "user_1",
        databaseIdentifier: "testdb",
        enabled: false,
        mode: "disabled",
        featureReviewEnabled: false,
        provider: null,
        model: null,
        reason: "missing_org_ai_settings",
        managedEnv: { endpointPresent: false, apiKeyPresent: false, modelPresent: false },
        encryptionKeyPresent: false,
        canAttemptLiveAi: false,
      },
    });

    expect(providerCalled).toBe(false);
    expect(diagnostics).toEqual([]);
    expect(result.brief.source).toBe("rule_based_fallback");
    expect(result.brief.fallbackReason).toContain("missing_org_ai_settings");
    expect(result.aiRun).toMatchObject({
      attempted: false,
      reachedProvider: false,
      reason: "missing_org_ai_settings",
      sourceResult: "provider_unavailable_fallback",
    });
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
