import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

// Route composition imports storage adapters, but registration itself must not
// connect to a database. A syntactically valid inert URL keeps this test local.
process.env.DATABASE_URL ??= "postgresql://assistant_registry_test:assistant_registry_test@127.0.0.1:5432/assistant_registry_test";

jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));

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

function app(executionService: any, options: { authenticated?: boolean; tenant?: boolean; orgId?: string; userId?: string } = {}) {
  const instance = express(); instance.use(express.json());
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) return res.sendStatus(401);
    req.user = { id: options.userId ?? "user_1" }; next();
  };
  const tenantContext = (req: any, res: any, next: any) => {
    if (options.tenant === false) return res.sendStatus(403);
    req.organizationId = options.orgId ?? "org_1"; req.orgRole = "member"; next();
  };
  registerAssistantExecutionRoutes(instance, { isAuthenticated, tenantContext }, { service: executionService });
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
