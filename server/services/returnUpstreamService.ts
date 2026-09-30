import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, orderLineItems, orders, prepressSessions, productionJobs, productionRunMembers, productionRuns, userOrganizations } from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { isCanceledOrder, isTerminalProductionStatus } from "@shared/operationalState";
import { db } from "../db";
import { lockWorkflowLines } from "./workflowMutationLock";
import { isPrepressOwnershipJob } from "./productionOwnership";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { autoSyncCanonicalProofForLineItem, retireProofAuthorityForUpstream } from "./proofingService";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";

export const returnUpstreamRequestSchema = z.object({
  destination: z.enum(["proofing", "design"]),
  reason: z.string().trim().min(1).max(2000),
  expectedWorkflowState: z.enum(["ready_for_prepress", "in_prepress"]),
  expectedOwnerJobId: z.string().trim().min(1),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export type ReturnUpstreamInput = z.infer<typeof returnUpstreamRequestSchema> & {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
};

export class ReturnUpstreamError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode = 409) { super(message); }
}

export async function returnUpstream(input: ReturnUpstreamInput) {
  return db.transaction((tx) => returnUpstreamInTransaction(tx, input));
}

/** All decisions and audit writes share the caller's transaction. Never call with the global db executor. */
export async function returnUpstreamInTransaction(tx: any, input: ReturnUpstreamInput) {
  const command = returnUpstreamRequestSchema.parse({
    destination: input.destination, reason: input.reason, expectedWorkflowState: input.expectedWorkflowState,
    expectedOwnerJobId: input.expectedOwnerJobId, expectedUpdatedAt: input.expectedUpdatedAt,
  });
  const [membership] = await tx.select({ role: userOrganizations.role }).from(userOrganizations)
    .where(and(eq(userOrganizations.organizationId, input.organizationId), eq(userOrganizations.userId, input.actorUserId)));
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new ReturnUpstreamError("Organization Owner or Admin role required.", "UPSTREAM_FORBIDDEN", 403);
  }
  await lockWorkflowLines(tx, input.organizationId, [input.lineItemId]);
  const [row] = await tx.select({ line: orderLineItems, order: orders }).from(orderLineItems)
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(and(eq(orders.organizationId, input.organizationId), eq(orderLineItems.id, input.lineItemId)))
    .for("update");
  if (!row) throw new ReturnUpstreamError("Line item not found.", "UPSTREAM_NOT_FOUND", 404);
  const { line, order } = row;
  if (isCanceledOrder(order) || ["closed", "production_complete", "completed", "operationally_complete"].includes(String(order.state))
    || ["closed", "operationally_complete"].includes(String(order.status)) || order.closedAt
    || ["completed", "complete", "done", "canceled", "cancelled", "void"].includes(String(line.status))
    || !["ready_for_prepress", "in_prepress"].includes(line.workflowState)
    || line.productionBypassed || line.lineItemRole === "parent") {
    throw new ReturnUpstreamError("Only active Prepress work can return upstream.", "UPSTREAM_INVALID_ORIGIN");
  }
  const jobs = await tx.select().from(productionJobs)
    .where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.lineItemId, line.id)))
    .for("update");
  const activeJobs = jobs.filter((job: any) => !isTerminalProductionStatus(job.status));
  if (activeJobs.length !== 1 || !isPrepressOwnershipJob(activeJobs[0])) {
    throw new ReturnUpstreamError("Work has incompatible or missing active ownership. Refresh or resolve production ownership first.", "UPSTREAM_PRODUCTION_CONFLICT");
  }
  const owner = activeJobs[0];
  if (line.workflowState !== command.expectedWorkflowState || owner.id !== command.expectedOwnerJobId
    || new Date(line.updatedAt).getTime() !== new Date(command.expectedUpdatedAt).getTime()) {
    throw new ReturnUpstreamError("Work changed since it was viewed. Refresh before returning upstream.", "UPSTREAM_STALE_STATE");
  }
  const activeRuns = await tx.select({ id: productionRuns.id }).from(productionRunMembers)
    .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
    .where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRuns.organizationId, input.organizationId),
      eq(productionRunMembers.orderLineItemId, line.id), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES])));
  if (activeRuns.length) throw new ReturnUpstreamError("Resolve the active production run before returning upstream.", "UPSTREAM_ACTIVE_RUN");
  const [eligibility] = await new FulfillmentDashboardRepo(tx).listLineEligibility(input.organizationId, { lineItemIds: [line.id] }, tx);
  if (!eligibility || eligibility.projection.fulfilledQuantity > 0 || eligibility.projection.administrativelyReconciledQuantity > 0) {
    throw new ReturnUpstreamError("Fulfilled or administratively resolved work requires the replacement/rework workflow.", "UPSTREAM_FULFILLMENT_BOUNDARY");
  }
  if (order.proofApprovalPolicyOverride === "bypass" && (command.destination === "proofing" || line.requiresProofApproval)) {
    throw new ReturnUpstreamError("Remove the explicit Order proof bypass before requiring a new proof cycle.", "UPSTREAM_PROOF_BYPASS");
  }
  if (order.proofApprovalPolicyOverride === "force_required" && !line.requiresProofApproval) {
    // Design completion routes using the line flag; honor the already-required Order policy.
    await tx.update(orderLineItems).set({ requiresProofApproval: true })
      .where(and(eq(orderLineItems.id, line.id), eq(orderLineItems.orderId, order.id)));
  }
  const proof = await retireProofAuthorityForUpstream(tx, {
    organizationId: input.organizationId, orderId: line.orderId, lineItemId: line.id,
    actorUserId: input.actorUserId, reason: command.reason, destination: command.destination,
  });
  // Preserve completed work snapshots before canonical station-row reuse resets its current session.
  const priorWork = jobs.map((job: any) => ({ ...job }));
  const transition = await transitionLineItemWorkflowState(tx, {
    organizationId: input.organizationId, lineItemId: line.id,
    toState: command.destination === "design" ? "needs_design" : "awaiting_proof_approval",
    actorUserId: input.actorUserId, note: command.reason,
    metadata: { source: "return_upstream", destination: command.destination, previousOwnerJobId: owner.id },
  });
  if (!transition.activeOwnerJobId || (command.destination === "design"
    ? transition.activeOwnerStationKey !== "design"
    : !isPrepressOwnershipJob({ stationKey: transition.activeOwnerStationKey, stepKey: transition.activeOwnerStepKey }))) {
    throw new ReturnUpstreamError("Upstream ownership could not be established safely.", "UPSTREAM_OWNER_FAILED");
  }
  // Proofing can resume a draft/sent proof without replacing it. A retired approval has no
  // current pointer, so normal synchronization creates a new numbered version, even for the same file.
  const proofSync = command.destination === "proofing" && !proof.resumedProofVersionId
    ? await autoSyncCanonicalProofForLineItem(tx, { organizationId: input.organizationId, lineItemId: line.id, actorUserId: input.actorUserId, reason: "upstream_return" })
    : null;
  const sessions = await tx.update(prepressSessions)
    .set({ status: "complete", completedAt: new Date(), completedByUserId: input.actorUserId, updatedAt: new Date() })
    .where(and(eq(prepressSessions.organizationId, input.organizationId), eq(prepressSessions.lineItemId, line.id), eq(prepressSessions.status, "active")))
    .returning({ id: prepressSessions.id });
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE",
    entityType: "order_line_item", entityId: line.id, entityName: `Line item ${line.id}`,
    description: `Returned from Prepress to ${command.destination}: ${command.reason}`,
    oldValues: { orderId: line.orderId, workflowState: line.workflowState, ownerJobId: owner.id, priorWork, ...proof },
    newValues: { source: "return_upstream", sourceStage: "prepress", destination: command.destination, reason: command.reason,
      expectedState: command, workflowState: transition.toState, ownerJobId: transition.activeOwnerJobId,
      proofSync, resumedProofVersionId: proof.resumedProofVersionId, retiredSessionIds: sessions.map((session: any) => session.id) },
  } as any);
  return { lineItemId: line.id, orderId: line.orderId, destination: command.destination, transition, proof, proofSync };
}
