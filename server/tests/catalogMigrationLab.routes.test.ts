import { describe, expect, test } from "@jest/globals";
import express, { type NextFunction, type Response } from "express";
import { readFileSync } from "fs";
import path from "path";
import request from "supertest";
import type {
  ProductIntakeAnswer,
  ProductIntakeAiDiagnostic,
  ProductIntakeBrief,
  ProductIntakeQuestion,
  ProductIntakeSession,
  ProductIntakeSessionDetail,
  ProductIntakeSessionStatus,
} from "../../shared/productIntakeWizardSchemas";
import { registerCatalogMigrationLabRoutes } from "../routes/catalogMigrationLab.routes";
import {
  computeProductIntakeReadiness,
  generateProductIntakeQuestions,
  resolveProductIntakeSessionStatus,
  type ProductIntakeSessionStore,
} from "../services/productIntakeWizard/productIntakeSessionService";
import type {
  ProductIntakeAiDiagnosticInput,
  ProductIntakeAiDiagnosticsStore,
} from "../services/productIntakeWizard/productIntakeDiagnosticsService";

type AppOptions = {
  authenticated?: boolean;
  orgRole?: string;
  userRole?: string;
  isPlatformAdmin?: boolean;
  isPlatformDeveloper?: boolean;
  organizationId?: string;
  productIntakeAiProvider?: any;
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
        confidence: { overallConfidence: input.brief.overallConfidence },
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

    const answered = await request(app)
      .patch(`/api/admin/product-intake-wizard/sessions/${sessionId}/answers`)
      .send({ answers: [{ questionId: question.id, answer: "3/16 White Foam Board" }] });
    expect(answered.status).toBe(200);
    expect(answered.body.data.answers[0].answer).toBe("3/16 White Foam Board");

    const abandoned = await request(app).post(`/api/admin/product-intake-wizard/sessions/${sessionId}/abandon`);
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.data.session.status).toBe("abandoned");
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
    expect(JSON.stringify(response.body)).not.toMatch(/apiKey|sk-/i);
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
