import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { orderLineItems, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";

type MemberInput = { productionJobId: string; allocatedQuantity?: number };
type RunStatus = "draft" | "ready_for_production" | "in_production" | "completed" | "canceled";

export class ProductionRunError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

const activeStatuses: RunStatus[] = ["draft", "ready_for_production", "in_production"];

/**
 * Serializes allocation checks per job. A run never takes ownership of a line
 * item; it only reserves an explicit quantity against its existing job.
 */
export async function createProductionRun(input: {
  organizationId: string; actorUserId: string; orderId: string; stationKey: string;
  members: MemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one eligible production job.");
  const uniqueIds = Array.from(new Set(input.members.map((member) => member.productionJobId).filter(Boolean)));
  if (uniqueIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A production job may only appear once in a run.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`production-run:${input.organizationId}:${input.orderId}`}))`);
    const jobs = await tx.select({ job: productionJobs, line: orderLineItems }).from(productionJobs)
      .innerJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
      .where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.orderId, input.orderId), inArray(productionJobs.id, uniqueIds)));
    if (jobs.length !== uniqueIds.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected production jobs are unavailable for this order.", 404);
    if (jobs.some(({ job, line }) => !job.lineItemId || job.status === "done" || job.status === "void" || line.productionBypassed || line.lineItemRole === "parent")) {
      throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected jobs must be active physical production line items.");
    }
    if (new Set(jobs.map(({ job }) => job.stationKey)).size > 1 && !input.compatibilityOverrideReason?.trim()) {
      throw new ProductionRunError("PRODUCTION_RUN_INCOMPATIBLE", "Selected jobs use different production stations. Supply an authorized compatibility override reason.");
    }
    const allocations = [] as Array<{ productionJobId: string; orderLineItemId: string; allocatedQuantity: number }>;
    for (const { job, line } of jobs) {
      const [totals] = await tx.select({
        reserved: sql<number>`coalesce(sum(case when ${productionRuns.status} in ('draft','ready_for_production','in_production') then ${productionRunMembers.allocatedQuantity} else 0 end), 0)`,
        completed: sql<number>`coalesce(sum(case when ${productionRuns.status} = 'completed' then ${productionRunMembers.completedQuantity} else 0 end), 0)`,
      }).from(productionRunMembers).innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
        .where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRunMembers.productionJobId, job.id)));
      const remaining = Math.max(0, Number(line.quantity) - Number(totals?.reserved ?? 0) - Number(totals?.completed ?? 0));
      const requested = input.members.find((member) => member.productionJobId === job.id)?.allocatedQuantity ?? remaining;
      if (!Number.isInteger(requested) || requested <= 0 || requested > remaining) throw new ProductionRunError("PRODUCTION_RUN_ALLOCATION_INVALID", `Allocation for ${line.description} must be between 1 and ${remaining}.`);
      allocations.push({ productionJobId: job.id, orderLineItemId: line.id, allocatedQuantity: requested });
    }
    const [numberRow] = await tx.select({ next: sql<number>`coalesce(max(${productionRuns.runNumber}), 0) + 1` }).from(productionRuns).where(eq(productionRuns.organizationId, input.organizationId));
    const [run] = await tx.insert(productionRuns).values({ organizationId: input.organizationId, orderId: input.orderId, runNumber: Number(numberRow?.next ?? 1), stationKey: input.stationKey, plannedSheetCount: input.plannedSheetCount ?? null, nominalPiecesPerSheet: input.nominalPiecesPerSheet ?? null, sheetWidth: input.sheetWidth?.toString() ?? null, sheetHeight: input.sheetHeight?.toString() ?? null, notes: input.notes ?? null, compatibilityOverrideReason: input.compatibilityOverrideReason ?? null, createdByUserId: input.actorUserId }).returning();
    const members = await tx.insert(productionRunMembers).values(allocations.map((member) => ({ ...member, organizationId: input.organizationId, productionRunId: run.id }))).returning();
    return { run, members };
  });
}

export async function transitionProductionRun(input: { organizationId: string; runId: string; actorUserId: string; action: "release" | "start" | "complete" | "cancel"; reason?: string | null }) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(productionRuns).where(and(eq(productionRuns.id, input.runId), eq(productionRuns.organizationId, input.organizationId))).limit(1);
    if (!run) throw new ProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Production run was not found.", 404);
    if (input.action === "complete" && run.status === "completed") return run;
    if (run.status === "completed" || run.status === "canceled") throw new ProductionRunError("PRODUCTION_RUN_TERMINAL", "Completed or canceled production runs cannot be changed.", 409);
    const now = new Date();
    const next: Partial<typeof productionRuns.$inferInsert> = input.action === "release" ? { status: "ready_for_production", releasedAt: now } : input.action === "start" ? { status: "in_production", startedAt: now } : input.action === "cancel" ? { status: "canceled", canceledAt: now, canceledByUserId: input.actorUserId, cancelReason: input.reason?.trim() || null } : { status: "completed", completedAt: now };
    if (input.action === "complete") {
      if (run.status !== "ready_for_production" && run.status !== "in_production") throw new ProductionRunError("PRODUCTION_RUN_NOT_RELEASABLE", "Release the production run before completing it.", 409);
      const members = await tx.select().from(productionRunMembers).where(eq(productionRunMembers.productionRunId, run.id));
      if (!members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "A production run must have members.");
      for (const member of members) {
        await tx.update(productionRunMembers).set({ completedQuantity: member.allocatedQuantity, updatedAt: now }).where(eq(productionRunMembers.id, member.id));
        const [line] = await tx.select({ quantity: orderLineItems.quantity }).from(orderLineItems).where(eq(orderLineItems.id, member.orderLineItemId));
        const [completed] = await tx.select({ quantity: sql<number>`coalesce(sum(${productionRunMembers.completedQuantity}), 0)` }).from(productionRunMembers).innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId)).where(and(eq(productionRunMembers.productionJobId, member.productionJobId), eq(productionRuns.status, "completed")));
        if (Number(completed?.quantity ?? 0) >= Number(line?.quantity ?? 0)) await tx.update(productionJobs).set({ status: "done", completedAt: now, completedByUserId: input.actorUserId, updatedAt: now }).where(eq(productionJobs.id, member.productionJobId));
        else await tx.update(productionJobs).set({ status: "in_progress", updatedAt: now }).where(eq(productionJobs.id, member.productionJobId));
      }
    }
    const [updated] = await tx.update(productionRuns).set({ ...next, updatedAt: now }).where(eq(productionRuns.id, run.id)).returning();
    return updated;
  });
}
