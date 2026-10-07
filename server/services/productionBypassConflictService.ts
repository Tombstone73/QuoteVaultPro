import { and, desc, eq, inArray } from "drizzle-orm";
import { isTerminalProductionStatus } from "@shared/operationalState";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { orderLineItems, productionEvents, productionJobs, productionRunMembers, productionRuns } from "@shared/schema";

export type ProductionExecutionConflict = {
  lineItemId: string;
  lineDescription: string;
  jobId: string | null;
  stationKey: string;
  jobStatus: string;
  runningTimer: boolean;
  runId: string | null;
};

export function projectProductionExecutionConflicts(input: {
  lines: Array<{ id: string; description: string | null }>;
  jobs: Array<{ id: string; lineItemId: string | null; stationKey: string; status: string }>;
  runs: Array<{ lineItemId: string; runId: string; stationKey: string; status: string }>;
  lastTimerByJob: ReadonlyMap<string, string>;
}): ProductionExecutionConflict[] {
  const labelById = new Map(input.lines.map((line) => [line.id, line.description || line.id]));
  const conflicts: ProductionExecutionConflict[] = input.jobs.filter((job) => {
    if (String(job.stationKey).toLowerCase() === "fulfillment") return false;
    return !isTerminalProductionStatus(job.status) || input.lastTimerByJob.get(job.id) === "timer_started";
  }).map((job) => ({
    lineItemId: job.lineItemId!, lineDescription: labelById.get(job.lineItemId!) || job.lineItemId!,
    jobId: job.id, stationKey: job.stationKey, jobStatus: job.status,
    runningTimer: input.lastTimerByJob.get(job.id) === "timer_started", runId: null,
  }));
  for (const run of input.runs) conflicts.push({
    lineItemId: run.lineItemId, lineDescription: labelById.get(run.lineItemId) || run.lineItemId,
    jobId: null, stationKey: run.stationKey, jobStatus: run.status, runningTimer: false, runId: run.runId,
  });
  return conflicts;
}

/** One shared view of active owners, timers and Combined Runs for bypass and preview. */
export async function listProductionExecutionConflicts(tx: any, organizationId: string, orderId: string, lineItemIds: string[]): Promise<ProductionExecutionConflict[]> {
  if (!lineItemIds.length) return [];
  const [lines, jobs, runRows] = await Promise.all([
    tx.select({ id: orderLineItems.id, description: orderLineItems.description }).from(orderLineItems)
      .where(and(eq(orderLineItems.orderId, orderId), inArray(orderLineItems.id, lineItemIds))),
    tx.select({ id: productionJobs.id, lineItemId: productionJobs.lineItemId, stationKey: productionJobs.stationKey, status: productionJobs.status })
      .from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId), inArray(productionJobs.lineItemId, lineItemIds))),
    tx.select({ lineItemId: productionRunMembers.orderLineItemId, runId: productionRuns.id, stationKey: productionRuns.stationKey, status: productionRuns.status })
      .from(productionRunMembers).innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
      .where(and(eq(productionRunMembers.organizationId, organizationId), eq(productionRuns.organizationId, organizationId), inArray(productionRunMembers.orderLineItemId, lineItemIds), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]))),
  ]);
  const productionJobIds = jobs.filter((job: any) => String(job.stationKey).toLowerCase() !== "fulfillment").map((job: any) => job.id);
  const timerEvents = productionJobIds.length
    ? await tx.select({ productionJobId: productionEvents.productionJobId, type: productionEvents.type })
      .from(productionEvents).where(and(eq(productionEvents.organizationId, organizationId), inArray(productionEvents.productionJobId, productionJobIds), inArray(productionEvents.type, ["timer_started", "timer_stopped"])))
      .orderBy(desc(productionEvents.createdAt), desc(productionEvents.id))
    : [];
  const lastTimerByJob = new Map<string, string>();
  for (const event of timerEvents) if (!lastTimerByJob.has(event.productionJobId)) lastTimerByJob.set(event.productionJobId, event.type);
  return projectProductionExecutionConflicts({ lines, jobs, runs: runRows, lastTimerByJob });
}
