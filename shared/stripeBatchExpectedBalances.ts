export type StripeBatchAllocation = { invoiceId: string; amountCents: number };

/** Recover the invoice balances reviewed when the provider payment was created. */
export function stripeBatchExpectedBalances(
  evidence: unknown,
  allocations: StripeBatchAllocation[],
): Record<string, number> {
  const data = evidence && typeof evidence === "object" ? evidence as Record<string, unknown> : {};
  const snapshot = data.expectedRemainingCents;
  // Older portal checkouts always paid each invoice in full and did not store a snapshot.
  if (snapshot === undefined && data.portal === true) {
    return Object.fromEntries(allocations.map(({ invoiceId, amountCents }) => [invoiceId, amountCents]));
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Stripe payment batch is missing its invoice balance snapshot.");
  }
  const balances = snapshot as Record<string, unknown>;
  if (Object.keys(balances).length !== allocations.length || allocations.some(({ invoiceId, amountCents }) => {
    const balance = balances[invoiceId];
    return !Object.prototype.hasOwnProperty.call(balances, invoiceId) ||
      typeof balance !== "number" || !Number.isSafeInteger(balance) || balance < amountCents;
  })) {
    throw new Error("Stripe payment batch has an invalid invoice balance snapshot.");
  }
  return balances as Record<string, number>;
}
