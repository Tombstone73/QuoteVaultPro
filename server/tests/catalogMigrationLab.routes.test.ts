import { describe, expect, test } from "@jest/globals";
import express, { type NextFunction, type Response } from "express";
import { readFileSync } from "fs";
import path from "path";
import request from "supertest";
import type {
  ProductIntakeAnswer,
  ProductIntakeAiDiagnostic,
  ProductIntakeAiReadiness,
  ProductIntakeBrief,
  ProductIntakeQuestion,
  ProductIntakeSession,
  ProductIntakeSessionDetail,
  ProductIntakeSessionStatus,
} from "../../shared/productIntakeWizardSchemas";
import { registerCatalogMigrationLabRoutes } from "../routes/catalogMigrationLab.routes";
import {
  computeProductIntakeReadiness,
  createDbProductIntakeSessionStore,
  generateProductIntakeQuestions,
  resolveProductIntakeSessionStatus,
  type ProductIntakeSessionStore,
} from "../services/productIntakeWizard/productIntakeSessionService";
import {
  productIntakeAnswers,
  productIntakeAiDiagnostics,
  productIntakeQuestions,
  productIntakeSessions,
} from "../../shared/schema";
import type {
  ProductIntakeAiDiagnosticInput,
  ProductIntakeAiDiagnosticsStore,
} from "../services/productIntakeWizard/productIntakeDiagnosticsService";
import { AiProviderTimeoutError } from "../services/ai/providers/AiProviderAdapter";

type AppOptions = {
  authenticated?: boolean;
  orgRole?: string;
  userRole?: string;
  isPlatformAdmin?: boolean;
  isPlatformDeveloper?: boolean;
  organizationId?: string;
  productIntakeAiProvider?: any;
  productIntakeAiReadinessResolver?: (args: {
    organizationId: string;
    userId: string | null;
    databaseIdentifier: string | null;
  }) => Promise<ProductIntakeAiReadiness>;
};

function makeMemoryProductIntakeSessionStore(): ProductIntakeSessionStore {
  const details: ProductIntakeSessionDetail[] = [];
  let sessionSeq = 0;
  let questionSeq = 0;
  let answerSeq = 0;

  const refreshReadiness = (detail: ProductIntakeSessionDetail) => {
    detail.readiness = computeProductIntakeReadiness({
      session: detail.session,
      questions: detail.questions,
      answers: detail.answers,
    });
    detail.session.status = detail.readiness.status as ProductIntakeSessionStatus;
    return detail;
  };

  return {
    async createFromAnalysis(input) {
      const now = new Date().toISOString();
      const questions = generateProductIntakeQuestions(input.brief).map((question) => ({
        ...question,
        id: `q_${++questionSeq}`,
        organizationId: input.organizationId,
        sessionId: `sess_${sessionSeq + 1}`,
        createdAt: now,
      })) as ProductIntakeQuestion[];
      const session: ProductIntakeSession = {
        id: `sess_${++sessionSeq}`,
        organizationId: input.organizationId,
        sourceType: input.request.sourceType === "text_description" ? "text_description" : input.request.sourceType === "uploaded_json" ? "json_upload" : "json_paste",
        sourceFingerprint: input.analyzer?.source.fingerprint ?? "fingerprint",
        brief: input.brief,
        confidence: {
          originalConfidence: input.brief.overallConfidence,
          currentConfidence: input.brief.overallConfidence,
          overallConfidence: input.brief.overallConfidence,
        },
        missingDecisions: input.brief.missingDecisions,
        status: resolveProductIntakeSessionStatus(input.brief, questions),
        createdProductId: null,
        createdPbv2TreeVersionId: null,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
        abandonedAt: null,
      };
      const detail: ProductIntakeSessionDetail = {
        session,
        brief: input.brief,
        questions: questions.map((question) => ({ ...question, sessionId: session.id })),
        answers: [],
        readiness: {
          unansweredRequiredCount: 0,
          answeredCount: 0,
          canCreateDraft: false,
          status: session.status,
        },
      };
      details.push(refreshReadiness(detail));
      return detail;
    },
    async listSessions(organizationId, filters = {}) {
      return details
        .map((detail) => detail.session)
        .filter((session) => session.organizationId === organizationId)
        .filter((session) => !filters.status || session.status === filters.status)
        .filter((session) => !filters.sourceType || session.sourceType === filters.sourceType);
    },
    async getSessionDetail(organizationId, sessionId) {
      return details.find((detail) => detail.session.organizationId === organizationId && detail.session.id === sessionId) ?? null;
    },
    async upsertAnswers({ organizationId, sessionId, userId, answers }) {
      const detail = details.find((row) => row.session.organizationId === organizationId && row.session.id === sessionId);
      if (!detail) return null;
      const now = new Date().toISOString();
      for (const incoming of answers) {
        const question = detail.questions.find((candidate) =>
          (incoming.questionId && candidate.id === incoming.questionId) || (incoming.questionKey && candidate.questionKey === incoming.questionKey),
        );
        if (!question) continue;
        const existing = detail.answers.find((answer) => answer.questionKey === question.questionKey);
        const answerRow: ProductIntakeAnswer = {
          id: existing?.id ?? `a_${++answerSeq}`,
          organizationId,
          sessionId,
          questionId: question.id,
          questionKey: question.questionKey,
          answer: incoming.answer ?? null,
          answeredByUserId: userId,
          answeredAt: incoming.answer == null ? null : now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        if (existing) Object.assign(existing, answerRow);
        else detail.answers.push(answerRow);
      }
      detail.session.updatedAt = now;
      detail.session.updatedByUserId = userId;
      return refreshReadiness(detail);
    },
    async abandonSession({ organizationId, sessionId, userId }) {
      const detail = details.find((row) => row.session.organizationId === organizationId && row.session.id === sessionId);
      if (!detail) return null;
      const now = new Date().toISOString();
      detail.session.status = "abandoned";
      detail.session.abandonedAt = now;
      detail.session.updatedAt = now;
      detail.session.updatedByUserId = userId;
      detail.readiness = computeProductIntakeReadiness({ session: detail.session, questions: detail.questions, answers: detail.answers });
      return detail;
    },
    async deleteSessions({ organizationId, filters }) {
      const matches = details.filter((detail) =>
        detail.session.organizationId === organizationId &&
        (!filters.sessionIds?.length || filters.sessionIds.includes(detail.session.id)) &&
        (!filters.status || detail.session.status === filters.status) &&
        (!filters.briefSource || detail.session.brief.source === filters.briefSource),
      );
      let questions = 0;
      let answers = 0;
      for (const detail of matches) {
        questions += detail.questions.length;
        answers += detail.answers.length;
      }
      for (const match of matches) {
        const index = details.findIndex((detail) => detail.session.id === match.session.id);
        if (index >= 0) details.splice(index, 1);
      }
      return { sessions: matches.length, questions, answers, diagnostics: 0 };
    },
  };
}

function makeMemoryProductIntakeDiagnosticsStore(seed: ProductIntakeAiDiagnostic[] = []): ProductIntakeAiDiagnosticsStore {
  const diagnostics = [...seed];
  let diagnosticSeq = diagnostics.length;
  return {
    async recordSchemaValidationFailure(input: ProductIntakeAiDiagnosticInput) {
      diagnostics.push({
        id: `diag_${++diagnosticSeq}`,
        organizationId: input.organizationId,
        sessionId: input.sessionId ?? null,
        sourceType: input.sourceType,
        sourceFingerprint: input.sourceFingerprint ?? null,
        provider: input.provider,
        model: input.model,
        rawAiResponse: input.rawAiResponse,
        validationErrors: input.validationErrors,
        failedSchemaPaths: input.failedSchemaPaths,
        repairActions: input.repairActions ?? [],
        promptVersion: input.promptVersion,
        createdByUserId: input.createdByUserId,
        createdAt: new Date().toISOString(),
      });
    },
    async attachRecentToSession({ organizationId, sessionId, sourceFingerprint }) {
      for (const diagnostic of diagnostics) {
        if (diagnostic.organizationId === organizationId && diagnostic.sourceFingerprint === sourceFingerprint && !diagnostic.sessionId) {
          diagnostic.sessionId = sessionId;
        }
      }
    },
    async listRecent(organizationId: string, filters = {}) {
      return diagnostics.filter((diagnostic) =>
        diagnostic.organizationId === organizationId &&
        (!filters.sessionId || diagnostic.sessionId === filters.sessionId),
      );
    },
  };
}

function aiReadiness(overrides: Partial<ProductIntakeAiReadiness> = {}): ProductIntakeAiReadiness {
  return {
    organizationId: "org_1",
    userId: "user_1",
    databaseIdentifier: "testdb",
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

function buildApp(
  options: AppOptions = {},
  productIntakeSessionStore = makeMemoryProductIntakeSessionStore(),
  productIntakeDiagnosticsStore = makeMemoryProductIntakeDiagnosticsStore(),
) {
  const app = express();
  app.use(express.json({ limit: "3mb" }));

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (options.authenticated === false) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    req.user = {
      id: "user_1",
      role: options.userRole ?? options.orgRole ?? "admin",
      isPlatformAdmin: options.isPlatformAdmin,
      isPlatformDeveloper: options.isPlatformDeveloper,
    };
    return next();
  };

  const tenantContext = (req: any, _res: Response, next: NextFunction) => {
    req.organizationId = options.organizationId ?? "org_1";
    req.orgRole = options.orgRole ?? "admin";
    return next();
  };

  const assertInternalUser = (req: any, res: Response) => {
    if (req.user?.role === "customer") {
      res.status(403).json({ success: false, message: "Internal access required." });
      return false;
    }
    return true;
  };

  registerCatalogMigrationLabRoutes(app, {
    isAuthenticated,
    tenantContext,
    assertInternalUser,
    getReferenceData: async () => ({
      materials: [{ id: "mat_1", sku: "CORO4", name: "4mm White Coroplast" }],
      templates: [{
        id: "tpl_grommets",
        name: "Grommets",
        slug: "grommets",
        category: "finishing",
        tags: ["banner", "hardware"],
        workflowMetadata: { finishing_required: true },
        templateTree: {
          nodes: {
            group_grommets: { label: "Grommets", name: "Grommets" },
            opt_grommets: { label: "Grommets", input: { choices: [{ label: "Corners" }] } },
          },
        },
      }],
    }),
    productIntakeAiProvider: options.productIntakeAiProvider ?? null,
    productIntakeSessionStore,
    productIntakeDiagnosticsStore,
    productIntakeAiReadinessResolver: options.productIntakeAiReadinessResolver ?? (async ({ organizationId, userId, databaseIdentifier }) => aiReadiness({ organizationId, userId, databaseIdentifier })),
  });

  return app;
}

describe("Catalog Migration Lab routes", () => {
  test("blocks unauthenticated users", async () => {
    const response = await request(buildApp({ authenticated: false }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{}" });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("blocks non-admin internal users", async () => {
    const response = await request(buildApp({ orgRole: "employee", userRole: "employee" }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{}" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test("allows platform developers", async () => {
    const response = await request(buildApp({ orgRole: "employee", userRole: "employee", isPlatformDeveloper: true }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({
        jsonText: JSON.stringify({
          products: [{ productName: "Window Perf", categoryName: "Window Graphics", retailPrice: 10 }],
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.counts.totalProducts).toBe(1);
  });

  test("malformed JSON fails safely", async () => {
    const response = await request(buildApp())
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{ nope" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: "MALFORMED_JSON",
    });
  });

  test("valid JSON returns analysis", async () => {
    const response = await request(buildApp())
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({
        fileName: "infoflo.json",
        jsonText: JSON.stringify({
          Products: [
            {
              Name: "Coroplast Yard Sign",
              Category: "Rigid Signs",
              Active: true,
              Material: "4mm White Coroplast",
              PriceBreaks: [{ minQty: 1, price: 24 }],
              Options: [{ Name: "Size" }, { Name: "Stake" }],
            },
          ],
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.source.fileName).toBe("infoflo.json");
    expect(response.body.data.counts.totalProducts).toBe(1);
    expect(response.body.data.materialCandidates[0].matchedMaterial.id).toBe("mat_1");
    expect(response.body.data.pricingPatterns[0].bucket).toBe("tiered_pricing");
  });

  test("product intake route returns a review-ready brief for JSON without catalog mutation permission", async () => {
    const response = await request(buildApp())
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "pasted_json",
        jsonText: JSON.stringify({
          Products: [
            {
              Name: "Coroplast Yard Sign",
              Category: "Rigid Signs",
              Active: true,
              Material: "4mm White Coroplast",
              PriceBreaks: [{ minQty: 1, price: 24 }],
              form_fields: [
                { field_label: "Size", field_type: "select", required: true, options: ["18x24"] },
                { field_label: "Grommets", field_type: "select", options: ["None", "Corners"] },
              ],
            },
          ],
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.workflow).toMatchObject({
      currentState: "REVIEW_READY",
      terminalState: "REVIEW_READY",
      catalogMutationAllowed: false,
    });
    expect(response.body.data.brief.workflowState).toBe("REVIEW_READY");
    expect(response.body.data.brief.productIdentity.likelyProductName.value).toBe("Coroplast Yard Sign");
    expect(response.body.data.brief.materialAnalysis.likelyMaterialMatches[0].materialId).toBe("mat_1");
    expect(response.body.data.brief.templateMatches.some((match: any) => match.templateId === "tpl_grommets")).toBe(true);
    expect(response.body.data.sessionId).toBeTruthy();
    expect(response.body.data.session.status).toMatch(/needs_answers|ready_for_draft|analyzed/);
    expect(response.body.data.readiness.canCreateDraft).toBe(false);
  });

  test("product intake route supports a short text description without running JSON import", async () => {
    const response = await request(buildApp())
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "Foam board signs with optional grommets",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.analyzer).toBeNull();
    expect(response.body.data.brief.workflowState).toBe("REVIEW_READY");
    expect(response.body.data.brief.productIdentity.category.value).toBe("Foam Board");
    expect(response.body.data.workflow.catalogMutationAllowed).toBe(false);
    expect(response.body.data.session.sourceType).toBe("text_description");
    expect(response.body.data.questions.some((question: any) => question.questionKey === "select-material")).toBe(true);
    expect(response.body.data.session.status).toBe("needs_answers");
  });

  test("product intake analyze response includes confidence, questions, and readiness for a banner prompt", async () => {
    const response = await request(buildApp())
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
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
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      sessionId: expect.any(String),
      status: expect.any(String),
      session: expect.objectContaining({
        confidence: expect.objectContaining({
          originalConfidence: expect.any(Number),
          currentConfidence: expect.any(Number),
        }),
      }),
      readiness: expect.objectContaining({
        unansweredRequiredCount: expect.any(Number),
        answeredCount: 0,
        canCreateDraft: false,
      }),
    });
    expect(response.body.data.brief.productIdentity.likelyProductName.value).toMatch(/Banner/);
    expect(response.body.data.brief.overallConfidence).toEqual(expect.any(Number));
    expect(Array.isArray(response.body.data.questions)).toBe(true);
    expect(response.body.data.questions.some((question: any) => question.questionKey === "confirm-routing-proof-prepress")).toBe(false);
    expect(response.body.data.readiness.reviewState).toMatch(/ready_for_draft|needs_review|not_ready/);
    expect(response.body.data.answers).toEqual([]);
  });

  test("product intake analyze returns aiRun attempted false for missing AI settings", async () => {
    let providerCalled = false;
    const provider = {
      generateJson: async () => {
        providerCalled = true;
        return { rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} };
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };
    const diagnosticsStore = makeMemoryProductIntakeDiagnosticsStore();
    const app = buildApp({
      productIntakeAiProvider: provider,
      productIntakeAiReadinessResolver: async () => aiReadiness({
        enabled: false,
        mode: "disabled",
        featureReviewEnabled: false,
        provider: null,
        model: null,
        reason: "missing_org_ai_settings",
        canAttemptLiveAi: false,
      }),
    }, makeMemoryProductIntakeSessionStore(), diagnosticsStore);
    const response = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "4mm coroplast yard signs" });

    expect(response.status).toBe(200);
    expect(providerCalled).toBe(false);
    expect(response.body.data.aiRun).toMatchObject({
      attempted: false,
      reachedProvider: false,
      provider: null,
      model: null,
      reason: "missing_org_ai_settings",
      sourceResult: "provider_unavailable_fallback",
    });
    expect(response.body.data.brief.fallbackReason).toContain("missing_org_ai_settings");
    const diagnostics = await request(app).get(`/api/admin/product-intake-wizard/ai-diagnostics?sessionId=${response.body.data.sessionId}`);
    expect(diagnostics.body.data.diagnostics).toEqual([]);
  });

  test("product intake analyze returns aiRun feature review disabled without provider call", async () => {
    let providerCalled = false;
    const provider = {
      generateJson: async () => {
        providerCalled = true;
        return { rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} };
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };
    const response = await request(buildApp({
      productIntakeAiProvider: provider,
      productIntakeAiReadinessResolver: async () => aiReadiness({
        featureReviewEnabled: false,
        reason: "feature_review_disabled",
        canAttemptLiveAi: false,
      }),
    }))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "13oz banner" });

    expect(response.status).toBe(200);
    expect(providerCalled).toBe(false);
    expect(response.body.data.aiRun).toMatchObject({
      attempted: false,
      reachedProvider: false,
      reason: "feature_review_disabled",
      sourceResult: "provider_unavailable_fallback",
    });
  });

  test("product intake analyze repairs representative banner AI output and returns live AI brief", async () => {
    const provider = {
      generateJson: async () => ({
        rawText: JSON.stringify({
          productName: "13oz Banner",
          productCategory: "Banners",
          productType: "banner",
          pricingModel: "quantity-tier",
          sizeBehavior: "custom width and height",
          quantityBehavior: "tiers",
          options: { optional: ["Grommets", "Pole pockets"] },
          confidence: "85%",
        }),
        provider: "openai",
        model: "test-model",
        requestMetadata: {},
      }),
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const response = await request(buildApp({ productIntakeAiProvider: provider }))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "13oz banner custom width and height quantity tier pricing route to roll printer proof required",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.brief.source).toBe("live_ai");
    expect(response.body.data.brief.fallbackReason).toBeNull();
    expect(response.body.data.brief.aiRepair.accepted).toBe(true);
    expect(response.body.data.brief.productIdentity.likelyProductName.value).toBe("13oz Banner");
    expect(response.body.data.brief.pricingAnalysis.behavior).toBe("quantity_tiers");
    expect(response.body.data.sessionId).toBeTruthy();
    expect(response.body.data.readiness.canCreateDraft).toBe(false);
    expect(response.body.data.aiRun).toMatchObject({
      attempted: true,
      reachedProvider: true,
      provider: "openai",
      model: "test-model",
      sourceResult: "live_ai_repaired",
    });
  });

  test("product intake analyze timeout returns aiRun provider and model", async () => {
    const provider = {
      generateJson: async () => {
        throw new AiProviderTimeoutError({
          timeoutMs: 60000,
          elapsedMs: 60001,
          provider: "openai",
          model: "test-model",
          useCase: "product_intake",
        });
      },
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "test-model", requestMetadata: {} }),
    };

    const response = await request(buildApp({ productIntakeAiProvider: provider }))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "13oz banner" });

    expect(response.status).toBe(200);
    expect(response.body.data.aiRun).toMatchObject({
      attempted: true,
      reachedProvider: true,
      provider: "openai",
      model: "test-model",
      reason: "timeout",
      elapsedMs: 60001,
      timeoutMs: 60000,
      sourceResult: "timeout_fallback",
    });
  });

  test("product intake analyze still succeeds if diagnostics attachment fails after session creation", async () => {
    const diagnosticsStore: ProductIntakeAiDiagnosticsStore = {
      recordSchemaValidationFailure: async () => undefined,
      attachRecentToSession: async () => {
        throw new Error("diagnostics table unavailable");
      },
      listRecent: async () => [],
    };
    const response = await request(buildApp({}, makeMemoryProductIntakeSessionStore(), diagnosticsStore))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "13oz banner custom width and height, single sided, quantity based pricing, proof required",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sessionId).toBeTruthy();
    expect(response.body.data.session.status).toMatch(/needs_answers|ready_for_draft|analyzed/);
    expect(response.body.data.readiness.canCreateDraft).toBe(false);
  });

  test("product intake route supports pvc text description with success response", async () => {
    const response = await request(buildApp())
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "PVC signs printed on 3mm PVC. Sizes: 12x18 18x24 24x36. Single or double sided. Contour cut shapes available. Optional grommets.",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sessionId).toBeTruthy();
    expect(response.body.data.brief.workflowState).toBe("REVIEW_READY");
    expect(response.body.data.questions).toEqual(expect.any(Array));
    expect(response.body.data.readiness).toMatchObject({
      canCreateDraft: false,
      answeredCount: 0,
    });
  });

  test("product intake route returns unknown source shape only for true invalid source shape", async () => {
    const response = await request(buildApp())
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "",
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: "UNKNOWN_SOURCE_SHAPE",
    });
  });

  test("product intake sessions can be listed, opened, answered, and abandoned", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const app = buildApp({}, store);
    const created = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({
        sourceType: "text_description",
        description: "Foam board signs with optional grommets",
      });
    const sessionId = created.body.data.sessionId;
    const question = created.body.data.questions.find((row: any) => row.required);

    const list = await request(app).get("/api/admin/product-intake-wizard/sessions");
    expect(list.status).toBe(200);
    expect(list.body.data.sessions.some((session: any) => session.id === sessionId)).toBe(true);

    const detail = await request(app).get(`/api/admin/product-intake-wizard/sessions/${sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.readiness.canCreateDraft).toBe(false);
    expect(Array.isArray(detail.body.data.questions)).toBe(true);
    expect(Array.isArray(detail.body.data.answers)).toBe(true);
    expect(Array.isArray(detail.body.data.diagnostics)).toBe(true);

    const answered = await request(app)
      .patch(`/api/admin/product-intake-wizard/sessions/${sessionId}/answers`)
      .send({ answers: [{ questionId: question.id, answer: "3/16 White Foam Board" }] });
    expect(answered.status).toBe(200);
    expect(answered.body.data.answers[0].answer).toBe("3/16 White Foam Board");

    const abandoned = await request(app).post(`/api/admin/product-intake-wizard/sessions/${sessionId}/abandon`);
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.data.session.status).toBe("abandoned");
  });

  test("product intake session delete removes session questions and answers", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const app = buildApp({}, store);
    const created = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs with optional grommets" });
    const sessionId = created.body.data.sessionId;
    const question = created.body.data.questions.find((row: any) => row.required);
    await request(app)
      .patch(`/api/admin/product-intake-wizard/sessions/${sessionId}/answers`)
      .send({ answers: [{ questionId: question.id, answer: "3/16 White Foam Board" }] });

    const deleted = await request(app).delete(`/api/admin/product-intake-wizard/sessions/${sessionId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toMatchObject({
      sessions: 1,
      questions: expect.any(Number),
      answers: 1,
    });

    const detail = await request(app).get(`/api/admin/product-intake-wizard/sessions/${sessionId}`);
    expect(detail.status).toBe(404);
  });

  test("product intake session delete blocks another organization session", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const created = await request(buildApp({ organizationId: "org_1" }, store))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs with optional grommets" });

    const deleted = await request(buildApp({ organizationId: "org_2" }, store))
      .delete(`/api/admin/product-intake-wizard/sessions/${created.body.data.sessionId}`);

    expect(deleted.status).toBe(404);
    expect(deleted.body.errorCode).toBe("SESSION_NOT_FOUND");
  });

  test("product intake session delete not found returns safe response", async () => {
    const response = await request(buildApp())
      .delete("/api/admin/product-intake-wizard/sessions/missing-session");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: "SESSION_NOT_FOUND",
    });
  });

  test("product intake bulk delete selected and abandoned sessions", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const app = buildApp({}, store);
    const first = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs with optional grommets" });
    const second = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "13oz banner custom width and height proof required" });

    const selected = await request(app)
      .post("/api/admin/product-intake-wizard/sessions/bulk-delete")
      .send({ mode: "selected", sessionIds: [first.body.data.sessionId] });
    expect(selected.status).toBe(200);
    expect(selected.body.data.deleted.sessions).toBe(1);

    await request(app).post(`/api/admin/product-intake-wizard/sessions/${second.body.data.sessionId}/abandon`);
    const abandoned = await request(app)
      .post("/api/admin/product-intake-wizard/sessions/bulk-delete")
      .send({ mode: "abandoned" });
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.data.deleted.sessions).toBe(1);
  });

  test("product intake bulk delete analyzer fallback sessions only removes fallback briefs", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const app = buildApp({}, store);
    await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs with optional grommets" });

    const deleted = await request(app)
      .post("/api/admin/product-intake-wizard/sessions/bulk-delete")
      .send({ mode: "analyzer_fallback" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted.sessions).toBe(1);
  });

  test("db-backed product intake session delete removes diagnostics before session rows", async () => {
    const deletedTables: unknown[] = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "sess_1" }],
          }),
        }),
      }),
      delete: (table: unknown) => {
        deletedTables.push(table);
        return {
          where: () => ({
            returning: async () => {
              if (table === productIntakeAiDiagnostics) return [{ id: "diag_1" }, { id: "diag_2" }];
              if (table === productIntakeAnswers) return [{ id: "answer_1" }, { id: "answer_2" }, { id: "answer_3" }];
              if (table === productIntakeQuestions) return [{ id: "question_1" }, { id: "question_2" }];
              if (table === productIntakeSessions) return [{ id: "sess_1" }];
              return [];
            },
          }),
        };
      },
    };

    const store = createDbProductIntakeSessionStore(fakeDb);
    const deleted = await store.deleteSessions({ organizationId: "org_1", filters: { sessionIds: ["sess_1"] } });

    expect(deleted).toEqual({ sessions: 1, questions: 2, answers: 3, diagnostics: 2 });
    expect(deletedTables).toEqual([
      productIntakeAiDiagnostics,
      productIntakeAnswers,
      productIntakeQuestions,
      productIntakeSessions,
    ]);
  });

  test("product intake answers cannot target another organization session", async () => {
    const store = makeMemoryProductIntakeSessionStore();
    const created = await request(buildApp({ organizationId: "org_1" }, store))
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs with optional grommets" });

    const response = await request(buildApp({ organizationId: "org_2" }, store))
      .patch(`/api/admin/product-intake-wizard/sessions/${created.body.data.sessionId}/answers`)
      .send({ answers: [{ questionKey: "select-material", answer: "Other org material" }] });

    expect(response.status).toBe(404);
  });

  test("schema validation diagnostics are attached to the current intake session", async () => {
    const diagnosticsStore = makeMemoryProductIntakeDiagnosticsStore();
    const provider = {
      generateJson: async () => ({
        rawText: JSON.stringify({ workflowState: "REVIEW_READY", source: "live_ai" }),
        provider: "openai",
        model: "gpt-test",
        requestMetadata: {},
      }),
      generateBugReview: async () => ({ rawText: "{}", provider: "openai", model: "gpt-test", requestMetadata: {} }),
      generateTriageBrief: async () => ({ rawText: "{}", provider: "openai", model: "gpt-test", requestMetadata: {} }),
    };
    const app = buildApp({ productIntakeAiProvider: provider }, makeMemoryProductIntakeSessionStore(), diagnosticsStore);
    const created = await request(app)
      .post("/api/admin/product-intake-wizard/analyze")
      .send({ sourceType: "text_description", description: "Foam board signs" });

    expect(created.status).toBe(200);
    const sessionId = created.body.data.sessionId;
    const diagnostics = await request(app).get(`/api/admin/product-intake-wizard/ai-diagnostics?sessionId=${sessionId}`);

    expect(diagnostics.status).toBe(200);
    expect(diagnostics.body.data.diagnostics).toHaveLength(1);
    expect(diagnostics.body.data.diagnostics[0]).toMatchObject({
      sessionId,
      provider: "openai",
      model: "gpt-test",
    });
  });

  test("product intake diagnostics endpoint returns recent admin diagnostics without secrets", async () => {
    const diagnosticsStore = makeMemoryProductIntakeDiagnosticsStore([{
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
      repairActions: [],
      promptVersion: "product-intake-brief-v1",
      createdByUserId: "user_1",
      createdAt: "2026-06-05T00:00:00.000Z",
    }]);
    const response = await request(buildApp({}, makeMemoryProductIntakeSessionStore(), diagnosticsStore))
      .get("/api/admin/product-intake-wizard/ai-diagnostics");

    expect(response.status).toBe(200);
    expect(response.body.data.diagnostics[0]).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      rawAiResponse: "{\"bad\":true}",
      failedSchemaPaths: ["productIdentity"],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/sk-/i);
  });

  test("product intake AI readiness endpoint returns missing settings", async () => {
    const response = await request(buildApp({
      productIntakeAiReadinessResolver: async ({ organizationId, userId, databaseIdentifier }) => aiReadiness({
        organizationId,
        userId,
        databaseIdentifier,
        enabled: false,
        mode: "disabled",
        featureReviewEnabled: false,
        provider: null,
        model: null,
        reason: "missing_org_ai_settings",
        managedEnv: { endpointPresent: false, apiKeyPresent: false, modelPresent: false },
        canAttemptLiveAi: false,
      }),
    })).get("/api/admin/product-intake-wizard/ai-readiness");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      organizationId: "org_1",
      userId: "user_1",
      enabled: false,
      reason: "missing_org_ai_settings",
      canAttemptLiveAi: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/sk-/i);
  });

  test("product intake AI readiness endpoint returns feature review disabled", async () => {
    const response = await request(buildApp({
      productIntakeAiReadinessResolver: async () => aiReadiness({
        enabled: true,
        featureReviewEnabled: false,
        reason: "feature_review_disabled",
        canAttemptLiveAi: false,
      }),
    })).get("/api/admin/product-intake-wizard/ai-readiness");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      enabled: true,
      featureReviewEnabled: false,
      reason: "feature_review_disabled",
      canAttemptLiveAi: false,
    });
  });

  test("product intake AI readiness endpoint returns live AI ready", async () => {
    const response = await request(buildApp({
      productIntakeAiReadinessResolver: async () => aiReadiness(),
    })).get("/api/admin/product-intake-wizard/ai-readiness");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      enabled: true,
      mode: "printershero_managed",
      featureReviewEnabled: true,
      provider: "openai",
      model: "gpt-test",
      reason: "live_ai_ready",
      canAttemptLiveAi: true,
    });
  });

  test("catalog migration lab server files contain no database write calls", () => {
    const files = [
      "server/routes/catalogMigrationLab.routes.ts",
      "server/services/catalogMigrationLab/analyzer.ts",
      "server/services/catalogMigrationLab/adapters/infoFloJsonAdapter.ts",
      "server/services/productIntakeWizard/productIntakeBriefService.ts",
      "server/services/productIntakeWizard/productIntakeSessionService.ts",
    ];
    const combined = files
      .map((file) => readFileSync(path.resolve(process.cwd(), file), "utf8"))
      .join("\n");

    expect(combined).not.toMatch(/\b(?:db|tx)\s*\.\s*(?:insert|update|delete)\s*\(\s*(?:products|pbv2TreeVersions)\b/);
    expect(combined).not.toMatch(/\b(?:db|tx)\s*\.\s*insert\s*\(\s*pbv2_tree_versions\b/);
    expect(combined).not.toMatch(/\b(?:db|tx)\s*\.\s*insert\s*\(\s*products\b/);
    expect(combined).not.toMatch(/\/api\/pbv2\/tree-versions\/:id\/publish/);
    expect(combined).not.toMatch(/\bstorage\s*\.\s*createProduct\b/);
  });
});
