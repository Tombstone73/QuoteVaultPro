import { jest, describe, expect, test, beforeEach, beforeAll } from "@jest/globals";

jest.unstable_mockModule("../storage/aiReviews.repo", () => ({
  DrizzleAiReviewsRepository: class {},
  toAiReviewDto: (row: any) => ({
    id: row.id,
    orgId: row.orgId,
    bugReportId: row.bugReportId,
    reviewKind: row.reviewKind,
    status: row.status,
    isCurrent: row.isCurrent,
    requestedByEmail: row.requestedByEmail,
    provider: row.provider ?? null,
    model: row.model ?? null,
    providerMetadata: row.providerMetadata ?? null,
    promptVersion: row.promptVersion,
    result: row.result ?? null,
    summary: row.summary ?? null,
    severityAssessment: row.severityAssessment ?? null,
    businessImpact: row.businessImpact ?? null,
    urgency: row.urgency ?? null,
    implementationPriority: row.implementationPriority ?? null,
    workflowImpact: row.workflowImpact ?? null,
    revenueRisk: row.revenueRisk ?? null,
    suggestedOwner: row.suggestedOwner ?? null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    validationErrors: row.validationErrors ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
}));

let AiReviewService: any;
let AiReviewServiceError: any;

beforeAll(async () => {
  const serviceModule = await import("../services/ai/aiReviewService");
  AiReviewService = serviceModule.AiReviewService;
  AiReviewServiceError = serviceModule.AiReviewServiceError;
});

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    getBugReportForReview: jest.fn(async () => ({
      id: "bug_1",
      orgId: "org_1",
      type: "bug",
      title: "Save fails",
      description: "Save fails on quotes.",
      severity: "high",
      url: "https://app.example.com/quotes/1",
      screenWidth: null,
      screenHeight: null,
      metadata: {},
      createdAt: new Date(),
    })),
    getCurrentReviewForBugReport: jest.fn(async () => null),
    getReviewById: jest.fn(async () => null),
    createPendingReview: jest.fn(async (input: any) => ({
      id: "review_1",
      orgId: input.orgId,
      bugReportId: input.bugReportId,
      reviewKind: "bug_review",
      status: "pending",
      isCurrent: true,
      requestedByEmail: input.requestedByEmail,
      promptVersion: input.promptVersion,
      provider: null,
      model: null,
    })),
    markProcessing: jest.fn(async () => null),
    completeReview: jest.fn(async () => null),
    failReview: jest.fn(async () => null),
    createAuditLog: jest.fn(async () => undefined),
    ...overrides,
  };
}

function makeProvider(rawText: string) {
  return {
    generateBugReview: jest.fn(async () => ({
      rawText,
      provider: "test",
      model: "test-model",
      requestMetadata: {},
    })),
  };
}

const validProviderJson = JSON.stringify({
  summary: "Save fails on quotes.",
  severityAssessment: "high",
  businessImpact: "high",
  urgency: "medium",
  implementationPriority: "high",
  workflowImpact: "moderate",
  revenueRisk: "medium",
  suggestedOwner: "Quotes",
  affectedModules: ["Quotes"],
  reasoning: ["Quote save is blocked."],
  unknowns: ["No stack trace provided."],
  confidence: 0.8,
});

describe("AiReviewService", () => {
  beforeEach(() => {
    process.env.AI_BUG_REVIEW_ENABLED = "true";
    process.env.AI_BUG_REVIEW_PROVIDER = "test";
    process.env.AI_BUG_REVIEW_MODEL = "test-model";
  });

  test("rejects feature requests in Phase 1", async () => {
    const repo = makeRepo({
      getBugReportForReview: jest.fn(async () => ({
        id: "feature_1",
        orgId: "org_1",
        type: "feature",
        title: "Add dashboard",
        description: "Add dashboard.",
        severity: "low",
        url: "https://app.example.com",
        screenWidth: null,
        screenHeight: null,
        metadata: {},
        createdAt: new Date(),
      })),
    });
    const service = new AiReviewService(repo as any, makeProvider(validProviderJson) as any);

    await expect(service.requestBugReview({
      orgId: "org_1",
      bugReportId: "feature_1",
      actor: { userId: "user_1", email: "admin@example.com" },
    })).rejects.toBeInstanceOf(AiReviewServiceError);
    expect(repo.createPendingReview).not.toHaveBeenCalled();
  });

  test("prevents duplicate active reviews", async () => {
    const repo = makeRepo({
      getCurrentReviewForBugReport: jest.fn(async () => ({ status: "processing" })),
    });
    const service = new AiReviewService(repo as any, makeProvider(validProviderJson) as any);

    await expect(service.requestBugReview({
      orgId: "org_1",
      bugReportId: "bug_1",
      actor: { userId: "user_1", email: "admin@example.com" },
    })).rejects.toMatchObject({ code: "AI_REVIEW_ALREADY_ACTIVE" });
    expect(repo.createPendingReview).not.toHaveBeenCalled();
  });

  test("creates a pending review without modifying bug report data", async () => {
    const repo = makeRepo();
    const service = new AiReviewService(repo as any, makeProvider(validProviderJson) as any);

    const review = await service.requestBugReview({
      orgId: "org_1",
      bugReportId: "bug_1",
      actor: { userId: "user_1", email: "admin@example.com" },
    });

    expect(review.status).toBe("pending");
    expect(repo.createPendingReview).toHaveBeenCalledTimes(1);
    expect(repo.createAuditLog).toHaveBeenCalled();
  });

  test("marks review failed after two invalid provider responses", async () => {
    const repo = makeRepo({
      getReviewById: jest.fn(async () => ({
        id: "review_1",
        orgId: "org_1",
        bugReportId: "bug_1",
        status: "pending",
      })),
      markProcessing: jest.fn(async () => ({ id: "review_1" })),
    });
    const provider = makeProvider("{ invalid json");
    const service = new AiReviewService(repo as any, provider as any);

    await service.processReview({ orgId: "org_1", reviewId: "review_1" });

    expect(provider.generateBugReview).toHaveBeenCalledTimes(2);
    expect(repo.failReview).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "invalid_json",
    }));
  });
});
