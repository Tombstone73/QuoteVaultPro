import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

// The service import has existing DB-backed specialist imports. This is a
// deliberately unreachable local endpoint used only so the test exercises the
// injected canonical dispatcher; it never opens a connection.
process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", route: "/products/details/product_1", pageTitle: "Product Details", entityType: "product", entityId: "product_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-06T12:00:00.000Z", unsavedChanges: false,
});
const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.products.create_inactive_draft"] };

function repo() {
  const conversation = { id: "conversation_1", organizationId: "org_1", userId: "user_1", title: "New", status: "active" as const, lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] };
  return {
    listConversations: jest.fn(), createConversation: jest.fn(), getConversation: jest.fn(async () => conversation), updateConversation: jest.fn(),
    createFoundationTurn: jest.fn(async (input: any) => ({ turnId: "turn_1", correlationId: input.correlationId, status: input.status, conversation, userMessage: { id: "u", conversationId: conversation.id, turnId: "turn_1", role: "user", content: input.message, createdAt: new Date() }, assistantMessage: { id: "a", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: input.response, createdAt: new Date() } })),
  };
}

const translucentVinylPlan = {
  version: 1, operation: "create", domain: "products", mode: "mutation", capabilityId: "canonical_product_intent_compiler", confidence: "high",
  target: { kind: "new_entity", entityId: null }, contextUsage: { workspaceIsAuthoritative: false, workspaceRelevance: "supporting", activeSessionId: null },
  requiresClarification: false, clarificationQuestion: null, reasonCode: "explicit_new_entity_request",
} as const;

describe("AI-first assistant free-text routing", () => {
  test("routes a detailed Translucent Vinyl request from Product Details to canonical compiler with the unchanged full message", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const storage = repo();
    const planner = { plan: jest.fn(async () => ({ ok: true as const, plan: translucentVinylPlan, diagnostics: { provider: "openai_compatible", model: "deepseek-test" } })) };
    const canonical = { respondPlannedCanonicalProductIntent: jest.fn(async () => ({ handled: true, response: "Canonical draft started.", cards: [] })) };
    const service = new AssistantService(storage, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, planner, canonical);
    const message = "Create a new product called Translucent Vinyl, 54 inch wide, printed one side, with a 3 mm hem and grommets every 24 inches.";

    await service.createTurn(scope, "conversation_1", actor, { message, context });

    expect(planner.plan).toHaveBeenCalledWith(expect.objectContaining({ user: expect.stringContaining(message) }));
    expect(canonical.respondPlannedCanonicalProductIntent).toHaveBeenCalledWith(expect.objectContaining({ message, operation: "create", conversationId: "conversation_1" }));
    expect(storage.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_first_typed_intent_planner", message }));
  });

  test("persists a planner failure without calling the canonical or legacy product dispatcher", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const storage = repo();
    const planner = { plan: jest.fn(async () => ({ ok: false as const, error: { code: "provider_failure", message: "Planning failed safely.", retryable: true, correlationId: "aip_test" }, diagnostics: { provider: "openai_compatible", model: "deepseek-test" } })) };
    const canonical = { respondPlannedCanonicalProductIntent: jest.fn() };
    const service = new AssistantService(storage, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, planner, canonical);

    await service.createTurn(scope, "conversation_1", actor, { message: "Create a product", context });

    expect(canonical.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(storage.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "provider_failure", mode: "ai_first_typed_intent_planner" }));
  });
});
