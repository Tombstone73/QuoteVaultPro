import {
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
  type Quote,
  type OrderWithRelations,
} from "@shared/schema";
import {
  inboundOrderParsedDraftSchema,
  inboundOrderReviewDraftPayloadSchema,
  type InboundOrderParsedDraft,
  type InboundOrderReviewDraftDto,
  type InboundOrderReviewDraftPayload,
  type InboundOrderReviewReadinessScore,
  type InboundOrderReviewDraftSaveRequest,
  type InboundOrderReviewDraftStatus,
  type InboundOrderProductOptionsResponse,
  type ManualInboundOrderCreateRequest,
} from "@shared/inboundOrdersApi";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import {
  getInboundPbv2RequiredOptions,
  getMissingInboundPbv2RequiredOptions,
  hydrateInboundPbv2Selections,
} from "@shared/inboundOrderPbv2Options";
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
import {
  OrdersRepository,
  type CreateOrderLineItemInput,
} from "../../storage/orders.repo";
import { priceLineItem } from "../pricing/PricingService";

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
  reference?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  bodyText?: string;
  notes?: string | null;
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

export type InboundOrderStatusUpdateInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  status: InboundOrderRecordStatus;
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

export type InboundOrderReviewDraftInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
};

export type SaveInboundOrderEditableReviewDraftInput = InboundOrderReviewDraftInput & {
  draft: InboundOrderReviewDraftSaveRequest;
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

export type ConvertInboundReviewDraftToOrderResult = {
  orderId: string;
  inboundOrderId: string;
  convertedAt: string;
  order: OrderWithRelations;
  inbound: InboundOrderDetail;
  alreadyConverted?: boolean;
};

export class InboundOrderTransitionError extends Error {
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "InboundOrderTransitionError";
  }
}

export class InboundOrderReviewDraftValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "InboundOrderReviewDraftValidationError";
  }
}

export class InboundOrderConversionValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "InboundOrderConversionValidationError";
  }
}

const reviewedStatus: InboundOrderRecordStatus = "ready";
const needsClarificationStatus: InboundOrderRecordStatus = "waiting_on_customer";
const rejectedStatus: InboundOrderRecordStatus = "terminal";
const reopenedStatus: InboundOrderRecordStatus = "needs_review";
const originalInboundQuoteStatus = "draft";
const editableReviewDraftKind = "editable_review_draft";

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

function formatRequiredOptionList(labels: string[]): string {
  const unique = Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)));
  if (unique.length <= 1) return unique[0] ?? "required options";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function formatReadinessLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeInboundReviewedDueDate(value: string | null | undefined, receivedAt: Date | string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;

  const compactMatch = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (compactMatch) {
    const receivedDate = receivedAt instanceof Date ? receivedAt : new Date(receivedAt ?? Date.now());
    const fallbackYear = Number.isNaN(receivedDate.getTime()) ? new Date().getFullYear() : receivedDate.getFullYear();
    const month = Number(compactMatch[1]);
    const day = Number(compactMatch[2]);
    const rawYear = compactMatch[3] ? Number(compactMatch[3]) : fallbackYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
}

export class InboundOrderService {
  constructor(
    private readonly repository = inboundOrdersRepository,
    private readonly orderRepository = new OrdersRepository(),
    private readonly priceLineItemFn = priceLineItem,
  ) {}

  async listInboundOrders(args: {
    organizationId: string;
    filters: InboundOrderListFilters;
  }): Promise<InboundOrderListResult> {
    return this.listRecords(args);
  }

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

  async getInboundOrderCounts(args: { organizationId: string }): Promise<InboundOrderQueueSummary> {
    return this.repository.getInboundOrderCounts(args.organizationId);
  }

  async getInboundOrder(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<InboundOrderDetail | null> {
    return this.getDetail(args);
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

  async createManualInboundOrder(args: ManualInboundOrderCreateInput & ManualInboundOrderCreateRequest): Promise<{
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  }> {
    const reference = args.reference?.trim() || null;
    const senderName = args.senderName?.trim() || null;
    const senderEmail = args.senderEmail?.trim() || null;
    const subject = args.subject?.trim() || null;
    const bodyText = args.bodyText.trim();
    const notes = args.notes?.trim() || null;

    return this.createManualRecord({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      sourceLabel: "TEMP_INBOUND manual intake",
      externalReference: reference,
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference,
        sender: {
          name: senderName,
          email: senderEmail,
        },
        subject,
        bodyText,
        notes,
      },
      normalizedPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        source: {
          type: "manual",
          label: "Manual intake",
        },
        sender: {
          name: senderName,
          email: senderEmail,
        },
        reference,
        subject,
        bodyText,
        notes,
      },
      extractedCustomerJson: {
        senderName,
        senderEmail,
      },
      extractedOrderJson: {
        reference,
        subject,
        bodyText,
        notes,
      },
      extractedShippingJson: {},
      requiresHumanDecision: true,
      reviewRequiredReason: "Manual TEMP_INBOUND record needs staff review.",
    });
  }

  async createManualRecord(args: ManualInboundOrderCreateInput): Promise<{
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  }> {
    const status: InboundOrderRecordStatus = "needs_review";
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
        requiresHumanDecision: args.requiresHumanDecision ?? true,
        reviewRequiredReason: args.reviewRequiredReason ?? "Manual inbound record needs staff review.",
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
        message: "Manual TEMP_INBOUND record created for review",
        metadataJson: {
          sourceType,
          sourceTrustLevel: "manual_internal",
          intakeState: "TEMP_INBOUND",
        },
      },
    });
  }

  async updateInboundOrderStatus(args: InboundOrderStatusUpdateInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);

    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (record.createdQuoteId || record.createdOrderId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot be moved by Phase 1 status updates.");
    }

    const status = args.status;
    const now = new Date();
    const patch: UpdateInboundOrderRecordValues = {
      status,
      reviewOutcome: status === "terminal"
        ? "rejected"
        : status === "ready"
          ? "reviewed"
          : status === "waiting_on_customer"
            ? "needs_clarification"
            : null,
      requiresHumanDecision: status === "needs_review" || status === "waiting_on_customer",
      reviewRequiredReason: status === "needs_review"
        ? "Manual TEMP_INBOUND record needs staff review."
        : status === "waiting_on_customer"
          ? "Waiting for clarification before review can continue."
          : null,
      rejectedAt: status === "terminal" ? now : null,
      rejectedByUserId: status === "terminal" ? args.actorUserId : null,
      rejectionReason: status === "terminal" ? "Rejected during inbound review." : null,
      approvedAt: status === "ready" ? now : null,
      submittedAt: status === "submitted" ? now : null,
    };

    const updated = await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch,
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.status_updated",
        fromStatus: record.status,
        toStatus: status,
        message: null,
        metadataJson: {
          phase: "inbound_orders_phase_1",
          reviewOnly: true,
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
      throw new InboundOrderTransitionError("Inbound order record not found after status update", 404);
    }

    return detail;
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

  async getReviewDraft(args: InboundOrderReviewDraftInput): Promise<InboundOrderReviewDraftDto> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const existingSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    if (existingSnapshot) {
      const hydratedSnapshot = await this.backfillInterpretedCustomerContactSelection({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        record,
        snapshot: existingSnapshot,
        latestAttempt,
      });
      return this.reviewDraftDtoFromSnapshot(record, hydratedSnapshot, latestAttempt, false);
    }

    this.assertReviewDraftEditable(record);
    const parsedDraft = this.parsedDraftFromAttempt(latestAttempt);
    if (!latestAttempt || !parsedDraft) {
      throw new InboundOrderTransitionError("Parse the inbound order before starting editable draft review.", 409);
    }

    const payload = await this.buildEditableReviewDraftFromParse({
      organizationId: args.organizationId,
      record,
      draft: parsedDraft,
    });
    const snapshot = await this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record,
      latestAttempt,
      payload,
      status: "draft",
      eventType: "review_draft.initialized",
      message: "Editable review draft initialized from latest parse.",
      initializedFromParse: true,
    });

    return this.reviewDraftDtoFromSnapshot(record, snapshot, latestAttempt, true);
  }

  async saveReviewDraft(args: SaveInboundOrderEditableReviewDraftInput): Promise<InboundOrderReviewDraftDto> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    this.assertReviewDraftEditable(record);

    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const existingSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    if (existingSnapshot) {
      const existingStatus = this.reviewDraftPayloadFromSnapshot(existingSnapshot)?.status;
      if (existingStatus === "ready_to_convert") {
        throw new InboundOrderTransitionError("Ready review drafts must be reopened before staff edits can be saved.", 409);
      }
    }

    const sourceAttempt = await this.resolveReviewDraftSourceAttempt(args.organizationId, args.inboundRecordId, existingSnapshot, latestAttempt);
    const payload = this.normalizeReviewDraftPayload(record, inboundOrderReviewDraftPayloadSchema.parse({
      ...args.draft,
      status: "draft",
    }));
    const snapshot = await this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record,
      latestAttempt: sourceAttempt,
      payload,
      status: "draft",
      eventType: "review_draft.saved",
      message: payload.reviewNotes,
      initializedFromParse: false,
    });

    return this.reviewDraftDtoFromSnapshot(record, snapshot, latestAttempt, false);
  }

  async markReviewDraftReady(args: InboundOrderReviewDraftInput): Promise<InboundOrderReviewDraftDto> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    this.assertReviewDraftEditable(record);

    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const existingSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    const baseDto = existingSnapshot
      ? this.reviewDraftDtoFromSnapshot(record, existingSnapshot, latestAttempt, false)
      : await this.getReviewDraft(args);
    const errors = await this.validateReviewDraftReadyForMarkReady(args.organizationId, baseDto);
    if (errors.length > 0) {
      throw new InboundOrderReviewDraftValidationError("Review draft is not ready to convert.", errors);
    }

    const sourceAttempt = await this.resolveReviewDraftSourceAttempt(args.organizationId, args.inboundRecordId, existingSnapshot, latestAttempt);
    const payload = this.normalizeReviewDraftPayload(record, inboundOrderReviewDraftPayloadSchema.parse({
      status: "ready_to_convert",
      reviewedCustomerJson: baseDto.reviewedCustomerJson,
      reviewedOrderJson: baseDto.reviewedOrderJson,
      reviewedLineItemsJson: baseDto.reviewedLineItemsJson,
      reviewedArtworkJson: baseDto.reviewedArtworkJson,
      missingDecisionsJson: baseDto.missingDecisionsJson,
      warningsJson: baseDto.warningsJson,
      reviewNotes: baseDto.reviewNotes,
    }));
    const snapshot = await this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record,
      latestAttempt: sourceAttempt,
      payload,
      status: "ready_to_convert",
      eventType: "review_draft.marked_ready",
      message: "Editable review draft marked ready to convert. No order was created.",
      initializedFromParse: false,
      recordPatch: {
        status: reviewedStatus,
        reviewOutcome: "reviewed",
        requiresHumanDecision: false,
        reviewRequiredReason: null,
        approvedAt: new Date(),
      },
    });

    const refreshedRecord = await this.repository.getRecord(args.organizationId, args.inboundRecordId) ?? {
      ...record,
      status: reviewedStatus,
    };
    return this.reviewDraftDtoFromSnapshot(refreshedRecord, snapshot, latestAttempt, false);
  }

  async reopenReviewDraft(args: InboundOrderReviewDraftInput): Promise<InboundOrderReviewDraftDto> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    this.assertReviewDraftEditable(record, { allowReady: true });

    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const existingSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    if (!existingSnapshot) {
      throw new InboundOrderTransitionError("No editable review draft exists to reopen.", 404);
    }
    const existingPayload = this.reviewDraftPayloadFromSnapshot(existingSnapshot);
    if (!existingPayload) {
      throw new InboundOrderTransitionError("Latest editable review draft is invalid and cannot be reopened.", 409);
    }
    const sourceAttempt = await this.resolveReviewDraftSourceAttempt(args.organizationId, args.inboundRecordId, existingSnapshot, latestAttempt);
    const payload = this.normalizeReviewDraftPayload(record, inboundOrderReviewDraftPayloadSchema.parse({
      ...existingPayload,
      status: "draft",
    }));
    const snapshot = await this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record,
      latestAttempt: sourceAttempt,
      payload,
      status: "draft",
      eventType: "review_draft.reopened",
      message: "Editable review draft reopened for staff edits.",
      initializedFromParse: false,
      recordPatch: {
        status: reopenedStatus,
        reviewOutcome: null,
        requiresHumanDecision: true,
        reviewRequiredReason: "Editable review draft reopened for staff review.",
        approvedAt: null,
      },
    });

    const refreshedRecord = await this.repository.getRecord(args.organizationId, args.inboundRecordId) ?? {
      ...record,
      status: reopenedStatus,
    };
    return this.reviewDraftDtoFromSnapshot(refreshedRecord, snapshot, latestAttempt, false);
  }

  async refreshReviewDraftFromLatestParse(args: InboundOrderReviewDraftInput): Promise<InboundOrderReviewDraftDto> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    this.assertReviewDraftEditable(record, { allowReady: true });

    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const parsedDraft = this.parsedDraftFromAttempt(latestAttempt);
    if (!latestAttempt || !parsedDraft) {
      throw new InboundOrderTransitionError("Parse the inbound order before refreshing the review draft.", 409);
    }

    const payload = await this.buildEditableReviewDraftFromParse({
      organizationId: args.organizationId,
      record,
      draft: parsedDraft,
    });

    const snapshot = await this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record,
      latestAttempt,
      payload,
      status: "draft",
      eventType: "review_draft.refreshed_from_latest_parse",
      message: "Editable review draft refreshed from latest parse. Previous staff draft remains in snapshot history.",
      initializedFromParse: true,
      recordPatch: record.status === "ready"
        ? {
            status: "needs_review",
            reviewOutcome: null,
            requiresHumanDecision: true,
            reviewRequiredReason: "Editable review draft refreshed from latest parse.",
            approvedAt: null,
          }
        : undefined,
    });

    const refreshedRecord = record.status === "ready"
      ? await this.repository.getRecord(args.organizationId, args.inboundRecordId) ?? { ...record, status: "needs_review" as const }
      : record;

    return this.reviewDraftDtoFromSnapshot(refreshedRecord, snapshot, latestAttempt, true);
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
    customerId?: string | null;
    search?: string | null;
    limit: number;
  }): Promise<InboundContactSearchResult[]> {
    const customerId = args.customerId?.trim() || null;
    if (customerId) {
      const customer = await this.repository.getCustomer(args.organizationId, customerId);
      if (!customer) {
        throw new InboundOrderTransitionError("Customer not found for this organization", 404);
      }
    }

    return this.repository.searchCustomerContacts(
      args.organizationId,
      customerId,
      args.search ?? null,
      args.limit,
    );
  }

  async getProductOptionsForReview(args: {
    organizationId: string;
    productId: string;
    lineItem?: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number] | null;
  }): Promise<InboundOrderProductOptionsResponse["data"]> {
    const result = await this.repository.getProductActivePbv2Tree(args.organizationId, args.productId);
    if (!result) {
      throw new InboundOrderTransitionError("Product not found", 404);
    }

    const treeJson = (result.activeTree?.treeJson ?? null) as OptionTreeV2 | null;
    const suggestionResult = hydrateInboundPbv2Selections(
      treeJson,
      args.lineItem ? this.lineItemOptionEvidenceText(args.lineItem) : "",
    );

    return {
      productId: result.product.id,
      productName: result.product.name ?? null,
      activeTreeVersionId: result.activeTree?.id ?? result.product.pbv2ActiveTreeVersionId ?? null,
      treeJson,
      requiredOptions: getInboundPbv2RequiredOptions(treeJson, suggestionResult.selections),
      suggestedSelections: suggestionResult.selections,
      suggestions: suggestionResult.suggestions,
    };
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

  async convertInboundReviewDraftToOrder(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
  }): Promise<ConvertInboundReviewDraftToOrderResult> {
    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });

    if (!detail) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (detail.record.createdOrderId) {
      const existingOrder = await this.orderRepository.getOrderById(args.organizationId, detail.record.createdOrderId);
      if (!existingOrder) {
        throw new InboundOrderTransitionError("Inbound record is linked to an order that could not be loaded.", 409);
      }
      return {
        orderId: existingOrder.id,
        inboundOrderId: detail.record.id,
        convertedAt: formatInboundDate(detail.record.submittedAt ?? detail.record.updatedAt) ?? new Date().toISOString(),
        order: existingOrder,
        inbound: detail,
        alreadyConverted: true,
      };
    }

    const latestSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    const payload = latestSnapshot ? this.reviewDraftPayloadFromSnapshot(latestSnapshot) : null;
    const validationErrors = await this.validateInboundOrderConversion(detail, payload);

    if (validationErrors.length > 0 || !payload || !latestSnapshot) {
      const errors = validationErrors.length > 0 ? validationErrors : ["Reviewed draft is missing."];
      await this.recordConversionValidationFailure(args, errors);
      throw new InboundOrderConversionValidationError("Inbound review draft is not ready for order conversion.", errors);
    }

    const claimed = await this.repository.claimInboundOrderForOrderConversion({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
    });

    if (!claimed) {
      const latest = await this.getDetail({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
      });
      if (latest?.record.createdOrderId) {
        const existingOrder = await this.orderRepository.getOrderById(args.organizationId, latest.record.createdOrderId);
        if (!existingOrder) {
          throw new InboundOrderTransitionError("Inbound record is linked to an order that could not be loaded.", 409);
        }
        return {
          orderId: existingOrder.id,
          inboundOrderId: latest.record.id,
          convertedAt: formatInboundDate(latest.record.submittedAt ?? latest.record.updatedAt) ?? new Date().toISOString(),
          order: existingOrder,
          inbound: latest,
          alreadyConverted: true,
        };
      }
      throw new InboundOrderTransitionError("Inbound record is not ready for order conversion.", 409);
    }

    try {
      const orderInput = await this.buildOrderCreateInputFromInboundReview({
        detail,
        snapshotId: latestSnapshot.id,
        snapshotVersion: latestSnapshot.snapshotVersion,
        payload,
        actorUserId: args.actorUserId,
      });
      const order = await this.orderRepository.createOrder(args.organizationId, orderInput);

      const lineItemLinks = (order.lineItems ?? []).map((lineItem: any, index: number) => ({
        inboundLineItemId: stringFromUnknown(getPathValue(lineItem.specsJson, "inbound.sourceLineItemId"))
          ?? payload.reviewedLineItemsJson[index]?.sourceLineItemId
          ?? null,
        orderLineItemId: String(lineItem.id),
      }));

      await this.repository.markInboundOrderConvertedToOrder({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        orderId: order.id,
        orderNumber: order.orderNumber ?? null,
        lineItemLinks,
      });

      const latestParseAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
      await this.orderRepository.createOrderAuditLog({
        orderId: order.id,
        userId: args.actorUserId,
        userName: null,
        actionType: "inbound_order_converted",
        fromStatus: null,
        toStatus: "new",
        note: "Inbound order converted to draft order.",
        metadata: {
          inboundRecordId: args.inboundRecordId,
          inboundReference: detail.record.externalReference ?? null,
          sourceSubject: stringFromUnknown(getPathValue(detail.record.rawPayloadJson, "subject")),
          sourceReference: detail.record.externalReference ?? null,
          convertedAt: new Date().toISOString(),
          parseConfidence: latestParseAttempt?.confidence ?? null,
          poNumber: payload.reviewedOrderJson.poNumber ?? null,
        },
      } as any);

      const inbound = await this.getDetail({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
      });

      if (!inbound) {
        throw new InboundOrderTransitionError("Inbound order record not found after conversion", 404);
      }

      return {
        orderId: order.id,
        inboundOrderId: args.inboundRecordId,
        convertedAt: formatInboundDate(inbound.record.submittedAt ?? inbound.record.updatedAt) ?? new Date().toISOString(),
        order,
        inbound,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create draft order from inbound review.";
      await this.repository.markInboundOrderConversionFailed({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        message,
        errors: [message],
      });
      throw error;
    }
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

  private async getLatestEditableReviewDraftSnapshot(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<InboundOrderReviewSnapshot | null> {
    const snapshots = await this.repository.listReviewSnapshots(organizationId, inboundRecordId);
    return snapshots.find((snapshot) => (
      stringFromUnknown(getPathValue(snapshot.payloadJson, "metadata.snapshotKind")) === editableReviewDraftKind
    )) ?? null;
  }

  private parsedDraftFromAttempt(attempt: InboundOrderParseAttempt | null): InboundOrderParsedDraft | null {
    if (!attempt?.parsedDraft) return null;
    const parsed = inboundOrderParsedDraftSchema.safeParse(attempt.parsedDraft);
    return parsed.success ? parsed.data : null;
  }

  private reviewDraftPayloadFromSnapshot(snapshot: InboundOrderReviewSnapshot): InboundOrderReviewDraftPayload | null {
    const parsed = inboundOrderReviewDraftPayloadSchema.safeParse(snapshot.payloadJson);
    return parsed.success ? parsed.data : null;
  }

  private async buildEditableReviewDraftFromParse(args: {
    organizationId: string;
    record: InboundOrderRecord;
    draft: InboundOrderParsedDraft;
  }): Promise<InboundOrderReviewDraftPayload> {
    const { draft } = args;
    const warnings = [
      ...draft.globalWarnings,
      ...draft.customer.warnings,
      ...draft.order.warnings,
      ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
      ...draft.artwork.flatMap((artwork) => artwork.warnings),
    ];
    const hasArtwork = draft.artwork.length > 0 || draft.lineItems.some((lineItem) => lineItem.artworkRefs.length > 0);
    const customerInterpretation = await this.interpretCustomerAndContact(args.organizationId, draft);
    const reviewedLineItemsJson = [];
    for (const lineItem of draft.lineItems) {
      const productInterpretation = await this.interpretLineItemProduct(args.organizationId, lineItem);
      const selectedProductId = productInterpretation?.productId ?? lineItem.candidateProductIds[0] ?? null;
      let optionSelectionsJson: LineItemOptionSelectionsV2 | null = null;
      let pbv2TreeVersionId: string | null = null;
      let pbv2OptionSuggestions: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]["pbv2OptionSuggestions"] = [];

      if (selectedProductId) {
        const productOptions = await this.repository.getProductActivePbv2Tree(args.organizationId, selectedProductId);
        const treeJson = (productOptions?.activeTree?.treeJson ?? null) as OptionTreeV2 | null;
        if (treeJson) {
          const hydrated = hydrateInboundPbv2Selections(treeJson, this.lineItemOptionEvidenceText({
            sourceLineItemId: null,
            sourceText: lineItem.sourceText,
            productName: lineItem.productName,
            selectedProductId,
            interpretedProductId: productInterpretation?.productId ?? null,
            interpretedProductReason: productInterpretation?.reason ?? null,
            interpretedProductConfidence: productInterpretation?.confidence ?? null,
            productUnresolved: false,
            quantity: lineItem.quantity,
            width: lineItem.width,
            height: lineItem.height,
            dimensionsUnit: lineItem.dimensionsUnit,
            materialText: lineItem.materialText,
            printSpecs: lineItem.optionTexts,
            optionTexts: lineItem.optionTexts,
            finishingTexts: lineItem.finishingTexts,
            optionSelectionsJson: null,
            pbv2TreeVersionId: null,
            pbv2OptionSuggestions: [],
            notes: null,
          }));
          optionSelectionsJson = Object.keys(hydrated.selections.selected).length > 0 ? hydrated.selections : null;
          pbv2TreeVersionId = productOptions?.activeTree?.id ?? productOptions?.product.pbv2ActiveTreeVersionId ?? null;
          pbv2OptionSuggestions = hydrated.suggestions;
        }
      }

      reviewedLineItemsJson.push({
        sourceLineItemId: null,
        sourceText: lineItem.sourceText,
        productName: productInterpretation?.label ?? lineItem.productName,
        selectedProductId,
        interpretedProductId: productInterpretation?.productId ?? null,
        interpretedProductReason: productInterpretation?.reason ?? null,
        interpretedProductConfidence: productInterpretation?.confidence ?? null,
        productUnresolved: false,
        quantity: lineItem.quantity,
        width: lineItem.width,
        height: lineItem.height,
        dimensionsUnit: lineItem.dimensionsUnit,
        materialText: lineItem.materialText,
        printSpecs: lineItem.optionTexts,
        optionTexts: lineItem.optionTexts,
        finishingTexts: lineItem.finishingTexts,
        optionSelectionsJson,
        pbv2TreeVersionId,
        pbv2OptionSuggestions,
        notes: null,
      });
    }

    return inboundOrderReviewDraftPayloadSchema.parse({
      status: "draft",
      reviewedCustomerJson: {
        sourceName: draft.customer.sourceName,
        sourceEmail: draft.customer.sourceEmail,
        sourcePhone: draft.customer.sourcePhone,
        companyName: draft.customer.companyName,
        selectedCustomerId: customerInterpretation.customerId,
        selectedCustomerSource: customerInterpretation.customerSource,
        selectedCustomerReason: customerInterpretation.customerReason,
        selectedCustomerConfidence: customerInterpretation.customerConfidence,
        selectedContactId: customerInterpretation.contactId,
        selectedContactSource: customerInterpretation.contactSource,
        selectedContactReason: customerInterpretation.contactReason,
        selectedContactConfidence: customerInterpretation.contactConfidence,
        unresolvedCustomer: false,
        unresolvedContact: false,
        notes: null,
      },
      reviewedOrderJson: {
        poNumber: draft.order.poNumber,
        dueDate: normalizeInboundReviewedDueDate(draft.order.requestedDueDate, args.record.receivedAt),
        shipMethod: draft.order.requestedShipMethod,
        fulfillmentType: draft.order.requestedPickup === true ? "pickup" : "unknown",
        internalNotes: draft.order.notes,
        customerNotes: null,
      },
      reviewedLineItemsJson,
      reviewedArtworkJson: {
        status: hasArtwork ? "supplied" : "missing",
        refs: draft.artwork.map((artwork) => ({
          filename: artwork.filename,
          sourceReference: artwork.sourceReference,
          likelyLineItemIndex: artwork.likelyLineItemIndex,
          purpose: artwork.purpose,
        })),
        notes: null,
      },
      missingDecisionsJson: draft.missingDecisions.map((decision) => ({
        ...decision,
        status: "still_blocking",
        resolutionNote: null,
      })),
      warningsJson: warnings.map((item) => ({
        ...item,
        acknowledged: false,
        acknowledgementNote: null,
      })),
      reviewNotes: null,
    });
  }

  private normalizeReviewDraftPayload(
    record: InboundOrderRecord,
    payload: InboundOrderReviewDraftPayload,
  ): InboundOrderReviewDraftPayload {
    return inboundOrderReviewDraftPayloadSchema.parse({
      ...payload,
      reviewedOrderJson: {
        ...payload.reviewedOrderJson,
        dueDate: normalizeInboundReviewedDueDate(payload.reviewedOrderJson.dueDate, record.receivedAt),
      },
    });
  }

  private async backfillInterpretedCustomerContactSelection(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    record: InboundOrderRecord;
    snapshot: InboundOrderReviewSnapshot;
    latestAttempt: InboundOrderParseAttempt | null;
  }): Promise<InboundOrderReviewSnapshot> {
    const payload = this.reviewDraftPayloadFromSnapshot(args.snapshot);
    const parsedDraft = this.parsedDraftFromAttempt(args.latestAttempt);
    if (!payload || !parsedDraft || payload.status !== "draft") return args.snapshot;

    const snapshotSourceAttemptId = stringFromUnknown(getPathValue(args.snapshot.payloadJson, "metadata.sourceParseAttemptId"));
    if (snapshotSourceAttemptId && args.latestAttempt?.id && snapshotSourceAttemptId !== args.latestAttempt.id) {
      return args.snapshot;
    }

    const interpreted = await this.interpretCustomerAndContact(args.organizationId, parsedDraft);
    const customer = { ...payload.reviewedCustomerJson };
    let changed = false;

    if (!customer.selectedCustomerId && !customer.unresolvedCustomer && interpreted.customerId) {
      customer.selectedCustomerId = interpreted.customerId;
      customer.selectedCustomerSource = interpreted.customerSource;
      customer.selectedCustomerReason = interpreted.customerReason;
      customer.selectedCustomerConfidence = interpreted.customerConfidence;
      changed = true;
    }

    const customerMatchesInterpreted = Boolean(
      customer.selectedCustomerId
      && interpreted.customerId
      && customer.selectedCustomerId === interpreted.customerId,
    );
    if (
      customerMatchesInterpreted
      && !customer.selectedContactId
      && !customer.unresolvedContact
      && interpreted.contactId
    ) {
      customer.selectedContactId = interpreted.contactId;
      customer.selectedContactSource = interpreted.contactSource;
      customer.selectedContactReason = interpreted.contactReason;
      customer.selectedContactConfidence = interpreted.contactConfidence;
      changed = true;
    }

    if (!changed) return args.snapshot;

    const sourceAttempt = await this.resolveReviewDraftSourceAttempt(
      args.organizationId,
      args.inboundRecordId,
      args.snapshot,
      args.latestAttempt,
    );
    return this.persistEditableReviewDraftSnapshot({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      record: args.record,
      latestAttempt: sourceAttempt,
      payload: {
        ...payload,
        reviewedCustomerJson: customer,
      },
      status: payload.status,
      eventType: "review_draft.interpreted_customer_contact_backfilled",
      message: "Interpreted customer/contact selections backfilled into editable review draft.",
      initializedFromParse: false,
    });
  }

  private async interpretCustomerAndContact(
    organizationId: string,
    draft: InboundOrderParsedDraft,
  ): Promise<{
    customerId: string | null;
    customerSource: "interpreted_customer_match" | null;
    customerReason: string | null;
    customerConfidence: number | null;
    contactId: string | null;
    contactSource: "interpreted_contact_match" | null;
    contactReason: string | null;
    contactConfidence: number | null;
  }> {
    const customerCandidates = new Map<string, { id: string; confidence: number; reason: string }>();
    for (const candidate of draft.customer.customerCandidates) {
      customerCandidates.set(candidate.id, {
        id: candidate.id,
        confidence: candidate.confidence,
        reason: candidate.reason || "Matched parsed customer candidate.",
      });
    }

    const addCustomerSearchResults = (results: InboundCustomerSearchResult[], confidence: number, reason: string) => {
      for (const result of results) {
        const existing = customerCandidates.get(result.id);
        if (!existing) {
          customerCandidates.set(result.id, { id: result.id, confidence, reason });
        } else {
          customerCandidates.set(result.id, {
            id: result.id,
            confidence: Math.max(existing.confidence, confidence),
            reason: existing.reason.includes(reason) ? existing.reason : `${existing.reason} ${reason}`,
          });
        }
      }
    };

    const sourceEmail = draft.customer.sourceEmail?.trim() || null;
    const companyName = draft.customer.companyName?.trim() || draft.customer.sourceName?.trim() || null;
    if (sourceEmail) {
      addCustomerSearchResults(
        await this.repository.searchCustomers(organizationId, sourceEmail, 5),
        94,
        "Matched by sender email.",
      );
      const domain = sourceEmail.split("@")[1]?.trim();
      if (domain) {
        addCustomerSearchResults(
          await this.repository.searchCustomers(organizationId, domain, 5),
          88,
          "Matched by sender domain.",
        );
      }
    }
    if (companyName) {
      const matches = await this.repository.searchCustomers(organizationId, companyName, 5);
      addCustomerSearchResults(
        matches,
        matches.length === 1 ? 92 : 84,
        "Matched by company name.",
      );
    }

    const selectedCustomer = this.pickSingleStrongMatch(Array.from(customerCandidates.values()), 88);
    const selectedCustomerId = selectedCustomer?.id ?? null;

    const contactCandidates = new Map<string, { id: string; confidence: number; reason: string }>();
    for (const candidate of draft.customer.contactCandidates) {
      contactCandidates.set(candidate.id, {
        id: candidate.id,
        confidence: candidate.confidence,
        reason: candidate.reason || "Matched parsed contact candidate.",
      });
    }
    const addContactSearchResults = (results: InboundContactSearchResult[], confidence: number, reason: string) => {
      for (const result of results) {
        const existing = contactCandidates.get(result.id);
        if (!existing) {
          contactCandidates.set(result.id, { id: result.id, confidence, reason });
        } else {
          contactCandidates.set(result.id, {
            id: result.id,
            confidence: Math.max(existing.confidence, confidence),
            reason: existing.reason.includes(reason) ? existing.reason : `${existing.reason} ${reason}`,
          });
        }
      }
    };

    if (selectedCustomerId && sourceEmail) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, sourceEmail, 5),
        100,
        "Matched by email.",
      );
    }
    const contactName = draft.customer.sourceName?.trim() || null;
    if (selectedCustomerId && contactName) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, contactName, 5),
        86,
        "Matched by contact name.",
      );
    }
    if (selectedCustomerId && sourceEmail?.includes("@")) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, sourceEmail.split("@")[1], 5),
        80,
        "Matched by customer contact domain.",
      );
    }

    const selectedContact = selectedCustomerId
      ? this.pickSingleStrongMatch(Array.from(contactCandidates.values()), 80)
      : null;

    return {
      customerId: selectedCustomerId,
      customerSource: selectedCustomer ? "interpreted_customer_match" : null,
      customerReason: selectedCustomer ? selectedCustomer.reason : null,
      customerConfidence: selectedCustomer ? selectedCustomer.confidence : null,
      contactId: selectedContact?.id ?? null,
      contactSource: selectedContact ? "interpreted_contact_match" : null,
      contactReason: selectedContact ? selectedContact.reason : null,
      contactConfidence: selectedContact ? selectedContact.confidence : null,
    };
  }

  private async interpretLineItemProduct(
    organizationId: string,
    lineItem: InboundOrderParsedDraft["lineItems"][number],
  ): Promise<{ productId: string; label: string; confidence: number; reason: string } | null> {
    const candidates = new Map<string, { productId: string; label: string; confidence: number; reason: string }>();
    for (const candidate of lineItem.productCandidates) {
      const adjusted = this.adjustProductInterpretationConfidence({
        label: candidate.label,
        reason: candidate.reason,
        confidence: candidate.confidence,
        lineItem,
      });
      candidates.set(candidate.id, {
        productId: candidate.id,
        label: candidate.label,
        confidence: adjusted.confidence,
        reason: adjusted.reason || candidate.reason || "Matched parsed product candidate.",
      });
    }

    const canonicalMatches = await this.repository.searchProductCandidates({
      organizationId,
      sourceText: lineItem.sourceText,
      productName: lineItem.productName,
      materialText: lineItem.materialText,
      optionTexts: [...lineItem.optionTexts, ...lineItem.artworkRefs],
      finishingTexts: lineItem.finishingTexts,
      limit: 5,
    });
    for (const match of canonicalMatches) {
      const adjusted = this.adjustProductInterpretationConfidence({
        label: match.label,
        reason: match.reason,
        confidence: match.confidence,
        lineItem,
      });
      const existing = candidates.get(match.id);
      if (!existing || existing.confidence < adjusted.confidence) {
        candidates.set(match.id, {
          productId: match.id,
          label: match.label,
          confidence: adjusted.confidence,
          reason: adjusted.reason || match.reason || "Interpreted from catalog product data.",
        });
      }
    }

    return this.pickSingleStrongMatch(Array.from(candidates.values()), 72);
  }

  private adjustProductInterpretationConfidence(args: {
    label: string;
    reason?: string | null;
    confidence: number;
    lineItem: InboundOrderParsedDraft["lineItems"][number];
  }): { confidence: number; reason: string | null } {
    const evidenceText = [
      args.lineItem.sourceText,
      args.lineItem.productName,
      args.lineItem.materialText,
      ...args.lineItem.optionTexts,
      ...args.lineItem.finishingTexts,
    ].filter(Boolean).join(" ").toLowerCase();
    const candidateText = [args.label, args.reason].filter(Boolean).join(" ").toLowerCase();
    const rules = [
      { token: "PVC", positive: /\bpvc\b/, conflicts: /\b(acm|dibond|max\s*metal|aluminum|coroplast|magnet|magnetic)\b/ },
      { token: "Coroplast", positive: /\b(coroplast|corrugated\s+plastic)\b/, conflicts: /\b(pvc|acm|dibond|max\s*metal|magnet|magnetic)\b/ },
      { token: "ACM", positive: /\b(acm|dibond|max\s*metal|aluminum\s+composite)\b/, conflicts: /\b(pvc|coroplast|magnet|magnetic)\b/ },
      { token: "Magnetic", positive: /\b(magnet|magnetic)\b/, conflicts: /\b(pvc|coroplast|acm|dibond|max\s*metal)\b/ },
    ];

    for (const rule of rules) {
      if (!rule.positive.test(evidenceText)) continue;
      if (rule.positive.test(candidateText)) {
        return {
          confidence: Math.min(98, Math.max(args.confidence, 95)),
          reason: args.reason
            ? `${args.reason} Exact material evidence matched ${rule.token}.`
            : `Exact material evidence matched ${rule.token}.`,
        };
      }
      if (rule.conflicts.test(candidateText)) {
        return {
          confidence: Math.min(args.confidence, 62),
          reason: args.reason
            ? `${args.reason} Penalized because source material indicates ${rule.token}.`
            : `Penalized because source material indicates ${rule.token}.`,
        };
      }
    }

    return { confidence: args.confidence, reason: args.reason ?? null };
  }

  private pickSingleStrongMatch<T extends { confidence: number }>(
    candidates: T[],
    minimumConfidence: number,
  ): T | null {
    const sorted = candidates
      .filter((candidate) => Number.isFinite(candidate.confidence) && candidate.confidence >= minimumConfidence)
      .sort((left, right) => right.confidence - left.confidence);
    if (sorted.length === 0) return null;
    if (sorted.length > 1 && sorted[0].confidence - sorted[1].confidence < 6) return null;
    return sorted[0];
  }

  private reviewDraftDtoFromSnapshot(
    record: InboundOrderRecord,
    snapshot: InboundOrderReviewSnapshot,
    latestAttempt: InboundOrderParseAttempt | null,
    initializedFromParse: boolean,
  ): InboundOrderReviewDraftDto {
    const payload = this.reviewDraftPayloadFromSnapshot(snapshot);
    if (!payload) {
      throw new InboundOrderTransitionError("Editable review draft snapshot is invalid.", 500);
    }
    const sourceParseAttemptId = stringFromUnknown(getPathValue(snapshot.payloadJson, "metadata.sourceParseAttemptId"));
    const sourceParseAttemptCreatedAt = stringFromUnknown(getPathValue(snapshot.payloadJson, "metadata.sourceParseAttemptCreatedAt"));
    const latestParseAttemptCreatedAt = formatInboundDate(latestAttempt?.createdAt);
    const sourceDate = sourceParseAttemptCreatedAt ? new Date(sourceParseAttemptCreatedAt) : null;
    const latestDate = latestParseAttemptCreatedAt ? new Date(latestParseAttemptCreatedAt) : null;
    const readinessScore = this.calculateReviewReadinessScore(payload);
    const hasNewerParse = Boolean(
      latestAttempt?.id
      && sourceParseAttemptId
      && latestAttempt.id !== sourceParseAttemptId
      && latestDate
      && sourceDate
      && latestDate.getTime() > sourceDate.getTime(),
    );
    return {
      ...payload,
      id: snapshot.id,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.snapshotVersion,
      inboundOrderRecordId: snapshot.inboundRecordId,
      organizationId: snapshot.organizationId,
      sourceParseAttemptId: sourceParseAttemptId ?? null,
      sourceParseAttemptCreatedAt: sourceParseAttemptCreatedAt ?? null,
      latestParseAttemptId: latestAttempt?.id ?? null,
      latestParseAttemptCreatedAt,
      hasNewerParse,
      initializedFromParse,
      createdByUserId: snapshot.createdByUserId ?? null,
      updatedByUserId: stringFromUnknown(getPathValue(snapshot.payloadJson, "metadata.updatedByUserId")) ?? snapshot.createdByUserId ?? null,
      createdAt: formatInboundDate(snapshot.createdAt),
      updatedAt: formatInboundDate(snapshot.createdAt),
      validationErrors: this.validateReviewDraftReady(payload),
      readinessScore,
      interpretationConfidence: {
        product: readinessScore.product,
        options: readinessScore.options,
        overall: readinessScore.overall,
      },
    };
  }

  private calculateReviewReadinessScore(
    draft: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto,
  ): InboundOrderReviewReadinessScore {
    const customer = draft.reviewedCustomerJson.selectedCustomerId
      ? 100
      : draft.reviewedCustomerJson.unresolvedCustomer
        ? 70
        : 0;
    const contact = draft.reviewedCustomerJson.selectedContactId
      ? 100
      : draft.reviewedCustomerJson.unresolvedContact
        ? 70
        : 0;
    const productScores = draft.reviewedLineItemsJson.map((lineItem) => (
      lineItem.selectedProductId
        ? Math.max(80, Math.min(100, lineItem.interpretedProductConfidence ?? 90))
        : lineItem.productUnresolved
          ? 70
          : 0
    ));
    const product = productScores.length
      ? Math.round(productScores.reduce((sum, score) => sum + score, 0) / productScores.length)
      : 0;
    const optionScores = draft.reviewedLineItemsJson.map((lineItem) => {
      const suggestions = lineItem.pbv2OptionSuggestions ?? [];
      const selectedCount = Object.keys(lineItem.optionSelectionsJson?.selected ?? {}).length;
      if (suggestions.length === 0 && selectedCount === 0) return lineItem.selectedProductId ? 80 : 0;
      if (suggestions.length === 0) return 85;
      return Math.round(suggestions.reduce((sum, suggestion) => sum + suggestion.confidence, 0) / suggestions.length);
    });
    const options = optionScores.length
      ? Math.round(optionScores.reduce((sum, score) => sum + score, 0) / optionScores.length)
      : 0;
    const artworkStatus = draft.reviewedArtworkJson.status;
    const artworkScore = artworkStatus === "supplied" || artworkStatus === "not_required"
      ? 100
      : artworkStatus === "to_follow"
        ? 80
        : 60;
    const overall = Math.round((customer * 0.2) + (contact * 0.1) + (product * 0.3) + (options * 0.3) + (artworkScore * 0.1));

    return {
      overall,
      customer,
      contact,
      product,
      options,
      artwork: {
        score: artworkScore,
        status: artworkStatus,
        label: formatReadinessLabel(artworkStatus),
      },
    };
  }

  private assertReviewDraftEditable(record: InboundOrderRecord, options: { allowReady?: boolean } = {}) {
    if (record.createdQuoteId || record.createdOrderId || record.status === "submitted" || record.status === "approved") {
      throw new InboundOrderTransitionError("Converted inbound records cannot be edited during Phase 3.");
    }
    if (record.status === rejectedStatus || record.reviewOutcome === "rejected") {
      throw new InboundOrderTransitionError("Rejected inbound records must be reopened by the safe review workflow before editing.");
    }
    if (!options.allowReady && record.status === reviewedStatus) {
      throw new InboundOrderTransitionError("Ready inbound review drafts must be reopened before editing.");
    }
  }

  private async recordConversionValidationFailure(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
  }, errors: string[]) {
    await this.repository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "convert.failed",
      fromStatus: null,
      toStatus: null,
      message: "Inbound review draft failed conversion validation.",
      metadataJson: {
        phase: "inbound_orders_phase_4",
        errors,
      },
    });
  }

  private async validateInboundOrderConversion(
    detail: InboundOrderDetail,
    payload: InboundOrderReviewDraftPayload | null,
  ): Promise<string[]> {
    const errors: string[] = [];
    const { record } = detail;

    if (record.createdOrderId) return errors;
    if (record.createdQuoteId) errors.push("Inbound record has already been converted to a quote draft.");
    if (record.status !== reviewedStatus) errors.push("Inbound record must be ready before order conversion.");
    if (!payload) {
      errors.push("Reviewed draft is missing.");
      return Array.from(new Set(errors));
    }
    if (payload.status !== "ready_to_convert") {
      errors.push("Reviewed draft must be marked ready to convert.");
    }

    const selectedCustomerId = payload.reviewedCustomerJson.selectedCustomerId;
    if (!selectedCustomerId) {
      errors.push("Select an existing customer before creating a draft order.");
    } else {
      const customer = await this.repository.getCustomer(record.organizationId, selectedCustomerId);
      if (!customer) errors.push("Selected customer was not found for this organization.");
    }

    const selectedContactId = payload.reviewedCustomerJson.selectedContactId;
    if (selectedCustomerId && selectedContactId) {
      const contact = await this.repository.getContactForCustomer(record.organizationId, selectedCustomerId, selectedContactId);
      if (!contact) errors.push("Selected contact does not belong to the selected customer.");
    }

    if (payload.reviewedLineItemsJson.length === 0) {
      errors.push("At least one reviewed line item is required.");
    }

    for (let index = 0; index < payload.reviewedLineItemsJson.length; index += 1) {
      const lineItem = payload.reviewedLineItemsJson[index];
      const label = lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`;
      if (!lineItem.selectedProductId) {
        errors.push(`${label}: select an existing product before order conversion.`);
      } else {
        const product = await this.repository.getProduct(record.organizationId, lineItem.selectedProductId);
        if (!product) errors.push(`${label}: selected product was not found for this organization.`);
      }
      if (!lineItem.quantity) {
        errors.push(`${label}: quantity is required.`);
      }
      if (this.lineItemRequiresDimensions(lineItem) && (!lineItem.width || !lineItem.height)) {
        errors.push(`${label}: width and height are required for this product type.`);
      }
    }

    payload.missingDecisionsJson.forEach((decision) => {
      if (decision.status !== "still_blocking") return;
      if (decision.severity === "blocking") {
        errors.push(`${decision.label}: resolve or acknowledge this blocking decision.`);
      }
    });

    errors.push(...await this.validateRequiredPbv2Selections(record.organizationId, payload));

    return Array.from(new Set(errors));
  }

  private async buildOrderCreateInputFromInboundReview(args: {
    detail: InboundOrderDetail;
    snapshotId: string;
    snapshotVersion: number;
    payload: InboundOrderReviewDraftPayload;
    actorUserId: string;
  }): Promise<Parameters<OrdersRepository["createOrder"]>[1]> {
    const { detail, payload } = args;
    const order = payload.reviewedOrderJson;
    const customer = payload.reviewedCustomerJson;
    const artwork = payload.reviewedArtworkJson;
    const reference = order.poNumber || detail.record.externalReference || detail.record.id.slice(0, 8);
    const reviewedNotes = [
      "Created from inbound reviewed draft.",
      `Inbound record: ${detail.record.id}`,
      `Source: ${detail.record.sourceLabel ?? detail.record.sourceType}`,
      detail.record.externalReference ? `Reference: ${detail.record.externalReference}` : null,
      order.internalNotes ? `Internal notes: ${order.internalNotes}` : null,
      order.customerNotes ? `Customer notes: ${order.customerNotes}` : null,
      payload.reviewNotes ? `Review notes: ${payload.reviewNotes}` : null,
      artwork.status === "to_follow" ? "Artwork: to follow." : null,
      artwork.status === "missing" ? "Artwork: missing at conversion." : null,
      artwork.notes ? `Artwork notes: ${artwork.notes}` : null,
    ].filter(Boolean).join("\n");

    const lineItems: CreateOrderLineItemInput[] = [];
    for (let index = 0; index < payload.reviewedLineItemsJson.length; index += 1) {
      const lineItem = payload.reviewedLineItemsJson[index];
      const description = lineItem.productName || lineItem.sourceText || `Inbound reviewed item ${index + 1}`;
      const selections = this.normalizePbv2Selections(lineItem.optionSelectionsJson);
      const pricing = await this.priceLineItemFn({
        organizationId: detail.record.organizationId,
        productId: lineItem.selectedProductId!,
        quantity: lineItem.quantity ?? 1,
        widthIn: lineItem.width ?? undefined,
        heightIn: lineItem.height ?? undefined,
        pbv2ExplicitSelections: selections.selected,
        pbv2TreeVersionIdOverride: lineItem.pbv2TreeVersionId ?? undefined,
      });
      if (!Number.isFinite(pricing.lineTotalCents) || pricing.lineTotalCents <= 0) {
        throw new InboundOrderConversionValidationError(
          "Inbound review draft is not ready for order conversion.",
          [`${description}: pricing could not calculate a non-zero total. Review required product options before conversion.`],
        );
      }

      lineItems.push({
        productId: lineItem.selectedProductId!,
        productType: "wide_roll",
        description,
        productName: description,
        width: lineItem.width ?? null,
        height: lineItem.height ?? null,
        quantity: lineItem.quantity ?? 1,
        sqft: null,
        unitPrice: pricing.lineTotalCents / 100 / (lineItem.quantity ?? 1),
        totalPrice: pricing.lineTotalCents / 100,
        status: "new",
        workflowState: "new",
        requiresDesign: false,
        requiresPrepress: false,
        requiresProofApproval: false,
        productionNotes: lineItem.notes ?? null,
        specsJson: {
          inbound: {
            recordId: detail.record.id,
            sourceLineItemId: lineItem.sourceLineItemId,
            reviewSnapshotId: args.snapshotId,
            reviewSnapshotVersion: args.snapshotVersion,
            sourceText: lineItem.sourceText,
            dimensionsUnit: lineItem.dimensionsUnit,
            materialText: lineItem.materialText,
            printSpecs: lineItem.printSpecs,
            optionTexts: lineItem.optionTexts,
            finishingTexts: lineItem.finishingTexts,
            artworkStatus: artwork.status,
            artworkReferences: artwork.refs,
          },
          staffReviewedDraft: lineItem,
        },
        pbv2TreeVersionId: pricing.pbv2TreeVersionId,
        optionSelectionsJson: selections,
        pbv2SnapshotJson: pricing.pbv2SnapshotJson,
        selectedOptions: pricing.pbv2SnapshotJson.selectedOptions ?? [],
        materialUsages: [],
        sortOrder: index,
        taxAmount: 0,
        isTaxableSnapshot: true,
      } as unknown as CreateOrderLineItemInput);
    }

    const shippingMethod = order.fulfillmentType === "pickup"
      ? "pickup"
      : order.fulfillmentType === "shipping"
        ? "ship"
        : null;

    const normalizedDueDate = normalizeInboundReviewedDueDate(order.dueDate, detail.record.receivedAt);

    return {
      customerId: customer.selectedCustomerId!,
      contactId: customer.selectedContactId ?? null,
      label: `Inbound ${reference}`,
      poNumber: order.poNumber ?? detail.record.externalReference ?? null,
      status: "new",
      priority: "normal",
      dueDate: normalizedDueDate,
      requestedDueDate: normalizedDueDate,
      notesInternal: reviewedNotes,
      createdByUserId: args.actorUserId,
      lineItems,
      taxRate: 0,
      taxAmount: 0,
      taxableSubtotal: 0,
      shippingMethod,
      shippingMode: shippingMethod ? "single_shipment" : null,
      billToName: customer.sourceName ?? null,
      billToCompany: customer.companyName ?? null,
      billToEmail: customer.sourceEmail ?? null,
      billToPhone: customer.sourcePhone ?? null,
    };
  }

  private async reviewDraftSourceMetadata(
    existingSnapshot: InboundOrderReviewSnapshot | null,
    latestAttempt: InboundOrderParseAttempt | null,
  ): Promise<{ id: string | null; createdAt: string | null }> {
    const existingId = existingSnapshot ? stringFromUnknown(getPathValue(existingSnapshot.payloadJson, "metadata.sourceParseAttemptId")) : null;
    const existingCreatedAt = existingSnapshot ? stringFromUnknown(getPathValue(existingSnapshot.payloadJson, "metadata.sourceParseAttemptCreatedAt")) : null;
    return {
      id: existingId ?? latestAttempt?.id ?? null,
      createdAt: existingCreatedAt ?? formatInboundDate(latestAttempt?.createdAt),
    };
  }

  private async resolveReviewDraftSourceAttempt(
    organizationId: string,
    inboundRecordId: string,
    existingSnapshot: InboundOrderReviewSnapshot | null,
    latestAttempt: InboundOrderParseAttempt | null,
  ): Promise<{ id: string | null; createdAt: string | null }> {
    return this.reviewDraftSourceMetadata(
      existingSnapshot ?? await this.getLatestEditableReviewDraftSnapshot(organizationId, inboundRecordId),
      latestAttempt,
    );
  }

  private async persistEditableReviewDraftSnapshot(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    record: InboundOrderRecord;
    latestAttempt: { id: string | null; createdAt: string | null | Date } | null;
    payload: InboundOrderReviewDraftPayload;
    status: InboundOrderReviewDraftStatus;
    eventType: string;
    message: string | null;
    initializedFromParse: boolean;
    recordPatch?: UpdateInboundOrderRecordValues;
  }): Promise<InboundOrderReviewSnapshot> {
    const latestSnapshot = await this.repository.getLatestReviewSnapshot(args.organizationId, args.inboundRecordId);
    const snapshotVersion = (latestSnapshot?.snapshotVersion ?? 0) + 1;
    const sourceParseAttemptId = args.latestAttempt?.id ?? null;
    const sourceParseAttemptCreatedAt = formatInboundDate(args.latestAttempt?.createdAt);
    const { snapshot } = await this.repository.createReviewSnapshotWithEvent({
      snapshot: {
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        snapshotType: "approval",
        snapshotVersion,
        payloadJson: {
          ...args.payload,
          status: args.status,
          metadata: {
            snapshotKind: editableReviewDraftKind,
            source: "inbound_order_editable_review",
            sourceParseAttemptId,
            sourceParseAttemptCreatedAt,
            updatedByUserId: args.actorUserId,
            initializedFromParse: args.initializedFromParse,
            savedAt: new Date().toISOString(),
          },
        },
        createdByUserId: args.actorUserId,
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: args.eventType,
        fromStatus: args.record.status,
        toStatus: args.recordPatch?.status ?? args.record.status,
        message: args.message,
        metadataJson: {
          phase: "inbound_orders_phase_3",
          snapshotVersion,
          snapshotKind: editableReviewDraftKind,
          reviewDraftStatus: args.status,
          reviewOnly: true,
          createsDownstreamRecords: false,
        },
      },
    });

    if (args.recordPatch) {
      await this.repository.updateRecordWithEvent({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        patch: args.recordPatch,
        event: {
          actorUserId: args.actorUserId,
          actorType: "user",
          eventType: `${args.eventType}.status_updated`,
          fromStatus: args.record.status,
          toStatus: args.recordPatch.status ?? args.record.status,
          message: args.message,
          metadataJson: {
            phase: "inbound_orders_phase_3",
            snapshotId: snapshot.id,
            reviewDraftStatus: args.status,
            reviewOnly: true,
            createsDownstreamRecords: false,
          },
        },
      });
    }

    return snapshot;
  }

  private validateReviewDraftReady(draft: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): string[] {
    const errors: string[] = [];
    const customer = draft.reviewedCustomerJson;
    if (!customer.selectedCustomerId && !customer.unresolvedCustomer) {
      errors.push("Select a customer candidate or mark the customer unresolved.");
    }

    if (draft.reviewedLineItemsJson.length === 0) {
      errors.push("At least one line item is required.");
    }

    draft.reviewedLineItemsJson.forEach((lineItem, index) => {
      const label = lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`;
      if (!lineItem.quantity) {
        errors.push(`${label}: quantity is required.`);
      }
      if (!lineItem.selectedProductId && !lineItem.productUnresolved) {
        errors.push(`${label}: select a product candidate or mark product unresolved.`);
      }
      if (this.lineItemRequiresDimensions(lineItem) && (!lineItem.width || !lineItem.height)) {
        errors.push(`${label}: width and height are required for this product type.`);
      }
    });

    draft.missingDecisionsJson.forEach((decision) => {
      if (decision.status !== "still_blocking") return;
      if (decision.severity === "blocking") {
        errors.push(`${decision.label}: resolve or acknowledge this blocking decision.`);
      } else if (/artwork/i.test(decision.field) || /artwork/i.test(decision.label)) {
        errors.push(`${decision.label}: acknowledge artwork status before marking ready.`);
      }
    });

    return Array.from(new Set(errors));
  }

  private async validateReviewDraftReadyForMarkReady(
    organizationId: string,
    draft: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto,
  ): Promise<string[]> {
    const errors = this.validateReviewDraftReady(draft);
    const pbv2Errors = await this.validateRequiredPbv2Selections(organizationId, draft);
    return Array.from(new Set([...errors, ...pbv2Errors]));
  }

  private async validateRequiredPbv2Selections(
    organizationId: string,
    draft: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto,
  ): Promise<string[]> {
    const errors: string[] = [];
    for (let index = 0; index < draft.reviewedLineItemsJson.length; index += 1) {
      const lineItem = draft.reviewedLineItemsJson[index];
      if (!lineItem.selectedProductId) continue;
      const productOptions = await this.repository.getProductActivePbv2Tree(organizationId, lineItem.selectedProductId);
      const treeJson = (productOptions?.activeTree?.treeJson ?? null) as OptionTreeV2 | null;
      if (!treeJson) continue;
      const missing = getMissingInboundPbv2RequiredOptions(treeJson, lineItem.optionSelectionsJson as LineItemOptionSelectionsV2 | null);
      if (missing.length === 0) continue;
      const productLabel = lineItem.productName || productOptions?.product.name || lineItem.sourceText || `Line item ${index + 1}`;
      errors.push(`${productLabel} requires ${formatRequiredOptionList(missing.map((option) => option.label))} before conversion.`);
    }
    return errors;
  }

  private lineItemRequiresDimensions(lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]): boolean {
    if (lineItem.width && lineItem.height) return false;
    const text = [
      lineItem.sourceText,
      lineItem.productName,
      lineItem.materialText,
      ...lineItem.optionTexts,
      ...lineItem.finishingTexts,
    ].filter(Boolean).join(" ").toLowerCase();
    return /\b(yard|lawn|political|realtor|event)\s+signs?\b/.test(text)
      || /\b(custom\s+size|banner|banners|sign|signs|pvc|coroplast|window\s+perf|magnet|magnets?)\b/.test(text);
  }

  private lineItemOptionEvidenceText(lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]): string {
    return [
      lineItem.sourceText,
      lineItem.productName,
      lineItem.materialText,
      lineItem.dimensionsUnit,
      ...lineItem.printSpecs,
      ...lineItem.optionTexts,
      ...lineItem.finishingTexts,
      lineItem.notes,
    ].filter(Boolean).join(" ");
  }

  private normalizePbv2Selections(input: LineItemOptionSelectionsV2 | Record<string, unknown> | null | undefined): LineItemOptionSelectionsV2 {
    if (input && typeof input === "object" && (input as any).schemaVersion === 2 && (input as any).selected && typeof (input as any).selected === "object") {
      return input as LineItemOptionSelectionsV2;
    }
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return {
        schemaVersion: 2,
        selected: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key,
            value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "value")
              ? value
              : { value },
          ]),
        ) as LineItemOptionSelectionsV2["selected"],
      };
    }
    return { schemaVersion: 2, selected: {} };
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
