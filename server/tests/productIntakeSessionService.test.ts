import { describe, expect, test } from "@jest/globals";
import {
  productIntakeAnswerSchema,
  productIntakeAnswersPatchRequestSchema,
  productIntakeQuestionSchema,
  productIntakeSessionSchema,
  type ProductIntakeAnswer,
  type ProductIntakeBrief,
  type ProductIntakeQuestion,
  type ProductIntakeSession,
} from "../../shared/productIntakeWizardSchemas";
import {
  computeProductIntakeReadiness,
  generateProductIntakeQuestions,
  applyProductIntakeAnswersToBrief,
  buildCorrectedStateContract,
  correctedStateBlockers,
  parseProductIntakeChoiceAnswer,
  recalculateProductIntakeConfidence,
  productIntakeReadinessTransition,
  resolveProductIntakeAnswersForPersistence,
  resolveProductIntakeSessionStatus,
} from "../services/productIntakeWizard/productIntakeSessionService";

function brief(overrides: Partial<ProductIntakeBrief> = {}): ProductIntakeBrief {
  return {
    workflowState: "REVIEW_READY",
    source: "rule_based_fallback",
    fallbackReason: null,
    productIdentity: {
      likelyProductName: { value: "Foam Board Sign", confidence: 90, evidence: [] },
      category: { value: "Foam Board", confidence: 85, evidence: [] },
      productType: { value: "modal_configurable", confidence: 80, evidence: [] },
    },
    materialAnalysis: {
      detectedMaterialReferences: ["3/16 White Foam Board"],
      likelyMaterialMatches: [{ materialId: "mat_1", sku: "FOAM316", name: "3/16 White Foam Board", confidence: 88, evidence: [] }],
      confidence: 88,
      evidence: [],
    },
    sizeBehavior: { behavior: "custom_size", confidence: 80, evidence: [] },
    quantityBehavior: { behavior: "per_piece", confidence: 80, evidence: [] },
    pricingAnalysis: { behavior: "square_foot", confidence: 80, evidence: [] },
    requiredOptions: [],
    optionalOptions: [],
    templateMatches: [],
    missingDecisions: [],
    redundantFields: [],
    draftWarnings: [],
    sourceEvidence: [],
    overallConfidence: 88,
    ...overrides,
  };
}

function session(status: ProductIntakeSession["status"] = "needs_answers"): ProductIntakeSession {
  return {
    id: "sess_1",
    organizationId: "org_1",
    sourceType: "text_description",
    sourceFingerprint: "fingerprint",
    brief: brief(),
    confidence: { overallConfidence: 88 },
    missingDecisions: [],
    status,
    createdProductId: null,
    createdPbv2TreeVersionId: null,
    createdByUserId: "user_1",
    updatedByUserId: "user_1",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    abandonedAt: null,
  };
}

describe("Product Intake session schemas", () => {
  test("parses session, question, and answer DTOs", () => {
    const parsedSession = productIntakeSessionSchema.parse(session());
    const question = productIntakeQuestionSchema.parse({
      id: "q_1",
      organizationId: "org_1",
      sessionId: parsedSession.id,
      questionKey: "select-material",
      questionType: "text",
      label: "Which material should this product use?",
      helpText: "No confident material match was found.",
      required: true,
      options: null,
      defaultValue: null,
      sourcePath: "$.source",
      confidence: null,
      sortOrder: 1,
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    const answer = productIntakeAnswerSchema.parse({
      id: "a_1",
      organizationId: "org_1",
      sessionId: parsedSession.id,
      questionId: question.id,
      questionKey: question.questionKey,
      answer: "3/16 White Foam Board",
      answeredByUserId: "user_1",
      answeredAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });

    expect(parsedSession.status).toBe("needs_answers");
    expect(question.questionType).toBe("text");
    expect(answer.answer).toBe("3/16 White Foam Board");
  });

  test("accepts partial answer payloads with omitted, undefined, null, and empty answer lists", () => {
    expect(productIntakeAnswersPatchRequestSchema.parse({
      answers: [
        { questionKey: "material", answer: "3/16 Foam Board" },
        { questionKey: "pricing" },
        { questionKey: "finishing", answer: undefined },
        { questionKey: "routing", answer: null },
      ],
    })).toEqual({
      answers: [
        { questionKey: "material", answer: "3/16 Foam Board" },
        { questionKey: "pricing", answer: null },
        { questionKey: "finishing", answer: null },
        { questionKey: "routing", answer: null },
      ],
    });
    expect(productIntakeAnswersPatchRequestSchema.parse({ answers: [] })).toEqual({ answers: [] });
  });
});

describe("Product Intake pending option answers", () => {
  test("binds a short choice answer to the exact existing Lamination group and preserves the corrected brief", () => {
    const corrected = brief({
      productIdentity: {
        likelyProductName: { value: "DEV Test Vinyl Options 080326", confidence: 95, evidence: [] },
        category: { value: "Print Products", confidence: 100, evidence: [] },
        productType: { value: "product", confidence: 80, evidence: [] },
      },
      requiredOptions: [{
        label: "Lamination", normalizedGroup: "Lamination", required: true, confidence: 95,
        sampleValues: [], sourcePaths: ["$.correction.lamination"], templateMatches: [], evidence: [],
        source: "product_specific", selectionMode: "single", defaultChoice: "None",
      }],
      optionalOptions: [],
      sizeBehavior: { behavior: "custom_size", confidence: 95, evidence: [] },
      pricingAnalysis: { behavior: "square_foot", confidence: 95, notes: "Explicit $3.00 per square foot", evidence: [] },
    });

    const applied = applyProductIntakeAnswersToBrief(corrected, [{ questionKey: "custom-option-lamination-choices", answer: "none, gloss, matte" }]);
    const lamination = applied.requiredOptions.find((option) => option.normalizedGroup === "Lamination");
    expect(applied.productIdentity.category.value).toBe("Print Products");
    expect(applied.requiredOptions.some((option) => /^size$/i.test(option.label))).toBe(false);
    expect(lamination).toMatchObject({ label: "Lamination", required: true, selectionMode: "single", sampleValues: ["None", "Gloss", "Matte"], defaultChoice: "None" });
    expect(lamination?.choices?.map((choice) => choice.label)).toEqual(["None", "Gloss", "Matte"]);
    expect(applied.pricingAnalysis.behavior).toBe("square_foot");
    expect(applied.sizeBehavior.behavior).toBe("custom_size");
  });

  test("accepts comma, slash, bullet, and numbered choice answers without treating None as empty", () => {
    expect(parseProductIntakeChoiceAnswer("none, gloss, matte")).toEqual(["None", "Gloss", "Matte"]);
    expect(parseProductIntakeChoiceAnswer("None / Gloss / Matte")).toEqual(["None", "Gloss", "Matte"]);
    expect(parseProductIntakeChoiceAnswer("- none\n- gloss\n- matte")).toEqual(["None", "Gloss", "Matte"]);
    expect(parseProductIntakeChoiceAnswer("1. None\n2. Gloss\n3. Matte")).toEqual(["None", "Gloss", "Matte"]);
  });
});

describe("Product Intake corrected-state readiness", () => {
  test("blocks a ready-looking session when its corrected category or Lamination group is missing", () => {
    const corrected = brief({
      productIdentity: { ...brief().productIdentity, category: { value: "Print Products", confidence: 100, evidence: [] } },
      requiredOptions: [{ label: "Lamination", normalizedGroup: "Lamination", required: true, confidence: 95, sampleValues: ["None", "Gloss", "Matte"], sourcePaths: [], templateMatches: [], evidence: [], source: "product_specific", selectionMode: "single", defaultChoice: "None" }],
    });
    const contract = buildCorrectedStateContract(corrected, "Replace category with Print Products. Remove the Size option.");
    const reduced = brief({ productIdentity: { ...brief().productIdentity, category: { value: "", confidence: 0, evidence: [] } } });
    expect(correctedStateBlockers(reduced, contract)).toEqual(expect.arrayContaining([
      expect.stringContaining("category"),
      expect.stringContaining("Lamination"),
    ]));
    expect(computeProductIntakeReadiness({ session: { ...session("ready_for_draft"), brief: reduced, confidence: { correctedStateContract: contract } }, questions: [], answers: [] })).toMatchObject({ status: "needs_answers", canCreateDraft: false });
  });

  test("blocks readiness if a later revision drops a corrected measurement mode or base pricing", () => {
    const corrected = brief({
      productIdentity: { ...brief().productIdentity, category: { value: "Print Products", confidence: 100, evidence: [] } },
      sizeBehavior: { behavior: "custom_size", confidence: 100, evidence: [] },
      pricingAnalysis: { behavior: "square_foot", confidence: 100, notes: "$2.00 per square foot; minimum charge $25.00", evidence: [] },
      requiredOptions: [], optionalOptions: [],
    });
    const sourceText = "Explicit Product Intake correction (new explicit values override all prior assumptions):\nRemove the Size option group. Keep the measurement mode as width and height required. Set the price to $2.00 per square foot with a $25.00 minimum charge.";
    const contract = buildCorrectedStateContract(corrected, sourceText);
    const reduced = brief({
      productIdentity: corrected.productIdentity,
      sizeBehavior: { behavior: "none", confidence: 100, evidence: [] },
      pricingAnalysis: { behavior: "square_foot", confidence: 100, notes: "$3.00 per square foot; minimum charge $10.00", evidence: [] },
    });

    expect(correctedStateBlockers(reduced, contract)).toEqual(expect.arrayContaining([
      expect.stringContaining("measurement"),
      expect.stringContaining("per-square-foot"),
      expect.stringContaining("minimum charge"),
    ]));
  });

  test("blocks readiness when an explicit proof, production-job, material, or Flatbed route decision is lost", () => {
    const corrected = brief({
      materialSelection: "unset",
      requiresProofApproval: true,
      requiresProductionJob: true,
      productionRoute: "Flatbed",
      minimumChargeExplicitlyUnset: true,
      requiredOptions: [], optionalOptions: [],
    });
    const contract = buildCorrectedStateContract(corrected, "Explicit Product Intake correction (new explicit values override all prior assumptions): Leave material unset. Require customer proof approval. Require a production job and route it to Flatbed. Leave minimum charge unset.");
    const reduced = brief({ ...corrected, materialSelection: "auto", requiresProofApproval: false, requiresProductionJob: false, productionRoute: "Roll printer", minimumChargeExplicitlyUnset: false });

    expect(correctedStateBlockers(reduced, contract)).toEqual(expect.arrayContaining([
      expect.stringContaining("unset material"),
      expect.stringContaining("proof-approval"),
      expect.stringContaining("production-job"),
      expect.stringContaining("production route"),
      expect.stringContaining("unset minimum charge"),
    ]));
    expect(computeProductIntakeReadiness({ session: { ...session("ready_for_draft"), brief: reduced, confidence: { correctedStateContract: contract } }, questions: [], answers: [] })).toMatchObject({ status: "needs_answers", canCreateDraft: false });
  });
});

describe("Product Intake question generation", () => {
  test("persists valid partial answers and leaves blank required context for readiness", () => {
    const partialQuestions: ProductIntakeQuestion[] = [
      {
        id: "q_material",
        organizationId: "org_1",
        sessionId: "sess_1",
        questionKey: "material",
        questionType: "text",
        label: "Material",
        helpText: null,
        required: true,
        options: null,
        defaultValue: null,
        sourcePath: null,
        confidence: null,
        sortOrder: 1,
        createdAt: "2026-06-05T00:00:00.000Z",
      },
      {
        id: "q_pricing",
        organizationId: "org_1",
        sessionId: "sess_1",
        questionKey: "pricing",
        questionType: "text",
        label: "Pricing",
        helpText: null,
        required: true,
        options: null,
        defaultValue: null,
        sourcePath: null,
        confidence: null,
        sortOrder: 2,
        createdAt: "2026-06-05T00:00:00.000Z",
      },
    ];

    const resolved = resolveProductIntakeAnswersForPersistence({
      questions: partialQuestions,
      answers: [
        { questionId: "q_material", answer: "3/16 Foam Board" },
        { questionId: "q_pricing", answer: "   " },
      ],
    });

    expect(resolved).toEqual([{ question: partialQuestions[0], answer: "3/16 Foam Board" }]);
    const readiness = computeProductIntakeReadiness({
      session: session(),
      questions: partialQuestions,
      answers: [{
        id: "a_material",
        organizationId: "org_1",
        sessionId: "sess_1",
        questionId: "q_material",
        questionKey: "material",
        answer: "3/16 Foam Board",
        answeredByUserId: "user_1",
        answeredAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
      }],
    });
    expect(readiness).toMatchObject({ unansweredRequiredCount: 1, answeredCount: 1, canCreateDraft: false });
  });

  test("normalizes yes/no per-grommet pricing answers and exposes a separate default-choice question", () => {
    const questions = generateProductIntakeQuestions(brief({
      optionalOptions: [{
        label: "Grommets",
        normalizedGroup: "Grommets",
        required: false,
        confidence: 90,
        sampleValues: ["no", "yes"],
        sourcePaths: ["$.description.grommets"],
        templateMatches: [],
        evidence: [],
        source: "product_specific",
        selectionMode: "single",
        choices: [
          { value: "no", label: "no (default option)", pricing: { mode: "none" } },
          { value: "yes", label: "yes", pricing: { mode: "add_per_grommet", amount: null } },
        ],
        pricingRequired: true,
        defaultChoice: "no",
      }],
    }));
    const pricingQuestion = questions.find((question) => question.questionKey === "custom-option-grommets-pricing-values");
    const defaultQuestion = questions.find((question) => question.questionKey === "custom-option-grommets-default-choice");

    expect(pricingQuestion?.options).toEqual([{ label: "no", value: "no" }, { label: "yes", value: "yes" }]);
    expect(pricingQuestion?.helpText).toContain("no=0, yes=0.25");
    expect(defaultQuestion).toMatchObject({ defaultValue: "no", options: [{ label: "no", value: "no" }, { label: "yes", value: "yes" }] });
  });

  test("keeps ambiguous pricing answers behind the strict validation boundary", () => {
    const pricingQuestion: ProductIntakeQuestion = {
      id: "q_grommets_pricing",
      organizationId: "org_1",
      sessionId: "sess_1",
      questionKey: "custom-option-grommets-pricing-values",
      questionType: "text",
      label: "What price applies to each Grommets choice?",
      helpText: null,
      required: true,
      options: [{ label: "no", value: "no" }, { label: "yes", value: "yes" }],
      defaultValue: null,
      sourcePath: null,
      confidence: null,
      sortOrder: 1,
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    expect(() => resolveProductIntakeAnswersForPersistence({
      questions: [pricingQuestion],
      answers: [{ questionKey: pricingQuestion.questionKey, answer: "make yes cost more" }],
    })).toThrow(/Choice=Amount pair per choice/);
  });

  test("creates meaningful questions from missing decisions and low-confidence setup", () => {
    const questions = generateProductIntakeQuestions(brief({
      materialAnalysis: { detectedMaterialReferences: [], likelyMaterialMatches: [], confidence: 20, evidence: [] },
      pricingAnalysis: { behavior: "unknown", confidence: 25, evidence: [{ sourcePath: "$.pricing", label: "pricing", value: null, reason: "missing" }] },
      missingDecisions: [
        { id: "select-material", question: "Which material should this product use?", reason: "No material match.", severity: "review", evidence: [] },
        { id: "choose-pricing-model", question: "Which pricing model should be used?", reason: "Pricing unclear.", severity: "blocker", evidence: [] },
      ],
      requiredOptions: [{
        label: "Install Location",
        normalizedGroup: "Install Location",
        required: true,
        confidence: 50,
        sampleValues: ["Indoor", "Outdoor"],
        sourcePaths: ["$.fields.installLocation"],
        templateMatches: [],
        evidence: [],
      }],
    }));

    expect(questions.map((question) => question.questionKey)).toEqual(expect.arrayContaining([
      "select-material",
      "choose-pricing-model",
      "base-price-per-sqft",
      "base-price-per-piece",
      "minimum-charge",
      "confirm-option-required-install-location",
    ]));
    expect(questions.filter((question) => question.questionKey.startsWith("base-price") || question.questionKey === "minimum-charge").every((question) => !question.required)).toBe(true);
    expect(questions.every((question) => !/timestamp|internal id/i.test(question.label))).toBe(true);
  });

  test("asks targeted formula and rule questions only when confidence is low", () => {
    const lowConfidence = generateProductIntakeQuestions(brief({
      pricingAnalysis: { behavior: "formula", confidence: 70, notes: "Sticker formula suspected", evidence: [] },
      requiredOptions: [{
        label: "Contour Cutting",
        normalizedGroup: "contour_cutting",
        required: true,
        confidence: 70,
        sampleValues: ["No", "Yes"],
        sourcePaths: ["$.contour_cutting"],
        templateMatches: [],
        evidence: [],
      }],
      optionalOptions: [{
        label: "Weed and Tape",
        normalizedGroup: "weed_and_tape",
        required: false,
        confidence: 70,
        sampleValues: ["No", "Yes"],
        sourcePaths: ["$.weed_and_tape"],
        templateMatches: [],
        evidence: [],
      }],
    }));

    expect(lowConfidence.map((question) => question.questionKey)).toEqual(expect.arrayContaining([
      "choose-pricing-formula",
      "confirm-weed-and-tape-contour-rule",
    ]));

    const explicit = generateProductIntakeQuestions(brief({
      pricingAnalysis: { behavior: "formula", confidence: 92, notes: "Sticker adjusted rounded sqft formula", evidence: [] },
      requiredOptions: [{
        label: "Contour Cutting",
        normalizedGroup: "contour_cutting",
        required: true,
        confidence: 90,
        sampleValues: ["No", "Yes"],
        sourcePaths: ["$.contour_cutting"],
        templateMatches: [],
        evidence: [],
      }],
      optionalOptions: [{
        label: "Weed and Tape",
        normalizedGroup: "weed_and_tape",
        required: false,
        confidence: 90,
        sampleValues: ["No", "Yes"],
        sourcePaths: ["$.weed_and_tape"],
        templateMatches: [],
        evidence: [],
      }],
    }));

    expect(explicit.map((question) => question.questionKey)).not.toContain("choose-pricing-formula");
    expect(explicit.map((question) => question.questionKey)).not.toContain("confirm-weed-and-tape-contour-rule");
  });

  test("does not ask base pricing questions when explicit pricing is present", () => {
    const questions = generateProductIntakeQuestions(brief({
      pricingAnalysis: {
        behavior: "square_foot",
        confidence: 90,
        notes: "$5.00 per sqft with minimum charge $25.",
        evidence: [{ sourcePath: "$.description.pricing", label: "Pricing", value: "$5.00 per sqft minimum $25", reason: "source pricing" }],
      },
    }));

    expect(questions.map((question) => question.questionKey)).not.toEqual(expect.arrayContaining([
      "base-price-per-sqft",
      "base-price-per-piece",
      "minimum-charge",
    ]));
  });

  test("creates targeted matrix questions when matrix pricing is incomplete", () => {
    const questions = generateProductIntakeQuestions(brief({
      quantityBehavior: { behavior: "quantity tiers", confidence: 78, evidence: [] },
      pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 77, notes: "Printed sides by quantity tier pricing.", evidence: [] },
      matrixReadiness: {
        required: true,
        matrixType: "MULTI_DIMENSION",
        matrixDimensions: ["quantity", "printed_sides"],
        matrixConfidence: 77,
        reasoning: ["Matrix-style pricing signals were detected."],
        recommendedSetup: "Create a PBV2 pricing matrix with each detected selectable dimension and review quantity-tier behavior before publish.",
        detectedSizes: [],
        detectedQuantityBreaks: [1, 101, 501],
        detectedMaterials: [],
        detectedPricingSignals: ["Quantity tier pricing present."],
        noMatrixRowsGenerated: true,
      },
      requiredOptions: [{
        label: "Printed Sides",
        normalizedGroup: "printed_sides",
        required: true,
        confidence: 92,
        sampleValues: ["Single Sided", "Double Sided"],
        sourcePaths: ["$.options.printedSides"],
        templateMatches: [],
        evidence: [],
      }],
    }));

    expect(questions.map((question) => question.questionKey)).toEqual(expect.arrayContaining([
      "confirm-matrix-dimension",
      "confirm-matrix-quantity-tiers",
      "matrix-price-printed_sides-single_sided-1",
      "matrix-price-printed_sides-double_sided-501",
    ]));
    expect(questions.find((question) => question.questionKey === "confirm-matrix-dimension")?.label).toBe("Confirm matrix dimension");
    expect(questions.find((question) => question.questionKey === "confirm-matrix-quantity-tiers")?.helpText).toContain("Quantity remains the line item quantity");
  });

  test("material questions use candidate picker when matches exist", () => {
    const questions = generateProductIntakeQuestions(brief({
      materialAnalysis: {
        detectedMaterialReferences: ["Styrene .040"],
        likelyMaterialMatches: [
          { materialId: "mat_040", sku: "STY040", name: "Styrene .040", confidence: 82, evidence: [] },
          { materialId: "mat_030", sku: "STY030", name: "Styrene .030", confidence: 65, evidence: [] },
        ],
        confidence: 82,
        evidence: [],
      },
      missingDecisions: [
        { id: "select-material", question: "Which material should this product use?", reason: "Review material.", severity: "review", evidence: [] },
      ],
    }));

    const materialQuestion = questions.find((question) => question.questionKey === "select-material");
    expect(materialQuestion?.questionType).toBe("select");
    expect(materialQuestion?.options?.map((option) => option.value)).toEqual(["mat_040", "mat_030"]);
  });

  test("asks product-local custom option follow-ups and blocks incomplete requested pricing", () => {
    const questions = generateProductIntakeQuestions(brief({
      requiredOptions: [{
        label: "Rounded Corners",
        normalizedGroup: "rounded_corners",
        required: false,
        confidence: 88,
        sampleValues: ["No", "Yes"],
        sourcePaths: ["$.source_text"],
        templateMatches: [{
          templateId: "tpl_rounded",
          name: "Rounded Corners",
          slug: "rounded-corners",
          category: "finishing",
          score: 0.75,
          recommendation: "review_required",
          matchedSignals: ["Rounded Corners"],
          evidence: [],
        }],
        evidence: [],
        source: "product_specific",
        selectionMode: "single",
        pricingRequired: true,
        choices: [
          { value: "no", label: "No", pricing: { mode: "none" } },
          { value: "yes", label: "Yes", pricing: { mode: "add_flat", amount: null } },
        ],
      }],
    }));

    const byKey = new Map(questions.map((question) => [question.questionKey, question]));
    expect(byKey.get("custom-option-rounded-corners-required")?.defaultValue).toBe(false);
    expect(byKey.get("custom-option-rounded-corners-selection-mode")?.defaultValue).toBe("single");
    expect(byKey.get("custom-option-rounded-corners-choices")?.defaultValue).toBe("No, Yes");
    expect(byKey.get("custom-option-rounded-corners-pricing-model")?.required).toBe(true);
    expect(byKey.get("custom-option-rounded-corners-pricing-values")?.required).toBe(true);
    expect(byKey.get("custom-option-rounded-corners-weight")).toBeTruthy();
    expect(byKey.get("custom-option-rounded-corners-routing")).toBeTruthy();
    expect(byKey.get("custom-option-rounded-corners-proof")).toBeTruthy();
    expect(questions.find((question) => question.questionKey.startsWith("review-template-"))?.defaultValue).toBe("product_specific");
    expect(resolveProductIntakeSessionStatus(brief(), questions)).toBe("needs_answers");
  });

  test("marks high-confidence sessions without questions ready for draft", () => {
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 90 }), [])).toBe("ready_for_draft");
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 60 }), [])).toBe("analyzed");
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 90 }), [{ required: true }])).toBe("needs_answers");
  });

  test("persists the newest ready-for-draft transition when a complete analyzed session has no blockers", () => {
    const routedAcrylic = brief({
      overallConfidence: 60,
      productIdentity: { likelyProductName: { value: "DEV Test Routed Acrylic 080426D", confidence: 100, evidence: [] }, category: { value: "Print Products", confidence: 100, evidence: [] }, productType: { value: null, confidence: 100, evidence: [] } },
      sizeBehavior: { behavior: "custom_size", confidence: 100, evidence: [] },
      pricingAnalysis: { behavior: "square_foot", confidence: 100, notes: "$5.00 per square foot", evidence: [] },
      materialSelection: "unset",
      requiresProofApproval: true,
      requiresProductionJob: true,
      productionRoute: "Flatbed",
      requiredOptions: [], optionalOptions: [], missingDecisions: [], draftWarnings: [],
    } as any);
    const analyzed = { ...session("analyzed"), brief: routedAcrylic, confidence: { revision: 4, currentConfidence: 60 } };
    const detail = { session: analyzed, brief: routedAcrylic, questions: [], answers: [], readiness: computeProductIntakeReadiness({ session: analyzed, questions: [], answers: [] }) } as ProductIntakeSessionDetail;
    const transition = productIntakeReadinessTransition(detail);

    expect(detail.readiness).toMatchObject({ status: "ready_for_draft", canCreateDraft: true });
    expect(transition).toMatchObject({ status: "ready_for_draft", confidence: { revision: 5 } });
    expect(transition?.confidence).toEqual(expect.objectContaining({ currentConfidence: expect.any(Number) }));
    expect(detail.brief).toMatchObject({ materialSelection: "unset", requiresProofApproval: true, requiresProductionJob: true, productionRoute: "Flatbed", sizeBehavior: { behavior: "custom_size" }, pricingAnalysis: { behavior: "square_foot", notes: "$5.00 per square foot" } });
  });

  test("does not transition incomplete or terminal sessions to ready for draft", () => {
    const incomplete = { ...session("analyzed"), brief: brief({ pricingAnalysis: { behavior: "unknown", confidence: 20, evidence: [] } as any }) };
    const incompleteDetail = { session: incomplete, brief: incomplete.brief, questions: [], answers: [], readiness: computeProductIntakeReadiness({ session: incomplete, questions: [], answers: [] }) } as ProductIntakeSessionDetail;
    expect(incompleteDetail.readiness.canCreateDraft).toBe(false);
    expect(productIntakeReadinessTransition(incompleteDetail)?.status).toBe("needs_answers");
    const terminal = { ...session("draft_created"), createdProductId: "product_1", createdPbv2TreeVersionId: "tree_1" };
    const terminalDetail = { session: terminal, brief: terminal.brief, questions: [], answers: [], readiness: computeProductIntakeReadiness({ session: terminal, questions: [], answers: [] }) } as ProductIntakeSessionDetail;
    expect(productIntakeReadinessTransition(terminalDetail)).toBeNull();
  });

  test("readiness updates after required answers are present", () => {
    const questions: ProductIntakeQuestion[] = [{
      id: "q_1",
      organizationId: "org_1",
      sessionId: "sess_1",
      questionKey: "select-material",
      questionType: "text",
      label: "Which material should this product use?",
      helpText: null,
      required: true,
      options: null,
      defaultValue: null,
      sourcePath: null,
      confidence: null,
      sortOrder: 1,
      createdAt: "2026-06-05T00:00:00.000Z",
    }];
    const answers: ProductIntakeAnswer[] = [{
      id: "a_1",
      organizationId: "org_1",
      sessionId: "sess_1",
      questionId: "q_1",
      questionKey: "select-material",
      answer: "3/16 White Foam Board",
      answeredByUserId: "user_1",
      answeredAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    }];

    expect(computeProductIntakeReadiness({ session: session(), questions, answers: [] }).unansweredRequiredCount).toBe(1);
    const ready = computeProductIntakeReadiness({ session: session("ready_for_draft"), questions, answers });
    expect(ready.status).toBe("ready_for_draft");
    expect(ready.canCreateDraft).toBe(true);
    expect(computeProductIntakeReadiness({ session: session("abandoned"), questions, answers }).status).toBe("abandoned");
    expect(computeProductIntakeReadiness({
      session: { ...session("draft_created"), createdProductId: "prod_1", createdPbv2TreeVersionId: "tree_1" },
      questions,
      answers,
    })).toMatchObject({ status: "draft_created", canCreateDraft: false });
  });

  test("confidence recalculation lifts current confidence after answers", () => {
    const questions: ProductIntakeQuestion[] = [
      {
        id: "q_1",
        organizationId: "org_1",
        sessionId: "sess_1",
        questionKey: "select-material",
        questionType: "select",
        label: "Which material should this product use?",
        helpText: null,
        required: true,
        options: [{ label: "Styrene .040", value: "mat_040" }],
        defaultValue: null,
        sourcePath: null,
        confidence: 70,
        sortOrder: 1,
        createdAt: "2026-06-05T00:00:00.000Z",
      },
      {
        id: "q_2",
        organizationId: "org_1",
        sessionId: "sess_1",
        questionKey: "choose-pricing-model",
        questionType: "select",
        label: "Which pricing model should be used?",
        helpText: null,
        required: true,
        options: [{ label: "Matrix or tiered", value: "matrix_or_tiered" }],
        defaultValue: null,
        sourcePath: null,
        confidence: 50,
        sortOrder: 2,
        createdAt: "2026-06-05T00:00:00.000Z",
      },
    ];
    const answers: ProductIntakeAnswer[] = [
      { id: "a_1", organizationId: "org_1", sessionId: "sess_1", questionId: "q_1", questionKey: "select-material", answer: "mat_040", answeredByUserId: "user_1", answeredAt: "2026-06-05T00:00:00.000Z", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-05T00:00:00.000Z" },
      { id: "a_2", organizationId: "org_1", sessionId: "sess_1", questionId: "q_2", questionKey: "choose-pricing-model", answer: "matrix_or_tiered", answeredByUserId: "user_1", answeredAt: "2026-06-05T00:00:00.000Z", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-05T00:00:00.000Z" },
    ];

    const confidence = recalculateProductIntakeConfidence({ session: session("needs_answers"), questions, answers });
    expect(confidence.originalConfidence).toBe(88);
    expect(confidence.currentConfidence).toBeGreaterThan(88);
    expect(confidence.answeredQuestionKeys).toEqual(["select-material", "choose-pricing-model"]);
  });
});
