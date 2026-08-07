import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import type { AssistantOperatorTaskStore } from "../services/assistant/operatorTaskContext";

// Historical filename retained so CI keeps exercising the routing seam. The
// assertions below intentionally cover the operator runtime that replaced the
// retired AI-first planner/specialist path.
process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", route: "/products", pageTitle: "Products", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false,
});
const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.products.create_inactive_draft"] };

function repository() {
  const conversation: any = { id: "conversation_1", organizationId: "org_1", userId: "user_1", title: "New", status: "active", lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] };
  return {
    listConversations: jest.fn(), createConversation: jest.fn(), updateConversation: jest.fn(), getConversation: jest.fn(async () => conversation),
    createFoundationTurn: jest.fn(async (input: any) => ({ turnId: "turn_1", correlationId: input.correlationId, status: input.status, conversation, userMessage: { id: "u", conversationId: conversation.id, turnId: "turn_1", role: "user", content: input.message, createdAt: new Date() }, assistantMessage: { id: "a", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: input.response, structuredCards: input.structuredCards, createdAt: new Date() } })),
  };
}

function tasks(): AssistantOperatorTaskStore & { updates: any[] } {
  const task: any = { id: "task_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", domain: null, goal: "Create product", workingSummary: null, entityReferences: [], missingInformation: [], semanticChanges: {}, confirmationState: "none", status: "active", canonicalProductIntentProposalId: null, lastObservationSummary: null };
  const updates: any[] = [];
  return { updates, getActive: jest.fn(async () => null), create: jest.fn(async () => task), update: jest.fn(async (input: any) => { updates.push(input); Object.assign(task, input.patch); return task; }) };
}

function operatorProviderResolver() {
  return { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://provider.test", apiKey: "test", model: "test", mode: "printershero_managed", source: "test" })) };
}

describe("AI Operator routing (replacement for retired AI-first planner coverage)", () => {
  test("ordinary free text invokes the bounded operator provider and never the legacy intent planner", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const legacyPlanner = { plan: jest.fn(async () => { throw new Error("retired planner must not run"); }) };
    const provider = { decide: jest.fn(async () => ({ kind: "complete", response: "I can help with that.", workingSummary: "General assistance complete." })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, legacyPlanner as any, undefined, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "What can you help with?", context });

    expect(provider.decide).toHaveBeenCalledWith(expect.objectContaining({ goal: "What can you help with?" }));
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_operator_runtime", provider: "operator_runtime" }));
  });

  test("a semantic product tool call keeps the original goal server-trusted and persists no legacy fallback", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const product = { respondPlannedCanonicalProductIntent: jest.fn(async () => ({ handled: true, response: "Product draft is ready for review.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Ready", sourceLinks: [], details: { proposalId: "proposal_1" } }] })) };
    const provider = { decide: jest.fn(async ({ observations }: any) => observations.length
      ? ({ kind: "complete", response: "Product draft is ready for review.", workingSummary: "Draft prepared." })
      : ({ kind: "call_tools", calls: [{ toolName: "products.manage_intent", arguments: { operation: "start_new" } }] })) };
    const legacyPlanner = { plan: jest.fn() };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, legacyPlanner as any, product, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);
    const message = "Create a new Translucent Vinyl product with a 3 mm hem.";

    await service.createTurn(scope, "conversation_1", actor, { message, context });

    expect(product.respondPlannedCanonicalProductIntent).toHaveBeenCalledWith(expect.objectContaining({ message, operation: "create", conversationId: "conversation_1" }));
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "Product draft is ready for review.", mode: "ai_operator_runtime" }));
  });

  test("a product capability question is answered from the permission-aware catalog without starting Product Builder", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const product = { respondPlannedCanonicalProductIntent: jest.fn() };
    const provider = { decide: jest.fn(async ({ toolCatalog }: any) => {
      expect(toolCatalog.some((tool: { name: string }) => tool.name === "products.manage_intent")).toBe(false);
      return { kind: "complete", response: "Your current permissions do not allow product creation." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: [] }, { message: "Can you add products to the system?", context });

    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "Your current permissions do not allow product creation." }));
  });

  test("an invalid operator decision fails safely without invoking a product mutation path", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const product = { respondPlannedCanonicalProductIntent: jest.fn() };
    const provider = { decide: jest.fn(async () => ({ kind: "unsupported_decision" })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Change a product.", context });

    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "operator_failed", response: "I couldn't complete the request because the AI Operator could not complete its investigation." }));
  });
});
