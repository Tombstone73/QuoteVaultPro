import type { FulfillmentLineQuantityProjection } from "@shared/fulfillmentReadiness";

type FulfillmentProductionJobCandidate = {
  stationKey: string | null | undefined;
  lineItemId: string | null | undefined;
};

const FULFILLMENT_STATION_KEY = "fulfillment";

function isFulfillmentStation(stationKey: unknown): boolean {
  return String(stationKey ?? "").trim().toLowerCase() === FULFILLMENT_STATION_KEY;
}

/**
 * The Production Overview has an operational Fulfillment column, but it is
 * not an independent fulfillment queue. A job remains visible there only
 * while the authoritative Fulfillment projection says its line has work
 * remaining. That projection includes physical terminal handoffs and the
 * durable administrative reconciliation produced by Close Job Override.
 */
export function isActiveProductionOverviewFulfillmentJob(
  job: FulfillmentProductionJobCandidate,
  projectionByLineItemId: ReadonlyMap<string, FulfillmentLineQuantityProjection>,
): boolean {
  if (!isFulfillmentStation(job.stationKey)) return true;
  if (!job.lineItemId) return false;

  const projection = projectionByLineItemId.get(job.lineItemId);
  return Boolean(projection?.requiresFulfillment && projection.remainingQuantity > 0);
}

export function filterActiveProductionOverviewFulfillmentJobs<T extends FulfillmentProductionJobCandidate>(
  jobs: readonly T[],
  projectionByLineItemId: ReadonlyMap<string, FulfillmentLineQuantityProjection>,
): T[] {
  return jobs.filter((job) => isActiveProductionOverviewFulfillmentJob(job, projectionByLineItemId));
}
