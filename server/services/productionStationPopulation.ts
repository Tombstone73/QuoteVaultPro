import { and, eq, inArray, notInArray } from "drizzle-orm";
import { orderLineItems, orders, productionJobs, productionRunMembers, productionRuns, products } from "@shared/schema";
import { isCanceledOrder, isTerminalProductionStatus, TERMINAL_PRODUCTION_STATUSES } from "@shared/operationalState";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { normalizeProductionStationKey } from "@shared/productionStations";
import { db } from "../db";
import { projectCanonicalProductionObligations, type OrderProductionCompletionCandidate } from "./orderProductionCompletionPolicy";
import { isPrepressOwnershipJob } from "./productionOwnership";

export type StationCandidate = OrderProductionCompletionCandidate & {
  jobId: string;
  lineItemId: string | null;
  stationKey: string | null;
  stepKey: string | null;
  jobStatus: string;
  orderState: string | null;
  orderStatus: string | null;
  canceledAt: Date | string | null;
};

/** A station work unit is one standalone owner or one active Combined Run.
 * Missing ownership remains a bootstrap obligation, never a fabricated job.
 * Run members are represented by their container, not counted a second time.
 */
export function projectProductionStationWork(
  candidates: readonly StationCandidate[],
  members: readonly { jobId: string; runId: string; stationKey: string }[],
  station: string,
) {
  const active = candidates.filter(row => !isTerminalProductionStatus(row.jobStatus));
  const ownerCounts = new Map<string, number>();
  for (const row of active) if (row.lineItemId) ownerCounts.set(row.lineItemId, (ownerCounts.get(row.lineItemId) ?? 0) + 1);
  const obligations = projectCanonicalProductionObligations({
    lines: active.map(row => ({ ...row, id: row.lineItemId })),
    activeOwnerCountByLineItemId: ownerCounts,
  });
  const issues: { jobId: string; lineItemId: string | null; reason: string }[] = [];
  const eligible = active.filter((row, index) => {
    if (normalizeProductionStationKey(row.stationKey) !== station || isPrepressOwnershipJob(row)) return false;
    if (isCanceledOrder({ state: row.orderState, status: row.orderStatus, canceledAt: row.canceledAt })
      || row.orderState === "closed" || row.orderStatus === "operationally_complete") return false;
    const reason = !row.lineItemId || row.requiresProductionJob == null
      ? "Missing production line or product configuration"
      : obligations[index].state === "ownership_conflict" ? "Conflicting active production owners" : null;
    if (reason) issues.push({ jobId: row.jobId, lineItemId: row.lineItemId, reason });
    return !reason && obligations[index].state === "active_owner";
  });
  const eligibleIds = new Set(eligible.map(row => row.jobId));
  const grouped = members.filter(member => normalizeProductionStationKey(member.stationKey) === station && eligibleIds.has(member.jobId));
  const groupedIds = new Set(grouped.map(member => member.jobId));
  const jobIds = new Set(eligible.filter(row => !groupedIds.has(row.jobId)).map(row => row.jobId));
  const runIds = new Set(grouped.map(member => member.runId));
  return { jobIds, runIds, count: jobIds.size + runIds.size, issues };
}

/** Read-only authority shared by station badge, standalone jobs and run lists. */
export async function resolveProductionStationWork(organizationId: string, station: string, executor: typeof db = db) {
  // Include other stations when counting owners so conflicts cannot masquerade
  // as a unique owner merely because the station filter hid the other job.
  const candidates = await executor.select({
    jobId: productionJobs.id, lineItemId: productionJobs.lineItemId,
    stationKey: productionJobs.stationKey, stepKey: productionJobs.stepKey, jobStatus: productionJobs.status,
    orderState: orders.state, orderStatus: orders.status, canceledAt: orders.canceledAt,
    lineItemRole: orderLineItems.lineItemRole, productionBypassed: orderLineItems.productionBypassed,
    workflowState: orderLineItems.workflowState, lifecycleStatus: orderLineItems.status,
    requiresProductionJob: products.requiresProductionJob, workflowIntent: products.workflowIntent,
  }).from(productionJobs)
    .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
    .leftJoin(orderLineItems, and(eq(orderLineItems.id, productionJobs.lineItemId), eq(orderLineItems.orderId, orders.id)))
    .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
    .where(and(eq(productionJobs.organizationId, organizationId), notInArray(productionJobs.status, [...TERMINAL_PRODUCTION_STATUSES])));
  const members = candidates.length ? await executor.select({
    jobId: productionRunMembers.productionJobId, runId: productionRuns.id, stationKey: productionRuns.stationKey,
  }).from(productionRunMembers)
    .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, organizationId)))
    .where(and(eq(productionRunMembers.organizationId, organizationId), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]))) : [];
  const result = projectProductionStationWork(candidates, members, station);
  if (result.issues.length) console.warn("[production-station] eligibility needs attention", { organizationId, station, issues: result.issues });
  return result;
}
