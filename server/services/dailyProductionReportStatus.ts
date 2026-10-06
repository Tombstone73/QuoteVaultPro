import { and, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { orders, orderStatusPills } from "@shared/schema";

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
