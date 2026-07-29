import type { InvoiceListItem } from "@/hooks/useInvoices";

const invoiceBalanceCents = (invoice: InvoiceListItem) => Math.max(0, Math.round(Number(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total) - Number(invoice.amountPaid)) * 100));

export const getInvoiceListTakePaymentPath = (invoiceId: string) => `/invoices/${invoiceId}?takePayment=1`;

export const canTakePaymentFromInvoiceList = (invoice: InvoiceListItem) => {
  const status = String(invoice.status || "").toLowerCase();
  return invoiceBalanceCents(invoice) > 0 && !["draft", "paid", "void"].includes(status);
};
