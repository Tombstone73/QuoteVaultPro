import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs, orderLineItems, orders, prepressSessions, productionEvents, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import { lockWorkflowLines } from "./workflowMutationLock";

/** Assignment is not a start. A queued status cannot erase recorded work. */
export function unstartedProductionReturnReason(input: {
  jobs: Array<{ status: string; startedAt?: unknown; completedAt?: unknown; totalSeconds?: number | null }>;
  events: Array<{ type: string; payload?: Record<string, any> | null }>;
}): string | null {
  if (input.jobs.some(job => job.startedAt || Number(job.totalSeconds) > 0)) return "Production has a recorded start or machine time.";
  if (input.jobs.some(job => ["in_progress", "paused"].includes(job.status))) return "Production is running or paused.";
  if (input.events.some(event => ["timer_started", "timer_stopped", "completed", "production_completed"].includes(event.type)
    || (event.type === "status_changed" && ["in_progress", "paused", "done"].includes(String(event.payload?.newStatus ?? event.payload?.toStatus ?? event.payload?.to ?? event.payload?.status))))) return "Production activity history records work on this item.";
  return null;
}

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
  requireUnstarted?: boolean;
}): Promise<ReturnToPrepressResult[]> {
  if (input.jobIds.length === 0) {
    throw new ReturnToPrepressError("Select at least one production job.", 400, "RETURN_TO_PREPRESS_EMPTY_SELECTION");
  }

  // Use the same line-before-job lock order as starts and Order saves.
  const references = await tx.select({ lineItemId: productionJobs.lineItemId }).from(productionJobs)
    .where(and(eq(productionJobs.organizationId, input.organizationId), inArray(productionJobs.id, input.jobIds)));
  if (references.length !== input.jobIds.length || references.some((row: any) => !row.lineItemId)) throw new ReturnToPrepressError("Selected production work changed. Refresh before returning it.", 409, "RETURN_TO_PREPRESS_OWNER_CHANGED");
  await lockWorkflowLines(tx, input.organizationId, references.map((row: any) => row.lineItemId));
  const rows = await tx
    .select({ job: productionJobs, line: orderLineItems, order: orders })
    .from(productionJobs)
    .innerJoin(orderLineItems, and(eq(productionJobs.lineItemId, orderLineItems.id), eq(productionJobs.orderId, orderLineItems.orderId)))
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
    ));
  const activeRunByJobId = new Map(activeRunMembers.map((member: any) => [member.productionJobId, member.runNumber]));

  for (const { job } of rows as Array<any>) {
    const station = String(job.stationKey || "").toLowerCase();
    if ((station === "wide_roll" ? "roll" : station) !== input.station) {
      throw new ReturnToPrepressError(`Job ${job.id} is not owned by the ${input.station} board.`, 422, "RETURN_TO_PREPRESS_WRONG_STATION");
    }
    const activeRunNumber = activeRunByJobId.get(job.id);
    if (activeRunNumber != null) {
      throw new ReturnToPrepressError(`Job ${job.id} belongs to active Combined Run PR-${String(activeRunNumber).padStart(4, "0")}. Open that run and use its member recovery before returning this line.`, 409, "RETURN_TO_PREPRESS_ACTIVE_RUN");
    }
    const blockedReason = getReturnToPrepressBlockedReason({ lineItemId: job.lineItemId, status: job.status });
    if (blockedReason) {
      const guidance = blockedReason === "Currently printing"
        ? "Stop the machine timer and return the job to Queued before retrying."
        : blockedReason === "Production lock active"
          ? "Release the paused production lock and return the job to Queued before retrying."
          : "Use the production recovery workflow for completed work.";
      throw new ReturnToPrepressError(`Job ${job.id} cannot return to Prepress: ${blockedReason}. ${guidance}`, 409);
    }
    const activeOwner = await findActiveJobForLineItem(tx, { organizationId: input.organizationId, lineItemId: job.lineItemId });
    if (!activeOwner || activeOwner.id !== job.id) {
      throw new ReturnToPrepressError(`Job ${job.id} is no longer the active production owner. Refresh and try again.`, 409, "RETURN_TO_PREPRESS_OWNER_CHANGED");
    }
    if (input.requireUnstarted) {
      const history = await tx.select().from(productionJobs).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.lineItemId, job.lineItemId)));
      const physical = history.filter((item: any) => ["roll", "wide_roll", "flatbed"].includes(item.stationKey) && !["prepress", "design", "proofing", "proof"].includes(item.stepKey));
      const events = physical.length ? await tx.select({ type: productionEvents.type, payload: productionEvents.payload }).from(productionEvents)
        .where(and(eq(productionEvents.organizationId, input.organizationId), inArray(productionEvents.productionJobId, physical.map((item: any) => item.id)))) : [];
      const reason = unstartedProductionReturnReason({ jobs: physical, events });
      if (reason) throw new ReturnToPrepressError(`${reason} The Prepress requirement was not saved. Open in Production and use the authorized hold/return or recovery controls; progress will not be reset.`, 409, "RETURN_TO_PREPRESS_STARTED");
    }
    const [eligibility] = await new FulfillmentDashboardRepo(tx).listLineEligibility(input.organizationId, { lineItemIds: [job.lineItemId] }, tx);
    if (input.requireUnstarted && Number(eligibility?.projection.productionCompleteQuantity) > 0) throw new ReturnToPrepressError("Production has recorded completed quantities. Use the existing production recovery workflow; the Prepress requirement was not saved.", 409, "RETURN_TO_PREPRESS_STARTED");
    if (!eligibility || eligibility.projection.fulfilledQuantity > 0 || eligibility.projection.administrativelyReconciledQuantity > 0) {
      throw new ReturnToPrepressError("Fulfilled or administratively resolved quantities require the existing reversal or replacement workflow.", 409, "RETURN_TO_PREPRESS_FULFILLMENT_BOUNDARY");
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
