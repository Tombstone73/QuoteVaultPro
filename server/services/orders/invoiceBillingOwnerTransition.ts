/** An Order-created Invoice is live immediately, but its initial `billed` and
 * `issuedAt` values are internal creation markers, not delivery evidence. */
export function getInvoiceBillingOwnerTransitionBlocker(invoice: any, evidence: {
  /** Applied ledger evidence, never the existence of an arbitrary attempt. */
  paymentExists: boolean;
  creditExists?: boolean;
  refundExists?: boolean;
  successfulEmailExists: boolean;
  deliveryJobExists: boolean;
  autoCreatedInvoiceEvidence: boolean;
}): string | null {
  if (invoice.isHistorical || invoice.importedAt || invoice.importSource || invoice.lockedReason) return "This Invoice is historical or imported.";
  if (invoice.lastSentAt || invoice.lastSentVersion || evidence.successfulEmailExists || evidence.deliveryJobExists) return "This Invoice has been sent or queued for delivery.";
  if (evidence.creditExists) return "This Invoice has an account credit issued or applied.";
  if (evidence.refundExists) return "This Invoice has a payment refund record.";
  if (evidence.paymentExists || Number(invoice.amountPaid || 0) !== 0 || ["paid", "partially_paid"].includes(String(invoice.status).toLowerCase())) return "This Invoice has a payment applied or refunded.";
  if (invoice.qbInvoiceId || invoice.externalAccountingId || invoice.lastQbSyncedVersion || invoice.syncedAt || invoice.syncStatus === "synced" || invoice.qbSyncStatus === "synced") return "This Invoice has QuickBooks or external accounting history.";
  if (invoice.accountingApprovedAt || invoice.accountingApprovedVersion || invoice.termsStartedAt) return "This Invoice has an accounting approval checkpoint.";
  const status = String(invoice.status || "").toLowerCase();
  if (!["draft", "billed"].includes(status) && !(status === "finalized" && evidence.autoCreatedInvoiceEvidence)) return "This Invoice is not an untouched internal draft.";
  if (invoice.issuedAt && !evidence.autoCreatedInvoiceEvidence) return "This Invoice has an issued checkpoint that is not the automatic Order-created Invoice marker.";
  return null;
}
