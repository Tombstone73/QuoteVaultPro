import { and, eq, sql } from "drizzle-orm";
import { google } from "googleapis";

import { db } from "../db";
import {
  inboundEmailMailboxes,
  inboundOrderEvents,
  inboundOrderRecords,
  inboundOrderSources,
  type InboundEmailIgnoreRule,
  type InboundEmailIgnoreRuleType,
  type InboundEmailMailbox,
  type InboundEmailTrustRule,
  type InboundEmailTrustRuleType,
  type InboundAttachmentClassificationRule,
  type InboundOrderFile,
  type InboundOrderRecord,
  type InboundOrderSource,
} from "@shared/schema";
import type { InboundEmailIntent, InboundEmailPullResult } from "@shared/inboundEmailIngestion";
import { isPublicFreeEmailDomain } from "@shared/inboundEmailTrustDomains";
import {
  classifyInboundAttachment,
  inboundAttachmentClassificationToRole,
  type InboundAttachmentClassification,
  type InboundAttachmentClassificationResult,
} from "@shared/inboundAttachmentClassification";
import { inboundOrdersRepository, type InboundOrdersRepository } from "../storage/inboundOrders.repo";
import { storageApplicationService, type StorageApplicationService } from "./storage/StorageApplicationService";

export type InboundEmailAttachmentMetadata = {
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  attachmentId?: string | null;
  providerMessageId?: string | null;
  contentDisposition?: string | null;
  contentId?: string | null;
  partId?: string | null;
  detectedBy?: string[];
  dedupeKey?: string | null;
  dedupeStrategy?: string | null;
  seenProviderMessageIds?: string[];
  seenInMessages?: Array<{
    messageId: string;
    subject: string | null;
    receivedAt: string | null;
  }>;
  seenInMessageCount?: number | null;
};

export type InboundEmailAttachmentContent = {
  buffer: Buffer;
  mimeType: string | null;
  sizeBytes: number;
};

export type GmailPayloadPartDiagnostic = {
  partId: string | null;
  mimeType: string | null;
  filenamePresent: boolean;
  filename: string | null;
  attachmentIdPresent: boolean;
  bodySize: number | null;
  headers: {
    contentType: string | null;
    contentDisposition: string | null;
    contentId: string | null;
  };
  childParts: GmailPayloadPartDiagnostic[];
};

export type InboundEmailProviderMessage = {
  provider: string;
  messageId: string;
  threadId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  to?: string[];
  cc?: string[];
  subject: string | null;
  receivedAt: Date | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: InboundEmailAttachmentMetadata[];
};

type InboundEmailListDiagnostics = {
  provider: string;
  query: string;
  labelIds: string[] | null;
  maxResults: number;
  pageCount: number;
  totalMessageIdsReturned: number;
  listedMessages: Array<{
    providerMessageId: string;
    threadId: string | null;
    subject: string | null;
    displaySubject?: string;
    senderName: string | null;
    senderEmail: string | null;
    receivedAt: string | null;
  }>;
};

type InboundEmailProcessingOutcome =
  | "created_record"
  | "updated_thread_container"
  | "duplicate"
  | "ignored_rule"
  | "internal_sender_skipped"
  | "rejected"
  | "failed"
  | "classification_skipped"
  | "missing_required_data"
  | "no_subject_ingested"
  | "other";

type InboundEmailMessageProcessingDiagnostic = {
  providerMessageId: string;
  threadId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  senderDomain: string | null;
  subject: string | null;
  displaySubject: string;
  receivedAt: string | null;
  processingOutcome: InboundEmailProcessingOutcome;
  reason: string;
  inboundRecordId: string | null;
  classificationOutcome?: InboundEmailIntent | null;
  classificationReason?: string | null;
  crmInfluence?: string | null;
};

type InboundEmailProcessMessageResult =
  | {
      status: "created";
      recordId: string;
      processingOutcome: "created_record" | "no_subject_ingested";
      reason: string;
      classificationOutcome?: InboundEmailIntent | null;
      classificationReason?: string | null;
      crmInfluence?: string | null;
    }
  | {
      status: "skippedDuplicates" | "ignored";
      recordId?: string | null;
      processingOutcome: Exclude<InboundEmailProcessingOutcome, "created_record" | "no_subject_ingested" | "failed">;
      reason: string;
      classificationOutcome?: InboundEmailIntent | null;
      classificationReason?: string | null;
      crmInfluence?: string | null;
    };

type InboundEmailManualReprocessAction = "reprocess_email" | "backfill_attachments" | "rerun_trust_attachment_download";
type InboundEmailEvidenceRefreshAction = InboundEmailManualReprocessAction | "initial_thread_ingestion" | "thread_message_appended";

type InboundEmailManualReprocessResult = {
  action: InboundEmailManualReprocessAction;
  inboundRecordId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  threadMessagesInspected: number;
  latestThreadActivity: string | null;
  candidatesFound: number;
  attempted: number;
  stored: number;
  metadataOnly: number;
  failed: number;
  skipped: number;
  diagnosticsByMessage: AttachmentIngestionDiagnostics[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attachmentMetadataFromUnknown(value: unknown): InboundEmailAttachmentMetadata | null {
  if (!isRecord(value)) return null;
  const filename = stringFromUnknown(value.filename) ?? stringFromUnknown(value.sourceFilename);
  const mimeType = stringFromUnknown(value.mimeType);
  const size = typeof value.size === "number"
    ? value.size
    : typeof value.sizeBytes === "number"
      ? value.sizeBytes
      : null;
  const attachmentId = stringFromUnknown(value.attachmentId) ?? stringFromUnknown(value.providerAttachmentId);
  const providerMessageId = stringFromUnknown(value.providerMessageId) ?? stringFromUnknown(value.messageId);
  const contentDisposition = stringFromUnknown(value.contentDisposition);
  const contentId = stringFromUnknown(value.contentId);
  const partId = stringFromUnknown(value.partId) ?? stringFromUnknown(value.gmailPartId);
  const detectedBy = Array.isArray(value.detectedBy)
    ? value.detectedBy.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const seenProviderMessageIds = Array.isArray(value.seenProviderMessageIds)
    ? value.seenProviderMessageIds.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const seenInMessages = Array.isArray(value.seenInMessages)
    ? value.seenInMessages
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const messageId = stringFromUnknown(entry.messageId);
        if (!messageId) return null;
        return {
          messageId,
          subject: stringFromUnknown(entry.subject),
          receivedAt: stringFromUnknown(entry.receivedAt),
        };
      })
      .filter((entry): entry is { messageId: string; subject: string | null; receivedAt: string | null } => Boolean(entry))
    : undefined;
  if (!filename && !mimeType && !attachmentId && !contentDisposition && !contentId && !partId) return null;
  return {
    filename,
    mimeType,
    size,
    attachmentId,
    providerMessageId,
    contentDisposition,
    contentId,
    partId,
    detectedBy,
    dedupeKey: stringFromUnknown(value.dedupeKey),
    dedupeStrategy: stringFromUnknown(value.dedupeStrategy),
    seenProviderMessageIds,
    seenInMessages,
    seenInMessageCount: typeof value.seenInMessageCount === "number" ? value.seenInMessageCount : null,
  };
}

function attachmentMetadataListFromUnknown(value: unknown): InboundEmailAttachmentMetadata[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => attachmentMetadataFromUnknown(entry))
    .filter((entry): entry is InboundEmailAttachmentMetadata => Boolean(entry));
}

function attachmentCandidatesFromPayload(payload: unknown): InboundEmailAttachmentMetadata[] {
  if (!isRecord(payload)) return [];
  return attachmentMetadataListFromUnknown(payload.attachments);
}

function dedupeAttachmentCandidates(attachments: InboundEmailAttachmentMetadata[]): InboundEmailAttachmentMetadata[] {
  const seen = new Set<string>();
  const deduped: InboundEmailAttachmentMetadata[] = [];
  for (const attachment of attachments) {
    const messageKey = attachment.providerMessageId ?? "";
    const key = attachment.attachmentId
      ? `id:${messageKey}:${attachment.attachmentId}`
      : `meta:${messageKey}:${attachment.filename ?? ""}|${attachment.mimeType ?? ""}|${attachment.size ?? ""}|${attachment.partId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attachment);
  }
  return deduped;
}

function normalizeAttachmentDedupePart(value: string | number | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function attachmentProviderDedupeKey(
  attachment: InboundEmailAttachmentMetadata,
  providerMessageId: string | null | undefined,
): string | null {
  return attachment.attachmentId && providerMessageId
    ? `provider:${normalizeAttachmentDedupePart(providerMessageId)}:${normalizeAttachmentDedupePart(attachment.attachmentId)}`
    : null;
}

function attachmentMessageMetadataDedupeKey(
  attachment: InboundEmailAttachmentMetadata,
  providerMessageId: string | null | undefined,
): string | null {
  const filename = normalizeAttachmentDedupePart(attachment.filename);
  const size = normalizeAttachmentDedupePart(attachment.size);
  const mimeType = normalizeAttachmentDedupePart(attachment.mimeType);
  const messageId = normalizeAttachmentDedupePart(providerMessageId);
  if (!messageId || !filename || !size || !mimeType) return null;
  return `message-file:${messageId}:${filename}:${size}:${mimeType}`;
}

function attachmentGlobalMetadataDedupeKey(attachment: InboundEmailAttachmentMetadata): string | null {
  const filename = normalizeAttachmentDedupePart(attachment.filename);
  const size = normalizeAttachmentDedupePart(attachment.size);
  const mimeType = normalizeAttachmentDedupePart(attachment.mimeType);
  if (!filename || !size || !mimeType) return null;
  return `file:${filename}:${size}:${mimeType}`;
}

function attachmentDedupeKeysForCandidate(
  attachment: InboundEmailAttachmentMetadata,
  providerMessageId: string | null | undefined,
): string[] {
  return [
    attachmentProviderDedupeKey(attachment, providerMessageId),
    attachmentMessageMetadataDedupeKey(attachment, providerMessageId),
    attachmentGlobalMetadataDedupeKey(attachment),
  ].filter((key): key is string => Boolean(key));
}

function inboundFileGlobalDedupeKey(file: InboundOrderFile): string | null {
  const filename = normalizeAttachmentDedupePart(file.sourceFilename);
  const size = normalizeAttachmentDedupePart(file.sizeBytes);
  const mimeType = normalizeAttachmentDedupePart(file.mimeType);
  if (!filename || !size || !mimeType) return null;
  return `file:${filename}:${size}:${mimeType}`;
}

function inboundFileDedupeKeys(file: InboundOrderFile): string[] {
  const metadata = isRecord(file.metadataJson) ? file.metadataJson : {};
  const providerMessageId = file.providerMessageId ?? stringFromUnknown(metadata.providerMessageId);
  const providerAttachmentId = file.providerAttachmentId ?? stringFromUnknown(metadata.providerAttachmentId);
  return [
    stringFromUnknown(metadata.attachmentDedupeKey),
    providerMessageId && providerAttachmentId
      ? `provider:${normalizeAttachmentDedupePart(providerMessageId)}:${normalizeAttachmentDedupePart(providerAttachmentId)}`
      : null,
    providerMessageId
      ? `message-file:${normalizeAttachmentDedupePart(providerMessageId)}:${normalizeAttachmentDedupePart(file.sourceFilename)}:${normalizeAttachmentDedupePart(file.sizeBytes)}:${normalizeAttachmentDedupePart(file.mimeType)}`
      : null,
    inboundFileGlobalDedupeKey(file),
  ].filter((key): key is string => Boolean(key));
}

function dedupeThreadAttachmentMessages(messages: InboundEmailProviderMessage[]): InboundEmailProviderMessage[] {
  const byKey = new Map<string, {
    messageIndex: number;
    attachmentIndex: number;
    seenMessageIds: Set<string>;
    seenInMessages: Array<{ messageId: string; subject: string | null; receivedAt: string | null }>;
  }>();
  const nextMessages = messages.map((message) => ({ ...message, attachments: [] as InboundEmailAttachmentMetadata[] }));

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    const providerMessageId = message.messageId;
    for (const rawAttachment of message.attachments) {
      const attachment = {
        ...rawAttachment,
        providerMessageId: rawAttachment.providerMessageId ?? providerMessageId,
      };
      const candidateKeys = attachmentDedupeKeysForCandidate(attachment, attachment.providerMessageId);
      const key = candidateKeys[0] ?? `${messageIndex}:${nextMessages[messageIndex].attachments.length}`;
      const globalKey = attachmentGlobalMetadataDedupeKey(attachment);
      const seen = candidateKeys.map((candidateKey) => byKey.get(candidateKey)).find(Boolean);
      const occurrence = {
        messageId: providerMessageId,
        subject: message.subject,
        receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
      };
      if (seen) {
        if (!seen.seenMessageIds.has(providerMessageId)) {
          seen.seenMessageIds.add(providerMessageId);
          seen.seenInMessages.push(occurrence);
        }
        const retained = nextMessages[seen.messageIndex].attachments[seen.attachmentIndex];
        retained.seenProviderMessageIds = Array.from(seen.seenMessageIds);
        retained.seenInMessages = seen.seenInMessages;
        retained.seenInMessageCount = seen.seenMessageIds.size;
        continue;
      }

      const retained = {
        ...attachment,
        dedupeKey: key,
        dedupeStrategy: key === globalKey ? "filename_size_mime" : attachment.attachmentId ? "provider_message_attachment" : "message_filename_size_mime",
        seenProviderMessageIds: [providerMessageId],
        seenInMessages: [occurrence],
        seenInMessageCount: 1,
      };
      const entry = {
        messageIndex,
        attachmentIndex: nextMessages[messageIndex].attachments.length,
        seenMessageIds: new Set([providerMessageId]),
        seenInMessages: [occurrence],
      };
      for (const candidateKey of candidateKeys.length > 0 ? candidateKeys : [key]) {
        byKey.set(candidateKey, entry);
      }
      nextMessages[messageIndex].attachments.push(retained);
    }
  }

  return nextMessages;
}

type AttachmentIngestionDiagnostics = {
  messageId: string;
  subject: string | null;
  attachmentPartsDiscovered: number;
  attachmentCandidatesDiscovered: number;
  attachmentIdsDiscovered: string[];
  attachmentPartsAttempted: number;
  attachmentRowsCreated: number;
  storedRowsCreated: number;
  metadataOnlyRowsCreated: number;
  downloadAttempts: number;
  downloadSuccesses: number;
  downloadFailures: number;
  skippedExistingProviderAttachments: number;
  skippedReason: string | null;
  failures: Array<Record<string, unknown>>;
  safetyDecisions?: Array<Record<string, unknown>>;
};

type AttachmentIngestionCallAudit = {
  organizationId: string;
  inboundRecordId: string;
  providerMessageId: string;
  subject: string | null;
  candidateCount: number;
  attachmentIdsDiscovered: string[];
  trustStatus: string;
  attachmentPolicy: string;
  matchedTrustRuleId: string | null;
  trustRuleType: string | null;
  trustReason: string | null;
  providerIdentifierColumnDiagnostics: Array<Record<string, unknown>>;
};

type InboundAttachmentState =
  | "metadata_only"
  | "pending_trust"
  | "blocked_file_type"
  | "download_pending"
  | "downloaded"
  | "scan_pending"
  | "scan_passed"
  | "scan_failed"
  | "quarantined"
  | "download_failed";

type SenderTrustDecision = {
  trusted: boolean;
  senderEmail: string | null;
  senderDomain: string | null;
  trustSource: InboundEmailTrustRuleType | "none" | "ignored";
  ruleId: string | null;
  reason: string;
};

type AttachmentSafetyDecision = {
  extension: string | null;
  blocked: boolean;
  allowedForAutoDownload: boolean;
  zipFile: boolean;
  downloadAllowed: boolean;
  attachmentState: InboundAttachmentState;
  reason: string;
};

function trustStatusFromDecision(decision: SenderTrustDecision): string {
  if (decision.trustSource === "ignored") return "ignored";
  if (decision.trustSource === "sender_email_exact") return "trusted_sender";
  if (decision.trustSource === "sender_domain") return "trusted_domain";
  if (decision.trustSource === "customer_contact_email") return "trusted_contact";
  if (decision.trustSource === "customer_domain") return "trusted_customer_domain";
  if (!decision.senderEmail) return "unknown";
  return decision.trusted ? "trusted_sender" : "untrusted";
}

function isInboundEmailAddressRule(ruleType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType): boolean {
  return ruleType === "sender_email_exact" || ruleType === "customer_contact_email";
}

function isInboundEmailDomainRule(ruleType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType): boolean {
  return ruleType === "sender_domain" || ruleType === "customer_domain";
}

function inboundEmailRuleTypesConflict(
  leftType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType,
  leftValue: string,
  rightType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType,
  rightValue: string,
): boolean {
  const left = leftValue.trim().toLowerCase();
  const right = rightValue.trim().toLowerCase();
  if (!left || !right || left === "*" || right === "*") return false;
  return left === right && (
    (isInboundEmailAddressRule(leftType) && isInboundEmailAddressRule(rightType))
    || (isInboundEmailDomainRule(leftType) && isInboundEmailDomainRule(rightType))
  );
}

function providerIdentifierColumnDiagnostics(args: {
  message: InboundEmailProviderMessage;
  attachmentCandidates: InboundEmailAttachmentMetadata[];
}): Array<Record<string, unknown>> {
  return args.attachmentCandidates.flatMap((attachment, index) => [
    {
      candidateIndex: index,
      table: "inbound_order_files",
      column: "provider_attachment_id",
      currentType: "text",
      previousType: "varchar(255)",
      actualStringLength: attachment.attachmentId?.length ?? 0,
      originatingGmailField: "payload.parts[].body.attachmentId",
      sourceFilename: attachment.filename,
      exceedsPreviousLimit: Boolean(attachment.attachmentId && attachment.attachmentId.length > 255),
    },
    {
      candidateIndex: index,
      table: "inbound_order_files",
      column: "provider_message_id",
      currentType: "text",
      previousType: "varchar(255)",
      actualStringLength: args.message.messageId.length,
      originatingGmailField: "messages[].id",
      sourceFilename: attachment.filename,
      exceedsPreviousLimit: args.message.messageId.length > 255,
    },
  ]);
}

const BLOCKED_INBOUND_ATTACHMENT_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "scr",
  "js",
  "vbs",
  "ps1",
  "msi",
  "dll",
  "jar",
  "com",
  "reg",
  "iso",
  "lnk",
  "html",
  "htm",
]);

const ALLOWED_INBOUND_ATTACHMENT_EXTENSIONS = new Set([
  "pdf",
  "ai",
  "eps",
  "svg",
  "tif",
  "tiff",
  "jpg",
  "jpeg",
  "png",
  "doc",
  "docx",
  "zip",
]);

export interface InboundEmailProviderAdapter {
  listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]>;
  getLastListDiagnostics?(): InboundEmailListDiagnostics | null;
  getMessage?(mailbox: InboundEmailMailbox, messageId: string): Promise<InboundEmailProviderMessage>;
  getThreadMessages?(mailbox: InboundEmailMailbox, threadId: string): Promise<InboundEmailProviderMessage[]>;
  getMessagePayloadDiagnostics?(
    mailbox: InboundEmailMailbox,
    messageId: string,
  ): Promise<{ messageId: string; payloadTree: GmailPayloadPartDiagnostic | null; extractedAttachmentCount: number; extractedAttachments: InboundEmailAttachmentMetadata[] }>;
  downloadAttachment?(
    mailbox: InboundEmailMailbox,
    message: InboundEmailProviderMessage,
    attachment: InboundEmailAttachmentMetadata,
  ): Promise<InboundEmailAttachmentContent>;
}

export class InboundEmailIngestionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InboundEmailIngestionError";
  }
}

const SPAM_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bwebinar\b/i,
  /\blimited time offer\b/i,
  /\bsale ends\b/i,
  /\bseo\b/i,
  /\blead generation\b/i,
  /\bsponsored\b/i,
  /\bvendor promo\b/i,
  /\bmarketing\b/i,
];

const STRONG_SPAM_SIGNAL_PATTERNS = [
  /\blimited time offer\b/i,
  /\bsale ends\b/i,
  /\bseo\b/i,
  /\blead generation\b/i,
  /\bsponsored\b/i,
  /\bvendor promo\b/i,
  /\bbulk email\b/i,
];

const QUOTE_PATTERNS = [
  /\bquote\b/i,
  /\bestimate\b/i,
  /\bpricing\b/i,
  /\bhow much\b/i,
  /\bcan you price\b/i,
  /\bprice this\b/i,
];

const ORDER_PATTERNS = [
  /\bplease proceed\b/i,
  /\battached po\b/i,
  /\bpurchase order\b/i,
  /\bplease print\b/i,
  /\brun these\b/i,
  /\bsame as last time\b/i,
  /\battached art for order\b/i,
  /\bpo attached\b/i,
];

const STRONG_ORDER_SUBJECT_PATTERNS: Array<{ pattern: RegExp; reason: string; score: number }> = [
  { pattern: /\bnew\s+order\b/i, reason: "subject contains \"New Order\"", score: 70 },
  { pattern: /\border\s+request\b/i, reason: "subject contains order request", score: 55 },
  { pattern: /\border\s+for\b/i, reason: "subject contains order for", score: 50 },
  { pattern: /\bplease\s+order\b/i, reason: "subject contains please order", score: 50 },
  { pattern: /\bprint\s+order\b/i, reason: "subject contains print order", score: 55 },
  { pattern: /\bproduction\s+order\b/i, reason: "subject contains production order", score: 55 },
  { pattern: /\bre[\s-]?order\b/i, reason: "subject contains reorder", score: 55 },
  { pattern: /\brepeat\s+order\b/i, reason: "subject contains repeat order", score: 55 },
  { pattern: /\bnew\s+job\b/i, reason: "subject contains new job", score: 55 },
  { pattern: /\bjob\s+request\b/i, reason: "subject contains job request", score: 55 },
];

const COMMUNICATION_PROTECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\border\s+status\b/i, reason: "status request detected" },
  { pattern: /\bwhere\s+is\s+my\s+order\b/i, reason: "order status request detected" },
  { pattern: /\bdid\s+this\s+ship\b/i, reason: "shipping status request detected" },
  { pattern: /\b(?:has|have)\s+(?:this|it|these|they)\s+shipped\b/i, reason: "shipping status request detected" },
  { pattern: /\btracking\b/i, reason: "shipping status request detected" },
  { pattern: /\bresend\s+(?:the\s+)?invoice\b/i, reason: "invoice resend request detected" },
  { pattern: /\binvoice\s*#?\s*\d{3,}\b.*\bresend\b/i, reason: "invoice resend request detected" },
  { pattern: /\bpayment\s+(?:question|issue|problem)\b/i, reason: "payment question detected" },
  { pattern: /\bproof\s+(?:question|change|revision|approval|status)\b/i, reason: "proof question detected" },
  { pattern: /\bcancel(?:lation)?\s+(?:this\s+)?order\b/i, reason: "cancellation request detected" },
  { pattern: /\bcomplaint\b|\bsupport\s+(?:issue|request)\b/i, reason: "support issue detected" },
];

const PRODUCT_SPEC_PATTERNS = [
  /\bdouble\s+sided\b/i,
  /\bsingle\s+sided\b/i,
  /\b\d+(?:\.\d+)?\s*(?:'|ft|feet|in|inch|inches)\b/i,
  /\bground\s+spike\b/i,
  /\bbase\b/i,
  /\bmaterial\b/i,
  /\bfinishing\b/i,
  /\bgrommets?\b/i,
  /\blaminate(?:d|ion)?\b/i,
  /\bvinyl\b/i,
];

type InboundEmailReviewClassification = {
  ignored: boolean;
  intent: InboundEmailIntent;
  reason: string;
  reasons: string[];
  crmInfluence: string | null;
};

function appendReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function scoreOrderIntent(message: InboundEmailProviderMessage): {
  score: number;
  reasons: string[];
  protectionReasons: string[];
} {
  const subject = String(message.subject ?? "");
  const body = [message.bodyText, message.bodyHtml].filter(Boolean).join("\n");
  const text = [subject, body].filter(Boolean).join("\n");
  const reasons: string[] = [];
  const protectionReasons: string[] = [];
  let score = 0;

  for (const candidate of STRONG_ORDER_SUBJECT_PATTERNS) {
    if (candidate.pattern.test(subject)) {
      score += candidate.score;
      appendReason(reasons, candidate.reason);
    }
  }

  if (ORDER_PATTERNS.some((pattern) => pattern.test(text))) {
    score += 45;
    appendReason(reasons, "order request language detected");
  }

  if (message.attachments.some((attachment) => /\bpo\b|purchase.?order/i.test(attachment.filename ?? ""))) {
    score += 35;
    appendReason(reasons, "purchase-order attachment filename detected");
  }

  if (/\bsend\s+us\s+an\s+invoice\s+for\b/i.test(body)) {
    score += 35;
    appendReason(reasons, "body asks to send an invoice for a product");
  }

  if (/\b(?:qty|quantity)?\s*\d+\s+[A-Z][A-Z0-9'’ -]{2,80}\b/i.test(body)) {
    score += 25;
    appendReason(reasons, "quantity detected");
    appendReason(reasons, "product phrase detected");
  }

  if (PRODUCT_SPEC_PATTERNS.some((pattern) => pattern.test(body))) {
    score += 20;
    appendReason(reasons, "specs detected");
  }

  if (message.attachments.length > 0 || /\battached\s+(?:are\s+)?(?:the\s+)?files?\b/i.test(body)) {
    score += 10;
    appendReason(reasons, "attachments present");
  }

  for (const candidate of COMMUNICATION_PROTECTION_PATTERNS) {
    if (candidate.pattern.test(text)) appendReason(protectionReasons, candidate.reason);
  }

  return { score, reasons, protectionReasons };
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getPathValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, source);
}

function numberFromUnknown(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function displaySubjectForMessage(message: Pick<InboundEmailProviderMessage, "subject">): string {
  return stringFromUnknown(message.subject) ?? "(no subject)";
}

function externalReferenceForMessage(message: Pick<InboundEmailProviderMessage, "subject" | "senderEmail" | "receivedAt">): string {
  const subject = stringFromUnknown(message.subject);
  if (subject) return subject;
  const sender = stringFromUnknown(message.senderEmail);
  const receivedAt = message.receivedAt && !Number.isNaN(message.receivedAt.getTime())
    ? message.receivedAt.toISOString().slice(0, 10)
    : null;
  return [sender, receivedAt].filter(Boolean).length > 0
    ? `(no subject) ${[sender, receivedAt].filter(Boolean).join(" ")}`
    : "(no subject)";
}

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function headerMapFromUnknown(headers: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(headers)) return map;
  for (const header of headers) {
    const name = String((header as any)?.name ?? "").trim().toLowerCase();
    if (!name) continue;
    map.set(name, String((header as any)?.value ?? ""));
  }
  return map;
}

function headerValue(headers: Map<string, string>, name: string): string | null {
  return stringFromUnknown(headers.get(name.toLowerCase()));
}

function parseHeaderParameter(header: string | null | undefined, parameter: string): string | null {
  if (!header) return null;
  const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const extended = header.match(new RegExp(`${escaped}\\*\\s*=\\s*(?:"([^"]+)"|([^;]+))`, "i"));
  const raw = extended?.[1] ?? extended?.[2] ?? header.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]+)"|([^;]+))`, "i"))?.[1] ?? header.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]+)"|([^;]+))`, "i"))?.[2] ?? null;
  const value = stringFromUnknown(raw?.replace(/^UTF-8''/i, ""));
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseAddress(value: string | null | undefined): { name: string | null; email: string | null } {
  const raw = String(value ?? "").trim();
  if (!raw) return { name: null, email: null };
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1]?.replace(/^"|"$/g, "").trim() || null,
      email: match[2]?.trim().toLowerCase() || null,
    };
  }
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return {
    name: emailMatch ? raw.replace(emailMatch[0], "").trim() || null : raw,
    email: emailMatch?.[0]?.toLowerCase() ?? null,
  };
}

type InboundEmailClassificationContext = {
  senderTrusted?: boolean;
  trustSource?: SenderTrustDecision["trustSource"] | null;
  trustReason?: string | null;
};

function senderRelationshipLabel(context: InboundEmailClassificationContext): string | null {
  if (!context.senderTrusted) return null;
  if (context.trustSource === "sender_email_exact") return "trusted sender";
  if (context.trustSource === "sender_domain") return "trusted sender domain";
  if (context.trustSource === "customer_contact_email") return "trusted contact";
  if (context.trustSource === "customer_domain") return "trusted customer domain";
  return "trusted customer relationship";
}

function classificationCrmInfluence(context: InboundEmailClassificationContext): string | null {
  const label = senderRelationshipLabel(context);
  if (!label) return null;
  return `${label}: ${context.trustReason ?? "Sender has a known customer relationship."}`;
}

function hasStrongSpamIndicators(text: string, spamMatchCount: number): boolean {
  const hasUnsubscribe = /\bunsubscribe\b/i.test(text);
  const hasStrongSignal = STRONG_SPAM_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
  return (hasUnsubscribe && hasStrongSignal) || spamMatchCount >= 3;
}

export function classifyInboundEmailForReview(
  message: InboundEmailProviderMessage,
  context: InboundEmailClassificationContext = {},
): InboundEmailReviewClassification {
  const text = [message.subject, message.bodyText, message.bodyHtml].filter(Boolean).join("\n").slice(0, 20000);
  const crmInfluence = classificationCrmInfluence(context);
  if (!text.trim() && message.attachments.length === 0) return { ignored: true, intent: "UNKNOWN", reason: "No subject, body text, or attachments.", reasons: ["No subject, body text, or attachments."], crmInfluence };
  if (!text.trim() && message.attachments.length > 0) return { ignored: false, intent: "UNKNOWN", reason: "Attachment-only inbound message needs staff review.", reasons: ["Attachment-only inbound message needs staff review."], crmInfluence };

  const quote = QUOTE_PATTERNS.some((pattern) => pattern.test(text));
  const orderScore = scoreOrderIntent(message);
  const order = orderScore.score >= 45;
  const spamMatches = SPAM_PATTERNS.filter((pattern) => pattern.test(text));
  const trustedCustomerCommunication = Boolean(context.senderTrusted && context.trustSource !== "ignored" && context.trustSource !== "none");
  const protectedCommunication = orderScore.protectionReasons.length > 0;

  if (protectedCommunication && (!order || orderScore.score < 80)) {
    const reasons = orderScore.protectionReasons;
    return {
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reason: reasons.join("; "),
      reasons,
      crmInfluence,
    };
  }

  if (order && !quote) {
    const reason = orderScore.reasons.length > 0 ? `Explicit order intent detected: ${orderScore.reasons.join("; ")}.` : "Order request language detected.";
    return { ignored: false, intent: "ORDER_REQUEST", reason, reasons: orderScore.reasons.length > 0 ? orderScore.reasons : ["Order request language detected."], crmInfluence };
  }
  if (quote && !order) return { ignored: false, intent: "QUOTE_REQUEST", reason: "Quote request language detected.", reasons: ["Quote request language detected."], crmInfluence };
  if (quote && order) {
    const reasons = ["Order and quote language detected; order intent takes review priority.", ...orderScore.reasons];
    return { ignored: false, intent: "ORDER_REQUEST", reason: reasons[0], reasons, crmInfluence };
  }

  if (spamMatches.length > 0) {
    if (trustedCustomerCommunication && !hasStrongSpamIndicators(text, spamMatches.length)) {
      return {
        ignored: false,
        intent: "CUSTOMER_COMMUNICATION",
        reason: "Known customer/contact communication contained weak newsletter wording, so it remains available for staff review.",
        reasons: ["Known customer/contact communication contained weak newsletter wording."],
        crmInfluence,
      };
    }
    const reason = trustedCustomerCommunication
      ? "Strong marketing/newsletter indicators detected despite known customer relationship."
      : "Ignored obvious marketing/newsletter email.";
    return {
      ignored: true,
      intent: "NEWSLETTER_SPAM",
      reason,
      reasons: [reason],
      crmInfluence,
    };
  }

  if (trustedCustomerCommunication) {
    return {
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reason: "Known customer/contact communication needs staff review.",
      reasons: ["Known customer/contact communication needs staff review."],
      crmInfluence,
    };
  }
  return { ignored: false, intent: "UNKNOWN", reason: "Ambiguous inbound request.", reasons: ["Ambiguous inbound request."], crmInfluence };
}

function normalizeAttachmentFileName(value: string | null | undefined): string {
  return String(value ?? "attachment").trim().replace(/[\r\n\t\0]/g, " ").replace(/[\\/]+/g, "_").slice(0, 240) || "attachment";
}

function getExtension(value: string | null | undefined): string {
  const match = String(value ?? "").toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "";
}

function attachmentExtension(attachment: Pick<InboundEmailAttachmentMetadata, "filename" | "mimeType">): string | null {
  const filenameExtension = getExtension(attachment.filename);
  const extension = filenameExtension || extensionFromMimeType(attachment.mimeType);
  return extension && extension !== "bin" ? extension : null;
}

function senderEmailFromMessage(message: Pick<InboundEmailProviderMessage, "senderEmail">): string | null {
  const email = String(message.senderEmail ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

function senderDomainFromMessage(message: Pick<InboundEmailProviderMessage, "senderEmail">): string | null {
  const email = senderEmailFromMessage(message);
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function domainFromEmail(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1]?.trim().toLowerCase() : null;
  return domain || null;
}

function isClearForwardedInboundRequest(message: InboundEmailProviderMessage): boolean {
  const subject = String(message.subject ?? "");
  const body = [message.bodyText, message.bodyHtml].filter(Boolean).join("\n").slice(0, 12000);
  const hasForwardSubject = /^\s*(fw|fwd|forwarded)\s*:/i.test(subject);
  const hasForwardHeaders = /\bfrom:\s*[^@\n<>]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body)
    && /\b(to|sent|date|subject):\s+/i.test(body);
  if (!hasForwardSubject && !hasForwardHeaders) return false;
  const internalDomains = new Set(["titan-graphics.com"]);
  const forwardedFrom = body.match(/\bfrom:\s*(?:.*?<)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i)?.[1]?.toLowerCase() ?? null;
  const forwardedDomain = domainFromEmail(forwardedFrom);
  return Boolean(forwardedDomain && !internalDomains.has(forwardedDomain));
}

export function isInternalOutboundInboundEmailMessage(
  mailbox: Pick<InboundEmailMailbox, "emailAddress" | "settingsJson">,
  message: InboundEmailProviderMessage,
): { internal: boolean; reason: string | null; senderEmail: string | null; senderDomain: string | null } {
  const senderEmail = senderEmailFromMessage(message);
  const senderDomain = senderDomainFromMessage(message);
  if (!senderEmail && !senderDomain) return { internal: false, reason: null, senderEmail, senderDomain };
  if (isClearForwardedInboundRequest(message)) return { internal: false, reason: null, senderEmail, senderDomain };

  const mailboxEmail = String(mailbox.emailAddress ?? "").trim().toLowerCase();
  const configuredDomains = Array.isArray((mailbox.settingsJson as any)?.ownedDomains)
    ? (mailbox.settingsJson as any).ownedDomains
      .map((domain: unknown) => String(domain ?? "").trim().toLowerCase())
      .filter(Boolean)
    : [];
  const configuredAddresses = Array.isArray((mailbox.settingsJson as any)?.internalAddresses)
    ? (mailbox.settingsJson as any).internalAddresses
      .map((email: unknown) => String(email ?? "").trim().toLowerCase())
      .filter(Boolean)
    : [];
  const internalDomains = new Set(["titan-graphics.com", ...configuredDomains]);
  const internalAddresses = new Set(["dale@titan-graphics.com", mailboxEmail, ...configuredAddresses].filter(Boolean));

  if (senderEmail && internalAddresses.has(senderEmail)) {
    return { internal: true, reason: `Sender ${senderEmail} is an organization/internal mailbox address.`, senderEmail, senderDomain };
  }
  if (senderDomain && internalDomains.has(senderDomain)) {
    return { internal: true, reason: `Sender domain ${senderDomain} is organization/internal.`, senderEmail, senderDomain };
  }
  return { internal: false, reason: null, senderEmail, senderDomain };
}

function processingDiagnosticForMessage(
  message: InboundEmailProviderMessage,
  result: {
    processingOutcome: InboundEmailProcessingOutcome;
    reason: string;
    recordId?: string | null;
    classificationOutcome?: InboundEmailIntent | null;
    classificationReason?: string | null;
    crmInfluence?: string | null;
  },
): InboundEmailMessageProcessingDiagnostic {
  return {
    providerMessageId: message.messageId,
    threadId: message.threadId,
    senderName: message.senderName,
    senderEmail: senderEmailFromMessage(message),
    senderDomain: senderDomainFromMessage(message),
    subject: message.subject,
    displaySubject: displaySubjectForMessage(message),
    receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
    processingOutcome: result.processingOutcome,
    reason: result.reason,
    inboundRecordId: result.recordId ?? null,
    classificationOutcome: result.classificationOutcome ?? null,
    classificationReason: result.classificationReason ?? null,
    crmInfluence: result.crmInfluence ?? null,
  };
}

function attachmentMetadataProviderMessageId(file: InboundOrderFile, fallback: string): string {
  return file.providerMessageId || stringFromUnknown((file.metadataJson as Record<string, unknown> | null)?.providerMessageId) || fallback;
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("tiff")) return "tif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("zip")) return "zip";
  if (normalized.includes("postscript")) return "eps";
  if (normalized.includes("plain")) return "txt";
  if (normalized.includes("csv")) return "csv";
  return "bin";
}

function fallbackAttachmentFilename(args: {
  filename: string | null;
  mimeType: string | null;
  contentId: string | null;
  partId: string | null;
  attachmentId: string | null;
  index: number;
}): string {
  if (args.filename) return normalizeAttachmentFileName(args.filename);
  const ext = extensionFromMimeType(args.mimeType);
  const contentId = normalizeAttachmentFileName(args.contentId?.replace(/^<|>$/g, "") ?? "");
  if (contentId && contentId !== "attachment") {
    return contentId.includes(".") ? contentId : `${contentId}.${ext}`;
  }
  const stableId = normalizeAttachmentFileName(args.partId ?? args.attachmentId ?? String(args.index + 1));
  return `attachment-${stableId}.${ext}`;
}

function isLikelyAttachmentMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  if (!normalized || normalized.startsWith("multipart/")) return false;
  if (normalized === "text/plain" || normalized === "text/html") return false;
  if (normalized === "message/rfc822") return false;
  return (
    normalized.startsWith("image/")
    || normalized.includes("pdf")
    || normalized.includes("zip")
    || normalized.includes("postscript")
    || normalized.includes("illustrator")
    || normalized.includes("svg")
    || normalized.includes("octet-stream")
    || normalized.includes("msword")
    || normalized.includes("officedocument")
  );
}

function detectAttachmentSourceHint(message: Pick<InboundEmailProviderMessage, "subject" | "bodyText" | "bodyHtml">): string | null {
  const text = [message.subject, message.bodyText, message.bodyHtml].filter(Boolean).join("\n").slice(0, 20000);
  if (/\bartwork\s*(?:&|and)\s*visual\s*po\b/i.test(text)) return "Artwork & Visual PO";
  if (/\bartwork\b.{0,80}\bpo\b/i.test(text)) return "Artwork referenced near PO";
  if (/\bvisual\s*po\b/i.test(text)) return "Visual PO";
  return null;
}

export function extractGmailBodyAndAttachments(part: any): { text: string; html: string; attachments: InboundEmailAttachmentMetadata[] } {
  let text = "";
  let html = "";
  const attachments: InboundEmailAttachmentMetadata[] = [];

  const visit = (node: any) => {
    if (!node) return;
    const mimeType = String(node.mimeType ?? "");
    const body = node.body ?? {};
    const headers = headerMapFromUnknown(node.headers);
    const contentDisposition = headerValue(headers, "content-disposition");
    const contentType = headerValue(headers, "content-type");
    const contentId = headerValue(headers, "content-id");
    const attachmentId = body.attachmentId ? String(body.attachmentId) : null;
    const headerFilename = parseHeaderParameter(contentDisposition, "filename")
      ?? parseHeaderParameter(contentType, "name");
    const gmailFilename = stringFromUnknown(node.filename);
    const filename = gmailFilename ?? headerFilename;
    const partId = node.partId ? String(node.partId) : null;
    const bodySize = Number(body.size);
    const size = Number.isFinite(bodySize) ? bodySize : null;
    const dispositionLower = String(contentDisposition ?? "").toLowerCase();
    const detectedBy = [
      filename ? "filename" : null,
      attachmentId ? "attachmentId" : null,
      /\battachment\b/i.test(dispositionLower) ? "content-disposition:attachment" : null,
      /\binline\b/i.test(dispositionLower) ? "content-disposition:inline" : null,
      contentId ? "content-id" : null,
      isLikelyAttachmentMime(mimeType) && (attachmentId || filename || size) ? "mimeType" : null,
    ].filter((value): value is string => Boolean(value));
    const isAttachment = detectedBy.length > 0 && (
      Boolean(filename)
      || Boolean(attachmentId)
      || /\battachment\b/i.test(dispositionLower)
      || (/\binline\b/i.test(dispositionLower) && (Boolean(contentId) || Boolean(size)))
      || (isLikelyAttachmentMime(mimeType) && Boolean(size))
    );

    if (isAttachment) {
      attachments.push({
        filename: fallbackAttachmentFilename({
          filename,
          mimeType: mimeType || null,
          contentId,
          partId,
          attachmentId,
          index: attachments.length,
        }),
        mimeType: mimeType || null,
        size,
        attachmentId,
        contentDisposition,
        contentId,
        partId,
        detectedBy,
      });
    } else if (mimeType === "text/plain") {
      text += decodeBase64Url(body.data);
    } else if (mimeType === "text/html") {
      html += decodeBase64Url(body.data);
    }

    for (const child of [
      ...(Array.isArray(node.parts) ? node.parts : []),
      ...(node.payload ? [node.payload] : []),
      ...(node.body?.payload ? [node.body.payload] : []),
    ]) visit(child);
  };

  visit(part);
  return { text: text.trim(), html: html.trim(), attachments };
}

export function summarizeGmailPayloadPart(part: any): GmailPayloadPartDiagnostic | null {
  if (!part) return null;
  const headers = headerMapFromUnknown(part.headers);
  const body = part.body ?? {};
  const bodySize = Number(body.size);
  const filename = stringFromUnknown(part.filename)
    ?? parseHeaderParameter(headerValue(headers, "content-disposition"), "filename")
    ?? parseHeaderParameter(headerValue(headers, "content-type"), "name");
  return {
    partId: part.partId ? String(part.partId) : null,
    mimeType: part.mimeType ? String(part.mimeType) : null,
    filenamePresent: Boolean(filename),
    filename,
    attachmentIdPresent: Boolean(body.attachmentId),
    bodySize: Number.isFinite(bodySize) ? bodySize : null,
    headers: {
      contentType: headerValue(headers, "content-type"),
      contentDisposition: headerValue(headers, "content-disposition"),
      contentId: headerValue(headers, "content-id"),
    },
    childParts: [
      ...(Array.isArray(part.parts) ? part.parts : []),
      ...(part.payload ? [part.payload] : []),
      ...(part.body?.payload ? [part.body.payload] : []),
    ]
      .map((child: any) => summarizeGmailPayloadPart(child))
      .filter((child: GmailPayloadPartDiagnostic | null): child is GmailPayloadPartDiagnostic => Boolean(child)),
  };
}

type InboundEmailAttachmentClassification = {
  role: "po" | "artwork" | "reference" | "other";
  poCandidate: boolean;
  artworkCandidate: boolean;
  safeToDownload: boolean;
  reason: string;
  classification: InboundAttachmentClassificationResult;
};

type InboundEmailAttachmentClassificationInput = Pick<
  InboundEmailAttachmentMetadata,
  "filename" | "mimeType"
> & Partial<Pick<InboundEmailAttachmentMetadata, "size" | "contentDisposition" | "contentId">> & {
  extractedText?: string | null;
  sourceHint?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  customerAttachmentCount?: number | null;
};

export function classifyInboundEmailAttachment(attachment: InboundEmailAttachmentClassificationInput): InboundEmailAttachmentClassification {
  const filename = String(attachment.filename ?? "").toLowerCase();
  const mimeType = String(attachment.mimeType ?? "").toLowerCase();
  const extension = getExtension(filename);
  const classification = classifyInboundAttachment({
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size ?? null,
    contentDisposition: attachment.contentDisposition ?? null,
    contentId: attachment.contentId ?? null,
    extractedText: attachment.extractedText ?? null,
    sourceHint: attachment.sourceHint ?? null,
    subject: attachment.subject ?? null,
    bodyText: attachment.bodyText ?? null,
    bodyHtml: attachment.bodyHtml ?? null,
    customerAttachmentCount: attachment.customerAttachmentCount ?? null,
  });
  const role = inboundAttachmentClassificationToRole(classification.classification);
  const textCandidate = /^text\//i.test(mimeType) || ["txt", "csv"].includes(extension);
  // Transport safety is based on file type and sender trust, never the document's
  // operational classification. Classification may change later and must not decide
  // whether provider bytes are retained.
  const safeToDownload = Boolean(
    extension
    && ALLOWED_INBOUND_ATTACHMENT_EXTENSIONS.has(extension)
    && !BLOCKED_INBOUND_ATTACHMENT_EXTENSIONS.has(extension),
  );
  const label = classification.classification === "PO"
    ? "Likely purchase order attachment"
    : classification.classification === "ARTWORK"
      ? "Likely artwork attachment"
      : classification.classification === "REFERENCE"
        ? "Likely reference attachment"
        : classification.classification === "IGNORE_INLINE"
          ? "Likely inline signature/logo image"
          : textCandidate
            ? "Text attachment supported for evidence"
            : "Attachment type is not supported for automatic download";
  return {
    role,
    poCandidate: classification.classification === "PO",
    artworkCandidate: classification.classification === "ARTWORK",
    safeToDownload,
    reason: `${label}. ${classification.reasons.join("; ")}`,
    classification,
  };
}

export function classifyInboundEmailAttachmentForMessage(
  attachment: InboundEmailAttachmentMetadata,
  message: Pick<InboundEmailProviderMessage, "subject" | "bodyText" | "bodyHtml" | "attachments">,
): ReturnType<typeof classifyInboundEmailAttachment> & { sourceHint: string | null } {
  const sourceHint = detectAttachmentSourceHint(message);
  const base = classifyInboundEmailAttachment({
    ...attachment,
    sourceHint,
    subject: message.subject,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    customerAttachmentCount: Math.max(1, message.attachments.length),
  });
  return { ...base, sourceHint };
}

function ruleClassificationToInboundClassification(
  classification: InboundAttachmentClassificationRule["classification"],
): InboundAttachmentClassification {
  if (classification === "purchase_order") return "PO";
  if (classification === "artwork") return "ARTWORK";
  if (classification === "reference") return "REFERENCE";
  if (classification === "junk_signature") return "IGNORE_INLINE";
  return "OTHER";
}

function ruleMatchTypePriority(matchType: InboundAttachmentClassificationRule["matchType"]): number {
  if (matchType === "filename_exact") return 0;
  if (matchType === "filename_starts_with") return 1;
  if (matchType === "filename_ends_with") return 2;
  if (matchType === "filename_contains") return 3;
  return 4;
}

function attachmentClassificationRuleMatches(
  rule: InboundAttachmentClassificationRule,
  attachment: InboundEmailAttachmentMetadata,
): boolean {
  const matchValue = normalizeLower(rule.matchValue);
  if (!matchValue) return false;
  const filename = normalizeLower(attachment.filename);
  const mimeType = normalizeLower(attachment.mimeType);
  if (rule.matchType === "filename_exact") return filename === matchValue;
  if (rule.matchType === "filename_starts_with") return filename.startsWith(matchValue);
  if (rule.matchType === "filename_ends_with") return filename.endsWith(matchValue);
  if (rule.matchType === "filename_contains") return filename.includes(matchValue);
  return mimeType === matchValue || mimeType.includes(matchValue);
}

function classificationFromRule(
  rule: InboundAttachmentClassificationRule,
  base: ReturnType<typeof classifyInboundEmailAttachmentForMessage>,
): ReturnType<typeof classifyInboundEmailAttachmentForMessage> {
  const classification = ruleClassificationToInboundClassification(rule.classification);
  const role = inboundAttachmentClassificationToRole(classification);
  const reason = `Customer attachment classification rule matched: ${rule.matchType.replace(/_/g, " ")} "${rule.matchValue}".`;
  const result: InboundAttachmentClassificationResult = {
    classification,
    confidence: 100,
    reasons: [reason],
    source: "automatic",
    breakdown: {
      filename: [reason],
      content: base.classification.breakdown.content,
      metadata: [
        ...base.classification.breakdown.metadata,
        `rule ${rule.id}`,
      ],
      manual: base.classification.breakdown.manual,
      scores: {
        ...base.classification.breakdown.scores,
        [classification]: 100,
      },
    },
  };
  return {
    role,
    poCandidate: classification === "PO",
    artworkCandidate: classification === "ARTWORK",
    safeToDownload: base.safeToDownload,
    reason,
    classification: result,
    sourceHint: base.sourceHint,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase();
}

function senderDomainFromEmail(email: string | null | undefined): string {
  const domain = normalizeLower(email).split("@")[1]?.trim();
  return domain || "";
}

function assertSenderDomainTrustAllowed(domain: string | null): void {
  if (domain && isPublicFreeEmailDomain(domain)) {
    throw new InboundEmailIngestionError(
      "INBOUND_PUBLIC_DOMAIN_TRUST_BLOCKED",
      `Sender domain ${domain} is a public/free email domain. Trust the exact sender email instead.`,
      400,
    );
  }
}

export function matchInboundEmailIgnoreRule(
  rule: Pick<InboundEmailIgnoreRule, "ruleType" | "ruleValue">,
  message: InboundEmailProviderMessage,
): boolean {
  const ruleValue = normalizeLower(rule.ruleValue);
  if (!ruleValue) return false;

  if (rule.ruleType === "sender_email_exact") {
    return normalizeLower(message.senderEmail) === ruleValue;
  }

  if (rule.ruleType === "sender_domain") {
    return senderDomainFromEmail(message.senderEmail) === ruleValue;
  }

  if (rule.ruleType === "subject_exact") {
    return normalizeLower(message.subject) === ruleValue;
  }

  if (rule.ruleType === "subject_contains") {
    return normalizeLower(message.subject).includes(ruleValue);
  }

  return false;
}

export class GmailInboundEmailAdapter implements InboundEmailProviderAdapter {
  private lastListDiagnostics: InboundEmailListDiagnostics | null = null;

  private buildGmailClient(mailbox: InboundEmailMailbox) {
    const authJson = (mailbox.authJson ?? {}) as Record<string, unknown>;
    const refreshToken = stringFromUnknown(authJson.refreshToken);
    const clientId = stringFromUnknown(authJson.clientId) ?? process.env.GOOGLE_CLIENT_ID ?? null;
    const clientSecret = stringFromUnknown(authJson.clientSecret) ?? process.env.GOOGLE_CLIENT_SECRET ?? null;
    const redirectUri = stringFromUnknown(authJson.redirectUri) ?? process.env.GOOGLE_REDIRECT_URI ?? "urn:ietf:wg:oauth:2.0:oob";
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("Inbound Gmail mailbox is missing OAuth credentials.");
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: "v1", auth: oauth2Client });
  }

  getLastListDiagnostics(): InboundEmailListDiagnostics | null {
    return this.lastListDiagnostics;
  }

  async listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]> {
    const settingsJson = (mailbox.settingsJson ?? {}) as Record<string, unknown>;
    const gmail = this.buildGmailClient(mailbox);
    const lookbackDays = Math.max(1, Math.min(365, Math.round(numberFromUnknown(settingsJson.lookbackDays, 14))));
    const configuredQuery = Object.prototype.hasOwnProperty.call(settingsJson, "gmailQuery")
      ? stringFromUnknown(settingsJson.gmailQuery)
      : stringFromUnknown(settingsJson.query);
    const query = configuredQuery ?? `newer_than:${lookbackDays}d`;
    const labelIds = Array.isArray(settingsJson.labelIds)
      ? settingsJson.labelIds.map((value) => String(value)).filter(Boolean)
      : undefined;
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
    const pageSize = Math.max(1, Math.min(25, safeLimit));
    const messageIds: string[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const listed = await gmail.users.messages.list({
        userId: "me",
        maxResults: Math.min(pageSize, safeLimit - messageIds.length),
        q: query,
        labelIds,
        pageToken,
      });
      pageCount += 1;
      for (const summary of listed.data.messages ?? []) {
        if (!summary.id || messageIds.includes(summary.id)) continue;
        messageIds.push(summary.id);
        if (messageIds.length >= safeLimit) break;
      }
      pageToken = listed.data.nextPageToken || undefined;
    } while (pageToken && messageIds.length < safeLimit);

    const results: InboundEmailProviderMessage[] = [];

    for (const messageId of messageIds) {
      const detail = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      results.push(this.toProviderMessage(detail.data));
    }

    this.lastListDiagnostics = {
      provider: "gmail",
      query,
      labelIds: labelIds && labelIds.length > 0 ? labelIds : null,
      maxResults: safeLimit,
      pageCount,
      totalMessageIdsReturned: messageIds.length,
      listedMessages: results.map((message) => ({
        providerMessageId: message.messageId,
        threadId: message.threadId,
        subject: message.subject,
        displaySubject: displaySubjectForMessage(message),
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
      })),
    };

    return results;
  }

  async getMessagePayloadDiagnostics(
    mailbox: InboundEmailMailbox,
    messageId: string,
  ): Promise<{ messageId: string; payloadTree: GmailPayloadPartDiagnostic | null; extractedAttachmentCount: number; extractedAttachments: InboundEmailAttachmentMetadata[] }> {
    const gmail = this.buildGmailClient(mailbox);
    const detail = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const extracted = extractGmailBodyAndAttachments(detail.data.payload);
    return {
      messageId,
      payloadTree: summarizeGmailPayloadPart(detail.data.payload),
      extractedAttachmentCount: extracted.attachments.length,
      extractedAttachments: extracted.attachments,
    };
  }

  async getMessage(mailbox: InboundEmailMailbox, messageId: string): Promise<InboundEmailProviderMessage> {
    const gmail = this.buildGmailClient(mailbox);
    const detail = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    return this.toProviderMessage(detail.data);
  }

  async getThreadMessages(mailbox: InboundEmailMailbox, threadId: string): Promise<InboundEmailProviderMessage[]> {
    const gmail = this.buildGmailClient(mailbox);
    const detail = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    return (detail.data.messages ?? [])
      .filter((message) => message?.id)
      .map((message) => this.toProviderMessage(message));
  }

  async downloadAttachment(
    mailbox: InboundEmailMailbox,
    message: InboundEmailProviderMessage,
    attachment: InboundEmailAttachmentMetadata,
  ): Promise<InboundEmailAttachmentContent> {
    if (!attachment.attachmentId) {
      throw new Error("Attachment is missing a Gmail attachment id.");
    }
    const gmail = this.buildGmailClient(mailbox);
    const response = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: message.messageId,
      id: attachment.attachmentId,
    });
    const data = response.data.data;
    if (!data) throw new Error("Gmail attachment response did not include data.");
    const buffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return {
      buffer,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: buffer.length,
    };
  }

  private toProviderMessage(message: any): InboundEmailProviderMessage {
    const headers = new Map<string, string>();
    for (const header of message.payload?.headers ?? []) {
      headers.set(String(header.name ?? "").toLowerCase(), String(header.value ?? ""));
    }
    const from = parseAddress(headers.get("from"));
    const subject = headers.get("subject") || null;
    const dateHeader = headers.get("date");
    const receivedAt = dateHeader && !Number.isNaN(new Date(dateHeader).getTime())
      ? new Date(dateHeader)
      : message.internalDate
        ? new Date(Number(message.internalDate))
        : null;
    const body = this.extractBody(message.payload);
    return {
      provider: "gmail",
      messageId: String(message.id),
      threadId: message.threadId ? String(message.threadId) : null,
      senderName: from.name,
      senderEmail: from.email,
      to: headers.get("to") ? [String(headers.get("to"))] : [],
      cc: headers.get("cc") ? [String(headers.get("cc"))] : [],
      subject,
      receivedAt,
      bodyText: body.text || null,
      bodyHtml: body.html || null,
      attachments: body.attachments,
    };
  }

  private extractBody(part: any): { text: string; html: string; attachments: InboundEmailAttachmentMetadata[] } {
    return extractGmailBodyAndAttachments(part);
  }
}

export class InboundEmailIngestionService {
  constructor(
    private readonly dbInstance = db,
    private readonly adapterByProvider: Record<string, InboundEmailProviderAdapter> = { gmail: new GmailInboundEmailAdapter() },
    private readonly inboundRepository: InboundOrdersRepository = inboundOrdersRepository,
    private readonly storageService: StorageApplicationService = storageApplicationService,
  ) {}

  async pullLatestEmails(args: {
    organizationId: string;
    actorUserId: string;
    limit?: number;
  }): Promise<InboundEmailPullResult> {
    const mailboxes = await this.dbInstance
      .select()
      .from(inboundEmailMailboxes)
      .where(and(eq(inboundEmailMailboxes.organizationId, args.organizationId), eq(inboundEmailMailboxes.enabled, true)));

    if (mailboxes.length === 0) {
      throw new InboundEmailIngestionError(
        "INBOUND_EMAIL_MAILBOX_NOT_CONFIGURED",
        "No enabled inbound mailbox is configured for this organization.",
        409,
      );
    }

    const summary = { created: 0, skippedDuplicates: 0, ignored: 0, failed: 0 };
    const createdRecordIds: string[] = [];
    const mailboxResults: InboundEmailPullResult["mailboxResults"] = [];
    const requestedLimit = Math.max(1, Math.min(100, Math.round(Number(args.limit ?? 50))));

    for (const mailbox of mailboxes) {
      const mailboxLimit = Math.max(1, Math.min(100, Math.round(numberFromUnknown((mailbox.settingsJson as any)?.maxMessages, requestedLimit))));
      const result = {
        mailboxId: mailbox.id,
        mailboxName: mailbox.name,
        provider: mailbox.provider,
        created: 0,
        skippedDuplicates: 0,
        ignored: 0,
        failed: 0,
        error: null as string | null,
      };
      const processedMessages: InboundEmailMessageProcessingDiagnostic[] = [];

      try {
        const adapter = this.adapterByProvider[mailbox.provider];
        if (!adapter) throw new Error(`Unsupported inbound email provider: ${mailbox.provider}`);
        const source = await this.ensureSourceForMailbox(mailbox);
        const messages = await adapter.listRecentMessages(mailbox, mailboxLimit);
        const listDiagnostics = adapter.getLastListDiagnostics?.() ?? null;
        for (const message of messages) {
          try {
            const outcome = await this.processMessage(args.organizationId, args.actorUserId, mailbox, source, message, adapter);
            result[outcome.status] += 1;
            summary[outcome.status] += 1;
            if (outcome.status === "created" && outcome.recordId) {
              createdRecordIds.push(outcome.recordId);
            }
            processedMessages.push(processingDiagnosticForMessage(message, outcome));
          } catch (error) {
            result.failed += 1;
            summary.failed += 1;
            processedMessages.push(processingDiagnosticForMessage(message, {
              processingOutcome: "failed",
              reason: error instanceof Error ? error.message : "Failed to process Gmail message.",
              recordId: null,
            }));
            console.error("[Inbound Email Pull] Failed to process message", {
              organizationId: args.organizationId,
              mailboxId: mailbox.id,
              messageId: message.messageId,
              error,
            });
          }
        }
        await this.markMailboxPull(mailbox, "success", null, {
          provider: mailbox.provider,
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.emailAddress,
          requestedLimit: mailboxLimit,
          gmailList: listDiagnostics,
          processedMessages,
          skippedMessages: processedMessages.filter((message) => (
            message.processingOutcome === "duplicate"
            || message.processingOutcome === "classification_skipped"
            || message.processingOutcome === "missing_required_data"
            || message.processingOutcome === "internal_sender_skipped"
            || message.processingOutcome === "other"
          )),
          ignoredMessages: processedMessages.filter((message) => message.processingOutcome === "ignored_rule" || message.processingOutcome === "internal_sender_skipped"),
          failedMessages: processedMessages.filter((message) => message.processingOutcome === "failed"),
          result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to pull inbound mailbox.";
        result.failed += 1;
        summary.failed += 1;
        result.error = message;
        await this.markMailboxPull(mailbox, "failed", message, {
          provider: mailbox.provider,
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.emailAddress,
          requestedLimit: mailboxLimit,
          gmailList: this.adapterByProvider[mailbox.provider]?.getLastListDiagnostics?.() ?? null,
          processedMessages,
          skippedMessages: processedMessages.filter((message) => (
            message.processingOutcome === "duplicate"
            || message.processingOutcome === "classification_skipped"
            || message.processingOutcome === "missing_required_data"
            || message.processingOutcome === "internal_sender_skipped"
            || message.processingOutcome === "other"
          )),
          ignoredMessages: processedMessages.filter((message) => message.processingOutcome === "ignored_rule" || message.processingOutcome === "internal_sender_skipped"),
          failedMessages: [
            ...processedMessages.filter((message) => message.processingOutcome === "failed"),
            {
              providerMessageId: null,
              threadId: null,
              senderName: null,
              senderEmail: null,
              senderDomain: null,
              subject: null,
              displaySubject: "(mailbox pull failed)",
              receivedAt: null,
              processingOutcome: "failed",
              reason: message,
              inboundRecordId: null,
            },
          ],
          result,
          error: message,
        });
        console.error("[Inbound Email Pull] Mailbox pull failed", {
          organizationId: args.organizationId,
          mailboxId: mailbox.id,
          error,
        });
      }

      mailboxResults.push(result);
    }

    return { summary, createdRecordIds, mailboxResults };
  }

  async getGmailPayloadDiagnosticsForSubject(args: {
    organizationId: string;
    subject: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const subject = args.subject.trim();
    if (!subject) return [];
    const pattern = `%${subject.replace(/[%_]/g, "\\$&")}%`;
    const limit = Math.max(1, Math.min(5, Math.round(Number(args.limit ?? 3))));
    const rows = await this.dbInstance
      .select({
        inboundRecordId: inboundOrderRecords.id,
        sourceMessageId: inboundOrderRecords.sourceMessageId,
        subject: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->>'subject', ${inboundOrderRecords.normalizedPayloadJson}->>'subject', ${inboundOrderRecords.extractedOrderJson}->>'subject', ${inboundOrderRecords.externalReference})`,
        mailboxId: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'mailbox'->>'id', ${inboundOrderRecords.normalizedPayloadJson}->'source'->>'mailboxId')`,
        mailboxEmail: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'mailbox'->>'emailAddress', ${inboundOrderRecords.normalizedPayloadJson}->'source'->>'mailboxEmail')`,
      })
      .from(inboundOrderRecords)
      .where(and(
        eq(inboundOrderRecords.organizationId, args.organizationId),
        eq(inboundOrderRecords.sourceType, "email"),
        sql`(
          ${inboundOrderRecords.externalReference} ilike ${pattern}
          or ${inboundOrderRecords.sourceMessageId} ilike ${pattern}
          or ${inboundOrderRecords.rawPayloadJson}::text ilike ${pattern}
          or ${inboundOrderRecords.normalizedPayloadJson}::text ilike ${pattern}
          or ${inboundOrderRecords.extractedOrderJson}::text ilike ${pattern}
        )`,
      ))
      .limit(limit);
    if (rows.length === 0) return [];

    const mailboxes = await this.dbInstance
      .select()
      .from(inboundEmailMailboxes)
      .where(eq(inboundEmailMailboxes.organizationId, args.organizationId));

    const diagnostics: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const sourceMessageId = String(row.sourceMessageId ?? "").trim();
      if (!sourceMessageId) {
        diagnostics.push({
          inboundRecordId: row.inboundRecordId,
          sourceMessageId: null,
          subject: row.subject,
          diagnosticError: "Inbound record has no sourceMessageId.",
        });
        continue;
      }
      const mailbox = mailboxes.find((candidate) => (
        (row.mailboxId && candidate.id === row.mailboxId)
        || (row.mailboxEmail && candidate.emailAddress.toLowerCase() === row.mailboxEmail.toLowerCase())
      )) ?? mailboxes.find((candidate) => candidate.provider === "gmail" && candidate.enabled) ?? null;
      if (!mailbox) {
        diagnostics.push({
          inboundRecordId: row.inboundRecordId,
          sourceMessageId,
          subject: row.subject,
          diagnosticError: "No inbound Gmail mailbox was found for this record.",
        });
        continue;
      }
      const adapter = this.adapterByProvider[mailbox.provider];
      if (!adapter?.getMessagePayloadDiagnostics) {
        diagnostics.push({
          inboundRecordId: row.inboundRecordId,
          sourceMessageId,
          subject: row.subject,
          mailboxId: mailbox.id,
          diagnosticError: "Inbound provider does not support safe payload diagnostics.",
        });
        continue;
      }
      try {
        const payloadDiagnostics = await adapter.getMessagePayloadDiagnostics(mailbox, sourceMessageId);
        diagnostics.push({
          inboundRecordId: row.inboundRecordId,
          sourceMessageId,
          subject: row.subject,
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.emailAddress,
          ...payloadDiagnostics,
        });
      } catch (error) {
        diagnostics.push({
          inboundRecordId: row.inboundRecordId,
          sourceMessageId,
          subject: row.subject,
          mailboxId: mailbox.id,
          diagnosticError: error instanceof Error ? error.message : "Failed to fetch Gmail payload diagnostics.",
        });
      }
    }
    return diagnostics;
  }

  async approveAttachmentTrustAction(args: {
    organizationId: string;
    actorUserId: string;
    inboundRecordId: string;
    fileId: string;
    action: "trust_sender_and_download" | "trust_domain_and_download" | "download_once" | "keep_blocked";
    note?: string | null;
  }): Promise<InboundOrderFile> {
    const record = await this.inboundRepository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundEmailIngestionError("INBOUND_RECORD_NOT_FOUND", "Inbound order record not found.", 404);
    const file = await this.inboundRepository.getFile(args.organizationId, args.inboundRecordId, args.fileId);
    if (!file) throw new InboundEmailIngestionError("INBOUND_ATTACHMENT_NOT_FOUND", "Inbound attachment not found.", 404);

    const message = this.providerMessageFromRecord(record);
    const senderEmail = senderEmailFromMessage(message);
    const senderDomain = senderDomainFromMessage(message);
    if (args.action === "keep_blocked") {
      const updated = await this.markAttachmentMetadataState({
        organizationId: args.organizationId,
        record,
        file,
        attachmentState: "blocked_file_type",
        status: "quarantined",
        reason: args.note || "Staff kept attachment blocked.",
      });
      return updated;
    }

    // Retrying an attachment that is already stored must not create duplicate
    // canonical file or storage records.
    if (file.fileRecordId) return file;

    if (args.action === "trust_sender_and_download") {
      if (!senderEmail) throw new InboundEmailIngestionError("INBOUND_SENDER_EMAIL_MISSING", "Cannot trust sender because the inbound record has no sender email.", 400);
      await this.inboundRepository.createEmailTrustRule({
        organizationId: args.organizationId,
        ruleType: "sender_email_exact",
        ruleValue: senderEmail,
        notes: args.note || "Trusted from inbound attachment review.",
        createdByUserId: args.actorUserId,
        enabled: true,
      });
    }

    if (args.action === "trust_domain_and_download") {
      if (!senderDomain) throw new InboundEmailIngestionError("INBOUND_SENDER_DOMAIN_MISSING", "Cannot trust domain because the inbound record has no sender domain.", 400);
      assertSenderDomainTrustAllowed(senderDomain);
      await this.inboundRepository.createEmailTrustRule({
        organizationId: args.organizationId,
        ruleType: "sender_domain",
        ruleValue: senderDomain,
        notes: args.note || "Trusted from inbound attachment review.",
        createdByUserId: args.actorUserId,
        enabled: true,
      });
    }

    const mailbox = await this.resolveMailboxForRecord(args.organizationId, record);
    const adapter = this.adapterByProvider[mailbox.provider];
    if (!adapter) throw new InboundEmailIngestionError("INBOUND_EMAIL_PROVIDER_UNSUPPORTED", "Inbound email provider is unsupported.", 409);
    const trustDecision = args.action === "download_once"
      ? {
          trusted: true,
          senderEmail,
          senderDomain,
          trustSource: "none" as const,
          ruleId: null,
          reason: "Staff approved one-time attachment download.",
        }
      : await this.resolveSenderTrust(args.organizationId, message);
    const attachment = this.attachmentMetadataFromFile(file);
    const providerMessageId = attachmentMetadataProviderMessageId(file, message.messageId);
    const attachmentMessage = { ...message, messageId: providerMessageId };
    const classification = classifyInboundEmailAttachmentForMessage(attachment, attachmentMessage);
    const safetyDecision = this.evaluateAttachmentSafety(attachment, classification, trustDecision, {
      bypassTrust: args.action === "download_once",
    });
    const baseMetadata = {
      ...(file.metadataJson ?? {}),
      senderTrustStatus: trustDecision.trusted ? "trusted" : "untrusted",
      senderTrustSource: trustDecision.trustSource,
      senderTrustRuleId: trustDecision.ruleId,
      senderTrustReason: trustDecision.reason,
      attachmentState: safetyDecision.attachmentState,
      attachmentSafetyReason: safetyDecision.reason,
      attachmentExtension: safetyDecision.extension,
      blockedFileType: safetyDecision.blocked,
      allowedFileType: safetyDecision.allowedForAutoDownload,
      downloadAttemptAllowed: safetyDecision.downloadAllowed,
      staffTrustAction: args.action,
    };
    if (!safetyDecision.downloadAllowed || !adapter.downloadAttachment || !attachment.attachmentId) {
      return this.markAttachmentMetadataState({
        organizationId: args.organizationId,
        record,
        file,
        attachmentState: safetyDecision.attachmentState,
        status: safetyDecision.blocked ? "quarantined" : "uploaded",
        reason: !safetyDecision.downloadAllowed
          ? safetyDecision.reason
          : !adapter.downloadAttachment
            ? "Attachment metadata captured; provider download is not available."
            : "Attachment metadata captured; Gmail attachment id is missing.",
        metadataPatch: baseMetadata,
      });
    }

    const downloaded = await adapter.downloadAttachment(mailbox, attachmentMessage, attachment);
    const filename = normalizeAttachmentFileName(file.sourceFilename);
    const storedStatus = safetyDecision.zipFile ? "quarantined" : "available";
    const storedAttachmentState = safetyDecision.zipFile ? "scan_pending" : "downloaded";
    const storageResult = await this.storageService.finalizeUpload({
      organizationId: args.organizationId,
      createdByUserId: args.actorUserId,
      resource: {
        organizationId: args.organizationId,
        resourceType: "inbound_order",
        resourceId: record.id,
      },
      source: {
        kind: "buffer",
        buffer: downloaded.buffer,
        originalFilename: filename,
        mimeType: downloaded.mimeType ?? attachment.mimeType ?? "application/octet-stream",
      },
      persistLink: async (tx, stored) => this.persistStoredAttachment({
        tx,
        organizationId: args.organizationId,
        record,
        existingFile: file,
        values: {
          inboundLineItemId: file.inboundLineItemId,
          fileRecordId: stored.fileRecord.id,
          sourceFilename: filename,
          role: file.role,
          mimeType: downloaded.mimeType ?? attachment.mimeType ?? file.mimeType,
          sizeBytes: downloaded.sizeBytes,
          checksum: stored.fileRecord.checksum ?? null,
          status: storedStatus,
          providerAttachmentId: attachment.attachmentId ?? file.providerAttachmentId,
          providerMessageId,
          contentDisposition: file.contentDisposition,
          metadataJson: {
            ...baseMetadata,
            attachmentState: storedAttachmentState,
            storageProvider: stored.storedObject.storageTarget,
          },
          reviewNotes: safetyDecision.zipFile
            ? "ZIP attachment stored from trusted sender. Scanner/manual review is required before use."
            : args.note || "Attachment downloaded after staff trust approval.",
          createdQuoteAttachmentId: file.createdQuoteAttachmentId,
          createdOrderAttachmentId: file.createdOrderAttachmentId,
        },
      }),
    });

    await this.inboundRepository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "email.attachment_trust_action",
      fromStatus: null,
      toStatus: null,
      message: `Inbound attachment ${filename} processed by staff trust action ${args.action}.`,
      metadataJson: {
        fileId: storageResult.linkedRecord.id,
        fileRecordId: storageResult.fileRecord.id,
        action: args.action,
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
      },
    });
    return storageResult.linkedRecord;
  }

  async approveRecordTrustAction(args: {
    organizationId: string;
    actorUserId: string;
    inboundRecordId: string;
    action: "trust_sender" | "trust_domain" | "trust_sender_and_download" | "trust_domain_and_download";
    note?: string | null;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<{
    trustRuleType: "sender_email_exact" | "sender_domain";
    trustRuleValue: string;
    attempted: number;
    downloaded: number;
    metadataOnly: number;
    blocked: number;
    failed: Array<{ fileId: string; message: string }>;
  }> {
    const record = await this.inboundRepository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundEmailIngestionError("INBOUND_RECORD_NOT_FOUND", "Inbound order record not found.", 404);

    const message = this.providerMessageFromRecord(record);
    const senderEmail = senderEmailFromMessage(message);
    const senderDomain = senderDomainFromMessage(message);
    const trustRuleType = args.action === "trust_sender" || args.action === "trust_sender_and_download"
      ? "sender_email_exact"
      : "sender_domain";
    const trustRuleValue = trustRuleType === "sender_email_exact" ? senderEmail : senderDomain;
    if (!trustRuleValue) {
      throw new InboundEmailIngestionError(
        trustRuleType === "sender_email_exact" ? "INBOUND_SENDER_EMAIL_MISSING" : "INBOUND_SENDER_DOMAIN_MISSING",
        trustRuleType === "sender_email_exact"
          ? "Cannot trust sender because the inbound record has no sender email."
          : "Cannot trust domain because the inbound record has no sender domain.",
        400,
      );
    }
    if (trustRuleType === "sender_domain") {
      assertSenderDomainTrustAllowed(trustRuleValue);
    }

    const conflictingIgnoreRule = (await this.inboundRepository.listEmailIgnoreRules(args.organizationId))
      .find((rule) => rule.enabled && inboundEmailRuleTypesConflict(rule.ruleType, rule.ruleValue, trustRuleType, trustRuleValue));
    if (conflictingIgnoreRule) {
      if (args.resolveConflict === "disable_conflicting_rule") {
        await this.inboundRepository.updateEmailIgnoreRule({
          organizationId: args.organizationId,
          id: conflictingIgnoreRule.id,
          enabled: false,
        });
      } else {
        throw new InboundEmailIngestionError(
          "INBOUND_RULE_CONFLICT",
          "This sender/domain is currently ignored. Trusting it will disable the ignore rule.",
          409,
          {
            conflict: {
              conflictType: "trust_conflicted_with_ignore",
              conflictingRuleId: conflictingIgnoreRule.id,
              conflictingRuleType: conflictingIgnoreRule.ruleType,
              conflictingValue: conflictingIgnoreRule.ruleValue,
              currentRuleLocation: "Inbound Ignore Rules",
              recommendedResolution: "Trust and disable ignore rule",
            },
          },
        );
      }
    }

    await this.inboundRepository.createEmailTrustRule({
      organizationId: args.organizationId,
      ruleType: trustRuleType,
      ruleValue: trustRuleValue,
      notes: args.note || "Trusted from inbound queue review.",
      createdByUserId: args.actorUserId,
      enabled: true,
    });

    const shouldDownload = args.action === "trust_sender_and_download" || args.action === "trust_domain_and_download";
    const result: {
      trustRuleType: "sender_email_exact" | "sender_domain";
      trustRuleValue: string;
      attempted: number;
      downloaded: number;
      metadataOnly: number;
      blocked: number;
      failed: Array<{ fileId: string; message: string }>;
    } = {
      trustRuleType,
      trustRuleValue,
      attempted: 0,
      downloaded: 0,
      metadataOnly: 0,
      blocked: 0,
      failed: [] as Array<{ fileId: string; message: string }>,
    };

    if (shouldDownload) {
      const files = await this.inboundRepository.listFiles(args.organizationId, args.inboundRecordId);
      const pendingFiles = files.filter((file) => {
        const metadata = file.metadataJson && typeof file.metadataJson === "object" && !Array.isArray(file.metadataJson)
          ? file.metadataJson as Record<string, unknown>
          : {};
        const attachmentState = typeof metadata.attachmentState === "string" ? metadata.attachmentState : null;
        return !file.fileRecordId
          || attachmentState === "pending_trust"
          || attachmentState === "metadata_only"
          || attachmentState === "download_failed"
          || attachmentState === "blocked_file_type";
      });

      for (const file of pendingFiles) {
        try {
          result.attempted += 1;
          const updated = await this.approveAttachmentTrustAction({
            organizationId: args.organizationId,
            actorUserId: args.actorUserId,
            inboundRecordId: args.inboundRecordId,
            fileId: file.id,
            action: args.action === "trust_sender_and_download" ? "trust_sender_and_download" : "trust_domain_and_download",
            note: args.note ?? null,
          });
          const metadata = updated.metadataJson && typeof updated.metadataJson === "object" && !Array.isArray(updated.metadataJson)
            ? updated.metadataJson as Record<string, unknown>
            : {};
          const attachmentState = typeof metadata.attachmentState === "string" ? metadata.attachmentState : null;
          if (updated.fileRecordId) result.downloaded += 1;
          else result.metadataOnly += 1;
          if (attachmentState === "blocked_file_type" || updated.status === "quarantined") result.blocked += 1;
        } catch (error) {
          result.failed.push({
            fileId: file.id,
            message: error instanceof Error ? error.message : "Attachment trust action failed.",
          });
        }
      }
    }

    await this.inboundRepository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "email.record_trust_action",
      fromStatus: null,
      toStatus: null,
      message: `Inbound sender trust action ${args.action} applied for ${trustRuleValue}.`,
      metadataJson: {
        action: args.action,
        trustRuleType,
        trustRuleValue,
        attachmentProcessing: {
          attempted: result.attempted,
          downloaded: result.downloaded,
          metadataOnly: result.metadataOnly,
          blocked: result.blocked,
          failed: result.failed.length,
        },
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
      },
    });

    return result;
  }

  async manuallyReprocessInboundEmailRecord(args: {
    organizationId: string;
    actorUserId: string;
    inboundRecordId: string;
    action: InboundEmailManualReprocessAction;
  }): Promise<InboundEmailManualReprocessResult> {
    const record = await this.inboundRepository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundEmailIngestionError("INBOUND_RECORD_NOT_FOUND", "Inbound order record not found.", 404);
    if (record.sourceType !== "email") {
      throw new InboundEmailIngestionError("INBOUND_RECORD_NOT_EMAIL", "Only email-source inbound records can be reprocessed.", 400);
    }
    if (record.createdOrderId || record.createdQuoteId) {
      throw new InboundEmailIngestionError("INBOUND_RECORD_ALREADY_CONVERTED", "Converted inbound records cannot be manually reprocessed from the queue.", 409);
    }

    await this.inboundRepository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "email.manual_reprocess_started",
      fromStatus: null,
      toStatus: null,
      message: `Manual inbound email action started: ${args.action}.`,
      metadataJson: {
        action: args.action,
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
        createsProductionJobs: false,
        createsInvoices: false,
        createsFulfillment: false,
        createsPayments: false,
      },
    });

    try {
      const mailbox = await this.resolveMailboxForRecord(args.organizationId, record);
      const adapter = this.adapterByProvider[mailbox.provider];
      if (!adapter) throw new InboundEmailIngestionError("INBOUND_EMAIL_PROVIDER_UNSUPPORTED", "Inbound email provider is unsupported.", 409);

      const baseMessage = this.providerMessageFromRecord(record);
      const storedCandidates = this.attachmentCandidatesForIngestion(baseMessage, record)
        .map((attachment) => ({
          ...attachment,
          providerMessageId: attachment.providerMessageId ?? baseMessage.messageId,
        }));
      const messages = await this.resolveMessagesForManualReprocess({
        mailbox,
        adapter,
        record,
        baseMessage,
        storedCandidates,
        action: args.action,
      });
      const threadId = messages.find((message) => message.threadId)?.threadId ?? baseMessage.threadId ?? null;
      const sortedMessages = messages.slice().sort((a, b) => (
        (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0)
      ));
      const dedupedMessages = dedupeThreadAttachmentMessages(sortedMessages);

      let workingRecord = record;
      if (args.action === "reprocess_email" || messages.some((message) => message.messageId !== baseMessage.messageId || message.attachments.length > 0)) {
        workingRecord = await this.refreshRecordSourceEvidenceFromMessages({
          organizationId: args.organizationId,
          actorUserId: args.actorUserId,
          record,
          action: args.action,
          messages: dedupedMessages,
          threadId,
        }) ?? record;
      }

      const diagnosticsByMessage: AttachmentIngestionDiagnostics[] = [];
      for (const message of dedupedMessages) {
        const cleanRecord = this.recordWithoutStoredAttachmentCandidates(workingRecord);
        const diagnostics = await this.ingestAttachmentsWithCallAudit({
          organizationId: args.organizationId,
          actorUserId: args.actorUserId,
          mailbox,
          message: {
            ...message,
            attachments: message.attachments.map((attachment) => ({
              ...attachment,
              providerMessageId: attachment.providerMessageId ?? message.messageId,
            })),
          },
          record: cleanRecord,
          adapter,
          skippedReason: `manual_${args.action}`,
        });
        diagnosticsByMessage.push(diagnostics);
      }

      const result = this.summarizeManualReprocessResult({
        action: args.action,
        record,
        messages: dedupedMessages,
        diagnosticsByMessage,
        threadId,
      });

      await this.inboundRepository.createEvent({
        organizationId: args.organizationId,
        inboundRecordId: record.id,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "email.manual_reprocess_completed",
        fromStatus: null,
        toStatus: null,
        message: `Manual inbound email action completed: ${args.action}.`,
        metadataJson: {
          ...result,
          createsQuote: false,
          createsOrder: false,
          createsArtwork: false,
          createsProofs: false,
          createsProductionJobs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });

      return result;
    } catch (error) {
      await this.inboundRepository.createEvent({
        organizationId: args.organizationId,
        inboundRecordId: record.id,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "email.manual_reprocess_failed",
        fromStatus: null,
        toStatus: null,
        message: error instanceof Error ? error.message : `Manual inbound email action failed: ${args.action}.`,
        metadataJson: {
          action: args.action,
          errorMessage: error instanceof Error ? error.message : "Manual inbound email reprocess failed.",
          createsQuote: false,
          createsOrder: false,
          createsArtwork: false,
          createsProofs: false,
          createsProductionJobs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });
      throw error;
    }
  }

  private async resolveMessagesForManualReprocess(args: {
    mailbox: InboundEmailMailbox;
    adapter: InboundEmailProviderAdapter;
    record: InboundOrderRecord;
    baseMessage: InboundEmailProviderMessage;
    storedCandidates: InboundEmailAttachmentMetadata[];
    action: InboundEmailEvidenceRefreshAction;
  }): Promise<InboundEmailProviderMessage[]> {
    const threadId = args.baseMessage.threadId;
    const messageId = args.baseMessage.messageId || args.record.sourceMessageId || args.record.sourceRecordId || "";
    let messages: InboundEmailProviderMessage[] = [];

    if (threadId && args.adapter.getThreadMessages) {
      messages = await args.adapter.getThreadMessages(args.mailbox, threadId);
    } else if (messageId && args.adapter.getMessage && args.action !== "rerun_trust_attachment_download") {
      messages = [await args.adapter.getMessage(args.mailbox, messageId)];
    } else if (messageId && args.adapter.getMessage && args.storedCandidates.length === 0) {
      messages = [await args.adapter.getMessage(args.mailbox, messageId)];
    }

    if (messages.length === 0 && args.storedCandidates.length > 0) {
      messages = [{
        ...args.baseMessage,
        messageId,
        attachments: args.storedCandidates,
      }];
    }

    if (messages.length === 0) {
      throw new InboundEmailIngestionError(
        "INBOUND_EMAIL_PROVIDER_MESSAGE_ID_MISSING",
        "Cannot reprocess this inbound email because the original Gmail message id is missing.",
        400,
      );
    }

    const recovered = await Promise.all(messages.map((message) => (
      this.messageWithRecoveredProviderAttachments(args.mailbox, message, args.adapter)
    )));
    const byMessageId = new Map<string, InboundEmailProviderMessage>();
    for (const message of recovered) {
      if (!message.messageId) continue;
      byMessageId.set(message.messageId, {
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
          providerMessageId: attachment.providerMessageId ?? message.messageId,
        })),
      });
    }
    return Array.from(byMessageId.values());
  }

  private recordWithoutStoredAttachmentCandidates(record: InboundOrderRecord): InboundOrderRecord {
    const raw = isRecord(record.rawPayloadJson) ? record.rawPayloadJson : {};
    const normalized = isRecord(record.normalizedPayloadJson) ? record.normalizedPayloadJson : {};
    const extractedOrder = isRecord(record.extractedOrderJson) ? record.extractedOrderJson : {};
    return {
      ...record,
      rawPayloadJson: { ...raw, attachments: [] },
      normalizedPayloadJson: { ...normalized, attachments: [] },
      extractedOrderJson: { ...extractedOrder, attachments: [] },
    };
  }

  private async refreshRecordSourceEvidenceFromMessages(args: {
    organizationId: string;
    actorUserId: string;
    record: InboundOrderRecord;
    action: InboundEmailEvidenceRefreshAction;
    messages: InboundEmailProviderMessage[];
    threadId: string | null;
  }): Promise<InboundOrderRecord | null> {
    const messages = dedupeThreadAttachmentMessages(args.messages);
    const raw = isRecord(args.record.rawPayloadJson) ? args.record.rawPayloadJson : {};
    const normalized = isRecord(args.record.normalizedPayloadJson) ? args.record.normalizedPayloadJson : {};
    const extractedOrder = isRecord(args.record.extractedOrderJson) ? args.record.extractedOrderJson : {};
    const latestMessage = messages.reduce<InboundEmailProviderMessage | null>((latest, message) => {
      if (!latest) return message;
      return (message.receivedAt?.getTime() ?? 0) > (latest.receivedAt?.getTime() ?? 0) ? message : latest;
    }, null);
    const firstMessage = messages.reduce<InboundEmailProviderMessage | null>((first, message) => {
      if (!first) return message;
      return (message.receivedAt?.getTime() ?? 0) < (first.receivedAt?.getTime() ?? 0) ? message : first;
    }, null);
    const sourceMessageId = args.record.sourceMessageId ?? args.record.sourceRecordId ?? null;
    const primaryMessage = messages.find((message) => message.messageId === sourceMessageId) ?? latestMessage ?? messages[0] ?? null;
    const combinedBodyText = messages
      .map((message) => message.bodyText)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n--- Thread message ---\n\n");
    const combinedBodyHtml = messages
      .map((message) => message.bodyHtml)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n<hr />\n");
    const combinedAttachments = messages.flatMap((message) => (
      message.attachments.map((attachment) => ({
        ...attachment,
        providerMessageId: attachment.providerMessageId ?? message.messageId,
        messageId: message.messageId,
        messageSubject: message.subject,
        messageDisplaySubject: displaySubjectForMessage(message),
        messageSenderEmail: message.senderEmail,
        messageReceivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
      }))
    ));
    const threadSummary = {
      id: args.threadId,
      messageCount: messages.length,
      firstMessageId: firstMessage?.messageId ?? null,
      latestMessageId: latestMessage?.messageId ?? null,
      firstMessageAt: firstMessage?.receivedAt ? firstMessage.receivedAt.toISOString() : null,
      latestActivityAt: latestMessage?.receivedAt ? latestMessage.receivedAt.toISOString() : null,
      latestSenderName: latestMessage?.senderName ?? null,
      latestSenderEmail: latestMessage?.senderEmail ?? null,
      latestSubject: latestMessage?.subject ?? null,
      latestDisplaySubject: latestMessage ? displaySubjectForMessage(latestMessage) : null,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        threadId: message.threadId,
        subject: message.subject,
        displaySubject: displaySubjectForMessage(message),
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        to: message.to ?? [],
        cc: message.cc ?? [],
        receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
        bodyText: message.bodyText ?? null,
        bodyHtml: message.bodyHtml ?? null,
        attachmentCount: message.attachments.length,
        attachmentFilenames: message.attachments.map((attachment) => attachment.filename).filter(Boolean),
      })),
    };
    const senderTrustDecision = primaryMessage
      ? await this.resolveClassificationTrust(args.organizationId, args.messages)
      : null;
    const classification = primaryMessage
      ? classifyInboundEmailForReview({
          ...primaryMessage,
          bodyText: combinedBodyText || primaryMessage.bodyText,
          bodyHtml: combinedBodyHtml || primaryMessage.bodyHtml,
          attachments: combinedAttachments,
        }, {
          senderTrusted: senderTrustDecision?.trusted ?? false,
          trustSource: senderTrustDecision?.trustSource ?? null,
          trustReason: senderTrustDecision?.reason ?? null,
        })
      : null;

    const patch = {
      rawPayloadJson: {
        ...raw,
        provider: primaryMessage?.provider ?? raw.provider ?? "gmail",
        messageId: primaryMessage?.messageId ?? raw.messageId ?? args.record.sourceMessageId,
        threadId: args.threadId ?? raw.threadId ?? null,
        sender: {
          ...(isRecord(raw.sender) ? raw.sender : {}),
          name: primaryMessage?.senderName ?? getPathValue(raw, "sender.name") ?? null,
          email: primaryMessage?.senderEmail ?? getPathValue(raw, "sender.email") ?? null,
        },
        subject: primaryMessage?.subject ?? raw.subject ?? args.record.externalReference,
        displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(raw.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
        receivedAt: primaryMessage?.receivedAt ? primaryMessage.receivedAt.toISOString() : raw.receivedAt ?? null,
        bodyText: combinedBodyText || primaryMessage?.bodyText || raw.bodyText || null,
        bodyHtml: combinedBodyHtml || primaryMessage?.bodyHtml || raw.bodyHtml || null,
        attachments: combinedAttachments,
        intent: classification?.intent ?? raw.intent ?? null,
        intentReason: classification?.reason ?? raw.intentReason ?? null,
        intentReasons: classification?.reasons ?? raw.intentReasons ?? null,
        intentCrmInfluence: classification?.crmInfluence ?? raw.intentCrmInfluence ?? null,
        senderTrustSource: senderTrustDecision?.trustSource ?? raw.senderTrustSource ?? null,
        senderTrustReason: senderTrustDecision?.reason ?? raw.senderTrustReason ?? null,
        thread: threadSummary,
        lastManualReprocess: {
          action: args.action,
          at: new Date().toISOString(),
          actorUserId: args.actorUserId,
        },
      },
      normalizedPayloadJson: {
        ...normalized,
        source: {
          ...(isRecord(normalized.source) ? normalized.source : {}),
          type: "email",
          provider: primaryMessage?.provider ?? getPathValue(normalized, "source.provider") ?? "gmail",
          messageId: primaryMessage?.messageId ?? getPathValue(normalized, "source.messageId") ?? args.record.sourceMessageId,
          threadId: args.threadId ?? getPathValue(normalized, "source.threadId") ?? null,
        },
        inboundIntent: classification?.intent ?? normalized.inboundIntent ?? null,
        inboundIntentReason: classification?.reason ?? normalized.inboundIntentReason ?? null,
        inboundIntentReasons: classification?.reasons ?? normalized.inboundIntentReasons ?? null,
        inboundIntentCrmInfluence: classification?.crmInfluence ?? normalized.inboundIntentCrmInfluence ?? null,
        senderTrustSource: senderTrustDecision?.trustSource ?? normalized.senderTrustSource ?? null,
        senderTrustReason: senderTrustDecision?.reason ?? normalized.senderTrustReason ?? null,
        sender: {
          ...(isRecord(normalized.sender) ? normalized.sender : {}),
          name: primaryMessage?.senderName ?? getPathValue(normalized, "sender.name") ?? null,
          email: primaryMessage?.senderEmail ?? getPathValue(normalized, "sender.email") ?? null,
        },
        subject: primaryMessage?.subject ?? normalized.subject ?? args.record.externalReference,
        displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(normalized.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
        bodyText: combinedBodyText || primaryMessage?.bodyText || normalized.bodyText || null,
        bodyHtml: combinedBodyHtml || primaryMessage?.bodyHtml || normalized.bodyHtml || null,
        attachments: combinedAttachments,
        thread: threadSummary,
      },
      extractedOrderJson: {
        ...extractedOrder,
        inboundIntent: classification?.intent ?? extractedOrder.inboundIntent ?? null,
        inboundIntentReason: classification?.reason ?? extractedOrder.inboundIntentReason ?? null,
        inboundIntentReasons: classification?.reasons ?? extractedOrder.inboundIntentReasons ?? null,
        inboundIntentCrmInfluence: classification?.crmInfluence ?? extractedOrder.inboundIntentCrmInfluence ?? null,
        subject: primaryMessage?.subject ?? extractedOrder.subject ?? args.record.externalReference,
        displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(extractedOrder.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
        bodyText: combinedBodyText || primaryMessage?.bodyText || extractedOrder.bodyText || null,
        attachments: combinedAttachments,
      },
    };

    const updated = await this.inboundRepository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      patch,
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: args.action === "initial_thread_ingestion" || args.action === "thread_message_appended"
          ? "email.thread_source_refreshed"
          : "email.manual_reprocess_source_refreshed",
        fromStatus: null,
        toStatus: args.record.status,
        message: args.action === "thread_message_appended"
          ? "Inbound Gmail thread evidence refreshed from latest pull."
          : args.action === "initial_thread_ingestion"
            ? "Inbound Gmail thread evidence initialized from latest pull."
            : "Manual inbound email reprocess refreshed safe source evidence.",
        metadataJson: {
          action: args.action,
          threadId: args.threadId,
          latestMessageId: latestMessage?.messageId ?? null,
          threadMessagesInspected: args.messages.length,
          latestThreadActivity: threadSummary.latestActivityAt,
          attachmentCandidatesAcrossThread: combinedAttachments.length,
          createsQuote: false,
          createsOrder: false,
          createsArtwork: false,
          createsProofs: false,
        },
      },
    });
    return updated?.record ?? null;
  }

  private summarizeManualReprocessResult(args: {
    action: InboundEmailManualReprocessAction;
    record: InboundOrderRecord;
    messages: InboundEmailProviderMessage[];
    diagnosticsByMessage: AttachmentIngestionDiagnostics[];
    threadId: string | null;
  }): InboundEmailManualReprocessResult {
    const latestMessage = args.messages.reduce<InboundEmailProviderMessage | null>((latest, message) => {
      if (!latest) return message;
      return (message.receivedAt?.getTime() ?? 0) > (latest.receivedAt?.getTime() ?? 0) ? message : latest;
    }, null);
    return {
      action: args.action,
      inboundRecordId: args.record.id,
      providerMessageId: args.record.sourceMessageId ?? args.record.sourceRecordId ?? null,
      providerThreadId: args.threadId,
      threadMessagesInspected: args.messages.length,
      latestThreadActivity: latestMessage?.receivedAt ? latestMessage.receivedAt.toISOString() : null,
      candidatesFound: args.diagnosticsByMessage.reduce((sum, item) => sum + item.attachmentCandidatesDiscovered, 0),
      attempted: args.diagnosticsByMessage.reduce((sum, item) => sum + item.attachmentPartsAttempted, 0),
      stored: args.diagnosticsByMessage.reduce((sum, item) => sum + item.storedRowsCreated, 0),
      metadataOnly: args.diagnosticsByMessage.reduce((sum, item) => sum + item.metadataOnlyRowsCreated, 0),
      failed: args.diagnosticsByMessage.reduce((sum, item) => sum + item.downloadFailures, 0),
      skipped: args.diagnosticsByMessage.reduce((sum, item) => sum + item.skippedExistingProviderAttachments, 0),
      diagnosticsByMessage: args.diagnosticsByMessage,
    };
  }

  private async ensureSourceForMailbox(mailbox: InboundEmailMailbox): Promise<InboundOrderSource> {
    if (mailbox.sourceId) {
      const [existing] = await this.dbInstance
        .select()
        .from(inboundOrderSources)
        .where(and(eq(inboundOrderSources.organizationId, mailbox.organizationId), eq(inboundOrderSources.id, mailbox.sourceId)))
        .limit(1);
      if (existing) return existing;
    }

    const sourceName = `Inbound Email: ${mailbox.emailAddress}`;
    const [byName] = await this.dbInstance
      .select()
      .from(inboundOrderSources)
      .where(and(
        eq(inboundOrderSources.organizationId, mailbox.organizationId),
        eq(inboundOrderSources.sourceType, "email"),
        eq(inboundOrderSources.name, sourceName),
      ))
      .limit(1);

    const source = byName ?? (await this.dbInstance
      .insert(inboundOrderSources)
      .values({
        organizationId: mailbox.organizationId,
        sourceType: "email",
        name: sourceName,
        status: "active",
        sourceTrustLevel: "semi_trusted_email",
        authMode: "oauth",
        externalAccountId: mailbox.emailAddress,
        settingsJson: { mailboxId: mailbox.id, provider: mailbox.provider },
        createdByUserId: mailbox.createdByUserId ?? null,
      })
      .returning())[0];

    if (source && mailbox.sourceId !== source.id) {
      await this.dbInstance
        .update(inboundEmailMailboxes)
        .set({ sourceId: source.id, updatedAt: new Date() })
        .where(eq(inboundEmailMailboxes.id, mailbox.id));
    }
    return source;
  }

  private providerMessageFromRecord(record: InboundOrderRecord): InboundEmailProviderMessage {
    const raw = isRecord(record.rawPayloadJson) ? record.rawPayloadJson : {};
    const normalized = isRecord(record.normalizedPayloadJson) ? record.normalizedPayloadJson : {};
    const sender = isRecord(raw.sender) ? raw.sender : isRecord(normalized.sender) ? normalized.sender : {};
    const source = isRecord(normalized.source) ? normalized.source : {};
    return {
      provider: stringFromUnknown(raw.provider) ?? stringFromUnknown(source.provider) ?? "gmail",
      messageId: stringFromUnknown(raw.messageId) ?? stringFromUnknown(source.messageId) ?? record.sourceMessageId ?? record.sourceRecordId ?? "",
      threadId: stringFromUnknown(raw.threadId) ?? stringFromUnknown(source.threadId),
      senderName: stringFromUnknown(sender.name),
      senderEmail: stringFromUnknown(sender.email),
      subject: stringFromUnknown(raw.subject) ?? stringFromUnknown(normalized.subject) ?? record.externalReference,
      receivedAt: record.receivedAt ?? null,
      bodyText: stringFromUnknown(raw.bodyText) ?? stringFromUnknown(normalized.bodyText),
      bodyHtml: stringFromUnknown(raw.bodyHtml) ?? stringFromUnknown(normalized.bodyHtml),
      attachments: [],
    };
  }

  private attachmentMetadataFromFile(file: InboundOrderFile): InboundEmailAttachmentMetadata {
    const metadata = isRecord(file.metadataJson) ? file.metadataJson : {};
    return {
      filename: file.sourceFilename ?? stringFromUnknown(metadata.sourceFilename),
      mimeType: file.mimeType ?? stringFromUnknown(metadata.mimeType),
      size: file.sizeBytes ?? (typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : null),
      attachmentId: file.providerAttachmentId ?? stringFromUnknown(metadata.providerAttachmentId),
      contentDisposition: file.contentDisposition ?? stringFromUnknown(metadata.contentDisposition),
      contentId: stringFromUnknown(metadata.contentId),
      partId: stringFromUnknown(metadata.gmailPartId) ?? stringFromUnknown(metadata.partId),
      detectedBy: Array.isArray(metadata.detectedBy)
        ? metadata.detectedBy.filter((entry): entry is string => typeof entry === "string")
        : undefined,
    };
  }

  private async resolveMailboxForRecord(organizationId: string, record: InboundOrderRecord): Promise<InboundEmailMailbox> {
    const raw = isRecord(record.rawPayloadJson) ? record.rawPayloadJson : {};
    const normalized = isRecord(record.normalizedPayloadJson) ? record.normalizedPayloadJson : {};
    const mailboxPayload = isRecord(raw.mailbox) ? raw.mailbox : {};
    const sourcePayload = isRecord(normalized.source) ? normalized.source : {};
    const mailboxId = stringFromUnknown(mailboxPayload.id) ?? stringFromUnknown(sourcePayload.mailboxId);
    const mailboxEmail = stringFromUnknown(mailboxPayload.emailAddress) ?? stringFromUnknown(sourcePayload.mailboxEmail);
    const mailboxes = await this.dbInstance
      .select()
      .from(inboundEmailMailboxes)
      .where(eq(inboundEmailMailboxes.organizationId, organizationId));
    const mailbox = mailboxes.find((candidate) => mailboxId && candidate.id === mailboxId)
      ?? mailboxes.find((candidate) => mailboxEmail && candidate.emailAddress.toLowerCase() === mailboxEmail.toLowerCase())
      ?? mailboxes.find((candidate) => candidate.provider === "gmail" && candidate.enabled)
      ?? null;
    if (!mailbox) throw new InboundEmailIngestionError("INBOUND_EMAIL_MAILBOX_NOT_CONFIGURED", "No inbound Gmail mailbox is configured for this record.", 409);
    return mailbox;
  }

  private async markAttachmentMetadataState(args: {
    organizationId: string;
    record: InboundOrderRecord;
    file: InboundOrderFile;
    attachmentState: InboundAttachmentState;
    status: InboundOrderFile["status"];
    reason: string;
    metadataPatch?: Record<string, unknown>;
  }): Promise<InboundOrderFile> {
    const updated = await this.inboundRepository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      fileId: args.file.id,
      patch: {
        status: args.status,
        metadataJson: {
          ...(isRecord(args.file.metadataJson) ? args.file.metadataJson : {}),
          ...(args.metadataPatch ?? {}),
          attachmentState: args.attachmentState,
          attachmentSafetyReason: args.reason,
          failureReason: args.reason,
        },
        reviewNotes: args.reason,
      },
    });
    if (!updated) throw new InboundEmailIngestionError("INBOUND_ATTACHMENT_UPDATE_FAILED", "Failed to update inbound attachment.", 500);
    return updated;
  }

  private async processMessage(
    organizationId: string,
    actorUserId: string,
    mailbox: InboundEmailMailbox,
    source: InboundOrderSource,
    message: InboundEmailProviderMessage,
    adapter: InboundEmailProviderAdapter,
  ): Promise<InboundEmailProcessMessageResult> {
    message = await this.messageWithRecoveredProviderAttachments(mailbox, message, adapter);
    const internalSender = isInternalOutboundInboundEmailMessage(mailbox, message);
    if (internalSender.internal) {
      return {
        status: "ignored",
        processingOutcome: "internal_sender_skipped",
        reason: internalSender.reason ?? "Sender belongs to an organization/internal domain.",
      };
    }
    if (message.threadId && adapter.getThreadMessages) {
      return this.processThreadMessage(organizationId, actorUserId, mailbox, source, message, adapter);
    }
    const idempotencyKey = `${message.provider}:${message.messageId}`;
    const [existing] = await this.dbInstance
      .select({ id: inboundOrderRecords.id })
      .from(inboundOrderRecords)
      .where(and(
        eq(inboundOrderRecords.organizationId, organizationId),
        eq(inboundOrderRecords.sourceId, source.id),
        eq(inboundOrderRecords.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    if (existing) {
      const [existingRecord] = await this.dbInstance
        .select()
        .from(inboundOrderRecords)
        .where(and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.id, existing.id),
        ))
        .limit(1);
      if (existingRecord) {
        await this.backfillDuplicateAttachmentsIfNeeded({
          organizationId,
          actorUserId,
          mailbox,
          message,
          record: existingRecord,
          adapter,
        });
      }
      return {
        status: "skippedDuplicates",
        recordId: existing.id,
        processingOutcome: "duplicate",
        reason: "Message already has an inbound record; attachments were checked for safe backfill.",
      };
    }

    const matchedIgnoreRule = await this.findMatchedIgnoreRule(organizationId, message);
    if (matchedIgnoreRule) {
      await this.inboundRepository.recordEmailIgnoreRuleMatch(matchedIgnoreRule.id);
      console.info("[Inbound Email Pull] Ignored message by rule", {
        organizationId,
        mailboxId: mailbox.id,
        messageId: message.messageId,
        ruleId: matchedIgnoreRule.id,
        ruleType: matchedIgnoreRule.ruleType,
        ruleValue: matchedIgnoreRule.ruleValue,
      });
      return {
        status: "ignored",
        processingOutcome: "ignored_rule",
        reason: `Matched ignore rule ${matchedIgnoreRule.ruleType}.`,
      };
    }

    const senderTrustDecision = await this.resolveSenderTrust(organizationId, message, { recordMatch: false });
    const classification = classifyInboundEmailForReview(message, {
      senderTrusted: senderTrustDecision.trusted,
      trustSource: senderTrustDecision.trustSource,
      trustReason: senderTrustDecision.reason,
    });
    if (classification.ignored) {
      return {
        status: "ignored",
        processingOutcome: "classification_skipped",
        reason: classification.reason,
        classificationOutcome: classification.intent,
        classificationReason: classification.reason,
        crmInfluence: classification.crmInfluence,
      };
    }

    const receivedAt = message.receivedAt ?? new Date();
    const sourceLabel = `TEMP_INBOUND email intake - ${classification.intent}`;
    const displaySubject = displaySubjectForMessage(message);
    const externalReference = truncate(externalReferenceForMessage(message), 255);
    const rawPayloadJson = {
      intakeMode: "TEMP_INBOUND",
      provider: message.provider,
      mailbox: {
        id: mailbox.id,
        name: mailbox.name,
        emailAddress: mailbox.emailAddress,
      },
      messageId: message.messageId,
      threadId: message.threadId,
      sender: {
        name: message.senderName,
        email: message.senderEmail,
      },
      subject: message.subject,
      displaySubject,
      receivedAt: receivedAt.toISOString(),
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      attachments: message.attachments,
      intent: classification.intent,
      intentReason: classification.reason,
      intentReasons: classification.reasons,
      intentCrmInfluence: classification.crmInfluence,
      senderTrustSource: senderTrustDecision.trustSource,
      senderTrustReason: senderTrustDecision.reason,
    };

    const [record] = await this.dbInstance.transaction(async (tx) => {
      const [created] = await tx
        .insert(inboundOrderRecords)
        .values({
          organizationId,
          sourceId: source.id,
          sourceType: "email",
          sourceLabel,
          sourceTrustLevel: "semi_trusted_email",
          sourceRecordId: message.messageId,
          sourceMessageId: message.messageId,
          status: "needs_review",
          requiresHumanDecision: true,
          reviewRequiredReason: `${classification.intent} email candidate needs staff review.`,
          externalReference,
          idempotencyKey,
          rawPayloadJson,
          normalizedPayloadJson: {
            intakeMode: "TEMP_INBOUND",
            source: {
              type: "email",
              provider: message.provider,
              mailboxId: mailbox.id,
              messageId: message.messageId,
              threadId: message.threadId,
            },
            inboundIntent: classification.intent,
            inboundIntentReason: classification.reason,
            inboundIntentReasons: classification.reasons,
            inboundIntentCrmInfluence: classification.crmInfluence,
            senderTrustSource: senderTrustDecision.trustSource,
            senderTrustReason: senderTrustDecision.reason,
            sender: {
              name: message.senderName,
              email: message.senderEmail,
            },
            subject: message.subject,
            displaySubject,
            bodyText: message.bodyText,
            bodyHtml: message.bodyHtml,
            attachments: message.attachments,
          },
          extractedCustomerJson: {
            senderName: message.senderName,
            senderEmail: message.senderEmail,
          },
          extractedOrderJson: {
            inboundIntent: classification.intent,
            inboundIntentReason: classification.reason,
            inboundIntentReasons: classification.reasons,
            inboundIntentCrmInfluence: classification.crmInfluence,
            subject: message.subject,
            displaySubject,
            bodyText: message.bodyText,
            attachments: message.attachments,
          },
          extractedShippingJson: {},
          receivedAt,
        })
        .onConflictDoNothing({
          target: [
            inboundOrderRecords.organizationId,
            inboundOrderRecords.sourceId,
            inboundOrderRecords.idempotencyKey,
          ],
        })
        .returning();

      if (!created) return [null];

      await tx.insert(inboundOrderEvents).values({
        organizationId,
        inboundRecordId: created.id,
        actorUserId,
        actorType: "user",
        eventType: "email.pull_candidate_created",
        fromStatus: null,
        toStatus: "needs_review",
        message: `Manual email pull created ${classification.intent} TEMP_INBOUND candidate.`,
        metadataJson: {
          phase: "inbound_orders_phase_3_10",
          provider: message.provider,
          mailboxId: mailbox.id,
          messageId: message.messageId,
          threadId: message.threadId,
          intent: classification.intent,
          createsQuote: false,
          createsOrder: false,
          releasesProduction: false,
          createsProofs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });
      return [created as InboundOrderRecord | null];
    });

    if (!record) {
      const [conflictedRecord] = await this.dbInstance
        .select()
        .from(inboundOrderRecords)
        .where(and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.sourceId, source.id),
          eq(inboundOrderRecords.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (conflictedRecord) {
        await this.backfillDuplicateAttachmentsIfNeeded({
          organizationId,
          actorUserId,
          mailbox,
          message,
          record: conflictedRecord,
          adapter,
        });
      }
      return {
        status: "skippedDuplicates",
        recordId: conflictedRecord?.id ?? null,
        processingOutcome: "duplicate",
        reason: "Message conflicted with an existing inbound record; attachments were checked for safe backfill.",
      };
    }
    await this.ingestAttachmentsWithCallAudit({
      organizationId,
      actorUserId,
      mailbox,
      message,
      record,
      adapter,
      skippedReason: null,
    });
    return {
      status: "created",
      recordId: record.id,
      processingOutcome: message.subject?.trim() ? "created_record" : "no_subject_ingested",
      reason: message.subject?.trim()
        ? `Created TEMP_INBOUND candidate from ${classification.intent} classification.`
        : "Created TEMP_INBOUND candidate with safe no-subject fallback.",
      classificationOutcome: classification.intent,
      classificationReason: classification.reason,
      crmInfluence: classification.crmInfluence,
    };
  }

  private async processThreadMessage(
    organizationId: string,
    actorUserId: string,
    mailbox: InboundEmailMailbox,
    source: InboundOrderSource,
    seedMessage: InboundEmailProviderMessage,
    adapter: InboundEmailProviderAdapter,
  ): Promise<InboundEmailProcessMessageResult> {
    const threadId = seedMessage.threadId;
    if (!threadId) return this.processMessage(organizationId, actorUserId, mailbox, source, seedMessage, { ...adapter, getThreadMessages: undefined });

    const idempotencyKey = `${seedMessage.provider}:thread:${threadId}`;
    const threadMessages = await this.resolveMessagesForInitialThread(mailbox, seedMessage, adapter);
    const sortedMessages = threadMessages.slice().sort((a, b) => (
      (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0)
    ));
    const latestMessage = sortedMessages.reduce<InboundEmailProviderMessage | null>((latest, message) => {
      if (!latest) return message;
      return (message.receivedAt?.getTime() ?? 0) > (latest.receivedAt?.getTime() ?? 0) ? message : latest;
    }, null) ?? seedMessage;
    const firstMessage = sortedMessages[0] ?? seedMessage;

    const [existing] = await this.dbInstance
      .select({ id: inboundOrderRecords.id })
      .from(inboundOrderRecords)
      .where(and(
        eq(inboundOrderRecords.organizationId, organizationId),
        eq(inboundOrderRecords.sourceId, source.id),
        eq(inboundOrderRecords.idempotencyKey, idempotencyKey),
      ))
      .limit(1);

    if (existing) {
      const [existingRecord] = await this.dbInstance
        .select()
        .from(inboundOrderRecords)
        .where(and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.id, existing.id),
        ))
        .limit(1);
      if (existingRecord) {
        const refreshedRecord = await this.refreshRecordSourceEvidenceFromMessages({
          organizationId,
          actorUserId,
          record: existingRecord,
          action: "thread_message_appended",
          messages: sortedMessages,
          threadId,
        }) ?? existingRecord;
        await this.ingestThreadAttachments({
          organizationId,
          actorUserId,
          mailbox,
          record: refreshedRecord,
          messages: sortedMessages,
          adapter,
          skippedReason: "thread_message_attachment_backfill",
        });
      }
      return {
        status: "skippedDuplicates",
        recordId: existing.id,
        processingOutcome: "updated_thread_container",
        reason: "Existing Gmail thread container was refreshed with latest thread evidence and attachments.",
      };
    }

    for (const candidate of sortedMessages) {
      const matchedIgnoreRule = await this.findMatchedIgnoreRule(organizationId, candidate);
      if (!matchedIgnoreRule) continue;
      await this.inboundRepository.recordEmailIgnoreRuleMatch(matchedIgnoreRule.id);
      console.info("[Inbound Email Pull] Ignored Gmail thread by rule", {
        organizationId,
        mailboxId: mailbox.id,
        threadId,
        messageId: candidate.messageId,
        ruleId: matchedIgnoreRule.id,
        ruleType: matchedIgnoreRule.ruleType,
        ruleValue: matchedIgnoreRule.ruleValue,
      });
      return {
        status: "ignored",
        processingOutcome: "ignored_rule",
        reason: `Thread message matched ignore rule ${matchedIgnoreRule.ruleType}.`,
      };
    }

    const combinedBodyText = sortedMessages
      .map((message) => message.bodyText)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n--- Thread message ---\n\n");
    const combinedBodyHtml = sortedMessages
      .map((message) => message.bodyHtml)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n<hr />\n");
    const combinedAttachments = sortedMessages.flatMap((message) => (
      message.attachments.map((attachment) => ({
        ...attachment,
        providerMessageId: attachment.providerMessageId ?? message.messageId,
      }))
    ));
    const senderTrustDecision = await this.resolveClassificationTrust(organizationId, sortedMessages);
    const classification = classifyInboundEmailForReview({
      ...latestMessage,
      bodyText: combinedBodyText || latestMessage.bodyText,
      bodyHtml: combinedBodyHtml || latestMessage.bodyHtml,
      attachments: combinedAttachments,
    }, {
      senderTrusted: senderTrustDecision.trusted,
      trustSource: senderTrustDecision.trustSource,
      trustReason: senderTrustDecision.reason,
    });
    if (classification.ignored) {
      return {
        status: "ignored",
        processingOutcome: "classification_skipped",
        reason: classification.reason,
        classificationOutcome: classification.intent,
        classificationReason: classification.reason,
        crmInfluence: classification.crmInfluence,
      };
    }

    const receivedAt = firstMessage.receivedAt ?? latestMessage.receivedAt ?? new Date();
    const sourceLabel = `TEMP_INBOUND email thread intake - ${classification.intent}`;
    const provisionalRecord = {
      id: "provisional_thread_record",
      organizationId,
      sourceId: source.id,
      sourceType: "email",
      sourceLabel,
      sourceTrustLevel: "semi_trusted_email",
      sourceRecordId: latestMessage.messageId,
      sourceMessageId: latestMessage.messageId,
      status: "needs_review",
      reviewOutcome: null,
      requiresHumanDecision: true,
      reviewRequiredReason: `${classification.intent} email thread candidate needs staff review.`,
      externalReference: truncate(externalReferenceForMessage(latestMessage ?? seedMessage), 255),
      idempotencyKey,
      payloadHash: null,
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        provider: seedMessage.provider,
        mailbox: {
          id: mailbox.id,
          name: mailbox.name,
          emailAddress: mailbox.emailAddress,
        },
      },
      normalizedPayloadJson: {},
      extractedCustomerJson: {},
      extractedOrderJson: {},
      extractedShippingJson: {},
      confidenceScore: null,
      duplicateScore: null,
      matchedCustomerId: null,
      matchedContactId: null,
      matchedQuoteId: null,
      matchedOrderId: null,
      createdQuoteId: null,
      createdOrderId: null,
      assignedToUserId: null,
      submittedByUserId: null,
      rejectedByUserId: null,
      rejectionReason: null,
      receivedAt,
      parsedAt: null,
      reviewStartedAt: null,
      approvedAt: null,
      submittedAt: null,
      rejectedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as InboundOrderRecord;
    const evidence = this.buildThreadEvidenceForRecord({
      record: provisionalRecord,
      actorUserId,
      action: "initial_thread_ingestion",
      messages: sortedMessages,
      threadId,
      classification,
    });

    const [createdRecord] = await this.dbInstance.transaction(async (tx) => {
      const [created] = await tx
        .insert(inboundOrderRecords)
        .values({
          organizationId,
          sourceId: source.id,
          sourceType: "email",
          sourceLabel,
          sourceTrustLevel: "semi_trusted_email",
          sourceRecordId: latestMessage.messageId,
          sourceMessageId: latestMessage.messageId,
          status: "needs_review",
          requiresHumanDecision: true,
          reviewRequiredReason: `${classification.intent} email thread candidate needs staff review.`,
          externalReference: truncate(externalReferenceForMessage(latestMessage ?? seedMessage), 255),
          idempotencyKey,
          rawPayloadJson: evidence.patch.rawPayloadJson,
          normalizedPayloadJson: evidence.patch.normalizedPayloadJson,
          extractedCustomerJson: {
            senderName: latestMessage.senderName,
            senderEmail: latestMessage.senderEmail,
          },
          extractedOrderJson: evidence.patch.extractedOrderJson,
          extractedShippingJson: {},
          receivedAt,
        })
        .onConflictDoNothing({
          target: [
            inboundOrderRecords.organizationId,
            inboundOrderRecords.sourceId,
            inboundOrderRecords.idempotencyKey,
          ],
        })
        .returning();

      if (!created) return [null];

      await tx.insert(inboundOrderEvents).values({
        organizationId,
        inboundRecordId: created.id,
        actorUserId,
        actorType: "user",
        eventType: "email.thread_candidate_created",
        fromStatus: null,
        toStatus: "needs_review",
        message: `Manual email pull created ${classification.intent} TEMP_INBOUND thread candidate.`,
        metadataJson: {
          phase: "inbound_orders_thread_container_ingestion",
          provider: seedMessage.provider,
          mailboxId: mailbox.id,
          messageId: latestMessage.messageId,
          threadId,
          threadMessageCount: sortedMessages.length,
          latestMessageId: latestMessage.messageId,
          attachmentCandidatesAcrossThread: combinedAttachments.length,
          intent: classification.intent,
          intentReason: classification.reason,
          intentReasons: classification.reasons,
          intentCrmInfluence: classification.crmInfluence,
          senderTrustSource: senderTrustDecision.trustSource,
          senderTrustReason: senderTrustDecision.reason,
          createsQuote: false,
          createsOrder: false,
          releasesProduction: false,
          createsProofs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });
      return [created as InboundOrderRecord | null];
    });

    if (!createdRecord) {
      const [conflictedRecord] = await this.dbInstance
        .select()
        .from(inboundOrderRecords)
        .where(and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.sourceId, source.id),
          eq(inboundOrderRecords.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (conflictedRecord) {
        const refreshedRecord = await this.refreshRecordSourceEvidenceFromMessages({
          organizationId,
          actorUserId,
          record: conflictedRecord,
          action: "thread_message_appended",
          messages: sortedMessages,
          threadId,
        }) ?? conflictedRecord;
        await this.ingestThreadAttachments({
          organizationId,
          actorUserId,
          mailbox,
          record: refreshedRecord,
          messages: sortedMessages,
          adapter,
          skippedReason: "thread_message_attachment_backfill",
        });
      }
      return {
        status: "skippedDuplicates",
        recordId: conflictedRecord?.id ?? null,
        processingOutcome: "updated_thread_container",
        reason: "Thread container already existed after insert conflict; evidence and attachments were refreshed.",
      };
    }

    await this.ingestThreadAttachments({
      organizationId,
      actorUserId,
      mailbox,
      record: createdRecord,
      messages: sortedMessages,
      adapter,
      skippedReason: null,
    });
    return {
      status: "created",
      recordId: createdRecord.id,
      processingOutcome: sortedMessages.some((message) => message.subject?.trim()) ? "created_record" : "no_subject_ingested",
      reason: sortedMessages.some((message) => message.subject?.trim())
        ? `Created TEMP_INBOUND Gmail thread candidate from ${classification.intent} classification.`
        : "Created TEMP_INBOUND Gmail thread candidate with safe no-subject fallback.",
      classificationOutcome: classification.intent,
      classificationReason: classification.reason,
      crmInfluence: classification.crmInfluence,
    };
  }

  private async resolveMessagesForInitialThread(
    mailbox: InboundEmailMailbox,
    seedMessage: InboundEmailProviderMessage,
    adapter: InboundEmailProviderAdapter,
  ): Promise<InboundEmailProviderMessage[]> {
    let messages: InboundEmailProviderMessage[] = [];
    if (seedMessage.threadId && adapter.getThreadMessages) {
      try {
        messages = await adapter.getThreadMessages(mailbox, seedMessage.threadId);
      } catch (error) {
        console.warn("[Inbound Email Pull] Failed to fetch Gmail thread; falling back to listed message", {
          mailboxId: mailbox.id,
          threadId: seedMessage.threadId,
          messageId: seedMessage.messageId,
          error: error instanceof Error ? error.message : "Unknown Gmail thread fetch error.",
        });
      }
    }
    if (messages.length === 0) messages = [seedMessage];
    const recovered = await Promise.all(messages.map((message) => (
      this.messageWithRecoveredProviderAttachments(mailbox, message, adapter)
    )));
    const byMessageId = new Map<string, InboundEmailProviderMessage>();
    for (const message of recovered) {
      if (!message.messageId) continue;
      byMessageId.set(message.messageId, {
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
          providerMessageId: attachment.providerMessageId ?? message.messageId,
        })),
      });
    }
    return Array.from(byMessageId.values());
  }

  private buildThreadEvidenceForRecord(args: {
    record: InboundOrderRecord;
    actorUserId: string;
    action: InboundEmailEvidenceRefreshAction;
    messages: InboundEmailProviderMessage[];
    threadId: string | null;
    classification?: ReturnType<typeof classifyInboundEmailForReview> | null;
  }): {
    patch: Pick<InboundOrderRecord, "rawPayloadJson" | "normalizedPayloadJson" | "extractedOrderJson">;
  } {
    const messages = dedupeThreadAttachmentMessages(args.messages);
    const raw = isRecord(args.record.rawPayloadJson) ? args.record.rawPayloadJson : {};
    const normalized = isRecord(args.record.normalizedPayloadJson) ? args.record.normalizedPayloadJson : {};
    const extractedOrder = isRecord(args.record.extractedOrderJson) ? args.record.extractedOrderJson : {};
    const latestMessage = messages.reduce<InboundEmailProviderMessage | null>((latest, message) => {
      if (!latest) return message;
      return (message.receivedAt?.getTime() ?? 0) > (latest.receivedAt?.getTime() ?? 0) ? message : latest;
    }, null);
    const firstMessage = messages.reduce<InboundEmailProviderMessage | null>((first, message) => {
      if (!first) return message;
      return (message.receivedAt?.getTime() ?? 0) < (first.receivedAt?.getTime() ?? 0) ? message : first;
    }, null);
    const sourceMessageId = args.record.sourceMessageId ?? args.record.sourceRecordId ?? null;
    const primaryMessage = messages.find((message) => message.messageId === sourceMessageId) ?? latestMessage ?? messages[0] ?? null;
    const combinedBodyText = messages
      .map((message) => message.bodyText)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n--- Thread message ---\n\n");
    const combinedBodyHtml = messages
      .map((message) => message.bodyHtml)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n<hr />\n");
    const combinedAttachments = messages.flatMap((message) => (
      message.attachments.map((attachment) => ({
        ...attachment,
        providerMessageId: attachment.providerMessageId ?? message.messageId,
        messageId: message.messageId,
        messageSubject: message.subject,
        messageDisplaySubject: displaySubjectForMessage(message),
        messageSenderEmail: message.senderEmail,
        messageReceivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
      }))
    ));
    const threadSummary = {
      id: args.threadId,
      messageCount: messages.length,
      firstMessageId: firstMessage?.messageId ?? null,
      latestMessageId: latestMessage?.messageId ?? null,
      firstMessageAt: firstMessage?.receivedAt ? firstMessage.receivedAt.toISOString() : null,
      latestActivityAt: latestMessage?.receivedAt ? latestMessage.receivedAt.toISOString() : null,
      latestSenderName: latestMessage?.senderName ?? null,
      latestSenderEmail: latestMessage?.senderEmail ?? null,
      latestSubject: latestMessage?.subject ?? null,
      latestDisplaySubject: latestMessage ? displaySubjectForMessage(latestMessage) : null,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        threadId: message.threadId,
        subject: message.subject,
        displaySubject: displaySubjectForMessage(message),
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        to: message.to ?? [],
        cc: message.cc ?? [],
        receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
        bodyText: message.bodyText ?? null,
        bodyHtml: message.bodyHtml ?? null,
        attachmentCount: message.attachments.length,
        attachmentFilenames: message.attachments.map((attachment) => attachment.filename).filter(Boolean),
      })),
    };
    const classification = args.classification ?? (primaryMessage
      ? classifyInboundEmailForReview({
          ...primaryMessage,
          bodyText: combinedBodyText || primaryMessage.bodyText,
          bodyHtml: combinedBodyHtml || primaryMessage.bodyHtml,
          attachments: combinedAttachments,
        })
      : null);
    return {
      patch: {
        rawPayloadJson: {
          ...raw,
          provider: primaryMessage?.provider ?? raw.provider ?? "gmail",
          mailbox: isRecord(raw.mailbox) ? raw.mailbox : raw.mailbox,
          messageId: primaryMessage?.messageId ?? raw.messageId ?? args.record.sourceMessageId,
          threadId: args.threadId ?? raw.threadId ?? null,
          sender: {
            ...(isRecord(raw.sender) ? raw.sender : {}),
            name: primaryMessage?.senderName ?? getPathValue(raw, "sender.name") ?? null,
            email: primaryMessage?.senderEmail ?? getPathValue(raw, "sender.email") ?? null,
          },
          subject: primaryMessage?.subject ?? raw.subject ?? args.record.externalReference,
          displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(raw.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
          receivedAt: primaryMessage?.receivedAt ? primaryMessage.receivedAt.toISOString() : raw.receivedAt ?? null,
          bodyText: combinedBodyText || primaryMessage?.bodyText || raw.bodyText || null,
          bodyHtml: combinedBodyHtml || primaryMessage?.bodyHtml || raw.bodyHtml || null,
          attachments: combinedAttachments,
          intent: classification?.intent ?? raw.intent ?? null,
          intentReason: classification?.reason ?? raw.intentReason ?? null,
          intentReasons: classification?.reasons ?? raw.intentReasons ?? null,
          intentCrmInfluence: classification?.crmInfluence ?? raw.intentCrmInfluence ?? null,
          thread: threadSummary,
          lastManualReprocess: args.action === "reprocess_email" || args.action === "backfill_attachments" || args.action === "rerun_trust_attachment_download"
            ? {
                action: args.action,
                at: new Date().toISOString(),
                actorUserId: args.actorUserId,
              }
            : raw.lastManualReprocess ?? null,
        },
        normalizedPayloadJson: {
          ...normalized,
          source: {
            ...(isRecord(normalized.source) ? normalized.source : {}),
            type: "email",
            provider: primaryMessage?.provider ?? getPathValue(normalized, "source.provider") ?? "gmail",
            messageId: primaryMessage?.messageId ?? getPathValue(normalized, "source.messageId") ?? args.record.sourceMessageId,
            threadId: args.threadId ?? getPathValue(normalized, "source.threadId") ?? null,
          },
          inboundIntent: classification?.intent ?? normalized.inboundIntent ?? null,
          inboundIntentReason: classification?.reason ?? normalized.inboundIntentReason ?? null,
          inboundIntentReasons: classification?.reasons ?? normalized.inboundIntentReasons ?? null,
          inboundIntentCrmInfluence: classification?.crmInfluence ?? normalized.inboundIntentCrmInfluence ?? null,
          sender: {
            ...(isRecord(normalized.sender) ? normalized.sender : {}),
            name: primaryMessage?.senderName ?? getPathValue(normalized, "sender.name") ?? null,
            email: primaryMessage?.senderEmail ?? getPathValue(normalized, "sender.email") ?? null,
          },
          subject: primaryMessage?.subject ?? normalized.subject ?? args.record.externalReference,
          displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(normalized.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
          bodyText: combinedBodyText || primaryMessage?.bodyText || normalized.bodyText || null,
          bodyHtml: combinedBodyHtml || primaryMessage?.bodyHtml || normalized.bodyHtml || null,
          attachments: combinedAttachments,
          thread: threadSummary,
        },
        extractedOrderJson: {
          ...extractedOrder,
          inboundIntent: classification?.intent ?? extractedOrder.inboundIntent ?? null,
          inboundIntentReason: classification?.reason ?? extractedOrder.inboundIntentReason ?? null,
          inboundIntentReasons: classification?.reasons ?? extractedOrder.inboundIntentReasons ?? null,
          inboundIntentCrmInfluence: classification?.crmInfluence ?? extractedOrder.inboundIntentCrmInfluence ?? null,
          subject: primaryMessage?.subject ?? extractedOrder.subject ?? args.record.externalReference,
          displaySubject: primaryMessage ? displaySubjectForMessage(primaryMessage) : stringFromUnknown(extractedOrder.displaySubject) ?? displaySubjectForMessage({ subject: args.record.externalReference }),
          bodyText: combinedBodyText || primaryMessage?.bodyText || extractedOrder.bodyText || null,
          attachments: combinedAttachments,
        },
      },
    };
  }

  private async ingestThreadAttachments(args: {
    organizationId: string;
    actorUserId: string;
    mailbox: InboundEmailMailbox;
    record: InboundOrderRecord;
    messages: InboundEmailProviderMessage[];
    adapter: InboundEmailProviderAdapter;
    skippedReason: string | null;
  }): Promise<AttachmentIngestionDiagnostics[]> {
    const diagnostics: AttachmentIngestionDiagnostics[] = [];
    const dedupedMessages = dedupeThreadAttachmentMessages(args.messages);
    for (const message of dedupedMessages) {
      diagnostics.push(await this.ingestAttachmentsWithCallAudit({
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        mailbox: args.mailbox,
        message: {
          ...message,
          attachments: message.attachments.map((attachment) => ({
            ...attachment,
            providerMessageId: attachment.providerMessageId ?? message.messageId,
          })),
        },
        record: this.recordWithoutStoredAttachmentCandidates(args.record),
        adapter: args.adapter,
        skippedReason: args.skippedReason,
      }));
    }
    return diagnostics;
  }

  private async backfillDuplicateAttachmentsIfNeeded(args: {
    organizationId: string;
    actorUserId: string;
    mailbox: InboundEmailMailbox;
    message: InboundEmailProviderMessage;
    record: InboundOrderRecord;
    adapter: InboundEmailProviderAdapter;
  }): Promise<void> {
    const existingFiles = await this.inboundRepository.listFiles(args.organizationId, args.record.id);
    const existingProviderAttachmentIds = new Set(existingFiles.map((file) => file.providerAttachmentId).filter((value): value is string => Boolean(value)));
    const attachmentCandidates = this.attachmentCandidatesForIngestion(args.message, args.record);
    const messageProviderAttachmentIds = attachmentCandidates.map((attachment) => attachment.attachmentId).filter((value): value is string => Boolean(value));
    const hasMissingProviderAttachment = messageProviderAttachmentIds.some((attachmentId) => !existingProviderAttachmentIds.has(attachmentId));
    const hasAttachmentsWithoutProviderIds = attachmentCandidates.some((attachment) => !attachment.attachmentId);
    const shouldBackfill = attachmentCandidates.length > 0 && (
      existingFiles.length === 0
      || hasMissingProviderAttachment
      || (hasAttachmentsWithoutProviderIds && existingFiles.length === 0)
    );

    if (!shouldBackfill) {
      await this.recordAttachmentIngestionDiagnostics({
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        record: args.record,
        diagnostics: {
          messageId: args.message.messageId,
          subject: args.message.subject,
          attachmentPartsDiscovered: attachmentCandidates.length,
          attachmentCandidatesDiscovered: attachmentCandidates.length,
          attachmentIdsDiscovered: messageProviderAttachmentIds,
          attachmentPartsAttempted: 0,
          attachmentRowsCreated: 0,
          storedRowsCreated: 0,
          metadataOnlyRowsCreated: 0,
          downloadAttempts: 0,
          downloadSuccesses: 0,
          downloadFailures: 0,
          skippedExistingProviderAttachments: messageProviderAttachmentIds.length,
          skippedReason: attachmentCandidates.length === 0
            ? "duplicate_message_no_attachment_parts_discovered"
            : "duplicate_message_existing_files_cover_provider_attachments",
          failures: [],
        },
      });
      return;
    }

    await this.ingestAttachmentsWithCallAudit({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      mailbox: args.mailbox,
      message: args.message,
      record: args.record,
      adapter: args.adapter,
      skippedReason: "duplicate_message_attachment_backfill",
    });
  }

  private async buildAttachmentIngestionCallAudit(args: {
    organizationId: string;
    message: InboundEmailProviderMessage;
    record: InboundOrderRecord;
  }): Promise<AttachmentIngestionCallAudit> {
    const attachmentCandidates = this.attachmentCandidatesForIngestion(args.message, args.record);
    let trustDecision: SenderTrustDecision | null = null;
    try {
      trustDecision = await this.resolveSenderTrust(args.organizationId, args.message, { recordMatch: false });
    } catch (error) {
      trustDecision = {
        trusted: false,
        senderEmail: senderEmailFromMessage(args.message),
        senderDomain: senderDomainFromMessage(args.message),
        trustSource: "none",
        ruleId: null,
        reason: error instanceof Error ? error.message : "Unable to resolve sender trust for attachment audit.",
      };
    }
    const safetyDecisions = attachmentCandidates.map((attachment) => this.evaluateAttachmentSafety(
      attachment,
      classifyInboundEmailAttachmentForMessage(attachment, args.message),
      trustDecision,
    ));
    const attachmentPolicy = attachmentCandidates.length === 0
      ? "no_attachments"
      : safetyDecisions.every((decision) => decision.blocked)
        ? "blocked_file_type_only"
        : safetyDecisions.some((decision) => decision.attachmentState === "pending_trust")
          ? "pending_trust"
          : safetyDecisions.some((decision) => decision.downloadAllowed)
            ? "auto_download_allowed"
            : "pending_trust";
    return {
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      providerMessageId: args.message.messageId,
      subject: args.message.subject,
      candidateCount: attachmentCandidates.length,
      attachmentIdsDiscovered: attachmentCandidates.map((attachment) => attachment.attachmentId).filter((value): value is string => Boolean(value)),
      trustStatus: trustStatusFromDecision(trustDecision),
      attachmentPolicy,
      matchedTrustRuleId: trustDecision.ruleId,
      trustRuleType: trustDecision.trustSource === "none" ? null : trustDecision.trustSource,
      trustReason: trustDecision.reason,
      providerIdentifierColumnDiagnostics: providerIdentifierColumnDiagnostics({
        message: args.message,
        attachmentCandidates,
      }),
    };
  }

  private async recordAttachmentIngestionCallAudit(args: {
    organizationId: string;
    actorUserId: string;
    record: InboundOrderRecord;
    eventType: "attachment_ingestion_call_started" | "attachment_ingestion_call_completed" | "attachment_ingestion_call_failed";
    audit: AttachmentIngestionCallAudit;
    diagnostics?: AttachmentIngestionDiagnostics | null;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.inboundRepository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      actorUserId: args.actorUserId,
      actorType: "system",
      eventType: args.eventType,
      fromStatus: null,
      toStatus: null,
      message: args.eventType === "attachment_ingestion_call_started"
        ? "Inbound attachment ingestion call started."
        : args.eventType === "attachment_ingestion_call_completed"
          ? "Inbound attachment ingestion call completed."
          : "Inbound attachment ingestion call failed.",
      metadataJson: {
        ...args.audit,
        errorMessage: args.errorMessage ?? null,
        diagnostics: args.diagnostics
          ? {
              attachmentPartsAttempted: args.diagnostics.attachmentPartsAttempted,
              attachmentRowsCreated: args.diagnostics.attachmentRowsCreated,
              storedRowsCreated: args.diagnostics.storedRowsCreated,
              metadataOnlyRowsCreated: args.diagnostics.metadataOnlyRowsCreated,
              downloadAttempts: args.diagnostics.downloadAttempts,
              downloadSuccesses: args.diagnostics.downloadSuccesses,
              downloadFailures: args.diagnostics.downloadFailures,
              skippedReason: args.diagnostics.skippedReason,
            }
          : null,
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
        createsProductionJobs: false,
        createsInvoices: false,
        createsFulfillment: false,
        createsPayments: false,
      },
    });
  }

  private async ingestAttachmentsWithCallAudit(args: {
    organizationId: string;
    actorUserId: string;
    mailbox: InboundEmailMailbox;
    message: InboundEmailProviderMessage;
    record: InboundOrderRecord;
    adapter: InboundEmailProviderAdapter;
    skippedReason: string | null;
  }): Promise<AttachmentIngestionDiagnostics> {
    const audit = await this.buildAttachmentIngestionCallAudit(args);
    await this.recordAttachmentIngestionCallAudit({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      record: args.record,
      eventType: "attachment_ingestion_call_started",
      audit,
    });
    try {
      const diagnostics = await this.ingestAttachments(args);
      await this.recordAttachmentIngestionCallAudit({
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        record: args.record,
        eventType: "attachment_ingestion_call_completed",
        audit,
        diagnostics,
      });
      return diagnostics;
    } catch (error) {
      await this.recordAttachmentIngestionCallAudit({
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        record: args.record,
        eventType: "attachment_ingestion_call_failed",
        audit,
        errorMessage: error instanceof Error ? error.message : "Attachment ingestion failed.",
      });
      throw error;
    }
  }

  private attachmentCandidatesForIngestion(
    message: InboundEmailProviderMessage,
    record: InboundOrderRecord,
  ): InboundEmailAttachmentMetadata[] {
    return dedupeAttachmentCandidates([
      ...message.attachments,
      ...attachmentCandidatesFromPayload(record.rawPayloadJson),
      ...attachmentCandidatesFromPayload(record.normalizedPayloadJson),
      ...attachmentCandidatesFromPayload(record.extractedOrderJson),
    ]);
  }

  private async messageWithRecoveredProviderAttachments(
    mailbox: InboundEmailMailbox,
    message: InboundEmailProviderMessage,
    adapter: InboundEmailProviderAdapter,
  ): Promise<InboundEmailProviderMessage> {
    if (message.attachments.length > 0 || !adapter.getMessagePayloadDiagnostics) return message;
    try {
      const payloadDiagnostics = await adapter.getMessagePayloadDiagnostics(mailbox, message.messageId);
      if (payloadDiagnostics.extractedAttachments.length === 0) return message;
      return {
        ...message,
        attachments: dedupeAttachmentCandidates(payloadDiagnostics.extractedAttachments),
      };
    } catch (error) {
      console.warn("[Inbound Email Pull] Failed to recover Gmail attachment candidates from full payload", {
        mailboxId: mailbox.id,
        messageId: message.messageId,
        error: error instanceof Error ? error.message : "Unknown Gmail payload recovery error.",
      });
      return message;
    }
  }

  private async resolveSenderTrust(
    organizationId: string,
    message: InboundEmailProviderMessage,
    options: { recordMatch?: boolean } = {},
  ): Promise<SenderTrustDecision> {
    const senderEmail = senderEmailFromMessage(message);
    const senderDomain = senderDomainFromMessage(message);
    const matchedIgnoreRule = await this.findMatchedIgnoreRule(organizationId, message);
    if (matchedIgnoreRule) {
      const conflictingTrustRule = (await this.inboundRepository.listEnabledEmailTrustRules(organizationId))
        .find((rule) => inboundEmailRuleTypesConflict(matchedIgnoreRule.ruleType, matchedIgnoreRule.ruleValue, rule.ruleType, rule.ruleValue)) ?? null;
      return {
        trusted: false,
        senderEmail,
        senderDomain,
        trustSource: "ignored",
        ruleId: matchedIgnoreRule.id,
        reason: conflictingTrustRule
          ? `trust_suppressed_by_ignore: Sender matched inbound ignore rule ${matchedIgnoreRule.ruleType}; conflicting trust rule ${conflictingTrustRule.ruleType} is suppressed.`
          : `ignored_due_to_rule: Sender matched inbound ignore rule ${matchedIgnoreRule.ruleType}.`,
      };
    }
    const rules = await this.inboundRepository.listEnabledEmailTrustRules(organizationId);
    for (const rule of rules) {
      const value = rule.ruleValue.trim().toLowerCase();
      const matched = rule.ruleType === "sender_email_exact"
        ? Boolean(senderEmail && senderEmail === value)
        : rule.ruleType === "sender_domain"
          ? Boolean(senderDomain && !isPublicFreeEmailDomain(senderDomain) && senderDomain === value)
          : rule.ruleType === "customer_contact_email"
            ? Boolean(senderEmail && (value === "*" || senderEmail === value) && await this.inboundRepository.senderEmailMatchesCustomerContact(organizationId, senderEmail))
            : Boolean(senderDomain && !isPublicFreeEmailDomain(senderDomain) && (value === "*" || senderDomain === value) && await this.inboundRepository.senderDomainMatchesCustomerDomain(organizationId, senderDomain));
      if (!matched) continue;
      if (options.recordMatch !== false) {
        await this.inboundRepository.recordEmailTrustRuleMatch(rule.id);
      }
      return {
        trusted: true,
        senderEmail,
        senderDomain,
        trustSource: rule.ruleType,
        ruleId: rule.id,
        reason: `Sender matched inbound trust rule ${rule.ruleType}.`,
      };
    }
    if (senderEmail && await this.inboundRepository.senderEmailMatchesCustomerContact(organizationId, senderEmail)) {
      return {
        trusted: true,
        senderEmail,
        senderDomain,
        trustSource: "customer_contact_email",
        ruleId: null,
        reason: "Sender email matches an active customer contact.",
      };
    }
    if (senderDomain && !isPublicFreeEmailDomain(senderDomain) && await this.inboundRepository.senderDomainMatchesCustomerDomain(organizationId, senderDomain)) {
      return {
        trusted: true,
        senderEmail,
        senderDomain,
        trustSource: "customer_domain",
        ruleId: null,
        reason: "Sender domain matches a known customer or customer contact domain.",
      };
    }
    return {
      trusted: false,
      senderEmail,
      senderDomain,
      trustSource: "none",
      ruleId: null,
      reason: "Sender is not trusted for automatic attachment download.",
    };
  }

  private async resolveClassificationTrust(
    organizationId: string,
    messages: InboundEmailProviderMessage[],
  ): Promise<SenderTrustDecision> {
    let fallback: SenderTrustDecision | null = null;
    for (const message of messages) {
      const decision = await this.resolveSenderTrust(organizationId, message, { recordMatch: false });
      fallback ??= decision;
      if (decision.trusted) return decision;
    }
    return fallback ?? {
      trusted: false,
      senderEmail: null,
      senderDomain: null,
      trustSource: "none",
      ruleId: null,
      reason: "Sender is not trusted for automatic attachment download.",
    };
  }

  private evaluateAttachmentSafety(
    attachment: InboundEmailAttachmentMetadata,
    _classification: ReturnType<typeof classifyInboundEmailAttachmentForMessage>,
    trustDecision: SenderTrustDecision,
    options: { bypassTrust?: boolean } = {},
  ): AttachmentSafetyDecision {
    const extension = attachmentExtension(attachment);
    const blocked = Boolean(extension && BLOCKED_INBOUND_ATTACHMENT_EXTENSIONS.has(extension));
    const allowedForAutoDownload = Boolean(extension && ALLOWED_INBOUND_ATTACHMENT_EXTENSIONS.has(extension));
    const zipFile = extension === "zip";
    if (blocked) {
      return {
        extension,
        blocked,
        allowedForAutoDownload: false,
        zipFile,
        downloadAllowed: false,
        attachmentState: "blocked_file_type",
        reason: `Blocked file type .${extension} is never downloaded automatically.`,
      };
    }
    if (!allowedForAutoDownload) {
      return {
        extension,
        blocked,
        allowedForAutoDownload: false,
        zipFile,
        downloadAllowed: false,
        attachmentState: "metadata_only",
        reason: `Attachment type ${extension ? `.${extension}` : "unknown"} is not allowed for automatic download.`,
      };
    }
    if (!trustDecision.trusted && !options.bypassTrust) {
      return {
        extension,
        blocked,
        allowedForAutoDownload,
        zipFile,
        downloadAllowed: false,
        attachmentState: "pending_trust",
        reason: "Sender is not trusted. Attachment metadata captured pending staff trust decision.",
      };
    }
    return {
      extension,
      blocked,
      allowedForAutoDownload,
      zipFile,
      downloadAllowed: true,
      attachmentState: zipFile ? "scan_pending" : "download_pending",
      reason: zipFile
        ? "Trusted ZIP attachment may be stored but remains scan pending."
        : "Trusted sender and allowed file type permit download.",
    };
  }

  private async persistMetadataOnlyAttachment(args: {
    organizationId: string;
    record: InboundOrderRecord;
    existingFile: InboundOrderFile | null;
    values: Omit<Parameters<InboundOrdersRepository["createFile"]>[0], "organizationId" | "inboundRecordId">;
  }): Promise<InboundOrderFile> {
    if (!args.existingFile) {
      return this.inboundRepository.createFile({
        organizationId: args.organizationId,
        inboundRecordId: args.record.id,
        ...args.values,
      });
    }
    const updated = await this.inboundRepository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      fileId: args.existingFile.id,
      patch: args.values,
    });
    if (!updated) throw new Error("Failed to update inbound attachment metadata");
    return updated;
  }

  private async updateExistingAttachmentDedupeMetadata(args: {
    organizationId: string;
    record: InboundOrderRecord;
    existingFile: InboundOrderFile;
    metadataJson: Record<string, unknown>;
  }): Promise<InboundOrderFile | null> {
    const existingMetadata = isRecord(args.existingFile.metadataJson) ? args.existingFile.metadataJson : {};
    const existingMessageIds = Array.isArray(existingMetadata.seenProviderMessageIds)
      ? existingMetadata.seenProviderMessageIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const nextMessageIds = Array.isArray(args.metadataJson.seenProviderMessageIds)
      ? args.metadataJson.seenProviderMessageIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const existingSeenMessages = Array.isArray(existingMetadata.seenInMessages) ? existingMetadata.seenInMessages : [];
    const nextSeenMessages = Array.isArray(args.metadataJson.seenInMessages) ? args.metadataJson.seenInMessages : [];
    const seenByMessageId = new Map<string, unknown>();
    for (const entry of [...existingSeenMessages, ...nextSeenMessages]) {
      if (!isRecord(entry)) continue;
      const messageId = stringFromUnknown(entry.messageId);
      if (messageId) seenByMessageId.set(messageId, entry);
    }
    const seenProviderMessageIds = Array.from(new Set([...existingMessageIds, ...nextMessageIds]));
    return this.inboundRepository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      fileId: args.existingFile.id,
      patch: {
        metadataJson: {
          ...existingMetadata,
          attachmentDedupeKey: existingMetadata.attachmentDedupeKey ?? args.metadataJson.attachmentDedupeKey ?? null,
          attachmentDedupeKeys: Array.from(new Set([
            ...(Array.isArray(existingMetadata.attachmentDedupeKeys) ? existingMetadata.attachmentDedupeKeys.filter((entry): entry is string => typeof entry === "string") : []),
            ...(Array.isArray(args.metadataJson.attachmentDedupeKeys) ? args.metadataJson.attachmentDedupeKeys.filter((entry): entry is string => typeof entry === "string") : []),
          ])),
          attachmentDedupeStrategy: existingMetadata.attachmentDedupeStrategy ?? args.metadataJson.attachmentDedupeStrategy ?? null,
          duplicateCollapsed: true,
          seenProviderMessageIds,
          seenInMessages: Array.from(seenByMessageId.values()),
          seenInMessageCount: seenProviderMessageIds.length || seenByMessageId.size || 1,
        },
      },
    });
  }

  private async persistStoredAttachment(args: {
    tx: any;
    organizationId: string;
    record: InboundOrderRecord;
    existingFile: InboundOrderFile | null;
    values: Omit<Parameters<InboundOrdersRepository["createFile"]>[0], "organizationId" | "inboundRecordId">;
  }): Promise<InboundOrderFile> {
    if (!args.existingFile) {
      return this.inboundRepository.createFile({
        organizationId: args.organizationId,
        inboundRecordId: args.record.id,
        ...args.values,
      }, args.tx);
    }
    const updated = await this.inboundRepository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      fileId: args.existingFile.id,
      patch: args.values,
    }, args.tx);
    if (!updated) throw new Error("Failed to update inbound attachment file");
    return updated;
  }

  private async ingestAttachments(args: {
    organizationId: string;
    actorUserId: string;
    mailbox: InboundEmailMailbox;
    message: InboundEmailProviderMessage;
    record: InboundOrderRecord;
    adapter: InboundEmailProviderAdapter;
    skippedReason: string | null;
  }): Promise<AttachmentIngestionDiagnostics> {
    const attachmentCandidates = this.attachmentCandidatesForIngestion(args.message, args.record);
    const trustDecision = await this.resolveSenderTrust(args.organizationId, args.message);
    const existingFiles = await this.inboundRepository.listFiles(args.organizationId, args.record.id);
    const existingFilesByDedupeKey = new Map<string, InboundOrderFile>();
    const rememberFile = (file: InboundOrderFile) => {
      for (const key of inboundFileDedupeKeys(file)) {
        if (!existingFilesByDedupeKey.has(key)) existingFilesByDedupeKey.set(key, file);
      }
    };
    existingFiles.forEach(rememberFile);
    const diagnostics: AttachmentIngestionDiagnostics = {
      messageId: args.message.messageId,
      subject: args.message.subject,
      attachmentPartsDiscovered: attachmentCandidates.length,
      attachmentCandidatesDiscovered: attachmentCandidates.length,
      attachmentIdsDiscovered: attachmentCandidates.map((attachment) => attachment.attachmentId).filter((value): value is string => Boolean(value)),
      attachmentPartsAttempted: 0,
      attachmentRowsCreated: 0,
      storedRowsCreated: 0,
      metadataOnlyRowsCreated: 0,
      downloadAttempts: 0,
      downloadSuccesses: 0,
      downloadFailures: 0,
      skippedExistingProviderAttachments: 0,
      skippedReason: args.skippedReason,
      failures: [],
      safetyDecisions: [],
    };
    if (attachmentCandidates.length === 0) return diagnostics;

    for (const attachment of attachmentCandidates) {
      const providerAttachmentId = attachment.attachmentId ?? null;
      const providerMessageId = attachment.providerMessageId ?? args.message.messageId;
      const dedupeKeys = attachmentDedupeKeysForCandidate(attachment, providerMessageId);
      const attachmentDedupeKey = attachment.dedupeKey ?? dedupeKeys[0] ?? attachmentGlobalMetadataDedupeKey(attachment) ?? null;
      const classification = await this.classifyAttachmentForIngestion({
        organizationId: args.organizationId,
        record: args.record,
        attachment,
        message: args.message,
        actorUserId: args.actorUserId,
      });
      const safetyDecision = this.evaluateAttachmentSafety(attachment, classification, trustDecision);
      const filename = normalizeAttachmentFileName(attachment.filename);
      const contentDisposition = truncate(attachment.contentDisposition ?? null, 100);
      const metadataJson = {
        provider: args.message.provider,
        providerAttachmentId,
        providerMessageId,
        mailboxId: args.mailbox.id,
        sourceFilename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        contentDisposition: attachment.contentDisposition ?? null,
        contentId: attachment.contentId ?? null,
        gmailPartId: attachment.partId ?? null,
        detectedBy: attachment.detectedBy ?? [],
        sourceHint: classification.sourceHint,
        poCandidate: classification.poCandidate,
        artworkCandidate: classification.artworkCandidate,
        safeToDownload: classification.safeToDownload,
        detectionReason: classification.reason,
        attachmentClassification: classification.classification,
        attachmentClassificationRuleId: classification.matchedClassificationRuleId ?? null,
        attachmentClassificationRuleMatched: Boolean(classification.matchedClassificationRuleId),
        senderTrustStatus: trustDecision.trusted ? "trusted" : "untrusted",
        senderTrustSource: trustDecision.trustSource,
        senderTrustRuleId: trustDecision.ruleId,
        senderTrustReason: trustDecision.reason,
        attachmentState: safetyDecision.attachmentState,
        attachmentSafetyReason: safetyDecision.reason,
        attachmentExtension: safetyDecision.extension,
        blockedFileType: safetyDecision.blocked,
        allowedFileType: safetyDecision.allowedForAutoDownload,
        downloadAttemptAllowed: safetyDecision.downloadAllowed,
        attachmentDedupeKey,
        attachmentDedupeKeys: dedupeKeys,
        attachmentDedupeStrategy: attachment.dedupeStrategy ?? (attachmentDedupeKey?.startsWith("file:") ? "filename_size_mime" : "provider_message_attachment"),
        seenProviderMessageIds: attachment.seenProviderMessageIds ?? [providerMessageId],
        seenInMessages: attachment.seenInMessages ?? [{
          messageId: providerMessageId,
          subject: args.message.subject,
          receivedAt: args.message.receivedAt ? args.message.receivedAt.toISOString() : null,
        }],
        seenInMessageCount: attachment.seenInMessageCount ?? 1,
      };

      let existingFile: InboundOrderFile | null = null;
      try {
        diagnostics.attachmentPartsAttempted += 1;
        diagnostics.safetyDecisions?.push({
          filename,
          providerAttachmentId,
          trusted: trustDecision.trusted,
          trustSource: trustDecision.trustSource,
          extension: safetyDecision.extension,
          blocked: safetyDecision.blocked,
          allowedFileType: safetyDecision.allowedForAutoDownload,
          downloadAllowed: safetyDecision.downloadAllowed,
          attachmentState: safetyDecision.attachmentState,
          reason: safetyDecision.reason,
        });
        if (providerAttachmentId) {
          const existing = await this.inboundRepository.findFileByProviderAttachment({
            organizationId: args.organizationId,
            inboundRecordId: args.record.id,
            providerMessageId,
            providerAttachmentId,
          });
          if (existing) {
            const existingState = stringFromUnknown((existing.metadataJson as Record<string, unknown> | null)?.attachmentState);
            if (existing.fileRecordId || existingState === "blocked_file_type" || existingState === "scan_pending" || existingState === "quarantined") {
              await this.updateExistingAttachmentDedupeMetadata({
                organizationId: args.organizationId,
                record: args.record,
                existingFile: existing,
                metadataJson,
              });
              diagnostics.skippedExistingProviderAttachments += 1;
              continue;
            }
            existingFile = existing;
          }
        }
        if (!existingFile) {
          existingFile = dedupeKeys.map((key) => existingFilesByDedupeKey.get(key)).find(Boolean) ?? null;
        }
        if (existingFile) {
          const existingState = stringFromUnknown((existingFile.metadataJson as Record<string, unknown> | null)?.attachmentState);
          if (existingFile.fileRecordId || existingState === "blocked_file_type" || existingState === "scan_pending" || existingState === "quarantined") {
            await this.updateExistingAttachmentDedupeMetadata({
              organizationId: args.organizationId,
              record: args.record,
              existingFile,
              metadataJson,
            });
            diagnostics.skippedExistingProviderAttachments += 1;
            continue;
          }
        }

        if (!safetyDecision.downloadAllowed || !args.adapter.downloadAttachment || !providerAttachmentId) {
          const unsupportedMimeReason = !safetyDecision.allowedForAutoDownload ? safetyDecision.reason : null;
          const failureReason = !safetyDecision.downloadAllowed
            ? safetyDecision.reason
            : !args.adapter.downloadAttachment
              ? "Attachment metadata captured; provider download is not available."
              : "Attachment metadata captured; Gmail attachment id is missing.";
          const persisted = await this.persistMetadataOnlyAttachment({
            organizationId: args.organizationId,
            record: args.record,
            existingFile,
            values: {
              inboundLineItemId: null,
              fileRecordId: null,
              sourceFilename: filename,
              role: classification.role === "other" ? "email_attachment" : classification.role,
              mimeType: attachment.mimeType ?? null,
              sizeBytes: attachment.size ?? null,
              checksum: null,
              status: safetyDecision.blocked ? "quarantined" : "uploaded",
              providerAttachmentId,
              providerMessageId,
              contentDisposition,
              metadataJson: {
              ...metadataJson,
              failureReason,
              unsupportedMimeReason,
              gmailApiError: null,
              storageError: null,
              },
              reviewNotes: failureReason,
              createdQuoteAttachmentId: null,
              createdOrderAttachmentId: null,
            },
          });
          rememberFile(persisted);
          diagnostics.attachmentRowsCreated += 1;
          diagnostics.metadataOnlyRowsCreated += 1;
          diagnostics.failures.push({
            filename,
            providerAttachmentId,
            mimeType: attachment.mimeType ?? null,
            failureReason,
            unsupportedMimeReason,
            gmailApiError: null,
            storageError: null,
            metadataOnly: true,
          });
          continue;
        }

        diagnostics.downloadAttempts += 1;
        const downloaded = await args.adapter.downloadAttachment(args.mailbox, args.message, attachment);
        diagnostics.downloadSuccesses += 1;
        const storedStatus = safetyDecision.zipFile ? "quarantined" : "available";
        const storedAttachmentState = safetyDecision.zipFile ? "scan_pending" : "downloaded";
        const storageResult = await this.storageService.finalizeUpload({
          organizationId: args.organizationId,
          createdByUserId: args.actorUserId,
          resource: {
            organizationId: args.organizationId,
            resourceType: "inbound_order",
            resourceId: args.record.id,
          },
          source: {
            kind: "buffer",
            buffer: downloaded.buffer,
            originalFilename: filename,
            mimeType: downloaded.mimeType ?? attachment.mimeType ?? "application/octet-stream",
          },
          persistLink: async (tx, stored) => this.persistStoredAttachment({
            tx,
            organizationId: args.organizationId,
            record: args.record,
            existingFile,
            values: {
              inboundLineItemId: null,
              fileRecordId: stored.fileRecord.id,
              sourceFilename: filename,
              role: classification.role === "other" ? "email_attachment" : classification.role,
              mimeType: downloaded.mimeType ?? attachment.mimeType ?? "application/octet-stream",
              sizeBytes: downloaded.sizeBytes,
              checksum: stored.fileRecord.checksum ?? null,
              status: storedStatus,
              providerAttachmentId,
              providerMessageId,
              contentDisposition,
              metadataJson: {
                ...metadataJson,
                attachmentState: storedAttachmentState,
                storageProvider: stored.storedObject.storageTarget,
              },
              reviewNotes: safetyDecision.zipFile
                ? "ZIP attachment stored from trusted sender. Scanner/manual review is required before use."
                : classification.poCandidate
                  ? "PO candidate. Text will be extracted during AI parse when possible."
                  : classification.artworkCandidate
                    ? "Artwork candidate. No proof or preflight record created."
                    : null,
              createdQuoteAttachmentId: null,
              createdOrderAttachmentId: null,
            },
          }),
        });
        rememberFile(storageResult.linkedRecord);

        await this.inboundRepository.createEvent({
          organizationId: args.organizationId,
          inboundRecordId: args.record.id,
          actorUserId: args.actorUserId,
          actorType: "system",
          eventType: "email.attachment_stored",
          fromStatus: null,
          toStatus: null,
          message: `Stored inbound email attachment ${filename}.`,
          metadataJson: {
            fileId: storageResult.linkedRecord.id,
            fileRecordId: storageResult.fileRecord.id,
            providerAttachmentId,
            providerMessageId,
            role: storageResult.linkedRecord.role,
            createsArtwork: false,
            createsProofs: false,
            createsOrder: false,
          },
        });
        diagnostics.attachmentRowsCreated += 1;
        diagnostics.storedRowsCreated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Attachment download failed.";
        const failureStage = diagnostics.downloadSuccesses >= diagnostics.downloadAttempts ? "storage" : "gmail_api";
        const gmailApiError = failureStage === "gmail_api" ? message : null;
        const storageError = failureStage === "storage" ? message : null;
        console.warn("[Inbound Email Pull] Attachment ingestion failed", {
          organizationId: args.organizationId,
          inboundRecordId: args.record.id,
          messageId: providerMessageId,
          attachmentId: providerAttachmentId,
          filename,
          error: message,
        });
        const persisted = await this.persistMetadataOnlyAttachment({
          organizationId: args.organizationId,
          record: args.record,
          existingFile,
          values: {
            inboundLineItemId: null,
            fileRecordId: null,
            sourceFilename: filename,
            role: classification.role === "other" ? "email_attachment" : classification.role,
            mimeType: attachment.mimeType ?? null,
            sizeBytes: attachment.size ?? null,
            checksum: null,
            status: "quarantined",
            providerAttachmentId,
            providerMessageId,
            contentDisposition,
            metadataJson: {
              ...metadataJson,
              attachmentState: "download_failed",
              downloadFailed: true,
              downloadError: message,
              failureStage,
              gmailApiError,
              storageError,
            },
            reviewNotes: `Attachment download failed: ${message}`,
            createdQuoteAttachmentId: null,
            createdOrderAttachmentId: null,
          },
        });
        rememberFile(persisted);
        diagnostics.attachmentRowsCreated += 1;
        diagnostics.metadataOnlyRowsCreated += 1;
        diagnostics.downloadFailures += 1;
        diagnostics.failures.push({
          filename,
          providerAttachmentId,
          mimeType: attachment.mimeType ?? null,
          failureReason: message,
          gmailApiError,
          storageError,
          unsupportedMimeReason: null,
          metadataOnly: true,
        });
        await this.inboundRepository.createEvent({
          organizationId: args.organizationId,
          inboundRecordId: args.record.id,
          actorUserId: args.actorUserId,
          actorType: "system",
          eventType: "email.attachment_failed",
          fromStatus: null,
          toStatus: null,
          message,
          metadataJson: {
            providerAttachmentId,
            providerMessageId,
            filename,
            failureStage,
            gmailApiError,
            storageError,
          },
        });
      }
    }
    await this.recordAttachmentIngestionDiagnostics({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      record: args.record,
      diagnostics,
    });
    return diagnostics;
  }

  private async classifyAttachmentForIngestion(args: {
    organizationId: string;
    record: InboundOrderRecord;
    attachment: InboundEmailAttachmentMetadata;
    message: InboundEmailProviderMessage;
    actorUserId: string;
  }): Promise<ReturnType<typeof classifyInboundEmailAttachmentForMessage> & {
    matchedClassificationRuleId?: string | null;
  }> {
    const base = classifyInboundEmailAttachmentForMessage(args.attachment, args.message);
    const senderEmail = senderEmailFromMessage(args.message);
    const senderDomain = senderDomainFromMessage(args.message);
    try {
      const customerId = args.record.matchedCustomerId
        ?? await this.inboundRepository.resolveCustomerIdForSender(args.organizationId, senderEmail, senderDomain);
      const rules = await this.inboundRepository.listEnabledAttachmentClassificationRules({
        organizationId: args.organizationId,
        customerId,
        senderDomain,
      });
      const matchingRule = rules
        .slice()
        .sort((left, right) => ruleMatchTypePriority(left.matchType) - ruleMatchTypePriority(right.matchType))
        .find((rule) => attachmentClassificationRuleMatches(rule, args.attachment));
      if (!matchingRule) return base;

      await this.inboundRepository.recordAttachmentClassificationRuleMatch(matchingRule.id);
      await this.inboundRepository.createEvent({
        organizationId: args.organizationId,
        inboundRecordId: args.record.id,
        actorUserId: args.actorUserId,
        actorType: "system",
        eventType: "attachment.classification_rule.matched",
        fromStatus: null,
        toStatus: null,
        message: `Inbound attachment classification rule matched ${args.attachment.filename || "attachment"}.`,
        metadataJson: {
          ruleId: matchingRule.id,
          customerId,
          senderDomain,
          matchType: matchingRule.matchType,
          matchValue: matchingRule.matchValue,
          classification: matchingRule.classification,
          filename: args.attachment.filename,
          mimeType: args.attachment.mimeType,
        },
      });
      return {
        ...classificationFromRule(matchingRule, base),
        matchedClassificationRuleId: matchingRule.id,
      };
    } catch (error) {
      console.warn("[Inbound Email Pull] Attachment classification rule matching failed", {
        organizationId: args.organizationId,
        inboundRecordId: args.record.id,
        messageId: args.message.messageId,
        filename: args.attachment.filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return base;
    }
  }

  private async recordAttachmentIngestionDiagnostics(args: {
    organizationId: string;
    actorUserId: string;
    record: InboundOrderRecord;
    diagnostics: AttachmentIngestionDiagnostics;
  }): Promise<void> {
    await this.inboundRepository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.record.id,
      actorUserId: args.actorUserId,
      actorType: "system",
      eventType: "email.attachment_ingestion_diagnostics",
      fromStatus: null,
      toStatus: null,
      message: args.diagnostics.skippedReason ?? "Inbound email attachment ingestion diagnostics.",
      metadataJson: {
        ...args.diagnostics,
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
        createsProductionJobs: false,
        createsInvoices: false,
        createsFulfillment: false,
        createsPayments: false,
      },
    });
  }

  private async findMatchedIgnoreRule(
    organizationId: string,
    message: InboundEmailProviderMessage,
  ): Promise<InboundEmailIgnoreRule | null> {
    const rules = await this.inboundRepository.listEnabledEmailIgnoreRules(organizationId);
    return rules.find((rule) => matchInboundEmailIgnoreRule(rule, message)) ?? null;
  }

  private async markMailboxPull(
    mailbox: InboundEmailMailbox,
    status: string,
    error: string | null,
    latestPullSummary?: Record<string, unknown> | null,
  ): Promise<void> {
    const settingsJson = isRecord(mailbox.settingsJson) ? mailbox.settingsJson : {};
    await this.dbInstance
      .update(inboundEmailMailboxes)
      .set({
        lastPulledAt: new Date(),
        lastPullStatus: status,
        lastPullError: error,
        settingsJson: latestPullSummary
          ? {
              ...settingsJson,
              latestPullSummary: {
                ...latestPullSummary,
                generatedAt: new Date().toISOString(),
              },
            }
          : settingsJson,
        updatedAt: new Date(),
      })
      .where(eq(inboundEmailMailboxes.id, mailbox.id));
  }
}

export const inboundEmailIngestionService = new InboundEmailIngestionService();
