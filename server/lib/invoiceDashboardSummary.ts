export type InvoiceDashboardSummary = {
  totalInvoices: number;
  totalOutstandingCents: number;
  overdueCount: number;
  paidThisMonthCents: number;
};

type InvoiceAggregateRow = Partial<{
  totalInvoices: unknown;
  totalOutstandingCents: unknown;
  overdueCount: unknown;
}>;

type PaymentAggregateRow = Partial<{
  paidThisMonthCents: unknown;
}>;

const nonNegativeInteger = (value: unknown): number => {
  const parsed = Math.round(Number(value ?? 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/**
 * Drizzle aggregate selects resolve to arrays, including a one-row aggregate.
 * Normalize the first row explicitly so an array object is never mistaken for
 * the aggregate row and silently converted to zero dashboard metrics.
 */
export function normalizeInvoiceDashboardSummaryAggregates(
  invoiceAggregateRows: InvoiceAggregateRow[],
  paymentAggregateRows: PaymentAggregateRow[],
): InvoiceDashboardSummary {
  const invoiceAggregate = invoiceAggregateRows[0];
  const paymentAggregate = paymentAggregateRows[0];
  return {
    totalInvoices: nonNegativeInteger(invoiceAggregate?.totalInvoices),
    totalOutstandingCents: nonNegativeInteger(invoiceAggregate?.totalOutstandingCents),
    overdueCount: nonNegativeInteger(invoiceAggregate?.overdueCount),
    paidThisMonthCents: nonNegativeInteger(paymentAggregate?.paidThisMonthCents),
  };
}
