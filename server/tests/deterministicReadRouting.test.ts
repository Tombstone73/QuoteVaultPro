import { describe, expect, test } from "@jest/globals";
import { resolveDeterministicReadPlan } from "../services/assistant/deterministicReadRouting";

describe("resolveDeterministicReadPlan", () => {
  test("routes an exact order number through the registered tenant-scoped order tool", () => {
    expect(resolveDeterministicReadPlan("Find order 20002")).toMatchObject({
      intent: "lookup",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: "20002" } }],
    });
  });

  test.each([
    ["Find quote 4402", "4402"],
    ["Find product Business Cards", "Business Cards"],
    ["Find customer Acme Print", "Acme Print"],
  ])("routes an exact %s lookup through bounded global search", (message, query) => {
    expect(resolveDeterministicReadPlan(message)).toMatchObject({
      intent: "lookup",
      toolCalls: [{ toolName: "search.global", arguments: { query, limit: 5 } }],
    });
  });

  test("accepts quoted customer and product names without widening the bounded search", () => {
    expect(resolveDeterministicReadPlan('Find customer "Acme Print"')).toMatchObject({
      selectedSkill: "deterministic_customer_lookup",
      toolCalls: [{ toolName: "search.global", arguments: { query: "Acme Print", limit: 5 } }],
    });
    expect(resolveDeterministicReadPlan("Find product 'Business Cards'")).toMatchObject({
      selectedSkill: "deterministic_product_lookup",
      toolCalls: [{ toolName: "search.global", arguments: { query: "Business Cards", limit: 5 } }],
    });
  });

  test("routes current record questions through the registered context tool", () => {
    expect(resolveDeterministicReadPlan("What record am I currently viewing?")).toMatchObject({
      intent: "navigation",
      toolCalls: [{ toolName: "navigation.get_current_context", arguments: {} }],
    });
  });

  test.each(["Summarize this order", "Summarise this product", "Summarize the current customer"])(
    "routes %s through validated current context instead of provider planning",
    (message) => {
      expect(resolveDeterministicReadPlan(message)).toMatchObject({
        intent: "navigation",
        toolCalls: [{ toolName: "navigation.get_current_context", arguments: {} }],
      });
    },
  );

  test("does not turn free text or mutation requests into deterministic execution", () => {
    expect(resolveDeterministicReadPlan("Update order 20002")).toBeNull();
    expect(resolveDeterministicReadPlan("Find order a very long identifier that has spaces")).toBeNull();
  });
});
