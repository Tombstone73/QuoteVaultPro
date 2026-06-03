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

beforeAll(async () => {
  const routeModule = await import("../routes/aiTriageBriefs.routes");
  registerAiTriageBriefRoutes = routeModule.registerAiTriageBriefRoutes;
});

function buildApp(options: { orgRole?: string | null; orgId?: string; user?: Record<string, any> } = {}) {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, _res: any, next: any) => {
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
    getBrief.mockResolvedValue({ id: "brief_1", status: "completed" });
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
});
