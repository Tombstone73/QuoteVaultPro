export type InboundEmailProcessingStatus = "waiting" | "processing" | "review_ready" | "needs_attention" | "failed" | "superseded";
export type InboundEmailProcessingClaim = { jobId: string; claimToken: string; evidenceFingerprint: string };
export type InboundEmailProcessingView = {
  enabled: boolean;
  job: { id: string; status: InboundEmailProcessingStatus; attempts: number; nextAttemptAt: string; errorCode: string | null; message: string | null; canRetry: boolean } | null;
};
export const INBOUND_EMAIL_MAX_ATTEMPTS = 3;
export const INBOUND_EMAIL_LEASE_MS = 5 * 60_000;
export const inboundEmailRetryDelayMs = (attempts: number) => Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/** Technical processing state never owns the human/business disposition. */
export function eligibleForAutomaticInboundDraft(record: {
  sourceType: string; status: string; reviewOutcome?: string | null; createdOrderId?: string | null;
  createdQuoteId?: string | null; archivedAt?: unknown; normalizedPayloadJson?: Record<string, unknown> | null;
}) {
  return record.sourceType === "email" && !record.createdOrderId && !record.createdQuoteId && !record.archivedAt
    && !["ignored", "terminal", "submitted", "approved"].includes(record.status)
    && !["ignored", "rejected", "deleted"].includes(record.reviewOutcome ?? "")
    && !record.normalizedPayloadJson?.combinedParentRecordId;
}

export const inboundEmailProcessingLabels: Record<InboundEmailProcessingStatus, string> = {
  waiting: "Waiting for AI draft", processing: "Preparing AI draft", review_ready: "AI draft ready for review",
  needs_attention: "AI draft needs attention", failed: "AI draft preparation failed", superseded: "Processing superseded",
};
