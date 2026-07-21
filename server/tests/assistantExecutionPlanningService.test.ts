import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { assistantProductionCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import { hasMutationIntent, isFreeTextGo } from "../services/assistant/execution/intentDetection";
import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionPlanRepository } from "../services/assistant/execution/types";

const now = new Date("2026-07-21T12:00:00.000Z");
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["orders.write"], environment: "test" } as const;
const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", route: "/orders/order_1", pageTitle: "Order", entityType: "order", entityId: "order_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: now.toISOString(), unsavedChanges: false,
});

function command(overrides: Partial<ExecutionCommandDefinition> = {}): ExecutionCommandDefinition {
  return {
    name: "test.change_order", version: "v1", testOnly: true, riskLevel: "low", confirmationTtlMs: 60_000,
    maxAffectedRecords: 1, requiredPermissions: ["orders.write"],
    buildPreview: jest.fn(async () => ({
      arguments: { orderId: "order_1", status: "approved" },
      preview: { title: "Approve order", summary: "Approve order_1", sideEffects: ["Status changes"], affectedRecords: [{ entityType: "order", entityId: "order_1", fingerprint: "a".repeat(64) }] },
    })),
    revalidate: jest.fn(async () => ({ valid: true } as const)),
    execute: jest.fn(async () => ({ status: "succeeded" as const, summary: "Order approved", steps: [{ commandName: "test.change_order", status: "succeeded" as const, summary: "Approved" }] })),
    ...overrides,
  };
}

function registry(commands: readonly ExecutionCommandDefinition[] = []) {
  const byName = new Map(commands.map((definition) => [definition.name, definition]));
  return { get: (name: string) => byName.get(name), list: () => [...byName.values()] };
}

function repository(): ExecutionPlanRepository & { plans: Map<string, any>; confirmations: any[] } {
  const plans = new Map<string, any>();
  const confirmations: any[] = [];
  const completed = new Map<string, any>();
  return {
    plans, confirmations,
    create: jest.fn(async (plan) => { plans.set(plan.id, plan); return plan; }),
    get: jest.fn(async (requestedScope, id) => {
      const plan = plans.get(id);
      return plan && plan.organizationId === requestedScope.organizationId && plan.userId === requestedScope.userId ? plan : null;
    }),
    update: jest.fn(async (plan, expectedVersion) => {
      const current = plans.get(plan.id);
      if (!current || current.version !== expectedVersion) return null;
      plans.set(plan.id, plan); return plan;
    }),
    createConfirmation: jest.fn(async (confirmation) => { confirmations.push(confirmation); }),
    consumeConfirmation: jest.fn(async (input) => {
      const confirmation = confirmations.find((candidate) => candidate.planId === input.planId && candidate.organizationId === input.organizationId && candidate.userId === input.userId && candidate.tokenHash === input.tokenHash);
      if (!confirmation || confirmation.expiresAt <= input.now) return "invalid" as const;
      if (confirmation.usedAt) return "already_used" as const;
      confirmation.usedAt = input.now;
      return "consumed" as const;
    }),
    acquireIdempotency: jest.fn(async ({ plan }) => completed.has(plan.id) ? { kind: "completed" as const, result: completed.get(plan.id) } : { kind: "acquired" as const }),
    completeIdempotency: jest.fn(async ({ plan, result }) => { completed.set(plan.id, result); }),
    recordAudit: jest.fn(async () => undefined),
    recordSteps: jest.fn(async () => undefined),
  };
}

async function planReady(service: ExecutionPlanningService) {
  return service.createPlan(scope, { conversationId: "conversation_1", commandName: "test.change_order", arguments: {}, context });
}

describe("Stage 3 execution planning service", () => {
  test("production command registry intentionally contains zero mutating commands", () => {
    expect(assistantProductionCommandRegistry.list()).toEqual([]);
  });

  test("free-text GO remains a message and mutation intent never picks a command", () => {
    expect(isFreeTextGo("GO")).toBe(true);
    expect(hasMutationIntent("Please update the order")).toBe(true);
    expect(hasMutationIntent("Where is order 123?")).toBe(false);
  });

  test("requires an injected registered command and server-side permissions", async () => {
    const service = new ExecutionPlanningService(repository(), registry());
    await expect(service.createPlan(scope, { conversationId: "conversation_1", commandName: "test.change_order", arguments: {}, context })).rejects.toMatchObject({ code: "COMMAND_NOT_REGISTERED" });
  });

  test("hashes a one-time confirmation token and executes only in test-enabled flow", async () => {
    const repo = repository();
    const registered = command();
    const service = new ExecutionPlanningService(repo, registry([registered]), { now: () => now, allowTestOnlyExecution: true });
    const plan = await planReady(service);
    const issued = await service.issueConfirmation(scope, plan.id, plan.version);
    expect(repo.confirmations[0].tokenHash).not.toBe(issued.token);
    expect(repo.confirmations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const result = await service.confirmAndExecute(scope, { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context });
    expect(result.plan.status).toBe("succeeded");
    expect(result.result?.status).toBe("succeeded");
    expect(registered.execute).toHaveBeenCalledTimes(1);
    await expect(service.confirmAndExecute(scope, { planId: plan.id, expectedVersion: result.plan.version, token: issued.token, context })).rejects.toBeInstanceOf(ExecutionPlanError);
    expect(registered.execute).toHaveBeenCalledTimes(1);
  });

  test("invalidates a changed record before an execution lock is acquired", async () => {
    const repo = repository();
    const registered = command({ revalidate: jest.fn(async () => ({ valid: false as const, code: "RECORD_CHANGED", summary: "Order changed." })) });
    const service = new ExecutionPlanningService(repo, registry([registered]), { now: () => now, allowTestOnlyExecution: true });
    const plan = await planReady(service);
    const issued = await service.issueConfirmation(scope, plan.id, plan.version);
    await expect(service.confirmAndExecute(scope, { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context })).rejects.toMatchObject({ code: "RECORD_CHANGED" });
    expect(repo.acquireIdempotency).not.toHaveBeenCalled();
    expect(registered.execute).not.toHaveBeenCalled();
  });

  test("records partial failure without rerunning successful steps", async () => {
    const repo = repository();
    const registered = command({ execute: jest.fn(async () => ({
      status: "partially_failed" as const,
      summary: "One safe step completed; one failed.",
      steps: [
        { commandName: "test.change_order", status: "succeeded" as const, summary: "First step completed." },
        { commandName: "test.change_order", status: "failed" as const, summary: "Second step failed." },
      ],
    })) });
    const service = new ExecutionPlanningService(repo, registry([registered]), { now: () => now, allowTestOnlyExecution: true });
    const plan = await planReady(service);
    const issued = await service.issueConfirmation(scope, plan.id, plan.version);
    const result = await service.confirmAndExecute(scope, { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context });
    expect(result.plan.status).toBe("partially_failed");
    expect(repo.recordSteps).toHaveBeenCalledWith(expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ status: "succeeded" }), expect.objectContaining({ status: "failed" })]) }));
    expect(registered.execute).toHaveBeenCalledTimes(1);
  });

  test("does not transition an expired plan to confirmation", async () => {
    const repo = repository();
    let clock = now;
    const service = new ExecutionPlanningService(repo, registry([command({ confirmationTtlMs: 1 })]), { now: () => clock, allowTestOnlyExecution: true });
    const expiredPlan = await service.createPlan(scope, { conversationId: "conversation_1", commandName: "test.change_order", arguments: {}, context });
    clock = new Date(now.getTime() + 10);
    await expect(service.issueConfirmation(scope, expiredPlan.id, expiredPlan.version)).rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    expect(repo.plans.get(expiredPlan.id).status).toBe("expired");
  });

  test("rejects impossible state transitions", async () => {
    const { assertTransition, validExecutionPlanTransitions } = await import("../services/assistant/execution/stateMachine");
    for (const [from, targets] of Object.entries(validExecutionPlanTransitions)) {
      for (const to of targets) expect(() => assertTransition(from as any, to)).not.toThrow();
    }
    expect(() => assertTransition("cancelled", "confirmed")).toThrow("Cannot transition");
    expect(() => assertTransition("awaiting_input", "executing")).toThrow("Cannot transition");
    expect(() => assertTransition("succeeded", "executing")).toThrow("Cannot transition");
  });
});
