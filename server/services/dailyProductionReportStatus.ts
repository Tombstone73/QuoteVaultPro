import { and, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { orders, orderStatusPills } from "@shared/schema";
import { isTerminalProductionStatus } from "@shared/operationalState";
import { hasOutstandingCanonicalProductionObligations, projectCanonicalProductionObligations } from "./orderProductionCompletionPolicy";

export const DAILY_PRODUCTION_STATUS_KEYS = ["new", "in_production"] as const;

const DAILY_PRODUCTION_STATUS_VALUES = new Set(["new", "in production"]);

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * The Orders list's current status-pill identity is authoritative. Legacy
 * values are considered only for records that have no pill identity at all.
 */
export function currentProductionStatusPillPredicate() {
  const normalizedPillValue = sql<string>`lower(regexp_replace(regexp_replace(trim(coalesce(${orders.statusPillValue}, '')), '[_-]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  return or(
    and(isNotNull(orders.statusPillId), inArray(orderStatusPills.key, [...DAILY_PRODUCTION_STATUS_KEYS])),
    and(isNull(orders.statusPillId), inArray(normalizedPillValue, ["new", "in production"])),
    and(isNull(orders.statusPillId), sql`${normalizedPillValue} = ''`, inArray(orders.status, [...DAILY_PRODUCTION_STATUS_KEYS])),
  );
}

export function currentProductionStatusPillBucket(input: {
  statusPillId: string | null;
  statusPillKey: string | null;
  statusPillValue: string | null;
  status: string | null;
  state?: string | null;
}): "new" | "in_production" | null {
  if (input.statusPillId) {
    return input.statusPillKey === "new" || input.statusPillKey === "in_production"
      ? input.statusPillKey : null;
  }

  const pillValue = normalizeStatus(input.statusPillValue);
  if (pillValue) return DAILY_PRODUCTION_STATUS_VALUES.has(pillValue)
    ? pillValue === "new" ? "new" : "in_production" : null;

  const legacyStatus = normalizeStatus(input.status).replace(/ /g, "_");
  return legacyStatus === "new" || legacyStatus === "in_production" ? legacyStatus : null;
}

export function qualifiesForDailyProductionReport(input: Parameters<typeof currentProductionStatusPillBucket>[0]): boolean {
  return currentProductionStatusPillBucket(input) !== null;
}

export type CanonicalProductionReportSource = Parameters<typeof currentProductionStatusPillBucket>[0] & {
  orderId: string;
  state: string | null;
  lineItemId: string | null;
  lineItemRole: string | null;
  productionBypassed: boolean | null;
  requiresProductionJob: boolean | null;
  workflowIntent: string | null;
  workflowState: string | null;
  lifecycleStatus: string | null;
  jobId: string | null;
  jobStatus: string | null;
  jobStationKey: string | null;
};

/** Applies canonical line ownership after the indexed status query. A completed parent with unresolved work remains visible as a conflict. */
export function filterCanonicalProductionReportRows<T extends CanonicalProductionReportSource>(rows: T[]) {
  const byOrder = new Map<string, T[]>();
  for (const row of rows) {
    const group = byOrder.get(row.orderId);
    if (group) group.push(row);
    else byOrder.set(row.orderId, [row]);
  }
  const included = new Set<string>();
  const conflictOrderIds: string[] = [];
  for (const [orderId, group] of byOrder) {
    const first = group[0];
    const lines = [...new Map(group.filter(row => row.lineItemId).map(row => [row.lineItemId!, {
      id: row.lineItemId!, lineItemRole: row.lineItemRole, productionBypassed: row.productionBypassed,
      requiresProductionJob: row.requiresProductionJob, workflowIntent: row.workflowIntent,
      workflowState: row.workflowState, lifecycleStatus: row.lifecycleStatus,
    }])).values()];
    const activeJobs = [...new Map(group.filter(row => row.jobId && !isTerminalProductionStatus(row.jobStatus) && String(row.jobStationKey || '').toLowerCase() !== 'fulfillment')
      .map(row => [row.jobId!, row])).values()];
    const ownerCounts = new Map<string, number>();
    for (const job of activeJobs) if (job.lineItemId) ownerCounts.set(job.lineItemId, (ownerCounts.get(job.lineItemId) ?? 0) + 1);
    const obligations = projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: ownerCounts });
    const outstanding = hasOutstandingCanonicalProductionObligations(obligations) || activeJobs.length > 0;
    const operationalComplete = first.status === 'operationally_complete' || first.state === 'closed';
    if (operationalComplete && outstanding) {
      conflictOrderIds.push(orderId);
      included.add(orderId);
    } else if (!operationalComplete && outstanding && qualifiesForDailyProductionReport(first)) {
      included.add(orderId);
    }
  }
  return { rows: rows.filter(row => included.has(row.orderId)), conflictOrderIds };
}
