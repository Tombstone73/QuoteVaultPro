import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
import type {
  ProductIntakeAnswer,
  ProductIntakeAiDiagnostic,
  ProductIntakeAiReadiness,
  ProductIntakeQuestion,
  ProductIntakeReadiness,
  ProductIntakeSession,
} from "@shared/productIntakeWizardSchemas";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.setTimeout(120000);

jest.mock("@/lib/queryClient", () => ({
  apiRequest: jest.fn(),
}));

const queryClientMock = jest.requireMock("@/lib/queryClient") as { apiRequest: jest.Mock };

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, isLoading: false }),
}));

jest.mock("@/lib/platformAccess", () => ({
  canUsePlatformTools: () => true,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/pages/not-found", () => ({
  __esModule: true,
  default: () => <div>Not found</div>,
}));

let ProductIntakeQuestionsWizard: typeof import("./CatalogMigrationLab").ProductIntakeQuestionsWizard;
let ProductIntakeRunStatusPanel: typeof import("./CatalogMigrationLab").ProductIntakeRunStatusPanel;
let ProductIntakeAiStatusPanel: typeof import("./CatalogMigrationLab").ProductIntakeAiStatusPanel;
let ProductIntakeSessionSummary: typeof import("./CatalogMigrationLab").ProductIntakeSessionSummary;
let ProductIntakeSessionsList: typeof import("./CatalogMigrationLab").ProductIntakeSessionsList;
let ProductIntakeAiDiagnosticsPanel: typeof import("./CatalogMigrationLab").ProductIntakeAiDiagnosticsPanel;
let ProductIntakeQualityMetrics: typeof import("./CatalogMigrationLab").ProductIntakeQualityMetrics;
let CatalogMigrationLab: typeof import("./CatalogMigrationLab").default;

beforeAll(async () => {
  const module = await import("./CatalogMigrationLab");
  ProductIntakeQuestionsWizard = module.ProductIntakeQuestionsWizard;
  ProductIntakeRunStatusPanel = module.ProductIntakeRunStatusPanel;
  ProductIntakeAiStatusPanel = module.ProductIntakeAiStatusPanel;
  ProductIntakeSessionSummary = module.ProductIntakeSessionSummary;
  ProductIntakeSessionsList = module.ProductIntakeSessionsList;
  ProductIntakeAiDiagnosticsPanel = module.ProductIntakeAiDiagnosticsPanel;
  ProductIntakeQualityMetrics = module.ProductIntakeQualityMetrics;
  CatalogMigrationLab = module.default;
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
    confidence: { originalConfidence: 88, currentConfidence: 96, overallConfidence: 88 },
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
  reviewState: "not_ready",
  reviewScore: 46,
  penalties: [
    { code: "required_answers_open", label: "2 required answer(s) still open", severity: "blocker" },
  ],
};

function intakeDetail(overrides: Partial<ProductIntakeSession> = {}) {
  const nextSession = session(overrides);
  return {
    session: nextSession,
    brief: nextSession.brief,
    questions,
    answers: [] as ProductIntakeAnswer[],
    readiness,
  };
}

function jsonResponse(data: unknown) {
  return {
    json: async () => data,
  } as Response;
}

function aiReadiness(overrides: Partial<ProductIntakeAiReadiness> = {}): ProductIntakeAiReadiness {
  return {
    organizationId: "org_1",
    userId: "user_1",
    databaseIdentifier: "neondb",
    enabled: true,
    mode: "printershero_managed",
    featureReviewEnabled: true,
    provider: "openai",
    model: "gpt-test",
    reason: "live_ai_ready",
    managedEnv: {
      endpointPresent: true,
      apiKeyPresent: true,
      modelPresent: true,
    },
    encryptionKeyPresent: false,
    canAttemptLiveAi: true,
    ...overrides,
  };
}

function isAiReadinessRequest(method: string, url: string) {
  return method === "GET" && url === "/api/admin/product-intake-wizard/ai-readiness";
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function renderCatalogMigrationLabPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CatalogMigrationLab />
      </QueryClientProvider>,
    );
  });
  return { container, root, queryClient };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  Simulate.change(textarea, { target: { value } } as any);
}

describe("Product Intake session UI", () => {
  test("session summary renders status, source, confidence, and readiness", () => {
    const html = renderToStaticMarkup(<ProductIntakeSessionSummary session={session()} readiness={readiness} />);

    expect(html).toContain("Session Summary");
    expect(html).toContain("sess_1");
    expect(html).toContain("needs answers");
    expect(html).toContain("text description");
    expect(html).toContain("88%");
    expect(html).toContain("96%");
    expect(html).toContain("Current Confidence");
    expect(html).toContain("Required Open");
    expect(html).toContain("Not Ready");
    expect(html).toContain("Review Score");
    expect(html).toContain("2 required answer(s) still open");
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

  test("ready for draft state shows Create Draft Product CTA", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQuestionsWizard
        questions={questions}
        answers={[{ id: "a_1", organizationId: "org_1", sessionId: "sess_1", questionId: "q_text", questionKey: "material", answer: "Foam", answeredByUserId: "user_1", answeredAt: "2026-06-05T00:00:00.000Z", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-05T00:00:00.000Z" } as ProductIntakeAnswer]}
        readiness={{ unansweredRequiredCount: 0, answeredCount: 5, canCreateDraft: true, status: "ready_for_draft" }}
        answerDrafts={{}}
        onAnswerChange={() => undefined}
        onSave={() => undefined}
        onAbandon={() => undefined}
        onCreateDraft={() => undefined}
      />,
    );

    expect(html).toContain("Create Draft Product");
    expect(html).toContain("Ready to create one inactive product and one PBV2 DRAFT tree.");
  });

  test("Create Draft Product action is wired", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onCreateDraft = jest.fn();

    act(() => {
      root.render(
        <ProductIntakeQuestionsWizard
          session={session({ status: "ready_for_draft" })}
          questions={questions}
          answers={[]}
          readiness={{ unansweredRequiredCount: 0, answeredCount: 5, canCreateDraft: true, status: "ready_for_draft", reviewState: "ready_for_draft" }}
          answerDrafts={{}}
          onAnswerChange={() => undefined}
          onSave={() => undefined}
          onAbandon={() => undefined}
          onCreateDraft={onCreateDraft}
        />,
      );
    });

    const draftButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create Draft Product"));
    expect(draftButton).toBeTruthy();
    act(() => {
      draftButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  test("ineligible draft state surfaces exact reason", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQuestionsWizard
        session={session({ status: "needs_answers" })}
        questions={questions}
        answers={[]}
        readiness={{
          unansweredRequiredCount: 2,
          answeredCount: 1,
          canCreateDraft: false,
          status: "needs_answers",
          reviewState: "not_ready",
          penalties: [{ code: "required_answers_open", label: "2 required answer(s) still open", severity: "blocker" }],
        }}
        answerDrafts={{}}
        onAnswerChange={() => undefined}
        onSave={() => undefined}
        onAbandon={() => undefined}
      />,
    );

    expect(html).toContain("Draft creation unavailable:");
    expect(html).toContain("Session status is needs answers; only Ready for Draft sessions can create draft products.");
    expect(html).toContain("Create Draft Product");
    expect(html).toContain("disabled");
  });

  test("draft_created state shows created ids and links", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQuestionsWizard
        session={session({ status: "draft_created", createdProductId: "prod_1", createdPbv2TreeVersionId: "tree_1" })}
        questions={questions}
        answers={[]}
        readiness={{ unansweredRequiredCount: 0, answeredCount: 5, canCreateDraft: false, status: "draft_created" }}
        answerDrafts={{}}
        onAnswerChange={() => undefined}
        onSave={() => undefined}
        onAbandon={() => undefined}
        draftQuality={{
          label: "Good",
          score: 86,
          reasons: ["Options were organized into logical PBV2 groups."],
          warnings: ["Pricing setup required."],
        }}
      />,
    );

    expect(html).toContain("Draft Product Created");
    expect(html).toContain("Draft Quality");
    expect(html).toContain("Good");
    expect(html).toContain("86/100");
    expect(html).toContain("Pricing setup required.");
    expect(html).toContain("prod_1");
    expect(html).toContain("tree_1");
    expect(html).toContain("/products/prod_1/edit");
    expect(html).toContain("/products/prod_1/builder-v2");
  });

  test("run status panel renders elapsed running status", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeRunStatusPanel
        runState={{
          status: "running_live_ai",
          startedAt: 1000,
          completedAt: null,
          timeoutMs: 60000,
          sourceResult: null,
          provider: "openai",
          model: "gpt-test",
          message: "Live AI is analyzing this product...",
        }}
        now={4000}
        playSound={false}
        onPlaySoundChange={() => undefined}
      />,
    );

    expect(html).toContain("AI Run Status");
    expect(html).toContain("Running live AI");
    expect(html).toContain("Live AI is analyzing this product");
    expect(html).toContain("3s");
    expect(html).toContain("openai / gpt-test");
    expect(html).toContain("60s");
  });

  test("run status panel renders explicit provider unavailable reason", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeRunStatusPanel
        runState={{
          status: "completed_analyzer_fallback",
          startedAt: 1000,
          completedAt: 2500,
          timeoutMs: null,
          sourceResult: "provider_unavailable_fallback",
          provider: null,
          model: null,
          message: "Live AI unavailable: feature_review_disabled. Analyzer fallback returned.",
        }}
        now={2500}
        playSound={false}
        onPlaySoundChange={() => undefined}
      />,
    );

    expect(html).toContain("Live AI unavailable: feature_review_disabled");
    expect(html).toContain("provider unavailable fallback");
    expect(html).toContain("Not returned");
  });

  test("Product Intake AI status renders live readiness", () => {
    const html = renderToStaticMarkup(<ProductIntakeAiStatusPanel readiness={aiReadiness()} />);

    expect(html).toContain("Product Intake AI Status");
    expect(html).toContain("Live AI ready");
    expect(html).toContain("Product Intake can attempt Live AI");
    expect(html).toContain("Feature Review");
    expect(html).toContain("Enabled");
    expect(html).toContain("openai / gpt-test");
    expect(html).toContain("neondb");
  });

  test("Product Intake AI status renders provider unavailable fallback reason", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeAiStatusPanel
        readiness={aiReadiness({
          enabled: false,
          featureReviewEnabled: false,
          provider: null,
          model: null,
          reason: "feature_review_disabled",
          canAttemptLiveAi: false,
        })}
      />,
    );

    expect(html).toContain("Feature Review disabled");
    expect(html).toContain("Analyzer fallback will be used");
    expect(html).toContain("Can Attempt Live AI");
    expect(html).toContain("No");
  });

  test("sessions list renders recent sessions and open button", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(<ProductIntakeSessionsList sessions={[session({ status: "ready_for_draft" })]} onOpen={() => undefined} />);
    });

    expect(container.textContent).toContain("Recent Intake Sessions");
    expect(container.textContent).toContain("Foam Board Sign");
    expect(container.textContent).toContain("ready for draft");
    expect(container.textContent).toContain("Analyzer fallback");
    expect(container.textContent).toContain("Delete Selected");
    expect(container.textContent).toContain("Open");
    act(() => root.unmount());
  });

  test("quality metrics render recent intake session mix", () => {
    const html = renderToStaticMarkup(
      <ProductIntakeQualityMetrics
        sessions={[
          session({ status: "ready_for_draft", brief: { ...session().brief, source: "live_ai", materialAnalysis: { detectedMaterialReferences: ["Foam"], likelyMaterialMatches: [{ materialId: "mat_1", sku: "FOAM", name: "Foam", confidence: 90, evidence: [] }], confidence: 90, evidence: [] } } }),
          session({ id: "sess_2", brief: { ...session().brief, source: "live_ai", aiRepair: { accepted: true, actions: [] } } }),
          session({ id: "sess_3", status: "needs_answers" }),
        ]}
      />,
    );

    expect(html).toContain("Product Intake Quality Metrics");
    expect(html).toContain("Total Sessions");
    expect(html).toContain("Live AI Repaired");
    expect(html).toContain("Analyzer Fallback");
    expect(html).toContain("Avg Confidence");
    expect(html).toContain("Ready For Draft");
    expect(html).toContain("Not Ready");
  });

  test("sessions list filters by product search", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <ProductIntakeSessionsList
          sessions={[
            session({ id: "sess_1" }),
            session({ id: "sess_2", brief: { ...session().brief, productIdentity: { ...session().brief.productIdentity, likelyProductName: { value: "13oz Banner", confidence: 92, evidence: [] } } } }),
          ]}
          onOpen={() => undefined}
        />,
      );
    });

    const searchInput = container.querySelector('input[aria-label="Search intake sessions"]') as HTMLInputElement;
    expect(container.textContent).toContain("Foam Board Sign");
    expect(container.textContent).toContain("13oz Banner");
    act(() => {
      Simulate.change(searchInput, { target: { value: "banner" } } as any);
    });
    expect(container.textContent).not.toContain("Foam Board Sign");
    expect(container.textContent).toContain("13oz Banner");
    act(() => root.unmount());
  });

  test("session delete requires confirmation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDelete = jest.fn();

    act(() => {
      root.render(
        <ProductIntakeSessionsList sessions={[session()]} onOpen={() => undefined} onDelete={onDelete} />,
      );
    });

    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Delete");
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Delete this intake session?");

    const confirmButton = Array.from(document.body.querySelectorAll("button")).reverse().find((button) => button.textContent === "Delete");
    act(() => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  test("opened deleted session clears from the page", async () => {
    const detail = intakeDetail({ status: "needs_answers" });
    let sessions = [detail.session];
    queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url] = args as [string, string];
      if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions") {
        return jsonResponse({ success: true, data: { sessions } });
      }
      if (isAiReadinessRequest(method, url)) {
        return jsonResponse({ success: true, data: aiReadiness() });
      }
      if (method === "GET" && url === `/api/admin/product-intake-wizard/sessions/${detail.session.id}`) {
        return jsonResponse({ success: true, data: { ...detail, diagnostics: [] } });
      }
      if (method === "GET" && url.startsWith("/api/admin/product-intake-wizard/ai-diagnostics")) {
        return jsonResponse({ success: true, data: { diagnostics: [] } });
      }
      if (method === "DELETE" && url === `/api/admin/product-intake-wizard/sessions/${detail.session.id}`) {
        sessions = [];
        return jsonResponse({ success: true, data: { deleted: { sessions: 1, questions: 5, answers: 0, diagnostics: 0 } } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });

    const { container, root } = await renderCatalogMigrationLabPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open");
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Session Summary");

    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Delete");
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirmButton = Array.from(document.body.querySelectorAll("button")).reverse().find((button) => button.textContent === "Delete");
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain("Session Summary");
    expect(container.textContent).toContain("No intake sessions match the current filters.");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  test("AI diagnostics panel renders provider, schema paths, errors, and raw response", () => {
    const diagnostics: ProductIntakeAiDiagnostic[] = [{
      id: "diag_1",
      organizationId: "org_1",
      sessionId: "sess_1",
      sourceType: "text_description",
      sourceFingerprint: "fingerprint",
      provider: "openai",
      model: "gpt-test",
      rawAiResponse: "{\"bad\":true}",
      validationErrors: [{ path: "productIdentity", message: "Required", code: "invalid_type" }],
      failedSchemaPaths: ["productIdentity"],
      repairActions: [{
        path: "materialAnalysis.detectedMaterialReferences",
        originalValue: "styrene",
        repairedValue: ["styrene"],
        reason: "normalized material string into materialAnalysis.detectedMaterialReferences",
        confidenceImpact: null,
      }],
      promptVersion: "product-intake-brief-v1",
      createdByUserId: "user_1",
      createdAt: "2026-06-05T00:00:00.000Z",
    }];
    const html = renderToStaticMarkup(<ProductIntakeAiDiagnosticsPanel diagnostics={diagnostics} />);

    expect(html).toContain("AI Intake Diagnostics");
    expect(html).toContain("Admin only");
    expect(html).toContain("openai / gpt-test");
    expect(html).toContain("productIdentity");
    expect(html).toContain("Required");
    expect(html).toContain("Repair Actions");
    expect(html).toContain("{&quot;bad&quot;:true}");
    expect(html).not.toContain("apiKey");
  });

  test("page renders confidence and questions after analyze", async () => {
    const detail = intakeDetail({ status: "needs_answers" });
    queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url] = args as [string, string];
      if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions") {
        return jsonResponse({ success: true, data: { sessions: [] } });
      }
      if (isAiReadinessRequest(method, url)) {
        return jsonResponse({ success: true, data: aiReadiness() });
      }
      if (method === "GET" && url.startsWith("/api/admin/product-intake-wizard/ai-diagnostics")) {
        return jsonResponse({ success: true, data: { diagnostics: [] } });
      }
      if (method === "POST" && url === "/api/admin/product-intake-wizard/analyze") {
        return jsonResponse({
          success: true,
          data: {
            analyzer: null,
            brief: detail.brief,
            sessionId: detail.session.id,
            status: detail.session.status,
            session: detail.session,
            questions: detail.questions,
            answers: detail.answers,
            readiness: detail.readiness,
            aiRun: {
              attempted: true,
              reachedProvider: true,
              provider: "openai",
              model: "gpt-test",
              reason: "live_ai",
              elapsedMs: 3210,
              timeoutMs: 60000,
              sourceResult: "live_ai",
            },
          },
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });

    const { container, root } = await renderCatalogMigrationLabPage();
    const description = Array.from(container.querySelectorAll("textarea")).find((textarea) =>
      textarea.getAttribute("placeholder")?.includes("Foam board"),
    ) as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(description, "13oz banner\nCustom width and height\nSingle sided");
    });
    const generateButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Generate Intake Brief"));
    await act(async () => {
      generateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Session Summary");
    expect(container.textContent).toContain("Current Confidence");
    expect(container.textContent).toContain("Completed with Live AI");
    expect(container.textContent).toContain("openai / gpt-test");
    expect(container.textContent).not.toContain("Not returned");
    expect(container.textContent).toContain("Missing Decisions Wizard");
    expect(container.textContent).toContain("Which pricing model should this product use?");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  test("running status appears, generate is disabled, and cancel aborts request", async () => {
    const pending = deferred<Response>();
    let capturedSignal: AbortSignal | undefined;
    let analyzePostCount = 0;
    queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url, _data, init] = args as [string, string, unknown, RequestInit | undefined];
      if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions") {
        return jsonResponse({ success: true, data: { sessions: [] } });
      }
      if (isAiReadinessRequest(method, url)) {
        return jsonResponse({ success: true, data: aiReadiness() });
      }
      if (method === "GET" && url.startsWith("/api/admin/product-intake-wizard/ai-diagnostics")) {
        return jsonResponse({ success: true, data: { diagnostics: [] } });
      }
      if (method === "POST" && url === "/api/admin/product-intake-wizard/analyze") {
        analyzePostCount += 1;
        capturedSignal = init?.signal as AbortSignal | undefined;
        capturedSignal?.addEventListener("abort", () => pending.reject(Object.assign(new Error("AbortError"), { name: "AbortError" })));
        return pending.promise;
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });

    const { container, root } = await renderCatalogMigrationLabPage();
    const description = Array.from(container.querySelectorAll("textarea")).find((textarea) =>
      textarea.getAttribute("placeholder")?.includes("Foam board"),
    ) as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(description, "13oz banner");
    });
    const generateButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Generate Intake Brief")) as HTMLButtonElement;
    await act(async () => {
      generateButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Running live AI");
    expect(container.textContent).toContain("Live AI is analyzing this product");
    expect(generateButton.disabled).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);
    await act(async () => {
      generateButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(analyzePostCount).toBe(1);

    const cancelButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop / Cancel");
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Canceled by user");
    expect(container.textContent).not.toContain("Session Summary");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  test("sound preference toggle persists", async () => {
    window.localStorage.removeItem("productIntake.playCompletionSound");
    queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url] = args as [string, string];
      if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions") {
        return jsonResponse({ success: true, data: { sessions: [] } });
      }
      if (isAiReadinessRequest(method, url)) {
        return jsonResponse({ success: true, data: aiReadiness() });
      }
      if (method === "GET" && url.startsWith("/api/admin/product-intake-wizard/ai-diagnostics")) {
        return jsonResponse({ success: true, data: { diagnostics: [] } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });

    const { container, root } = await renderCatalogMigrationLabPage();
    const soundToggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(soundToggle.checked).toBe(false);
    await act(async () => {
      Simulate.change(soundToggle, { target: { checked: true } } as any);
    });

    expect(window.localStorage.getItem("productIntake.playCompletionSound")).toBe("true");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  test("page renders confidence and questions after opening recent session", async () => {
    const detail = intakeDetail({ status: "needs_answers" });
    queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url] = args as [string, string];
      if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions") {
        return jsonResponse({ success: true, data: { sessions: [detail.session] } });
      }
      if (isAiReadinessRequest(method, url)) {
        return jsonResponse({ success: true, data: aiReadiness() });
      }
      if (method === "GET" && url === `/api/admin/product-intake-wizard/sessions/${detail.session.id}`) {
        return jsonResponse({ success: true, data: { ...detail, diagnostics: [] } });
      }
      if (method === "GET" && url.startsWith("/api/admin/product-intake-wizard/ai-diagnostics")) {
        return jsonResponse({ success: true, data: { diagnostics: [] } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });

    const { container, root } = await renderCatalogMigrationLabPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open");
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Session Summary");
    expect(container.textContent).toContain("Current Confidence");
    expect(container.textContent).toContain("Missing Decisions Wizard");
    expect(container.textContent).toContain("Which material should this product use?");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });
});
