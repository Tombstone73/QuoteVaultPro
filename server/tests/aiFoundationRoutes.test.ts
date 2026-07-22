import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const getCapabilities = jest.fn<(...args: any[]) => Promise<any>>();
const getSettings = jest.fn<(...args: any[]) => Promise<any>>();
const updateSettings = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../db", () => ({
  db: {
    insert: () => ({
      values: async () => undefined,
    }),
  },
}));

jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));

jest.unstable_mockModule("../services/ai/aiProviderResolver", () => ({
  aiProviderResolver: { getCapabilities },
}));

jest.unstable_mockModule("../services/ai/aiSettingsService", () => ({
  AiSettingsServiceError: class MockAiSettingsServiceError extends Error {
    statusCode: number;
    code: string;
    constructor(code: string, message: string, statusCode = 400) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  aiSettingsService: { getSettings, updateSettings },
}));

let registerAiFoundationRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/aiFoundation.routes");
  registerAiFoundationRoutes = routeModule.registerAiFoundationRoutes;
});

function buildApp(options: { authenticated?: boolean; orgRole?: string; orgId?: string } = {}) {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = { id: "user_1", email: "admin@example.test", role: "admin" };
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.orgId ?? "org_1";
    req.orgRole = options.orgRole ?? "admin";
    next();
  };
  const requireOrgOwnerAdmin = (req: any, res: any, next: any) => {
    if (req.orgRole === "owner" || req.orgRole === "admin") {
      req.actorOrgRole = req.orgRole;
      return next();
    }
    return res.status(403).json({ message: "Access denied. Organization Owner or Admin role required." });
  };
  registerAiFoundationRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });
  return app;
}

describe("AI foundation routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCapabilities.mockResolvedValue({
      enabled: true,
      mode: "printershero_managed",
      provider: "openai",
      model: "gpt-test",
      hasApiKey: false,
      features: { bugReview: true, triageBrief: true },
      permissions: { canManageSettings: true, canRunBugReview: true, canGenerateTriageBrief: true },
      usage: { monthlyUsageLimit: null },
    });
    getSettings.mockResolvedValue({
      id: "settings_1",
      orgId: "org_1",
      mode: "disabled",
      provider: null,
      model: null,
      isEnabled: false,
      hasApiKey: false,
      features: { bugReview: false, triageBrief: false },
      monthlyUsageLimit: null,
      createdAt: null,
      updatedAt: null,
    });
    updateSettings.mockResolvedValue({
      id: "settings_1",
      orgId: "org_1",
      mode: "printershero_managed",
      provider: "openai",
      model: "gpt-test",
      isEnabled: true,
      hasApiKey: false,
      features: { bugReview: true, triageBrief: true },
      monthlyUsageLimit: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  test("capabilities endpoint returns safe feature and permission data", async () => {
    const response = await request(buildApp()).get("/api/ai/capabilities");

    expect(response.status).toBe(200);
    expect(response.body.data.features.bugReview).toBe(true);
    expect(response.body.data.features.triageBrief).toBe(true);
    expect(response.body.data.mode).toBe("printershero_managed");
    expect(response.body.data.hasApiKey).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("sk-");
  });

  test("settings GET requires owner/admin", async () => {
    const response = await request(buildApp({ orgRole: "manager" })).get("/api/ai/settings");

    expect(response.status).toBe(403);
    expect(getSettings).not.toHaveBeenCalled();
  });

  test("settings PATCH requires owner/admin and never returns submitted API key", async () => {
    const response = await request(buildApp())
      .patch("/api/ai/settings")
      .send({ mode: "bring_your_own", provider: "openai", model: "gpt-test", apiKey: "sk-secret", bugReviewEnabled: true, triageBriefEnabled: true });

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith("org_1", expect.objectContaining({
      apiKey: "sk-secret",
      triageBriefEnabled: true,
    }));
    expect(JSON.stringify(response.body)).not.toContain("sk-secret");
  });

  test("settings PATCH returns Unauthorized only when no authenticated session reaches the route", async () => {
    const response = await request(buildApp({ authenticated: false }))
      .patch("/api/ai/settings")
      .send({ mode: "printershero_managed" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthorized");
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
