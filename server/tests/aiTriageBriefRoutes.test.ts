import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const listBriefs = jest.fn<(...args: any[]) => Promise<any>>();
const getBrief = jest.fn<(...args: any[]) => Promise<any>>();
const requestTriageBrief = jest.fn<(...args: any[]) => Promise<any>>();
const enqueue = jest.fn();
const getCapabilities = jest.fn<(...args: any[]) => Promise<any>>();

class MockAiTriageBriefServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));

jest.unstable_mockModule("../services/ai/aiTriageBriefService", () => ({
  AiTriageBriefServiceError: MockAiTriageBriefServiceError,
  aiTriageBriefService: {
    listBriefs,
    getBrief,
    requestTriageBrief,
  },
}));

jest.unstable_mockModule("../services/ai/aiTriageBriefQueue", () => ({
  aiTriageBriefQueue: { enqueue },
}));

jest.unstable_mockModule("../services/ai/aiProviderResolver", () => ({
  aiProviderResolver: { getCapabilities },
}));

let registerAiTriageBriefRoutes: any;

const completedResult = {
  executiveSummary: "Active reports cluster around quote save reliability.",
  topOperationalRisks: [{ title: "Quote save failures", impact: "Operators cannot save work.", confidence: 0.8, rationale: "Multiple reports mention save failures." }],
  topWorkflowRisks: [{ title: "Quote workflow blocked", impact: "Quote work stalls.", confidence: 0.7, rationale: "Saving is required before handoff." }],
  topRevenueRisks: [{ title: "Quote conversion delay", impact: "Revenue may be delayed.", confidence: 0.6, rationale: "Quotes cannot progress." }],
  topBugClusters: [{ issue: "Quote save fails", reportCount: 2, affectedModules: ["Quotes"], impact: "Blocks quote editing." }],
  topFeatureRequests: [{ feature: "Bulk proof reminders", requestCount: 1, value: "Less manual follow-up.", complexity: "unknown" }],
  duplicateSignals: [{ theme: "Quote save", reportIds: ["bug_1", "bug_2"], rationale: "Same module and symptom.", confidence: 0.8 }],
  suggestedPriorityOrder: [{ item: "Investigate quote save", rationale: "High workflow impact.", urgency: "high" }],
  recommendedNextSprint: [{ item: "Reproduce quote save", rationale: "Needed before fix.", urgency: "high" }],
  unknowns: ["No logs supplied."],
  confidence: 0.75,
};

function baseBrief(overrides: Record<string, any> = {}) {
  return {
    id: "brief_1",
    orgId: "org_1",
    status: "completed",
    requestedByEmail: "admin@example.com",
    filtersSnapshot: { status: "open", severity: "all", type: "all", limit: 100 },
    reportSnapshot: [{ id: "bug_1", referenceNumber: "B-0001", title: "Quote save fails" }],
    provider: "openai",
    model: "gpt-4o-mini",
    mode: "printershero_managed",
    promptVersion: "triage-brief-v1",
    result: completedResult,
    summary: completedResult.executiveSummary,
    topRisks: null,
    topFeatures: null,
    recommendedPriorities: null,
    duplicateSignals: null,
    workflowRisks: null,
    revenueRisks: null,
    unknowns: null,
    confidence: 0.75,
    providerMetadata: { hidden: true },
    usageMetadata: { hidden: true },
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-06-03T12:00:00.000Z",
    startedAt: "2026-06-03T12:00:01.000Z",
    completedAt: "2026-06-03T12:00:05.000Z",
    ...overrides,
  };
}

function parseBinaryResponse(res: any, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  const routeModule = await import("../routes/aiTriageBriefs.routes");
  registerAiTriageBriefRoutes = routeModule.registerAiTriageBriefRoutes;
});

function buildApp(options: { orgRole?: string | null; orgId?: string; user?: Record<string, any>; authenticated?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = options.user ?? { id: "user_1", email: "admin@example.com", role: "admin" };
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.orgId ?? "org_1";
    req.orgRole = options.orgRole === undefined ? "admin" : options.orgRole;
    next();
  };
  registerAiTriageBriefRoutes(app, { isAuthenticated, tenantContext });
  return app;
}

describe("AI triage brief routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCapabilities.mockResolvedValue({
      enabled: true,
      mode: "printershero_managed",
      provider: "openai",
      model: "test-model",
      hasApiKey: false,
      features: { bugReview: true, triageBrief: true },
      permissions: { canRunBugReview: true, canGenerateTriageBrief: true, canManageSettings: true },
      usage: { monthlyUsageLimit: null },
    });
    listBriefs.mockResolvedValue([]);
    getBrief.mockResolvedValue(baseBrief());
    requestTriageBrief.mockResolvedValue({ id: "brief_1", status: "pending" });
  });

  test.each(["owner", "admin"])("list allows org %s", async (orgRole) => {
    const response = await request(buildApp({ orgId: "org_2", orgRole })).get("/api/bug-reports/ai-triage-briefs");

    expect(response.status).toBe(200);
    expect(response.body.data.canGenerate).toBe(true);
    expect(listBriefs).toHaveBeenCalledWith("org_2");
  });

  test.each(["manager", "member"])("list denies org %s", async (orgRole) => {
    const response = await request(buildApp({ orgRole })).get("/api/bug-reports/ai-triage-briefs");

    expect(response.status).toBe(403);
    expect(listBriefs).not.toHaveBeenCalled();
  });

  test("list route is not shadowed by a later bug report detail route", async () => {
    const app = buildApp();
    app.get("/api/bug-reports/:id", (_req, res) => {
      res.status(418).json({ success: false, message: "shadowed" });
    });

    const response = await request(app).get("/api/bug-reports/ai-triage-briefs");

    expect(response.status).toBe(200);
    expect(response.body.message).not.toBe("shadowed");
    expect(listBriefs).toHaveBeenCalledWith("org_1");
  });

  test("POST returns 503 when triage feature is disabled", async () => {
    getCapabilities.mockResolvedValueOnce({
      enabled: true,
      mode: "printershero_managed",
      provider: "openai",
      model: "test-model",
      hasApiKey: false,
      features: { bugReview: true, triageBrief: false },
      permissions: { canRunBugReview: true, canGenerateTriageBrief: false, canManageSettings: true },
      usage: { monthlyUsageLimit: null },
    });

    const response = await request(buildApp()).post("/api/bug-reports/ai-triage-brief").send({ filters: { status: "open", type: "all" } });

    expect(response.status).toBe(503);
    expect(requestTriageBrief).not.toHaveBeenCalled();
  });

  test("POST creates pending brief, queues processing, and returns 202", async () => {
    const response = await request(buildApp())
      .post("/api/bug-reports/ai-triage-brief")
      .send({ filters: { status: "open", severity: "high", type: "all" } });

    expect(response.status).toBe(202);
    expect(response.body.data).toEqual({ briefId: "brief_1", status: "pending" });
    expect(requestTriageBrief).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      filters: expect.objectContaining({ status: "open", severity: "high", type: "all" }),
    }));
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org_1", briefId: "brief_1" });
  });

  test("POST blocks manager access", async () => {
    const response = await request(buildApp({ orgRole: "manager" }))
      .post("/api/bug-reports/ai-triage-brief")
      .send({ filters: { status: "open" } });

    expect(response.status).toBe(403);
    expect(requestTriageBrief).not.toHaveBeenCalled();
  });

  test.each(["owner", "admin"])("completed brief PDF export succeeds for org %s with PDF headers and safe filename", async (orgRole) => {
    const response = await request(buildApp({ orgRole }))
      .get("/api/bug-reports/ai-triage-briefs/brief_1/pdf")
      .buffer(true)
      .parse(parseBinaryResponse);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["content-disposition"]).toContain("printers-hero-ai-triage-brief-2026-06-03.pdf");
    expect(response.body.slice(0, 4).toString()).toBe("%PDF");
    expect(getBrief).toHaveBeenCalledWith("org_1", "brief_1");
  });

  test("unauthenticated PDF export is denied by auth middleware", async () => {
    const response = await request(buildApp({ authenticated: false })).get("/api/bug-reports/ai-triage-briefs/brief_1/pdf");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthorized");
    expect(getBrief).not.toHaveBeenCalled();
  });

  test.each(["pending", "processing", "failed"])("%s brief cannot be exported as PDF", async (status) => {
    getBrief.mockResolvedValueOnce(baseBrief({ status, result: status === "failed" ? null : completedResult }));

    const response = await request(buildApp()).get("/api/bug-reports/ai-triage-briefs/brief_1/pdf");

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("AI_TRIAGE_BRIEF_NOT_COMPLETED");
  });

  test("cross-org PDF export is denied by org-scoped lookup", async () => {
    getBrief.mockImplementationOnce(async (orgId: string) => orgId === "org_1" ? baseBrief() : null);

    const response = await request(buildApp({ orgId: "org_2" })).get("/api/bug-reports/ai-triage-briefs/brief_1/pdf");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("AI_TRIAGE_BRIEF_NOT_FOUND");
    expect(getBrief).toHaveBeenCalledWith("org_2", "brief_1");
  });

  test("non-admin cannot export PDF", async () => {
    const response = await request(buildApp({ orgRole: "member" })).get("/api/bug-reports/ai-triage-briefs/brief_1/pdf");

    expect(response.status).toBe(403);
    expect(getBrief).not.toHaveBeenCalled();
  });
});
