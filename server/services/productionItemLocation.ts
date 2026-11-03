import { and, eq, inArray } from "drizzle-orm";
import { orderLineItems, orders, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import type { ProductionItemLocation } from "@shared/productionItemLocation";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";

/** Read-only navigation: resolve an old board job to its current tenant owner. */
export async function resolveProductionItemLocation(tx: any, organizationId: string, jobId: string): Promise<ProductionItemLocation> {
  const [reference] = await tx.select({ job: productionJobs }).from(productionJobs)
    .innerJoin(orderLineItems, and(eq(orderLineItems.id, productionJobs.lineItemId), eq(orderLineItems.orderId, productionJobs.orderId)))
    .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
    .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId))).limit(1);
  if (!reference?.job.lineItemId) throw Object.assign(new Error("Production item not found for this organization."), { statusCode: 404 });
  const current = await findActiveJobForLineItem(tx, { organizationId, lineItemId: reference.job.lineItemId }) ?? reference.job;
  const [member] = await tx.select({ runId: productionRuns.id }).from(productionRunMembers)
    .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, organizationId)))
    .where(and(eq(productionRunMembers.organizationId, organizationId), eq(productionRunMembers.productionJobId, current.id), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]))).limit(1);
  return { jobId: current.id, lineItemId: reference.job.lineItemId, orderId: current.orderId, stationKey: current.stationKey,
    stepKey: current.stepKey, status: current.status, runId: member?.runId ?? null, prepress: isPrepressOwnershipJob(current) };
}
