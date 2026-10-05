import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import type { MaterialTaskTransition } from "../services/assistant/operatorTaskContext";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

const scope = { organizationId: "org_1", userId: "user_1" };
const actor = { userId: "user_1", email: "user@example.test", ipAddress: null, userAgent: null, permissions: ["assistant.materials.create"] };
const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/materials", pageTitle: "Materials", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const details = "Digitech TruFire KSJ Ink. It comes in Cyan, Magenta, Yellow, Black and White. It costs $130 per liter and I get it from Digitech.";

function candidate(sourceMessage = details) {
  const sourced = (value: string) => {
    const start = sourceMessage.indexOf(value);
    return { value, span: { start, end: start + value.length } };
  };
  const supplier = sourceMessage.lastIndexOf("Digitech");
  return {
    familyName: sourced("Digitech TruFire KSJ Ink"),
    dimension: { key: "color", displayName: { value: "Color", span: { start: sourceMessage.indexOf("comes in"), end: sourceMessage.indexOf("White") + 5 } } },
    colors: ["Cyan", "Magenta", "Yellow", "Black", "White"].map(sourced),
    supplier: { value: "Digitech", span: { start: supplier, end: supplier + 8 } },
    price: { amount: 130, unit: "liter", span: sourced("$130 per liter").span }, sku: null,
  };
}

function fixture() {
  const conversation: any = { id: "conversation_1", organizationId: "org_1", userId: "user_1", title: "New", status: "active", lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(), messages: [] };
  const task: any = { id: "task_1", ...scope, conversationId: conversation.id, domain: null, goal: "Can you add a material for me?", workingSummary: null, entityReferences: [], missingInformation: [], semanticChanges: {}, confirmationState: "none", status: "active", canonicalProductIntentProposalId: null, lastObservationSummary: null };
  let failNextCommit = false;
  let beforeCommit: (() => void) | null = null;
  let sequence = 0;
  const taskStore = {
    getActive: jest.fn(async () => task), create: jest.fn(async () => task),
    update: jest.fn(async () => { throw new Error("Material task updates must use the turn transaction."); }),
  };
  // This is an injected repository transaction seam, not a fake SQL executor:
  // stage task and messages, then commit together only after the CAS succeeds.
  const repository = {
    getConversation: jest.fn(async () => ({ ...conversation, messages: conversation.messages.slice(0, 500) })),
    getLatestAssistantMessage: jest.fn(async (input: typeof scope & { conversationId: string }) => {
      if (input.organizationId !== scope.organizationId || input.userId !== scope.userId || input.conversationId !== conversation.id) return null;
      return [...conversation.messages].reverse().find((message: any) => message.role === "assistant") ?? null;
    }),
    createFoundationTurn: jest.fn(async (input: any) => {
      const transition = input.materialTaskTransition as MaterialTaskTransition | undefined;
      if (!transition) throw new Error("Missing atomic Material transition");
      const commitHook = beforeCommit;
      beforeCommit = null;
      commitHook?.();
      const current = task.semanticChanges.materialPendingReviewV1;
      const latest = [...conversation.messages].reverse().find((message: any) => message.role === "assistant");
      if (transition.taskId !== task.id || task.status !== "active" || (transition.expectedQuestion
        ? current?.questionId !== transition.expectedQuestion.questionId || current?.version !== transition.expectedQuestion.version
          || latest?.content !== transition.expectedQuestion.content || latest?.correlationId !== transition.expectedQuestion.correlationId
        : current != null)) {
        throw Object.assign(new Error("stale question"), { code: "MATERIAL_TASK_TRANSITION_STALE" });
      }
      const id = sequence + 1;
      const userMessage = { id: `user_${id}`, conversationId: conversation.id, turnId: `turn_${id}`, role: "user", content: input.message, createdAt: new Date() };
      const assistantMessage = { id: `assistant_${id}`, conversationId: conversation.id, turnId: `turn_${id}`, role: "assistant", content: input.response, structuredCards: input.structuredCards, correlationId: input.correlationId, createdAt: new Date() };
      if (failNextCommit) { failNextCommit = false; throw new Error("transaction rolled back"); }
      Object.assign(task, transition.patch);
      conversation.messages.push(userMessage, assistantMessage);
      sequence = id;
      return { turnId: `turn_${id}`, correlationId: input.correlationId, status: input.status, conversation, userMessage, assistantMessage };
    }),
  };
  const provider = { decide: jest.fn(async () => ({ kind: "ask_user" as const, question: "Should I set this up as a Material Family?", missingInformation: ["confirmation"], clarification: { kind: "binary_confirmation" as const }, materialCandidate: candidate() })) };
  const semanticExecutor = (_audit: unknown, tools: readonly any[]) => ({ catalog: () => tools.map((tool) => ({ name: tool.name, description: tool.description })), execute: async ({ toolName, arguments: args, context: trusted }: any) => {
    const tool = tools.find((item) => item.name === toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    return { toolName, ...(await tool.execute({ arguments: args, context: trusted })) };
  } });
  const resolver = { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://example.test", apiKey: "test", model: "test" })) };
  return { conversation, task, taskStore, repository, provider, semanticExecutor, resolver, failOnce: () => { failNextCommit = true; }, beforeCommit: (hook: () => void) => { beforeCommit = hook; } };
}

describe("Material question transactional checkpoint", () => {
  test("bare affirmative without a verified pending question never invokes Material preparation", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    const result = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(result.assistantMessage.content).toContain("no verified Material question");
    expect(result.assistantMessage.structuredCards).toEqual([]);
    expect(f.provider.decide).not.toHaveBeenCalled();
    expect(f.task.semanticChanges).toEqual({});
    expect(f.conversation.messages).toHaveLength(2);
    expect(f.taskStore.update).not.toHaveBeenCalled();
  });

  test("an explicit Material review supersedes a retained Product proposal on the next yes", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    f.task.goal = "Create a Product";
    f.task.domain = "products";
    f.task.canonicalProductIntentProposalId = "older_product_proposal";
    const materialRequest = `Please add a Material Family. ${details}`;
    f.provider.decide.mockImplementation(async ({ goal }: any) => {
      if (goal === "yes") throw new Error("A verified Material yes must not enter Product or provider planning");
      return { kind: "ask_user", question: "Should I set this up as a five-color Material Family?", missingInformation: ["confirmation"], clarification: { kind: "binary_confirmation" }, materialCandidate: candidate(goal) };
    });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    const question = await service.createTurn(scope, "conversation_1", actor, { message: materialRequest, context });
    expect(question.assistantMessage.content).toContain("Material Family named 'Digitech TruFire KSJ Ink'");
    expect(f.task.domain).toBe("materials");
    expect(f.task.canonicalProductIntentProposalId).toBe("older_product_proposal");
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_confirmation" });
    const answer = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(answer.assistantMessage.content).toContain("What SKU should I use for each color");
    expect(answer.assistantMessage.structuredCards).toEqual([]);
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_skus" });
    expect(f.provider.decide).toHaveBeenCalledTimes(1);
  });

  test.each(["Create a Product called Cyan Banner", "Continue the Product draft", "Update the Product draft", "Update the Product draft to use Material X"])("'%s' supersedes a pending Material review before Product yes", async (productRequest) => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { startMaterialPendingReview } = await import("../services/assistant/materialPendingReview");
    const f = fixture();
    f.task.domain = "materials";
    if (productRequest !== "Create a Product called Cyan Banner") f.task.canonicalProductIntentProposalId = "older_product_proposal";
    const review = startMaterialPendingReview({ candidate: candidate(), sourceMessage: details,
      question: "Should I set up this Material Family?", conversationId: f.conversation.id, taskId: f.task.id, correlationId: "prior_material_question" });
    f.task.semanticChanges.materialPendingReviewV1 = review;
    f.conversation.messages.push({ id: "assistant_material_question", turnId: "turn_material_question", role: "assistant", content: review.question, correlationId: review.correlationId, createdAt: new Date() });
    f.provider.decide.mockImplementation(async ({ goal }: any) => goal === "yes"
      ? { kind: "complete", response: "The Product configuration can continue through its existing workflow." }
      : { kind: "ask_user", question: "What size should the new Product use?", missingInformation: ["size"], clarification: { kind: "single_field" } });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    if (productRequest === "Continue the Product draft") {
      f.failOnce();
      await expect(service.createTurn(scope, "conversation_1", actor, { message: productRequest, context })).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_PERSISTENCE_FAILED" });
      expect(f.task.domain).toBe("materials");
      expect(f.task.semanticChanges.materialPendingReviewV1).toEqual(review);
      expect(f.conversation.messages).toHaveLength(1);
    }
    const question = await service.createTurn(scope, "conversation_1", actor, { message: productRequest, context });
    expect(question.assistantMessage.content).toContain("Product use");
    expect(f.task.domain).toBe("products");
    expect(f.task.semanticChanges.materialPendingReviewV1).toBeNull();
    f.taskStore.update.mockImplementation(async ({ patch }: any) => { Object.assign(f.task, patch); return f.task; });
    f.repository.createFoundationTurn.mockImplementation(async (input: any) => {
      if (input.materialTaskTransition) throw new Error("Product follow-up must not use the Material checkpoint");
      const turnId = `turn_product_${f.conversation.messages.length}`;
      const userMessage = { id: `user_${turnId}`, conversationId: f.conversation.id, turnId, role: "user", content: input.message, createdAt: new Date() };
      const assistantMessage = { id: `assistant_${turnId}`, conversationId: f.conversation.id, turnId, role: "assistant", content: input.response, structuredCards: input.structuredCards, correlationId: input.correlationId, createdAt: new Date() };
      f.conversation.messages.push(userMessage, assistantMessage);
      return { turnId, correlationId: input.correlationId, status: input.status, conversation: f.conversation, userMessage, assistantMessage };
    });
    const answer = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(answer.assistantMessage.content).toContain("Product configuration");
    expect(f.provider.decide).toHaveBeenCalledTimes(productRequest === "Continue the Product draft" ? 3 : 2);
  });

  test("an invalid pending Material review cannot fall back to a retained Product proposal", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    f.task.domain = "materials";
    f.task.canonicalProductIntentProposalId = "older_product_proposal";
    f.task.semanticChanges.materialPendingReviewV1 = { version: 1, questionId: "malformed_question", status: "awaiting_confirmation" };
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    await expect(service.createTurn(scope, "conversation_1", actor, { message: "yes", context })).rejects.toMatchObject({ code: "MATERIAL_TASK_TRANSITION_STALE" });
    expect(f.provider.decide).not.toHaveBeenCalled();
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ questionId: "malformed_question" });
    expect(f.conversation.messages).toHaveLength(0);
  });

  test("a negated Product-draft mention cannot discard a pending ink review", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { startMaterialPendingReview } = await import("../services/assistant/materialPendingReview");
    const f = fixture();
    f.task.domain = "materials";
    f.task.canonicalProductIntentProposalId = "older_product_proposal";
    const review = startMaterialPendingReview({ candidate: candidate(), sourceMessage: details,
      question: "Should I set up this Material Family?", conversationId: f.conversation.id, taskId: f.task.id, correlationId: "material_question" });
    f.task.semanticChanges.materialPendingReviewV1 = review;
    f.conversation.messages.push({ id: "assistant_material_question", turnId: "turn_material_question", role: "assistant", content: review.question, correlationId: review.correlationId, createdAt: new Date() });
    f.provider.decide.mockImplementation(async () => { throw new Error("Material correction must not enter Product planning"); });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    const result = await service.createTurn(scope, "conversation_1", actor, { message: "Continue the ink review, not the Product draft", context });
    expect(result.assistantMessage.content).toContain("Material Family");
    expect(f.task.domain).toBe("materials");
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_confirmation" });
    expect(f.provider.decide).not.toHaveBeenCalled();
  });

  test("a later pickup confirmation is not intercepted by the original Material task goal", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    f.task.domain = "materials";
    f.taskStore.update.mockImplementation(async ({ patch }: any) => { Object.assign(f.task, patch); return f.task; });
    f.repository.createFoundationTurn.mockImplementation(async (input: any) => {
      if (input.materialTaskTransition) throw new Error("Pickup must not use the Material checkpoint");
      const turnId = "turn_pickup";
      const userMessage = { id: "user_pickup", conversationId: f.conversation.id, turnId, role: "user", content: input.message, createdAt: new Date() };
      const assistantMessage = { id: "assistant_pickup", conversationId: f.conversation.id, turnId, role: "assistant", content: input.response, structuredCards: input.structuredCards, correlationId: input.correlationId, createdAt: new Date() };
      f.conversation.messages.push(userMessage, assistantMessage);
      return { turnId, correlationId: input.correlationId, status: input.status, conversation: f.conversation, userMessage, assistantMessage };
    });
    const order = { type: "order", id: "order_fixture" };
    const orderLine = { type: "order_line", id: "line_fixture" };
    const fulfillment = { type: "fulfillment", id: "order_fixture" };
    f.task.semanticChanges = {
      activeResourceContext: { resources: [order, orderLine, fulfillment], capturedAt: "2026-10-05T12:00:00.000Z" },
      pendingActionContext: { action: "fulfillment_pickup", order, orderLine, fulfillment, quantity: 500, timing: "today", confirmation: "awaiting_binary_confirmation" },
    };
    f.provider.decide.mockImplementation(async ({ task }: any) => {
      expect(task.pendingAction).toMatchObject({ action: "fulfillment_pickup", confirmation: "confirmed", quantity: 500 });
      return { kind: "complete", response: "The pickup remains in the existing fulfillment confirmation flow." };
    });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    const result = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(result.assistantMessage.content).toContain("pickup remains");
    expect(f.provider.decide).toHaveBeenCalled();
    expect(f.task.semanticChanges.pendingActionContext).toMatchObject({ action: "fulfillment_pickup", confirmation: "confirmed" });
    expect(f.task.semanticChanges.materialPendingReviewV1).toBeNull();
  });

  test("a pickup ask_user then yes stays in fulfillment after an original Material request", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    f.task.domain = "materials";
    f.taskStore.update.mockImplementation(async ({ patch }: any) => { Object.assign(f.task, patch); return f.task; });
    f.repository.createFoundationTurn.mockImplementation(async (input: any) => {
      if (input.materialTaskTransition) throw new Error("Pickup must not use the Material checkpoint");
      const turnId = `turn_${f.conversation.messages.length / 2 + 1}`;
      const userMessage = { id: `user_${turnId}`, conversationId: f.conversation.id, turnId, role: "user", content: input.message, createdAt: new Date() };
      const assistantMessage = { id: `assistant_${turnId}`, conversationId: f.conversation.id, turnId, role: "assistant", content: input.response, structuredCards: input.structuredCards, correlationId: input.correlationId, createdAt: new Date() };
      f.conversation.messages.push(userMessage, assistantMessage);
      return { turnId, correlationId: input.correlationId, status: input.status, conversation: f.conversation, userMessage, assistantMessage };
    });
    const order = { type: "order", id: "order_fixture" };
    const orderLine = { type: "order_line", id: "line_fixture" };
    const fulfillment = { type: "fulfillment", id: "order_fixture" };
    f.task.semanticChanges = { activeResourceContext: {
      resources: [order, orderLine, fulfillment], capturedAt: "2026-10-05T12:00:00.000Z",
    } };
    f.provider.decide.mockImplementation(async ({ goal, task }: any) => {
      expect(task.pendingAction).toMatchObject({ action: "fulfillment_pickup", quantity: 500, timing: "today" });
      return goal === "yes"
        ? { kind: "complete", response: "The pickup remains in the existing fulfillment workflow." }
        : { kind: "ask_user", question: "Record another 500-piece pickup today?", missingInformation: ["confirmation"], clarification: { kind: "binary_confirmation" } };
    });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    const question = await service.createTurn(scope, "conversation_1", actor, { message: "Add another pickup of 500 pieces today.", context });
    expect(question.assistantMessage.content).toBe("Record another 500-piece pickup today?");
    expect(f.task.semanticChanges.pendingActionContext).toMatchObject({ action: "fulfillment_pickup", confirmation: "awaiting_binary_confirmation" });
    const answer = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(answer.assistantMessage.content).toContain("pickup remains");
    expect(f.task.semanticChanges.pendingActionContext).toMatchObject({ action: "fulfillment_pickup", confirmation: "confirmed" });
    expect(f.task.semanticChanges.materialPendingReviewV1).toBeNull();
    expect(f.provider.decide).toHaveBeenCalledTimes(2);
    expect(f.repository.createFoundationTurn.mock.calls.every(([input]: any[]) => !input.materialTaskTransition)).toBe(true);
  });

  test("a failed switch from a Material question to pickup preserves the question until commit", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { startMaterialPendingReview } = await import("../services/assistant/materialPendingReview");
    const f = fixture();
    f.task.domain = "materials";
    const order = { type: "order", id: "order_fixture" };
    const orderLine = { type: "order_line", id: "line_fixture" };
    const fulfillment = { type: "fulfillment", id: "order_fixture" };
    const review = startMaterialPendingReview({ candidate: candidate(), sourceMessage: details,
      question: "Should I set up this Material Family?", conversationId: f.conversation.id, taskId: f.task.id, correlationId: "prior_material_question" });
    f.task.semanticChanges = {
      activeResourceContext: { resources: [order, orderLine, fulfillment], capturedAt: "2026-10-05T12:00:00.000Z" },
      materialPendingReviewV1: review,
    };
    f.conversation.messages.push({ id: "assistant_material_question", turnId: "turn_material_question", role: "assistant", content: review.question, correlationId: review.correlationId, createdAt: new Date() });
    f.provider.decide.mockImplementation(async ({ goal }: any) => goal === "yes"
      ? { kind: "complete", response: "The pickup remains in the existing fulfillment workflow." }
      : { kind: "ask_user", question: "Record another 500-piece pickup today?", missingInformation: ["confirmation"], clarification: { kind: "binary_confirmation" } });
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    f.failOnce();
    await expect(service.createTurn(scope, "conversation_1", actor, { message: "Add another pickup of 500 pieces today.", context })).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_PERSISTENCE_FAILED" });
    expect(f.task.semanticChanges.materialPendingReviewV1).toEqual(review);
    expect(f.conversation.messages).toHaveLength(1);
    const question = await service.createTurn(scope, "conversation_1", actor, { message: "Add another pickup of 500 pieces today.", context });
    expect(question.assistantMessage.content).toContain("pickup today");
    expect(f.task.semanticChanges.materialPendingReviewV1).toBeNull();
    expect(f.task.semanticChanges.pendingActionContext).toMatchObject({ action: "fulfillment_pickup", confirmation: "awaiting_binary_confirmation" });
    f.taskStore.update.mockImplementation(async ({ patch }: any) => { Object.assign(f.task, patch); return f.task; });
    f.repository.createFoundationTurn.mockImplementation(async (input: any) => {
      if (input.materialTaskTransition) throw new Error("Confirmed pickup must not use a Material checkpoint");
      const turnId = "turn_confirmed_pickup";
      const userMessage = { id: "user_confirmed_pickup", conversationId: f.conversation.id, turnId, role: "user", content: input.message, createdAt: new Date() };
      const assistantMessage = { id: "assistant_confirmed_pickup", conversationId: f.conversation.id, turnId, role: "assistant", content: input.response, structuredCards: input.structuredCards, correlationId: input.correlationId, createdAt: new Date() };
      f.conversation.messages.push(userMessage, assistantMessage);
      return { turnId, correlationId: input.correlationId, status: input.status, conversation: f.conversation, userMessage, assistantMessage };
    });
    const answer = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(answer.assistantMessage.content).toContain("pickup remains");
    expect(f.task.semanticChanges.pendingActionContext).toMatchObject({ action: "fulfillment_pickup", confirmation: "confirmed" });
  });

  test("failed question persistence leaves no advanced task; retry commits both", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    f.failOnce();
    await expect(service.createTurn(scope, "conversation_1", actor, { message: details, context })).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_PERSISTENCE_FAILED" });
    expect(f.conversation.messages).toHaveLength(0);
    expect(f.task.semanticChanges).toEqual({});
    expect(f.task.missingInformation).toEqual([]);
    const committed = await service.createTurn(scope, "conversation_1", actor, { message: details, context });
    expect(committed.status).toBe("responded");
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_confirmation", version: 1 });
    expect(f.task.missingInformation).toEqual(["confirmation"]);
    expect(f.conversation.messages).toHaveLength(2);
    expect(f.taskStore.update).not.toHaveBeenCalled();
  });

  test("repeated invalid replies keep one bounded recoverable Material question", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { MATERIAL_REVIEW_KEY, readMaterialPendingReview } = await import("../services/assistant/materialPendingReview");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    await service.createTurn(scope, "conversation_1", actor, { message: details, context });
    for (let index = 0; index < 15; index++) {
      const response = await service.createTurn(scope, "conversation_1", actor, { message: "maybe", context });
      const review = readMaterialPendingReview(f.task.semanticChanges, f.conversation.id, f.task.id);
      expect(review).not.toBeNull();
      expect(review?.question.length).toBeLessThanOrEqual(1_000);
      expect(review?.question).toBe(response.assistantMessage.content);
      expect(f.task.semanticChanges[MATERIAL_REVIEW_KEY]).toMatchObject({ status: "awaiting_confirmation" });
    }
    const confirmed = await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(confirmed.assistantMessage.content).toContain("What SKU should I use for each color");
    expect(confirmed.assistantMessage.structuredCards).toEqual([]);
  });

  test("failed yes persistence retains the visible confirmation and replay advances it once", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    await service.createTurn(scope, "conversation_1", actor, { message: details, context });
    const reviewBefore = structuredClone(f.task.semanticChanges.materialPendingReviewV1);
    const visibleBefore = f.conversation.messages[1].content;
    f.failOnce();
    await expect(service.createTurn(scope, "conversation_1", actor, { message: "yes", context })).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_PERSISTENCE_FAILED" });
    expect(f.task.semanticChanges.materialPendingReviewV1).toEqual(reviewBefore);
    expect(f.task.missingInformation).toEqual(["confirmation"]);
    expect(f.conversation.messages).toHaveLength(2);
    expect(f.conversation.messages[1].content).toBe(visibleBefore);
    await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_skus", version: reviewBefore.version + 1 });
    expect(f.task.semanticChanges.materialPendingReviewV1.correlationId).toBe(f.conversation.messages[3].correlationId);
    expect(f.conversation.messages).toHaveLength(4);
    expect(f.taskStore.update).not.toHaveBeenCalled();
  });

  test("concurrent same-question replies produce one new question and one Material proposal", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const { assistantMaterialActionService } = await import("../services/assistant/materialActionService");
    const { materialFamilyCreationService } = await import("../services/materialFamilyCreation.service");
    const f = fixture();
    const findFamily = jest.spyOn(materialFamilyCreationService, "findFamilyByExactName").mockResolvedValue(null);
    const execute = jest.spyOn(assistantMaterialActionService, "execute");
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    try {
      await service.createTurn(scope, "conversation_1", actor, { message: details, context });
      const expectedQuestion = f.task.semanticChanges.materialPendingReviewV1.questionId;
      const outcomes = await Promise.allSettled([service.createTurn(scope, "conversation_1", actor, { message: "yes", context }), service.createTurn(scope, "conversation_1", actor, { message: "yes", context })]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_skus", version: 2 });
      expect(f.task.semanticChanges.materialPendingReviewV1.questionId).not.toBe(expectedQuestion);
      expect(f.task.semanticChanges.materialPendingReviewV1.correlationId).toBe(f.conversation.messages[3].correlationId);
      expect(f.conversation.messages).toHaveLength(4);
      expect(f.conversation.messages[3].structuredCards).toEqual([]);
      const skus = "Cyan: INK-C\nMagenta: INK-M\nYellow: INK-Y\nBlack: INK-K\nWhite: INK-W";
      const prepared = await Promise.allSettled([service.createTurn(scope, "conversation_1", actor, { message: skus, context }), service.createTurn(scope, "conversation_1", actor, { message: skus, context })]);
      expect(prepared.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(prepared.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(f.conversation.messages).toHaveLength(6);
      expect(f.conversation.messages[5].structuredCards).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "action_proposal" })]));
      expect(execute).not.toHaveBeenCalled();
      expect(f.taskStore.update).not.toHaveBeenCalled();
    } finally {
      findFamily.mockRestore();
      execute.mockRestore();
    }
  });

  test("latest assistant identity is scoped and exact even beyond the first 500 messages", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    for (let index = 0; index < 500; index++) f.conversation.messages.push({ id: `old_${index}`, role: "assistant", content: `Old question ${index}`, correlationId: `old_${index}` });
    await service.createTurn(scope, "conversation_1", actor, { message: details, context });
    expect(f.repository.getLatestAssistantMessage).not.toHaveBeenCalled();
    const question = f.task.semanticChanges.materialPendingReviewV1.question;
    const expectedCorrelation = f.task.semanticChanges.materialPendingReviewV1.correlationId;
    expect(question).toBe(f.conversation.messages[501].content);
    expect(expectedCorrelation).toBe(f.conversation.messages[501].correlationId);
    await service.createTurn(scope, "conversation_1", actor, { message: "yes", context });
    expect(f.repository.getLatestAssistantMessage).toHaveBeenCalledWith({ ...scope, conversationId: "conversation_1" });
    expect(f.task.semanticChanges.materialPendingReviewV1).toMatchObject({ status: "awaiting_skus", correlationId: f.conversation.messages[503].correlationId });

    f.conversation.messages.push({ id: "competing", role: "assistant", content: f.task.semanticChanges.materialPendingReviewV1.question, correlationId: "different-turn" });
    const before = structuredClone(f.task.semanticChanges);
    await expect(service.createTurn(scope, "conversation_1", actor, { message: "Cyan: INK-C", context })).rejects.toMatchObject({ code: "MATERIAL_TASK_TRANSITION_STALE", statusCode: 409 });
    expect(f.task.semanticChanges).toEqual(before);
  });

  test("an intervening assistant commit after the latest read is refused inside the turn transaction", async () => {
    const { AssistantService } = await import("../services/assistant/assistantService");
    const f = fixture();
    const service = new AssistantService(f.repository as any, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined, () => f.provider as any, f.taskStore as any, undefined, f.semanticExecutor as any, f.resolver as any);
    await service.createTurn(scope, "conversation_1", actor, { message: details, context });
    const before = structuredClone(f.task.semanticChanges);
    f.beforeCommit(() => f.conversation.messages.push({ id: "intervening", role: "assistant", content: before.materialPendingReviewV1.question, correlationId: "other-turn" }));
    await expect(service.createTurn(scope, "conversation_1", actor, { message: "yes", context })).rejects.toMatchObject({ code: "MATERIAL_TASK_TRANSITION_STALE", statusCode: 409 });
    expect(f.task.semanticChanges).toEqual(before);
    expect(f.task.missingInformation).toEqual(["confirmation"]);
    expect(f.conversation.messages.filter((message: any) => message.content === "yes")).toHaveLength(0);
    expect(f.taskStore.update).not.toHaveBeenCalled();
  });
});
