import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import type { ReviewedProductionCompletionPreview, ReviewedProductionCompletionResult } from "../services/reviewedProductionCompletion";
import type { ExecutionCommandResult, ExecutionConfirmationRecord, ExecutionPlanRecord, ExecutionPlanRepository } from "../services/assistant/execution/types";
import {
  createProductionCompletionCommandDefinition, createProductionCompletionExecutionCommand,
  prepareProductionCompletionCommandArguments, productionCompletionCommandName,
} from "../services/assistant/execution/productionCompletionCommand";

const scope = { organizationId: "org-a", userId: "operator-a", permissions: ["assistant.production.update_job_status"],
  organizationRole: "employee", authorityStatus: "resolved" as const, environment: "test" };
const target = { organizationId: scope.organizationId, actorUserId: scope.userId, orderId: "order-a", lineItemId: "line-a" };
const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: `/orders/${target.orderId}`, pageTitle: "Order",
  entityType: "order", entityId: target.orderId, capturedAt: "2026-11-20T00:00:00.000Z", unsavedChanges: false });

// Only persistence is local: GO authorization, tokens, versions and idempotent replay use the real planner.
function memoryRepository(): ExecutionPlanRepository {
  const plans = new Map<string, ExecutionPlanRecord>();
  const confirmations = new Map<string, ExecutionConfirmationRecord>();
  const completed = new Map<string, ExecutionCommandResult>();
  return {
    async create(plan) { plans.set(plan.id, plan); return plan; },
    async get(actor, id) {
      const plan = plans.get(id);
      return plan?.organizationId === actor.organizationId && plan.userId === actor.userId ? plan : null;
    },
    async update(plan, expected) {
      if (plans.get(plan.id)?.version !== expected) return null;
      plans.set(plan.id, plan); return plan;
    },
    async createConfirmation(record) { confirmations.set(record.tokenHash, record); },
    async consumeConfirmation(input) {
      const record = confirmations.get(input.tokenHash);
      if (!record || record.planId !== input.planId || record.userId !== input.userId ||
          record.organizationId !== input.organizationId || record.expiresAt <= input.now) return "invalid";
      if (record.usedAt) return "already_used";
      record.usedAt = input.now; return "consumed";
    },
    async acquireIdempotency({ plan }) {
      const result = completed.get(plan.id);
      return result ? { kind: "completed", result } : { kind: "acquired" };
    },
    async completeIdempotency({ plan, result }) { completed.set(plan.id, result); },
    async recordSteps() {}, async recordAudit() {},
  };
}

function harness() {
  const original: ReviewedProductionCompletionPreview = { version: "v1", scope: target, jobId: "job-a", revision: "a".repeat(64),
    state: { jobStatus: "in_progress", stationKey: "roll", stepKey: "queued", startedAt: "2026-11-20T01:00:00.000Z",
      orderState: "open", orderStatus: "in_production", lineWorkflowState: "in_production", lineStatus: "active" },
    route: { stationKey: "fulfillment", stepKey: "queued", source: "step_trigger" } };
  const result: ReviewedProductionCompletionResult = { status: "applied", job: { id: original.jobId, status: "done", stationKey: "roll",
    stepKey: "queued", completedAt: "2026-11-20T02:00:00.000Z" }, order: { id: target.orderId, state: "active", status: "in_production" },
    line: { id: target.lineItemId, workflowState: "ready_for_fulfillment", status: "complete" },
    activeSuccessors: [{ id: "job-b", stationKey: "fulfillment", stepKey: "queued", status: "queued" }], postcommit: [] };
  const operations = {
    preview: jest.fn(async () => original), execute: jest.fn(async () => result),
    verifyMembership: jest.fn(async () => ({ organizationId: scope.organizationId, userId: scope.userId, organizationRole: scope.organizationRole })),
  };
  const command = createProductionCompletionExecutionCommand(operations);
  const planner = new ExecutionPlanningService(memoryRepository(), { get: name => name === command.name ? command : undefined, list: () => [command] },
    { allowProductionExecution: true });
  const request = { commandName: productionCompletionCommandName, conversationId: "conversation", turnId: "turn", context,
    arguments: prepareProductionCompletionCommandArguments(original) };
  const issue = async () => { const plan = await planner.createPlan(scope, request); return planner.issueConfirmation(scope, plan.id, plan.version); };
  const go = (issued: Awaited<ReturnType<typeof issue>>) => ({ planId: issued.plan.id, expectedVersion: issued.plan.version, token: issued.token, context });
  return { planner, original, result, operations, request, issue, go };
}

describe("ordinary production job completion GO", () => {
  test("binds the reviewed route and sends exactly one native operation, only after protected GO", async () => {
    const h = harness();
    expect(createProductionCompletionCommandDefinition()).toMatchObject({ name: "production.complete_job", requiredCapability: "assistant.production.update_job_status", bulkAllowed: false });
    const issued = await h.issue();
    expect(issued.plan.sanitizedArguments).toEqual({ preview: h.original });
    expect(issued.plan.preview.summary).toContain("fulfillment/queued");
    await expect(h.planner.confirmAndExecute(scope, { ...h.go(issued), token: "GO" })).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
    expect(h.operations.execute).not.toHaveBeenCalled();
    const first = await h.planner.confirmAndExecute(scope, h.go(issued));
    expect(first.result).toMatchObject({ status: "succeeded", summary: expect.stringContaining("ready_for_fulfillment"),
      steps: [{ commandName: "production.complete_job", status: "succeeded" }] });
    expect(h.operations.execute).toHaveBeenCalledWith(target, h.original);
    h.operations.preview.mockRejectedValue(new Error("already completed"));
    await expect(h.planner.createPlan(scope, h.request)).rejects.toThrow();
    const replay = await h.planner.confirmAndExecute(scope, h.go(issued));
    expect(replay.result).toEqual(first.result);
    expect(h.operations.execute).toHaveBeenCalledTimes(1);
  });

  test.each(["job", "route", "revision"])('rejects a changed %s without replacing the stored review', async changed => {
    const h = harness();
    const issued = await h.issue();
    h.operations.preview.mockResolvedValue({ ...h.original, ...(changed === "job" ? { jobId: "replacement" } :
      changed === "route" ? { route: { ...h.original.route, stationKey: "different" } } : { revision: "b".repeat(64) }) });
    await expect(h.planner.confirmAndExecute(scope, h.go(issued))).rejects.toMatchObject({ code: "PLAN_STALE" });
    expect((await h.planner.getPlan(scope, issued.plan.id)).status).toBe("invalidated");
    expect(h.operations.execute).not.toHaveBeenCalled();
  });

  test("checks persisted permission at plan and GO even when the scope still lists the grant", async () => {
    const h = harness();
    const issued = await h.issue();
    h.operations.verifyMembership.mockResolvedValue({ ...scope, organizationRole: "member" });
    await expect(h.planner.createPlan(scope, h.request)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(h.planner.confirmAndExecute(scope, h.go(issued))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(h.operations.execute).not.toHaveBeenCalled();
  });

  test("rejects foreign actor, tenant, contradictory page, injected override, and missing grant", async () => {
    const h = harness();
    for (const actor of [{ ...scope, userId: "other" }, { ...scope, organizationId: "other" }, { ...scope, permissions: [] }]) {
      await expect(h.planner.createPlan(actor, h.request)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    await expect(h.planner.createPlan(scope, { ...h.request, context: { ...context, route: "/orders/other" } })).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    await expect(h.planner.createPlan(scope, { ...h.request, arguments: { ...h.request.arguments, skipProduction: true } })).rejects.toThrow();
    await expect(h.planner.createPlan(scope, { ...h.request, arguments: { preview: { ...h.original, boxed: true } } })).rejects.toThrow();
    expect(h.operations.execute).not.toHaveBeenCalled();
  });

  test.each(["wrong job", "unfinished", "response lost"])('never reports success on %s', async fault => {
    const h = harness();
    const issued = await h.issue();
    if (fault === "response lost") h.operations.execute.mockRejectedValue(new Error("untrusted internal detail"));
    else h.operations.execute.mockResolvedValue({ ...h.result, job: { ...h.result.job, ...(fault === "wrong job" ? { id: "other" } : { completedAt: null }) } });
    expect((await h.planner.confirmAndExecute(scope, h.go(issued))).result).toMatchObject({ status: "failed", summary: expect.stringContaining("outcome unverified") });
    expect(h.operations.execute).toHaveBeenCalledTimes(1);
  });

  test("does not reinterpret DEV partial Fulfillment completion as ordinary whole-job completion", async () => {
    const h = harness();
    // DEV's partial completion is a separate Fulfillment operation. Neither its
    // quantity nor its server-only workflow option may be added to this review.
    for (const extra of [{ quantity: 2 }, { fulfillmentCompletion: { quantity: 2, clientRequestId: "other", standaloneRemainingQuantity: 5 } }]) {
      await expect(h.planner.createPlan(scope, { ...h.request, arguments: { ...h.request.arguments, ...extra } })).rejects.toThrow();
    }
    expect(h.operations.execute).not.toHaveBeenCalled();
    const issued = await h.issue();
    h.operations.execute.mockResolvedValue({ ...h.result,
      job: { ...h.result.job, status: "in_progress", completedAt: null },
      line: { ...h.result.line, workflowState: "in_production", status: "in_production" }, activeSuccessors: [],
    });
    expect((await h.planner.confirmAndExecute(scope, h.go(issued))).result)
      .toMatchObject({ status: "failed", summary: expect.stringContaining("outcome unverified") });
    expect(h.operations.execute).toHaveBeenCalledWith(target, h.original);
    expect(h.operations.execute).toHaveBeenCalledTimes(1);
  });

  test("reports postcommit workflow issues without calling completion a failure", async () => {
    const h = harness();
    h.operations.execute.mockResolvedValue({ ...h.result, postcommit: [{ triggerKey: "sent_to_fulfillment", status: "unavailable", reason: null }] });
    const issued = await h.issue();
    const { result } = await h.planner.confirmAndExecute(scope, h.go(issued));
    expect(result?.summary).toMatch(/Completed production job.*post-completion workflow update is unavailable/);
    expect(result?.status).toBe("succeeded");
  });
});
