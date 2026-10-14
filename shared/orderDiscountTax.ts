/** Allocate an Order-wide discount across all billable selling amounts.
 * Largest remainders receive the leftover cents in stable line order. */
export function calculateDiscountedOrderTax(input: {
  lines: Array<{ totalCents: number; isTaxable: boolean }>;
  discountCents: number;
  taxRate: number;
}) {
  const lines = input.lines.map((line) => ({
    totalCents: Math.max(0, Math.round(line.totalCents)),
    isTaxable: line.isTaxable,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discountCents = Math.min(subtotalCents, Math.max(0, Math.round(input.discountCents)));
  const shares = lines.map((line, index) => {
    const numerator = BigInt(discountCents) * BigInt(line.totalCents);
    const denominator = BigInt(subtotalCents || 1);
    return { index, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = discountCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  )) {
    if (remaining-- <= 0) break;
    share.cents++;
  }
  const rate = Number.isFinite(input.taxRate) ? Math.max(0, input.taxRate) : 0;
  const lineTaxCents = lines.map((line, index) => line.isTaxable
    ? Math.round((line.totalCents - shares[index]!.cents) * rate)
    : 0);
  const taxableSubtotalCents = lines.reduce((sum, line, index) =>
    sum + (line.isTaxable ? line.totalCents - shares[index]!.cents : 0), 0);
  return {
    subtotalCents,
    discountCents,
    taxableSubtotalCents,
    lineDiscountCents: shares.map((share) => share.cents),
    lineTaxCents,
    taxCents: lineTaxCents.reduce((sum, cents) => sum + cents, 0),
  };
}
