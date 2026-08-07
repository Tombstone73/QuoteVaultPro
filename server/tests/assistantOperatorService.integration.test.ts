import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import type { AssistantOperatorTaskStore } from "../services/assistant/operatorTaskContext";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/products", pageTitle: "Products", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.products.create_inactive_draft"] };

function repository() {
  const conversation: any = { id: "conversation_1", organizationId: "org_1", userId: "user_1", title: "New", status: "active", lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] };
  return {
    listConversations: jest.fn(), createConversation: jest.fn(), updateConversation: jest.fn(), getConversation: jest.fn(async () => conversation),
    createFoundationTurn: jest.fn(async (input: any) => ({ turnId: "turn_1", correlationId: input.correlationId, status: input.status, conversation, userMessage: { id: "u", conversationId: conversation.id, turnId: "turn_1", role: "user", content: input.message, createdAt: new Date() }, assistantMessage: { id: "a", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: input.response, structuredCards: input.structuredCards, createdAt: new Date() } })),
  };
}

function taskStore(activeProposalId: string | null = null): AssistantOperatorTaskStore & { updates: any[] } {
  const task: any = { id: "task_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", domain: activeProposalId ? "products" : null, goal: "Create product", workingSummary: null, entityReferences: [], missingInformation: [], semanticChanges: {}, confirmationState: "none", status: "active", canonicalProductIntentProposalId: activeProposalId, lastObservationSummary: null };
  const updates: any[] = [];
  return { updates, getActive: jest.fn(async () => activeProposalId ? task : null), create: jest.fn(async () => task), update: jest.fn(async (input: any) => { updates.push(input); Object.assign(task, input.patch); return task; }) };
}

describe("AssistantService Operator Runtime integration", () => {
  test("ordinary free text enters the Operator Runtime instead of the legacy planner", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const legacyPlanner = { plan: jest.fn(async () => { throw new Error("legacy planner must not run"); }) };
    const provider = { decide: jest.fn(async () => ({ kind: "complete", response: "I can help with that.", workingSummary: "General assistance complete." })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, legacyPlanner as any, undefined, () => provider, tasks);
    await service.createTurn(scope, "conversation_1", actor, { message: "What can you help with?", context });
    expect(provider.decide).toHaveBeenCalledTimes(1);
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_operator_runtime" }));
  });

  test("a product task survives a read-only detour and a later semantic continuation", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = { respondPlannedCanonicalProductIntent: jest.fn(async () => ({ handled: true, response: "Saved product revision.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Ready", sourceLinks: [], details: { proposalId: "proposal_1" } }] })) };
    const detourProvider = { decide: jest.fn(async () => ({ kind: "complete", response: "Regular translucent vinyl pricing could not be verified.", workingSummary: "Read-only detour completed." })) };
    const detour = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => detourProvider, tasks);
    await detour.createTurn(scope, "conversation_1", actor, { message: "How much do we charge for regular translucent vinyl?", context });
    expect(tasks.updates.at(-1).patch.status).toBe("active");
    const correctionProvider = { decide: jest.fn(async ({ observations }: any) => observations.length ? ({ kind: "complete", response: "Done.", workingSummary: "Product revised." }) : ({ kind: "call_tools", calls: [{ toolName: "products.manage_intent", arguments: { operation: "continue" } }] })) };
    const correction = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => correctionProvider, tasks);
    await correction.createTurn(scope, "conversation_1", actor, { message: "Make the 3 layer price $5.50 instead.", context });
    expect(product.respondPlannedCanonicalProductIntent).toHaveBeenCalledWith(expect.objectContaining({ operation: "continue_session", message: "Make the 3 layer price $5.50 instead." }));
  });
});
