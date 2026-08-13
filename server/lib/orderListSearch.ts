const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

export type OrderSearchDateRange = { start: string; end: string };

function validUtcDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
}

/**
 * Deliberately supports only operator-facing, locale-independent due-date
 * spellings. It never delegates parsing to the host browser/runtime locale.
 */
export function parseOrderSearchDate(value: unknown): OrderSearchDateRange | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(normalized);
  const month = numeric ? Number(numeric[1]) - 1 : named ? MONTHS[named[1].toLowerCase()] : undefined;
  const day = Number(numeric?.[2] ?? named?.[2]);
  const year = Number(numeric?.[3] ?? named?.[3]);
  if (month === undefined || !Number.isInteger(day) || !Number.isInteger(year) || !validUtcDate(year, month, day)) return null;

  const start = new Date(Date.UTC(year, month, day));
  const end = new Date(Date.UTC(year, month, day + 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function orderSearchTokens(value: unknown): string[] {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || parseOrderSearchDate(normalized)) return [];
  return normalized.split(" ").filter(Boolean).slice(0, 8);
}

export function normalizeOrderSearchTerm(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function digitsOnlySearchTerm(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}
