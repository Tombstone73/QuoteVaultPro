export const MAX_PRODUCTION_BULK_ITEMS = 50;

export type BulkProductionStation = "flatbed" | "roll";

export type BulkProductionJobCandidate = {
  id: string;
  stationKey?: string | null;
  status?: string | null;
  orderId?: string | null;
  lineItemId?: string | null;
};

export function dedupeProductionJobIds(jobIds: string[]): string[] {
  return Array.from(new Set(jobIds));
}

function stationMatches(stationKey: unknown, station: BulkProductionStation): boolean {
  const normalized = String(stationKey ?? "").trim().toLowerCase();
  return station === "roll"
    ? normalized === "roll" || normalized === "wide_roll"
    : normalized === "flatbed";
}

/**
 * Validates a pre-scoped collection of jobs. It deliberately reports only a
 * generic reason so callers never disclose whether an inaccessible ID exists.
 */
export function validateProductionBulkSelection(args: {
  jobIds: string[];
  jobs: BulkProductionJobCandidate[];
  station: BulkProductionStation;
  allowedStatuses: string[];
}): { ok: true } | { ok: false; reason: "invalid_selection" } {
  if (args.jobIds.length === 0 || args.jobIds.length > MAX_PRODUCTION_BULK_ITEMS) {
    return { ok: false, reason: "invalid_selection" };
  }
  if (args.jobs.length !== args.jobIds.length) return { ok: false, reason: "invalid_selection" };
  const valid = args.jobs.every((job) => (
    !!job.orderId
    && !!job.lineItemId
    && stationMatches(job.stationKey, args.station)
    && args.allowedStatuses.includes(String(job.status ?? ""))
  ));
  return valid ? { ok: true } : { ok: false, reason: "invalid_selection" };
}
