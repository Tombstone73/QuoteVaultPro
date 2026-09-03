/**
 * Order due, promised, requested, and production dates are calendar dates.
 *
 * The legacy database columns are timezone-aware timestamps, so this helper
 * deliberately uses their UTC calendar portion rather than a runtime's local
 * timezone. That keeps an Order's selected business day stable in every
 * browser and on every server.
 */
export function orderBusinessDatePart(value: string | Date | null | undefined): string | null {
  if (!value) return null;

  const raw = value instanceof Date ? value.toISOString() : value.trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!matched) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }

  const datePart = matched[0];
  const [year, month, day] = datePart.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? datePart
    : null;
}

/** Persist calendar dates at UTC noon so legacy timestamptz storage retains
 * the selected date without relying on a browser or server local timezone. */
export function serializeOrderBusinessDate(value: string | Date | null | undefined): string | null {
  const datePart = orderBusinessDatePart(value);
  return datePart ? `${datePart}T12:00:00.000Z` : null;
}
