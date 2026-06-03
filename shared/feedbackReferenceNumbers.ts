export const feedbackReferencePrefixes = {
  bug: "B",
  feature: "F",
} as const;

export type FeedbackReferenceType = keyof typeof feedbackReferencePrefixes;

export function buildFeedbackReferenceNumber(type: FeedbackReferenceType, sequence: number): string {
  const prefix = feedbackReferencePrefixes[type];
  const normalized = Number.isFinite(sequence) ? Math.max(1, Math.floor(sequence)) : 1;
  return `${prefix}-${String(normalized).padStart(4, "0")}`;
}

export function isFeedbackReferenceNumber(value: string): boolean {
  return /^[BF]-[0-9]{4,}$/.test(value);
}

export function formatFeedbackReferenceLabel(referenceNumber: string | null | undefined, title: string | null | undefined): string {
  const reference = referenceNumber?.trim();
  const cleanTitle = title?.trim();
  if (reference && cleanTitle) return `${reference} ${cleanTitle}`;
  return reference || cleanTitle || "Untitled feedback";
}
