import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, orderLineItems, orders, prepressSessions, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";

export class ReturnToPrepressError extends Error {
  constructor(message: string, readonly statusCode = 409, readonly code = "RETURN_TO_PREPRESS_BLOCKED") {
    super(message);
  }
}

export type ReturnToPrepressResult = {
  previousJobId: string;
  prepressJobId: string;
  lineItemId: string;
  sessionId: string;
};

export function getReturnToPrepressBlockedReason(job: {
  lineItemId?: string | null;
  status?: string | null;
  timerIsRunning?: boolean;
}): string | null {
  if (!job.lineItemId) return "Missing line-item workflow data";
  const status = String(job.status || "").toLowerCase();
  if (status === "done") return "Completed job";
  if (status === "in_progress" || job.timerIsRunning) return "Currently printing";
  if (status === "paused") return "Production lock active";
  if (status !== "queued") return "Recovery required";
  return null;
}

export async function returnProductionJobsToPrepressInTransaction(tx: any, input: {
  organizationId: string;
  actorUserId: string;
  station: "flatbed" | "roll";
  jobIds: string[];
  reason: string;
}): Promise<ReturnToPrepressResult[]> {
  if (input.jobIds.length === 0) {
    throw new ReturnToPrepressError("Select at least one production job.", 400, "RETURN_TO_PREPRESS_EMPTY_SELECTION");
  }

  const rows = await tx
    .select({ job: productionJobs, line: orderLineItems, order: orders })
    .from(productionJobs)
    .innerJoin(orderLineItems, eq(productionJobs.lineItemId, orderLineItems.id))
    .innerJoin(orders, eq(productionJobs.orderId, orders.id))
    .where(and(
      eq(productionJobs.organizationId, input.organizationId),
      inArray(productionJobs.id, input.jobIds),
      eq(orders.organizationId, input.organizationId),
    ))
    .for("update");
  if (rows.length !== input.jobIds.length) {
    throw new ReturnToPrepressError("One or more selected jobs no longer have a valid tenant-owned order and line item.", 422, "RETURN_TO_PREPRESS_INVALID_SELECTION");
  }

  const activeRunMembers = await tx
    .select({ productionJobId: productionRunMembers.productionJobId, runNumber: productionRuns.runNumber })
    .from(productionRunMembers)
    .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
    .where(and(
      eq(productionRunMembers.organizationId, input.organizationId),
      inArray(productionRunMembers.productionJobId, input.jobIds),
      inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
      sql`coalesce(${productionRunMembers.remainingQuantity}, 0) > 0`,
    ));
  const activeRunByJobId = new Map(activeRunMembers.map((member: any) => [member.productionJobId, member.runNumber]));

  for (const { job } of rows as Array<any>) {
    if (String(job.stationKey || "").toLowerCase() !== input.station) {
      throw new ReturnToPrepressError(`Job ${job.id} is not owned by the ${input.station} board.`, 422, "RETURN_TO_PREPRESS_WRONG_STATION");
    }
    const activeRunNumber = activeRunByJobId.get(job.id);
    if (activeRunNumber != null) {
      throw new ReturnToPrepressError(`Job ${job.id} is owned by active Combined Run PR-${String(activeRunNumber).padStart(4, "0")}.`, 409, "RETURN_TO_PREPRESS_ACTIVE_RUN");
    }
    const blockedReason = getReturnToPrepressBlockedReason({ lineItemId: job.lineItemId, status: job.status });
    if (blockedReason) throw new ReturnToPrepressError(`Job ${job.id} cannot return to Prepress: ${blockedReason}.`, 409);
    const activeOwner = await findActiveJobForLineItem(tx, { organizationId: input.organizationId, lineItemId: job.lineItemId });
    if (!activeOwner || activeOwner.id !== job.id) {
      throw new ReturnToPrepressError(`Job ${job.id} is no longer the active production owner. Refresh and try again.`, 409, "RETURN_TO_PREPRESS_OWNER_CHANGED");
    }
  }

  const results: ReturnToPrepressResult[] = [];
  for (const { job, line } of rows as Array<any>) {
    const workflowTransition = await transitionLineItemWorkflowState(tx, {
      organizationId: input.organizationId,
      lineItemId: line.id,
      toState: "in_prepress",
      actorUserId: input.actorUserId,
      note: input.reason,
      metadata: { source: "production_return_to_prepress", previousJobId: job.id },
    });
    if (!workflowTransition.activeOwnerJobId || !isPrepressOwnershipJob({
      stationKey: workflowTransition.activeOwnerStationKey,
      stepKey: workflowTransition.activeOwnerStepKey,
    })) {
      throw new ReturnToPrepressError(`Job ${job.id} could not be restored to Prepress safely.`, 409, "RETURN_TO_PREPRESS_RESTORE_FAILED");
    }

    const sessionNote = `[RETURNED TO PREPRESS]\n${input.reason}`;
    const [activeSession] = await tx
      .select({ id: prepressSessions.id, notesText: prepressSessions.notesText })
      .from(prepressSessions)
      .where(and(
        eq(prepressSessions.organizationId, input.organizationId),
        eq(prepressSessions.lineItemId, line.id),
        eq(prepressSessions.status, "active"),
      ))
      .orderBy(desc(prepressSessions.updatedAt), desc(prepressSessions.startedAt))
      .limit(1);
    let sessionId: string;
    if (activeSession) {
      const previousNotes = String(activeSession.notesText || "").trim();
      await tx.update(prepressSessions).set({
        lockOwnerUserId: input.actorUserId,
        issueFlag: true,
        issueType: "production_edit_request",
        notesText: previousNotes.includes(sessionNote) ? previousNotes : [previousNotes, sessionNote].filter(Boolean).join("\n\n"),
        updatedAt: new Date(),
      }).where(eq(prepressSessions.id, activeSession.id));
      sessionId = activeSession.id;
    } else {
      const [session] = await tx.insert(prepressSessions).values({
        organizationId: input.organizationId,
        orderId: line.orderId,
        lineItemId: line.id,
        status: "active",
        startedByUserId: input.actorUserId,
        lockOwnerUserId: input.actorUserId,
        issueFlag: true,
        issueType: "production_edit_request",
        notesText: sessionNote,
      }).returning({ id: prepressSessions.id });
      sessionId = session.id;
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "UPDATE",
      entityType: "order_line_item",
      entityId: line.id,
      entityName: `Line item ${line.id}`,
      description: "Returned to Prepress from production board",
      oldValues: { productionJobId: job.id, workflowState: line.workflowState, status: line.status },
      newValues: { productionJobId: workflowTransition.activeOwnerJobId, workflowState: "in_prepress", reason: input.reason, sessionId },
    } as any);
    results.push({ previousJobId: job.id, prepressJobId: workflowTransition.activeOwnerJobId, lineItemId: line.id, sessionId });
  }
  return results;
}
