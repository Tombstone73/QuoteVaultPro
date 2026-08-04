import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  ConfiguredAssistantPlanner,
  isExplicitAssistantWriteRequest,
  resolveAssistantPlanningTimeoutMs,
} from "../services/assistant/providerPlanning";

const context = {
  contextVersion: "v1" as const,
  route: "/orders/order_1",
  pageTitle: "Order",
  entityType: "order" as const,
  entityId: "order_1",
  selectedRecordIds: [],
  activeFilters: [],
  capturedAt: "2026-07-21T12:00:00.000Z",
  unsavedChanges: false,
};

function resolver() {
  return {
    resolveProvider: jest.fn(async () => ({
      enabled: true,
      provider: "openai",
      endpoint: "https://example.test/v1/chat/completions",
      apiKey: "not-a-real-key",
      model: "test-model",
    })),
  } as any;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("assistant provider planning", () => {
  test("resolves a bounded assistant-planning timeout from the environment", () => {
    expect(resolveAssistantPlanningTimeoutMs({} as NodeJS.ProcessEnv)).toBe(20_000);
    expect(resolveAssistantPlanningTimeoutMs({ AI_ASSISTANT_PLANNING_TIMEOUT_MS: "not-a-number" } as NodeJS.ProcessEnv)).toBe(20_000);
    expect(resolveAssistantPlanningTimeoutMs({ AI_ASSISTANT_PLANNING_TIMEOUT_MS: "-1" } as NodeJS.ProcessEnv)).toBe(20_000);
    expect(resolveAssistantPlanningTimeoutMs({ AI_ASSISTANT_PLANNING_TIMEOUT_MS: "1000" } as NodeJS.ProcessEnv)).toBe(5_000);
    expect(resolveAssistantPlanningTimeoutMs({ AI_ASSISTANT_PLANNING_TIMEOUT_MS: "999999" } as NodeJS.ProcessEnv)).toBe(60_000);
    expect(resolveAssistantPlanningTimeoutMs({ AI_ASSISTANT_PLANNING_TIMEOUT_MS: "22000" } as NodeJS.ProcessEnv)).toBe(22_000);
  });

  test("locally refuses GO and mutation requests without invoking the provider", async () => {
    const provider = { generateJson: jest.fn() } as any;
    const planner = new ConfiguredAssistantPlanner(provider, resolver());
    const result = await planner.plan({ organizationId: "org_1", message: "GO", context });
    expect(result.plan.intent).toBe("unsupported_write");
    expect(provider.generateJson).not.toHaveBeenCalled();
    expect(isExplicitAssistantWriteRequest("Change the order status")).toBe(true);
  });

  test("accepts only strict JSON that conforms to the constrained plan schema", async () => {
    const provider = {
      generateJson: jest.fn(async () => ({
        rawText: JSON.stringify({
          intent: "lookup", selectedSkill: "orders", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
          toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: "16309" } }],
        }),
        provider: "openai", model: "test-model", requestMetadata: {},
      })),
    } as any;
    const planner = new ConfiguredAssistantPlanner(provider, resolver());
    const result = await planner.plan({ organizationId: "org_1", message: "Show order 16309", context });
    expect(result.plan.toolCalls).toHaveLength(1);
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      feature: "assistant",
      timeoutMs: 20_000,
      timeoutUseCase: "assistant_planning",
      providerConfig: expect.any(Object),
    }));
  });

  test("passes a safely bounded assistant planning timeout override to the provider", async () => {
    const previous = process.env.AI_ASSISTANT_PLANNING_TIMEOUT_MS;
    process.env.AI_ASSISTANT_PLANNING_TIMEOUT_MS = "45000";
    try {
      const provider = {
        generateJson: jest.fn(async () => ({
          rawText: JSON.stringify({
            intent: "lookup", selectedSkill: "customers", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
            toolCalls: [{ toolName: "customers.get_summary", arguments: { query: "Titan Graphics" } }],
          }),
          provider: "openai", model: "test-model", requestMetadata: {},
        })),
      } as any;
      const planner = new ConfiguredAssistantPlanner(provider, resolver());
      await planner.plan({ organizationId: "org_1", message: "find customer Titan Graphics", context });
      expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 45_000 }));
    } finally {
      restoreEnv("AI_ASSISTANT_PLANNING_TIMEOUT_MS", previous);
    }
  });

  test("pairs a bounded uninvoiced-order read with customer posted-revenue reporting", async () => {
    const provider = {
      generateJson: jest.fn(async () => ({
        rawText: JSON.stringify({
          intent: "analytical_reporting", selectedSkill: "customer_sales", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
          toolCalls: [{ toolName: "analytics.customer_product_sales", arguments: { customer: { name: "Graphic Solutions" }, dateRange: { start: "2026-07-01", end: "2026-07-31" } }],
        }),
        provider: "openai", model: "test-model", requestMetadata: {},
      })),
    } as any;
    const planner = new ConfiguredAssistantPlanner(provider, resolver());
    const result = await planner.plan({ organizationId: "org_1", message: "Top products purchased by Graphic Solutions in July", context });
    expect(result.plan.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "analytics.customer_product_sales" }),
      expect.objectContaining({ toolName: "analytics.customer_uninvoiced_orders", arguments: expect.objectContaining({ customer: { name: "Graphic Solutions" } }) }),
    ]));
  });

  test("rejects loose prose and unknown provider-generated tool names", async () => {
    const provider = {
      generateJson: jest.fn(async () => ({ rawText: "Use orders.get_summary", provider: "openai", model: "test", requestMetadata: {} })),
    } as any;
    const planner = new ConfiguredAssistantPlanner(provider, resolver());
    await expect(planner.plan({ organizationId: "org_1", message: "Show order", context })).rejects.toMatchObject({ code: "provider_invalid_response" });
  });

  test("rejects truncated provider JSON before returning any executable plan", async () => {
    const provider = {
      generateJson: jest.fn(async () => ({
        rawText: "{\"intent\":\"lookup\",\"selectedSkill\":\"customers\"",
        provider: "openai", model: "test", requestMetadata: { finishReason: "length" },
      })),
    } as any;
    const planner = new ConfiguredAssistantPlanner(provider, resolver());
    await expect(planner.plan({ organizationId: "org_1", message: "find customer Titan Graphics", context })).rejects.toMatchObject({
      code: "provider_invalid_response",
    });
  });
});
