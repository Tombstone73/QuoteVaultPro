import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AssistantContextEnvelope } from "@shared/assistantContracts";
import { assertTransition, isExpired } from "./stateMachine";
import type {
  ExecutionActorScope, ExecutionCommandRegistry, ExecutionCommandResult, ExecutionConfirmationRecord,
  ExecutionPlanRecord, ExecutionPlanRepository,
} from "./types";
import { ExecutionPlanError } from "./types";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const contextHash = (context: AssistantContextEnvelope) => sha256(JSON.stringify(context));

export interface CreateExecutionPlanRequest {
  conversationId: string;
  turnId?: string;
  /** Resolved internally from a registered planning definition; never route input. */
  commandName: string;
  arguments: Record<string, unknown>;
  context: AssistantContextEnvelope;
  correlationId?: string;
}

export interface ConfirmationIssueResult { token: string; expiresAt: Date; plan: ExecutionPlanRecord; }

export class ExecutionPlanningService {
  constructor(
    private readonly repository: ExecutionPlanRepository,
    private readonly registry: ExecutionCommandRegistry,
    private readonly options: { now?: () => Date; allowTestOnlyExecution?: boolean } = {},
  ) {}

  private now() { return this.options.now?.() ?? new Date(); }

  async getPlan(scope: ExecutionActorScope, planId: string): Promise<ExecutionPlanRecord> {
    return this.requirePlan(scope, planId);
  }

  async createPlan(scope: ExecutionActorScope, request: CreateExecutionPlanRequest): Promise<ExecutionPlanRecord> {
    const command = this.registry.get(request.commandName);
    if (!command) throw new ExecutionPlanError("COMMAND_NOT_REGISTERED", "This action is not available.");
    if (!command.requiredPermissions.every((permission) => scope.permissions.includes(permission))) {
      throw new ExecutionPlanError("PERMISSION_DENIED", "You are not allowed to plan this action.");
    }
    const prepared = await command.buildPreview({ scope, context: request.context, arguments: request.arguments });
    if (prepared.preview.affectedRecords.length > command.maxAffectedRecords) {
      throw new ExecutionPlanError("AFFECTED_RECORD_LIMIT", "This action affects too many records.");
    }
    const now = this.now();
    const base: ExecutionPlanRecord = {
      id: randomUUID(), organizationId: scope.organizationId, userId: scope.userId,
      conversationId: request.conversationId, ...(request.turnId ? { turnId: request.turnId } : {}),
      commandName: command.name, commandVersion: command.version, normalizedAction: command.name,
      sanitizedArguments: prepared.arguments, contextHash: contextHash(request.context), permissionSnapshot: [...scope.permissions].sort(),
      environment: scope.environment, preview: prepared.preview, affectedRecords: prepared.preview.affectedRecords,
      riskLevel: command.riskLevel, status: prepared.preview.missingInformation?.length ? "awaiting_input" : "preview_ready",
      version: 1, idempotencyKey: randomUUID(), correlationId: request.correlationId ?? randomUUID(),
      expiresAt: new Date(now.getTime() + command.confirmationTtlMs), createdAt: now, updatedAt: now,
    };
    const plan = await this.repository.create(base);
    await this.repository.recordAudit({ planId: plan.id, correlationId: plan.correlationId, event: "plan_created" });
    return plan;
  }

  async issueConfirmation(scope: ExecutionActorScope, planId: string, expectedVersion: number): Promise<ConfirmationIssueResult> {
    const plan = await this.requirePlan(scope, planId);
    this.assertCurrentVersion(plan, expectedVersion);
    const current = await this.expireIfNeeded(plan);
    assertTransition(current.status, "awaiting_confirmation");
    const awaiting = await this.transition(current, "awaiting_confirmation");
    const token = randomBytes(32).toString("base64url");
    const confirmation: ExecutionConfirmationRecord = {
      id: randomUUID(), planId: awaiting.id, organizationId: scope.organizationId, userId: scope.userId,
      tokenHash: sha256(token), expiresAt: awaiting.expiresAt,
    };
    await this.repository.createConfirmation(confirmation);
    await this.repository.recordAudit({ planId: awaiting.id, correlationId: awaiting.correlationId, event: "confirmation_issued" });
    return { token, expiresAt: awaiting.expiresAt, plan: awaiting };
  }

  async cancelPlan(scope: ExecutionActorScope, planId: string, expectedVersion: number): Promise<ExecutionPlanRecord> {
    const plan = await this.requirePlan(scope, planId);
    this.assertCurrentVersion(plan, expectedVersion);
    const current = await this.expireIfNeeded(plan);
    const cancelled = await this.transition(current, "cancelled");
    await this.repository.recordAudit({ planId, correlationId: cancelled.correlationId, event: "plan_cancelled" });
    return cancelled;
  }

  async confirmAndExecute(scope: ExecutionActorScope, input: { planId: string; expectedVersion: number; token: string; context: AssistantContextEnvelope }): Promise<{ plan: ExecutionPlanRecord; result?: ExecutionCommandResult }> {
    let plan = await this.requirePlan(scope, input.planId);
    this.assertCurrentVersion(plan, input.expectedVersion);
    plan = await this.expireIfNeeded(plan);
    if (plan.contextHash !== contextHash(input.context)) throw new ExecutionPlanError("CONTEXT_CHANGED", "The plan context changed; create a new plan.");
    if (plan.status !== "awaiting_confirmation") throw new ExecutionPlanError("PLAN_NOT_CONFIRMABLE", "This plan cannot be confirmed.");
    const consumed = await this.repository.consumeConfirmation({ planId: plan.id, organizationId: scope.organizationId, userId: scope.userId, tokenHash: sha256(input.token), now: this.now() });
    if (consumed !== "consumed") throw new ExecutionPlanError(consumed === "already_used" ? "CONFIRMATION_ALREADY_USED" : "INVALID_CONFIRMATION", "The confirmation token is invalid or expired.");
    plan = await this.transition(plan, "confirmed");
    await this.repository.recordAudit({ planId: plan.id, correlationId: plan.correlationId, event: "confirmation_consumed" });
    return this.executeConfirmedPlan(scope, plan, input.context);
  }

  async executeConfirmedPlan(scope: ExecutionActorScope, plan: ExecutionPlanRecord, context: AssistantContextEnvelope): Promise<{ plan: ExecutionPlanRecord; result?: ExecutionCommandResult }> {
    if (plan.contextHash !== contextHash(context)) throw new ExecutionPlanError("CONTEXT_CHANGED", "The plan context changed; create a new plan.");
    if (plan.status !== "confirmed") throw new ExecutionPlanError("PLAN_NOT_CONFIRMED", "This plan is not confirmed.");
    const command = this.registry.get(plan.commandName);
    if (!command) throw new ExecutionPlanError("COMMAND_NOT_REGISTERED", "This action is not available.");
    if (!command.requiredPermissions.every((permission) => scope.permissions.includes(permission))) {
      const invalidated = await this.transition(plan, "invalidated", "PERMISSION_CHANGED", "Permissions changed before execution.");
      throw new ExecutionPlanError("PERMISSION_CHANGED", `Plan ${invalidated.id} was invalidated.`);
    }
    plan = await this.transition(plan, "revalidating");
    const validation = await command.revalidate({ plan, scope });
    if (!validation.valid) {
      const invalidated = await this.transition(plan, "invalidated", validation.code, validation.summary);
      throw new ExecutionPlanError(validation.code, `Plan ${invalidated.id} is stale.`);
    }
    if (!this.options.allowTestOnlyExecution || !command.testOnly) {
      await this.repository.recordAudit({ planId: plan.id, correlationId: plan.correlationId, event: "execution_refused", detail: "No production mutation command is enabled." });
      return { plan };
    }
    const lock = await this.repository.acquireIdempotency({ plan, requestHash: sha256(`${plan.id}:${plan.version}:${plan.contextHash}`), now: this.now() });
    if (lock.kind === "completed") return { plan, result: lock.result };
    if (lock.kind === "in_progress") throw new ExecutionPlanError("EXECUTION_IN_PROGRESS", "This action is already executing.");
    if (lock.kind === "conflict") throw new ExecutionPlanError("IDEMPOTENCY_CONFLICT", "The idempotency key cannot be reused with a different request.");
    plan = await this.transition(plan, "executing");
    const result = await command.execute({ plan, scope });
    await this.repository.recordSteps({ planId: plan.id, steps: result.steps });
    const finalState = result.status === "succeeded" ? "succeeded" : result.status === "partially_failed" ? "partially_failed" : "failed";
    plan = await this.transition(plan, finalState);
    await this.repository.completeIdempotency({ plan, result, now: this.now() });
    await this.repository.recordAudit({ planId: plan.id, correlationId: plan.correlationId, event: `execution_${finalState}` });
    return { plan, result };
  }

  private async requirePlan(scope: ExecutionActorScope, planId: string) {
    const plan = await this.repository.get(scope, planId);
    if (!plan) throw new ExecutionPlanError("PLAN_NOT_FOUND", "Plan not found.");
    return plan;
  }
  private assertCurrentVersion(plan: ExecutionPlanRecord, expectedVersion: number) {
    if (plan.version !== expectedVersion) throw new ExecutionPlanError("PLAN_VERSION_CONFLICT", "The plan changed; reload it before continuing.");
  }
  private async expireIfNeeded(plan: ExecutionPlanRecord): Promise<ExecutionPlanRecord> {
    if (!isExpired(plan, this.now())) return plan;
    if (plan.status === "expired") throw new ExecutionPlanError("PLAN_EXPIRED", "This plan has expired.");
    // A terminal plan cannot be rewritten just because its retention timestamp
    // has since passed. It remains terminal and cannot be confirmed anyway.
    if (["cancelled", "succeeded", "partially_failed", "failed", "invalidated"].includes(plan.status)) return plan;
    await this.transition(plan, "expired");
    throw new ExecutionPlanError("PLAN_EXPIRED", "This plan has expired.");
  }
  private async transition(plan: ExecutionPlanRecord, status: ExecutionPlanRecord["status"], failureCode?: string, failureSummary?: string) {
    assertTransition(plan.status, status);
    const now = this.now();
    const next: ExecutionPlanRecord = { ...plan, status, version: plan.version + 1, updatedAt: now, ...(failureCode ? { failureCode } : {}), ...(failureSummary ? { failureSummary } : {}) };
    const stored = await this.repository.update(next, plan.version);
    if (!stored) throw new ExecutionPlanError("PLAN_VERSION_CONFLICT", "The plan changed concurrently; reload it before continuing.");
    return stored;
  }
}
