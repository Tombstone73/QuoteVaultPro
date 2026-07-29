import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customers, lineItemFiles, orderLineItems, orders, prepressSessions, productionEvents, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";

type MemberInput = { productionJobId: string; allocatedQuantity?: number };
type PrepressMemberInput = { lineItemId: string; allocatedQuantity?: number };
type RunStatus = "draft" | "ready_for_production" | "in_production" | "completed" | "canceled";

export class ProductionRunError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

const activeStatuses: RunStatus[] = ["draft", "ready_for_production", "in_production"];
const terminalJobStatuses = new Set(["done", "void", "canceled", "cancelled"]);

export type ProductionRunListItem = {
  kind: "production_run";
  id: string;
  runId: string;
  runNumber: number;
  displayNumber: string;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  stationKey: string;
  status: "queued" | "in_progress" | "done";
  runStatus: RunStatus;
  plannedSheetCount: number | null;
  nominalPiecesPerSheet: number | null;
  sheetWidth: string | null;
  sheetHeight: string | null;
  notes: string | null;
  memberCount: number;
  totalAllocatedQuantity: number;
  fileCount: number;
  members: Array<{
    id: string;
    productionJobId: string;
    orderLineItemId: string;
    lineNumber: number | null;
    description: string;
    orderedQuantity: number;
    allocatedQuantity: number;
    completedQuantity: number;
    previouslyCompletedQuantity: number;
    remainingAfterRun: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

function toBoardStatus(status: RunStatus): "queued" | "in_progress" | "done" {
  if (status === "completed" || status === "canceled") return "done";
  if (status === "in_production") return "in_progress";
  return "queued";
}

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
  return db.transaction(async (tx) => createProductionRunInTransaction(tx, input));
}

async function createProductionRunInTransaction(tx: any, input: {
  organizationId: string; actorUserId: string; orderId: string; stationKey: string;
  members: MemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one eligible production job.");
  const uniqueIds = Array.from(new Set(input.members.map((member) => member.productionJobId).filter(Boolean)));
  if (uniqueIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A production job may only appear once in a run.");

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`production-run:${input.organizationId}:${input.orderId}`}))`);
  const jobs = await tx.select({ job: productionJobs, line: orderLineItems }).from(productionJobs)
    .innerJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
    .where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.orderId, input.orderId), inArray(productionJobs.id, uniqueIds)));
  if (jobs.length !== uniqueIds.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected production jobs are unavailable for this order.", 404);
  if (jobs.some(({ job, line }: any) => !job.lineItemId || terminalJobStatuses.has(String(job.status || "").toLowerCase()) || line.productionBypassed || line.lineItemRole === "parent")) {
    throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected jobs must be active physical production line items.");
  }
  const stationKeys = new Set(jobs.map(({ job }: any) => String(job.stationKey || "").trim()).filter(Boolean));
  if (stationKeys.size > 0 && !stationKeys.has(input.stationKey)) {
    throw new ProductionRunError("PRODUCTION_RUN_INCOMPATIBLE", "Production run station must match the selected jobs.");
  }
  const hasStationConflict = stationKeys.size > 1;
  const materialKeys = new Set(jobs.map(({ line }: any) => String(line.materialId || "").trim()).filter(Boolean));
  const hasMaterialConflict = materialKeys.size > 1;
  if ((hasStationConflict || hasMaterialConflict) && !input.compatibilityOverrideReason?.trim()) {
    throw new ProductionRunError("PRODUCTION_RUN_INCOMPATIBLE", "Selected jobs use different production routing or material. Supply an authorized compatibility override reason.");
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
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: "CREATE",
    entityType: "production_run",
    entityId: run.id,
    entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
    description: "Combined production run created",
    newValues: { orderId: input.orderId, stationKey: input.stationKey, members: allocations },
  } as any);
  return { run, members };
}

export async function createPrepressProductionRun(input: {
  organizationId: string; actorUserId: string; orderId: string; stationKey: string;
  members: PrepressMemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one eligible prepress item.");
  const uniqueLineItemIds = Array.from(new Set(input.members.map((member) => member.lineItemId).filter(Boolean)));
  if (uniqueLineItemIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A line item may only appear once in a run.");

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`production-run:${input.organizationId}:${input.orderId}`}))`);

    const selectedRows = await tx
      .select({ line: orderLineItems })
      .from(orderLineItems)
      .innerJoin(orders, and(eq(orderLineItems.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
      .where(and(eq(orderLineItems.orderId, input.orderId), inArray(orderLineItems.id, uniqueLineItemIds)));

    if (selectedRows.length !== uniqueLineItemIds.length) {
      throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected prepress items are unavailable for this order.", 404);
    }

    const terminalLineStatuses = new Set(["done", "complete", "completed", "void", "canceled", "cancelled"]);
    if (selectedRows.some(({ line }) => terminalLineStatuses.has(String(line.status || "").toLowerCase()) || terminalLineStatuses.has(String(line.workflowState || "").toLowerCase()) || line.productionBypassed || line.lineItemRole === "parent")) {
      throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected items must be active physical production line items.");
    }

    const finalRows = await tx
      .select({ lineItemId: lineItemFiles.lineItemId })
      .from(lineItemFiles)
      .where(and(
        eq(lineItemFiles.organizationId, input.organizationId),
        inArray(lineItemFiles.lineItemId, uniqueLineItemIds),
        eq(lineItemFiles.role, "final"),
        eq(lineItemFiles.status, "active"),
      ));
    const finalLineItemIds = new Set(finalRows.map((row) => row.lineItemId));
    const missingFinal = selectedRows.find(({ line }) => !finalLineItemIds.has(line.id));
    if (missingFinal) {
      throw new ProductionRunError("PRODUCTION_RUN_FINAL_FILE_REQUIRED", `Complete prepress final artwork before creating a run for ${missingFinal.line.description || "the selected line item"}.`, 409);
    }

    const downstreamMembers: MemberInput[] = [];
    for (const { line } of selectedRows) {
      const activeJob = await findActiveJobForLineItem(tx, { organizationId: input.organizationId, lineItemId: line.id });
      if (!activeJob || !isPrepressOwnershipJob(activeJob) || terminalJobStatuses.has(String(activeJob.status || "").toLowerCase())) {
        throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected items must be actively owned by Prepress before creating a combined run.");
      }

      const transition = await transitionLineItemWorkflowState(tx, {
        organizationId: input.organizationId,
        lineItemId: line.id,
        toState: "ready_for_production",
        actorUserId: input.actorUserId,
        metadata: { source: "prepress_combined_production_run", requestedRunStationKey: input.stationKey },
      });

      if (!transition.activeOwnerJobId) {
        throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Prepress handoff did not create downstream production ownership.");
      }

      await tx
        .update(prepressSessions)
        .set({ status: "complete", completedAt: new Date(), completedByUserId: input.actorUserId })
        .where(and(
          eq(prepressSessions.organizationId, input.organizationId),
          eq(prepressSessions.lineItemId, line.id),
          eq(prepressSessions.status, "active"),
        ));

      const requested = input.members.find((member) => member.lineItemId === line.id)?.allocatedQuantity;
      downstreamMembers.push({ productionJobId: transition.activeOwnerJobId, allocatedQuantity: requested });
    }

    return createProductionRunInTransaction(tx, { ...input, members: downstreamMembers });
  });
}

export async function listProductionRuns(input: {
  organizationId: string;
  orderId?: string | null;
  stationKey?: string | null;
  status?: "queued" | "in_progress" | "done" | null;
}): Promise<ProductionRunListItem[]> {
  const runRows = await db
    .select({
      run: productionRuns,
      orderNumber: orders.orderNumber,
      orderDisplayNumber: orders.displayNumber,
      orderNumberCore: orders.numberCore,
      customerId: customers.id,
      customerName: customers.companyName,
    })
    .from(productionRuns)
    .innerJoin(orders, and(eq(productionRuns.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, input.organizationId)))
    .where(and(
      eq(productionRuns.organizationId, input.organizationId),
      input.orderId ? eq(productionRuns.orderId, input.orderId) : undefined,
      input.stationKey ? eq(productionRuns.stationKey, input.stationKey) : undefined,
    ))
    .orderBy(desc(productionRuns.createdAt), desc(productionRuns.runNumber));

  if (runRows.length === 0) return [];

  const runIds = runRows.map(({ run }) => run.id);
  const memberRows = await db
    .select({
      member: productionRunMembers,
      lineDescription: orderLineItems.description,
      lineQuantity: orderLineItems.quantity,
      lineSortOrder: orderLineItems.sortOrder,
      lineCreatedAt: orderLineItems.createdAt,
    })
    .from(productionRunMembers)
    .innerJoin(orderLineItems, eq(orderLineItems.id, productionRunMembers.orderLineItemId))
    .where(and(eq(productionRunMembers.organizationId, input.organizationId), inArray(productionRunMembers.productionRunId, runIds)))
    .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

  const completedByJob = new Map<string, number>();
  const memberJobIds = Array.from(new Set(memberRows.map(({ member }) => member.productionJobId)));
  if (memberJobIds.length > 0) {
    const completedRows = await db
      .select({
        productionJobId: productionRunMembers.productionJobId,
        quantity: sql<number>`coalesce(sum(${productionRunMembers.completedQuantity}), 0)::int`,
      })
      .from(productionRunMembers)
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, input.organizationId)))
      .where(and(
        eq(productionRunMembers.organizationId, input.organizationId),
        inArray(productionRunMembers.productionJobId, memberJobIds),
        eq(productionRuns.status, "completed"),
      ))
      .groupBy(productionRunMembers.productionJobId);
    for (const row of completedRows) completedByJob.set(row.productionJobId, Number(row.quantity) || 0);
  }

  const fileCounts = await db
    .select({
      productionRunId: lineItemFiles.productionRunId,
      count: sql<number>`count(*)::int`,
    })
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.organizationId, input.organizationId),
      inArray(lineItemFiles.productionRunId, runIds),
      eq(lineItemFiles.status, "active"),
      eq(lineItemFiles.role, "final"),
    ))
    .groupBy(lineItemFiles.productionRunId);
  const fileCountByRunId = new Map(fileCounts.map((row) => [String(row.productionRunId), Number(row.count) || 0]));

  const lineNumbersByOrder = new Map<string, Map<string, number>>();
  for (const row of memberRows) {
    const run = runRows.find((candidate) => candidate.run.id === row.member.productionRunId)?.run;
    if (!run) continue;
    let orderMap = lineNumbersByOrder.get(run.orderId);
    if (!orderMap) {
      orderMap = new Map();
      lineNumbersByOrder.set(run.orderId, orderMap);
    }
    if (!orderMap.has(row.member.orderLineItemId)) orderMap.set(row.member.orderLineItemId, orderMap.size + 1);
  }

  const membersByRunId = new Map<string, ProductionRunListItem["members"]>();
  for (const row of memberRows) {
    const run = runRows.find((candidate) => candidate.run.id === row.member.productionRunId)?.run;
    const previouslyCompletedQuantity = Math.max(0, (completedByJob.get(row.member.productionJobId) ?? 0) - Number(row.member.completedQuantity || 0));
    const remainingAfterRun = Math.max(0, Number(row.lineQuantity || 0) - previouslyCompletedQuantity - Number(row.member.allocatedQuantity || 0));
    const list = membersByRunId.get(row.member.productionRunId) ?? [];
    list.push({
      id: row.member.id,
      productionJobId: row.member.productionJobId,
      orderLineItemId: row.member.orderLineItemId,
      lineNumber: run ? lineNumbersByOrder.get(run.orderId)?.get(row.member.orderLineItemId) ?? null : null,
      description: String(row.lineDescription || `Line item ${row.member.orderLineItemId.slice(-6)}`),
      orderedQuantity: Number(row.lineQuantity) || 0,
      allocatedQuantity: Number(row.member.allocatedQuantity) || 0,
      completedQuantity: Number(row.member.completedQuantity) || 0,
      previouslyCompletedQuantity,
      remainingAfterRun,
    });
    membersByRunId.set(row.member.productionRunId, list);
  }

  return runRows
    .map(({ run, orderNumber, orderDisplayNumber, orderNumberCore, customerId, customerName }) => {
      const boardStatus = toBoardStatus(run.status as RunStatus);
      const members = membersByRunId.get(run.id) ?? [];
      return {
        kind: "production_run" as const,
        id: run.id,
        runId: run.id,
        runNumber: Number(run.runNumber),
        displayNumber: `PR-${String(run.runNumber).padStart(4, "0")}`,
        orderId: run.orderId,
        orderNumber: String(orderDisplayNumber ?? orderNumberCore ?? orderNumber ?? ""),
        customerId: customerId ?? null,
        customerName: customerName ?? "Unassigned customer",
        stationKey: run.stationKey,
        status: boardStatus,
        runStatus: run.status as RunStatus,
        plannedSheetCount: run.plannedSheetCount ?? null,
        nominalPiecesPerSheet: run.nominalPiecesPerSheet ?? null,
        sheetWidth: run.sheetWidth ? String(run.sheetWidth) : null,
        sheetHeight: run.sheetHeight ? String(run.sheetHeight) : null,
        notes: run.notes ?? null,
        memberCount: members.length,
        totalAllocatedQuantity: members.reduce((sum, member) => sum + member.allocatedQuantity, 0),
        fileCount: fileCountByRunId.get(run.id) ?? 0,
        members,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      };
    })
    .filter((run) => !input.status || run.status === input.status);
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
      const members = await tx.select().from(productionRunMembers).where(and(eq(productionRunMembers.productionRunId, run.id), eq(productionRunMembers.organizationId, input.organizationId)));
      if (!members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "A production run must have members.");
      await tx.update(productionRuns).set({ ...next, updatedAt: now }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, input.organizationId)));
      for (const member of members) {
        await tx.update(productionRunMembers).set({ completedQuantity: member.allocatedQuantity, updatedAt: now }).where(and(eq(productionRunMembers.id, member.id), eq(productionRunMembers.organizationId, input.organizationId)));
        const [line] = await tx.select({ quantity: orderLineItems.quantity }).from(orderLineItems).where(eq(orderLineItems.id, member.orderLineItemId));
        const [completed] = await tx.select({ quantity: sql<number>`coalesce(sum(${productionRunMembers.completedQuantity}), 0)` }).from(productionRunMembers).innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, input.organizationId))).where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRunMembers.productionJobId, member.productionJobId), eq(productionRuns.status, "completed")));
        if (Number(completed?.quantity ?? 0) >= Number(line?.quantity ?? 0)) await tx.update(productionJobs).set({ status: "done", completedAt: now, completedByUserId: input.actorUserId, updatedAt: now }).where(and(eq(productionJobs.id, member.productionJobId), eq(productionJobs.organizationId, input.organizationId)));
        else await tx.update(productionJobs).set({ status: "in_progress", updatedAt: now }).where(and(eq(productionJobs.id, member.productionJobId), eq(productionJobs.organizationId, input.organizationId)));
        await tx.insert(productionEvents).values({
          organizationId: input.organizationId,
          productionJobId: member.productionJobId,
          orderLineItemId: member.orderLineItemId,
          orderId: run.orderId,
          actorUserId: input.actorUserId,
          type: "note",
          payload: {
            eventType: "production_run_completed_quantity_applied",
            productionRunId: run.id,
            allocatedQuantity: member.allocatedQuantity,
            completedQuantity: member.allocatedQuantity,
          },
        });
      }
      const [updatedAfterCompletion] = await tx.select().from(productionRuns).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, input.organizationId))).limit(1);
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        actionType: "UPDATE",
        entityType: "production_run",
        entityId: run.id,
        entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
        description: "Production run complete",
        oldValues: { status: run.status },
        newValues: { status: updatedAfterCompletion?.status ?? "completed", memberCount: members.length },
      } as any);
      return updatedAfterCompletion;
    }
    const [updated] = await tx.update(productionRuns).set({ ...next, updatedAt: now }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "UPDATE",
      entityType: "production_run",
      entityId: run.id,
      entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
      description: `Production run ${input.action}`,
      oldValues: { status: run.status },
      newValues: { status: updated.status, reason: input.reason ?? null },
    } as any);
    return updated;
  });
}
