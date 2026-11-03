/** Read-only receipt projection. IDs always identify existing canonical records. */
export type PaymentReceiptAllocation = {
  paymentId: string; invoiceId: string; invoiceNumber: string; amountCents: number;
  originalPaymentId?: string | null; appliedAt?: string;
  status: string; reference: string | null; orderId: string | null; orderNumber: string | null; jobName: string | null;
};
export type PaymentReceipt = {
  id: string; batchId: string | null; creditId: string | null; paymentId: string | null; appliedAt: string;
  amountCents: number; retainedCents: number; method: string; provider: string; status: string; reference: string | null;
  notes: string | null; customerId: string | null; customerName: string | null;
  allocations: PaymentReceiptAllocation[];
  allocatedCents: number; refundedCents: number; unappliedCents: number | null;
  linkageWarning: string | null;
};

export function projectPaymentReceipt(header: Omit<PaymentReceipt, "allocatedCents" | "refundedCents" | "unappliedCents">): PaymentReceipt {
  const allocations = Array.from(new Map(header.allocations.map(row => [row.paymentId, row])).values());
  const sum = (statuses: string[]) => allocations.filter(row => statuses.includes(row.status)).reduce((total, row) => total + row.amountCents, 0);
  const allocatedCents = sum(["succeeded", "captured"]);
  const refundedCents = sum(["refunded"]);
  const recordedCents = allocations.reduce((total, row) => total + (row.status === "refunded" && row.originalPaymentId
    && allocations.some(original => original.paymentId === row.originalPaymentId && original.invoiceId === row.invoiceId) ? 0 : row.amountCents), 0);
  // A refund/void is not unallocated cash. Conflicting ledger amounts are not
  // evidence of a usable remainder, and must stay visibly unresolved.
  const unappliedCents = header.creditId
    ? header.status === "reversed" ? 0 : allocatedCents <= header.retainedCents ? header.retainedCents - allocatedCents : null
    : !header.batchId ? 0 : recordedCents <= header.retainedCents ? header.retainedCents - recordedCents : null;
  return { ...header, allocations, allocatedCents, refundedCents, unappliedCents,
    linkageWarning: header.linkageWarning ?? (unappliedCents === null ? "Allocation history exceeds this receipt amount; review the original payment record." : null) };
}
