import { createHash } from "node:crypto";
import { getManualInboundEvidence } from "@shared/inboundOrdersApi";

/** Hash only source evidence, never review state, timestamps of our own writes,
 * or other mutable bookkeeping. File identity is included even when its bytes
 * are not yet available so a later download changes the fingerprint.
 * Generated storage IDs and retrieval metadata are deliberately excluded. */
export function fingerprintInboundEmailEvidence(record: {
  sourceMessageId?: string | null;
  rawPayloadJson?: unknown;
  normalizedPayloadJson?: unknown;
  externalReference?: string | null;
  receivedAt?: Date | string | null;
}, files: Array<{
  providerMessageId?: string | null;
  providerAttachmentId?: string | null;
  sourceFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  fileRecordId?: string | null;
  role?: string | null;
  status?: string | null;
  metadataJson?: unknown;
  reviewNotes?: string | null;
}>): string {
  const raw = object(record.rawPayloadJson);
  const normalized = object(record.normalizedPayloadJson);
  const thread = object(raw.thread ?? normalized.thread);
  const evidence = getManualInboundEvidence({ rawPayloadJson: raw, normalizedPayloadJson: normalized, externalReference: record.externalReference ?? null });
  const compare = (a: unknown, b: unknown) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const messages = Array.isArray(thread.messages) ? thread.messages.map((value) => {
    const message = object(value);
    return {
      messageId: message.messageId ?? message.id ?? null,
      senderEmail: object(message.sender).email ?? message.senderEmail ?? null,
      subject: message.subject ?? null,
      bodyText: message.bodyText ?? null,
      bodyHtml: message.bodyHtml ?? null,
      receivedAt: message.receivedAt ?? message.date ?? null,
    };
  }).sort(compare) : [];
  const candidateValues = raw.attachments ?? normalized.attachments;
  const candidates = Array.isArray(candidateValues) ? candidateValues.map((value) => {
    const attachment = object(value);
    return {
      messageId: attachment.providerMessageId ?? attachment.messageId ?? null,
      attachmentId: attachment.attachmentId ?? attachment.providerAttachmentId ?? null,
      filename: attachment.filename ?? attachment.sourceFilename ?? null,
      mimeType: attachment.mimeType ?? null,
      size: attachment.size ?? attachment.sizeBytes ?? null,
      checksum: attachment.checksum ?? null,
      extractedText: attachment.extractedText ?? null,
      contentId: attachment.contentId ?? null,
      contentDisposition: attachment.contentDisposition ?? null,
    };
  }).sort(compare) : [];
  const attachmentEvidence = files.map((file) => ({
    providerMessageId: file.providerMessageId ?? null,
    providerAttachmentId: file.providerAttachmentId ?? null,
    name: file.sourceFilename ?? null,
    mimeType: file.mimeType ?? null,
    size: file.sizeBytes ?? null,
    checksum: file.checksum ?? null,
    available: Boolean(file.fileRecordId),
    role: file.role ?? null,
    status: file.status ?? null,
    attachmentState: object(file.metadataJson).attachmentState ?? null,
    evidenceNotes: file.reviewNotes ?? null,
    poCandidate: object(file.metadataJson).poCandidate ?? null,
    sourceHint: object(file.metadataJson).sourceHint ?? null,
  })).sort(compare);
  return "v1:" + createHash("sha256").update(JSON.stringify({
    messageId: record.sourceMessageId ?? null,
    sender: { name: evidence.senderName, email: evidence.senderEmail },
    subject: evidence.subject,
    reference: evidence.reference,
    notes: evidence.notes,
    receivedAt: raw.receivedAt ?? record.receivedAt ?? null,
    bodyText: evidence.bodyText,
    bodyHtml: raw.bodyHtml ?? normalized.bodyHtml ?? null,
    combinedSources: (Array.isArray(object(record.normalizedPayloadJson).combinedSources)
      ? object(record.normalizedPayloadJson).combinedSources as unknown[] : []).map((value) => {
        const source = object(object(value).evidence);
        return { subject: source.subject ?? null, senderName: source.senderName ?? null, senderEmail: source.senderEmail ?? null,
          bodyText: source.bodyText ?? null, bodyHtml: source.bodyHtml ?? null, notes: source.notes ?? null, reference: source.reference ?? null };
      }).sort(compare),
    messages,
    candidates,
    attachments: attachmentEvidence,
  })).digest("hex");
}

export const INBOUND_EVIDENCE_REVIEW_REQUIRED = "Source evidence changed or is untracked. Staff edits are preserved. Parse current evidence and deliberately refresh the review draft before approval.";

export class InboundEvidenceConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = INBOUND_EVIDENCE_REVIEW_REQUIRED) { super(message); }
}

export function evidenceFingerprintFromSnapshot(snapshot: { payloadJson?: unknown } | null): string | null {
  const value = object(object(snapshot?.payloadJson).metadata).evidenceFingerprint;
  return typeof value === "string" && value ? value : null;
}

export function evidenceFingerprintFromAttempt(attempt: { rawResponse?: unknown } | null): string | null {
  const value = object(attempt?.rawResponse).inboundEvidenceFingerprint;
  return typeof value === "string" && value ? value : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
