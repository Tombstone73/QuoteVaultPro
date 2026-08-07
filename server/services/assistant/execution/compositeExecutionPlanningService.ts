import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AssistantContextEnvelope } from "@shared/assistantContracts";
import { ExecutionPlanningService } from "./executionPlanningService";
import type { ExecutionActorScope, ExecutionCommandResult, ExecutionPlanRecord } from "./types";
import { ExecutionPlanError } from "./types";

export type CompositeExecutionStatus = "preview_ready" | "awaiting_confirmation" | "executing" | "succeeded" | "partially_failed" | "failed" | "invalidated";
export type CompositeExecutionOperation = { planId: string; commandName: string; summary: string; affectedRecords: readonly { entityType: string; entityId: string; fingerprint: string }[] };
export type CompositeExecutionPlan = {
  id: string; organizationId: string; userId: string; conversationId: string; contextHash: string; fingerprint: string;
  status: CompositeExecutionStatus; version: number; correlationId: string; expiresAt: Date; operations: readonly CompositeExecutionOperation[];
  result?: CompositeExecutionResult;
};
export type CompositeExecutionOperationResult = { planId: string; commandName: string; status: "succeeded" | "failed" | "unverified"; summary: string; result?: ExecutionCommandResult };
export type CompositeExecutionResult = { status: "succeeded" | "partially_failed" | "failed"; summary: string; operations: readonly CompositeExecutionOperationResult[] };

export interface CompositeExecutionPlanRepository {
  create(plan: CompositeExecutionPlan): Promise<CompositeExecutionPlan>;
  get(scope: Pick<ExecutionActorScope, "organizationId" | "userId">, planId: string): Promise<CompositeExecutionPlan | null>;
  update(plan: CompositeExecutionPlan, expectedVersion: number): Promise<CompositeExecutionPlan | null>;
  createConfirmation(input: { planId: string; organizationId: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  consumeConfirmation(input: { planId: string; organizationId: string; userId: string; tokenHash: string; now: Date }): Promise<"consumed" | "already_used" | "invalid">;
  recordAudit(input: { planId: string; correlationId: string; event: string }): Promise<void>;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const contextHash = (context: AssistantContextEnvelope) => hash(JSON.stringify(context));
const fingerprint = (operations: readonly CompositeExecutionOperation[]) => hash(JSON.stringify(operations.map((operation) => ({ commandName: operation.commandName, affectedRecords: operation.affectedRecords }))));

/**
 * One user confirmation coordinates a bounded set of server-built child
 * commands. The coordinator never receives a database handle or a model
 * mutation payload: each operation is still previewed, authorized,
 * revalidated, idempotency-protected, audited, and executed by the existing
 * ExecutionPlanningService.
 */
export class CompositeExecutionPlanningService {
  constructor(
    private readonly repository: CompositeExecutionPlanRepository,
    private readonly childPlans: ExecutionPlanningService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPlan(scope: ExecutionActorScope, input: { conversationId: string; context: AssistantContextEnvelope; correlationId: string; operations: readonly { commandName: string; arguments: Record<string, unknown> }[] }): Promise<CompositeExecutionPlan> {
    if (input.operations.length < 2 || input.operations.length > 25) throw new ExecutionPlanError("COMPOSITE_OPERATION_COUNT", "A composite plan must contain between two and twenty-five operations.");
    const children: ExecutionPlanRecord[] = [];
    for (const operation of input.operations) {
      const child = await this.childPlans.createPlan(scope, { conversationId: input.conversationId, commandName: operation.commandName, arguments: operation.arguments, context: input.context, correlationId: input.correlationId });
      if (child.status !== "preview_ready") throw new ExecutionPlanError("COMPOSITE_CHILD_NOT_READY", "One requested operation needs more information before review.");
      children.push(child);
    }
    const operations = children.map((child) => ({ planId: child.id, commandName: child.commandName, summary: child.preview.summary, affectedRecords: child.affectedRecords }));
    const now = this.now();
    const plan: CompositeExecutionPlan = {
      id: randomUUID(), organizationId: scope.organizationId, userId: scope.userId, conversationId: input.conversationId,
      contextHash: contextHash(input.context), fingerprint: fingerprint(operations), status: "preview_ready", version: 1,
      correlationId: input.correlationId, expiresAt: new Date(Math.min(...children.map((child) => child.expiresAt.getTime()))), operations,
    };
    const created = await this.repository.create(plan);
    await this.repository.recordAudit({ planId: created.id, correlationId: created.correlationId, event: "composite_plan_created" });
    return created;
  }

  async issueConfirmation(scope: ExecutionActorScope, input: { planId: string; expectedVersion: number }): Promise<{ plan: CompositeExecutionPlan; token: string }> {
    const plan = await this.require(scope, input.planId);
    if (plan.version !== input.expectedVersion || plan.status !== "preview_ready" || plan.expiresAt <= this.now()) throw new ExecutionPlanError("COMPOSITE_PLAN_NOT_CONFIRMABLE", "This approved scope is no longer current.");
    const awaiting = await this.update({ ...plan, status: "awaiting_confirmation", version: plan.version + 1 });
    const token = randomBytes(32).toString("base64url");
    await this.repository.createConfirmation({ planId: awaiting.id, organizationId: scope.organizationId, userId: scope.userId, tokenHash: hash(token), expiresAt: awaiting.expiresAt });
    await this.repository.recordAudit({ planId: awaiting.id, correlationId: awaiting.correlationId, event: "composite_confirmation_issued" });
    return { plan: awaiting, token };
  }

  async confirmAndExecute(scope: ExecutionActorScope, input: { planId: string; expectedVersion: number; token: string; context: AssistantContextEnvelope }): Promise<{ plan: CompositeExecutionPlan; result: CompositeExecutionResult }> {
    let plan = await this.require(scope, input.planId);
    if (plan.status === "succeeded" || plan.status === "partially_failed" || plan.status === "failed") {
      if (!plan.result) throw new ExecutionPlanError("COMPOSITE_RESULT_MISSING", "The earlier execution result is unavailable.");
      return { plan, result: plan.result };
    }
    if (plan.version !== input.expectedVersion || plan.status !== "awaiting_confirmation" || plan.contextHash !== contextHash(input.context) || plan.expiresAt <= this.now()) throw new ExecutionPlanError("COMPOSITE_PLAN_STALE", "This approved scope is no longer current.");
    const consumed = await this.repository.consumeConfirmation({ planId: plan.id, organizationId: scope.organizationId, userId: scope.userId, tokenHash: hash(input.token), now: this.now() });
    if (consumed !== "consumed") throw new ExecutionPlanError(consumed === "already_used" ? "CONFIRMATION_ALREADY_USED" : "INVALID_CONFIRMATION", "The confirmation is invalid or already used.");
    plan = await this.update({ ...plan, status: "executing", version: plan.version + 1 });
    const results: CompositeExecutionOperationResult[] = [];
    for (const operation of plan.operations) {
      try {
        // Child confirmation tokens are server-internal implementation of the
        // already-approved parent scope. The user sees and supplies only the
        // single composite token above.
        const child = await this.childPlans.getPlan(scope, operation.planId);
        const confirmation = await this.childPlans.issueConfirmation(scope, child.id, child.version);
        const executed = await this.childPlans.confirmAndExecute(scope, { planId: child.id, expectedVersion: confirmation.plan.version, token: confirmation.token, context: input.context });
        const result = executed.result;
        results.push({
          planId: child.id,
          commandName: operation.commandName,
          status: result?.status === "succeeded" ? "succeeded" : result?.status === "failed" ? "failed" : "unverified",
          summary: result?.summary ?? "The operation could not be verified in this runtime.",
          ...(result ? { result } : {}),
        });
      } catch (error) {
        results.push({ planId: operation.planId, commandName: operation.commandName, status: "failed", summary: error instanceof ExecutionPlanError ? error.message : "The approved operation failed safely." });
      }
    }
    const succeeded = results.filter((result) => result.status === "succeeded").length;
    const status: CompositeExecutionResult["status"] = succeeded === results.length ? "succeeded" : succeeded > 0 ? "partially_failed" : "failed";
    const result: CompositeExecutionResult = { status, summary: status === "succeeded" ? "All approved operations completed." : status === "partially_failed" ? "Some approved operations completed; review the individual results." : "No approved operations completed.", operations: results };
    const finalStatus: CompositeExecutionStatus = status;
    plan = await this.update({ ...plan, status: finalStatus, version: plan.version + 1, result });
    await this.repository.recordAudit({ planId: plan.id, correlationId: plan.correlationId, event: `composite_execution_${status}` });
    return { plan, result };
  }

  private async require(scope: ExecutionActorScope, planId: string) { const plan = await this.repository.get(scope, planId); if (!plan) throw new ExecutionPlanError("COMPOSITE_PLAN_NOT_FOUND", "The approved scope was not found."); return plan; }
  private async update(plan: CompositeExecutionPlan) { const stored = await this.repository.update(plan, plan.version - 1); if (!stored) throw new ExecutionPlanError("COMPOSITE_PLAN_VERSION_CONFLICT", "The approved scope changed concurrently."); return stored; }
}
