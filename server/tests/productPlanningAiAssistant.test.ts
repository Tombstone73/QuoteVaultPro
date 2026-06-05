import { describe, expect, jest, test } from "@jest/globals";

import { ProductPlanningAiAssistant, type WorkItemForAi } from "../services/productPlanningAi";
import { AiProviderUnavailableError, type AiProviderAdapter, type AiProviderRequest } from "../services/ai/providers/AiProviderAdapter";

const item: WorkItemForAi = {
  id: "item_1",
  reference: "PP-0001",
  title: "Product Catalog Completion",
  description: "Load Titan Graphics product catalog so quotes, orders, pricing, routing, production, portal, and invoices can be validated.",
  notes: "Blocks operational go-live.",
  workItemType: "feature",
  planningStatus: "backlog",
  priority: "medium",
  businessValue: null,
  complexity: null,
  phase: null,
  module: null,
  releaseTarget: null,
};

function liveResolver() {
  return Promise.resolve({
    enabled: true,
    mode: "bring_your_own" as const,
    provider: "openai" as const,
    model: "gpt-test",
    endpoint: "https://example.test/v1/chat/completions",
    apiKey: "test-key",
    feature: "feature_review" as const,
    source: "settings" as const,
    settings: null,
  });
}

function disabledResolver() {
  return Promise.resolve({
    enabled: false,
    mode: "disabled" as const,
    provider: null,
    model: null,
    endpoint: null,
    apiKey: null,
    feature: "feature_review" as const,
    source: "disabled" as const,
    settings: null,
  });
}

function provider(rawText: string): AiProviderAdapter {
  const generateJson = jest.fn(async (_request: AiProviderRequest) => ({
    rawText,
    provider: "openai",
    model: "gpt-test",
    requestMetadata: {
      mode: "bring_your_own",
      source: "settings",
      providerRequestId: "req_1",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  }));
  return {
    generateJson,
    generateBugReview: generateJson,
    generateTriageBrief: generateJson,
  };
}

function unavailableProvider(): AiProviderAdapter {
  const generateJson = jest.fn(async () => {
    throw new AiProviderUnavailableError("Provider unavailable");
  });
  return {
    generateJson,
    generateBugReview: generateJson,
    generateTriageBrief: generateJson,
  };
}

function usageRepo() {
  return {
    getSettings: jest.fn(),
    upsertSettings: jest.fn(),
    recordUsage: jest.fn(async (data: any) => ({ id: "usage_1", ...data })),
  };
}

describe("ProductPlanningAiAssistant", () => {
  test("live AI path parses work item JSON and records usage", async () => {
    const repo = usageRepo();
    const liveProvider = provider(JSON.stringify({
      summary: "Product catalog completion is the go-live bottleneck.",
      concerns: [{ label: "Go-live blocker", severity: "high", reasoning: "Catalog completion blocks validation." }],
      suggestions: [{
        suggestionType: "priority",
        currentValue: "medium",
        suggestedValue: "critical",
        confidence: 0.93,
        reasoning: "Catalog completion blocks Titan Graphics operational readiness.",
      }],
      nextActions: ["Create a Product Catalog Completion epic."],
    }));
    const assistant = new ProductPlanningAiAssistant(liveProvider, repo as any, liveResolver as any);

    const result = await assistant.analyzeWorkItem("org_1", item, [item]);

    expect(result.source).toBe("live_ai");
    expect(liveProvider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      feature: "feature_review",
    }));
    expect(result.data.summary).toContain("go-live bottleneck");
    expect(result.data.suggestions[0]).toEqual(expect.objectContaining({
      suggestionType: "priority",
      suggestedValue: "critical",
      confidence: 93,
    }));
    expect(repo.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      feature: "feature_review",
      source: "product_planning_ai",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    }));
  });

  test("invalid AI JSON falls back safely", async () => {
    const assistant = new ProductPlanningAiAssistant(provider("{ not valid json"), usageRepo() as any, liveResolver as any);

    const result = await assistant.analyzeBacklog("org_1", [item]);

    expect(result.source).toBe("rule_based_fallback");
    expect(result.fallbackReason).toContain("Live AI unavailable");
    expect(result.data.healthScore).toEqual(expect.any(Number));
    expect(result.data.readinessAssessment?.recommendedNextStep).toContain("Product Catalog");
  });

  test("live backlog analysis returns operational readiness sections", async () => {
    const repo = usageRepo();
    const liveProvider = provider(JSON.stringify({
      executiveSummary: "Product Catalog Completion blocks Titan Graphics operational go-live.",
      recommendedGoLiveFocus: ["Product Catalog Completion", "Product Import Automation", "Workflow Validation"],
      goLiveBlockers: [{ title: "Product Catalog Completion", reasoning: "Catalog data gates quote and order validation.", relatedItemReferences: ["PP-0001"] }],
      topNextActions: [{ title: "Create Product Catalog Completion Epic", reasoning: "This is the known go-live bottleneck.", priority: "critical" }],
      quickWins: [{ title: "Load first 25 products", reasoning: "Enables representative quote validation." }],
      futureItems: [{ title: "Mobile visual search", reasoning: "Does not unblock Titan Graphics operational readiness." }],
      highestRoiFeatures: [{ title: "PP-0001: Product Catalog Completion", reasoning: "Unlocks the Quote to Payment validation path.", priority: "critical", relatedItemReferences: ["PP-0001"] }],
      lowestPriorityFeatures: [{ title: "SaaS onboarding polish", reasoning: "Future SaaS work can wait until Titan Graphics is live.", priority: "low" }],
      suggestedEpics: [{
        name: "Product Catalog Completion",
        description: "Complete catalog data and import mechanics.",
        confidence: 0.94,
        businessValue: "very_high",
        recommendedPhase: "go_live",
        relatedItemReferences: ["PP-0001"],
        relatedItems: [{ reference: "PP-0001", title: "Product Catalog Completion", priority: "critical", phase: "go_live", module: "Catalog", reasonIncluded: "Known go-live bottleneck." }],
        reasoning: "Catalog items belong together because they gate operational validation.",
      }],
      missingWork: [{ title: "Operational Readiness release", reasoning: "Needed to sequence go-live work.", priority: "high" }],
      riskAreas: [{ title: "Catalog data incomplete", severity: "high", reasoning: "Pricing and routing cannot be validated." }],
      readinessAssessment: {
        readinessScore: 43,
        criticalBlockers: ["Product Catalog Completion"],
        highPriorityActions: ["Load first 25 products"],
        recommendedSequence: ["Complete catalog MVP", "Validate quote creation"],
        recommendedNextStep: "Build Product Import MVP and load first 25 products.",
      },
      healthFindings: [{ label: "Missing modules", count: 1, severity: "high", recommendation: "Assign catalog module." }],
    }));
    const assistant = new ProductPlanningAiAssistant(liveProvider, repo as any, liveResolver as any);

    const result = await assistant.analyzeBacklog("org_1", [item]);

    expect(result.source).toBe("live_ai");
    expect(liveProvider.generateJson).toHaveBeenCalled();
    expect(result.data.executiveSummary).toContain("Product Catalog Completion");
    expect(result.data.goLiveBlockers?.[0].title).toBe("Product Catalog Completion");
    expect(result.data.topNextActions?.[0].title).toBe("Create Product Catalog Completion Epic");
    expect(result.data.futureCandidates?.[0].title).toBe("Mobile visual search");
    expect(result.data.highestRoiFeatures?.[0].title).toContain("PP-0001");
    expect(result.data.suggestedEpics?.[0].relatedItems?.[0]).toEqual(expect.objectContaining({
      reference: "PP-0001",
      reasonIncluded: "Known go-live bottleneck.",
    }));
    expect(result.data.readinessAssessment?.readinessScore).toBe(43);
    expect(repo.recordUsage).toHaveBeenCalled();
  });

  test("provider unavailable returns deterministic fallback with indicator", async () => {
    const assistant = new ProductPlanningAiAssistant(unavailableProvider(), usageRepo() as any, disabledResolver as any);

    const result = await assistant.analyzeRoadmap("org_1", [item]);

    expect(result.source).toBe("rule_based_fallback");
    expect(result.fallbackReason).toContain("Live AI unavailable");
    expect(result.data.recommendations).toEqual(expect.any(Array));
  });
});
