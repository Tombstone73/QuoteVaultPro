import { and, eq, inArray, sql } from "drizzle-orm";
import { productionRunMembers, productionRuns } from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { db } from "../db";
import { isPrepressOwnershipJob, resolveActiveProductionOwners } from "./productionOwnership";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import { filterActiveProductionOverviewFulfillmentJobs } from "./fulfillment/productionOverviewFulfillment";

export type ProductionOverviewCandidate = {
  id: string;
  lineItemId: string | null;
  stationKey: string | null;
  status: string;
};

const isTerminal = (status: string) => ["done", "void", "canceled", "cancelled"].includes(String(status).toLowerCase());
const isFulfillment = (stationKey: string | null) => String(stationKey ?? "").trim().toLowerCase() === "fulfillment";

/** Shared population authority for the Overview route and its navigation badge. */
export async function filterActiveProductionOverviewRows<T extends ProductionOverviewCandidate>(
  organizationId: string,
  baseRows: readonly T[],
  stationKey?: string | null,
  executor: typeof db = db,
): Promise<T[]> {
  if (!baseRows.length) return [];
  const lineItemIds = Array.from(new Set(baseRows.map((row) => row.lineItemId).filter((id): id is string => Boolean(id))));
  const owners = lineItemIds.length
    ? await resolveActiveProductionOwners(executor, { organizationId, lineItemIds, debugLabel: "production-overview-population" })
    : new Map();
  let rows = baseRows.filter((row) => {
    if (isTerminal(row.status)) return false;
    if (!row.lineItemId) return true;
    const owner = owners.get(row.lineItemId);
    return owner?.id === row.id && !(stationKey && ["flatbed", "roll"].includes(stationKey) && isPrepressOwnershipJob(owner));
  });

  if (!rows.length) return rows;
  const grouped = await executor.select({ productionJobId: productionRunMembers.productionJobId })
    .from(productionRunMembers)
    .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
    .where(and(
      eq(productionRunMembers.organizationId, organizationId),
      inArray(productionRunMembers.productionJobId, rows.map((row) => row.id)),
      inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
      sql`coalesce(${productionRunMembers.remainingQuantity}, 0) > 0`,
    ));
  const groupedIds = new Set(grouped.map((row) => row.productionJobId));
  rows = rows.filter((row) => !groupedIds.has(row.id));

  const fulfillmentLineIds = Array.from(new Set(rows
    .filter((row) => isFulfillment(row.stationKey))
    .map((row) => row.lineItemId)
    .filter((id): id is string => Boolean(id))));
  if (rows.some((row) => isFulfillment(row.stationKey))) {
    const eligibility = fulfillmentLineIds.length
      ? await new FulfillmentDashboardRepo(executor).listLineEligibility(organizationId, { lineItemIds: fulfillmentLineIds })
      : [];
    rows = filterActiveProductionOverviewFulfillmentJobs(rows, new Map(eligibility.map((line) => [line.id, line.projection])));
  }
  return rows;
}

/** A line has one current work owner even if historical jobs exist at many stations. */
export function countDistinctActiveProductionOverviewWork(
  rows: readonly ProductionOverviewCandidate[],
  productionOnly = true,
): number {
  return new Set(rows
    .filter((row) => !isTerminal(row.status) && (!productionOnly || !isFulfillment(row.stationKey)))
    .map((row) => row.lineItemId || row.id)).size;
}
