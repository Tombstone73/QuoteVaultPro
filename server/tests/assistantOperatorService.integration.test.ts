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
  test("the exact complex Translucent Vinyl request begins one populated direct draft with all supplied business operations", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const exactRequest = "Let's add a new product called \"Translucent Vinyl - backlit with multilayer printing\". It should have an option for 3 layer or 5 layer. 3 layer is $4 sq ft and 5 layer is $5 sq ft. Another option is contour cutting. Contour cutting adds 10% to the total price. If the answer is yes, then an additional option appears that is for weeding and taping. If they want weeding and taping, instead of a 10% increase, the price increase 30%.";
    const cards = [{ kind: "canonical_product_intent_proposal", title: "Create inactive draft: Translucent Vinyl - backlit with multilayer printing", summary: "Canonical product intent needs the remaining decisions.", sourceLinks: [], details: { proposalId: "proposal_translucent", canonicalProductIntent: { readiness: { ready: false, blockers: [], questions: ["Choose a product category."] } } }];
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "I started an unfinished product draft.", cards })),
      applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "I created a canonical product intent and will ask only its remaining questions.", cards })),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({ name: "Unfinished product draft", category: { state: "unresolved", label: "Product category", provenance: "unresolved" }, measurementMode: "quantity_only", pricing: { model: "unresolved", basis: null, optionGroup: null, rates: [] }, optionGroups: [], outstandingDecisions: [{ path: "identity.name", question: "What should this product be called?", choices: [] }], recentBusinessOperations: [], trustedSelections: [], readyForReview: false })),
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
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: { initialOperations: operations } }] };
      if (observations.length === 1) {
        expect(observations[0]?.result?.data).toMatchObject({ continuation: { draftEstablished: true, mayApplyBusinessOperations: true }, draftContext: { name: "Unfinished product draft" } });
        expect(JSON.stringify(observations[0]?.result?.data)).not.toContain("canonicalProductIntent");
        return { kind: "complete", response: "I created a canonical product intent and will ask only its remaining questions." };
      }
      return { kind: "complete", response: "I created a canonical product intent and will ask only its remaining questions." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.create_inactive_draft"] }, { message: exactRequest, context });

    expect(product.beginCanonicalProductDraft).toHaveBeenCalledTimes(1);
    expect(product.beginCanonicalProductDraft).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation_1", message: exactRequest, initialOperations: operations }));
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai_operator_runtime", structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "canonical_product_intent_proposal" })]) }));
  });

  test("allows a provider to populate an initial draft in its begin call", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const initialOperations = [{ op: "set_product_name", name: "Translucent Vinyl - backlit with multilayer printing" }, { op: "set_pricing_basis", basis: "per_square_foot" }, { op: "set_measurement_mode", mode: "dimensions_required" }];
    const cards = [{ kind: "canonical_product_intent_proposal", title: "Product draft", summary: "Needs category", sourceLinks: [], details: { proposalId: "proposal_one_call" } }];
    const product = { respondPlannedCanonicalProductIntent: jest.fn(), beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "Draft populated.", cards })), applyCanonicalProductOperations: jest.fn() };
    const provider = { decide: jest.fn(async ({ observations }: any) => observations.length ? ({ kind: "complete", response: "I applied the supplied details." }) : ({ kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: { initialOperations } }] })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    await service.createTurn(scope, "conversation_1", actor, { message: "Create the supplied Translucent Vinyl product.", context });
    expect(product.beginCanonicalProductDraft).toHaveBeenCalledWith(expect.objectContaining({ initialOperations, message: "Create the supplied Translucent Vinyl product." }));
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
  });

  test("rejects a detail-bearing new-product begin without initial operations before any blank draft is created", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const initialOperations = [
      { op: "set_product_name", name: "QA Roll Product" },
      { op: "set_category", category: "Roll Printing" },
      { op: "set_measurement_mode", mode: "dimensions_required" },
      { op: "set_pricing_basis", basis: "per_square_foot" },
      { op: "add_option_group", optionGroup: "Finish", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Finish", value: "Standard" },
      { op: "set_option_default", optionGroup: "Finish", value: "Standard" },
    ];
    const cards = [{ kind: "canonical_product_intent_proposal", title: "Product draft", summary: "Needs pricing", sourceLinks: [], details: { proposalId: "proposal_populated" } }];
    const product = { respondPlannedCanonicalProductIntent: jest.fn(), beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "Draft populated.", cards })), applyCanonicalProductOperations: jest.fn() };
    const provider = { decide: jest.fn(async ({ observations }: any) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: {} }] };
      if (observations.length === 1) {
        expect(observations[0]).toMatchObject({ toolName: "products.begin_draft", status: "rejected", failureCode: "initial_operations_required" });
        return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: { initialOperations } }] };
      }
      return { kind: "complete", response: "The supplied draft details are prepared." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Create a new product named QA Roll Product. It is Roll Printing, requires dimensions, uses per-square-foot pricing, and has a required single-select Finish option with Standard as its default.", context });

    expect(product.beginCanonicalProductDraft).toHaveBeenCalledTimes(1);
    expect(product.beginCanonicalProductDraft).toHaveBeenCalledWith(expect.objectContaining({ initialOperations }));
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
  });

  test("resumes an already-active canonical draft without repeating begin_draft", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore();
    const cards = [{ kind: "canonical_product_intent_proposal", title: "Product draft", summary: "Needs pricing", sourceLinks: [], details: { proposalId: "proposal_active" } }];
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "An unfinished product draft is already active in this conversation.", cards, draftState: "resumed" as const })),
      applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "Draft resumed.", cards })),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({ name: "QA Roll Product", category: { state: "resolved", label: "Roll Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required", pricing: { model: "unresolved", basis: null, optionGroup: null, rates: [] }, optionGroups: [], outstandingDecisions: [], recentBusinessOperations: [], trustedSelections: [], readyForReview: false })),
    };
    const operation = { op: "set_product_name", name: "QA Roll Product" };
    const provider = { decide: jest.fn(async ({ observations }: any) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: { initialOperations: [operation] } }] };
      if (observations.length === 1) {
        expect(observations[0]).toMatchObject({ toolName: "products.begin_draft", status: "partial", failureCode: "draft_already_active", result: { data: { proposalId: "proposal_active", continuation: { draftAlreadyActive: true, mayApplyBusinessOperations: true } } } });
        return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: [operation] } }] };
      }
      return { kind: "complete", response: "Resumed the active draft." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Create a new product named QA Roll Product with a Roll Printing category.", context });

    expect(product.beginCanonicalProductDraft).toHaveBeenCalledTimes(1);
    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation_1", operations: [operation] }));
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

  test("retains a completed research response for clear summarization and shortening follow-ups without stale inheritance", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const tasks = continuingTaskStore();
    const provider = { decide: jest.fn(async ({ goal, task }: any) => {
      if (goal.startsWith("Research General Formulations")) {
        expect(task.businessContext.recentCompletedTurn).toBeNull();
        return { kind: "complete", response: "General Formulations Concept 204 is a printable vinyl film used for graphics. It is 4 mil thick and designed for durable indoor and outdoor applications.", workingSummary: "Researched General Formulations Concept 204 vinyl, including uses, thickness, and durability." };
      }
      if (goal.startsWith("Summarize it")) {
        expect(task.businessContext.recentCompletedTurn).toMatchObject({ goal: expect.stringContaining("General Formulations Concept 204"), response: expect.stringContaining("4 mil"), workingSummary: expect.stringContaining("Concept 204") });
        return { kind: "complete", response: "Concept 204 is a durable 4 mil printable vinyl film for indoor and outdoor graphics.", workingSummary: "Created a customer-facing Concept 204 description." };
      }
      if (goal.startsWith("Make that shorter")) {
        expect(task.businessContext.recentCompletedTurn).toMatchObject({ response: expect.stringContaining("Concept 204") });
        return { kind: "complete", response: "Durable 4 mil printable vinyl for indoor and outdoor graphics.", workingSummary: "Shortened the customer-facing Concept 204 description." };
      }
      expect(task.businessContext.recentCompletedTurn).toMatchObject({ response: expect.stringContaining("Durable 4 mil") });
      return { kind: "complete", response: "I will start a separate quote investigation.", workingSummary: "Started an unrelated quote investigation." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Research General Formulations Concept 204 and tell me its thickness and durability.", context });
    await service.createTurn(scope, "conversation_1", actor, { message: "Summarize it for a product description for customers to see quickly.", context });
    await service.createTurn(scope, "conversation_1", actor, { message: "Make that shorter.", context });
    await service.createTurn(scope, "conversation_1", actor, { message: "Find my open quotes.", context });

    expect(tasks.updates.map((update) => update.patch.status)).toEqual(["active", "active", "active", "active"]);
    expect(provider.decide).toHaveBeenCalledTimes(4);
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

  test("keeps an active product task after a provider failure", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const provider = { decide: jest.fn(async () => ({ kind: "fail", response: "The AI provider returned an unusable investigation result." })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, { respondPlannedCanonicalProductIntent: jest.fn() } as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Continue the unfinished product draft.", context });

    expect(tasks.updates.at(-1).patch.status).toBe("active");
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", response: "The AI provider returned an unusable investigation result." }));
  });

  test("answers active-draft configuration reads directly from authoritative context without a tool or revision", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(), applyCanonicalProductOperations: jest.fn(),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({
        name: "Translucent Vinyl - backlit with multilayer printing", category: { state: "resolved", label: "Roll Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required",
        pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }, { option: "5 Layer", priceCents: 500 }] },
        optionGroups: [
          { label: "Layers", required: true, selectionMode: "single", defaultValue: "3 Layer", values: [{ label: "3 Layer", priceImpactPercent: null, totalPercentWhenEnabled: null }, { label: "5 Layer", priceImpactPercent: null, totalPercentWhenEnabled: null }], availableWhen: null },
          { label: "Contour Cutting", required: false, selectionMode: "single", defaultValue: "No", values: [{ label: "No", priceImpactPercent: null, totalPercentWhenEnabled: null }, { label: "Yes", priceImpactPercent: 10, totalPercentWhenEnabled: null }], availableWhen: null },
          { label: "Weeding and Taping", required: false, selectionMode: "single", defaultValue: "No", values: [{ label: "No", priceImpactPercent: null, totalPercentWhenEnabled: null }, { label: "Yes", priceImpactPercent: null, totalPercentWhenEnabled: { percent: 30, prerequisite: { optionGroup: "Contour Cutting", value: "Yes" } } }], availableWhen: { optionGroup: "Contour Cutting", value: "Yes" } },
        ], outstandingDecisions: [], recentBusinessOperations: [], trustedSelections: [{ field: "Weeding and Taping default", label: "No", provenance: "explicit_user" }], readyForReview: true,
      })),
    };
    const provider = { decide: jest.fn(async ({ goal, observations, task }: any) => {
      expect(observations).toEqual([]);
      expect(task.activeSemanticProductDraft.optionGroups).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Weeding and Taping", defaultValue: "No", availableWhen: { optionGroup: "Contour Cutting", value: "Yes" } })]));
      if (goal.startsWith("Verify")) return { kind: "complete", response: "Weeding and Taping is already limited to Contour Cutting = Yes, and its default is No. I did not change anything." };
      if (goal.startsWith("What is the current Layers")) return { kind: "complete", response: "The current Layers default is 3 Layer." };
      return { kind: "complete", response: "The product is currently in the Roll Printing category." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    const actorWithDraftAccess = { ...actor, permissions: ["assistant.products.update_inactive_draft"] };

    await service.createTurn(scope, "conversation_1", actorWithDraftAccess, { message: "Verify the actual current product configuration for Weeding and Taping. It should only be available when Contour Cutting is Yes, and when it appears its default should be No. Don't change anything unless the current configuration is wrong.", context });
    await service.createTurn(scope, "conversation_1", actorWithDraftAccess, { message: "What is the current Layers default?", context });
    await service.createTurn(scope, "conversation_1", actorWithDraftAccess, { message: "What category is this product currently in?", context });

    expect(provider.decide).toHaveBeenCalledTimes(3);
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
    expect(tasks.updates.at(-1).patch.status).toBe("active");
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "Weeding and Taping is already limited to Contour Cutting = Yes, and its default is No. I did not change anything." }));
  });

  test("offers one read-only batch pricing preview for an active product draft", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const scenarios = [{ squareFeet: 10, selections: [{ optionGroup: "Layers", value: "3 Layer" }, { optionGroup: "Contour Cutting", value: "No" }] }, { squareFeet: 10, selections: [{ optionGroup: "Layers", value: "5 Layer" }, { optionGroup: "Contour Cutting", value: "Yes" }, { optionGroup: "Weeding and Taping", value: "Yes" }] }];
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(), applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "I made 5 Layer the default.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product draft", summary: "Ready", sourceLinks: [], details: { proposalId: "proposal_1" } }] })),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({ name: "Translucent Vinyl", category: { state: "resolved", label: "Roll Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required", pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }, { option: "5 Layer", priceCents: 500 }] }, optionGroups: [], outstandingDecisions: [], recentBusinessOperations: [], trustedSelections: [], readyForReview: true })),
      previewActiveSemanticProductDraftPricing: jest.fn(async () => ({ productName: "Translucent Vinyl", revision: 3, scenarioCount: 2, scenarios: [{ totalCents: 4000 }, { totalCents: 6500 }] })),
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog, task }: any) => {
      if (!observations.length) {
        const preview = toolCatalog.find((tool: any) => tool.name === "products.preview_draft_pricing");
        expect(preview?.inputSchema).toMatchObject({ required: ["scenarios"], properties: { scenarios: { minItems: 1, maxItems: 12 } } });
        expect(task.businessContext.capabilities).toContain("products.preview_draft_pricing");
        return { kind: "call_tools", calls: [{ toolName: "products.preview_draft_pricing", arguments: { scenarios } }] };
      }
      expect(observations[0]).toMatchObject({ toolName: "products.preview_draft_pricing", status: "succeeded", result: { data: { scenarioCount: 2 } } });
      return { kind: "complete", response: "For 10 square feet, 3 Layer with no contour is $40.00 and 5 Layer with contour and Weed/Tape is $65.00." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.update_inactive_draft"] }, { message: "Show the pricing scenarios.", context });

    expect(product.previewActiveSemanticProductDraftPricing).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "proposal_1", scenarios }));
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
    expect(tasks.updates.at(-1).patch.status).toBe("active");

    const correctionProvider = { decide: jest.fn(async ({ observations }: any) => observations.length
      ? ({ kind: "complete", response: "I made 5 Layer the default." })
      : ({ kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_option_default", optionGroup: "Layers", value: "5 Layer" }] } }] })) };
    const correction = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => correctionProvider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);
    await correction.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.update_inactive_draft"] }, { message: "Actually make 5 layer the default instead.", context });
    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({ message: "Actually make 5 layer the default instead.", operations: [{ op: "set_option_default", optionGroup: "Layers", value: "5 Layer" }] }));
  });

  test("keeps the active draft after a rejected read-only pricing preview", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(), applyCanonicalProductOperations: jest.fn(),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({ name: "Translucent Vinyl", category: { state: "resolved", label: "Roll Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required", pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [] }, optionGroups: [], outstandingDecisions: [], recentBusinessOperations: [], trustedSelections: [], readyForReview: true })),
      previewActiveSemanticProductDraftPricing: jest.fn(async () => { throw new Error("The active product draft could not be priced."); }),
    };
    const provider = { decide: jest.fn(async ({ observations }: any) => observations.length
      ? ({ kind: "fail", response: "The draft price preview is unavailable right now." })
      : ({ kind: "call_tools", calls: [{ toolName: "products.preview_draft_pricing", arguments: { scenarios: [{ squareFeet: 10 }] } }] })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.update_inactive_draft"] }, { message: "Show pricing for 10 square feet.", context });

    expect(product.previewActiveSemanticProductDraftPricing).toHaveBeenCalledTimes(1);
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
    expect(tasks.updates.at(-1).patch.status).toBe("active");
  });

  test("an active product correction uses the direct semantic operation capability instead of the continuation compiler adapter", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({
        name: "Translucent Vinyl - backlit with multilayer printing",
        category: { state: "resolved", label: "Flatbed Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required",
        pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }, { option: "5 Layer", priceCents: 500 }] },
        optionGroups: [{ label: "Layers", required: true, selectionMode: "single", defaultValue: null, values: ["3 Layer", "5 Layer"], availableWhen: null }],
        outstandingDecisions: [{ path: "optionGroups.layers.default", question: "Which Layers option should be the default?", choices: ["3 Layer", "5 Layer"] }], recentBusinessOperations: ["identity.category", "pricing.matrix"], trustedSelections: [{ field: "category", label: "Flatbed Printing", provenance: "explicit_user" }], readyForReview: false,
      })),
      applyCanonicalProductOperations: jest.fn(async () => ({
        handled: true,
        response: "I saved the product revision and kept only its remaining questions.",
        cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Needs category review", sourceLinks: [], details: { proposalId: "proposal_1" } }],
      })),
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog, task }: any) => observations.length
      ? ({ kind: "complete", response: "I saved the product revision." })
      : (expect(task.activeSemanticProductDraft).toMatchObject({ category: { label: "Flatbed Printing", provenance: "explicit_user" }, outstandingDecisions: [expect.objectContaining({ path: "optionGroups.layers.default" })] }), expect(task.businessContext).toMatchObject({ taskType: "product_draft", trustedSelections: [expect.objectContaining({ field: "category", label: "Flatbed Printing", provenance: "explicit_user" })], recentOperations: ["identity.category", "pricing.matrix"], readiness: "needs_input" }), expect(toolCatalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: "products.apply_operations", inputSchema: expect.objectContaining({ required: ["operations"] }) })])), {
        kind: "call_tools",
        calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_category", category: "Roll Printing" }] } }],
      })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "I accidentally pressed flatbed. This is a roll product.", context });

    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation_1",
      message: "I accidentally pressed flatbed. This is a roll product.",
      operations: [{ op: "set_category", category: "Roll Printing" }],
    }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "I saved the product revision and kept only its remaining questions." }));
  });

  test("passes safe canonical validation feedback to the Operator so it can revise a product operation", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const invalid = [{ op: "set_option_rate", optionGroup: "Finish", value: "Gloss", priceCents: 500, basis: "per_square_foot" }];
    const revised = [{ op: "add_option_value", optionGroup: "Finish", value: "Gloss" }, ...invalid];
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({ name: "Window Vinyl", category: { state: "resolved", label: "Roll Printing", provenance: "explicit_user" }, measurementMode: "dimensions_required", pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Finish", rates: [] }, optionGroups: [{ label: "Finish", required: false, selectionMode: "single", defaultValue: null, values: ["Matte"], availableWhen: null }], outstandingDecisions: [], recentBusinessOperations: [], trustedSelections: [], readyForReview: false })),
      applyCanonicalProductOperations: jest.fn()
        .mockResolvedValueOnce({ handled: true, response: "Gloss could not be priced because the value is not in Finish.", recovery: { retryable: true, stage: "semantic_operation_validation", code: "PRODUCT_SEMANTIC_OPERATION_REJECTED", validation: { issuePaths: ["operations.0.value"], issueCodes: ["custom"], requestedOperations: ["set_option_rate"], semanticBatch: { operationCount: 1, operationTypes: ["set_option_rate"], failingOperation: { index: 1, type: "set_option_rate", targetLabels: ["Finish", "Gloss"], validationStage: "semantic_operation_validation", dependsOnPriorBatchOperation: false, failureCode: "OPTION_VALUE_NOT_FOUND" }, originalRevisionUnchanged: true } } }, cards: [{ kind: "product_validation_errors", title: "Product change could not be applied", summary: "No revision", sourceLinks: [] }] })
        .mockResolvedValueOnce({ handled: true, response: "I saved the product revision.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Updated", sourceLinks: [], details: { proposalId: "proposal_1" } }] }),
    };
    const provider = { decide: jest.fn(async ({ observations }: any) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: invalid } }] };
      if (observations.length === 1) {
        expect(observations[0]).toMatchObject({ status: "rejected", failureCategory: "recoverable_validation", failureCode: "product_operations_rejected", failingStep: "semantic_operation_validation", validationIssuePaths: ["operations.0.value"], operationType: "set_option_rate", result: { data: { validation: { retryable: true, validation: { requestedOperations: ["set_option_rate"] } }, continuation: { revisePlan: true }, draftContext: { optionGroups: [expect.objectContaining({ label: "Finish", values: ["Matte"] })] } } } });
        return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: revised } }] };
      }
      return { kind: "complete", response: "I added Gloss and its price to the draft." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Add Gloss to Finish and price it at $5 per square foot.", context });

    expect(product.applyCanonicalProductOperations).toHaveBeenNthCalledWith(1, expect.objectContaining({ operations: invalid }));
    expect(product.applyCanonicalProductOperations).toHaveBeenNthCalledWith(2, expect.objectContaining({ operations: revised }));
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "responded", response: "I saved the product revision." }));
  });

  test("an outstanding Layers default answer continues the same semantic draft without compiler continuation", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository(); const tasks = taskStore("proposal_1");
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      getActiveSemanticProductDraftContext: jest.fn(async () => ({
        name: "Translucent Vinyl - backlit with multilayer printing",
        category: { state: "unresolved", label: "Product category", provenance: "unresolved" }, measurementMode: "dimensions_required",
        pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }, { option: "5 Layer", priceCents: 500 }] },
        optionGroups: [{ label: "Layers", required: true, selectionMode: "single", defaultValue: null, values: ["3 Layer", "5 Layer"], availableWhen: null }],
        outstandingDecisions: [{ path: "optionGroups.layers.default", question: "Which Layers option should be the default: 3 Layer or 5 Layer?", choices: ["3 Layer", "5 Layer"] }], recentBusinessOperations: ["pricing.matrix"], trustedSelections: [], readyForReview: false,
      })),
      applyCanonicalProductOperations: jest.fn(async () => ({ handled: true, response: "I updated the product draft and kept only its remaining business questions.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product draft", summary: "Needs category", sourceLinks: [], details: { proposalId: "proposal_1" } }] })),
    };
    const provider = { decide: jest.fn(async ({ observations, task }: any) => observations.length
      ? ({ kind: "complete", response: "I set 3 Layer as the default and kept the remaining product questions." })
      : (expect(task.activeSemanticProductDraft.outstandingDecisions).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.layers.default", choices: ["3 Layer", "5 Layer"] })])), {
        kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_option_default", optionGroup: "Layers", value: "3 Layer" }] } }],
      })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks, undefined, semanticOnlyExecutor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "3 layer is default", context });

    expect(product.applyCanonicalProductOperations).toHaveBeenCalledWith(expect.objectContaining({ message: "3 layer is default", operations: [{ op: "set_option_default", optionGroup: "Layers", value: "3 Layer" }] }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "I updated the product draft and kept only its remaining business questions." }));
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

  test("composes product discovery, summary, and pricing and reuses the trusted product on a follow-up", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const tasks = continuingTaskStore();
    const productId = "product_translucent";
    const executor = {
      catalog: () => [
        { name: "search.global", description: "Search tenant-scoped products." },
        { name: "products.get_summary", description: "Return one trusted product summary." },
        { name: "products.get_pricing", description: "Return rates, defaults, dependencies, and impacts for a trusted productId." },
      ],
      execute: jest.fn(async ({ toolName, arguments: args }: any) => {
        if (toolName === "search.global") return { toolName, status: "succeeded", result: { status: "succeeded", data: { products: [{ id: productId, label: "Translucent Vinyl - backlit with multilayer printing" }] }, provenance: { sourceLinks: [{ label: "Translucent Vinyl - backlit with multilayer printing", href: `/products/${productId}/edit`, entityType: "product", entityId: productId, capturedAt: "2026-08-10T00:00:00.000Z" }], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } };
        if (toolName === "products.get_summary") {
          expect(args).toEqual({ productId });
          return { toolName, status: "succeeded", result: { status: "succeeded", data: { product: { recordId: productId, label: "Translucent Vinyl - backlit with multilayer printing", entityType: "product" }, active: true, category: "Roll Printing" }, provenance: { sourceLinks: [{ label: "Translucent Vinyl - backlit with multilayer printing", href: `/products/${productId}/edit`, entityType: "product", entityId: productId, capturedAt: "2026-08-10T00:00:00.000Z" }], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } };
        }
        expect(toolName).toBe("products.get_pricing");
        expect(args).toEqual({ productId });
        return { toolName, status: "succeeded", result: { status: "succeeded", data: { product: { recordId: productId, label: "Translucent Vinyl - backlit with multilayer printing", entityType: "product" }, active: true, pricing: { status: "configuration", lifecycle: "DRAFT", configuration: { baseRates: { perSquareFootCents: 500 }, options: [{ label: "Layers", defaultSelection: "5 Layer", choices: [{ label: "3 Layer", pricingImpactSummary: "$4.00 per sq ft" }, { label: "5 Layer", pricingImpactSummary: "$5.00 per sq ft" }] }, { label: "Contour Cutting", defaultSelection: "No", choices: [{ label: "Yes", pricingImpactSummary: "+10% of base" }] }, { label: "Weeding and Taping", defaultSelection: "No", availableWhen: { optionGroup: "Contour Cutting", value: "Yes" }, choices: [{ label: "Yes", pricingImpactSummary: "+20% of base; +30% total when Contour Cutting is Yes" }] }] } } }, provenance: { sourceLinks: [{ label: "Translucent Vinyl - backlit with multilayer printing", href: `/products/${productId}/edit`, entityType: "product", entityId: productId, capturedAt: "2026-08-10T00:00:00.000Z" }], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } };
      }),
    };
    const provider = { decide: jest.fn(async ({ goal, observations, task }: any) => {
      if (goal.startsWith("Look up")) {
        if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "search.global", arguments: { query: "Translucent Vinyl - backlit with multilayer printing" } }] };
        if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "products.get_summary", arguments: { productId } }] };
        if (observations.length === 2) return { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { productId } }] };
        return { kind: "complete", response: "The active Translucent Vinyl product has current PBV2 DRAFT pricing: 3 Layer is $4 and 5 Layer is $5 per square foot; 5 Layer defaults, Contour defaults to No and adds 10%, and Weed/Tape defaults to No and is available only with Contour Yes for a 30% combined total impact." };
      }
      expect(task.entityReferences).toEqual(expect.arrayContaining([expect.objectContaining({ type: "product", id: productId })]));
      return observations.length
        ? { kind: "complete", response: "The same product uses the trusted current PBV2 pricing configuration." }
        : { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { productId } }] };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, undefined, () => provider, tasks, undefined, () => executor as any, operatorProviderResolver as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff", "assistant.finance.read"] }, { message: "Look up the Translucent Vinyl - backlit with multilayer printing product we just created and show me its current pricing, defaults, and option dependencies.", context });
    expect(tasks.updates.at(-1).patch).toEqual(expect.objectContaining({ domain: "products", status: "active", entityReferences: expect.arrayContaining([expect.objectContaining({ type: "product", id: productId })]) }));

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.internal_staff", "assistant.finance.read"] }, { message: "That's the product I'm talking about. Show me its pricing.", context });
    expect(executor.execute.mock.calls.map(([call]: any[]) => call.toolName)).toEqual(["search.global", "products.get_summary", "products.get_pricing", "products.get_pricing"]);
    expect(repo.createFoundationTurn).toHaveBeenLastCalledWith(expect.objectContaining({ response: "The same product uses the trusted current PBV2 pricing configuration.", mode: "ai_operator_runtime" }));
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
