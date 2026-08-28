/**
 * Parses the Orders list's plural status-pill filter without making an empty
 * selection indistinguishable from an omitted filter. Empty means no rows;
 * omitted means all status pills.
 */
export function parseOrderStatusPillIdsQuery(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;

  const rawValues = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    rawValues
      .flatMap((raw) => typeof raw === "string" ? raw.split(",") : [])
      .map((id) => id.trim())
      .filter(Boolean),
  )).slice(0, 100);
}
