import { describe, expect, jest, test } from "@jest/globals";
import {
  ConfiguredAssistantPlanner,
  isExplicitAssistantWriteRequest,
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

describe("assistant provider planning", () => {
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
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({ feature: "assistant", providerConfig: expect.any(Object) }));
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
});
