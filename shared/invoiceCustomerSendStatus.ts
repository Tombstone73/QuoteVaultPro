/** Customer delivery state, independent from payment lifecycle and email queue diagnostics. */
export type InvoiceCustomerSendStatus = "not_sent" | "sent_current" | "sent_outdated";

export function deriveInvoiceCustomerSendStatus(invoice: {
  invoiceVersion?: number | null;
  lastSentVersion?: number | null;
  lastSentAt?: Date | string | null;
}): InvoiceCustomerSendStatus {
  if (!invoice.lastSentAt) return "not_sent";

  const revision = Math.max(1, Number(invoice.invoiceVersion || 1));
  // Historical delivery evidence can predate sent-version tracking. In that
  // case, preserve its current status rather than manufacturing a stale state.
  const sentRevision = Math.max(1, Number(invoice.lastSentVersion || revision));
  return revision > sentRevision ? "sent_outdated" : "sent_current";
}
