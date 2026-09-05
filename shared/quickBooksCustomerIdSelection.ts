export class InvalidQuickBooksCustomerIdError extends Error {
  constructor(public readonly invalidIds: string[]) {
    super(`QuickBooks customer IDs must be numeric. Invalid value${invalidIds.length === 1 ? "" : "s"}: ${invalidIds.join(", ")}.`);
    this.name = "InvalidQuickBooksCustomerIdError";
  }
}

function cleanQuickBooksCustomerId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return id || null;
}

/**
 * QuickBooks Customer.Id values are numeric strings. Compare them as BigInt so
 * future customer activity consistently keeps the older/lower provider record
 * without relying on lexical ordering or JavaScript number precision.
 */
export function selectRetainedQuickBooksCustomerId(values: unknown[]): {
  retainedQuickBooksCustomerId: string | null;
  retiredQuickBooksCustomerIds: string[];
} {
  const candidates = Array.from(new Set(values.map(cleanQuickBooksCustomerId).filter((id): id is string => id !== null)));
  const invalidIds = candidates.filter((id) => !/^\d+$/.test(id));
  if (invalidIds.length) throw new InvalidQuickBooksCustomerIdError(invalidIds);
  if (!candidates.length) return { retainedQuickBooksCustomerId: null, retiredQuickBooksCustomerIds: [] };

  const retainedQuickBooksCustomerId = candidates.reduce((lowest, candidate) =>
    BigInt(candidate) < BigInt(lowest) ? candidate : lowest,
  );
  return {
    retainedQuickBooksCustomerId,
    retiredQuickBooksCustomerIds: candidates.filter((candidate) => candidate !== retainedQuickBooksCustomerId),
  };
}
