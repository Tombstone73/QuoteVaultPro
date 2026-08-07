import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { aiAuditEvents, aiCompositeExecutionPlans, aiConfirmations } from "@shared/schema";
import type { CompositeExecutionPlan, CompositeExecutionPlanRepository, CompositeExecutionResult } from "../services/assistant/execution/compositeExecutionPlanningService";

function toPlan(row: typeof aiCompositeExecutionPlans.$inferSelect): CompositeExecutionPlan {
  return {
    id: row.id,
    organizationId: row.orgId,
    userId: row.userId,
    conversationId: row.conversationId,
    contextHash: row.contextHash,
    fingerprint: row.compositeFingerprint,
    status: row.status as CompositeExecutionPlan["status"],
    version: row.planVersion,
    correlationId: row.correlationId,
    expiresAt: row.expiresAt,
    operations: row.operations as unknown as CompositeExecutionPlan["operations"],
    ...(row.result ? { result: row.result as CompositeExecutionResult } : {}),
  };
}

/** Durable parent composition state. Confirmation consumption intentionally
 * uses ai_confirmations, the same atomic GO-token store as normal commands. */
export class DrizzleCompositeAssistantExecutionRepository implements CompositeExecutionPlanRepository {
  async create(plan: CompositeExecutionPlan): Promise<CompositeExecutionPlan> {
    const [row] = await db.insert(aiCompositeExecutionPlans).values({
      id: plan.id, orgId: plan.organizationId, userId: plan.userId, conversationId: plan.conversationId,
      contextHash: plan.contextHash, compositeFingerprint: plan.fingerprint, operations: plan.operations as any,
      status: plan.status, planVersion: plan.version, correlationId: plan.correlationId, expiresAt: plan.expiresAt,
      ...(plan.result ? { result: plan.result as any } : {}),
    }).returning();
    if (!row) throw new Error("Failed to create composite assistant execution plan.");
    return toPlan(row);
  }

  async get(scope: { organizationId: string; userId: string }, planId: string): Promise<CompositeExecutionPlan | null> {
    const [row] = await db.select().from(aiCompositeExecutionPlans).where(and(
      eq(aiCompositeExecutionPlans.id, planId), eq(aiCompositeExecutionPlans.orgId, scope.organizationId), eq(aiCompositeExecutionPlans.userId, scope.userId),
    )).limit(1);
    return row ? toPlan(row) : null;
  }

  async update(plan: CompositeExecutionPlan, expectedVersion: number): Promise<CompositeExecutionPlan | null> {
    const [row] = await db.update(aiCompositeExecutionPlans).set({
      status: plan.status, planVersion: plan.version, result: plan.result ? plan.result as any : null, updatedAt: new Date(),
    }).where(and(
      eq(aiCompositeExecutionPlans.id, plan.id), eq(aiCompositeExecutionPlans.orgId, plan.organizationId),
      eq(aiCompositeExecutionPlans.userId, plan.userId), eq(aiCompositeExecutionPlans.planVersion, expectedVersion),
    )).returning();
    return row ? toPlan(row) : null;
  }

  async createConfirmation(input: { planId: string; organizationId: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(aiConfirmations).values({
      compositePlanId: input.planId, orgId: input.organizationId, userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt,
    });
  }

  async consumeConfirmation(input: { planId: string; organizationId: string; userId: string; tokenHash: string; now: Date }): Promise<"consumed" | "already_used" | "invalid"> {
    const where = and(
      eq(aiConfirmations.compositePlanId, input.planId), eq(aiConfirmations.orgId, input.organizationId), eq(aiConfirmations.userId, input.userId), eq(aiConfirmations.tokenHash, input.tokenHash),
    );
    const [used] = await db.update(aiConfirmations).set({ status: "used", confirmedAt: input.now, usedAt: input.now }).where(and(
      where, eq(aiConfirmations.status, "issued"), gt(aiConfirmations.expiresAt, input.now),
    )).returning({ id: aiConfirmations.id });
    if (used) return "consumed";
    const [existing] = await db.select({ status: aiConfirmations.status }).from(aiConfirmations).where(where).limit(1);
    return existing?.status === "used" ? "already_used" : "invalid";
  }

  async recordAudit(input: { planId: string; correlationId: string; event: string }): Promise<void> {
    const [plan] = await db.select({ orgId: aiCompositeExecutionPlans.orgId, userId: aiCompositeExecutionPlans.userId, conversationId: aiCompositeExecutionPlans.conversationId })
      .from(aiCompositeExecutionPlans).where(eq(aiCompositeExecutionPlans.id, input.planId)).limit(1);
    if (!plan) return;
    await db.insert(aiAuditEvents).values({
      orgId: plan.orgId, actorUserId: plan.userId, conversationId: plan.conversationId, eventType: input.event,
      status: "recorded", correlationId: input.correlationId, metadata: { compositePlanId: input.planId },
    });
  }
}
