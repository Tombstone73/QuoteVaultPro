import { describe, expect, test } from "@jest/globals";
import {
  productIntakeAnswerSchema,
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
  recalculateProductIntakeConfidence,
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
});

describe("Product Intake question generation", () => {
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
      "confirm-option-required-install-location",
    ]));
    expect(questions.every((question) => !/timestamp|internal id/i.test(question.label))).toBe(true);
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

  test("marks high-confidence sessions without questions ready for draft", () => {
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 90 }), [])).toBe("ready_for_draft");
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 60 }), [])).toBe("analyzed");
    expect(resolveProductIntakeSessionStatus(brief({ overallConfidence: 90 }), [{ required: true }])).toBe("needs_answers");
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
