import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  customerContactLinks,
  customerContacts,
  customers,
  inboundEmailMailboxes,
  inboundEmailIgnoreRules,
  inboundOrderDecisionFlags,
  inboundOrderEvents,
  inboundOrderFiles,
  inboundOrderLineItems,
  inboundOrderParseAttempts,
  inboundOrderRecords,
  inboundOrderReviewSnapshots,
  inboundOrderSources,
  inboundOrderWarnings,
  materials,
  orderLineItems,
  orders,
  pbv2TreeVersions,
  productVariants,
  products,
  quoteLineItems,
  quoteListNotes,
  quotes,
  type InboundOrderDecisionFlag,
  type InboundOrderEvent,
  type InboundOrderFile,
  type InboundOrderLineItem,
  type InboundOrderParseAttempt,
  type InboundOrderRecord,
  type InboundOrderRecordStatus,
  type InboundOrderReviewSnapshot,
  type InboundOrderSource,
  type InboundOrderSourceType,
  type InboundOrderWarning,
  type InboundEmailIgnoreRule,
  type InboundEmailIgnoreRuleType,
  type Customer,
  type CustomerContact,
  type Product,
  type ProductVariant,
  type Pbv2TreeVersion,
  type Quote,
  type QuoteLineItem,
} from "@shared/schema";
import {
  allocateDocumentNumber,
  isDocumentNumberUniqueViolation,
  toDocumentNumberConflictError,
} from "../services/documentNumberingService";
import {
  buildProductKnowledgeSearchTerms,
  resolveAiParsingDescription,
  scoreProductKnowledgeCandidates,
} from "./inboundProductKnowledgeMatcher";

export type InboundOrderListFilters = {
  status?: InboundOrderRecordStatus;
  statusGroup?: "active" | "needs_review" | "waiting" | "ready" | "converted" | "rejected" | "ignored";
  reviewOutcome?: string;
  sourceType?: InboundOrderSourceType;
  sourceId?: string;
  assignedToUserId?: string;
  hasWarnings?: boolean;
  hasDecisionFlags?: boolean;
  converted?: boolean;
  linkedQuoteStatus?: string;
  search?: string;
  limit: number;
  offset: number;
};

export type InboundOrderQueueSummary = {
  needsReview: number;
  waitingOnCustomer: number;
  readyReviewed: number;
  convertedSubmitted: number;
  rejectedTerminal: number;
  ignored: number;
  withWarnings: number;
};

export type CreateInboundEmailIgnoreRuleValues = {
  organizationId: string;
  ruleType: InboundEmailIgnoreRuleType;
  ruleValue: string;
  notes?: string | null;
  createdByUserId?: string | null;
  enabled?: boolean;
};

export type CreateInboundOrderRecordValues = Omit<
  typeof inboundOrderRecords.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export type CreateInboundOrderEventValues = Omit<
  typeof inboundOrderEvents.$inferInsert,
  "id" | "createdAt"
>;

export type CreateInboundOrderFileValues = Omit<
  typeof inboundOrderFiles.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export type CreateInboundOrderReviewSnapshotValues = Omit<
  typeof inboundOrderReviewSnapshots.$inferInsert,
  "id" | "createdAt"
>;

export type CreateInboundOrderParseAttemptValues = Omit<
  typeof inboundOrderParseAttempts.$inferInsert,
  "id" | "createdAt"
>;

export type UpdateInboundOrderRecordValues = Partial<
  Omit<typeof inboundOrderRecords.$inferInsert, "id" | "organizationId" | "createdAt">
>;

export type InboundQuoteDraftLineInput = {
  sourceLineItemId: string | null;
  productId: string;
  variantId?: string | null;
  productName: string;
  description?: string | null;
  productType?: string | null;
  width: number;
  height: number;
  quantity: number;
  notes?: string | null;
  snapshotJson: Record<string, unknown>;
};

export type InboundQuoteDraftInput = {
  inboundRecordId: string;
  actorUserId: string;
  customerId?: string | null;
  contactId?: string | null;
  customerName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  label: string;
  listLabel: string;
  snapshotId: string;
  snapshotVersion: number;
  lineItems: InboundQuoteDraftLineInput[];
  skippedLineItems: Array<Record<string, unknown>>;
  conversionMetadata: Record<string, unknown>;
};

export type InboundQuoteDraftResult = {
  quote: Quote;
  lineItems: QuoteLineItem[];
  skippedLineItems: Array<Record<string, unknown>>;
};

export type InboundCustomerSearchResult = {
  id: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

export type InboundContactSearchResult = {
  id: string;
  customerId: string | null;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
};

export type InboundProductSearchResult = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  pricingMode: string | null;
  pbv2ActiveTreeVersionId: string | null;
  isActive: boolean;
};

export type InboundCustomerHistoricalContextRow = {
  sourceType: "order" | "quote";
  sourceId: string;
  reference: string | null;
  createdAt: Date | string | null;
  productId: string | null;
  productName: string | null;
  description: string | null;
  width: string | number | null;
  height: string | number | null;
  quantity: number | null;
  specsJson: Record<string, any> | null;
  optionSelectionsJson: any;
  selectedOptions: Array<Record<string, any>> | null;
  materialUsages: Array<Record<string, any>> | null;
  materialUsageJson: Array<Record<string, any>> | null;
};

export type InboundCandidateResult = {
  id: string;
  label: string;
  confidence: number;
  reason: string | null;
  metadata: Record<string, unknown>;
};

export type InboundEmailPullDiagnosticsRaw = {
  mailboxes: Array<{
    id: string;
    provider: string;
    name: string;
    emailAddress: string;
    enabled: boolean;
    isDefault: boolean;
    lastPulledAt: Date | null;
    lastPullStatus: string | null;
    lastPullError: string | null;
    settingsJson: Record<string, unknown>;
  }>;
  ignoreRules: InboundEmailIgnoreRule[];
  recentCreatedRecords: Array<Record<string, unknown>>;
  recentFiles: Array<Record<string, unknown>>;
  recentFailedDiagnostics: Array<Record<string, unknown>>;
  recentIgnoredDiagnostics: Array<Record<string, unknown>>;
  subjectRecords: Array<Record<string, unknown>>;
  subjectFiles: Array<Record<string, unknown>>;
};

export type MatchInboundCustomerInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  customerId: string;
  contactId?: string | null;
  staffNote?: string | null;
};

export type MatchInboundLineItemInput = {
  organizationId: string;
  inboundRecordId: string;
  lineItemId: string;
  actorUserId: string;
  productId: string;
  variantId?: string | null;
  optionSelectionsJson?: Record<string, unknown> | null;
  staffNote?: string | null;
};

export type ResolveInboundWarningInput = {
  organizationId: string;
  inboundRecordId: string;
  warningId: string;
  actorUserId: string;
  status: "resolved" | "ignored";
  resolutionNote?: string | null;
};

export type ResolveInboundDecisionFlagInput = {
  organizationId: string;
  inboundRecordId: string;
  flagId: string;
  actorUserId: string;
  status: "accepted" | "overridden" | "dismissed";
  decisionValueJson?: Record<string, unknown> | null;
  decisionNote?: string | null;
};

export class InboundOrdersRepository {
  constructor(private readonly dbInstance = db) {}

  async transaction<T>(callback: (tx: any, repository: InboundOrdersRepository) => Promise<T>): Promise<T> {
    return this.dbInstance.transaction(async (tx: any) => callback(tx, new InboundOrdersRepository(tx as typeof db)));
  }

  async listInboundOrders(
    organizationId: string,
    filters: InboundOrderListFilters,
  ): Promise<InboundOrderRecord[]> {
    return this.listRecords(organizationId, filters);
  }

  async listRecords(
    organizationId: string,
    filters: InboundOrderListFilters,
  ): Promise<InboundOrderRecord[]> {
    const predicates = [eq(inboundOrderRecords.organizationId, organizationId)];
    let hasExplicitQueueScope = false;

    if (filters.status) {
      hasExplicitQueueScope = true;
      predicates.push(eq(inboundOrderRecords.status, filters.status));
    } else if (filters.statusGroup === "active") {
      hasExplicitQueueScope = true;
      predicates.push(sql`(
        ${inboundOrderRecords.status} in ('received', 'processing', 'needs_review', 'waiting_on_customer', 'ready')
        and coalesce(${inboundOrderRecords.reviewOutcome}, '') <> 'deleted'
        and ${inboundOrderRecords.archivedAt} is null
        and ${inboundOrderRecords.createdQuoteId} is null
        and ${inboundOrderRecords.createdOrderId} is null
      )`);
    } else if (filters.statusGroup === "needs_review") {
      hasExplicitQueueScope = true;
      predicates.push(sql`${inboundOrderRecords.status} in ('received', 'processing', 'needs_review') and coalesce(${inboundOrderRecords.reviewOutcome}, '') <> 'deleted'`);
    } else if (filters.statusGroup === "waiting") {
      hasExplicitQueueScope = true;
      predicates.push(eq(inboundOrderRecords.status, "waiting_on_customer"));
    } else if (filters.statusGroup === "ready") {
      hasExplicitQueueScope = true;
      predicates.push(eq(inboundOrderRecords.status, "ready"));
    } else if (filters.statusGroup === "converted") {
      hasExplicitQueueScope = true;
      predicates.push(sql`(${inboundOrderRecords.createdQuoteId} is not null or ${inboundOrderRecords.createdOrderId} is not null or ${inboundOrderRecords.status} = 'submitted')`);
    } else if (filters.statusGroup === "rejected") {
      hasExplicitQueueScope = true;
      predicates.push(sql`(
        (${inboundOrderRecords.status} = 'terminal' or ${inboundOrderRecords.reviewOutcome} = 'rejected')
        and coalesce(${inboundOrderRecords.reviewOutcome}, '') <> 'deleted'
      )`);
    } else if (filters.statusGroup === "ignored") {
      hasExplicitQueueScope = true;
      predicates.push(sql`(${inboundOrderRecords.status} = 'ignored' or ${inboundOrderRecords.reviewOutcome} = 'ignored')`);
    }

    if (!hasExplicitQueueScope && filters.converted !== true && !filters.reviewOutcome) {
      predicates.push(sql`(
        ${inboundOrderRecords.status} in ('received', 'processing', 'needs_review', 'waiting_on_customer', 'ready')
        and coalesce(${inboundOrderRecords.reviewOutcome}, '') <> 'deleted'
        and ${inboundOrderRecords.archivedAt} is null
        and ${inboundOrderRecords.createdQuoteId} is null
        and ${inboundOrderRecords.createdOrderId} is null
      )`);
    }

    if (filters.reviewOutcome) {
      predicates.push(eq(inboundOrderRecords.reviewOutcome, filters.reviewOutcome));
    }

    if (filters.sourceType) {
      predicates.push(eq(inboundOrderRecords.sourceType, filters.sourceType));
    }

    if (filters.sourceId) {
      predicates.push(eq(inboundOrderRecords.sourceId, filters.sourceId));
    }

    if (filters.assignedToUserId) {
      predicates.push(eq(inboundOrderRecords.assignedToUserId, filters.assignedToUserId));
    }

    if (filters.hasWarnings === true) {
      predicates.push(sql`exists (
        select 1 from ${inboundOrderWarnings}
        where ${inboundOrderWarnings.organizationId} = ${organizationId}
          and ${inboundOrderWarnings.inboundRecordId} = ${inboundOrderRecords.id}
      )`);
    }

    if (filters.hasDecisionFlags === true) {
      predicates.push(sql`exists (
        select 1 from ${inboundOrderDecisionFlags}
        where ${inboundOrderDecisionFlags.organizationId} = ${organizationId}
          and ${inboundOrderDecisionFlags.inboundRecordId} = ${inboundOrderRecords.id}
      )`);
    }

    if (filters.converted === true) {
      predicates.push(sql`(${inboundOrderRecords.createdQuoteId} is not null or ${inboundOrderRecords.createdOrderId} is not null)`);
    } else if (filters.converted === false) {
      predicates.push(sql`${inboundOrderRecords.createdQuoteId} is null and ${inboundOrderRecords.createdOrderId} is null`);
    }

    if (filters.linkedQuoteStatus) {
      predicates.push(sql`exists (
        select 1 from ${quotes}
        where ${quotes.organizationId} = ${organizationId}
          and ${quotes.id} = ${inboundOrderRecords.createdQuoteId}
          and ${quotes.status} = ${filters.linkedQuoteStatus}
      )`);
    }

    if (filters.search) {
      const pattern = `%${filters.search}%`;
      predicates.push(sql`(
        ${inboundOrderRecords.externalReference} ilike ${pattern}
        or ${inboundOrderRecords.sourceLabel} ilike ${pattern}
        or ${inboundOrderRecords.reviewRequiredReason} ilike ${pattern}
        or ${inboundOrderRecords.rawPayloadJson}::text ilike ${pattern}
        or ${inboundOrderRecords.normalizedPayloadJson}::text ilike ${pattern}
        or ${inboundOrderRecords.extractedCustomerJson}::text ilike ${pattern}
        or ${inboundOrderRecords.extractedOrderJson}::text ilike ${pattern}
      )`);
    }

    return this.dbInstance
      .select()
      .from(inboundOrderRecords)
      .where(and(...predicates))
      .orderBy(desc(inboundOrderRecords.receivedAt), desc(inboundOrderRecords.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);
  }

  async getInboundOrderCounts(organizationId: string): Promise<InboundOrderQueueSummary> {
    return this.getQueueSummary(organizationId);
  }

  async getQueueSummary(organizationId: string): Promise<InboundOrderQueueSummary> {
    const [summary] = await this.dbInstance
      .select({
        needsReview: sql<number>`count(*) filter (where ${inboundOrderRecords.status} in ('received', 'processing', 'needs_review'))`,
        waitingOnCustomer: sql<number>`count(*) filter (where ${inboundOrderRecords.status} = 'waiting_on_customer')`,
        readyReviewed: sql<number>`count(*) filter (where ${inboundOrderRecords.status} = 'ready')`,
        convertedSubmitted: sql<number>`count(*) filter (where ${inboundOrderRecords.createdQuoteId} is not null or ${inboundOrderRecords.createdOrderId} is not null or ${inboundOrderRecords.status} = 'submitted')`,
        rejectedTerminal: sql<number>`count(*) filter (where (${inboundOrderRecords.status} = 'terminal' or ${inboundOrderRecords.reviewOutcome} = 'rejected') and coalesce(${inboundOrderRecords.reviewOutcome}, '') <> 'deleted')`,
        ignored: sql<number>`count(*) filter (where ${inboundOrderRecords.status} = 'ignored' or ${inboundOrderRecords.reviewOutcome} = 'ignored')`,
        withWarnings: sql<number>`count(*) filter (where exists (
          select 1 from ${inboundOrderWarnings}
          where ${inboundOrderWarnings.organizationId} = ${organizationId}
            and ${inboundOrderWarnings.inboundRecordId} = ${inboundOrderRecords.id}
        ))`,
      })
      .from(inboundOrderRecords)
      .where(eq(inboundOrderRecords.organizationId, organizationId));

    return {
      needsReview: Number(summary?.needsReview ?? 0),
      waitingOnCustomer: Number(summary?.waitingOnCustomer ?? 0),
      readyReviewed: Number(summary?.readyReviewed ?? 0),
      convertedSubmitted: Number(summary?.convertedSubmitted ?? 0),
      rejectedTerminal: Number(summary?.rejectedTerminal ?? 0),
      ignored: Number(summary?.ignored ?? 0),
      withWarnings: Number(summary?.withWarnings ?? 0),
    };
  }

  async listEmailIgnoreRules(organizationId: string): Promise<InboundEmailIgnoreRule[]> {
    return this.dbInstance
      .select()
      .from(inboundEmailIgnoreRules)
      .where(eq(inboundEmailIgnoreRules.organizationId, organizationId))
      .orderBy(desc(inboundEmailIgnoreRules.enabled), asc(inboundEmailIgnoreRules.ruleType), asc(inboundEmailIgnoreRules.ruleValue));
  }

  async listEnabledEmailIgnoreRules(organizationId: string): Promise<InboundEmailIgnoreRule[]> {
    return this.dbInstance
      .select()
      .from(inboundEmailIgnoreRules)
      .where(and(eq(inboundEmailIgnoreRules.organizationId, organizationId), eq(inboundEmailIgnoreRules.enabled, true)))
      .orderBy(asc(inboundEmailIgnoreRules.ruleType), asc(inboundEmailIgnoreRules.ruleValue));
  }

  async getEmailIgnoreRuleByTypeValue(args: {
    organizationId: string;
    ruleType: InboundEmailIgnoreRuleType;
    ruleValue: string;
  }): Promise<InboundEmailIgnoreRule | null> {
    const [rule] = await this.dbInstance
      .select()
      .from(inboundEmailIgnoreRules)
      .where(and(
        eq(inboundEmailIgnoreRules.organizationId, args.organizationId),
        eq(inboundEmailIgnoreRules.ruleType, args.ruleType),
        eq(inboundEmailIgnoreRules.ruleValue, args.ruleValue),
      ))
      .limit(1);
    return rule ?? null;
  }

  async createEmailIgnoreRule(values: CreateInboundEmailIgnoreRuleValues): Promise<InboundEmailIgnoreRule> {
    const ruleValue = values.ruleValue.trim();
    const [created] = await this.dbInstance
      .insert(inboundEmailIgnoreRules)
      .values({
        organizationId: values.organizationId,
        enabled: values.enabled ?? true,
        ruleType: values.ruleType,
        ruleValue,
        notes: values.notes ?? null,
        createdByUserId: values.createdByUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          inboundEmailIgnoreRules.organizationId,
          inboundEmailIgnoreRules.ruleType,
          inboundEmailIgnoreRules.ruleValue,
        ],
        set: {
          enabled: values.enabled ?? true,
          notes: values.notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!created) throw new Error("Failed to create inbound email ignore rule");
    return created;
  }

  async updateEmailIgnoreRule(args: {
    organizationId: string;
    id: string;
    ruleType?: InboundEmailIgnoreRuleType;
    ruleValue?: string;
    enabled?: boolean;
    notes?: string | null;
  }): Promise<InboundEmailIgnoreRule | null> {
    const patch: Partial<typeof inboundEmailIgnoreRules.$inferInsert> = { updatedAt: new Date() };
    if (args.ruleType) patch.ruleType = args.ruleType;
    if (typeof args.ruleValue === "string") patch.ruleValue = args.ruleValue.trim();
    if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
    if ("notes" in args) patch.notes = args.notes ?? null;

    const [updated] = await this.dbInstance
      .update(inboundEmailIgnoreRules)
      .set(patch)
      .where(and(eq(inboundEmailIgnoreRules.organizationId, args.organizationId), eq(inboundEmailIgnoreRules.id, args.id)))
      .returning();
    return updated ?? null;
  }

  async deleteEmailIgnoreRule(organizationId: string, id: string): Promise<InboundEmailIgnoreRule | null> {
    const [deleted] = await this.dbInstance
      .delete(inboundEmailIgnoreRules)
      .where(and(eq(inboundEmailIgnoreRules.organizationId, organizationId), eq(inboundEmailIgnoreRules.id, id)))
      .returning();
    return deleted ?? null;
  }

  async recordEmailIgnoreRuleMatch(ruleId: string): Promise<void> {
    await this.dbInstance
      .update(inboundEmailIgnoreRules)
      .set({
        matchCount: sql`${inboundEmailIgnoreRules.matchCount} + 1`,
        lastMatchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inboundEmailIgnoreRules.id, ruleId));
  }

  async getEmailPullDiagnostics(args: {
    organizationId: string;
    subject?: string | null;
    limit?: number;
  }): Promise<InboundEmailPullDiagnosticsRaw> {
    const limit = Math.max(1, Math.min(50, Math.round(Number(args.limit ?? 20))));
    const subject = args.subject?.trim() || null;
    const subjectPattern = subject ? `%${subject}%` : null;

    const mailboxes = await this.dbInstance
      .select({
        id: inboundEmailMailboxes.id,
        provider: inboundEmailMailboxes.provider,
        name: inboundEmailMailboxes.name,
        emailAddress: inboundEmailMailboxes.emailAddress,
        enabled: inboundEmailMailboxes.enabled,
        isDefault: inboundEmailMailboxes.isDefault,
        lastPulledAt: inboundEmailMailboxes.lastPulledAt,
        lastPullStatus: inboundEmailMailboxes.lastPullStatus,
        lastPullError: inboundEmailMailboxes.lastPullError,
        settingsJson: inboundEmailMailboxes.settingsJson,
      })
      .from(inboundEmailMailboxes)
      .where(eq(inboundEmailMailboxes.organizationId, args.organizationId))
      .orderBy(desc(inboundEmailMailboxes.enabled), asc(inboundEmailMailboxes.emailAddress));

    const ignoreRules = await this.listEmailIgnoreRules(args.organizationId);

    const recentCreatedRecords = await this.dbInstance
      .select({
        id: inboundOrderRecords.id,
        sourceId: inboundOrderRecords.sourceId,
        sourceRecordId: inboundOrderRecords.sourceRecordId,
        sourceMessageId: inboundOrderRecords.sourceMessageId,
        status: inboundOrderRecords.status,
        reviewOutcome: inboundOrderRecords.reviewOutcome,
        externalReference: inboundOrderRecords.externalReference,
        idempotencyKey: inboundOrderRecords.idempotencyKey,
        receivedAt: inboundOrderRecords.receivedAt,
        archivedAt: inboundOrderRecords.archivedAt,
        createdAt: inboundOrderRecords.createdAt,
        subject: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->>'subject', ${inboundOrderRecords.normalizedPayloadJson}->>'subject', ${inboundOrderRecords.extractedOrderJson}->>'subject', ${inboundOrderRecords.externalReference})`,
        senderEmail: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'sender'->>'email', ${inboundOrderRecords.normalizedPayloadJson}->'sender'->>'email')`,
        mailboxEmail: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'mailbox'->>'emailAddress', ${inboundOrderRecords.normalizedPayloadJson}->'source'->>'mailboxEmail')`,
      })
      .from(inboundOrderRecords)
      .where(and(eq(inboundOrderRecords.organizationId, args.organizationId), eq(inboundOrderRecords.sourceType, "email")))
      .orderBy(desc(inboundOrderRecords.createdAt))
      .limit(limit);

    const recentFiles = await this.dbInstance
      .select({
        id: inboundOrderFiles.id,
        inboundRecordId: inboundOrderFiles.inboundRecordId,
        fileRecordId: inboundOrderFiles.fileRecordId,
        sourceFilename: inboundOrderFiles.sourceFilename,
        role: inboundOrderFiles.role,
        mimeType: inboundOrderFiles.mimeType,
        sizeBytes: inboundOrderFiles.sizeBytes,
        status: inboundOrderFiles.status,
        providerAttachmentId: inboundOrderFiles.providerAttachmentId,
        providerMessageId: inboundOrderFiles.providerMessageId,
        metadataJson: inboundOrderFiles.metadataJson,
        reviewNotes: inboundOrderFiles.reviewNotes,
        createdAt: inboundOrderFiles.createdAt,
      })
      .from(inboundOrderFiles)
      .innerJoin(inboundOrderRecords, eq(inboundOrderFiles.inboundRecordId, inboundOrderRecords.id))
      .where(and(eq(inboundOrderFiles.organizationId, args.organizationId), eq(inboundOrderRecords.sourceType, "email")))
      .orderBy(desc(inboundOrderFiles.createdAt))
      .limit(limit);

    const recentFailedDiagnostics = await this.dbInstance
      .select({
        eventId: inboundOrderEvents.id,
        inboundRecordId: inboundOrderEvents.inboundRecordId,
        eventType: inboundOrderEvents.eventType,
        message: inboundOrderEvents.message,
        metadataJson: inboundOrderEvents.metadataJson,
        createdAt: inboundOrderEvents.createdAt,
      })
      .from(inboundOrderEvents)
      .innerJoin(inboundOrderRecords, eq(inboundOrderEvents.inboundRecordId, inboundOrderRecords.id))
      .where(and(
        eq(inboundOrderEvents.organizationId, args.organizationId),
        eq(inboundOrderRecords.sourceType, "email"),
        sql`${inboundOrderEvents.eventType} in ('email.attachment_failed')`,
      ))
      .orderBy(desc(inboundOrderEvents.createdAt))
      .limit(limit);

    const recentIgnoredDiagnostics = await this.dbInstance
      .select({
        id: inboundOrderRecords.id,
        sourceRecordId: inboundOrderRecords.sourceRecordId,
        sourceMessageId: inboundOrderRecords.sourceMessageId,
        status: inboundOrderRecords.status,
        reviewOutcome: inboundOrderRecords.reviewOutcome,
        externalReference: inboundOrderRecords.externalReference,
        receivedAt: inboundOrderRecords.receivedAt,
        archivedAt: inboundOrderRecords.archivedAt,
        createdAt: inboundOrderRecords.createdAt,
        subject: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->>'subject', ${inboundOrderRecords.normalizedPayloadJson}->>'subject', ${inboundOrderRecords.extractedOrderJson}->>'subject', ${inboundOrderRecords.externalReference})`,
      })
      .from(inboundOrderRecords)
      .where(and(
        eq(inboundOrderRecords.organizationId, args.organizationId),
        eq(inboundOrderRecords.sourceType, "email"),
        sql`(${inboundOrderRecords.status} = 'ignored' or ${inboundOrderRecords.reviewOutcome} = 'ignored')`,
      ))
      .orderBy(desc(inboundOrderRecords.createdAt))
      .limit(limit);

    const subjectRecords = subjectPattern
      ? await this.dbInstance
        .select({
          id: inboundOrderRecords.id,
          sourceId: inboundOrderRecords.sourceId,
          sourceRecordId: inboundOrderRecords.sourceRecordId,
          sourceMessageId: inboundOrderRecords.sourceMessageId,
          status: inboundOrderRecords.status,
          reviewOutcome: inboundOrderRecords.reviewOutcome,
          externalReference: inboundOrderRecords.externalReference,
          idempotencyKey: inboundOrderRecords.idempotencyKey,
          payloadHash: inboundOrderRecords.payloadHash,
          duplicateScore: inboundOrderRecords.duplicateScore,
          receivedAt: inboundOrderRecords.receivedAt,
          archivedAt: inboundOrderRecords.archivedAt,
          createdAt: inboundOrderRecords.createdAt,
          subject: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->>'subject', ${inboundOrderRecords.normalizedPayloadJson}->>'subject', ${inboundOrderRecords.extractedOrderJson}->>'subject', ${inboundOrderRecords.externalReference})`,
          senderEmail: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'sender'->>'email', ${inboundOrderRecords.normalizedPayloadJson}->'sender'->>'email')`,
          mailboxEmail: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->'mailbox'->>'emailAddress', ${inboundOrderRecords.normalizedPayloadJson}->'source'->>'mailboxEmail')`,
        })
        .from(inboundOrderRecords)
        .where(and(
          eq(inboundOrderRecords.organizationId, args.organizationId),
          eq(inboundOrderRecords.sourceType, "email"),
          sql`(
            ${inboundOrderRecords.externalReference} ilike ${subjectPattern}
            or ${inboundOrderRecords.sourceLabel} ilike ${subjectPattern}
            or ${inboundOrderRecords.sourceRecordId} ilike ${subjectPattern}
            or ${inboundOrderRecords.sourceMessageId} ilike ${subjectPattern}
            or ${inboundOrderRecords.rawPayloadJson}::text ilike ${subjectPattern}
            or ${inboundOrderRecords.normalizedPayloadJson}::text ilike ${subjectPattern}
            or ${inboundOrderRecords.extractedOrderJson}::text ilike ${subjectPattern}
          )`,
        ))
        .orderBy(desc(inboundOrderRecords.createdAt))
        .limit(limit)
      : [];

    const subjectFiles = subjectPattern
      ? await this.dbInstance
        .select({
          id: inboundOrderFiles.id,
          inboundRecordId: inboundOrderFiles.inboundRecordId,
          sourceFilename: inboundOrderFiles.sourceFilename,
          role: inboundOrderFiles.role,
          mimeType: inboundOrderFiles.mimeType,
          sizeBytes: inboundOrderFiles.sizeBytes,
          status: inboundOrderFiles.status,
          providerAttachmentId: inboundOrderFiles.providerAttachmentId,
          providerMessageId: inboundOrderFiles.providerMessageId,
          metadataJson: inboundOrderFiles.metadataJson,
          reviewNotes: inboundOrderFiles.reviewNotes,
          createdAt: inboundOrderFiles.createdAt,
          recordSubject: sql<string | null>`coalesce(${inboundOrderRecords.rawPayloadJson}->>'subject', ${inboundOrderRecords.normalizedPayloadJson}->>'subject', ${inboundOrderRecords.extractedOrderJson}->>'subject', ${inboundOrderRecords.externalReference})`,
        })
        .from(inboundOrderFiles)
        .innerJoin(inboundOrderRecords, eq(inboundOrderFiles.inboundRecordId, inboundOrderRecords.id))
        .where(and(
          eq(inboundOrderFiles.organizationId, args.organizationId),
          eq(inboundOrderRecords.sourceType, "email"),
          sql`(
            ${inboundOrderFiles.sourceFilename} ilike ${subjectPattern}
            or ${inboundOrderFiles.providerMessageId} ilike ${subjectPattern}
            or ${inboundOrderFiles.providerAttachmentId} ilike ${subjectPattern}
            or ${inboundOrderFiles.reviewNotes} ilike ${subjectPattern}
            or ${inboundOrderFiles.metadataJson}::text ilike ${subjectPattern}
            or ${inboundOrderRecords.externalReference} ilike ${subjectPattern}
            or ${inboundOrderRecords.rawPayloadJson}::text ilike ${subjectPattern}
            or ${inboundOrderRecords.normalizedPayloadJson}::text ilike ${subjectPattern}
          )`,
        ))
        .orderBy(desc(inboundOrderFiles.createdAt))
        .limit(limit)
      : [];

    return {
      mailboxes,
      ignoreRules,
      recentCreatedRecords,
      recentFiles,
      recentFailedDiagnostics,
      recentIgnoredDiagnostics,
      subjectRecords,
      subjectFiles,
    };
  }

  async getInboundOrder(organizationId: string, inboundRecordId: string): Promise<InboundOrderRecord | null> {
    return this.getRecord(organizationId, inboundRecordId);
  }

  async getRecord(organizationId: string, inboundRecordId: string): Promise<InboundOrderRecord | null> {
    const [record] = await this.dbInstance
      .select()
      .from(inboundOrderRecords)
      .where(
        and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.id, inboundRecordId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  async getSource(organizationId: string, sourceId: string): Promise<InboundOrderSource | null> {
    const [source] = await this.dbInstance
      .select()
      .from(inboundOrderSources)
      .where(
        and(
          eq(inboundOrderSources.organizationId, organizationId),
          eq(inboundOrderSources.id, sourceId),
        ),
      )
      .limit(1);

    return source ?? null;
  }

  async listLineItems(organizationId: string, inboundRecordId: string): Promise<InboundOrderLineItem[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderLineItems)
      .where(
        and(
          eq(inboundOrderLineItems.organizationId, organizationId),
          eq(inboundOrderLineItems.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderLineItems.sortOrder), asc(inboundOrderLineItems.createdAt));
  }

  async listFiles(organizationId: string, inboundRecordId: string): Promise<InboundOrderFile[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderFiles)
      .where(
        and(
          eq(inboundOrderFiles.organizationId, organizationId),
          eq(inboundOrderFiles.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderFiles.createdAt));
  }

  async findFileByProviderAttachment(args: {
    organizationId: string;
    inboundRecordId: string;
    providerMessageId: string;
    providerAttachmentId: string;
  }): Promise<InboundOrderFile | null> {
    const [file] = await this.dbInstance
      .select()
      .from(inboundOrderFiles)
      .where(and(
        eq(inboundOrderFiles.organizationId, args.organizationId),
        eq(inboundOrderFiles.inboundRecordId, args.inboundRecordId),
        eq(inboundOrderFiles.providerMessageId, args.providerMessageId),
        eq(inboundOrderFiles.providerAttachmentId, args.providerAttachmentId),
      ))
      .limit(1);
    return file ?? null;
  }

  async createFile(values: CreateInboundOrderFileValues, executor: any = this.dbInstance): Promise<InboundOrderFile> {
    const [created] = await executor
      .insert(inboundOrderFiles)
      .values(values)
      .returning();
    if (!created) throw new Error("Failed to create inbound order file");
    return created;
  }

  async listWarnings(organizationId: string, inboundRecordId: string): Promise<InboundOrderWarning[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderWarnings)
      .where(
        and(
          eq(inboundOrderWarnings.organizationId, organizationId),
          eq(inboundOrderWarnings.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(
        sql`case ${inboundOrderWarnings.severity}
          when 'blocking' then 0
          when 'warning' then 1
          when 'info' then 2
          else 3
        end`,
        asc(inboundOrderWarnings.createdAt),
      );
  }

  async listDecisionFlags(organizationId: string, inboundRecordId: string): Promise<InboundOrderDecisionFlag[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderDecisionFlags)
      .where(
        and(
          eq(inboundOrderDecisionFlags.organizationId, organizationId),
          eq(inboundOrderDecisionFlags.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(
        sql`case ${inboundOrderDecisionFlags.status}
          when 'open' then 0
          when 'accepted' then 1
          when 'overridden' then 2
          when 'dismissed' then 3
          else 4
        end`,
        asc(inboundOrderDecisionFlags.createdAt),
      );
  }

  async listEvents(organizationId: string, inboundRecordId: string): Promise<InboundOrderEvent[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderEvents)
      .where(
        and(
          eq(inboundOrderEvents.organizationId, organizationId),
          eq(inboundOrderEvents.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(desc(inboundOrderEvents.createdAt));
  }

  async listReviewSnapshots(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<InboundOrderReviewSnapshot[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderReviewSnapshots)
      .where(
        and(
          eq(inboundOrderReviewSnapshots.organizationId, organizationId),
          eq(inboundOrderReviewSnapshots.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(desc(inboundOrderReviewSnapshots.createdAt));
  }

  async getLatestReviewSnapshot(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<InboundOrderReviewSnapshot | null> {
    const [snapshot] = await this.dbInstance
      .select()
      .from(inboundOrderReviewSnapshots)
      .where(
        and(
          eq(inboundOrderReviewSnapshots.organizationId, organizationId),
          eq(inboundOrderReviewSnapshots.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(desc(inboundOrderReviewSnapshots.createdAt))
      .limit(1);

    return snapshot ?? null;
  }

  async listParseAttempts(organizationId: string, inboundRecordId: string): Promise<InboundOrderParseAttempt[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderParseAttempts)
      .where(
        and(
          eq(inboundOrderParseAttempts.organizationId, organizationId),
          eq(inboundOrderParseAttempts.inboundOrderRecordId, inboundRecordId),
        ),
      )
      .orderBy(desc(inboundOrderParseAttempts.createdAt));
  }

  async getLatestParseAttempt(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<InboundOrderParseAttempt | null> {
    const [attempt] = await this.dbInstance
      .select()
      .from(inboundOrderParseAttempts)
      .where(
        and(
          eq(inboundOrderParseAttempts.organizationId, organizationId),
          eq(inboundOrderParseAttempts.inboundOrderRecordId, inboundRecordId),
        ),
      )
      .orderBy(desc(inboundOrderParseAttempts.createdAt))
      .limit(1);

    return attempt ?? null;
  }

  async createParseAttempt(values: CreateInboundOrderParseAttemptValues): Promise<InboundOrderParseAttempt> {
    const [attempt] = await this.dbInstance
      .insert(inboundOrderParseAttempts)
      .values(values)
      .returning();

    if (!attempt) {
      throw new Error("Failed to create inbound order parse attempt");
    }

    return attempt;
  }

  async getQuote(organizationId: string, quoteId: string): Promise<Quote | null> {
    const [quote] = await this.dbInstance
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.organizationId, organizationId),
          eq(quotes.id, quoteId),
        ),
      )
      .limit(1);

    return quote ?? null;
  }

  async searchCustomers(organizationId: string, search: string | null, limit: number): Promise<InboundCustomerSearchResult[]> {
    const predicates = [eq(customers.organizationId, organizationId)];
    const trimmed = search?.trim();

    if (trimmed) {
      const pattern = `%${trimmed}%`;
      predicates.push(sql`(
        ${customers.companyName} ilike ${pattern}
        or ${customers.email} ilike ${pattern}
        or ${customers.phone} ilike ${pattern}
        or ${customers.notes} ilike ${pattern}
        or exists (
          select 1 from ${customerContacts}
          where ${customerContacts.customerId} = ${customers.id}
            and (
              ${customerContacts.firstName} ilike ${pattern}
              or ${customerContacts.lastName} ilike ${pattern}
              or ${customerContacts.email} ilike ${pattern}
              or ${customerContacts.phone} ilike ${pattern}
              or ${customerContacts.mobile} ilike ${pattern}
            )
        )
      )`);
    }

    return this.dbInstance
      .select({
        id: customers.id,
        companyName: customers.companyName,
        email: customers.email,
        phone: customers.phone,
        status: customers.status,
      })
      .from(customers)
      .where(and(...predicates))
      .orderBy(asc(customers.companyName), asc(customers.createdAt))
      .limit(limit);
  }

  async searchCustomerContacts(
    organizationId: string,
    customerId: string | null,
    search: string | null,
    limit: number,
  ): Promise<InboundContactSearchResult[]> {
    const predicates = [
      eq(customers.organizationId, organizationId),
      eq(customerContactLinks.status, "active"),
    ];
    if (customerId) predicates.push(eq(customerContactLinks.customerId, customerId));
    const trimmed = search?.trim();

    if (trimmed) {
      const pattern = `%${trimmed}%`;
      predicates.push(sql`(
        ${customerContacts.firstName} ilike ${pattern}
        or ${customerContacts.lastName} ilike ${pattern}
        or ${customerContacts.email} ilike ${pattern}
        or ${customerContacts.phone} ilike ${pattern}
        or ${customerContacts.mobile} ilike ${pattern}
      )`);
    }

    return this.dbInstance
      .select({
        id: customerContacts.id,
        customerId: customerContactLinks.customerId,
        firstName: customerContacts.firstName,
        lastName: customerContacts.lastName,
        name: sql<string>`trim(${customerContacts.firstName} || ' ' || ${customerContacts.lastName})`,
        email: customerContacts.email,
        phone: customerContacts.phone,
        mobile: customerContacts.mobile,
        isPrimary: customerContactLinks.isPrimary,
      })
      .from(customerContactLinks)
      .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
      .innerJoin(customers, eq(customerContactLinks.customerId, customers.id))
      .where(and(...predicates))
      .orderBy(sql`case when ${customerContactLinks.isPrimary} then 0 else 1 end`, asc(customerContacts.lastName), asc(customerContacts.firstName))
      .limit(limit);
  }

  async searchActiveProducts(
    organizationId: string,
    search: string | null,
    limit: number,
  ): Promise<InboundProductSearchResult[]> {
    const predicates = [
      eq(products.organizationId, organizationId),
      eq(products.isActive, true),
    ];
    const trimmed = search?.trim();

    if (trimmed) {
      const pattern = `%${trimmed}%`;
      predicates.push(sql`(
        ${products.name} ilike ${pattern}
        or ${products.description} ilike ${pattern}
        or ${products.category} ilike ${pattern}
        or ${products.aiParsingDescription} ilike ${pattern}
      )`);
    }

    return this.dbInstance
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        category: products.category,
        pricingMode: products.pricingMode,
        pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
        isActive: products.isActive,
      })
      .from(products)
      .where(and(...predicates))
      .orderBy(asc(products.name), asc(products.createdAt))
      .limit(limit);
  }

  async getCustomer(organizationId: string, customerId: string): Promise<Customer | null> {
    const [customer] = await this.dbInstance
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
      .limit(1);

    return customer ?? null;
  }

  async getContactForCustomer(
    organizationId: string,
    customerId: string,
    contactId: string,
  ): Promise<CustomerContact | null> {
    const [contact] = await this.dbInstance
      .select({
        id: customerContacts.id,
        customerId: customerContactLinks.customerId,
        organizationId: customerContacts.organizationId,
        firstName: customerContacts.firstName,
        lastName: customerContacts.lastName,
        title: customerContacts.title,
        email: customerContacts.email,
        phone: customerContacts.phone,
        mobile: customerContacts.mobile,
        isPrimary: customerContactLinks.isPrimary,
        status: customerContacts.status,
        street1: customerContacts.street1,
        street2: customerContacts.street2,
        city: customerContacts.city,
        state: customerContacts.state,
        postalCode: customerContacts.postalCode,
        country: customerContacts.country,
        externalSource: customerContacts.externalSource,
        externalSourceId: customerContacts.externalSourceId,
        externalSourceType: customerContacts.externalSourceType,
        internalNotes: customerContacts.internalNotes,
        flags: customerContacts.flags,
        createdAt: customerContacts.createdAt,
        updatedAt: customerContacts.updatedAt,
      })
      .from(customerContactLinks)
      .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
      .innerJoin(customers, eq(customerContactLinks.customerId, customers.id))
      .where(
        and(
          eq(customers.organizationId, organizationId),
          eq(customerContactLinks.customerId, customerId),
          eq(customerContactLinks.status, "active"),
          eq(customerContacts.id, contactId),
        ),
      )
      .limit(1);

    return contact ?? null;
  }

  async getProduct(organizationId: string, productId: string): Promise<Product | null> {
    const [product] = await this.dbInstance
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
      .limit(1);

    return product ?? null;
  }

  async getProductVariantForProduct(productId: string, variantId: string): Promise<ProductVariant | null> {
    const [variant] = await this.dbInstance
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.id, variantId)))
      .limit(1);

    return variant ?? null;
  }

  async createEvent(event: CreateInboundOrderEventValues): Promise<InboundOrderEvent> {
    const [created] = await this.dbInstance
      .insert(inboundOrderEvents)
      .values(event)
      .returning();

    if (!created) {
      throw new Error("Failed to create inbound order event");
    }

    return created;
  }

  async matchLineItemProductWithEvent(args: MatchInboundLineItemInput & {
    productName: string;
    variantName?: string | null;
  }): Promise<InboundOrderLineItem | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [lineItem] = await tx
        .update(inboundOrderLineItems)
        .set({
          productId: args.productId,
          variantId: args.variantId ?? null,
          optionSelectionsJson: args.optionSelectionsJson ?? {},
          status: "validated",
          reviewedByUserId: args.actorUserId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboundOrderLineItems.organizationId, args.organizationId),
            eq(inboundOrderLineItems.inboundRecordId, args.inboundRecordId),
            eq(inboundOrderLineItems.id, args.lineItemId),
          ),
        )
        .returning();

      if (!lineItem) return null;

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.line_item_matched",
        fromStatus: null,
        toStatus: null,
        message: args.staffNote ?? null,
        metadataJson: {
          lineItemId: args.lineItemId,
          productId: args.productId,
          productName: args.productName,
          variantId: args.variantId ?? null,
          variantName: args.variantName ?? null,
        },
      });

      return lineItem;
    });
  }

  async matchCustomerWithEvent(args: MatchInboundCustomerInput & {
    customerName: string;
    contactName?: string | null;
    contactEmail?: string | null;
  }): Promise<InboundOrderRecord | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .update(inboundOrderRecords)
        .set({
          matchedCustomerId: args.customerId,
          matchedContactId: args.contactId ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
          ),
        )
        .returning();

      if (!record) return null;

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.customer_matched",
        fromStatus: record.status,
        toStatus: record.status,
        message: args.staffNote ?? null,
        metadataJson: {
          customerId: args.customerId,
          customerName: args.customerName,
          contactId: args.contactId ?? null,
          contactName: args.contactName ?? null,
          contactEmail: args.contactEmail ?? null,
        },
      });

      return record;
    });
  }

  async resolveWarningWithEvent(args: ResolveInboundWarningInput): Promise<InboundOrderWarning | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [warning] = await tx
        .update(inboundOrderWarnings)
        .set({
          status: args.status,
          resolutionNote: args.resolutionNote ?? null,
          resolvedByUserId: args.actorUserId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(inboundOrderWarnings.organizationId, args.organizationId),
            eq(inboundOrderWarnings.inboundRecordId, args.inboundRecordId),
            eq(inboundOrderWarnings.id, args.warningId),
          ),
        )
        .returning();

      if (!warning) return null;

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.warning_resolved",
        fromStatus: null,
        toStatus: null,
        message: args.resolutionNote ?? null,
        metadataJson: {
          warningId: args.warningId,
          status: args.status,
          code: warning.code,
          severity: warning.severity,
        },
      });

      return warning;
    });
  }

  async resolveDecisionFlagWithEvent(args: ResolveInboundDecisionFlagInput): Promise<InboundOrderDecisionFlag | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [flag] = await tx
        .update(inboundOrderDecisionFlags)
        .set({
          status: args.status,
          decisionValueJson: args.decisionValueJson ?? {},
          decisionNote: args.decisionNote ?? null,
          decidedByUserId: args.actorUserId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(inboundOrderDecisionFlags.organizationId, args.organizationId),
            eq(inboundOrderDecisionFlags.inboundRecordId, args.inboundRecordId),
            eq(inboundOrderDecisionFlags.id, args.flagId),
          ),
        )
        .returning();

      if (!flag) return null;

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.decision_flag_resolved",
        fromStatus: null,
        toStatus: null,
        message: args.decisionNote ?? null,
        metadataJson: {
          flagId: args.flagId,
          status: args.status,
          flagType: flag.flagType,
          decisionValueJson: args.decisionValueJson ?? {},
        },
      });

      return flag;
    });
  }

  async createManualRecordWithEvent(args: {
    record: CreateInboundOrderRecordValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId">;
  }): Promise<{ record: InboundOrderRecord; event: InboundOrderEvent }> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .insert(inboundOrderRecords)
        .values(args.record)
        .returning();

      if (!record) {
        throw new Error("Failed to create inbound order record");
      }

      const [event] = await tx
        .insert(inboundOrderEvents)
        .values({
          ...args.event,
          inboundRecordId: record.id,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create inbound order event");
      }

      return { record, event };
    });
  }

  async getProductActivePbv2Tree(organizationId: string, productId: string): Promise<{
    product: Pick<Product, "id" | "name" | "pbv2ActiveTreeVersionId">;
    activeTree: Pbv2TreeVersion | null;
  } | null> {
    const [product] = await this.dbInstance
      .select({
        id: products.id,
        name: products.name,
        pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
      })
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
      .limit(1);

    if (!product) return null;
    if (!product.pbv2ActiveTreeVersionId) {
      return { product, activeTree: null };
    }

    const [activeTree] = await this.dbInstance
      .select()
      .from(pbv2TreeVersions)
      .where(and(
        eq(pbv2TreeVersions.organizationId, organizationId),
        eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId),
        eq(pbv2TreeVersions.status, "ACTIVE"),
      ))
      .limit(1);

    return {
      product,
      activeTree: activeTree ?? null,
    };
  }

  async listCustomerHistoricalContext(args: {
    organizationId: string;
    customerId: string;
    since: Date;
    maxRecords: number;
  }): Promise<InboundCustomerHistoricalContextRow[]> {
    const orderRows = await this.dbInstance
      .select({
        sourceType: sql<"order">`'order'`,
        sourceId: orders.id,
        reference: sql<string | null>`coalesce(${orders.displayNumber}, ${orders.orderNumber})`,
        createdAt: orders.createdAt,
        productId: orderLineItems.productId,
        productName: orderLineItems.description,
        description: orderLineItems.description,
        width: orderLineItems.width,
        height: orderLineItems.height,
        quantity: orderLineItems.quantity,
        specsJson: orderLineItems.specsJson,
        optionSelectionsJson: orderLineItems.optionSelectionsJson,
        selectedOptions: orderLineItems.selectedOptions,
        materialUsages: orderLineItems.materialUsages,
        materialUsageJson: orderLineItems.materialUsageJson,
      })
      .from(orders)
      .innerJoin(orderLineItems, eq(orderLineItems.orderId, orders.id))
      .where(and(
        eq(orders.organizationId, args.organizationId),
        eq(orders.customerId, args.customerId),
        sql`${orders.createdAt} >= ${args.since}`,
      ))
      .orderBy(desc(orders.createdAt))
      .limit(args.maxRecords);

    const quoteRows = await this.dbInstance
      .select({
        sourceType: sql<"quote">`'quote'`,
        sourceId: quotes.id,
        reference: sql<string | null>`coalesce(${quotes.displayNumber}, ${quotes.quoteNumber}::text, ${quotes.id})`,
        createdAt: quotes.createdAt,
        productId: quoteLineItems.productId,
        productName: quoteLineItems.productName,
        description: quoteLineItems.description,
        width: quoteLineItems.width,
        height: quoteLineItems.height,
        quantity: quoteLineItems.quantity,
        specsJson: quoteLineItems.specsJson,
        optionSelectionsJson: quoteLineItems.optionSelectionsJson,
        selectedOptions: quoteLineItems.selectedOptions,
        materialUsages: quoteLineItems.materialUsages,
        materialUsageJson: sql<Array<Record<string, any>> | null>`null`,
      })
      .from(quotes)
      .innerJoin(quoteLineItems, eq(quoteLineItems.quoteId, quotes.id))
      .where(and(
        eq(quotes.organizationId, args.organizationId),
        eq(quotes.customerId, args.customerId),
        sql`${quotes.createdAt} >= ${args.since}`,
      ))
      .orderBy(desc(quotes.createdAt))
      .limit(args.maxRecords);

    return [...orderRows, ...quoteRows]
      .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
      .slice(0, args.maxRecords);
  }

  async searchCustomerCandidates(args: {
    organizationId: string;
    email?: string | null;
    name?: string | null;
    limit: number;
  }): Promise<InboundCandidateResult[]> {
    const predicates = [eq(customers.organizationId, args.organizationId)];
    const email = args.email?.trim();
    const name = args.name?.trim();

    if (email) {
      const pattern = `%${email}%`;
      predicates.push(sql`(
        ${customers.email} ilike ${pattern}
        or exists (
          select 1 from ${customerContacts}
          where ${customerContacts.organizationId} = ${args.organizationId}
            and ${customerContacts.email} ilike ${pattern}
            and exists (
              select 1 from ${customerContactLinks}
              where ${customerContactLinks.contactId} = ${customerContacts.id}
                and ${customerContactLinks.customerId} = ${customers.id}
                and ${customerContactLinks.status} = 'active'
            )
        )
      )`);
    } else if (name) {
      const pattern = `%${name}%`;
      predicates.push(sql`${customers.companyName} ilike ${pattern}`);
    } else {
      return [];
    }

    const rows = await this.dbInstance
      .select({
        id: customers.id,
        label: customers.companyName,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(and(...predicates))
      .orderBy(asc(customers.companyName))
      .limit(args.limit);

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      confidence: email && row.email?.toLowerCase() === email.toLowerCase() ? 95 : email ? 82 : 65,
      reason: email ? "Matched sender/contact email text." : "Matched customer/company text.",
      metadata: {
        email: row.email,
        phone: row.phone,
      },
    }));
  }

  async searchContactCandidates(args: {
    organizationId: string;
    email?: string | null;
    name?: string | null;
    limit: number;
  }): Promise<InboundCandidateResult[]> {
    const predicates = [eq(customerContacts.organizationId, args.organizationId)];
    const email = args.email?.trim();
    const name = args.name?.trim();

    if (email) {
      const pattern = `%${email}%`;
      predicates.push(sql`${customerContacts.email} ilike ${pattern}`);
    } else if (name) {
      const pattern = `%${name}%`;
      predicates.push(sql`(
        ${customerContacts.firstName} ilike ${pattern}
        or ${customerContacts.lastName} ilike ${pattern}
      )`);
    } else {
      return [];
    }

    const rows = await this.dbInstance
      .select({
        id: customerContacts.id,
        firstName: customerContacts.firstName,
        lastName: customerContacts.lastName,
        email: customerContacts.email,
        phone: customerContacts.phone,
      })
      .from(customerContacts)
      .where(and(...predicates))
      .orderBy(asc(customerContacts.lastName), asc(customerContacts.firstName))
      .limit(args.limit);

    return rows.map((row) => {
      const label = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email || row.id;
      return {
        id: row.id,
        label,
        confidence: email && row.email?.toLowerCase() === email.toLowerCase() ? 96 : email ? 82 : 60,
        reason: email ? "Matched source email text." : "Matched contact name text.",
        metadata: {
          email: row.email,
          phone: row.phone,
        },
      };
    });
  }

  async searchProductCandidates(args: {
    organizationId: string;
    sourceText?: string | null;
    productName?: string | null;
    materialText?: string | null;
    optionTexts?: string[];
    finishingTexts?: string[];
    limit: number;
  }): Promise<InboundCandidateResult[]> {
    const terms = buildProductKnowledgeSearchTerms({
      sourceText: args.sourceText,
      productName: args.productName,
      materialText: args.materialText,
      optionTexts: args.optionTexts,
      finishingTexts: args.finishingTexts,
    });

    if (terms.length === 0) return [];

    const predicates = [
      eq(products.organizationId, args.organizationId),
      eq(products.isActive, true),
    ];
    const termPredicates = terms.slice(0, 20).map((term) => {
      const pattern = `%${term}%`;
      return sql`(
        ${products.name} ilike ${pattern}
        or ${products.category} ilike ${pattern}
        or ${products.description} ilike ${pattern}
        or ${products.aiParsingDescription} ilike ${pattern}
        or ${materials.name} ilike ${pattern}
        or ${materials.category} ilike ${pattern}
        or ${materials.aiParsingDescription} ilike ${pattern}
      )`;
    });
    predicates.push(sql`(${sql.join(termPredicates, sql` or `)})`);

    const rows = await this.dbInstance
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        description: products.description,
        aiParsingDescription: products.aiParsingDescription,
        aiParsingDescriptionLinkedToDescription: products.aiParsingDescriptionLinkedToDescription,
        optionsJson: products.optionsJson,
        pricingProfileConfig: products.pricingProfileConfig,
        pricingProfileKey: products.pricingProfileKey,
        pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
        isService: products.isService,
        materialName: materials.name,
        materialCategory: materials.category,
        materialAiParsingDescription: materials.aiParsingDescription,
        materialAiParsingDescriptionLinkedToDescription: materials.aiParsingDescriptionLinkedToDescription,
        materialSpecsJson: materials.specsJson,
      })
      .from(products)
      .leftJoin(materials, eq(products.primaryMaterialId, materials.id))
      .where(and(...predicates))
      .orderBy(asc(products.name))
      .limit(Math.max(args.limit * 12, 60));

    return scoreProductKnowledgeCandidates(
      {
        sourceText: args.sourceText,
        productName: args.productName,
        materialText: args.materialText,
        optionTexts: args.optionTexts,
        finishingTexts: args.finishingTexts,
      },
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        description: row.description,
        aiParsingDescription: resolveAiParsingDescription({
          aiParsingDescription: row.aiParsingDescription,
          aiParsingDescriptionLinkedToDescription: row.aiParsingDescriptionLinkedToDescription,
          description: row.description,
        }),
        materialName: row.materialName,
        materialCategory: row.materialCategory,
        materialAiParsingDescription: resolveAiParsingDescription({
          aiParsingDescription: row.materialAiParsingDescription,
          aiParsingDescriptionLinkedToDescription: row.materialAiParsingDescriptionLinkedToDescription,
          description: typeof row.materialSpecsJson === "object" && row.materialSpecsJson && !Array.isArray(row.materialSpecsJson)
            ? String((row.materialSpecsJson as Record<string, unknown>).description ?? "")
            : null,
        }),
        isService: row.isService,
        metadataText: JSON.stringify({
          optionsJson: row.optionsJson ?? null,
          pricingProfileConfig: row.pricingProfileConfig ?? null,
          pricingProfileKey: row.pricingProfileKey ?? null,
          pbv2ActiveTreeVersionId: row.pbv2ActiveTreeVersionId ?? null,
          materialSpecsJson: row.materialSpecsJson ?? null,
        }),
      })),
      args.limit,
    );
  }

  async createManualInboundOrder(args: {
    record: CreateInboundOrderRecordValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId">;
  }): Promise<{ record: InboundOrderRecord; event: InboundOrderEvent }> {
    return this.createManualRecordWithEvent(args);
  }

  async updateInboundOrderStatus(args: {
    organizationId: string;
    inboundRecordId: string;
    patch: UpdateInboundOrderRecordValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId" | "organizationId">;
  }): Promise<{ record: InboundOrderRecord; event: InboundOrderEvent } | null> {
    return this.updateRecordWithEvent(args);
  }

  async updateRecordWithEvent(args: {
    organizationId: string;
    inboundRecordId: string;
    patch: UpdateInboundOrderRecordValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId" | "organizationId">;
  }): Promise<{ record: InboundOrderRecord; event: InboundOrderEvent } | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .update(inboundOrderRecords)
        .set({
          ...args.patch,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
          ),
        )
        .returning();

      if (!record) {
        return null;
      }

      const [event] = await tx
        .insert(inboundOrderEvents)
        .values({
          ...args.event,
          organizationId: args.organizationId,
          inboundRecordId: args.inboundRecordId,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create inbound order event");
      }

      return { record, event };
    });
  }

  async claimInboundOrderForOrderConversion(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
  }): Promise<InboundOrderRecord | null> {
    return this.dbInstance.transaction(async (tx) => {
      const now = new Date();
      const [record] = await tx
        .update(inboundOrderRecords)
        .set({
          status: "processing",
          reviewOutcome: "order_conversion_requested",
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
            eq(inboundOrderRecords.status, "ready"),
            sql`${inboundOrderRecords.createdOrderId} is null`,
            sql`${inboundOrderRecords.createdQuoteId} is null`,
          ),
        )
        .returning();

      if (!record) return null;

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "convert.requested",
        fromStatus: "ready",
        toStatus: "processing",
        message: "Staff requested draft order creation from reviewed inbound record.",
        metadataJson: {
          phase: "inbound_orders_phase_4",
          createsOrder: true,
          releasesProduction: false,
          createsProofs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });

      return record;
    });
  }

  async markInboundOrderConvertedToOrder(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    orderId: string;
    orderNumber?: string | number | null;
    lineItemLinks: Array<{ inboundLineItemId: string | null; orderLineItemId: string }>;
  }): Promise<InboundOrderRecord | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(inboundOrderRecords)
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
          ),
        )
        .limit(1);

      if (!record) return null;
      if (record.createdOrderId && record.createdOrderId !== args.orderId) return record;

      const now = new Date();
      const [updated] = await tx
        .update(inboundOrderRecords)
        .set({
          status: "submitted",
          reviewOutcome: "order_created",
          createdOrderId: args.orderId,
          matchedOrderId: args.orderId,
          submittedByUserId: args.actorUserId,
          submittedAt: now,
          requiresHumanDecision: false,
          reviewRequiredReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
          ),
        )
        .returning();

      for (const link of args.lineItemLinks) {
        if (!link.inboundLineItemId) continue;
        await tx
          .update(inboundOrderLineItems)
          .set({
            createdOrderLineItemId: link.orderLineItemId,
            updatedAt: now,
          })
          .where(
            and(
              eq(inboundOrderLineItems.organizationId, args.organizationId),
              eq(inboundOrderLineItems.inboundRecordId, args.inboundRecordId),
              eq(inboundOrderLineItems.id, link.inboundLineItemId),
            ),
          );
      }

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "convert.completed",
        fromStatus: record.status,
        toStatus: "submitted",
        message: `Draft order ${args.orderNumber ?? args.orderId.slice(0, 8)} created from reviewed inbound record.`,
        metadataJson: {
          phase: "inbound_orders_phase_4",
          orderId: args.orderId,
          orderNumber: args.orderNumber ?? null,
          linkedLineItems: args.lineItemLinks.length,
          releasesProduction: false,
          createsProofs: false,
          createsInvoices: false,
          createsFulfillment: false,
          createsPayments: false,
        },
      });

      return updated ?? null;
    });
  }

  async markInboundOrderConversionFailed(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    message: string;
    errors?: string[];
  }): Promise<InboundOrderRecord | null> {
    return this.dbInstance.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx
        .update(inboundOrderRecords)
        .set({
          status: "ready",
          reviewOutcome: "order_conversion_failed",
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, args.inboundRecordId),
            sql`${inboundOrderRecords.createdOrderId} is null`,
          ),
        )
        .returning();

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "convert.failed",
        fromStatus: "processing",
        toStatus: updated?.status ?? null,
        message: args.message,
        metadataJson: {
          phase: "inbound_orders_phase_4",
          errors: args.errors ?? [],
        },
      });

      return updated ?? null;
    });
  }

  async createReviewSnapshotWithEvent(args: {
    snapshot: CreateInboundOrderReviewSnapshotValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId" | "organizationId">;
  }): Promise<{ snapshot: InboundOrderReviewSnapshot; event: InboundOrderEvent }> {
    return this.dbInstance.transaction(async (tx) => {
      const [snapshot] = await tx
        .insert(inboundOrderReviewSnapshots)
        .values(args.snapshot)
        .returning();

      if (!snapshot) {
        throw new Error("Failed to create inbound order review snapshot");
      }

      const [event] = await tx
        .insert(inboundOrderEvents)
        .values({
          ...args.event,
          organizationId: args.snapshot.organizationId,
          inboundRecordId: args.snapshot.inboundRecordId,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create inbound order event");
      }

      return { snapshot, event };
    });
  }

  async createQuoteDraftFromInboundReview(
    organizationId: string,
    input: InboundQuoteDraftInput,
  ): Promise<InboundQuoteDraftResult | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(inboundOrderRecords)
        .where(
          and(
            eq(inboundOrderRecords.organizationId, organizationId),
            eq(inboundOrderRecords.id, input.inboundRecordId),
          ),
        )
        .limit(1);

      if (!record || record.createdQuoteId) {
        return null;
      }

      const { displayNumber, numberCore } = await allocateDocumentNumber(organizationId, "quote", tx);
      const quoteNumber = numberCore;
      const now = new Date();

      // Keep quote.source aligned with normal staff-created quotes so internal quote lists and permissions include it.
      // Inbound provenance stays in quote list notes, line item specs, and the inbound review event metadata.
      const [quote] = await tx
        .insert(quotes)
        .values({
          organizationId,
          userId: input.actorUserId,
          quoteNumber,
          displayNumber,
          numberCore,
          status: "draft",
          source: "internal",
          label: input.label,
          customerId: input.customerId ?? null,
          contactId: input.contactId ?? null,
          customerName: input.customerName ?? null,
          billToName: input.contactName ?? input.customerName ?? null,
          billToCompany: input.customerName ?? null,
          billToPhone: input.contactPhone ?? null,
          billToEmail: input.contactEmail ?? null,
          subtotal: "0",
          taxAmount: "0",
          taxableSubtotal: "0",
          marginPercentage: "0",
          discountAmount: "0",
          totalPrice: "0",
        })
        .returning();

      const lineItemRows = input.lineItems.map((lineItem, index) => ({
        quoteId: quote.id,
        status: "active" as const,
        productId: lineItem.productId,
        productName: lineItem.productName,
        variantId: lineItem.variantId ?? null,
        variantName: null,
        productType: lineItem.productType || "wide_roll",
        width: lineItem.width.toString(),
        height: lineItem.height.toString(),
        quantity: lineItem.quantity,
        specsJson: {
          inboundRecordId: input.inboundRecordId,
          inboundReviewSnapshotId: input.snapshotId,
          inboundReviewSnapshotVersion: input.snapshotVersion,
          sourceLineItemId: lineItem.sourceLineItemId,
          staffReviewedDraft: lineItem.snapshotJson,
        },
        pbv2SnapshotJson: {},
        optionSelectionsJson: {},
        selectedOptions: [],
        linePrice: "0",
        priceBreakdown: {
          basePrice: 0,
          optionsPrice: 0,
          total: 0,
          formula: "inbound_review_unpriced_draft",
        },
        materialUsages: [],
        taxAmount: "0",
        isTaxableSnapshot: true,
        displayOrder: index,
        isTemporary: false,
        description: lineItem.description ?? null,
        productionNotes: lineItem.notes ?? null,
        createdByUserId: input.actorUserId,
        requiresDesign: false,
        requiresDesignSnapshot: false,
        designBriefRequiredSnapshot: false,
        designPricingModeSnapshot: "none" as const,
        requiresProofApproval: false,
      }));

      const createdLineItems = lineItemRows.length
        ? await tx.insert(quoteLineItems).values(lineItemRows).returning()
        : [];

      for (const createdLineItem of createdLineItems) {
        const sourceLineItemId = (createdLineItem.specsJson as any)?.sourceLineItemId;
        if (!sourceLineItemId) continue;

        await tx
          .update(inboundOrderLineItems)
          .set({
            createdQuoteLineItemId: createdLineItem.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(inboundOrderLineItems.organizationId, organizationId),
              eq(inboundOrderLineItems.id, sourceLineItemId),
            ),
          );
      }

      await tx
        .insert(quoteListNotes)
        .values({
          organizationId,
          quoteId: quote.id,
          listLabel: input.listLabel,
          updatedByUserId: input.actorUserId,
        });

      await tx
        .update(inboundOrderRecords)
        .set({
          status: "submitted",
          reviewOutcome: "quote_draft_created",
          createdQuoteId: quote.id,
          matchedQuoteId: quote.id,
          submittedByUserId: input.actorUserId,
          submittedAt: now,
          requiresHumanDecision: false,
          reviewRequiredReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, organizationId),
            eq(inboundOrderRecords.id, input.inboundRecordId),
          ),
        );

      await tx
        .insert(inboundOrderEvents)
        .values({
          organizationId,
          inboundRecordId: input.inboundRecordId,
          actorUserId: input.actorUserId,
          actorType: "user",
          eventType: "review.quote_created",
          fromStatus: record.status,
          toStatus: "submitted",
          message: `Quote draft #${quote.quoteNumber ?? quote.id.slice(0, 8)} created from reviewed inbound snapshot.`,
          metadataJson: {
            quoteId: quote.id,
            quoteNumber: quote.quoteNumber,
            quoteStatus: quote.status,
            snapshotId: input.snapshotId,
            snapshotVersion: input.snapshotVersion,
            createdLineItems: createdLineItems.length,
            convertedLineItemCount: createdLineItems.length,
            skippedLineItemCount: input.skippedLineItems.length,
            skippedLineItems: input.skippedLineItems,
            conversionMetadata: input.conversionMetadata,
          },
        });

      return {
        quote,
        lineItems: createdLineItems,
        skippedLineItems: input.skippedLineItems,
      };
    }).catch((error) => {
      if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
      throw error;
    });
  }

  async markLinkedQuoteCompleted(args: {
    organizationId: string;
    quoteId: string;
    actorUserId?: string | null;
    quoteStatus: string;
    completionSource: "quote_status" | "quote_staff_approval";
  }): Promise<InboundOrderRecord | null> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(inboundOrderRecords)
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.createdQuoteId, args.quoteId),
          ),
        )
        .limit(1);

      if (!record || record.status === "approved" || record.status === "terminal") {
        return null;
      }

      const [existingEvent] = await tx
        .select({ id: inboundOrderEvents.id })
        .from(inboundOrderEvents)
        .where(
          and(
            eq(inboundOrderEvents.organizationId, args.organizationId),
            eq(inboundOrderEvents.inboundRecordId, record.id),
            eq(inboundOrderEvents.eventType, "review.downstream_quote_completed"),
          ),
        )
        .limit(1);

      if (existingEvent) {
        return record;
      }

      const now = new Date();
      const [updated] = await tx
        .update(inboundOrderRecords)
        .set({
          status: "approved",
          reviewOutcome: "downstream_quote_completed",
          requiresHumanDecision: false,
          reviewRequiredReason: null,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundOrderRecords.organizationId, args.organizationId),
            eq(inboundOrderRecords.id, record.id),
          ),
        )
        .returning();

      await tx.insert(inboundOrderEvents).values({
        organizationId: args.organizationId,
        inboundRecordId: record.id,
        actorUserId: args.actorUserId ?? null,
        actorType: args.actorUserId ? "user" : "system",
        eventType: "review.downstream_quote_completed",
        fromStatus: record.status,
        toStatus: "approved",
        message: "Linked quote was completed downstream; inbound review cleared from active pending state.",
        metadataJson: {
          quoteId: args.quoteId,
          quoteStatus: args.quoteStatus,
          completionSource: args.completionSource,
        },
      });

      return updated ?? record;
    });
  }
}

export const inboundOrdersRepository = new InboundOrdersRepository();
