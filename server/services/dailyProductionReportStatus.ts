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
export function qualifiesForDailyProductionReport(input: {
  statusPillId: string | null;
  statusPillKey: string | null;
  statusPillValue: string | null;
  status: string | null;
  state?: string | null;
}): boolean {
  if (input.statusPillId) {
    return input.statusPillKey === "new" || input.statusPillKey === "in_production";
  }

  const pillValue = normalizeStatus(input.statusPillValue);
  if (pillValue) return DAILY_PRODUCTION_STATUS_VALUES.has(pillValue);

  const legacyStatus = normalizeStatus(input.status).replace(/ /g, "_");
  return legacyStatus === "new" || legacyStatus === "in_production";
}
