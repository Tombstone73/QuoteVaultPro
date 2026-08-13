import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { aiAuditEvents, aiConfirmations, aiExecutionPlans, aiExecutionSteps, aiIdempotencyRecords } from "@shared/schema";
import type {
  ExecutionCommandResult, ExecutionConfirmationRecord, ExecutionPlanRecord, ExecutionPlanRepository,
  ExecutionStepResult,
} from "../services/assistant/execution/types";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toPlan(row: typeof aiExecutionPlans.$inferSelect): ExecutionPlanRecord {
  const preview = row.preview as unknown as ExecutionPlanRecord["preview"];
  const affectedRecords = row.expectedFingerprints as unknown as ExecutionPlanRecord["affectedRecords"];
  return {
    id: row.id, organizationId: row.orgId, userId: row.userId, conversationId: row.conversationId,
    ...(row.turnId ? { turnId: row.turnId } : {}), commandName: row.action, commandVersion: row.commandVersion,
    normalizedAction: row.action, sanitizedArguments: row.sanitizedArguments, contextHash: row.contextHash,
    permissionSnapshot: Array.isArray((row.permissionSnapshot as any).permissions) ? (row.permissionSnapshot as any).permissions : [],
    environment: row.environment, preview, affectedRecords, riskLevel: row.riskLevel as ExecutionPlanRecord["riskLevel"],
    status: row.status as ExecutionPlanRecord["status"], version: row.planVersion,
    idempotencyKey: `plan:${row.id}`, correlationId: row.correlationId, expiresAt: row.expiresAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.failureSummary ? { failureSummary: row.failureSummary } : {}),
  };
}

function toStoredResult(value: unknown): ExecutionCommandResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<ExecutionCommandResult>;
  if ((result.status === "succeeded" || result.status === "partially_failed" || result.status === "failed")
    && typeof result.summary === "string" && Array.isArray(result.steps)) return result as ExecutionCommandResult;
  return null;
}

/** Durable Stage 3 repository. All reads include the authenticated org/user
 * scope and confirmation consumption/idempotency acquisition are atomic DB
 * operations; assistant services never receive a database handle. */
export class DrizzleAssistantExecutionRepository implements ExecutionPlanRepository {
  async create(plan: ExecutionPlanRecord): Promise<ExecutionPlanRecord> {
    const values: typeof aiExecutionPlans.$inferInsert = {
      id: plan.id, orgId: plan.organizationId, userId: plan.userId, conversationId: plan.conversationId,
      ...(plan.turnId ? { turnId: plan.turnId } : {}), action: plan.commandName, commandVersion: plan.commandVersion,
      sanitizedArguments: plan.sanitizedArguments, planHash: hash({ action: plan.commandName, arguments: plan.sanitizedArguments, contextHash: plan.contextHash }),
      contextHash: plan.contextHash, permissionSnapshot: { permissions: [...plan.permissionSnapshot] }, policyVersion: "assistant-execution-v1",
      riskLevel: plan.riskLevel, affectedEntities: Array.from(plan.affectedRecords).map(({ entityType, entityId }) => ({ entityType, entityId })),
      expectedFingerprints: Array.from(plan.affectedRecords) as unknown as Array<Record<string, unknown>>, preview: plan.preview as any, sideEffects: plan.preview.sideEffects.map((description) => ({ description })),
      status: plan.status, planVersion: plan.version, environment: plan.environment, correlationId: plan.correlationId,
      expiresAt: plan.expiresAt, createdAt: plan.createdAt, updatedAt: plan.updatedAt,
    };
    const [row] = await db.insert(aiExecutionPlans).values(values).returning();
    if (!row) throw new Error("Failed to create assistant execution plan.");
    return toPlan(row);
  }

  async get(scope: { organizationId: string; userId: string }, planId: string): Promise<ExecutionPlanRecord | null> {
    const [row] = await db.select().from(aiExecutionPlans).where(and(
      eq(aiExecutionPlans.id, planId), eq(aiExecutionPlans.orgId, scope.organizationId), eq(aiExecutionPlans.userId, scope.userId),
    )).limit(1);
    return row ? toPlan(row) : null;
  }

  async update(plan: ExecutionPlanRecord, expectedVersion: number): Promise<ExecutionPlanRecord | null> {
    const now = plan.updatedAt;
    const timestamps = {
      ...(plan.status === "confirmed" ? { confirmedAt: now } : {}),
      ...(plan.status === "executing" ? { startedAt: now } : {}),
      ...(plan.status === "succeeded" || plan.status === "partially_failed" ? { completedAt: now } : {}),
      ...(plan.status === "failed" ? { failedAt: now } : {}),
      ...(plan.status === "cancelled" ? { cancelledAt: now } : {}),
      ...(plan.status === "expired" ? { expiredAt: now } : {}),
      ...(plan.status === "invalidated" ? { invalidatedAt: now } : {}),
    };
    const [row] = await db.update(aiExecutionPlans).set({
      status: plan.status, planVersion: plan.version, updatedAt: now,
      failureSummary: plan.failureSummary ?? null, ...timestamps,
    }).where(and(eq(aiExecutionPlans.id, plan.id), eq(aiExecutionPlans.orgId, plan.organizationId), eq(aiExecutionPlans.userId, plan.userId), eq(aiExecutionPlans.planVersion, expectedVersion))).returning();
    return row ? toPlan(row) : null;
  }

  async findAwaitingPlan(input: {
    scope: { organizationId: string; userId: string };
    conversationId: string;
    commandName: string;
    arguments: Record<string, unknown>;
    now: Date;
  }): Promise<ExecutionPlanRecord | null> {
    const rows = await db.select().from(aiExecutionPlans).where(and(
      eq(aiExecutionPlans.orgId, input.scope.organizationId),
      eq(aiExecutionPlans.userId, input.scope.userId),
      eq(aiExecutionPlans.conversationId, input.conversationId),
      eq(aiExecutionPlans.action, input.commandName),
      eq(aiExecutionPlans.status, "awaiting_confirmation"),
    ));
    const expected = JSON.stringify(input.arguments);
    const row = rows.find((candidate) => candidate.expiresAt > input.now && JSON.stringify(candidate.sanitizedArguments) === expected);
    return row ? toPlan(row) : null;
  }

  async supersedeAwaitingPlans(input: {
    scope: { organizationId: string; userId: string };
    conversationId: string;
    commandName: string;
    proposalId: string;
    fingerprint: string;
    now: Date;
  }): Promise<number> {
    const rows = await db.select().from(aiExecutionPlans).where(and(
      eq(aiExecutionPlans.orgId, input.scope.organizationId),
      eq(aiExecutionPlans.userId, input.scope.userId),
      eq(aiExecutionPlans.conversationId, input.conversationId),
      eq(aiExecutionPlans.action, input.commandName),
      eq(aiExecutionPlans.status, "awaiting_confirmation"),
    ));
    let superseded = 0;
    for (const row of rows) {
      const argumentsRecord = row.sanitizedArguments as Record<string, unknown>;
      const proposalId = argumentsRecord.proposalId ?? argumentsRecord.productId;
      const fingerprint = argumentsRecord.fingerprint ?? argumentsRecord.proposalFingerprint;
      if (proposalId !== input.proposalId || fingerprint === input.fingerprint) continue;
      const updated = await db.update(aiExecutionPlans).set({
        status: "invalidated",
        planVersion: row.planVersion + 1,
        failureSummary: "Superseded by a material configurable-product proposal edit.",
        invalidatedAt: input.now,
        updatedAt: input.now,
      }).where(and(
        eq(aiExecutionPlans.id, row.id),
        eq(aiExecutionPlans.orgId, input.scope.organizationId),
        eq(aiExecutionPlans.userId, input.scope.userId),
        eq(aiExecutionPlans.status, "awaiting_confirmation"),
        eq(aiExecutionPlans.planVersion, row.planVersion),
      )).returning({ id: aiExecutionPlans.id });
      if (updated.length) superseded += 1;
    }
    return superseded;
  }

  async createConfirmation(confirmation: ExecutionConfirmationRecord): Promise<void> {
    await db.insert(aiConfirmations).values({
      id: confirmation.id, planId: confirmation.planId, orgId: confirmation.organizationId, userId: confirmation.userId,
      tokenHash: confirmation.tokenHash, expiresAt: confirmation.expiresAt,
    });
  }

  async consumeConfirmation(input: { planId: string; organizationId: string; userId: string; tokenHash: string; now: Date }): Promise<"consumed" | "already_used" | "invalid"> {
    const [used] = await db.update(aiConfirmations).set({ status: "used", confirmedAt: input.now, usedAt: input.now }).where(and(
      eq(aiConfirmations.planId, input.planId), eq(aiConfirmations.orgId, input.organizationId), eq(aiConfirmations.userId, input.userId),
      eq(aiConfirmations.tokenHash, input.tokenHash), eq(aiConfirmations.status, "issued"), gt(aiConfirmations.expiresAt, input.now),
    )).returning({ id: aiConfirmations.id });
    if (used) return "consumed";
    const [existing] = await db.select({ status: aiConfirmations.status }).from(aiConfirmations).where(and(
      eq(aiConfirmations.planId, input.planId), eq(aiConfirmations.orgId, input.organizationId), eq(aiConfirmations.userId, input.userId), eq(aiConfirmations.tokenHash, input.tokenHash),
    )).limit(1);
    return existing?.status === "used" ? "already_used" : "invalid";
  }

  async acquireIdempotency(input: { plan: ExecutionPlanRecord; requestHash: string; now: Date }): Promise<{ kind: "acquired" } | { kind: "completed"; result: ExecutionCommandResult } | { kind: "in_progress" } | { kind: "conflict" }> {
    const expiresAt = new Date(input.now.getTime() + 15 * 60_000);
    const inserted = await db.insert(aiIdempotencyRecords).values({
      orgId: input.plan.organizationId, actorUserId: input.plan.userId, commandName: input.plan.commandName,
      commandVersion: input.plan.commandVersion, idempotencyKey: input.plan.idempotencyKey, planId: input.plan.id,
      requestHash: input.requestHash, status: "locked", lockedAt: input.now, expiresAt,
    }).onConflictDoNothing().returning({ id: aiIdempotencyRecords.id });
    if (inserted[0]) return { kind: "acquired" };
    const [existing] = await db.select().from(aiIdempotencyRecords).where(and(
      eq(aiIdempotencyRecords.orgId, input.plan.organizationId), eq(aiIdempotencyRecords.actorUserId, input.plan.userId),
      eq(aiIdempotencyRecords.commandName, input.plan.commandName), eq(aiIdempotencyRecords.commandVersion, input.plan.commandVersion),
      eq(aiIdempotencyRecords.idempotencyKey, input.plan.idempotencyKey),
    )).limit(1);
    if (!existing || existing.requestHash !== input.requestHash) return { kind: "conflict" };
    const result = toStoredResult(existing.resultSummary);
    if (existing.status === "completed" && result) return { kind: "completed", result };
    // An expired abandoned lock becomes explicit unknown state. It is never
    // silently rerun; a user must create a new plan after investigation.
    if (existing.status === "locked" && existing.expiresAt <= input.now) {
      await db.update(aiIdempotencyRecords).set({ status: "unknown", errorReference: "expired_execution_lock" }).where(eq(aiIdempotencyRecords.id, existing.id));
    }
    return { kind: "in_progress" };
  }

  async completeIdempotency(input: { plan: ExecutionPlanRecord; result: ExecutionCommandResult; now: Date }): Promise<void> {
    await db.update(aiIdempotencyRecords).set({ status: "completed", resultReference: input.plan.id, resultSummary: input.result as any, completedAt: input.now }).where(and(
      eq(aiIdempotencyRecords.orgId, input.plan.organizationId), eq(aiIdempotencyRecords.actorUserId, input.plan.userId),
      eq(aiIdempotencyRecords.commandName, input.plan.commandName), eq(aiIdempotencyRecords.commandVersion, input.plan.commandVersion), eq(aiIdempotencyRecords.idempotencyKey, input.plan.idempotencyKey),
    ));
  }

  async recordAudit(input: { planId: string; correlationId: string; event: string; detail?: string }): Promise<void> {
    const [plan] = await db.select({ orgId: aiExecutionPlans.orgId, userId: aiExecutionPlans.userId, conversationId: aiExecutionPlans.conversationId, turnId: aiExecutionPlans.turnId })
      .from(aiExecutionPlans).where(eq(aiExecutionPlans.id, input.planId)).limit(1);
    if (!plan) return;
    await db.insert(aiAuditEvents).values({
      orgId: plan.orgId, actorUserId: plan.userId, conversationId: plan.conversationId, turnId: plan.turnId ?? null,
      eventType: input.event, status: "recorded", correlationId: input.correlationId,
      metadata: { planId: input.planId, detail: input.detail ?? null },
    });
  }

  async recordSteps(input: { planId: string; steps: readonly ExecutionStepResult[] }): Promise<void> {
    const [plan] = await db.select({ orgId: aiExecutionPlans.orgId }).from(aiExecutionPlans).where(eq(aiExecutionPlans.id, input.planId)).limit(1);
    if (!plan) return;
    if (!input.steps.length) return;
    const steps: Array<typeof aiExecutionSteps.$inferInsert> = input.steps.map((step, index) => ({
      orgId: plan.orgId, planId: input.planId, sequence: index + 1, commandName: step.commandName, commandVersion: "v1",
      status: step.status === "succeeded" ? "succeeded" : step.status === "failed" ? "failed" : "skipped",
      resultSummary: { summary: step.summary }, ...(step.status === "failed" ? { errorCode: "command_step_failed" } : {}),
      domainAuditReferences: step.domainAuditReference ? [step.domainAuditReference] : [], completedAt: new Date(),
    }));
    await db.insert(aiExecutionSteps).values(steps).onConflictDoNothing();
  }
}
