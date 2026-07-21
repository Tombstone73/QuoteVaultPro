export function resolveLineItemProductionDueDate(specsJson: unknown): string | null {
  if (!specsJson || typeof specsJson !== "object" || Array.isArray(specsJson)) return null;
  const specs = specsJson as Record<string, unknown>;
  for (const key of ["lineItemDueDate", "productionDueDate", "dueDate", "promisedDate"] as const) {
    const value = typeof specs[key] === "string" ? specs[key].trim() : "";
    if (value && Number.isFinite(new Date(value).getTime())) return value;
  }
  return null;
}
