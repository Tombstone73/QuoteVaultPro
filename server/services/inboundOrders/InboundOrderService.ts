import {
  type InboundOrderDecisionFlag,
  type InboundOrderEvent,
  type InboundOrderFile,
  type InboundOrderLineItem,
  type InboundOrderRecord,
  type InboundOrderRecordStatus,
  type InboundOrderReviewSnapshot,
  type InboundOrderSource,
  type InboundOrderSourceType,
  type InboundOrderWarning,
  type Quote,
} from "@shared/schema";
import {
  inboundOrdersRepository,
  type CreateInboundOrderEventValues,
  type InboundContactSearchResult,
  type InboundCustomerSearchResult,
  type InboundQuoteDraftLineInput,
  type InboundOrderListFilters,
  type InboundOrderQueueSummary,
  type UpdateInboundOrderRecordValues,
} from "../../storage/inboundOrders.repo";

export type InboundQuoteSyncStatus =
  | "quote_missing"
  | "quote_exists"
  | "quote_deleted_or_inaccessible"
  | "quote_status_changed";

export type InboundLinkedQuoteSummary = {
  id: string;
  quoteNumber: number | null;
  reference: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  customerId: string | null;
  contactId: string | null;
  customerName: string | null;
};

export type InboundMatchedCustomerSummary = {
  id: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

export type InboundMatchedContactSummary = {
  id: string;
  customerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
};

export type InboundQuoteActivityProjection = {
  syncStatus: InboundQuoteSyncStatus;
  lastQuoteUpdatedAt: Date | null;
  currentQuoteStatus: string | null;
  originalQuoteStatus: string | null;
  divergedFromReviewSnapshot: boolean;
  divergenceReasons: string[];
  lastSyncEventAt: Date | null;
};

export type InboundOrderDetail = {
  record: InboundOrderRecord;
  source: InboundOrderSource | null;
  lineItems: InboundOrderLineItem[];
  files: InboundOrderFile[];
  warnings: InboundOrderWarning[];
  decisionFlags: InboundOrderDecisionFlag[];
  events: InboundOrderEvent[];
  reviewSnapshots: InboundOrderReviewSnapshot[];
  latestReviewSnapshot: InboundOrderReviewSnapshot | null;
  linkedQuote: InboundLinkedQuoteSummary | null;
  quoteActivity: InboundQuoteActivityProjection;
  matchedCustomer: InboundMatchedCustomerSummary | null;
  matchedContact: InboundMatchedContactSummary | null;
};

export type InboundOrderListResult = {
  records: InboundOrderRecord[];
  summary: InboundOrderQueueSummary;
};

export type ManualInboundOrderCreateInput = {
  organizationId: string;
  actorUserId: string | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
  sourceRecordId?: string | null;
  sourceMessageId?: string | null;
  externalReference?: string | null;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
  rawPayloadJson?: Record<string, unknown>;
  normalizedPayloadJson?: Record<string, unknown>;
  extractedCustomerJson?: Record<string, unknown> | null;
  extractedOrderJson?: Record<string, unknown> | null;
  extractedShippingJson?: Record<string, unknown> | null;
  requiresHumanDecision?: boolean;
  reviewRequiredReason?: string | null;
};

export type InboundOrderReviewAction =
  | "mark-reviewed"
  | "needs-clarification"
  | "reject"
  | "reopen";

export type InboundOrderReviewActionInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  action: InboundOrderReviewAction;
  note?: string | null;
};

export type InboundOrderReviewDraftSnapshot = {
  customerDraft: Record<string, unknown>;
  contactDraft: Record<string, unknown>;
  orderNotes: string | null;
  desiredOutputType: string | null;
  lineItemDrafts: Array<Record<string, unknown>>;
  staffNotes: string | null;
  metadata: Record<string, unknown>;
};

export type SaveInboundOrderReviewSnapshotInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  draft: InboundOrderReviewDraftSnapshot;
};

export type MatchInboundLineItemProductInput = {
  organizationId: string;
  inboundRecordId: string;
  lineItemId: string;
  actorUserId: string;
  productId: string;
  variantId?: string | null;
  optionSelectionsJson?: Record<string, unknown> | null;
  staffNote?: string | null;
};

export type MatchInboundCustomerReviewInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  customerId: string;
  contactId?: string | null;
  staffNote?: string | null;
};

export type ResolveInboundWarningReviewInput = {
  organizationId: string;
  inboundRecordId: string;
  warningId: string;
  actorUserId: string;
  status: "resolved" | "ignored";
  resolutionNote?: string | null;
};

export type ResolveInboundDecisionFlagReviewInput = {
  organizationId: string;
  inboundRecordId: string;
  flagId: string;
  actorUserId: string;
  status: "accepted" | "overridden" | "dismissed";
  decisionValueJson?: Record<string, unknown> | null;
  decisionNote?: string | null;
};

export type InboundCreatedQuoteSummary = {
  id: string;
  quoteNumber: number | null;
  reference: string;
  status: string;
  customerId: string | null;
  contactId: string | null;
  customerName: string | null;
  contactName: string | null;
  totalPrice: string;
  createdAt: Date;
  lineItemsCreated: number;
  convertedLineItemCount: number;
  skippedLineItemCount: number;
  skippedLineItems: Array<Record<string, unknown>>;
  alreadyConverted?: boolean;
};

export type InboundQuoteDraftSkippedLineItem = {
  index: number;
  sourceLineItemId: string | null;
  productName: string | null;
  reason:
    | "missing_snapshot_row_linkage"
    | "no_matched_product"
    | "invalid_dimensions"
    | "missing_quantity";
  detail: string;
};

export type InboundQuoteDraftPreviewLineItem = InboundQuoteDraftLineInput & {
  index: number;
};

export type InboundQuoteDraftPreview = {
  eligible: boolean;
  blockingReasons: string[];
  alreadyConverted: boolean;
  latestSnapshot: {
    id: string | null;
    snapshotVersion: number | null;
    snapshotType: string | null;
    snapshotKind: string | null;
    createdAt: Date | null;
  };
  customer: {
    matchedCustomerId: string | null;
    customerName: string | null;
    source: "matched_customer" | "manual_text" | "missing";
  };
  contact: {
    matchedContactId: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    source: "matched_contact" | "snapshot_text" | "missing";
  };
  desiredOutputType: string | null;
  orderNotes: string | null;
  label: string | null;
  lineItemsToConvert: InboundQuoteDraftPreviewLineItem[];
  skippedLineItems: InboundQuoteDraftSkippedLineItem[];
  warningsSummary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
    open: number;
  };
  decisionFlagsSummary: {
    total: number;
    open: number;
    accepted: number;
    overridden: number;
    dismissed: number;
  };
};

export type CreateQuoteDraftFromInboundResult = {
  quote: InboundCreatedQuoteSummary;
  inbound: InboundOrderDetail;
};

export class InboundOrderTransitionError extends Error {
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "InboundOrderTransitionError";
  }
}

const reviewedStatus: InboundOrderRecordStatus = "ready";
const needsClarificationStatus: InboundOrderRecordStatus = "waiting_on_customer";
const rejectedStatus: InboundOrderRecordStatus = "terminal";
const reopenedStatus: InboundOrderRecordStatus = "needs_review";
const originalInboundQuoteStatus = "draft";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getPathValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    const record = asRecord(current);
    return record ? record[key] : undefined;
  }, source);
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function positiveNumberFromUnknown(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function positiveIntegerFromUnknown(value: unknown): number | null {
  const numeric = positiveNumberFromUnknown(value);
  if (numeric == null) return null;
  return Math.floor(numeric);
}

function quoteReference(quote: Pick<Quote, "id" | "quoteNumber">): string {
  return quote.quoteNumber != null ? `#${quote.quoteNumber}` : quote.id.slice(0, 8);
}

function formatInboundDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatSkippedLineItemForNote(item: InboundQuoteDraftSkippedLineItem): string {
  const name = item.productName || `Draft row ${item.index + 1}`;
  const source = item.sourceLineItemId ? ` sourceLine=${item.sourceLineItemId}` : "";
  return `- ${name}: ${item.reason} (${item.detail})${source}`;
}

export class InboundOrderService {
  constructor(private readonly repository = inboundOrdersRepository) {}

  async listRecords(args: {
    organizationId: string;
    filters: InboundOrderListFilters;
  }): Promise<InboundOrderListResult> {
    const [records, summary] = await Promise.all([
      this.repository.listRecords(args.organizationId, args.filters),
      this.repository.getQueueSummary(args.organizationId),
    ]);

    return { records, summary };
  }

  async getDetail(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<InboundOrderDetail | null> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);

    if (!record) {
      return null;
    }

    const [
      source,
      lineItems,
      files,
      warnings,
      decisionFlags,
      events,
      reviewSnapshots,
      latestReviewSnapshot,
      matchedCustomer,
      matchedContact,
    ] = await Promise.all([
      record.sourceId
        ? this.repository.getSource(args.organizationId, record.sourceId)
        : Promise.resolve(null),
      this.repository.listLineItems(args.organizationId, args.inboundRecordId),
      this.repository.listFiles(args.organizationId, args.inboundRecordId),
      this.repository.listWarnings(args.organizationId, args.inboundRecordId),
      this.repository.listDecisionFlags(args.organizationId, args.inboundRecordId),
      this.repository.listEvents(args.organizationId, args.inboundRecordId),
      this.repository.listReviewSnapshots(args.organizationId, args.inboundRecordId),
      this.repository.getLatestReviewSnapshot(args.organizationId, args.inboundRecordId),
      record.matchedCustomerId
        ? this.repository.getCustomer(args.organizationId, record.matchedCustomerId)
        : Promise.resolve(null),
      record.matchedCustomerId && record.matchedContactId
        ? this.repository.getContactForCustomer(args.organizationId, record.matchedCustomerId, record.matchedContactId)
        : Promise.resolve(null),
    ]);

    const detail: InboundOrderDetail = {
      record,
      source,
      lineItems,
      files,
      warnings,
      decisionFlags,
      events,
      reviewSnapshots,
      latestReviewSnapshot,
      linkedQuote: null,
      quoteActivity: {
        syncStatus: "quote_missing",
        lastQuoteUpdatedAt: null,
        currentQuoteStatus: null,
        originalQuoteStatus: null,
        divergedFromReviewSnapshot: false,
        divergenceReasons: [],
        lastSyncEventAt: null,
      },
      matchedCustomer: matchedCustomer
        ? {
          id: matchedCustomer.id,
          companyName: matchedCustomer.companyName,
          email: matchedCustomer.email ?? null,
          phone: matchedCustomer.phone ?? null,
          status: matchedCustomer.status ?? null,
        }
        : null,
      matchedContact: matchedContact
        ? {
          id: matchedContact.id,
          customerId: matchedContact.customerId,
          name: `${matchedContact.firstName} ${matchedContact.lastName}`.trim(),
          email: matchedContact.email ?? null,
          phone: matchedContact.phone ?? null,
          mobile: matchedContact.mobile ?? null,
        }
        : null,
    };

    return this.attachQuoteLinkage(args.organizationId, detail);
  }

  async createManualRecord(args: ManualInboundOrderCreateInput): Promise<{
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  }> {
    const status: InboundOrderRecordStatus = "received";
    const sourceType: InboundOrderSourceType = "manual";

    return this.repository.createManualRecordWithEvent({
      record: {
        organizationId: args.organizationId,
        sourceId: args.sourceId ?? null,
        sourceType,
        sourceLabel: args.sourceLabel ?? "Manual internal intake",
        sourceTrustLevel: "manual_internal",
        sourceRecordId: args.sourceRecordId ?? null,
        sourceMessageId: args.sourceMessageId ?? null,
        status,
        requiresHumanDecision: args.requiresHumanDecision ?? false,
        reviewRequiredReason: args.reviewRequiredReason ?? null,
        externalReference: args.externalReference ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        payloadHash: args.payloadHash ?? null,
        rawPayloadJson: args.rawPayloadJson ?? {},
        normalizedPayloadJson: args.normalizedPayloadJson ?? {},
        extractedCustomerJson: args.extractedCustomerJson ?? {},
        extractedOrderJson: args.extractedOrderJson ?? {},
        extractedShippingJson: args.extractedShippingJson ?? {},
        receivedAt: new Date(),
      },
      event: {
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "record.received",
        fromStatus: null,
        toStatus: status,
        message: "Manual inbound order record created",
        metadataJson: {
          sourceType,
          sourceTrustLevel: "manual_internal",
        },
      },
    });
  }

  async applyReviewAction(args: InboundOrderReviewActionInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);

    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const note = args.note?.trim() || null;
    const patch = this.getReviewActionPatch(record, args.action, note, args.actorUserId);
    const toStatus = patch.status ?? record.status;

    const updated = await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch,
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: `review.${args.action}`,
        fromStatus: record.status,
        toStatus,
        message: note,
        metadataJson: {
          action: args.action,
          reviewOutcome: patch.reviewOutcome ?? null,
        },
      },
    });

    if (!updated) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after update", 404);
    }

    return detail;
  }

  async saveReviewSnapshot(args: SaveInboundOrderReviewSnapshotInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);

    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (record.createdQuoteId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot have review snapshots changed.");
    }

    const latestSnapshot = await this.repository.getLatestReviewSnapshot(
      args.organizationId,
      args.inboundRecordId,
    );
    const snapshotVersion = (latestSnapshot?.snapshotVersion ?? 0) + 1;
    const staffNotes = args.draft.staffNotes?.trim() || null;

    await this.repository.createReviewSnapshotWithEvent({
      snapshot: {
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        snapshotType: "approval",
        snapshotVersion,
        payloadJson: {
          ...args.draft,
          staffNotes,
          metadata: {
            ...(args.draft.metadata ?? {}),
            snapshotKind: "staff_review_draft",
            source: "inbound_order_review_queue",
            savedAt: new Date().toISOString(),
          },
        },
        createdByUserId: args.actorUserId,
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.snapshot_saved",
        fromStatus: record.status,
        toStatus: record.status,
        message: staffNotes,
        metadataJson: {
          snapshotVersion,
          snapshotKind: "staff_review_draft",
        },
      },
    });

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after snapshot save", 404);
    }

    return detail;
  }

  async getQuoteDraftPreview(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<InboundQuoteDraftPreview> {
    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    return this.buildQuoteDraftPreview(detail);
  }

  async searchCustomers(args: {
    organizationId: string;
    search?: string | null;
    limit: number;
  }): Promise<InboundCustomerSearchResult[]> {
    return this.repository.searchCustomers(args.organizationId, args.search ?? null, args.limit);
  }

  async searchCustomerContacts(args: {
    organizationId: string;
    customerId: string;
    search?: string | null;
    limit: number;
  }): Promise<InboundContactSearchResult[]> {
    const customer = await this.repository.getCustomer(args.organizationId, args.customerId);
    if (!customer) {
      throw new InboundOrderTransitionError("Customer not found for this organization", 404);
    }

    return this.repository.searchCustomerContacts(
      args.organizationId,
      args.customerId,
      args.search ?? null,
      args.limit,
    );
  }

  async matchCustomer(args: MatchInboundCustomerReviewInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (record.createdQuoteId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot have customer/contact matches changed.");
    }

    const customer = await this.repository.getCustomer(args.organizationId, args.customerId);
    if (!customer) {
      throw new InboundOrderTransitionError("Customer not found for this organization", 404);
    }

    let contactName: string | null = null;
    let contactEmail: string | null = null;
    if (args.contactId) {
      const contact = await this.repository.getContactForCustomer(
        args.organizationId,
        args.customerId,
        args.contactId,
      );

      if (!contact) {
        throw new InboundOrderTransitionError("Contact does not belong to the selected customer", 400);
      }

      contactName = `${contact.firstName} ${contact.lastName}`.trim();
      contactEmail = contact.email ?? null;
    }

    const updated = await this.repository.matchCustomerWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      customerId: args.customerId,
      contactId: args.contactId ?? null,
      staffNote: args.staffNote?.trim() || null,
      customerName: customer.companyName,
      contactName,
      contactEmail,
    });

    if (!updated) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after customer match", 404);
    }

    return detail;
  }

  async matchLineItemProduct(args: MatchInboundLineItemProductInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (record.createdQuoteId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot have review line item matches changed.");
    }

    const product = await this.repository.getProduct(args.organizationId, args.productId);
    if (!product) {
      throw new InboundOrderTransitionError("Product not found for this organization", 404);
    }

    let variantName: string | null = null;
    if (args.variantId) {
      const variant = await this.repository.getProductVariantForProduct(args.productId, args.variantId);
      if (!variant) {
        throw new InboundOrderTransitionError("Product variant does not belong to the selected product", 400);
      }
      variantName = variant.name;
    }

    const updated = await this.repository.matchLineItemProductWithEvent({
      ...args,
      staffNote: args.staffNote?.trim() || null,
      variantId: args.variantId ?? null,
      optionSelectionsJson: args.optionSelectionsJson ?? {},
      productName: product.name,
      variantName,
    });

    if (!updated) {
      throw new InboundOrderTransitionError("Inbound line item not found for this record", 404);
    }

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after line item match", 404);
    }

    return detail;
  }

  async resolveWarning(args: ResolveInboundWarningReviewInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const warning = await this.repository.resolveWarningWithEvent({
      ...args,
      resolutionNote: args.resolutionNote?.trim() || null,
    });

    if (!warning) {
      throw new InboundOrderTransitionError("Inbound warning not found for this record", 404);
    }

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after warning resolution", 404);
    }

    return detail;
  }

  async resolveDecisionFlag(args: ResolveInboundDecisionFlagReviewInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const flag = await this.repository.resolveDecisionFlagWithEvent({
      ...args,
      decisionNote: args.decisionNote?.trim() || null,
      decisionValueJson: args.decisionValueJson ?? {},
    });

    if (!flag) {
      throw new InboundOrderTransitionError("Inbound decision flag not found for this record", 404);
    }

    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found after decision flag resolution", 404);
    }

    return detail;
  }

  async createQuoteDraftFromInbound(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
  }): Promise<CreateQuoteDraftFromInboundResult> {
    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const { record, latestReviewSnapshot } = detail;
    const preview = this.buildQuoteDraftPreview(detail);

    if (record.createdQuoteId) {
      const existingQuote = await this.repository.getQuote(args.organizationId, record.createdQuoteId);
      if (!existingQuote) {
        throw new InboundOrderTransitionError("Inbound record is already linked to a quote that could not be loaded.");
      }

      return {
        quote: {
          id: existingQuote.id,
          quoteNumber: existingQuote.quoteNumber,
          reference: quoteReference(existingQuote),
          status: existingQuote.status,
          customerId: existingQuote.customerId ?? null,
          contactId: existingQuote.contactId ?? null,
          customerName: existingQuote.customerName ?? null,
          contactName: detail.matchedContact?.name ?? null,
          totalPrice: existingQuote.totalPrice,
          createdAt: existingQuote.createdAt,
          lineItemsCreated: 0,
          convertedLineItemCount: 0,
          skippedLineItemCount: 0,
          skippedLineItems: [],
          alreadyConverted: true,
        },
        inbound: detail,
      };
    }

    if (!preview.eligible || !latestReviewSnapshot) {
      throw new InboundOrderTransitionError(
        preview.blockingReasons[0] ?? "Inbound record is not eligible for quote conversion.",
      );
    }

    const conversionMetadata = {
      inboundRecordId: record.id,
      inboundSourceLabel: record.sourceLabel ?? null,
      inboundSourceType: record.sourceType,
      inboundSourceTrustLevel: record.sourceTrustLevel,
      externalReference: record.externalReference ?? null,
      sourceRecordId: record.sourceRecordId ?? null,
      sourceMessageId: record.sourceMessageId ?? null,
      receivedAt: formatInboundDate(record.receivedAt),
      inboundCreatedAt: formatInboundDate(record.createdAt),
      snapshotId: latestReviewSnapshot.id,
      snapshotVersion: latestReviewSnapshot.snapshotVersion,
      convertedLineItemCount: preview.lineItemsToConvert.length,
      skippedLineItemCount: preview.skippedLineItems.length,
      skippedLineItems: preview.skippedLineItems,
      matchedCustomerId: record.matchedCustomerId ?? null,
      matchedContactId: record.matchedContactId ?? null,
      customerName: preview.customer.customerName ?? null,
      contactName: preview.contact.contactName ?? null,
      customerMappingSource: preview.customer.source,
      contactMappingSource: preview.contact.source,
    };
    const skippedLines = preview.skippedLineItems.map(formatSkippedLineItemForNote);
    const listLabel = [
      "Created from inbound review",
      `Inbound record: ${record.id}`,
      `Source: ${record.sourceLabel ?? record.sourceType} (${record.sourceType})`,
      record.externalReference ? `External reference: ${record.externalReference}` : null,
      `Received: ${formatInboundDate(record.receivedAt) ?? "unknown"}`,
      `Snapshot: ${latestReviewSnapshot.id} v${latestReviewSnapshot.snapshotVersion}`,
      `Customer: ${preview.customer.customerName ?? "manual inbound text"} (${preview.customer.source})`,
      preview.contact.contactName || preview.contact.email
        ? `Contact: ${preview.contact.contactName ?? preview.contact.email} (${preview.contact.source})`
        : null,
      preview.desiredOutputType ? `Output: ${preview.desiredOutputType}` : null,
      `Converted line items: ${preview.lineItemsToConvert.length}`,
      `Skipped line items: ${preview.skippedLineItems.length}`,
      skippedLines.length ? "Skipped item reasons:" : null,
      ...skippedLines,
      preview.orderNotes ? `Reviewed notes: ${preview.orderNotes.slice(0, 1000)}` : null,
    ].filter(Boolean).join("\n");

    const result = await this.repository.createQuoteDraftFromInboundReview(args.organizationId, {
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      customerId: record.matchedCustomerId ?? null,
      contactId: record.matchedContactId ?? null,
      customerName: preview.customer.customerName ?? "Inbound customer",
      contactName: preview.contact.contactName,
      contactEmail: preview.contact.email,
      contactPhone: preview.contact.phone,
      label: preview.label ?? `Inbound ${record.id.slice(0, 8)}`,
      listLabel,
      snapshotId: latestReviewSnapshot.id,
      snapshotVersion: latestReviewSnapshot.snapshotVersion,
      lineItems: preview.lineItemsToConvert,
      skippedLineItems: preview.skippedLineItems,
      conversionMetadata,
    });

    // Future order conversion should begin from the linked quote, not by mutating inbound snapshots.
    if (!result) {
      const refreshed = await this.getDetail({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
      });
      const convertedQuoteId = refreshed?.record.createdQuoteId;
      if (convertedQuoteId) {
        const existingQuote = await this.repository.getQuote(args.organizationId, convertedQuoteId);
        if (existingQuote && refreshed) {
          return {
            quote: {
              id: existingQuote.id,
              quoteNumber: existingQuote.quoteNumber,
              reference: quoteReference(existingQuote),
              status: existingQuote.status,
              customerId: existingQuote.customerId ?? null,
              contactId: existingQuote.contactId ?? null,
              customerName: existingQuote.customerName ?? null,
              contactName: refreshed.matchedContact?.name ?? null,
              totalPrice: existingQuote.totalPrice,
              createdAt: existingQuote.createdAt,
              lineItemsCreated: 0,
              convertedLineItemCount: 0,
              skippedLineItemCount: 0,
              skippedLineItems: [],
              alreadyConverted: true,
            },
            inbound: refreshed,
          };
        }
      }

      throw new InboundOrderTransitionError("Inbound record has already been converted.");
    }

    const refreshedDetail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!refreshedDetail) {
      throw new InboundOrderTransitionError("Inbound order record not found after quote conversion", 404);
    }

    return {
      quote: {
        id: result.quote.id,
        quoteNumber: result.quote.quoteNumber,
        reference: quoteReference(result.quote),
        status: result.quote.status,
        customerId: result.quote.customerId ?? null,
        contactId: result.quote.contactId ?? null,
        customerName: result.quote.customerName ?? null,
        contactName: preview.contact.contactName,
        totalPrice: result.quote.totalPrice,
        createdAt: result.quote.createdAt,
        lineItemsCreated: result.lineItems.length,
        convertedLineItemCount: result.lineItems.length,
        skippedLineItemCount: result.skippedLineItems.length,
        skippedLineItems: result.skippedLineItems,
      },
      inbound: refreshedDetail,
    };
  }

  private buildQuoteDraftPreview(detail: InboundOrderDetail): InboundQuoteDraftPreview {
    const { record, latestReviewSnapshot } = detail;
    const blockingReasons: string[] = [];
    const snapshotKind = stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "metadata.snapshotKind"));

    if (record.status === rejectedStatus || record.reviewOutcome === "rejected") {
      blockingReasons.push("Rejected inbound records must be reopened before quote conversion.");
    }

    if (record.createdQuoteId) {
      blockingReasons.push("Inbound record already has a converted quote.");
    }

    if (record.status !== reviewedStatus) {
      blockingReasons.push("Inbound record must be marked reviewed before creating a quote draft.");
    }

    if (!latestReviewSnapshot) {
      blockingReasons.push("A staff review snapshot is required before quote conversion.");
    } else if (snapshotKind !== "staff_review_draft") {
      blockingReasons.push("Latest review snapshot is not a staff-reviewed draft.");
    }

    const sourceLineItemsById = new Map(detail.lineItems.map((lineItem) => [lineItem.id, lineItem]));
    const lineItemDraftsValue = getPathValue(latestReviewSnapshot?.payloadJson, "lineItemDrafts");
    const lineItemDrafts = Array.isArray(lineItemDraftsValue) ? lineItemDraftsValue : [];
    const lineItemsToConvert: InboundQuoteDraftPreviewLineItem[] = [];
    const skippedLineItems: InboundQuoteDraftSkippedLineItem[] = [];

    for (let index = 0; index < lineItemDrafts.length; index += 1) {
      const rawDraft = lineItemDrafts[index];
      const draft = asRecord(rawDraft) ?? {};
      const sourceLineItemId = stringFromUnknown(draft.sourceLineItemId);
      const sourceLineItem = sourceLineItemId ? sourceLineItemsById.get(sourceLineItemId) : null;
      const productName = stringFromUnknown(draft.productName)
        ?? sourceLineItem?.productNameRaw
        ?? sourceLineItem?.description
        ?? null;

      if (!sourceLineItemId || !sourceLineItem) {
        skippedLineItems.push({
          index,
          sourceLineItemId,
          productName,
          reason: "missing_snapshot_row_linkage",
          detail: sourceLineItemId
            ? "Snapshot row references an inbound line item that was not found."
            : "Snapshot row is not linked to an inbound line item.",
        });
        continue;
      }

      const productId = sourceLineItem.productId ?? null;
      const width = positiveNumberFromUnknown(draft.width) ?? positiveNumberFromUnknown(sourceLineItem.width);
      const height = positiveNumberFromUnknown(draft.height) ?? positiveNumberFromUnknown(sourceLineItem.height);
      const quantity = positiveIntegerFromUnknown(draft.quantity) ?? positiveIntegerFromUnknown(sourceLineItem.quantity);

      if (!productId) {
        skippedLineItems.push({
          index,
          sourceLineItemId,
          productName,
          reason: "no_matched_product",
          detail: "Inbound line item does not have a matched product.",
        });
        continue;
      }

      if (!width || !height) {
        skippedLineItems.push({
          index,
          sourceLineItemId,
          productName,
          reason: "invalid_dimensions",
          detail: "Line item needs positive width and height before conversion.",
        });
        continue;
      }

      if (!quantity) {
        skippedLineItems.push({
          index,
          sourceLineItemId,
          productName,
          reason: "missing_quantity",
          detail: "Line item needs a positive quantity before conversion.",
        });
        continue;
      }

      lineItemsToConvert.push({
        index,
        sourceLineItemId,
        productId,
        variantId: sourceLineItem.variantId ?? stringFromUnknown(draft.variantId),
        productName: productName ?? "Inbound review item",
        description: stringFromUnknown(draft.description) ?? sourceLineItem.description ?? null,
        productType: stringFromUnknown(draft.productType),
        width,
        height,
        quantity,
        notes: stringFromUnknown(draft.notes),
        snapshotJson: draft,
      });
    }

    const customerName = detail.matchedCustomer?.companyName
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "customerDraft.name"))
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "customerDraft.text"))
      ?? record.sourceLabel
      ?? null;
    const contactName = detail.matchedContact?.name
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.name"));
    const contactEmail = detail.matchedContact?.email
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.email"));
    const contactPhone = detail.matchedContact?.phone
      ?? detail.matchedContact?.mobile
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.phone"));
    const desiredOutputType = stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "desiredOutputType"));
    const orderNotes = stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "orderNotes"));
    const externalReference = record.externalReference ?? record.sourceRecordId ?? record.id.slice(0, 8);

    return {
      eligible: blockingReasons.length === 0,
      blockingReasons,
      alreadyConverted: Boolean(record.createdQuoteId),
      latestSnapshot: {
        id: latestReviewSnapshot?.id ?? null,
        snapshotVersion: latestReviewSnapshot?.snapshotVersion ?? null,
        snapshotType: latestReviewSnapshot?.snapshotType ?? null,
        snapshotKind,
        createdAt: latestReviewSnapshot?.createdAt ?? null,
      },
      customer: {
        matchedCustomerId: record.matchedCustomerId ?? null,
        customerName,
        source: record.matchedCustomerId ? "matched_customer" : customerName ? "manual_text" : "missing",
      },
      contact: {
        matchedContactId: record.matchedContactId ?? null,
        contactName,
        email: contactEmail,
        phone: contactPhone,
        source: record.matchedContactId
          ? "matched_contact"
          : contactName || contactEmail || contactPhone
            ? "snapshot_text"
            : "missing",
      },
      desiredOutputType,
      orderNotes,
      label: `Inbound ${externalReference}`,
      lineItemsToConvert,
      skippedLineItems,
      warningsSummary: {
        total: detail.warnings.length,
        blocking: detail.warnings.filter((warning) => warning.severity === "blocking").length,
        warning: detail.warnings.filter((warning) => warning.severity === "warning").length,
        info: detail.warnings.filter((warning) => warning.severity === "info").length,
        open: detail.warnings.filter((warning) => warning.status === "open").length,
      },
      decisionFlagsSummary: {
        total: detail.decisionFlags.length,
        open: detail.decisionFlags.filter((flag) => flag.status === "open").length,
        accepted: detail.decisionFlags.filter((flag) => flag.status === "accepted").length,
        overridden: detail.decisionFlags.filter((flag) => flag.status === "overridden").length,
        dismissed: detail.decisionFlags.filter((flag) => flag.status === "dismissed").length,
      },
    };
  }

  private async attachQuoteLinkage(
    organizationId: string,
    detail: InboundOrderDetail,
  ): Promise<InboundOrderDetail> {
    const quoteId = detail.record.createdQuoteId;

    if (!quoteId) {
      return detail;
    }

    const quote = await this.repository.getQuote(organizationId, quoteId);
    const quoteCreatedEvent = detail.events.find((event) => (
      event.eventType === "review.quote_created"
      && stringFromUnknown(getPathValue(event.metadataJson, "quoteId")) === quoteId
    ));
    const originalQuoteStatus = stringFromUnknown(getPathValue(quoteCreatedEvent?.metadataJson, "quoteStatus"))
      ?? originalInboundQuoteStatus;
    const lastSyncEventAt = this.getLastQuoteSyncEventAt(detail.events, quoteId);

    if (!quote) {
      let events = detail.events;
      const alreadyLoggedMissing = events.some((event) => (
        event.eventType === "review.quote_deleted"
        && stringFromUnknown(getPathValue(event.metadataJson, "quoteId")) === quoteId
      ));

      if (!alreadyLoggedMissing) {
        await this.createQuoteLinkageEvent({
          organizationId,
          detail,
          eventType: "review.quote_deleted",
          message: "Linked quote could not be found or is no longer accessible.",
          metadataJson: {
            quoteId,
            syncStatus: "quote_deleted_or_inaccessible",
          },
        });
        events = await this.repository.listEvents(organizationId, detail.record.id);
      }

      return {
        ...detail,
        events,
        linkedQuote: null,
        quoteActivity: {
          syncStatus: "quote_deleted_or_inaccessible",
          lastQuoteUpdatedAt: null,
          currentQuoteStatus: null,
          originalQuoteStatus,
          divergedFromReviewSnapshot: true,
          divergenceReasons: ["Linked quote is missing or inaccessible."],
          lastSyncEventAt: alreadyLoggedMissing ? lastSyncEventAt : events[0]?.createdAt ?? lastSyncEventAt,
        },
      };
    }

    const statusChanged = quote.status !== originalQuoteStatus;
    let events = detail.events;

    if (statusChanged) {
      const alreadyLoggedStatus = events.some((event) => (
        event.eventType === "review.quote_status_changed"
        && stringFromUnknown(getPathValue(event.metadataJson, "quoteId")) === quote.id
        && stringFromUnknown(getPathValue(event.metadataJson, "currentQuoteStatus")) === quote.status
      ));

      if (!alreadyLoggedStatus) {
        await this.createQuoteLinkageEvent({
          organizationId,
          detail,
          eventType: "review.quote_status_changed",
          message: `Linked quote status changed from ${originalQuoteStatus} to ${quote.status}.`,
          metadataJson: {
            quoteId: quote.id,
            quoteNumber: quote.quoteNumber,
            originalQuoteStatus,
            currentQuoteStatus: quote.status,
            syncStatus: "quote_status_changed",
          },
        });
        events = await this.repository.listEvents(organizationId, detail.record.id);
      }
    }

    return {
      ...detail,
      events,
      linkedQuote: {
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        reference: quoteReference(quote),
        status: quote.status,
        createdAt: quote.createdAt,
        updatedAt: quote.createdAt,
        customerId: quote.customerId ?? null,
        contactId: quote.contactId ?? null,
        customerName: quote.customerName ?? null,
      },
      quoteActivity: {
        syncStatus: statusChanged ? "quote_status_changed" : "quote_exists",
        lastQuoteUpdatedAt: quote.createdAt,
        currentQuoteStatus: quote.status,
        originalQuoteStatus,
        divergedFromReviewSnapshot: statusChanged,
        divergenceReasons: statusChanged
          ? [`Linked quote status is now ${quote.status}; inbound conversion created it as ${originalQuoteStatus}.`]
          : [],
        lastSyncEventAt: this.getLastQuoteSyncEventAt(events, quote.id),
      },
    };
  }

  private async createQuoteLinkageEvent(args: {
    organizationId: string;
    detail: InboundOrderDetail;
    eventType: "review.quote_status_changed" | "review.quote_deleted";
    message: string;
    metadataJson: Record<string, unknown>;
  }): Promise<void> {
    const event: CreateInboundOrderEventValues = {
      organizationId: args.organizationId,
      inboundRecordId: args.detail.record.id,
      actorUserId: null,
      actorType: "system",
      eventType: args.eventType,
      fromStatus: args.detail.record.status,
      toStatus: args.detail.record.status,
      message: args.message,
      metadataJson: args.metadataJson,
    };

    await this.repository.createEvent(event);
  }

  private getLastQuoteSyncEventAt(events: InboundOrderEvent[], quoteId: string): Date | null {
    const event = events.find((candidate) => (
      (candidate.eventType === "review.quote_status_changed" || candidate.eventType === "review.quote_deleted")
      && stringFromUnknown(getPathValue(candidate.metadataJson, "quoteId")) === quoteId
    ));

    return event?.createdAt ?? null;
  }

  private getReviewActionPatch(
    record: InboundOrderRecord,
    action: InboundOrderReviewAction,
    note: string | null,
    actorUserId: string,
  ): UpdateInboundOrderRecordValues {
    if (record.status === rejectedStatus && action !== "reopen") {
      throw new InboundOrderTransitionError("Rejected inbound records must be reopened before other review actions.");
    }

    if (record.status === reviewedStatus && action !== "reopen") {
      throw new InboundOrderTransitionError("Reviewed inbound records can only be reopened until conversion is available.");
    }

    if (record.status === "approved" || record.status === "submitted") {
      throw new InboundOrderTransitionError("This inbound record has moved beyond review and cannot be changed here.");
    }

    if (action === "mark-reviewed") {
      return {
        status: reviewedStatus,
        reviewOutcome: "reviewed",
        requiresHumanDecision: false,
        reviewRequiredReason: null,
        approvedAt: new Date(),
      };
    }

    if (action === "needs-clarification") {
      return {
        status: needsClarificationStatus,
        reviewOutcome: "needs_clarification",
        requiresHumanDecision: true,
        reviewRequiredReason: note ?? "Clarification requested by staff",
      };
    }

    if (action === "reject") {
      return {
        status: rejectedStatus,
        reviewOutcome: "rejected",
        requiresHumanDecision: false,
        reviewRequiredReason: null,
        rejectionReason: note ?? "Rejected by staff",
        rejectedByUserId: actorUserId,
        rejectedAt: new Date(),
      };
    }

    return {
      status: reopenedStatus,
      reviewOutcome: "reopened",
      requiresHumanDecision: true,
      reviewRequiredReason: note ?? "Reopened for review",
      rejectionReason: null,
      rejectedByUserId: null,
      rejectedAt: null,
      approvedAt: null,
    };
  }
}

export const inboundOrderService = new InboundOrderService();
