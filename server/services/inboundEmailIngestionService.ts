import { and, eq, sql } from "drizzle-orm";
import { google } from "googleapis";

import { db } from "../db";
import {
  inboundEmailMailboxes,
  inboundOrderEvents,
  inboundOrderRecords,
  inboundOrderSources,
  type InboundEmailIgnoreRule,
  type InboundEmailMailbox,
  type InboundOrderRecord,
  type InboundOrderSource,
} from "@shared/schema";
import type { InboundEmailIntent, InboundEmailPullResult } from "@shared/inboundEmailIngestion";
import { inboundOrdersRepository, type InboundOrdersRepository } from "../storage/inboundOrders.repo";
import { storageApplicationService, type StorageApplicationService } from "./storage/StorageApplicationService";

export type InboundEmailAttachmentMetadata = {
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  attachmentId?: string | null;
  contentDisposition?: string | null;
  contentId?: string | null;
  partId?: string | null;
  detectedBy?: string[];
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
  subject: string | null;
  receivedAt: Date | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: InboundEmailAttachmentMetadata[];
};

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
};

export interface InboundEmailProviderAdapter {
  listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]>;
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

function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberFromUnknown(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
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

export function classifyInboundEmailForReview(message: InboundEmailProviderMessage): { ignored: boolean; intent: InboundEmailIntent; reason: string } {
  const text = [message.subject, message.bodyText, message.bodyHtml].filter(Boolean).join("\n").slice(0, 20000);
  if (!text.trim()) return { ignored: true, intent: "UNKNOWN", reason: "No subject or body text." };
  if (SPAM_PATTERNS.some((pattern) => pattern.test(text))) {
    return { ignored: true, intent: "UNKNOWN", reason: "Ignored obvious marketing/newsletter email." };
  }

  const quote = QUOTE_PATTERNS.some((pattern) => pattern.test(text));
  const order = ORDER_PATTERNS.some((pattern) => pattern.test(text))
    || message.attachments.some((attachment) => /\bpo\b|purchase.?order/i.test(attachment.filename ?? ""));

  if (order && !quote) return { ignored: false, intent: "ORDER_REQUEST", reason: "Order request language detected." };
  if (quote && !order) return { ignored: false, intent: "QUOTE_REQUEST", reason: "Quote request language detected." };
  if (quote && order) return { ignored: false, intent: "ORDER_REQUEST", reason: "Order and quote language detected; order intent takes review priority." };
  return { ignored: false, intent: "UNKNOWN", reason: "Ambiguous inbound request." };
}

function normalizeAttachmentFileName(value: string | null | undefined): string {
  return String(value ?? "attachment").trim().replace(/[\r\n\t\0]/g, " ").replace(/[\\/]+/g, "_").slice(0, 240) || "attachment";
}

function getExtension(value: string | null | undefined): string {
  const match = String(value ?? "").toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "";
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

export function classifyInboundEmailAttachment(attachment: Pick<InboundEmailAttachmentMetadata, "filename" | "mimeType">): {
  role: "po" | "artwork" | "other";
  poCandidate: boolean;
  artworkCandidate: boolean;
  safeToDownload: boolean;
  reason: string;
} {
  const filename = String(attachment.filename ?? "").toLowerCase();
  const mimeType = String(attachment.mimeType ?? "").toLowerCase();
  const extension = getExtension(filename);
  const poCandidate = (
    (mimeType.includes("pdf") || extension === "pdf")
    && (/\b(?:po|purchase.?order|order)\b/i.test(filename) || /\bpo[-_\s]?\d{3,}\b/i.test(filename))
  );
  const artworkCandidate = (
    ["pdf", "ai", "eps", "svg", "tif", "tiff", "psd", "jpg", "jpeg", "png", "zip"].includes(extension)
    || /^image\//i.test(mimeType)
    || mimeType.includes("pdf")
    || mimeType.includes("zip")
    || mimeType.includes("postscript")
    || mimeType.includes("illustrator")
    || mimeType.includes("svg")
  );
  const textCandidate = /^text\//i.test(mimeType) || ["txt", "csv"].includes(extension);
  const safeToDownload = Boolean(poCandidate || artworkCandidate || textCandidate);
  return {
    role: poCandidate ? "po" : artworkCandidate ? "artwork" : "other",
    poCandidate,
    artworkCandidate,
    safeToDownload,
    reason: poCandidate
      ? "Likely purchase order attachment."
      : artworkCandidate
        ? "Likely artwork/reference attachment."
        : textCandidate
          ? "Text attachment supported for evidence."
          : "Attachment type is not supported for automatic download.",
  };
}

function classifyInboundEmailAttachmentForMessage(
  attachment: InboundEmailAttachmentMetadata,
  message: Pick<InboundEmailProviderMessage, "subject" | "bodyText" | "bodyHtml">,
): ReturnType<typeof classifyInboundEmailAttachment> & { sourceHint: string | null } {
  const sourceHint = detectAttachmentSourceHint(message);
  const base = classifyInboundEmailAttachment(attachment);
  const filename = String(attachment.filename ?? "").toLowerCase();
  const mimeType = String(attachment.mimeType ?? "").toLowerCase();
  const extension = getExtension(filename);
  const isPdf = mimeType.includes("pdf") || extension === "pdf";
  const hintReferencesPo = Boolean(sourceHint && /\bpo\b|purchase.?order/i.test(sourceHint));
  if (!isPdf || !hintReferencesPo || base.poCandidate) {
    return { ...base, sourceHint };
  }
  return {
    ...base,
    role: "po",
    poCandidate: true,
    artworkCandidate: base.artworkCandidate || Boolean(sourceHint && /\bartwork\b/i.test(sourceHint)),
    safeToDownload: true,
    reason: `${base.reason} Email body references ${sourceHint}.`,
    sourceHint,
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

  async listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]> {
    const settingsJson = (mailbox.settingsJson ?? {}) as Record<string, unknown>;
    const gmail = this.buildGmailClient(mailbox);
    const query = stringFromUnknown(settingsJson.query) ?? "newer_than:14d";
    const labelIds = Array.isArray(settingsJson.labelIds)
      ? settingsJson.labelIds.map((value) => String(value)).filter(Boolean)
      : undefined;

    const listed = await gmail.users.messages.list({
      userId: "me",
      maxResults: limit,
      q: query,
      labelIds,
    });
    const messages = listed.data.messages ?? [];
    const results: InboundEmailProviderMessage[] = [];

    for (const summary of messages) {
      if (!summary.id) continue;
      const detail = await gmail.users.messages.get({ userId: "me", id: summary.id, format: "full" });
      results.push(this.toProviderMessage(detail.data));
    }

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
    const requestedLimit = Math.max(1, Math.min(25, Math.round(Number(args.limit ?? 10))));

    for (const mailbox of mailboxes) {
      const mailboxLimit = Math.max(1, Math.min(25, Math.round(numberFromUnknown((mailbox.settingsJson as any)?.maxMessages, requestedLimit))));
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

      try {
        const adapter = this.adapterByProvider[mailbox.provider];
        if (!adapter) throw new Error(`Unsupported inbound email provider: ${mailbox.provider}`);
        const source = await this.ensureSourceForMailbox(mailbox);
        const messages = await adapter.listRecentMessages(mailbox, mailboxLimit);
        for (const message of messages) {
          try {
            const outcome = await this.processMessage(args.organizationId, args.actorUserId, mailbox, source, message, adapter);
            result[outcome.status] += 1;
            summary[outcome.status] += 1;
            if (outcome.status === "created" && outcome.recordId) {
              createdRecordIds.push(outcome.recordId);
            }
          } catch (error) {
            result.failed += 1;
            summary.failed += 1;
            console.error("[Inbound Email Pull] Failed to process message", {
              organizationId: args.organizationId,
              mailboxId: mailbox.id,
              messageId: message.messageId,
              error,
            });
          }
        }
        await this.markMailboxPull(mailbox.id, "success", null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to pull inbound mailbox.";
        result.failed += 1;
        summary.failed += 1;
        result.error = message;
        await this.markMailboxPull(mailbox.id, "failed", message);
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

  private async processMessage(
    organizationId: string,
    actorUserId: string,
    mailbox: InboundEmailMailbox,
    source: InboundOrderSource,
    message: InboundEmailProviderMessage,
    adapter: InboundEmailProviderAdapter,
  ): Promise<{ status: "created"; recordId: string } | { status: "skippedDuplicates" | "ignored"; recordId?: never }> {
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
      return { status: "skippedDuplicates" };
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
      return { status: "ignored" };
    }

    const classification = classifyInboundEmailForReview(message);
    if (classification.ignored) return { status: "ignored" };

    const receivedAt = message.receivedAt ?? new Date();
    const sourceLabel = `TEMP_INBOUND email intake - ${classification.intent}`;
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
      receivedAt: receivedAt.toISOString(),
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      attachments: message.attachments,
      intent: classification.intent,
      intentReason: classification.reason,
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
          externalReference: truncate(message.subject, 255),
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
            sender: {
              name: message.senderName,
              email: message.senderEmail,
            },
            subject: message.subject,
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
            subject: message.subject,
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
      return { status: "skippedDuplicates" };
    }
    await this.ingestAttachments({
      organizationId,
      actorUserId,
      mailbox,
      message,
      record,
      adapter,
      skippedReason: null,
    });
    return { status: "created", recordId: record.id };
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
    const messageProviderAttachmentIds = args.message.attachments.map((attachment) => attachment.attachmentId).filter((value): value is string => Boolean(value));
    const hasMissingProviderAttachment = messageProviderAttachmentIds.some((attachmentId) => !existingProviderAttachmentIds.has(attachmentId));
    const hasAttachmentsWithoutProviderIds = args.message.attachments.some((attachment) => !attachment.attachmentId);
    const shouldBackfill = args.message.attachments.length > 0 && (
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
          attachmentPartsDiscovered: args.message.attachments.length,
          attachmentCandidatesDiscovered: args.message.attachments.length,
          attachmentIdsDiscovered: messageProviderAttachmentIds,
          attachmentPartsAttempted: 0,
          attachmentRowsCreated: 0,
          storedRowsCreated: 0,
          metadataOnlyRowsCreated: 0,
          downloadAttempts: 0,
          downloadSuccesses: 0,
          downloadFailures: 0,
          skippedExistingProviderAttachments: messageProviderAttachmentIds.length,
          skippedReason: args.message.attachments.length === 0
            ? "duplicate_message_no_attachment_parts_discovered"
            : "duplicate_message_existing_files_cover_provider_attachments",
          failures: [],
        },
      });
      return;
    }

    await this.ingestAttachments({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      mailbox: args.mailbox,
      message: args.message,
      record: args.record,
      adapter: args.adapter,
      skippedReason: "duplicate_message_attachment_backfill",
    });
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
    const diagnostics: AttachmentIngestionDiagnostics = {
      messageId: args.message.messageId,
      subject: args.message.subject,
      attachmentPartsDiscovered: args.message.attachments.length,
      attachmentCandidatesDiscovered: args.message.attachments.length,
      attachmentIdsDiscovered: args.message.attachments.map((attachment) => attachment.attachmentId).filter((value): value is string => Boolean(value)),
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
    };
    if (args.message.attachments.length === 0) return diagnostics;

    for (const attachment of args.message.attachments) {
      const providerAttachmentId = attachment.attachmentId ?? null;
      const providerMessageId = args.message.messageId;
      const classification = classifyInboundEmailAttachmentForMessage(attachment, args.message);
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
      };

      try {
        if (providerAttachmentId) {
          const existing = await this.inboundRepository.findFileByProviderAttachment({
            organizationId: args.organizationId,
            inboundRecordId: args.record.id,
            providerMessageId,
            providerAttachmentId,
          });
          if (existing) {
            diagnostics.skippedExistingProviderAttachments += 1;
            continue;
          }
        }

        diagnostics.attachmentPartsAttempted += 1;
        if (!classification.safeToDownload || !args.adapter.downloadAttachment || !providerAttachmentId) {
          const unsupportedMimeReason = classification.safeToDownload ? null : classification.reason;
          const failureReason = !classification.safeToDownload
            ? classification.reason
            : !args.adapter.downloadAttachment
              ? "Attachment metadata captured; provider download is not available."
              : "Attachment metadata captured; Gmail attachment id is missing.";
          await this.inboundRepository.createFile({
            organizationId: args.organizationId,
            inboundRecordId: args.record.id,
            inboundLineItemId: null,
            fileRecordId: null,
            sourceFilename: filename,
            role: classification.role === "other" ? "email_attachment" : classification.role,
            mimeType: attachment.mimeType ?? null,
            sizeBytes: attachment.size ?? null,
            checksum: null,
            status: "uploaded",
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
            reviewNotes: classification.safeToDownload
              ? "Attachment metadata captured; provider download is not available."
              : classification.reason,
            createdQuoteAttachmentId: null,
            createdOrderAttachmentId: null,
          });
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
          persistLink: async (tx, stored) => this.inboundRepository.createFile({
            organizationId: args.organizationId,
            inboundRecordId: args.record.id,
            inboundLineItemId: null,
            fileRecordId: stored.fileRecord.id,
            sourceFilename: filename,
            role: classification.role === "other" ? "email_attachment" : classification.role,
            mimeType: downloaded.mimeType ?? attachment.mimeType ?? "application/octet-stream",
            sizeBytes: downloaded.sizeBytes,
            checksum: stored.fileRecord.checksum ?? null,
            status: "available",
            providerAttachmentId,
            providerMessageId,
            contentDisposition,
            metadataJson: {
              ...metadataJson,
              storageProvider: stored.storedObject.storageTarget,
            },
            reviewNotes: classification.poCandidate
              ? "PO candidate. Text will be extracted during AI parse when possible."
              : classification.artworkCandidate
                ? "Artwork candidate. No proof or preflight record created."
                : null,
            createdQuoteAttachmentId: null,
            createdOrderAttachmentId: null,
          }, tx),
        });

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
        await this.inboundRepository.createFile({
          organizationId: args.organizationId,
          inboundRecordId: args.record.id,
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
            downloadFailed: true,
            downloadError: message,
            failureStage,
            gmailApiError,
            storageError,
          },
          reviewNotes: `Attachment download failed: ${message}`,
          createdQuoteAttachmentId: null,
          createdOrderAttachmentId: null,
        });
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

  private async markMailboxPull(mailboxId: string, status: string, error: string | null): Promise<void> {
    await this.dbInstance
      .update(inboundEmailMailboxes)
      .set({
        lastPulledAt: new Date(),
        lastPullStatus: status,
        lastPullError: error,
        updatedAt: new Date(),
      })
      .where(eq(inboundEmailMailboxes.id, mailboxId));
  }
}

export const inboundEmailIngestionService = new InboundEmailIngestionService();
