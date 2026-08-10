import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import type { AssistantOperatorTaskStore } from "../services/assistant/operatorTaskContext";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/products", pageTitle: "Products", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.products.create_inactive_draft"] };
const operatorProviderResolver = { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com", apiKey: "test", model: "deepseek-v4-flash" })) };

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

/** Keep integration tests at the AssistantService boundary: semantic tools
 * are exercised, while unrelated database-backed read adapters are not
 * initialized unless a test explicitly supplies one. */
function semanticOnlyExecutor(_audit: unknown, semanticTools: readonly any[]) {
  const tools = new Map(semanticTools.map((tool) => [tool.name, tool]));
  return {
    catalog: () => semanticTools.map((tool) => ({ name: tool.name, description: tool.description, ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}) })),
    execute: async ({ toolName, arguments: args, context: trusted }: any) => {
      const tool = tools.get(toolName);
      if (!tool) throw new Error(`Unexpected integration tool: ${toolName}`);
      return { toolName, ...(await tool.execute({ arguments: args, context: trusted })) };
    },
  };
}

describe("AssistantService Operator Runtime integration", () => {
  test("the exact complex Translucent Vinyl request begins a direct draft and applies only business operations", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const exactRequest = "Let's add a new product called \"Translucent Vinyl - backlit with multilayer printing\". It should have an option for 3 layer or 5 layer. 3 layer is $4 sq ft and 5 layer is $5 sq ft. Another option is contour cutting. Contour cutting adds 10% to the total price. If the answer is yes, then an additional option appears that is for weeding and taping. If they want weeding and taping, instead of a 10% increase, the price increase 30%.";
    const cards = [{ kind: "canonical_product_intent_proposal", title: "Create inactive draft: Translucent Vinyl - backlit with multilayer printing", summary: "Canonical product intent needs the remaining decisions.", sourceLinks: [], details: { proposalId: "proposal_translucent", canonicalProductIntent: { readiness: { ready: false, blockers: [], questions: ["Choose a product category."] } } }];
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "I started an unfinished product draft.", cards })),
      applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "I created a canonical product intent and will ask only its remaining questions.", cards })),
    };
    const operations = [
      { op: "set_product_name", name: "Translucent Vinyl - backlit with multilayer printing" },
      { op: "set_measurement_mode", mode: "dimensions_required" },
      { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
      { op: "add_option_value", optionGroup: "Layers", value: "5 Layer" },
      { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
      { op: "set_option_rate", optionGroup: "Layers", value: "5 Layer", priceCents: 500, basis: "per_square_foot" },
      { op: "add_option_group", optionGroup: "Contour Cutting", required: false, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Contour Cutting", value: "No" },
      { op: "add_option_value", optionGroup: "Contour Cutting", value: "Yes" },
      { op: "set_option_price_impact", optionGroup: "Contour Cutting", value: "Yes", percent: 10 },
      { op: "add_option_group", optionGroup: "Weeding and Taping", required: false, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Weeding and Taping", value: "No" },
      { op: "add_option_value", optionGroup: "Weeding and Taping", value: "Yes" },
      { op: "set_option_group_availability", optionGroup: "Weeding and Taping", whenOptionGroup: "Contour Cutting", whenValue: "Yes" },
      { op: "set_option_price_impact", optionGroup: "Weeding and Taping", value: "Yes", percent: 30, replacesPercentageWhen: { optionGroup: "Contour Cutting", value: "Yes" } },
    ];
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => {
      expect(toolCatalog).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "products.manage_intent" })]));
      const operationTool = toolCatalog.find((tool: any) => tool.name === "products.apply_operations");
      expect(operationTool?.inputSchema).toMatchObject({ properties: { operations: { maxItems: 24 } } });
      expect(JSON.stringify(operationTool?.inputSchema)).not.toMatch(/patch|revision|fingerprint|serverOwnedFields|pbv2/i);
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: {} }] };
      if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations } }] };
      return { kind: "complete", response: "I created a canonical product intent and will ask only its remaining questions." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.create_inactive_draft"] }, { message: exactRequest, context });

    expect(product.beginCanonicalProductDraft).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation_1" }));
    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation_1", message: exactRequest, operations }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_operator_runtime", structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "canonical_product_intent_proposal" })]) }));
  });

  test("does not expose direct product-draft tools without a product-draft permission", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const product = { beginCanonicalProductDraft: jest.fn(), applyCanonicalProductOperations: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
    const provider = { decide: jest.fn(async ({ toolCatalog }: any) => {
      expect(toolCatalog).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "products.begin_draft" }),
        expect.objectContaining({ name: "products.apply_operations" }),
      ]));
      return { kind: "complete", response: "I do not have permission to create a product draft." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Begin a new product draft.", context });

    expect(product.beginCanonicalProductDraft).not.toHaveBeenCalled();
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
  });

  test("ordinary free text enters the Operator Runtime instead of the legacy planner", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const legacyPlanner = { plan: jest.fn(async () => { throw new Error("legacy planner must not run"); }) };
    const provider = { decide: jest.fn(async () => ({ kind: "complete", response: "I can help with that.", workingSummary: "General assistance complete." })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, legacyPlanner as any, undefined, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    await service.createTurn(scope, "conversation_1", actor, { message: "What can you help with?", context });
    expect(provider.decide).toHaveBeenCalledTimes(1);
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_operator_runtime" }));
  });

  test("a product task survives a read-only detour and a later semantic continuation", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "Saved product revision.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Ready", sourceLinks: [], details: { proposalId: "proposal_1" } }] })),
    };
    const detourProvider = { decide: jest.fn(async () => ({ kind: "complete", response: "Regular translucent vinyl pricing could not be verified.", workingSummary: "Read-only detour completed." })) };
    const detour = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => detourProvider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    await detour.createTurn(scope, "conversation_1", actor, { message: "How much do we charge for regular translucent vinyl?", context });
    expect(tasks.updates.at(-1).patch.status).toBe("active");
    const correctionProvider = { decide: jest.fn(async ({ observations }: any) => observations.length ? ({ kind: "complete", response: "Done.", workingSummary: "Product revised." }) : ({ kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 550, basis: "per_square_foot" }] } }] })) };
    const correction = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => correctionProvider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    await correction.createTurn(scope, "conversation_1", actor, { message: "Make the 3 layer price $5.50 instead.", context });
    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({ message: "Make the 3 layer price $5.50 instead.", operations: [{ op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 550, basis: "per_square_foot" }] }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
  });

  test("an active product correction uses the direct semantic operation capability instead of the continuation compiler adapter", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      applyCanonicalProductOperations: jest.fn(async () => ({
        handled: true,
        response: "I saved the product revision and kept only its remaining questions.",
        cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Needs category review", sourceLinks: [], details: { proposalId: "proposal_1" } }],
      })),
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => observations.length
      ? ({ kind: "complete", response: "I saved the product revision." })
      : (expect(toolCatalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: "products.apply_operations", inputSchema: expect.objectContaining({ required: ["operations"] }) })])), {
        kind: "call_tools",
        calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_category", category: "roll" }] } }],
      })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "I accidentally selected flatbed when it should have been roll.", context });

    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation_1",
      message: "I accidentally selected flatbed when it should have been roll.",
      operations: [{ op: "set_category", category: "roll" }],
    }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "I saved the product revision and kept only its remaining questions." }));
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
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, () => compositeTool, semanticOnlyExecutor as any, operatorProviderResolver as any);

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
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, undefined, () => executor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Find my 5 most recent open quotes. Give me the quote number, customer, total, and status. Don't change anything.", context });
    expect(tasks.updates.at(-1).patch).toEqual(expect.objectContaining({ domain: "quotes", status: "active", entityReferences: expect.arrayContaining([expect.objectContaining({ type: "quote", id: "quote_new" }), expect.objectContaining({ type: "customer", id: "customer_new" })]) }));

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Take the newest one and tell me about the customer.", context });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "customers.get_summary", arguments: { customerId: "customer_new" } }));
    expect(repo.createFoundationTurn).toHaveBeenLastCalledWith(expect.objectContaining({ response: "Acme is the customer on the newest quote.", mode: "ai_operator_runtime" }));
  });

  test("the exact quote-formatting follow-up answers from retained observations without another lookup", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = continuingTaskStore();
    const executor = {
      catalog: () => [{ name: "quotes.search", description: "Search tenant-wide quotes." }],
      execute: jest.fn(async ({ toolName }: any) => ({ toolName, status: "succeeded", result: { status: "succeeded", data: { totalMatchingQuotes: 5, quotes: [
        { quoteId: "quote_1", quoteNumber: "QT-910322", customer: { id: "customer_1", name: "TEST WORKFLOW BROWSER RUN 2026-05-23T13-37-13-356Z" }, total: 0, status: "draft", open: true, createdAt: "2026-08-07T12:00:00.000Z", sourceLink: { label: "Quote QT-910322", href: "/quotes/quote_1", entityType: "quote", entityId: "quote_1" } },
        { quoteId: "quote_2", quoteNumber: "QT-910321", customer: { id: "customer_2", name: "55 Twin Lane" }, total: 8.88, status: "draft", open: true, createdAt: "2026-08-06T12:00:00.000Z", sourceLink: { label: "Quote QT-910321", href: "/quotes/quote_2", entityType: "quote", entityId: "quote_2" } },
        { quoteId: "quote_3", quoteNumber: "QT-910320", customer: { id: "customer_3", name: "55 Twin Lane" }, total: 8.88, status: "draft", open: true, createdAt: "2026-08-05T12:00:00.000Z", sourceLink: { label: "Quote QT-910320", href: "/quotes/quote_3", entityType: "quote", entityId: "quote_3" } },
        { quoteId: "quote_4", quoteNumber: "QT-910319", customer: { id: "customer_4", name: "55 Twin Lane" }, total: 8.88, status: "draft", open: true, createdAt: "2026-08-04T12:00:00.000Z", sourceLink: { label: "Quote QT-910319", href: "/quotes/quote_4", entityType: "quote", entityId: "quote_4" } },
        { quoteId: "quote_5", quoteNumber: "QT-910318", customer: { id: "customer_5", name: "55 Twin Lane" }, total: 8.88, status: "draft", open: true, createdAt: "2026-08-03T12:00:00.000Z", sourceLink: { label: "Quote QT-910318", href: "/quotes/quote_5", entityType: "quote", entityId: "quote_5" } },
      ], appliedFilters: { lifecycle: "open", recencyField: "createdAt", sentAtAvailable: false } }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } })),
    };
    const provider = { decide: jest.fn(async ({ goal, observations, task }: any) => {
      if (goal.startsWith("Find my 5")) return observations.length ? { kind: "complete", response: "Five quotes found." } : { kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { lifecycle: "open", sort: "newest", limit: 5 } }] };
      expect(observations).toEqual([]);
      expect(task.trustedObservations).toEqual([expect.objectContaining({ toolName: "quotes.search", data: expect.objectContaining({ totalMatchingQuotes: 5, quotes: expect.arrayContaining([expect.objectContaining({ quoteNumber: "QT-910318" })]) }) })]);
      if (goal === "Which one has the largest total?") return { kind: "complete", response: "Four quotes are tied for the largest total at $8.88: QT-910321, QT-910320, QT-910319, and QT-910318." };
      return { kind: "complete", response: "**QT-910322**\nCustomer: TEST WORKFLOW BROWSER RUN 2026-05-23T13-37-13-356Z\nTotal: $0.00\nStatus: Draft\n\n**QT-910321**\nCustomer: 55 Twin Lane\nTotal: $8.88\nStatus: Draft\n\n**QT-910320**\nCustomer: 55 Twin Lane\nTotal: $8.88\nStatus: Draft\n\n**QT-910319**\nCustomer: 55 Twin Lane\nTotal: $8.88\nStatus: Draft\n\n**QT-910318**\nCustomer: 55 Twin Lane\nTotal: $8.88\nStatus: Draft" };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, undefined, () => executor as any, operatorProviderResolver as any);
    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Find my 5 most recent open quotes. Give me the quote number, customer, total, and status. Don't change anything.", context });
    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "Which one has the largest total?", context });
    expect(repo.createFoundationTurn).toHaveBeenLastCalledWith(expect.objectContaining({ response: "Four quotes are tied for the largest total at $8.88: QT-910321, QT-910320, QT-910319, and QT-910318.", mode: "ai_operator_runtime" }));
    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff"] }, { message: "please separate these into individual lines per quote so I can read them", context });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(repo.createFoundationTurn).toHaveBeenLastCalledWith(expect.objectContaining({ response: expect.stringContaining("**QT-910318**\nCustomer: 55 Twin Lane"), mode: "ai_operator_runtime" }));
    expect(repo.createFoundationTurn.mock.calls.at(-1)?.[0]?.response).not.toContain("Created:");
  });
});
