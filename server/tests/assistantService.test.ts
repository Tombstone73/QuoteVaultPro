import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

let AssistantService: any;
let AssistantServiceError: any;
let ASSISTANT_UNAVAILABLE_REPLY: string;
let resolveAssistantCapabilityQuestion: any;

beforeAll(async () => {
  const module = await import("../services/assistant/assistantService");
  AssistantService = module.AssistantService;
  AssistantServiceError = module.AssistantServiceError;
  ASSISTANT_UNAVAILABLE_REPLY = module.ASSISTANT_UNAVAILABLE_REPLY;
  resolveAssistantCapabilityQuestion = module.resolveAssistantCapabilityQuestion;
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

  test("reports only the two reviewed commands and the actor-permitted subset", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: true, toolsEnabled: true, providerConfigured: true });
    const service = new AssistantService(makeRepo(), resolver);

    const capability = await service.getCapabilities(scope, {
      ...actor,
      permissions: ["assistant.quotes.add_internal_note", "assistant.products.create_inactive_draft"],
    });

    expect(capability.productionCommandsEnabled).toEqual([
      "quotes.add_internal_note",
      "products.create_inactive_draft",
    ]);
    expect(capability.productionCommandsPermittedForUser).toEqual(capability.productionCommandsEnabled);
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

  test("answers capability questions locally from the server capability summary", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: true, toolsEnabled: true, providerConfigured: true });
    const service = new AssistantService(makeRepo(), resolver);
    const capability = await service.getCapabilities(scope, {
      ...actor,
      permissions: ["assistant.quotes.add_internal_note", "assistant.products.create_inactive_draft"],
    });

    expect(resolveAssistantCapabilityQuestion("What can you currently do?", capability)?.response)
      .toContain("help create an inactive product draft after your confirmation");
    expect(resolveAssistantCapabilityQuestion("What can you currently do?", capability)?.response)
      .not.toMatch(/GO actions|tool names|read-only result/i);
    expect(resolveAssistantCapabilityQuestion("What can't you do yet?", capability)?.response)
      .toContain("product activation remains disabled");
    expect(resolveAssistantCapabilityQuestion("Find order 20002", capability)).toBeNull();
  });

  test("explains missing write permission without advertising a read-only organization as mutable", async () => {
    resolver.getCapabilities.mockResolvedValue({ enabled: true, toolsEnabled: true, providerConfigured: true });
    const service = new AssistantService(makeRepo(), resolver);
    const capability = await service.getCapabilities(scope, { ...actor, permissions: ["catalog.read"] });

    expect(capability.writeActionsEnabled).toBe(false);
    expect(capability.composerHelperText).toBe("Business lookups are enabled. Write actions and external research are disabled.");
    expect(resolveAssistantCapabilityQuestion("What can't you do yet?", capability)?.response)
      .toContain("your current role is not permitted");
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
      correlationId: expect.any(String),
    }));
    expect(result.assistantMessage.content).toBe(ASSISTANT_UNAVAILABLE_REPLY);
  });

  test("context contract rejects oversized selected-record scope", () => {
    expect(() => assistantContextEnvelopeSchema.parse({
      ...context,
      selectedRecordIds: Array.from({ length: 26 }, (_, index) => `record_${index}`),
    })).toThrow();
  });
});
