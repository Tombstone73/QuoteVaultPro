import { allocateCustomerPayment, type CustomerPaymentAllocation, type CustomerPaymentAllocationInvoice, type CustomerPaymentAllocationMode } from "@shared/customerPaymentAllocation";

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

/** UI projection of the canonical allocation contract; never creates held funds. */
export function reconcileCustomerPaymentEntry(input: {
  invoices: CustomerPaymentAllocationInvoice[]; tenderedAmountCents: number;
  mode: CustomerPaymentAllocationMode; customAmounts: Record<string, string>; returnChange: boolean;
}) {
  const selectedTotalCents = input.invoices.reduce((sum, invoice) => sum + invoice.remainingCents, 0);
  const expected = resolveCustomerPaymentAmounts(selectedTotalCents, input.tenderedAmountCents);
  const customAllocations = input.invoices.map(invoice => ({ invoiceId: invoice.invoiceId, amountCents: parseTenderedAmountCents(input.customAmounts[invoice.invoiceId] || '0') }));
  const customTotalCents = customAllocations.reduce((sum, allocation) => sum + (allocation.amountCents ?? 0), 0);
  let allocations: CustomerPaymentAllocation[] = [];
  let error: string | null = null;
  try {
    if (input.mode === 'custom' && customAllocations.some(allocation => allocation.amountCents === null)) throw new Error('Enter valid amounts with at most two decimal places for every allocation.');
    allocations = allocateCustomerPayment({ invoices: input.invoices, amountCents: expected.appliedAmountCents, mode: input.mode,
      customAllocations: customAllocations.map(allocation => ({ invoiceId: allocation.invoiceId, amountCents: allocation.amountCents ?? 0 })) });
  } catch (failure) { error = failure instanceof Error ? failure.message : 'Review the payment allocations.'; }
  const appliedAmountCents = input.mode === 'custom' ? customTotalCents : allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const changeDueCents = input.returnChange ? expected.changeDueCents : 0;
  return { allocations, customAllocations, error, selectedTotalCents, appliedAmountCents,
    remainingBalanceCents: Math.max(0, selectedTotalCents - appliedAmountCents),
    potentialChangeCents: expected.changeDueCents, changeDueCents,
    unresolvedCents: Math.max(0, input.tenderedAmountCents - appliedAmountCents - changeDueCents),
    unappliedCreditCents: 0,
    ready: !error && appliedAmountCents > 0 && (!expected.changeDueCents || input.returnChange) };
}

export function resolveCustomerPaymentAmounts(selectedTotalCents: number, tenderedAmountCents: number): CustomerPaymentAmounts {
  const appliedAmountCents = Math.min(Math.max(0, tenderedAmountCents), Math.max(0, selectedTotalCents));
  return {
    appliedAmountCents,
    remainingBalanceCents: Math.max(0, selectedTotalCents - appliedAmountCents),
    changeDueCents: Math.max(0, tenderedAmountCents - appliedAmountCents),
  };
}
