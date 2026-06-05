import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import type {
  ProductIntakeAnswer,
  ProductIntakeQuestion,
  ProductIntakeReadiness,
  ProductIntakeSession,
} from "@shared/productIntakeWizardSchemas";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.mock("@/lib/queryClient", () => ({
  apiRequest: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, isLoading: false }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/pages/not-found", () => ({
  __esModule: true,
  default: () => <div>Not found</div>,
}));

let ProductIntakeQuestionsWizard: typeof import("./CatalogMigrationLab").ProductIntakeQuestionsWizard;
let ProductIntakeSessionSummary: typeof import("./CatalogMigrationLab").ProductIntakeSessionSummary;
let ProductIntakeSessionsList: typeof import("./CatalogMigrationLab").ProductIntakeSessionsList;

beforeAll(async () => {
  const module = await import("./CatalogMigrationLab");
  ProductIntakeQuestionsWizard = module.ProductIntakeQuestionsWizard;
  ProductIntakeSessionSummary = module.ProductIntakeSessionSummary;
  ProductIntakeSessionsList = module.ProductIntakeSessionsList;
});

function session(overrides: Partial<ProductIntakeSession> = {}): ProductIntakeSession {
  return {
    id: "sess_1",
    organizationId: "org_1",
    sourceType: "text_description",
    sourceFingerprint: "fingerprint",
    brief: {
      workflowState: "REVIEW_READY",
      source: "rule_based_fallback",
      fallbackReason: null,
      productIdentity: {
        likelyProductName: { value: "Foam Board Sign", confidence: 90, evidence: [] },
        category: { value: "Foam Board", confidence: 85, evidence: [] },
        productType: { value: "modal_configurable", confidence: 80, evidence: [] },
      },
      materialAnalysis: { detectedMaterialReferences: [], likelyMaterialMatches: [], confidence: 20, evidence: [] },
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
    },
    confidence: { overallConfidence: 88 },
    missingDecisions: [],
    status: "needs_answers",
    createdProductId: null,
    createdPbv2TreeVersionId: null,
    createdByUserId: "user_1",
    updatedByUserId: "user_1",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    abandonedAt: null,
    ...overrides,
  };
}

const questions: ProductIntakeQuestion[] = [
  {
    id: "q_select",
    organizationId: "org_1",
    sessionId: "sess_1",
    questionKey: "choose-pricing-model",
    questionType: "select",
    label: "Which pricing model should this product use?",
    helpText: "Pricing was unclear.",
    required: true,
    options: [{ label: "Square foot", value: "square_foot" }, { label: "Flat", value: "flat" }],
    defaultValue: null,
    sourcePath: "$.pricing",
    confidence: 25,
    sortOrder: 1,
    createdAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "q_multi",
    organizationId: "org_1",
    sessionId: "sess_1",
    questionKey: "required-finishing",
    questionType: "multiselect",
    label: "Which finishing options apply?",
    helpText: null,
    required: false,
    options: [{ label: "Grommets", value: "grommets" }, { label: "Lamination", value: "lamination" }],
    defaultValue: [],
    sourcePath: null,
    confidence: null,
    sortOrder: 2,
    createdAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "q_bool",
    organizationId: "org_1",
    sessionId: "sess_1",
    questionKey: "confirm-required",
    questionType: "boolean",
    label: "Should Size be required?",
    helpText: null,
    required: true,
    options: null,
    defaultValue: true,
    sourcePath: null,
    confidence: 50,
    sortOrder: 3,
    createdAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "q_number",
    organizationId: "org_1",
    sessionId: "sess_1",
    questionKey: "minimum-quantity",
    questionType: "number",
    label: "Minimum quantity",
    helpText: null,
    required: false,
    options: null,
    defaultValue: 1,
    sourcePath: null,
    confidence: null,
    sortOrder: 4,
    createdAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "q_text",
    organizationId: "org_1",
    sessionId: "sess_1",
    questionKey: "material",
    questionType: "text",
    label: "Which material should this product use?",
    helpText: null,
    required: true,
    options: null,
    defaultValue: null,
    sourcePath: null,
    confidence: null,
    sortOrder: 5,
    createdAt: "2026-06-05T00:00:00.000Z",
  },
];

const readiness: ProductIntakeReadiness = {
  unansweredRequiredCount: 2,
  answeredCount: 1,
  canCreateDraft: false,
  status: "needs_answers",
};

describe("Product Intake session UI", () => {
  test("session summary renders status, source, confidence, and readiness", () => {
    const html = renderToStaticMarkup(<ProductIntakeSessionSummary session={session()} readiness={readiness} />);

    expect(html).toContain("Session Summary");
    expect(html).toContain("sess_1");
    expect(html).toContain("needs answers");
    expect(html).toContain("text description");
    expect(html).toContain("88%");
    expect(html).toContain("Required Open");
  });

  test("questions render by type with save and abandon actions", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQuestionsWizard
        questions={questions}
        answers={[]}
        readiness={readiness}
        answerDrafts={{ "confirm-required": true, "minimum-quantity": 1 }}
        onAnswerChange={() => undefined}
        onSave={() => undefined}
        onAbandon={() => undefined}
      />,
    );

    expect(html).toContain("Missing Decisions Wizard");
    expect(html).toContain("Which pricing model should this product use?");
    expect(html).toContain("Which finishing options apply?");
    expect(html).toContain("Should Size be required?");
    expect(html).toContain("Minimum quantity");
    expect(html).toContain("Which material should this product use?");
    expect(html).toContain("Save Answers");
    expect(html).toContain("Mark Abandoned");
  });

  test("save answers action is wired", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onSave = jest.fn();

    act(() => {
      root.render(
        <ProductIntakeQuestionsWizard
          questions={questions}
          answers={[]}
          readiness={readiness}
          answerDrafts={{}}
          onAnswerChange={() => undefined}
          onSave={onSave}
          onAbandon={() => undefined}
        />,
      );
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save Answers");
    expect(saveButton).toBeTruthy();
    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  test("ready for draft state shows disabled Phase 3 CTA", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQuestionsWizard
        questions={questions}
        answers={[{ id: "a_1", organizationId: "org_1", sessionId: "sess_1", questionId: "q_text", questionKey: "material", answer: "Foam", answeredByUserId: "user_1", answeredAt: "2026-06-05T00:00:00.000Z", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-05T00:00:00.000Z" } as ProductIntakeAnswer]}
        readiness={{ unansweredRequiredCount: 0, answeredCount: 5, canCreateDraft: false, status: "ready_for_draft" }}
        answerDrafts={{}}
        onAnswerChange={() => undefined}
        onSave={() => undefined}
        onAbandon={() => undefined}
      />,
    );

    expect(html).toContain("Create TEMP Draft Coming in Phase 3");
    expect(html).toContain("disabled");
  });

  test("sessions list renders recent sessions and open button", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeSessionsList sessions={[session({ status: "ready_for_draft" })]} onOpen={() => undefined} />,
    );

    expect(html).toContain("Recent Intake Sessions");
    expect(html).toContain("Foam Board Sign");
    expect(html).toContain("ready for draft");
    expect(html).toContain("Open");
  });
});
