export type CustomerPaymentAmounts = {
  appliedAmountCents: number;
  remainingBalanceCents: number;
  changeDueCents: number;
};

/** Parses a normal currency input without floating-point money arithmetic. */
export function parseTenderedAmountCents(value: string): number | null {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] || "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function resolveCustomerPaymentAmounts(selectedTotalCents: number, tenderedAmountCents: number): CustomerPaymentAmounts {
  const appliedAmountCents = Math.min(Math.max(0, tenderedAmountCents), Math.max(0, selectedTotalCents));
  return {
    appliedAmountCents,
    remainingBalanceCents: Math.max(0, selectedTotalCents - appliedAmountCents),
    changeDueCents: Math.max(0, tenderedAmountCents - appliedAmountCents),
  };
}
