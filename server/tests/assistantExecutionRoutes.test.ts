import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

// Route composition imports storage adapters, but registration itself must not
// connect to a database. A syntactically valid inert URL keeps this test local.
process.env.DATABASE_URL ??= "postgresql://assistant_registry_test:assistant_registry_test@127.0.0.1:5432/assistant_registry_test";

jest.unstable_mockModule("../tenantContext", () => ({ DEFAULT_ORGANIZATION_ID: "org_titan_001", getRequestOrganizationId: (req: any) => req.organizationId }));

let registerAssistantExecutionRoutes: any;
let ExecutionPlanError: any;

beforeAll(async () => {
  ({ registerAssistantExecutionRoutes } = await import("../routes/assistantExecution.routes"));
  ({ ExecutionPlanError } = await import("../services/assistant/execution/types"));
});

const NOW = new Date("2026-07-21T12:00:00.000Z");
const context = {
  contextVersion: "v1", route: "/orders/order_1", pageTitle: "Order", entityType: "order", entityId: "order_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: NOW.toISOString(), unsavedChanges: false,
};
const plan = {
  id: "plan_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", commandName: "test.command",
  commandVersion: "v1", normalizedAction: "test.command", sanitizedArguments: {}, contextHash: "a".repeat(64), permissionSnapshot: [], environment: "test",
  preview: { title: "Preview", summary: "Preview only", sideEffects: [], affectedRecords: [] }, affectedRecords: [], riskLevel: "low",
  status: "awaiting_confirmation", version: 2, idempotencyKey: "plan:plan_1", correlationId: "correlation_1",
  expiresAt: new Date("2026-07-21T12:10:00.000Z"), createdAt: NOW, updatedAt: NOW,
};

function service(overrides: Record<string, unknown> = {}) {
  return {
    getPlan: jest.fn(async () => plan),
    cancelPlan: jest.fn(async () => ({ ...plan, status: "cancelled", version: 3 })),
    confirmAndExecute: jest.fn(async () => ({ plan, result: undefined })),
    ...overrides,
  };
}

function app(executionService: any, options: { authenticated?: boolean; tenant?: boolean; orgId?: string; userId?: string; conversationRepository?: any } = {}) {
  const instance = express(); instance.use(express.json());
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) return res.sendStatus(401);
    req.user = { id: options.userId ?? "user_1" }; next();
  };
  const tenantContext = (req: any, res: any, next: any) => {
    if (options.tenant === false) return res.sendStatus(403);
    req.organizationId = options.orgId ?? "org_1"; req.orgRole = "member"; next();
  };
  // Route fallback must preserve a safe not-found response without reaching a
  // real composite service or its external transport during this local test.
  const compositeService = {
    getPlan: jest.fn(async () => { throw new ExecutionPlanError("PLAN_NOT_FOUND", "hidden"); }),
    confirmAndExecute: jest.fn(async () => { throw new ExecutionPlanError("PLAN_NOT_FOUND", "hidden"); }),
  };
  registerAssistantExecutionRoutes(instance, { isAuthenticated, tenantContext }, { service: executionService, compositeService: compositeService as any, ...(options.conversationRepository ? { conversationRepository: options.conversationRepository } : {}) });
  return instance;
}

describe("assistant execution-plan routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("requires authentication and tenant context", async () => {
    const fake = service();
    await request(app(fake, { authenticated: false })).get("/api/assistant/plans/plan_1").expect(401);
    await request(app(fake, { tenant: false })).get("/api/assistant/plans/plan_1").expect(403);
    expect(fake.getPlan).not.toHaveBeenCalled();
  });

  test("constructs the complete reviewed production registry while registering routes", () => {
    const instance = express();
    const isAuthenticated = (_req: any, _res: any, next: any) => next();
    const tenantContext = (_req: any, _res: any, next: any) => next();

    expect(() => registerAssistantExecutionRoutes(instance, { isAuthenticated, tenantContext })).not.toThrow();
  });

  test("does not accept browser-supplied executable command names", async () => {
    const fake = service();
    const response = await request(app(fake)).post("/api/assistant/conversations/conversation_1/plans")
      .send({ context, commandName: "orders.update_status" }).expect(400);
    expect(response.body.error.code).toBe("context_invalid");
    expect(fake.getPlan).not.toHaveBeenCalled();
  });

  test("normal runtime requires a server-created assistant turn rather than a browser command", async () => {
    const response = await request(app(service())).post("/api/assistant/conversations/conversation_1/plans").send({ context }).expect(409);
    expect(response.body.error.message).toMatch(/proposed assistant turn/i);
  });

  test("rehydrates an existing-Product lifecycle proposal into one reusable protected plan", async () => {
    const lifecyclePlan = { ...plan, commandName: "products.update_existing_product", normalizedAction: "products.update_existing_product", status: "preview_ready", version: 1 };
    const confirmedPlan = { ...lifecyclePlan, status: "awaiting_confirmation", version: 2 };
    const fake = service({
      createPlan: jest.fn(async () => lifecyclePlan),
      issueConfirmation: jest.fn(async () => ({ plan: confirmedPlan, token: "confirmation_token", expiresAt: confirmedPlan.expiresAt })),
    });
    const fingerprint = "a".repeat(64);
    const conversationRepository = { getConversation: jest.fn(async () => ({ messages: [
      { turnId: "turn_lifecycle", role: "user", content: "Make it inactive" },
      { turnId: "turn_lifecycle", role: "assistant", content: "Prepared", structuredCards: [{ kind: "action_proposal", plan: { action: "products.update_existing_product", productId: "product_1", operations: [{ op: "update_product_lifecycle", isActive: false }], proposalFingerprint: fingerprint } }] },
    ] })) };
    const response = await request(app(fake, { conversationRepository })).post("/api/assistant/conversations/conversation_1/plans").send({ turnId: "turn_lifecycle", context }).expect(201);
    expect(response.body.data).toMatchObject({ plan: { action: "products.update_existing_product", status: "awaiting_confirmation" }, confirmationToken: "confirmation_token" });
    expect(fake.createPlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      commandName: "products.update_existing_product",
      reuseAwaitingPlan: true,
      supersedeAwaitingProposal: { proposalId: "product_1", fingerprint },
    }));
    expect(fake.issueConfirmation).toHaveBeenCalledTimes(1);
  });

  test("reuses the exact reviewed Quote plan and restores its status without exposing a token", async () => {
    const fingerprint = "b".repeat(64);
    const quotePlan = { ...plan, turnId: "turn_quote", commandName: "quotes.create_draft", normalizedAction: "quotes.create_draft" };
    const fake = service({
      createPlan: jest.fn(async () => quotePlan),
      issueConfirmation: jest.fn(async () => ({ plan: quotePlan, token: "server_confirmation_token", expiresAt: quotePlan.expiresAt })),
      listConversationPlans: jest.fn(async () => [quotePlan]),
    });
    const conversationRepository = { getConversation: jest.fn(async ({ organizationId, userId }: any) => organizationId === "org_1" && userId === "user_1" ? { messages: [
      { turnId: "turn_quote", role: "user", content: "Prepare a QA Quote" },
      { turnId: "turn_quote", role: "assistant", content: "Review", structuredCards: [{ kind: "action_proposal", plan: { action: "quotes.create_draft", quoteIntakeSessionId: "session_qa", proposalFingerprint: fingerprint } }] },
    ] } : null) };
    const instance = app(fake, { conversationRepository });
    const created = await request(instance).post("/api/assistant/conversations/conversation_1/plans").send({ turnId: "turn_quote", context }).expect(201);
    expect(created.body.data.confirmationToken).toBe("server_confirmation_token");
    expect(fake.createPlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      commandName: "quotes.create_draft", reuseAwaitingPlan: true,
      supersedeAwaitingProposal: { proposalId: "session_qa", fingerprint },
    }));
    const restored = await request(instance).get("/api/assistant/conversations/conversation_1/plans").expect(200);
    expect(restored.body.data).toEqual([expect.objectContaining({ id: quotePlan.id, turnId: "turn_quote", action: "quotes.create_draft", status: "awaiting_confirmation" })]);
    expect(restored.body.data[0]).not.toHaveProperty("confirmationToken");
    await request(app(fake, { conversationRepository, orgId: "other_org" })).get("/api/assistant/conversations/conversation_1/plans").expect(404);
  });

  test("uses the same safe not-found response for other user and organization plans", async () => {
    const fake = service({ getPlan: jest.fn(async () => { throw new ExecutionPlanError("PLAN_NOT_FOUND", "hidden"); }) });
    const otherUser = await request(app(fake, { userId: "user_other" })).get("/api/assistant/plans/plan_other_user").expect(404);
    const otherOrg = await request(app(fake, { orgId: "org_other" })).get("/api/assistant/plans/plan_other_org").expect(404);
    expect(otherUser.body).toEqual(otherOrg.body);
    expect(otherUser.body.error.message).toBe("Plan not found.");
  });

  test("confirmation requires a dedicated token, version, and validated context", async () => {
    const fake = service();
    await request(app(fake)).post("/api/assistant/plans/plan_1/confirmation").send({ expectedPlanVersion: 2, context }).expect(400);
    await request(app(fake)).post("/api/assistant/plans/plan_1/confirmation").send({ confirmationToken: "x".repeat(32), expectedPlanVersion: 2, context }).expect(200);
    expect(fake.confirmAndExecute).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", userId: "user_1" }), expect.objectContaining({ planId: "plan_1", expectedVersion: 2, context }));
  });

  test("cancellation is version-bound and server scoped", async () => {
    const fake = service();
    await request(app(fake)).post("/api/assistant/plans/plan_1/cancel").send({ expectedPlanVersion: 2 }).expect(200);
    expect(fake.cancelPlan).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", userId: "user_1" }), "plan_1", 2);
  });
});
