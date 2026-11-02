/** Business resolution is separate from AI processing and Quote progress. */
export type InboundAccountabilityRecord = {
  status: string; reviewOutcome?: string | null; createdOrderId?: string | null;
  createdQuoteId?: string | null; archivedAt?: unknown; normalizedPayloadJson?: Record<string, any> | null;
  accountabilityBucket?: InboundQueueBucket;
  linkedParentOrderId?: string | null;
};
export type InboundQueueBucket = "needs_review" | "waiting" | "ready" | "converted" | "rejected" | "ignored" | "deleted";
export function inboundLinkedOrderId(record: InboundAccountabilityRecord): string | null {
  return record.createdOrderId || record.normalizedPayloadJson?.attachedOrderId || record.linkedParentOrderId || null;
}
export function inboundQueueBucket(record: InboundAccountabilityRecord): InboundQueueBucket {
  if (record.accountabilityBucket) return record.accountabilityBucket;
  const metadata = record.normalizedPayloadJson ?? {};
  if (metadata.unresolvedEvidenceFingerprint || (metadata.evidenceResolution?.fingerprint && metadata.evidenceFingerprint
    && metadata.evidenceResolution.fingerprint !== metadata.evidenceFingerprint)) return "needs_review";
  // Legacy dispositions retain their historical meaning until an evidence writer
  // observes a change. Missing coverage is never stamped as a reviewed draft.
  if (record.reviewOutcome === "deleted") return "deleted";
  if ((record.status === "ignored" && record.reviewOutcome !== "attached_to_order") || record.reviewOutcome === "ignored") return "ignored";
  if (record.status === "terminal" || record.reviewOutcome === "rejected") return "rejected";
  if (inboundLinkedOrderId(record)) return "converted";
  if (record.createdQuoteId) return "waiting";
  if (record.status === "waiting_on_customer") return "waiting";
  if (record.status === "ready") return "ready";
  return "needs_review";
}
export function inboundIsPending(record: InboundAccountabilityRecord) {
  return ["needs_review", "waiting", "ready"].includes(inboundQueueBucket(record));
}
export function inboundAccountabilityLabel(record: InboundAccountabilityRecord) {
  const bucket = inboundQueueBucket(record);
  if (bucket === "needs_review" && inboundLinkedOrderId(record)) return "New evidence · linked Order requires review";
  if (bucket === "needs_review" && record.createdQuoteId) return "New evidence · linked Quote requires review";
  if (bucket === "waiting" && record.createdQuoteId) return "Awaiting quote acceptance";
  return null;
}
