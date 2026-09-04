import type { InvoiceListItem } from "@/hooks/useInvoices";
import { getInvoiceFinancialPaymentEligibility } from "@shared/paymentOrchestration";

const invoiceBalanceCents = (invoice: InvoiceListItem) => Math.max(0, Math.round(Number(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total) - Number(invoice.amountPaid)) * 100));

export const getInvoiceListTakePaymentPath = (invoiceId: string) => `/invoices/${invoiceId}?takePayment=1`;

/** Opens the existing Invoice Detail send dialog; the list never sends directly. */
export const getInvoiceListSendPath = (invoiceId: string) => `/invoices/${invoiceId}?sendInvoice=1`;

export const canTakePaymentFromInvoiceList = (invoice: InvoiceListItem) => {
  return getInvoiceFinancialPaymentEligibility({
    invoiceStatus: invoice.status,
    remainingCents: invoiceBalanceCents(invoice),
  }).payable;
};
