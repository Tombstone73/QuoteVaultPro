/** Waiting is the UI name for queued; failed rows are already terminal. */
export const CANCELABLE_EMAIL_QUEUE_STATUSES = ["queued", "retrying", "needs_review"] as const;
export function canCancelEmailQueueJob(status: string): boolean {
  return (CANCELABLE_EMAIL_QUEUE_STATUSES as readonly string[]).includes(status);
}

export type EmailQueueIdentity = {
  id: string; organizationId: string; campaignId: string; invoiceId: string | null;
  invoiceVersion: number; deliveryType?: string; recipientKey: string; status: string;
  createdAt: Date | string; sentAt?: Date | string | null; providerMessageId?: string | null;
  customerStatementSnapshotId?: string | null; metadata: Record<string, any>;
};

/** A document/recipient hash is NOT a send intent: explicit resends reuse it. */
export function invoiceEmailSupersessionEvidence(older: EmailQueueIdentity, later: EmailQueueIdentity): string | null {
  if (older.id === later.id || older.organizationId !== later.organizationId || !older.invoiceId || older.invoiceId !== later.invoiceId
    || (older.deliveryType || "invoice") !== "invoice" || (later.deliveryType || "invoice") !== "invoice"
    || later.status !== "sent" || !later.sentAt || !later.providerMessageId
    || !(new Date(later.createdAt).getTime() > new Date(older.createdAt).getTime())
    || !(new Date(later.sentAt).getTime() >= new Date(later.createdAt).getTime())
    || older.recipientKey !== later.recipientKey || !older.recipientKey
    || older.invoiceVersion !== later.invoiceVersion
    || older.customerStatementSnapshotId !== later.customerStatementSnapshotId) return null;
  const a = older.metadata || {}, b = later.metadata || {};
  // Require actual frozen content; null legacy templates are not evidence.
  if (typeof a.subject !== "string" || typeof a.message !== "string"
    || a.subject !== b.subject || a.message !== b.message) return null;
  if (b.retryOfNeedsReviewJobId === older.id || a.deliveryReview?.replacementJobId === later.id) {
    return "Explicit review replacement; same recipient, document version and frozen message";
  }
  if (older.campaignId && older.campaignId === later.campaignId) {
    return "Same canonical request campaign, recipient, document version and frozen message";
  }
  return null;
}
