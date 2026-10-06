/** Checkout artifacts remain available to diagnostics, never payment history.
 * Do not hide legacy rows carrying settlement/accounting evidence for review. */
export function isFinancialPaymentHistory(row: {
  provider?: string | null; status?: string | null; paidAt?: unknown; succeededAt?: unknown;
  refundedAt?: unknown; externalAccountingId?: unknown; quickbooksPaymentReference?: unknown; syncedAt?: unknown; qbReconciledAt?: unknown;
}) {
  if (row.provider !== "stripe") return true;
  return ["succeeded", "captured", "refunded", "partially_refunded"].includes(String(row.status).toLowerCase()) ||
    Boolean(row.paidAt || row.succeededAt || row.refundedAt || row.externalAccountingId || row.quickbooksPaymentReference || row.syncedAt || row.qbReconciledAt);
}
