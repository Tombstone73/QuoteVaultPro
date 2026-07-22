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
    ["Find order 20002", "20002"],
    ["Find order ORD-20002", "20002"],
    ["Find order ord-20002", "20002"],
    ["Find order ORD 20002", "20002"],
    ["Find order Order 20002.", "20002"],
  ])("normalizes %s to the stored order-number representation", (message, orderNumber) => {
    expect(resolveDeterministicReadPlan(message)).toMatchObject({
      selectedSkill: "deterministic_order_lookup",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber } }],
    });
  });

  test.each([
    ["Find quote 4402", "4402", undefined],
    ["Find product Business Cards", "Business Cards", "product"],
    ["Find customer Acme Print", "Acme Print", "customer"],
  ])("routes an exact %s lookup through bounded global search", (message, query, entityType) => {
    expect(resolveDeterministicReadPlan(message)).toMatchObject({
      intent: "lookup",
      toolCalls: [{ toolName: "search.global", arguments: { query, limit: 5, ...(entityType ? { entityType } : {}) } }],
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

  test.each(["Summarise this product", "Summarize the current customer"])(
    "routes %s through validated current context instead of provider planning when no record is validated",
    (message) => {
      expect(resolveDeterministicReadPlan(message)).toMatchObject({
        intent: "navigation",
        toolCalls: [{ toolName: "navigation.get_current_context", arguments: {} }],
      });
    },
  );

  test.each([
    "What is blocking this order?",
    "Why is this order blocked?",
    "What still needs to happen on this order?",
    "What is preventing fulfillment?",
    "What is preventing billing?",
    "Summarize this order.",
    "Give me a summary of this order",
    "Tell me about this order",
    "Give me an overview of this order",
    "What is this order",
    "What is the production status?",
    "What is the artwork status?",
  ])("routes %s through the tenant-scoped current-order summary", (message) => {
    expect(resolveDeterministicReadPlan(message, {
      contextVersion: "v1", route: "/orders/order_1", pageTitle: "Order details", entityType: "order", entityId: "order_1",
      selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false,
    })).toMatchObject({
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderId: "order_1" } }],
    });
  });

  test.each([
    ["Summarize this customer", "/customers/customer_1", "customer", "customer_1", "customers.get_summary", { customerId: "customer_1" }],
    ["Tell me about this product.", "/products/product_1/edit", "product", "product_1", "products.get_summary", { productId: "product_1" }],
  ])("routes safe current %s summary variants through the registered adapter", (message, route, entityType, entityId, toolName, argumentsValue) => {
    expect(resolveDeterministicReadPlan(message, {
      contextVersion: "v1", route, pageTitle: "Detail", entityType: entityType as any, entityId,
      selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false,
    })).toMatchObject({
      toolCalls: [{ toolName, arguments: argumentsValue }],
    });
  });

  test("does not use current-order routing without validated order context", () => {
    expect(resolveDeterministicReadPlan("What is blocking this order?")).toBeNull();
    expect(resolveDeterministicReadPlan("What is blocking this order?", {
      contextVersion: "v1", route: "/customers/customer_1", pageTitle: "Customer", entityType: "customer", entityId: "customer_1",
      selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false,
    })).toBeNull();
  });

  test("does not turn free text or mutation requests into deterministic execution", () => {
    expect(resolveDeterministicReadPlan("Update order 20002")).toBeNull();
    expect(resolveDeterministicReadPlan("Find order a very long identifier that has spaces")).toMatchObject({
      selectedSkill: "deterministic_invalid_order_lookup",
      toolCalls: [],
      clarificationRequired: true,
    });
  });

  test("rejects non-order identifiers without widening deterministic lookup", () => {
    expect(resolveDeterministicReadPlan("Find order ORD-20002-TEST")).toMatchObject({
      selectedSkill: "deterministic_invalid_order_lookup",
      clarificationQuestion: "I couldn't recognize that order number. Try something like ORD-20002.",
      toolCalls: [],
    });
  });
});
