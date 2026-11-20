import { describe, expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import {
  executePhysicalReadinessAdjustment, previewPhysicalReadinessAdjustment,
  type PhysicalReadinessAdjustmentDependencies, type PhysicalReadinessAdjustmentReceipt,
} from "../services/assistant/physicalReadinessAdjustment";
import type {
  ExecutionCommandResult, ExecutionConfirmationRecord, ExecutionPlanRecord, ExecutionPlanRepository,
} from "../services/assistant/execution/types";
import {
  createPhysicalReadinessCommandDefinition, createPhysicalReadinessExecutionCommand,
  physicalReadinessCommandName, preparePhysicalReadinessCommandArguments,
} from "../services/assistant/execution/physicalReadinessCommand";

const orderId = "11111111-1111-4111-8111-111111111111";
const orderLineItemId = "22222222-2222-4222-8222-222222222222";
const scope = {
  organizationId: "org1", userId: "user1", organizationRole: "employee", authorityStatus: "resolved" as const,
  permissions: ["assistant.fulfillment.add_note"], environment: "test",
};
const context = assistantContextEnvelopeSchema.parse({
  contextVersion: "v1", pageTitle: "Order", route: `/orders/${orderId}`, entityType: "order", entityId: orderId,
  capturedAt: "2026-11-20T12:00:00.000Z", unsavedChanges: false,
});

// Persistence only: transitions, GO tokens, authorization and replay run in the production planner.
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

async function setup() {
  const state = { ready: 2, permitted: true, fault: "" };
  const receipts = new Map<string, PhysicalReadinessAdjustmentReceipt>();
  function detail() {
    const quantities = {
      orderedQuantity: 10, shippedQuantity: 0, fulfilledQuantity: 0, pickedUpQuantity: 0,
      readyWaitingQuantity: state.ready, productionCompleteQuantity: 0, remainingQuantity: 10, notReadyQuantity: 10 - state.ready,
    };
    return {
      orderId, status: "IN_PROGRESS", fulfillmentType: "SHIP", permissions: { canConfirmPhysicalReadiness: state.permitted },
      ...quantities, checklistComplete: false, checklistSummary: { total: 1, checked: 0, unchecked: 1 },
      lineItems: [{ id: orderLineItemId, productName: "Synthetic sign", checklist: { checked: false, fulfilledQuantity: 0 },
        production: { ...quantities, availableForAllocationQuantity: state.ready, status: "active", label: "In progress",
          productionRequired: true, stationKey: null, stationLabel: null } }],
    } as unknown as Awaited<ReturnType<NonNullable<PhysicalReadinessAdjustmentDependencies["adjustReadyQuantities"]>>>;
  }
  const adjust: NonNullable<PhysicalReadinessAdjustmentDependencies["adjustReadyQuantities"]> = async (_org, _order, data, actor) => {
    if (state.fault === "reject") throw Object.assign(new Error("synthetic rejection"), { code: "INVALID_QUANTITY", status: 409 });
    if (state.fault === "unknown") throw new Error("synthetic lost connection");
    const clientRequestId = data.clientRequestId!;
    const previousReadyQuantity = state.ready;
    state.ready += data.items[0].quantityDelta;
    receipts.set(clientRequestId, { id: "native-event", payload: { clientRequestId, reason: data.reason,
      operatorUserId: actor ?? null, adjustments: [{ ...data.items[0], previousReadyQuantity, nextReadyQuantity: state.ready }] } });
    if (state.fault === "postcommit") throw new Error("synthetic unavailable after commit");
    return detail();
  };
  const adjustReadyQuantities = jest.fn(adjust);
  const deps: PhysicalReadinessAdjustmentDependencies = {
    adjustReadyQuantities, readDetail: async () => detail(), verifyNativeReadAuthority: async () => scope,
    readReceipt: async (_org, _order, key) => receipts.get(key) ?? null,
  };
  const ops = {
    preview: jest.fn<typeof previewPhysicalReadinessAdjustment>((target, input) => previewPhysicalReadinessAdjustment(target, input, deps)),
    execute: jest.fn<typeof executePhysicalReadinessAdjustment>((target, preview, key) => executePhysicalReadinessAdjustment(target, preview, key, deps)),
  };
  const preview = await ops.preview({ organizationId: scope.organizationId, userId: scope.userId, orderId }, {
    orderLineItemId, quantityDelta: 3, reason: "Counted three inspected units",
  });
  const card = { kind: "action_proposal", plan: { action: physicalReadinessCommandName, arguments: preparePhysicalReadinessCommandArguments(preview) } };
  const command = createPhysicalReadinessExecutionCommand(ops);
  const repository = memoryRepository();
  const planner = new ExecutionPlanningService(repository, {
    get: name => name === command.name ? command : undefined, list: () => [command],
  }, { allowProductionExecution: true });
  const request = { conversationId: "conversation", turnId: "turn", commandName: card.plan.action, arguments: card.plan.arguments, context };
  const plan = () => planner.createPlan(scope, request);
  const issue = async () => { const p = await plan(); return planner.issueConfirmation(scope, p.id, p.version); };
  const go = (issued: Awaited<ReturnType<typeof issue>>) => ({ planId: issued.plan.id, expectedVersion: issued.plan.version, token: issued.token, context });
  return { scope, request, planner, plan, issue, go, state, adjustReadyQuantities, ops, receipts, args: card.plan.arguments };
}

describe("physical readiness protected GO", () => {
  test("requires the native capability and changes nothing until valid GO; replay returns the original durable result", async () => {
    const h = await setup();
    expect(createPhysicalReadinessCommandDefinition().requiredCapability).toBe("assistant.fulfillment.add_note");
    const issued = await h.issue();
    expect(issued.plan.preview.summary).toContain("2 to 5 (+3). Reason: Counted three inspected units");
    expect(issued.plan.sanitizedArguments).toEqual(h.args);
    expect(issued.plan.idempotencyKey).not.toBe(h.args.clientRequestId);
    const go = h.go(issued);
    await expect(h.planner.confirmAndExecute(scope, { ...go, token: "GO" })).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
    expect(h.adjustReadyQuantities).not.toHaveBeenCalled();
    const first = await h.planner.confirmAndExecute(scope, go);
    expect(first.result).toMatchObject({ status: "succeeded", summary: expect.stringContaining("reviewed line: 5"), steps: [{ domainAuditReference: "native-event" }] });
    expect(h.adjustReadyQuantities).toHaveBeenCalledWith(scope.organizationId, orderId, {
      reason: h.args.preview.input.reason, clientRequestId: h.args.clientRequestId, items: [{ orderLineItemId, quantityDelta: 3 }],
      expectedReadyByLine: { [orderLineItemId]: 2 },
    }, scope.userId, scope.organizationRole);
    h.state.ready = 1;
    const replay = await h.planner.confirmAndExecute(scope, go);
    expect(replay.result).toEqual(first.result);
    expect(h.ops.execute).toHaveBeenCalledTimes(1);
    expect(h.adjustReadyQuantities).toHaveBeenCalledTimes(1);
  });

  test("replanning the same stored card, even when the old quantity returns, cannot apply the delta twice", async () => {
    const h = await setup();
    const a = await h.issue();
    await h.planner.confirmAndExecute(scope, h.go(a));
    await expect(h.plan()).rejects.toMatchObject({ code: "PLAN_STALE" });
    h.state.ready = 2; // A separate native correction makes the old preview current again.
    const b = await h.issue();
    expect(a.plan.id).not.toBe(b.plan.id);
    expect(b.plan.sanitizedArguments).toEqual(a.plan.sanitizedArguments);
    expect((await h.planner.confirmAndExecute(scope, h.go(b))).result).toMatchObject({ status: "succeeded" });
    expect(h.ops.execute).toHaveBeenCalledTimes(2);
    expect(h.adjustReadyQuantities).toHaveBeenCalledTimes(1);
    expect(h.receipts.size).toBe(1);
    expect(h.state.ready).toBe(2);
  });

  test.each(["stale", "native permission", "grant"])('invalidates %s before mutation', async change => {
    const h = await setup();
    const issued = await h.issue();
    if (change === "stale") h.state.ready = 1;
    if (change === "native permission") h.state.permitted = false;
    const actor = change === "grant" ? { ...scope, permissions: [] } : scope;
    await expect(h.planner.confirmAndExecute(actor, h.go(issued))).rejects.toMatchObject({ code: change === "grant" ? "PERMISSION_CHANGED" : "PLAN_STALE" });
    expect((await h.planner.getPlan(scope, issued.plan.id)).status).toBe("invalidated");
    expect(h.adjustReadyQuantities).not.toHaveBeenCalled();
  });

  test("rejects wrong actor/tenant, read-only roles, changed context and injected proposal fields", async () => {
    const h = await setup();
    for (const actor of [{ ...scope, userId: "other" }, { ...scope, organizationId: "other" }, { ...scope, organizationRole: "member" }]) {
      await expect(h.planner.createPlan(actor, h.request)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    for (const changed of [{ ...context, entityId: "other" }, { ...context, route: "/orders/other" }, { ...context, unsavedChanges: true }]) {
      await expect(h.planner.createPlan(scope, { ...h.request, context: changed })).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    }
    await expect(h.planner.createPlan(scope, { ...h.request, arguments: { ...h.args, actorUserId: "other" } })).rejects.toThrow();
    const issued = await h.issue();
    await expect(h.planner.confirmAndExecute(scope, { ...h.go(issued), context: { ...context, entityId: "other" } })).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(h.adjustReadyQuantities).not.toHaveBeenCalled();
  });

  test.each([
    ["reject", "failed", "INVALID_QUANTITY"], ["unknown", "failed", "outcome unknown"],
    ["postcommit", "succeeded", "Refreshed readiness is unavailable"],
  ])("finishes the plan honestly on %s", async (fault, status, message) => {
    const h = await setup();
    const issued = await h.issue();
    h.state.fault = fault;
    const completed = await h.planner.confirmAndExecute(scope, h.go(issued));
    expect(completed.plan.status).toBe(status);
    expect(completed.result?.summary).toContain(message);
    expect(h.receipts.size).toBe(fault === "postcommit" ? 1 : 0);
  });
});
