import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

const resolveProvider = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../services/ai/aiProviderResolver", () => ({
  aiProviderResolver: { resolveProvider },
}));

let AiTriageBriefService: any;
let AiTriageBriefServiceError: any;

beforeAll(async () => {
  const serviceModule = await import("../services/ai/aiTriageBriefService");
  AiTriageBriefService = serviceModule.AiTriageBriefService;
  AiTriageBriefServiceError = serviceModule.AiTriageBriefServiceError;
});

const validProviderJson = JSON.stringify({
  executiveSummary: "Open reports cluster around quote save reliability.",
  topOperationalRisks: [{ title: "Quote save failures", impact: "Operators cannot persist quote changes.", confidence: 0.8, rationale: "Multiple reports mention save failures." }],
  topWorkflowRisks: [{ title: "Quote bottleneck", impact: "Quote production stalls.", confidence: 0.7, rationale: "Quote save is workflow critical." }],
  topRevenueRisks: [{ title: "Quote conversion risk", impact: "Quotes cannot move forward.", confidence: 0.7, rationale: "Failed quotes delay revenue." }],
  topBugClusters: [{ issue: "Quote save fails", reportCount: 1, affectedModules: ["Quotes"], impact: "Blocks quote editing." }],
  topFeatureRequests: [{ feature: "Bulk proof reminders", requestCount: 1, value: "Reduces manual follow-up.", complexity: "unknown; no implementation details provided" }],
  duplicateSignals: [{ theme: "B-0001 Quote save", reportIds: ["B-0001"], rationale: "Single report only, no duplicate confirmed.", confidence: 0.2 }],
  suggestedPriorityOrder: [{ item: "B-0001 Investigate quote save failures", rationale: "Highest workflow impact.", urgency: "high" }],
  recommendedNextSprint: [{ item: "B-0001 Reproduce quote save failures", rationale: "Needed before implementation.", urgency: "high" }],
  unknowns: ["No stack trace supplied."],
  confidence: 0.76,
});

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    listReportsForBrief: jest.fn(async () => [{
      id: "bug_1",
      referenceNumber: "B-0001",
      type: "bug",
      title: "Save fails",
      description: "Saving a quote fails.",
      severity: "high",
      status: "open",
      url: "https://app.example.test/quotes/1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdByEmail: "user@example.test",
      metadata: { module: "Quotes" },
    }]),
    listBriefs: jest.fn(async () => []),
    getBriefById: jest.fn(async () => null),
    createPendingBrief: jest.fn(async (input: any) => ({
      id: "brief_1",
      orgId: input.orgId,
      status: "pending",
      requestedByEmail: input.requestedByEmail,
      filtersSnapshot: input.filtersSnapshot,
      reportSnapshot: input.reportSnapshot,
      promptVersion: input.promptVersion,
      createdAt: new Date(),
    })),
    markProcessing: jest.fn(async () => null),
    completeBrief: jest.fn(async () => null),
    failBrief: jest.fn(async () => null),
    recoverStaleActiveBriefs: jest.fn(async () => []),
    createAuditLog: jest.fn(async () => undefined),
    ...overrides,
  };
}

function makeProvider(rawText = validProviderJson) {
  return {
    generateBugReview: jest.fn(),
    generateTriageBrief: jest.fn(async () => ({
      rawText,
      provider: "openai",
      model: "gpt-4o-mini",
      requestMetadata: {
        providerRequestId: "chatcmpl_test",
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      },
    })),
  };
}

describe("AiTriageBriefService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveProvider.mockResolvedValue({
      enabled: true,
      mode: "printershero_managed",
      provider: "openai",
      model: "gpt-4o-mini",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "test-key",
      feature: "triage_brief",
      source: "printershero_managed_env",
      settings: null,
    });
  });

  test("creates a pending brief from org-scoped open and in-review reports", async () => {
    const repo = makeRepo();
    const service = new AiTriageBriefService(repo as any, makeProvider() as any, { recordUsage: jest.fn() } as any);

    const brief = await service.requestTriageBrief({
      orgId: "org_1",
      filters: { status: "all", severity: "high", type: "all" },
      actor: { userId: "user_1", email: "admin@example.com" },
    });

    expect(brief.status).toBe("pending");
    expect(repo.listReportsForBrief).toHaveBeenCalledWith("org_1", expect.objectContaining({
      severity: "high",
      type: "all",
    }));
    expect(repo.createPendingBrief).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      reportSnapshot: expect.any(Array),
    }));
  });

  test("rejects generation when no eligible reports match filters", async () => {
    const repo = makeRepo({ listReportsForBrief: jest.fn(async () => []) });
    const service = new AiTriageBriefService(repo as any, makeProvider() as any, { recordUsage: jest.fn() } as any);

    await expect(service.requestTriageBrief({
      orgId: "org_1",
      filters: { status: "resolved", type: "all" },
      actor: { userId: "user_1", email: "admin@example.com" },
    })).rejects.toBeInstanceOf(AiTriageBriefServiceError);
    expect(repo.createPendingBrief).not.toHaveBeenCalled();
  });

  test("successful processing records triage_brief usage and completes the brief", async () => {
    const repo = makeRepo({
      getBriefById: jest.fn(async () => ({
        id: "brief_1",
        orgId: "org_1",
        status: "pending",
        filtersSnapshot: { status: "open" },
        reportSnapshot: [{
          id: "bug_1",
          referenceNumber: "B-0001",
          type: "bug",
          title: "Save fails",
          description: "Saving a quote fails.",
          severity: "high",
          status: "open",
          url: "/quotes/1",
          createdAt: "2026-01-01T00:00:00Z",
          createdByEmail: "user@example.test",
          metadata: {},
        }],
      })),
      markProcessing: jest.fn(async (orgId: string, briefId: string) => ({
        id: briefId,
        orgId,
        status: "processing",
        filtersSnapshot: { status: "open" },
        reportSnapshot: [{
          id: "bug_1",
          referenceNumber: "B-0001",
          type: "bug",
          title: "Save fails",
          description: "Saving a quote fails.",
          severity: "high",
          status: "open",
          url: "/quotes/1",
          createdAt: "2026-01-01T00:00:00Z",
          createdByEmail: "user@example.test",
          metadata: {},
        }],
      })),
      completeBrief: jest.fn(async () => ({ id: "brief_1", orgId: "org_1", status: "completed" })),
    });
    const recordUsage = jest.fn(async (data: any) => data);
    const provider = makeProvider();
    const service = new AiTriageBriefService(repo as any, provider as any, { recordUsage } as any);

    await service.processBrief({ orgId: "org_1", briefId: "brief_1" });

    expect(provider.generateTriageBrief).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      feature: "triage_brief",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    }));
    expect(repo.completeBrief).toHaveBeenCalledWith(expect.objectContaining({
      briefId: "brief_1",
      result: expect.objectContaining({ executiveSummary: expect.any(String) }),
    }));
  });
});
