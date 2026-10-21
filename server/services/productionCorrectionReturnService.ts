import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, orderLineItems, orders, productionJobs, userOrganizations } from "@shared/schema";
import { db } from "../db";
import { lockWorkflowLines } from "./workflowMutationLock";
import { ReturnToPrepressError, returnProductionJobsToPrepressInTransaction } from "./productionReturnToPrepressService";
import { returnUpstreamInTransaction } from "./returnUpstreamService";

export const productionCorrectionReturnSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(50),
  destination: z.enum(["prepress", "proofing", "design"]),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export async function returnProductionForCorrection(input: z.infer<typeof productionCorrectionReturnSchema> & {
  organizationId: string;
  actorUserId: string;
}) {
  const command = productionCorrectionReturnSchema.parse({
    jobIds: input.jobIds, destination: input.destination, reason: input.reason,
  });
  if (new Set(command.jobIds).size !== command.jobIds.length) {
    throw new ReturnToPrepressError("Select each production job only once.", 400, "DUPLICATE_RETURN_JOB");
  }
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: userOrganizations.role }).from(userOrganizations)
      .where(and(eq(userOrganizations.organizationId, input.organizationId), eq(userOrganizations.userId, input.actorUserId)))
      .limit(1);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new ReturnToPrepressError("Organization Owner or Admin role required to return production work.", 403, "RETURN_FOR_CORRECTION_FORBIDDEN");
    }
    const jobs = await tx.select({ job: productionJobs, line: orderLineItems })
      .from(productionJobs)
      .innerJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
      .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, input.organizationId)))
      .where(and(eq(productionJobs.organizationId, input.organizationId), inArray(productionJobs.id, command.jobIds)));
    if (jobs.length !== command.jobIds.length || new Set(jobs.map(({ line }) => line.id)).size !== jobs.length) {
      throw new ReturnToPrepressError("Selected production work is missing or has duplicate line ownership. Refresh and select the current jobs.", 409, "RETURN_FOR_CORRECTION_STALE");
    }
    await lockWorkflowLines(tx, input.organizationId, jobs.map(({ line }) => line.id));
    const results = [];
    for (const { job, line } of jobs) {
      const station = String(job.stationKey || "").toLowerCase() === "wide_roll" ? "roll" : String(job.stationKey || "").toLowerCase();
      if (station !== "roll" && station !== "flatbed") {
        throw new ReturnToPrepressError("Only Roll or Flatbed production jobs can use this return. Refresh the Order and open the current job.", 409, "RETURN_FOR_CORRECTION_WRONG_STATION");
      }
      const [prepress] = await returnProductionJobsToPrepressInTransaction(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        station,
        jobIds: [job.id],
        reason: command.reason,
      });
      if (command.destination === "prepress") {
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId, userId: input.actorUserId,
          actionType: "PRODUCTION_RETURN_FOR_CORRECTION", entityType: "order_line_item", entityId: line.id,
          description: `Returned ${station} production to Prepress: ${command.reason}`,
          oldValues: { workflowState: line.workflowState, station, ownerJobId: job.id },
          newValues: { destination: "prepress", ownerJobId: prepress.prepressJobId, reason: command.reason },
        } as typeof auditLogs.$inferInsert);
        results.push({ lineItemId: line.id, destination: command.destination, ownerJobId: prepress.prepressJobId });
        continue;
      }
      const [current] = await tx.select({ workflowState: orderLineItems.workflowState, updatedAt: orderLineItems.updatedAt })
        .from(orderLineItems).where(eq(orderLineItems.id, line.id)).limit(1);
      if (!current || current.workflowState !== "in_prepress") {
        throw new ReturnToPrepressError("Prepress ownership could not be verified after the return.", 409, "RETURN_FOR_CORRECTION_PREPRESS_MISSING");
      }
      const upstream = await returnUpstreamInTransaction(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        lineItemId: line.id,
        destination: command.destination,
        reason: command.reason,
        expectedWorkflowState: "in_prepress",
        expectedOwnerJobId: prepress.prepressJobId,
        expectedUpdatedAt: current.updatedAt.toISOString(),
      });
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId, userId: input.actorUserId,
        actionType: "PRODUCTION_RETURN_FOR_CORRECTION", entityType: "order_line_item", entityId: line.id,
        description: `Returned ${station} production to ${command.destination}: ${command.reason}`,
        oldValues: { workflowState: line.workflowState, station, ownerJobId: job.id },
        newValues: { destination: command.destination, ownerJobId: upstream.transition.activeOwnerJobId, reason: command.reason },
      } as typeof auditLogs.$inferInsert);
      results.push({ lineItemId: line.id, destination: command.destination, ownerJobId: upstream.transition.activeOwnerJobId });
    }
    return results;
  });
}
