import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

let AssistantService: any;
let AssistantServiceError: any;
let ASSISTANT_UNAVAILABLE_REPLY: string;
let responseStateForCards: any;
let titleFromMessage: any;
let assistantCapabilityCommandPermissions: any;
let assistantCapabilityCommandDescriptions: any;

beforeAll(async () => {
  const module = await import("../services/assistant/assistantService");
  AssistantService = module.AssistantService;
  AssistantServiceError = module.AssistantServiceError;
  ASSISTANT_UNAVAILABLE_REPLY = module.ASSISTANT_UNAVAILABLE_REPLY;
  responseStateForCards = module.responseStateForCards;
  titleFromMessage = module.titleFromMessage;
  const capabilities = await import("../services/assistant/assistantCapabilities");
  assistantCapabilityCommandPermissions = capabilities.assistantCapabilityCommandPermissions;
  assistantCapabilityCommandDescriptions = capabilities.assistantCapabilityCommandDescriptions;
});

const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null };
const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1",
  route: "/orders/order_1",
  pageTitle: "Order",
  entityType: "order",
  entityId: "order_1",
  selectedRecordIds: [],
  activeFilters: [],
  capturedAt: "2026-07-21T12:00:00.000Z",
  unsavedChanges: false,
});

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conversation_1",
    organizationId: "org_1",
    userId: "user_1",
    title: "New conversation",
    status: "active",
    lastActivityAt: new Date("2026-07-21T12:00:00.000Z"),
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    updatedAt: new Date("2026-07-21T12:00:00.000Z"),
    messages: [],
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listConversations: jest.fn(async () => [makeConversation()]),
    createConversation: jest.fn(async () => makeConversation()),
    getConversation: jest.fn(async () => makeConversation()),
    updateConversation: jest.fn(async () => makeConversation({ status: "archived" })),
    createFoundationTurn: jest.fn(async (input: any) => ({
      turnId: "turn_1",
      correlationId: input.correlationId,
      conversation: makeConversation(),
      userMessage: { id: "message_user", conversationId: "conversation_1", turnId: "turn_1", role: "user", content: input.message, createdAt: new Date() },
      assistantMessage: { id: "message_assistant", conversationId: "conversation_1", turnId: "turn_1", role: "assistant", content: input.response, createdAt: new Date() },
    })),
    ...overrides,
  };
}

describe("AssistantService", () => {
  let resolver: { getCapabilities: jest.Mock };

  beforeEach(() => {
    resolver = { getCapabilities: jest.fn(async () => ({ enabled: true })) };
  });

  test("advertises disabled tools when no compatible provider is available", async () => {
    const service = new AssistantService(makeRepo(), resolver);

    await expect(service.getCapabilities(scope)).resolves.toEqual(expect.objectContaining({
      enabled: true,
      conversationsEnabled: true,
      toolsEnabled: false,
      writeActionsEnabled: false,
      externalResearchEnabled: false,
      actorScope: scope,
    }));
  });

  test("reports all reviewed commands and only the actor-permitted subset", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: true, toolsEnabled: true, providerConfigured: true });
    const service = new AssistantService(makeRepo(), resolver);

    const capability = await service.getCapabilities(scope, {
      ...actor,
      permissions: [
        "assistant.quotes.add_internal_note",
        "assistant.products.create_inactive_draft",
        "assistant.products.update_inactive_draft",
      ],
    });

    expect(capability.productionCommandsEnabled).toEqual(expect.arrayContaining([
      "quotes.add_internal_note",
      "products.create_inactive_draft",
      "products.update_inactive_draft",
    ]));
    expect(capability.productionCommandsPermittedForUser).toEqual([
      "quotes.add_internal_note",
      "products.create_inactive_draft",
      "products.update_inactive_draft",
    ]);
    expect(capability.composerHelperText).toBe("Business lookups and confirmed actions are enabled. Changes require a preview and the dedicated GO button. External research is disabled.");
    expect(capability).toMatchObject({
      providerConfigured: true,
      readToolsEnabled: true,
      writeFrameworkEnabled: true,
      writeActionsEnabled: true,
      productActivationEnabled: false,
      activeProductEditingEnabled: false,
      externalResearchEnabled: false,
      mcpEnabled: false,
      diagnosticsEnabled: false,
    });
    expect((await service.getCapabilities(scope, { ...actor, permissions: ["assistant.diagnostics.view"] })).diagnosticsEnabled).toBe(true);
  });

  test("advertises provider-native public research without requiring the server fallback key", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: true, toolsEnabled: true, providerConfigured: true, externalResearchEnabled: true });
    const capability = await new AssistantService(makeRepo(), resolver).getCapabilities(scope, actor);

    expect(capability).toMatchObject({ externalResearchEnabled: true, readToolsEnabled: true });
    expect(capability.composerHelperText).toBe("Business lookups and external research are enabled. Write actions require additional permission.");
  });

  test("keeps reviewed command permissions and capability wording explicit for inactive-draft updates", () => {
    expect(assistantCapabilityCommandPermissions["products.update_inactive_draft"])
      .toBe("assistant.products.update_inactive_draft");
    expect(assistantCapabilityCommandDescriptions["products.update_inactive_draft"])
      .toBe("update an inactive product draft after your confirmation");
    expect(assistantCapabilityCommandPermissions["products.update_inactive_draft"])
      .not.toBe(assistantCapabilityCommandPermissions["products.create_inactive_draft"]);
  });

  test("keeps successful capability answers and safe not-found results non-retryable", () => {
    expect(responseStateForCards([{ kind: "notice", title: "Assistant capabilities", body: "I can help.", tone: "info" }]))
      .toEqual({ kind: "success", retryable: false, diagnosticsAvailable: false });
    expect(responseStateForCards([{ kind: "not_found", title: "No matching order", summary: "Not found.", sourceLinks: [], toolStatus: "not_found" }]))
      .toEqual({ kind: "not_found", retryable: false, diagnosticsAvailable: false });
    expect(responseStateForCards([{ kind: "provider_unavailable", title: "Unavailable", summary: "Retry later.", sourceLinks: [], toolStatus: "failed" }]))
      .toEqual({ kind: "retryable_failure", retryable: true, diagnosticsAvailable: true });
    expect(responseStateForCards([{ kind: "product_validation_errors", title: "Canonical product intent needs correction", summary: "No new revision was created.", sourceLinks: [], details: { errors: ["Nothing was changed. Reference: pic-2957ab77-f9bc-4cc5-a18b-bfc8cb421aca"] } }]))
      .toEqual({ kind: "validation_error", retryable: false, diagnosticsAvailable: true });
  });

  test("derives safe, readable first-message conversation titles without provider input", () => {
    expect(titleFromMessage("Summarize this order.")).toBe("Current Order Summary");
    expect(titleFromMessage("Find order ORD 20002!")).toBe("Find Order ORD-20002");
    expect(titleFromMessage("Find customer T3 Signs.")).toBe("T3 Signs Lookup");
    expect(titleFromMessage("\u0000**Create** a product draft")).toBe("Product Draft Setup");
  });

  test("uses both organization and user scope when loading a conversation", async () => {
    const repo = makeRepo({ getConversation: jest.fn(async () => null) });
    const service = new AssistantService(repo, resolver);

    await expect(service.getConversation(scope, "conversation_other_user")).rejects.toMatchObject({
      code: "ASSISTANT_CONVERSATION_NOT_FOUND",
      statusCode: 404,
    });
    expect(repo.getConversation).toHaveBeenCalledWith({ ...scope, conversationId: "conversation_other_user" });
  });

  test("does not create a turn while the organization kill switch is disabled", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: false, unavailableReason: "Disabled" });
    const repo = makeRepo();
    const service = new AssistantService(repo, resolver);

    await expect(service.createTurn(scope, "conversation_1", actor, { message: "Help", context })).rejects.toBeInstanceOf(AssistantServiceError);
    expect(repo.createFoundationTurn).not.toHaveBeenCalled();
  });

  test("persists a provider-unavailable turn without invoking a domain tool", async () => {
    const repo = makeRepo();
    const service = new AssistantService(repo, resolver);

    const result = await service.createTurn(scope, "conversation_1", actor, { message: "What orders are late?", context });

    expect(repo.createFoundationTurn).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      message: "What orders are late?",
      context,
      response: ASSISTANT_UNAVAILABLE_REPLY,
      initialTitle: "What orders are late",
      correlationId: expect.any(String),
    }));
    expect(result.assistantMessage.content).toBe(ASSISTANT_UNAVAILABLE_REPLY);
  });

  test("classifies a response persistence failure separately from a lookup failure", async () => {
    const repo = makeRepo({ createFoundationTurn: jest.fn(async () => { throw new Error("database unavailable"); }) });
    const service = new AssistantService(repo, resolver);

    await expect(service.createTurn(scope, "conversation_1", actor, { message: "What orders are late?", context }))
      .rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_PERSISTENCE_FAILED", statusCode: 503 });
  });

  test("context contract rejects oversized selected-record scope", () => {
    expect(() => assistantContextEnvelopeSchema.parse({
      ...context,
      selectedRecordIds: Array.from({ length: 26 }, (_, index) => `record_${index}`),
    })).toThrow();
  });
});
