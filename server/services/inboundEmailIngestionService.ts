import { and, eq } from "drizzle-orm";
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

export type InboundEmailAttachmentMetadata = {
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  attachmentId?: string | null;
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

export interface InboundEmailProviderAdapter {
  listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]>;
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

class GmailInboundEmailAdapter implements InboundEmailProviderAdapter {
  async listRecentMessages(mailbox: InboundEmailMailbox, limit: number): Promise<InboundEmailProviderMessage[]> {
    const authJson = (mailbox.authJson ?? {}) as Record<string, unknown>;
    const settingsJson = (mailbox.settingsJson ?? {}) as Record<string, unknown>;
    const refreshToken = stringFromUnknown(authJson.refreshToken);
    const clientId = stringFromUnknown(authJson.clientId) ?? process.env.GOOGLE_CLIENT_ID ?? null;
    const clientSecret = stringFromUnknown(authJson.clientSecret) ?? process.env.GOOGLE_CLIENT_SECRET ?? null;
    const redirectUri = stringFromUnknown(authJson.redirectUri) ?? process.env.GOOGLE_REDIRECT_URI ?? "urn:ietf:wg:oauth:2.0:oob";
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("Inbound Gmail mailbox is missing OAuth credentials.");
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
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
    let text = "";
    let html = "";
    const attachments: InboundEmailAttachmentMetadata[] = [];

    const visit = (node: any) => {
      if (!node) return;
      const mimeType = String(node.mimeType ?? "");
      const filename = stringFromUnknown(node.filename);
      const body = node.body ?? {};
      if (filename) {
        attachments.push({
          filename,
          mimeType: mimeType || null,
          size: Number.isFinite(Number(body.size)) ? Number(body.size) : null,
          attachmentId: body.attachmentId ? String(body.attachmentId) : null,
        });
      } else if (mimeType === "text/plain") {
        text += decodeBase64Url(body.data);
      } else if (mimeType === "text/html") {
        html += decodeBase64Url(body.data);
      }
      for (const child of node.parts ?? []) visit(child);
    };

    visit(part);
    return { text: text.trim(), html: html.trim(), attachments };
  }
}

export class InboundEmailIngestionService {
  constructor(
    private readonly dbInstance = db,
    private readonly adapterByProvider: Record<string, InboundEmailProviderAdapter> = { gmail: new GmailInboundEmailAdapter() },
    private readonly inboundRepository: InboundOrdersRepository = inboundOrdersRepository,
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
            const outcome = await this.processMessage(args.organizationId, args.actorUserId, mailbox, source, message);
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
    if (existing) return { status: "skippedDuplicates" };

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

    return record ? { status: "created", recordId: record.id } : { status: "skippedDuplicates" };
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
