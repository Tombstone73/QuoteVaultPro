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
      response: "I found 1 read-only result.",
      structuredCards: [expect.objectContaining({ kind: "order_summary", sourceLinks: [{ label: "Order 20002", href: "/orders/order_1" }] })],
    }));
  });
});
