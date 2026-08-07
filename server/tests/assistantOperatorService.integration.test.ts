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

function continuingTaskStore(): AssistantOperatorTaskStore & { updates: any[]; task: any } {
  const task: any = { id: "task_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", domain: null, goal: "Find quotes", workingSummary: null, entityReferences: [], missingInformation: [], semanticChanges: {}, confirmationState: "none", status: "active", canonicalProductIntentProposalId: null, lastObservationSummary: null };
  const updates: any[] = [];
  let created = false;
  return {
    task,
    updates,
    getActive: jest.fn(async () => created ? task : null),
    create: jest.fn(async () => { created = true; return task; }),
    update: jest.fn(async (input: any) => { updates.push(input); Object.assign(task, input.patch); return task; }),
  };
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

  test("normal free text can select the registered composite semantic capability and persist one confirmation card", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const compositeTool = {
      name: "quotes.plan_internal_notes",
      description: "Prepare one confirmation for eligible internal quote notes.",
      execute: jest.fn(async () => ({ status: "succeeded" as const, result: { status: "succeeded" as const, data: { eligibleCount: 2, response: "I prepared one confirmation for 2 eligible open quotes." }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } }, presentation: { cards: [{ kind: "action_plan" as const, title: "Add internal note to 2 open quotes", summary: "One confirmation is required.", sourceLinks: [], plan: { id: "composite_1", status: "awaiting_confirmation", planVersion: 2, confirmationToken: "opaque-user-token", confirmationAvailable: true, preview: { affectedEntities: [{ entityType: "quote", entityId: "quote_1", label: "Quote Q-101" }, { entityType: "quote", entityId: "quote_2", label: "Quote Q-102" }] } } }] } })),
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => observations.length
      ? ({ kind: "complete", response: "I prepared one confirmation for 2 eligible open quotes." })
      : (expect(toolCatalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: "quotes.plan_internal_notes" })])), { kind: "call_tools", calls: [{ toolName: "quotes.plan_internal_notes", arguments: { customerName: "Acme Printing", noteText: "Waiting on revised artwork" } }] })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, () => compositeTool);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.quotes.add_internal_note"] }, { message: "Add an internal note to Acme's open quotes.", context });

    expect(compositeTool.execute).toHaveBeenCalledTimes(1);
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "I prepared one confirmation for 2 eligible open quotes.", structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "action_plan", plan: expect.objectContaining({ id: "composite_1", confirmationToken: "opaque-user-token" }) })]) }));
  });

  test("ordinary quote investigations use tenant-wide search and retain trusted references for an unambiguous follow-up", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const tasks = continuingTaskStore();
    const executor = {
      catalog: () => [
        { name: "quotes.search", description: "Search tenant-wide quotes without requiring a customer." },
        { name: "customers.get_summary", description: "Get one customer summary." },
      ],
      execute: jest.fn(async ({ toolName, arguments: args, context: trusted }: any) => {
        expect(trusted.scope).toEqual(scope);
        if (toolName === "quotes.search") {
          expect(args).toEqual({ lifecycle: "open", sort: "newest", limit: 5 });
          return {
            toolName,
            status: "succeeded",
            result: {
              status: "succeeded",
              data: {
                totalMatchingQuotes: 2,
                quotes: [
                  { quoteId: "quote_new", quoteNumber: "Q-200", customer: { id: "customer_new", name: "Acme" }, total: 5100, status: "sent", open: true, createdAt: "2026-08-07T12:00:00.000Z", sourceLink: { label: "Quote Q-200", href: "/quotes/quote_new", entityType: "quote", entityId: "quote_new" } },
                  { quoteId: "quote_old", quoteNumber: "Q-199", customer: { id: "customer_old", name: "Beta" }, total: 2500, status: "draft", open: true, createdAt: "2026-08-06T12:00:00.000Z", sourceLink: { label: "Quote Q-199", href: "/quotes/quote_old", entityType: "quote", entityId: "quote_old" } },
                ],
                appliedFilters: { lifecycle: "open", recencyField: "createdAt", sentAtAvailable: false },
              },
              provenance: { sourceLinks: [{ label: "Quote Q-200", href: "/quotes/quote_new", entityType: "quote", entityId: "quote_new", capturedAt: "2026-08-07T12:00:00.000Z" }], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } },
            },
          };
        }
        expect(toolName).toBe("customers.get_summary");
        expect(args).toEqual({ customerId: "customer_new" });
        return { toolName, status: "succeeded", result: { status: "succeeded", data: { customer: { recordId: "customer_new", label: "Acme", entityType: "customer", sourceLink: { label: "Acme", href: "/customers/customer_new", entityType: "customer", entityId: "customer_new" }, freshness: "2026-08-07T12:00:00.000Z" } }, provenance: { sourceLinks: [{ label: "Acme", href: "/customers/customer_new", entityType: "customer", entityId: "customer_new", capturedAt: "2026-08-07T12:00:00.000Z" }], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } };
      }),
    };
    const provider = {
      decide: jest.fn(async ({ goal, observations, task: activeTask, toolCatalog }: any) => {
        if (goal.startsWith("Find my 5")) {
          if (!observations.length) {
            expect(toolCatalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: "quotes.search" })]));
            return { kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { lifecycle: "open", sort: "newest", limit: 5 } }], workingSummary: "Listed the newest open quotes." };
          }
          return { kind: "complete", response: "Q-200 for Acme is newest, followed by Q-199 for Beta.", workingSummary: "Open quote investigation complete." };
        }
        expect(activeTask.entityReferences).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "quote", id: "quote_new" }),
          expect.objectContaining({ type: "customer", id: "customer_new" }),
        ]));
        return observations.length
          ? { kind: "complete", response: "Acme is the customer on the newest quote.", workingSummary: "Customer follow-up complete." }
          : { kind: "call_tools", calls: [{ toolName: "customers.get_summary", arguments: { customerId: "customer_new" } }] };
      }),
    };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, undefined, () => executor as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Find my 5 most recent open quotes. Give me the quote number, customer, total, and status. Don't change anything.", context });
    expect(tasks.updates.at(-1).patch).toEqual(expect.objectContaining({ domain: "quotes", status: "active", entityReferences: expect.arrayContaining([expect.objectContaining({ type: "quote", id: "quote_new" }), expect.objectContaining({ type: "customer", id: "customer_new" })]) }));

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Take the newest one and tell me about the customer.", context });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "customers.get_summary", arguments: { customerId: "customer_new" } }));
    expect(repo.createFoundationTurn).toHaveBeenLastCalledWith(expect.objectContaining({ response: "Acme is the customer on the newest quote.", mode: "ai_operator_runtime" }));
  });
});
