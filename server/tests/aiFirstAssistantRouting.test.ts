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

  test("a normal product request cannot reach the legacy compiler adapter", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const product = {
      respondPlannedCanonicalProductIntent: jest.fn(),
      beginCanonicalProductDraft: jest.fn(async () => ({ handled: true, response: "I started an unfinished product draft.", cards: [{ kind: "canonical_product_intent_proposal", title: "Product", summary: "Needs details", sourceLinks: [], details: { proposalId: "proposal_1" } }] })),
      applyCanonicalProductOperations: jest.fn(),
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => {
      expect(toolCatalog.map((tool: { name: string }) => tool.name)).not.toContain("products.manage_intent");
      expect(toolCatalog.map((tool: { name: string }) => tool.name)).not.toContain("canonical_product_intent_compiler");
      return observations.length
        ? { kind: "complete", response: "I started an unfinished product draft.", workingSummary: "Draft started." }
        : { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: {} }] };
    }) };
    const legacyPlanner = { plan: jest.fn() };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, legacyPlanner as any, product, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);
    const message = "Create a new Translucent Vinyl product with a 3 mm hem.";

    await service.createTurn(scope, "conversation_1", actor, { message, context });

    expect(product.beginCanonicalProductDraft).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation_1" }));
    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ response: "I started an unfinished product draft.", mode: "ai_operator_runtime" }));
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

  test("an explicit existing Product rotation edit prepares the protected GO proposal without another clarification", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { existingProductEditService } = await import("../services/assistant/existingProductEditService");
    const repo = repository();
    const product = { beginCanonicalProductDraft: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
    const contextOnProduct = assistantContextEnvelopeSchema.parse({ ...context, route: "/products/product_1/edit", pageTitle: "Edit Product", entityType: "product", entityId: "product_1" });
    const operations = [{ op: "update_product_pricing_engine_configuration", changes: { allowRotation: true } }];
    const contextSpy = jest.spyOn(existingProductEditService, "trustedContext").mockResolvedValue({ name: "Coroplast", lifecycle: "active", pricingLifecycle: "ACTIVE", primaryMaterial: null, availableMaterials: [], optionGroups: [] });
    const proposalSpy = jest.spyOn(existingProductEditService, "buildProposal").mockResolvedValue({ productId: "product_1", productName: "Coroplast", productActive: true, sourceLifecycle: "PRODUCT", canonicalOperationReference: "products.update_pricing_engine_configuration.v1", expectedProductUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "Allow Rotation / Mixed Sheet Layout", before: "off", after: "on" }], fingerprint: "a".repeat(64) });
    const provider = { decide: jest.fn(async ({ observations, toolCatalog, task }: any) => {
      expect(task.businessContext.existingProduct).toMatchObject({ name: "Coroplast", pricingLifecycle: "ACTIVE" });
      expect(toolCatalog.map((tool: any) => tool.name)).toContain("products.apply_existing_operations");
      const inputSchema = toolCatalog.find((tool: any) => tool.name === "products.apply_existing_operations")?.inputSchema;
      expect(JSON.stringify(inputSchema)).toContain("update_product_pricing_engine_configuration");
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations } }] };
      return { kind: "complete", response: "Prepared the protected edit.", workingSummary: "Existing product edit prepared." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.create_inactive_draft", "assistant.products.update_existing_product"] }, { message: "Turn rotation on", context: contextOnProduct });

    expect(product.beginCanonicalProductDraft).not.toHaveBeenCalled();
    expect(proposalSpy).toHaveBeenCalledWith(expect.objectContaining({ productId: "product_1", operations: { operations } }));
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "action_proposal", plan: expect.objectContaining({ action: "products.update_existing_product", operations }) })]) }));
    contextSpy.mockRestore(); proposalSpy.mockRestore();
  });

  test("natural language conditional text-input work plans canonical PBV2 structures without a phrase handler", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { existingProductEditService } = await import("../services/assistant/existingProductEditService");
    const repo = repository(); const product = { beginCanonicalProductDraft: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
    const contextOnProduct = assistantContextEnvelopeSchema.parse({ ...context, route: "/products/product_1/edit", pageTitle: "Edit Product", entityType: "product", entityId: "product_1" });
    const contextSpy = jest.spyOn(existingProductEditService, "trustedContext").mockResolvedValue({ name: "Banner", lifecycle: "active", pricingLifecycle: "DRAFT", optionGroups: [{ label: "Grommets", selectionKey: "grommets", inputType: "select", required: false, defaultValue: "None", values: ["None", "Custom"], choices: [{ value: "none", label: "None" }, { value: "custom", label: "Custom" }] }] });
    const operations = [{ op: "update_pbv2_option_configuration", mutations: [{ kind: "add_input", group: "Finishing", input: { selectionKey: "grommet_placement_note", label: "Describe grommet placement", type: "textarea", required: true, visibilityRules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } }] }];
    const proposalSpy = jest.spyOn(existingProductEditService, "buildProposal").mockResolvedValue({ productId: "product_1", productName: "Banner", productActive: true, treeId: "tree_1", treeUpdatedAt: "2026-08-10T00:00:00.000Z", sourceLifecycle: "DRAFT", canonicalOperationReference: "products.update_option_configuration.v1", changes: [{ field: "Input Describe grommet placement", before: "(missing)", after: "textarea created" }], fingerprint: "b".repeat(64) });
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => {
      const tool = toolCatalog.find((candidate: any) => candidate.name === "products.apply_existing_operations");
      expect(JSON.stringify(tool?.inputSchema)).toContain("update_pbv2_option_configuration");
      expect(JSON.stringify(tool?.inputSchema)).not.toContain("set_option_default");
      return observations.length ? { kind: "complete", response: "Prepared the conditional text input." } : { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations } }] };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);
    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.update_existing_product"] }, { message: "When Grommets is Custom, add a text box asking where to place them.", context: contextOnProduct });
    expect(proposalSpy).toHaveBeenCalledWith(expect.objectContaining({ operations: { operations } }));
    expect(product.beginCanonicalProductDraft).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ structuredCards: expect.arrayContaining([expect.objectContaining({ plan: expect.objectContaining({ operations }) })]) }));
    contextSpy.mockRestore(); proposalSpy.mockRestore();
  });

  test("a same-turn canonical product read binds an existing-product mutation and blocks a blank draft", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { existingProductEditService } = await import("../services/assistant/existingProductEditService");
    const repo = repository();
    const product = { beginCanonicalProductDraft: jest.fn(), applyCanonicalProductOperations: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
    const contextSpy = jest.spyOn(existingProductEditService, "trustedContext").mockResolvedValue({ name: "Translucent Vinyl", lifecycle: "active", pricingLifecycle: "DRAFT", optionGroups: [{ label: "Layer", defaultValue: "5 Layer", values: ["3 Layer", "5 Layer"] }] });
    const proposalSpy = jest.spyOn(existingProductEditService, "buildProposal").mockResolvedValue({ productId: "product_1", productName: "Translucent Vinyl", productActive: true, treeId: "tree_1", treeUpdatedAt: "2026-08-10T00:00:00.000Z", changes: [{ field: "Layer default", before: "5 Layer", after: "3 Layer" }], fingerprint: "a".repeat(64) });
    const executor = (_audit: unknown, semanticTools: readonly any[]) => {
      const semantic = new Map(semanticTools.map((tool) => [tool.name, tool]));
      return {
        catalog: () => [...semanticTools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })), { name: "products.get_pricing", description: "Read one product's current configuration." }],
        execute: async ({ toolName, arguments: args, context: trusted }: any) => {
          if (toolName === "products.get_pricing") return {
            toolName,
            status: "succeeded",
            result: { status: "succeeded", data: { product: { recordId: "product_1", label: "Translucent Vinyl", status: "active" }, pricing: { status: "configuration" } }, provenance: { sourceLinks: [{ label: "Translucent Vinyl", href: "/products/product_1/edit", entityType: "product", entityId: "product_1" }], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } },
          };
          const tool = semantic.get(toolName);
          if (!tool) throw new Error(`Unexpected tool ${toolName}`);
          return { toolName, ...(await tool.execute({ arguments: args, context: trusted })) };
        },
      };
    };
    const provider = { decide: jest.fn(async ({ observations, toolCatalog }: any) => {
      expect(toolCatalog.map((tool: any) => tool.name)).toContain("products.apply_existing_operations");
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { query: "Translucent Vinyl" } }] };
      if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: {} }] };
      if (observations.length === 2) {
        expect(observations[1]).toMatchObject({ toolName: "products.begin_draft", status: "rejected" });
        return { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ op: "set_option_default", optionGroup: "Layer", value: "3 Layer" }] } }] };
      }
      return { kind: "complete", response: "Prepared the protected existing-product edit." };
    }) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks(), undefined, executor as any, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.create_inactive_draft", "assistant.products.update_existing_product"] }, { message: "Change the default Layer selection to 3 layer for Translucent Vinyl.", context });

    expect(product.beginCanonicalProductDraft).not.toHaveBeenCalled();
    expect(product.applyCanonicalProductOperations).not.toHaveBeenCalled();
    expect(proposalSpy).toHaveBeenCalledWith(expect.objectContaining({ productId: "product_1", operations: { operations: [{ op: "set_option_default", optionGroup: "Layer", value: "3 Layer" }] } }));
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ structuredCards: expect.arrayContaining([expect.objectContaining({ kind: "action_proposal", plan: expect.objectContaining({ action: "products.update_existing_product", productId: "product_1" }) })]) }));
    contextSpy.mockRestore(); proposalSpy.mockRestore();
  });

  test("an unresolved existing-product mutation cannot select an arbitrary product", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { existingProductEditService } = await import("../services/assistant/existingProductEditService");
    const repo = repository();
    const proposalSpy = jest.spyOn(existingProductEditService, "buildProposal").mockResolvedValue({} as any);
    const provider = { decide: jest.fn(async ({ observations }: any) => observations.length
      ? { kind: "complete", response: "Please identify the product to update." }
      : { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ op: "set_option_default", optionGroup: "Layer", value: "3 Layer" }] } }] }) };
    const product = { beginCanonicalProductDraft: jest.fn(), applyCanonicalProductOperations: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product as any, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", { ...actor, permissions: ["assistant.products.update_existing_product"] }, { message: "Change the default Layer selection to 3 layer.", context });

    expect(proposalSpy).not.toHaveBeenCalled();
    expect(product.beginCanonicalProductDraft).not.toHaveBeenCalled();
    proposalSpy.mockRestore();
  });

  test("an invalid operator decision fails safely without invoking a product mutation path", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const repo = repository();
    const product = { respondPlannedCanonicalProductIntent: jest.fn() };
    const provider = { decide: jest.fn(async () => ({ kind: "unsupported_decision" })) };
    const service = new AssistantService(repo as any, { getCapabilities: jest.fn(async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true })) }, undefined, undefined, undefined, undefined, product, () => provider, tasks(), undefined, undefined, operatorProviderResolver() as any);

    await service.createTurn(scope, "conversation_1", actor, { message: "Change a product.", context });

    expect(product.respondPlannedCanonicalProductIntent).not.toHaveBeenCalled();
    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: expect.stringMatching(/^operator_failed(?:_diagnostic_unavailable)?$/), response: "I couldn't complete the request because the AI Operator could not complete its investigation." }));
  });
});
