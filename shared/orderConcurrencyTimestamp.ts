import { z } from "zod";

const explicitInstant = z.string().datetime({ offset: true });
/** Orders.updatedAt is a PostgreSQL timestamp WITHOUT time zone stored in UTC.
 * Its Drizzle string projection must be interpreted as UTC, never browser-local.
 * Preserve all available PostgreSQL microseconds; Date.toISOString alone loses them.
 * This adapter is only for known Order/line concurrency fields, not arbitrary dates.
 */
export function canonicalOrderConcurrencyTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? canonicalOrderConcurrencyTimestamp(value.toISOString()) : null;
  if (typeof value !== "string") return null;
  const pgUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/.exec(value);
  const iso = pgUtc ? pgUtc[1] + "T" + pgUtc[2] + (pgUtc[3] ?? "") + "Z" : value;
  if (!explicitInstant.safeParse(iso).success) return null;
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? "";
  if (fraction.length > 6) return null;
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return null;
  const exactFraction = fraction.replace(/0+$/, "").padEnd(3, "0");
  return instant.toISOString().replace(/\.\d{3}Z$/, (exactFraction ? "." + exactFraction : "") + "Z");
}

export function requireOrderConcurrencyTimestamp(value: unknown): string {
  const result = canonicalOrderConcurrencyTimestamp(value);
  if (!result) throw new Error("Source concurrency timestamp is unavailable. Refresh the source Order.");
  return result;
}
