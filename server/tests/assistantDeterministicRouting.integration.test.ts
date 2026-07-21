import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

let AssistantService: any;

beforeAll(async () => {
  ({ AssistantService } = await import("../services/assistant/assistantService"));
});

const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.internal_staff"] };
const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", route: "/orders/order_1", pageTitle: "Order Details", entityType: "order", entityId: "order_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false,
});

function repo() {
  return {
    listConversations: jest.fn(),
    createConversation: jest.fn(),
    getConversation: jest.fn(async () => ({ id: "conversation_1", ...scope, title: "Test", status: "active", lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] })),
    updateConversation: jest.fn(),
    createFoundationTurn: jest.fn(async (input: any) => ({
      turnId: "turn_1", correlationId: input.correlationId, conversation: { id: "conversation_1", ...scope, title: "Test", status: "active", lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] },
      userMessage: { id: "user_1", conversationId: "conversation_1", turnId: "turn_1", role: "user", content: input.message, createdAt: new Date() },
      assistantMessage: { id: "assistant_1", conversationId: "conversation_1", turnId: "turn_1", role: "assistant", content: input.response, createdAt: new Date() },
    })),
  };
}

describe("AssistantService deterministic read routing", () => {
  test("exact order lookup bypasses the provider but retains normal tool orchestration", async () => {
    const repository = repo();
    const planner = { plan: jest.fn() };
    const executePlan = jest.fn(async (plan: any) => ({
      plan,
      executions: [{
        toolName: "orders.get_summary",
        status: "succeeded",
        result: {
          status: "succeeded",
          data: { order: { entityType: "order", recordId: "order_1", label: "Order 20002", sourceLink: { label: "Order 20002", href: "/orders/order_1" }, freshness: "2026-07-21T12:00:00.000Z" } },
          provenance: { sourceLinks: [{ label: "Order 20002", href: "/orders/order_1" }], freshness: { capturedAt: "2026-07-21T12:00:00.000Z" } },
        },
      }],
    }));
    const service = new AssistantService(
      repository,
      { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true })) },
      planner,
      () => ({ executePlan }),
    );

    await service.createTurn(scope, "conversation_1", actor, { message: "Find order 20002", context });

    expect(planner.plan).not.toHaveBeenCalled();
    expect(executePlan).toHaveBeenCalledWith(expect.objectContaining({
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: "20002" } }],
    }), expect.objectContaining({ scope, actor: { userId: actor.userId, email: actor.email } }));
    expect(repository.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      response: "Order 20002 is currently available.",
      structuredCards: expect.arrayContaining([
        expect.objectContaining({ kind: "response_presentation", presentation: "record_summary" }),
        expect.objectContaining({ kind: "order_summary", sourceLinks: [{ label: "Order 20002", href: "/orders/order_1" }] }),
      ]),
    }));
  });

  test("formats current-record context as conversational prose without exposing the tool name", async () => {
    const repository = repo();
    const planner = { plan: jest.fn() };
    const executePlan = jest.fn(async () => ({
      executions: [{
        toolName: "navigation.get_current_context",
        status: "succeeded",
        result: {
          status: "succeeded",
          data: {
            pageTitle: "Order Details",
            currentRecord: {
              entityType: "order", entityId: "order_1", orderNumber: "ORD-20003", customer: "T3 Signs", status: "In Production",
              dueDate: "2026-07-22T00:00:00.000Z", sourceLink: { label: "View order", href: "/orders/order_1" }, freshness: "2026-07-21T12:00:00.000Z",
            },
          },
          provenance: { sourceLinks: [{ label: "View order", href: "/orders/order_1" }], freshness: { capturedAt: "2026-07-21T12:00:00.000Z" } },
        },
      }],
    }));
    const service = new AssistantService(repository, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true })) }, planner, () => ({ executePlan }));

    await service.createTurn(scope, "conversation_1", actor, { message: "What record am I currently viewing?", context });

    expect(planner.plan).not.toHaveBeenCalled();
    expect(repository.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      response: "You're viewing Order ORD-20003 for T3 Signs. It is currently In Production and due July 22.",
      structuredCards: expect.arrayContaining([
        expect.objectContaining({ kind: "response_presentation", presentation: "conversational" }),
        expect.objectContaining({ kind: "current_context", title: "navigation.get_current_context" }),
      ]),
    }));
  });

  test.each([
    ["Find quote 4402", "quote", "Quote 4402", "sent"],
    ['Find customer "Acme Print"', "customer", "Acme Print", "active"],
    ["Find product Business Cards", "product", "Business Cards", "inactive"],
  ])("exact %s lookup bypasses provider and keeps only the exact expected result", async (message, entityType, label, status) => {
    const repository = repo();
    const planner = { plan: jest.fn() };
    const executePlan = jest.fn(async () => ({
      executions: [{
        toolName: "search.global",
        status: "succeeded",
        result: {
          status: "succeeded",
          data: {
            matches: [
              { entityType, recordId: "record_1", label, status, sourceLink: { label, href: `/${entityType}s/record_1` }, freshness: "2026-07-21T12:00:00.000Z" },
              { entityType: "order", recordId: "order_1", label: "Order 4402", status: "In Production", sourceLink: { label: "Order 4402", href: "/orders/order_1" }, freshness: "2026-07-21T12:00:00.000Z" },
            ],
          },
          provenance: {
            sourceLinks: [
              { label, href: `/${entityType}s/record_1`, entityType, entityId: "record_1" },
              { label: "Order 4402", href: "/orders/order_1", entityType: "order", entityId: "order_1" },
            ],
            freshness: { capturedAt: "2026-07-21T12:00:00.000Z" },
          },
        },
      }],
    }));
    const service = new AssistantService(repository, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true })) }, planner, () => ({ executePlan }));

    await service.createTurn(scope, "conversation_1", actor, { message, context });

    expect(planner.plan).not.toHaveBeenCalled();
    expect(executePlan).toHaveBeenCalledWith(expect.objectContaining({
      toolCalls: [{ toolName: "search.global", arguments: expect.objectContaining({ limit: 5 }) }],
    }), expect.anything());
    expect(repository.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      response: `I found ${label}, currently ${status}.`,
      structuredCards: expect.arrayContaining([
        expect.objectContaining({ kind: "search_results", sourceLinks: [{ label, href: `/${entityType}s/record_1`, entityType, entityId: "record_1" }] }),
      ]),
    }));
  });

  test("returns a safe not-found response for an exact deterministic lookup", async () => {
    const repository = repo();
    const planner = { plan: jest.fn() };
    const executePlan = jest.fn(async () => ({
      executions: [{
        toolName: "search.global", status: "succeeded",
        result: { status: "succeeded", data: { matches: [] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-07-21T12:00:00.000Z" } } },
      }],
    }));
    const service = new AssistantService(repository, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true })) }, planner, () => ({ executePlan }));

    await service.createTurn(scope, "conversation_1", actor, { message: "Find customer Unknown Print", context });

    expect(planner.plan).not.toHaveBeenCalled();
    expect(repository.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      response: "I couldn't find a matching customer.",
      structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "not_found", sourceLinks: [] })]),
    }));
  });

  test("asks for a selection when the bounded exact search has duplicate exact names", async () => {
    const repository = repo();
    const planner = { plan: jest.fn() };
    const executePlan = jest.fn(async () => ({
      executions: [{
        toolName: "search.global", status: "succeeded",
        result: {
          status: "succeeded",
          data: { matches: [
            { entityType: "customer", recordId: "customer_1", label: "Acme Print", sourceLink: { label: "Acme Print", href: "/customers/customer_1" }, freshness: "2026-07-21T12:00:00.000Z" },
            { entityType: "customer", recordId: "customer_2", label: "Acme Print", sourceLink: { label: "Acme Print", href: "/customers/customer_2" }, freshness: "2026-07-21T12:00:00.000Z" },
          ] },
          provenance: { sourceLinks: [
            { label: "Acme Print", href: "/customers/customer_1", entityType: "customer", entityId: "customer_1" },
            { label: "Acme Print", href: "/customers/customer_2", entityType: "customer", entityId: "customer_2" },
          ], freshness: { capturedAt: "2026-07-21T12:00:00.000Z" } },
        },
      }],
    }));
    const service = new AssistantService(repository, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true })) }, planner, () => ({ executePlan }));

    await service.createTurn(scope, "conversation_1", actor, { message: "Find customer Acme Print", context });

    expect(planner.plan).not.toHaveBeenCalled();
    expect(repository.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      response: "I found multiple customers with that exact name. Please choose one from the results.",
      structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "search_results", sourceLinks: expect.arrayContaining([expect.objectContaining({ entityId: "customer_1" }), expect.objectContaining({ entityId: "customer_2" })]) })]),
    }));
  });
});
