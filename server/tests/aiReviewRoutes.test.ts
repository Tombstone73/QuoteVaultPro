import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const getCurrentBugReview = jest.fn<(...args: any[]) => Promise<any>>();
const requestBugReview = jest.fn<(...args: any[]) => Promise<any>>();
const rerunReview = jest.fn<(...args: any[]) => Promise<any>>();
const enqueue = jest.fn();
const getCapabilities = jest.fn<(...args: any[]) => Promise<any>>();

class MockAiReviewServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.unstable_mockModule("../services/ai/aiReviewService", () => ({
  AiReviewServiceError: MockAiReviewServiceError,
  aiReviewService: {
    getCurrentBugReview,
    requestBugReview,
    rerunReview,
  },
}));

jest.unstable_mockModule("../services/ai/aiReviewQueue", () => ({
  aiReviewQueue: { enqueue },
}));

jest.unstable_mockModule("../services/ai/aiProviderResolver", () => ({
  aiProviderResolver: { getCapabilities },
}));

let registerAiReviewRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/aiReviews.routes");
  registerAiReviewRoutes = routeModule.registerAiReviewRoutes;
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
  registerAiReviewRoutes(app, { isAuthenticated, tenantContext });
  return app;
}

describe("AI review routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_BUG_REVIEW_ENABLED = "true";
    process.env.AI_BUG_REVIEW_ADMINS_ONLY = "true";
    getCapabilities.mockResolvedValue({
      enabled: true,
      mode: "printershero_managed",
      provider: "openai",
      model: "test-model",
      hasApiKey: false,
      features: { bugReview: true, triageBrief: false },
      permissions: { canRunBugReview: true, canGenerateTriageBrief: false, canManageSettings: true },
      usage: { monthlyUsageLimit: null },
    });
    requestBugReview.mockResolvedValue({ id: "review_1", status: "pending" });
    rerunReview.mockResolvedValue({ id: "review_2", status: "pending" });
    getCurrentBugReview.mockResolvedValue(null);
  });

  test.each(["owner", "admin"])("GET allows org %s", async (orgRole) => {
    const response = await request(buildApp({ orgId: "org_2", orgRole })).get("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(200);
    expect(response.body.data.canRun).toBe(true);
    expect(getCurrentBugReview).toHaveBeenCalledWith("org_2", "bug_1");
  });

  test.each(["manager", "member"])("GET denies org %s", async (orgRole) => {
    const response = await request(buildApp({ orgRole })).get("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(403);
    expect(getCurrentBugReview).not.toHaveBeenCalled();
  });

  test("GET denies customer portal style users without an owner/admin org role", async () => {
    const response = await request(buildApp({
      orgRole: null,
      user: { id: "customer_1", email: "customer@example.com", role: "customer" },
    })).get("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(403);
    expect(getCurrentBugReview).not.toHaveBeenCalled();
  });

  test("POST returns 503 when feature flag is disabled", async () => {
    getCapabilities.mockResolvedValueOnce({
      enabled: false,
      mode: "disabled",
      provider: null,
      model: null,
      hasApiKey: false,
      features: { bugReview: false, triageBrief: false },
      permissions: { canRunBugReview: false, canGenerateTriageBrief: false, canManageSettings: true },
      usage: { monthlyUsageLimit: null },
    });

    const response = await request(buildApp()).post("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(503);
    expect(requestBugReview).not.toHaveBeenCalled();
  });

  test("POST blocks manager access in Phase 1", async () => {
    const response = await request(buildApp({ orgRole: "manager" })).post("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(403);
    expect(requestBugReview).not.toHaveBeenCalled();
  });

  test("POST creates pending review, queues processing, and returns 202", async () => {
    const response = await request(buildApp()).post("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(202);
    expect(response.body.data).toEqual({ reviewId: "review_1", status: "pending" });
    expect(requestBugReview).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      bugReportId: "bug_1",
    }));
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org_1", reviewId: "review_1" });
  });

  test("POST surfaces duplicate active review conflict", async () => {
    requestBugReview.mockRejectedValueOnce(new MockAiReviewServiceError(
      "AI_REVIEW_ALREADY_ACTIVE",
      "An AI review is already pending or processing.",
      409,
    ));

    const response = await request(buildApp()).post("/api/bug-reports/bug_1/ai-review");

    expect(response.status).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("rerun creates a new queued review", async () => {
    const response = await request(buildApp()).post("/api/ai-reviews/review_1/rerun");

    expect(response.status).toBe(202);
    expect(rerunReview).toHaveBeenCalledWith("org_1", "review_1", expect.objectContaining({
      email: "admin@example.com",
    }));
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org_1", reviewId: "review_2" });
  });
});
