import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { CompositeExecutionPlanningService, type CompositeExecutionPlan, type CompositeExecutionPlanRepository } from "../services/assistant/execution/compositeExecutionPlanningService";
import { CompositeSemanticMutationPlanningService } from "../services/assistant/execution/compositeSemanticMutationPlanningService";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionPlanRepository } from "../services/assistant/execution/types";

const now = new Date("2026-08-07T12:00:00.000Z");
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.quotes.add_internal_note"], environment: "test" } as const;
const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", route: "/quotes/quote_1", pageTitle: "Quote", entityType: "quote", entityId: "quote_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: now.toISOString(), unsavedChanges: false,
});

function childRepository(): ExecutionPlanRepository & { confirmations: any[]; executions: string[] } {
  const plans = new Map<string, any>();
  const confirmations: any[] = [];
  const completed = new Map<string, any>();
  const executions: string[] = [];
  return {
    confirmations, executions,
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

function parentRepository(): CompositeExecutionPlanRepository & { confirmations: any[]; plans: Map<string, CompositeExecutionPlan> } {
  const plans = new Map<string, CompositeExecutionPlan>();
  const confirmations: any[] = [];
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
    recordAudit: jest.fn(async () => undefined),
  };
}

function quoteNoteCommand(executions: string[], overrides: Partial<ExecutionCommandDefinition> = {}): ExecutionCommandDefinition {
  return {
    name: "quotes.add_internal_note", version: "v1", testOnly: true, riskLevel: "low", confirmationTtlMs: 60_000,
    maxAffectedRecords: 1, requiredPermissions: ["assistant.quotes.add_internal_note"],
    buildPreview: jest.fn(async ({ arguments: args }) => ({
      arguments: args,
      preview: { title: "Add internal note", summary: `Add note to ${args.quoteId}`, sideEffects: ["Append internal note"], affectedRecords: [{ entityType: "quote", entityId: String(args.quoteId), fingerprint: `quote:${args.quoteId}` }] },
    })),
    revalidate: jest.fn(async ({ plan }) => plan.sanitizedArguments.quoteId === "quote_stale"
      ? { valid: false as const, code: "QUOTE_STALE", summary: "The quote changed." }
      : { valid: true as const }),
    execute: jest.fn(async ({ plan }) => {
      const quoteId = String(plan.sanitizedArguments.quoteId);
      executions.push(quoteId);
      return quoteId === "quote_fail"
        ? { status: "failed" as const, summary: "Note could not be saved.", steps: [{ commandName: "quotes.add_internal_note", status: "failed" as const, summary: "Domain rejected the note." }] }
        : { status: "succeeded" as const, summary: `Internal note added to ${quoteId}.`, steps: [{ commandName: "quotes.add_internal_note", status: "succeeded" as const, summary: "Note saved." }] };
    }),
    ...overrides,
  };
}

function services() {
  const children = childRepository();
  const parents = parentRepository();
  const command = quoteNoteCommand(children.executions);
  const registry = { get: (name: string) => name === command.name ? command : undefined, list: () => [command] };
  const childPlans = new ExecutionPlanningService(children, registry, { now: () => now, allowTestOnlyExecution: true });
  return { children, parents, composite: new CompositeExecutionPlanningService(parents, childPlans, () => now) };
}

describe("composite protected mutation planning", () => {
  test("compiles authorized quote discovery into eligible single-record operations and explicitly excludes ineligible targets", async () => {
    const { composite, parents, children } = services();
    const authorizedQuoteRead = jest.fn(async () => [
      { entityType: "quote", entityId: "quote_1", label: "Quote Q-101", fingerprint: "quote:quote_1", attributes: { status: "draft" } },
      { entityType: "quote", entityId: "quote_closed", label: "Quote Q-102", fingerprint: "quote:quote_closed", attributes: { status: "closed" } },
      { entityType: "quote", entityId: "quote_2", label: "Quote Q-103", fingerprint: "quote:quote_2", attributes: { status: "draft" } },
    ] as const);
    const planner = new CompositeSemanticMutationPlanningService(composite, {
      compile: jest.fn(async ({ intent, target }) => target.attributes?.status !== "draft"
        ? { kind: "ineligible" as const, reason: "Quote is closed and cannot receive this operational note." }
        : { kind: "eligible" as const, operation: { commandName: "quotes.add_internal_note", arguments: { quoteId: target.entityId, noteText: intent.noteText }, summary: `Add the internal note to ${target.label}.` } }),
    });
    const result = await planner.prepare({ scope, conversationId: "conversation_1", correlationId: "corr_read_compose", context, intent: { noteText: "Proof approved by customer." }, authorizedTargets: await authorizedQuoteRead() });

    expect(authorizedQuoteRead).toHaveBeenCalledTimes(1);
    expect(result.included.map((target) => target.entityId)).toEqual(["quote_1", "quote_2"]);
    expect(result.excluded).toEqual([expect.objectContaining({ entityId: "quote_closed", reason: expect.stringContaining("closed") })]);
    expect(result.plan.operations).toHaveLength(2);
    const go = await composite.issueConfirmation(scope, { planId: result.plan.id, expectedVersion: result.plan.version });
    await composite.confirmAndExecute(scope, { planId: result.plan.id, expectedVersion: go.plan.version, token: go.token, context });
    expect(parents.confirmations).toHaveLength(1);
    expect(children.executions).toEqual(["quote_1", "quote_2"]);
  });

  test("coordinates two independently planned quote notes with one user GO and no bulk command", async () => {
    const { composite, parents, children } = services();
    const plan = await composite.createPlan(scope, { conversationId: "conversation_1", correlationId: "corr_1", context, operations: [
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_1", noteText: "Call before proof." } },
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_2", noteText: "Use matte stock." } },
    ] });
    expect(plan.operations).toHaveLength(2);
    expect(new Set(plan.operations.map((operation) => operation.planId)).size).toBe(2);

    const go = await composite.issueConfirmation(scope, { planId: plan.id, expectedVersion: plan.version });
    expect(parents.confirmations).toHaveLength(1);
    expect(children.confirmations).toHaveLength(0);
    const first = await composite.confirmAndExecute(scope, { planId: plan.id, expectedVersion: go.plan.version, token: go.token, context });
    expect(first.result).toMatchObject({ status: "succeeded", operations: [{ status: "succeeded" }, { status: "succeeded" }] });
    expect(children.executions).toEqual(["quote_1", "quote_2"]);

    const replay = await composite.confirmAndExecute(scope, { planId: plan.id, expectedVersion: first.plan.version, token: go.token, context });
    expect(replay.result).toEqual(first.result);
    expect(children.executions).toEqual(["quote_1", "quote_2"]);
  });

  test("reports deterministic per-operation partial failure and preserves completed child effects", async () => {
    const { composite, children } = services();
    const plan = await composite.createPlan(scope, { conversationId: "conversation_1", correlationId: "corr_2", context, operations: [
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_1", noteText: "Saved." } },
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_fail", noteText: "Fails safely." } },
    ] });
    const go = await composite.issueConfirmation(scope, { planId: plan.id, expectedVersion: plan.version });
    const result = await composite.confirmAndExecute(scope, { planId: plan.id, expectedVersion: go.plan.version, token: go.token, context });
    expect(result.plan.status).toBe("partially_failed");
    expect(result.result.operations.map((operation) => operation.status)).toEqual(["succeeded", "failed"]);
    expect(children.executions).toEqual(["quote_1", "quote_fail"]);
  });

  test("rejects unauthorized composition and reports a stale child without executing it", async () => {
    const { composite, children } = services();
    await expect(composite.createPlan({ ...scope, permissions: [] }, { conversationId: "conversation_1", correlationId: "corr_3", context, operations: [
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_1", noteText: "No access." } },
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_2", noteText: "No access." } },
    ] })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    const plan = await composite.createPlan(scope, { conversationId: "conversation_1", correlationId: "corr_4", context, operations: [
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_stale", noteText: "Do not append." } },
      { commandName: "quotes.add_internal_note", arguments: { quoteId: "quote_2", noteText: "Still safe." } },
    ] });
    const go = await composite.issueConfirmation(scope, { planId: plan.id, expectedVersion: plan.version });
    const result = await composite.confirmAndExecute(scope, { planId: plan.id, expectedVersion: go.plan.version, token: go.token, context });
    expect(result.result.operations.map((operation) => operation.status)).toEqual(["failed", "succeeded"]);
    expect(children.executions).toEqual(["quote_2"]);
  });
});
