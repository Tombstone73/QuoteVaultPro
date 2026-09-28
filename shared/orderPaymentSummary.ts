import { normalizeInvoiceAccountingDisplay, type InvoiceAccountingDisplayInput } from './invoiceAccountingDisplay';
import { blockedInvoiceStatuses } from './paymentOrchestration';

export type OrderPaymentSummary = {
  status: 'not_invoiced' | 'unpaid' | 'partial' | 'paid' | 'credit';
  label: string;
  invoiceCount: number;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
};

/** Read-only payment display; the legacy Order payment_status is never an input. */
export function deriveOrderPaymentSummary(invoices: readonly InvoiceAccountingDisplayInput[]): OrderPaymentSummary {
  const active = invoices.filter((invoice) => !blockedInvoiceStatuses.some(
    (status) => status === String(invoice.status ?? '').trim().toLowerCase(),
  ));
  const totals = active.map(normalizeInvoiceAccountingDisplay).reduce((sum, invoice) => ({
    totalCents: sum.totalCents + invoice.displayTotalCents,
    paidCents: sum.paidCents + invoice.displayPaidCents,
    // Never offset another Invoice's balance with an unapplied overpayment.
    remainingCents: sum.remainingCents + invoice.displayRemainingCents,
    creditCents: sum.creditCents + invoice.creditCents,
  }), { totalCents: 0, paidCents: 0, remainingCents: 0, creditCents: 0 });
  const status: OrderPaymentSummary['status'] = active.length === 0 ? 'not_invoiced'
    : totals.remainingCents > 0 ? (totals.paidCents > 0 ? 'partial' : 'unpaid')
    : totals.creditCents > 0 ? 'credit'
    : totals.totalCents > 0 ? 'paid'
    // Invoice accounting/PDF payment labels do not call zero-value invoices Paid.
    : 'unpaid';
  const labels = { not_invoiced: 'Not invoiced', unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid', credit: 'Credit / Refund Due' };
  return { status, label: labels[status], invoiceCount: active.length, ...totals };
}
