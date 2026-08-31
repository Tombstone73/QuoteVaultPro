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
  type InboundEmailIgnoreRule,
  type InboundEmailIgnoreRuleType,
  type InboundEmailTrustRule,
  type InboundEmailTrustRuleType,
  type Quote,
  type OrderWithRelations,
} from "@shared/schema";
import {
  inboundCustomerIntelligenceSummarySchema,
  inboundOrderParsedDraftSchema,
  inboundOrderReviewedLineItemSchema,
  inboundOrderReviewDraftPayloadSchema,
  type InboundEmailPullDiagnosticsResponse,
  type InboundAttachmentDownloadPolicy,
  type InboundOrderParsedDraft,
  type InboundOrderArtworkLink,
  type InboundOrderReviewDraftDto,
  type InboundOrderReviewDraftPayload,
  type InboundOrderReviewReadinessScore,
  type InboundOrderReviewDraftSaveRequest,
  type InboundOrderRecordWithTrust,
  type InboundOrderReviewValueSource,
  type InboundOrderReviewDraftStatus,
  type InboundCustomerIntelligenceSummary,
  type InboundSenderTrustStatus,
  type InboundSenderTrustSummary,
  type InboundOrderProductOptionsResponse,
  type InboundOrderLinePricingReview,
  type ManualInboundOrderCreateRequest,
  getManualInboundEvidence,
} from "@shared/inboundOrdersApi";
import { isPublicFreeEmailDomain } from "@shared/inboundEmailTrustDomains";
import {
  classifyInboundAttachment,
  inboundAttachmentClassificationToRole,
  inboundAttachmentRoleToClassification,
  type InboundAttachmentClassification,
  type InboundAttachmentClassificationResult,
} from "@shared/inboundAttachmentClassification";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import {
  detectUnsupportedInboundRequests,
  getInboundPbv2RequiredOptions,
  getMissingInboundPbv2RequiredOptions,
  hydrateInboundPbv2Selections,
  type InboundUnsupportedRequestFinding,
} from "@shared/inboundOrderPbv2Options";
import { resolveProductionSides } from "@shared/productionHydration";
import { defaultNewProductionArtworkAllocation } from "@shared/artworkAllocation";
import {
  hasUsableInboundLinePrice,
  preserveInboundPricingResolution,
  resolveInboundLineEffectivePricing,
} from "@shared/inboundOrderPricing";
import { resolvePbv2RuntimeDimensions } from "@shared/pbv2/fixedDimensions";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import {
  inboundOrdersRepository,
  type InboundOrdersRepository,
  type CreateInboundOrderEventValues,
  type InboundContactSearchResult,
  type InboundCustomerSearchResult,
  type InboundProductSearchResult,
  type InboundQuoteDraftLineInput,
  type InboundOrderListFilters,
  type InboundOrderQueueSummary,
  type UpdateInboundOrderRecordValues,
  type CreateInboundAttachmentClassificationRuleValues,
} from "../../storage/inboundOrders.repo";
import {
  OrdersRepository,
  type CreateOrderLineItemInput,
} from "../../storage/orders.repo";
import { priceLineItem } from "../pricing/PricingService";
import { CustomerIntelligenceService, customerIntelligenceService } from "./CustomerIntelligenceService";
import { canonicalArtworkWriteService } from "../artwork/CanonicalArtworkWriteService";
import { calculateAuthoritativeOrderTax } from "../orders/orderTaxCalculationService";

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
  record: InboundOrderRecordWithTrust;
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
  records: InboundOrderRecordWithTrust[];
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

export type InboundOrderIgnoreAction =
  | "ignore_once"
  | "ignore_sender"
  | "ignore_domain"
  | "ignore_subject"
  | "ignore_sender_subject";

export type InboundOrderQueueCleanupAction = InboundOrderIgnoreAction | "delete" | "reject";
export type InboundOrderBulkTrustAction = "trust_sender" | "trust_domain";

export type InboundOrderIgnoreActionInput = {
  organizationId: string;
  inboundRecordId: string;
  actorUserId: string;
  action: InboundOrderIgnoreAction;
  note?: string | null;
  resolveConflict?: "disable_conflicting_rule";
};

export type InboundAttachmentClassificationUpdateInput = {
  organizationId: string;
  inboundRecordId: string;
  fileId: string;
  actorUserId: string;
  classification: InboundAttachmentClassification;
  rememberForCustomer?: boolean;
  rule?: {
    customerId?: string | null;
    senderDomain?: string | null;
    matchType: CreateInboundAttachmentClassificationRuleValues["matchType"];
    matchValue: string;
  } | null;
};

export type InboundAttachmentClassificationBulkInput = {
  organizationId: string;
  inboundRecordId: string;
  fileIds: string[];
  actorUserId: string;
  classification: InboundAttachmentClassification | "reset_to_ai";
};

export type InboundOrderBulkActionInput = {
  organizationId: string;
  recordIds: string[];
  actorUserId: string;
  action: InboundOrderQueueCleanupAction | InboundOrderBulkTrustAction;
  note?: string | null;
  resolveConflict?: "disable_conflicting_rule";
};

export type InboundOrderIgnoreActionResult = {
  detail: InboundOrderDetail;
  rulesCreated: number;
  rulesAlreadyExisted: number;
};

export type InboundOrderBulkActionResult = {
  updatedIds: string[];
  errors: Array<{ id: string; message: string }>;
  rulesCreated: number;
  rulesAlreadyExisted: number;
  emailsProcessed: number;
  emailsSkipped: number;
  actualErrors: Array<{ id: string; message: string }>;
};

export type InboundOrderCombineInput = {
  organizationId: string;
  recordIds: string[];
  primaryRecordId: string;
  actorUserId: string;
  confirmCustomerMismatch?: boolean;
  confirmMultipleDrafts?: boolean;
};

export type InboundOrderCombineResult = {
  detail: InboundOrderDetail;
  combinedSourceCount: number;
  reparseRecommended: true;
};

export type InboundOrderAttachToOrderInput = {
  organizationId: string;
  inboundRecordId: string;
  orderId: string;
  actorUserId: string;
  includeMessageHistory: boolean;
  includeAttachments: boolean;
  includeParsedNotes: boolean;
  includeJunkAttachments: boolean;
  confirmCustomerMismatch: boolean;
  artworkAssignments: Array<{ fileId: string; orderLineItemId: string | null; side: "front" | "back" | "na" }>;
};

export type InboundOrderAttachToOrderResult = {
  orderId: string;
  orderNumber: string | null;
  inboundRecordId: string;
  createdAttachmentIds: string[];
  skippedAttachments: Array<{ fileId: string; reason: string }>;
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

export type CreateInboundOrderFromReviewDraftInput = SaveInboundOrderEditableReviewDraftInput;

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
  customerId?: string | null;
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

export type InboundQuoteDraftPreviewLineItem = Omit<InboundQuoteDraftLineInput, "pricing"> & {
  index: number;
};

export type InboundQuoteDraftPreview = {
  eligible: boolean;
  blockingReasons: string[];
  warnings: string[];
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
    source: "matched_customer" | "reviewed_customer" | "manual_text" | "missing";
  };
  contact: {
    matchedContactId: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    source: "matched_contact" | "reviewed_contact" | "snapshot_text" | "missing";
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
  orderNumber: string;
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

export type InboundEmailRuleConflict = {
  conflictType: "trust_conflicted_with_ignore" | "ignore_conflicted_with_trust";
  conflictingRuleId: string;
  conflictingRuleType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType;
  conflictingValue: string;
  currentRuleLocation: "Inbound Ignore Rules" | "Trusted Inbound Senders";
  recommendedResolution: string;
};

export class InboundEmailRuleConflictError extends InboundOrderTransitionError {
  constructor(
    message: string,
    public readonly conflict: InboundEmailRuleConflict,
  ) {
    super(message, 409);
    this.name = "InboundEmailRuleConflictError";
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

function nonNegativeNumberFromUnknown(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function positiveIntegerFromUnknown(value: unknown): number | null {
  const numeric = positiveNumberFromUnknown(value);
  if (numeric == null) return null;
  return Math.floor(numeric);
}

function normalizeArtworkMatchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactArtworkMatchText(value: string | null | undefined): string {
  return normalizeArtworkMatchText(value).replace(/\s+/g, "");
}

function artworkMatchTokens(value: string): string[] {
  const ignored = new Set(["the", "and", "for", "with", "sign", "signs", "print", "prints", "art", "artwork", "final"]);
  return Array.from(new Set(
    normalizeArtworkMatchText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  ));
}

function normalizeDimensionToken(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function artworkLinkKey(link: Pick<InboundOrderArtworkLink, "fileId" | "fileRecordId">): string {
  return link.fileRecordId ? `record:${link.fileRecordId}` : `file:${link.fileId}`;
}

function isActiveClassifiedArtworkLink(link: InboundOrderArtworkLink): boolean {
  return link.source !== "staff_removed"
    && (link.classification ?? inboundAttachmentRoleToClassification(link.role)) === "ARTWORK";
}

function hasAssignedClassifiedArtwork(payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">): boolean {
  return payload.reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
}

function hasCompleteDoubleSidedArtwork(lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]): boolean {
  const selected = lineItem.optionSelectionsJson?.selected ?? {};
  const rawSelectionIndicatesDoubleSided = Object.entries(selected).some(([key, entry]) => (
    /side|sides|print[_\s-]*side/i.test(key)
    && /double|two|2[_\s-]*sided|\bds\b/i.test(String(entry?.value ?? ""))
  ));
  if (resolveProductionSides(lineItem) !== "Double-sided" && !rawSelectionIndicatesDoubleSided) return true;
  const artwork = lineItem.artworkLinks.filter(isActiveClassifiedArtworkLink);
  return artwork.some((link) => link.assignmentSide === "both")
    || (artwork.some((link) => link.assignmentSide === "front") && artwork.some((link) => link.assignmentSide === "back"));
}

function isArtworkDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  return /artwork/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

function isQuantityDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  return /quantity/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

function isDimensionsDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  const field = String(decision.field ?? "");
  if (/lineitems\.\d+\.(?:dimensions?|size|width|height)/i.test(field)) return true;

  const text = `${decision.label} ${decision.reason}`;
  return /what\s+(?:size|dimensions?)\b.*\bneeded\b|\b(?:size|dimensions?)\b.*\b(?:missing|required|unclear)\b/i.test(text)
    && !/\bpole\s+pocket\b/i.test(text);
}

function artworkLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.artwork/i);
  return match ? Number(match[1]) : null;
}

function quantityLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.quantity/i);
  return match ? Number(match[1]) : null;
}

function dimensionsLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.(?:dimensions?|size|width|height)/i);
  return match ? Number(match[1]) : null;
}

function reviewedLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)(?:\.|$)/i);
  return match ? Number(match[1]) : null;
}

function decisionReferencesRemovedLine(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field">,
): boolean {
  const lineIndex = reviewedLineIndex(decision.field);
  return lineIndex != null && lineIndex >= payload.reviewedLineItemsJson.length;
}

function hasValidLineItemQuantity(
  lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.quantity === "number"
    && Number.isFinite(lineItem.quantity)
    && lineItem.quantity > 0;
}

function hasValidLineItemDimensions(
  lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.width === "number"
    && Number.isFinite(lineItem.width)
    && lineItem.width > 0
    && typeof lineItem.height === "number"
    && Number.isFinite(lineItem.height)
    && lineItem.height > 0;
}

function artworkDecisionIsResolvedByAssignment(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = artworkLineIndex(decision.field);
  if (lineIndex == null) return hasAssignedClassifiedArtwork(payload);
  return payload.reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

function quantityDecisionIsResolvedByLineItem(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = quantityLineIndex(decision.field);
  return lineIndex != null && hasValidLineItemQuantity(payload.reviewedLineItemsJson[lineIndex]);
}

function dimensionsDecisionIsResolvedByLineItem(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = dimensionsLineIndex(decision.field);
  if (lineIndex != null) return hasValidLineItemDimensions(payload.reviewedLineItemsJson[lineIndex]);
  return payload.reviewedLineItemsJson.length > 0 && payload.reviewedLineItemsJson.every(hasValidLineItemDimensions);
}

function isStaleMissingArtworkWarning(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  warning: Pick<InboundOrderReviewDraftPayload["warningsJson"][number], "code" | "message" | "fieldPath">,
): boolean {
  const text = `${warning.code ?? ""} ${warning.message ?? ""} ${warning.fieldPath ?? ""}`.toLowerCase();
  if (!text.includes("artwork") || !/(missing|not linked|not attached|unassigned)/.test(text)) return false;
  const lineIndex = artworkLineIndex(warning.fieldPath);
  if (lineIndex == null) return hasAssignedClassifiedArtwork(payload);
  return payload.reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

function draftHasArtworkThatNeedsAssignment(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  if (hasAssignedClassifiedArtwork(payload)) return false;
  if (payload.reviewedArtworkJson.unassignedAttachments.some(isActiveClassifiedArtworkLink)) return true;
  if (payload.reviewedArtworkJson.refs.some((reference) => reference.purpose === "artwork")) return true;
  return payload.reviewedArtworkJson.status === "supplied";
}

/**
 * "to_follow" is the staff-confirmed inbound order bypass. It deliberately
 * remains distinct from supplied artwork so downstream work can see that the
 * source file is still outstanding.
 */
function hasArtworkBypassForOrder(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  return !hasAssignedClassifiedArtwork(payload)
    && payload.reviewedArtworkJson.status === "to_follow";
}

function artworkIsRequiredForOrder(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  return !hasAssignedClassifiedArtwork(payload)
    && payload.reviewedArtworkJson.status !== "not_required";
}

function centsFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== "string") return null;
  const match = value.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : null;
}

function formatCents(value: number | null | undefined): string {
  return value == null ? "-" : `$${(value / 100).toFixed(2)}`;
}

function pricingSourceEvidenceForPoSummary(
  item: InboundOrderParsedDraft["evidence"]["items"][number],
): string[] {
  const summary = item.poSummary;
  const evidence: string[] = [];
  const pricing = summary?.pricing ?? null;
  if (pricing?.sourceDocument || item.fileName) evidence.push(`Source: ${pricing?.sourceDocument ?? item.fileName}`);
  if (pricing?.evidenceText) evidence.push(pricing.evidenceText);
  const fieldSource = summary?.fieldSources?.price;
  if (fieldSource?.sourceText && !evidence.includes(fieldSource.sourceText)) evidence.push(fieldSource.sourceText);
  if (summary?.price && !evidence.some((entry) => entry.includes(summary.price!))) evidence.push(`PO price: ${summary.price}`);
  return Array.from(new Set(evidence.filter(Boolean))).slice(0, 6);
}

function firstPoPricingForLine(
  draft: InboundOrderParsedDraft | null,
  lineItemIndex: number,
): {
  pricing: NonNullable<NonNullable<InboundOrderParsedDraft["evidence"]["items"][number]["poSummary"]>["pricing"]>;
  sourceEvidence: string[];
} | null {
  if (!draft) return null;
  const poItems = draft.evidence.items.filter((item) => item.documentType === "purchase_order" && item.poSummary);
  const exactQuantity = draft.lineItems[lineItemIndex]?.quantity ?? null;
  const matched = poItems.find((item) => {
    const summary = item.poSummary;
    if (!summary?.pricing) return false;
    return exactQuantity == null || summary.quantity == null || summary.quantity === exactQuantity;
  }) ?? poItems.find((item) => item.poSummary?.pricing);
  const pricing = matched?.poSummary?.pricing ?? null;
  return pricing ? { pricing, sourceEvidence: pricingSourceEvidenceForPoSummary(matched!) } : null;
}

function pricingReviewAuditSummary(payload: InboundOrderReviewDraftPayload): Record<string, unknown> {
  const reviews = payload.reviewedLineItemsJson
    .map((lineItem, index) => ({ index, productName: lineItem.productName ?? lineItem.sourceText ?? null, review: lineItem.pricingReviewJson }))
    .filter((entry) => entry.review && (
      entry.review.status !== "not_available"
      || entry.review.systemPriceCents !== null
      || entry.review.priceOverrideMode !== null
    ));
  return {
    total: reviews.length,
    mismatches: reviews.filter((entry) => entry.review?.status === "mismatch").length,
    resolved: reviews.filter((entry) => entry.review?.status === "resolved").length,
    items: reviews.map((entry) => ({
      lineItemIndex: entry.index,
      productName: entry.productName,
      status: entry.review?.status,
      acknowledged: entry.review?.acknowledged ?? false,
      resolution: entry.review?.resolution ?? null,
      poPriceCents: entry.review?.poPriceCents ?? null,
      systemPriceCents: entry.review?.systemPriceCents ?? null,
      effectiveTotalCents: entry.review?.effectiveTotalCents ?? null,
      priceOverrideMode: entry.review?.priceOverrideMode ?? null,
      priceOverrideSource: entry.review?.priceOverrideSource ?? null,
      differenceCents: entry.review?.differenceCents ?? null,
    })),
  };
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => !/(auth|token|secret|credential|password)/i.test(key))
    .map(([key, item]) => [key, sanitizeDiagnosticValue(item)]));
}

function sanitizeDiagnosticRow(row: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDiagnosticValue(row) as Record<string, unknown>;
}

function safePullSummaryFromSettings(settings: Record<string, unknown>): unknown | null {
  const summary = getPathValue(settings, "lastPullSummary")
    ?? getPathValue(settings, "latestPullSummary")
    ?? getPathValue(settings, "lastPullResult")
    ?? null;
  return summary == null ? null : sanitizeDiagnosticValue(summary);
}

function gmailListDiagnosticsFromSummary(summary: unknown): Record<string, unknown> | null {
  const gmailList = asRecord(getPathValue(summary, "gmailList"));
  return gmailList ? sanitizeDiagnosticRow(gmailList) : null;
}

function gmailListedMessagesFromMailbox(mailbox: {
  id: string;
  emailAddress: string;
  latestPullSummary: unknown | null;
}): Array<Record<string, unknown>> {
  const gmailList = gmailListDiagnosticsFromSummary(mailbox.latestPullSummary);
  const listedMessages = Array.isArray(gmailList?.listedMessages) ? gmailList.listedMessages : [];
  return listedMessages.map((message) => sanitizeDiagnosticRow({
    ...(asRecord(message) ?? {}),
    mailboxId: mailbox.id,
    mailboxEmail: mailbox.emailAddress,
    query: gmailList?.query ?? null,
    labelIds: gmailList?.labelIds ?? null,
    maxResults: gmailList?.maxResults ?? null,
    pageCount: gmailList?.pageCount ?? null,
    totalMessageIdsReturned: gmailList?.totalMessageIdsReturned ?? null,
  }));
}

function pullSummaryMessagesFromMailbox(mailbox: {
  id: string;
  emailAddress: string;
  latestPullSummary: unknown | null;
}, key: "processedMessages" | "skippedMessages" | "ignoredMessages" | "failedMessages"): Array<Record<string, unknown>> {
  const summary = asRecord(mailbox.latestPullSummary);
  const rows = Array.isArray(summary?.[key]) ? summary[key] as unknown[] : [];
  return rows.map((message) => sanitizeDiagnosticRow({
    ...(asRecord(message) ?? {}),
    mailboxId: mailbox.id,
    mailboxEmail: mailbox.emailAddress,
  }));
}

function diagnosticSearchMatches(row: Record<string, unknown>, search: string): boolean {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return false;
  const senderEmail = String(row.senderEmail ?? "").toLowerCase();
  const senderDomain = senderEmail.split("@")[1] ?? String(row.senderDomain ?? "").toLowerCase();
  const subject = String(row.subject ?? "").trim();
  const displaySubject = String(row.displaySubject ?? row.externalReference ?? "").trim();
  const searchableValues = [
    row.providerMessageId,
    row.sourceMessageId,
    row.sourceRecordId,
    row.threadId,
    row.sourceThreadId,
    row.senderName,
    row.senderEmail,
    senderDomain,
    row.subject,
    row.displaySubject,
    row.externalReference,
    row.reason,
    row.processingOutcome,
    row.bodyText,
    row.bodyHtml,
    row.rawPayloadJson,
    row.normalizedPayloadJson,
    row.extractedOrderJson,
  ];
  if ((normalized === "no subject" || normalized === "(no subject)") && (!subject || displaySubject.toLowerCase().includes("no subject"))) {
    return true;
  }
  return searchableValues.some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

function listedMessagesWithProcessingOutcome(
  listedMessages: Array<Record<string, unknown>>,
  processedMessages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return listedMessages.map((listed) => {
    const providerMessageId = String(listed.providerMessageId ?? "");
    const threadId = String(listed.threadId ?? "");
    const match = processedMessages.find((processed) => (
      String(processed.providerMessageId ?? "") === providerMessageId
      || (threadId && String(processed.threadId ?? "") === threadId)
    ));
    return sanitizeDiagnosticRow({
      ...listed,
      processingOutcome: match?.processingOutcome ?? "other",
      reason: match?.reason ?? "No processing outcome was recorded for this listed Gmail message.",
      inboundRecordId: match?.inboundRecordId ?? null,
    });
  });
}

function detectEmailAttachmentHints(row: Record<string, unknown>): Record<string, boolean> {
  const text = [
    row.subject,
    row.externalReference,
    row.bodyText,
    row.bodyHtml,
  ].filter((value) => typeof value === "string").join("\n").slice(0, 30000);
  return {
    mentionsPaperclip: /\bpaperclip\b|📎/i.test(text),
    mentionsAttached: /\battach(?:ed|ment|ments)?\b/i.test(text),
    mentionsPo: /\bpo\b|purchase\s*order/i.test(text),
    mentionsArtwork: /\bart\s*work\b|\bartwork\b|\bart\b/i.test(text),
    hasLinks: /https?:\/\/|www\./i.test(text),
    hasGoogleDriveLinks: /drive\.google\.com|docs\.google\.com/i.test(text),
    hasWeTransferLinks: /wetransfer\.com|we\.tl/i.test(text),
    hasDropboxLinks: /dropbox\.com/i.test(text),
  };
}

function enrichEmailRecordDiagnostic(row: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeDiagnosticRow(row);
  const { bodyText: _bodyText, bodyHtml: _bodyHtml, ...safe } = sanitized;
  return {
    ...safe,
    processingStatus: {
      status: safe.status ?? null,
      reviewOutcome: safe.reviewOutcome ?? null,
      archivedAt: safe.archivedAt ?? null,
    },
    rawGmailPayloadAttachmentIndicators: {
      rawAttachmentCount: safe.rawAttachmentCount ?? 0,
      normalizedAttachmentCount: safe.normalizedAttachmentCount ?? 0,
      rawAttachmentMetadata: safe.rawAttachmentMetadata ?? [],
    },
    attachmentHints: detectEmailAttachmentHints(row),
  };
}

function extractAttachmentIdsFromRawMetadata(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => asRecord(item)?.attachmentId ?? asRecord(item)?.providerAttachmentId)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function attachmentFailureDetailFromFile(file: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = asRecord(file.metadataJson);
  if (!metadata) return null;
  const unsupportedMimeReason = metadata.unsupportedMimeReason ?? (metadata.safeToDownload === false ? metadata.detectionReason : null);
  const failureReason = metadata.failureReason ?? metadata.downloadError ?? unsupportedMimeReason ?? file.reviewNotes ?? null;
  const failed = file.status === "quarantined" || Boolean(metadata.downloadFailed) || Boolean(failureReason);
  if (!failed) return null;
  return sanitizeDiagnosticRow({
    filename: file.sourceFilename ?? metadata.sourceFilename ?? null,
    providerAttachmentId: file.providerAttachmentId ?? metadata.providerAttachmentId ?? null,
    mimeType: file.mimeType ?? metadata.mimeType ?? null,
    failureReason,
    gmailApiError: metadata.gmailApiError ?? null,
    storageError: metadata.storageError ?? null,
    unsupportedMimeReason,
    status: file.status ?? null,
  });
}

function attachmentClassificationFromInboundFile(file: InboundOrderFile): InboundAttachmentClassificationResult {
  const metadata = asRecord(file.metadataJson);
  const stored = asRecord(metadata?.attachmentClassification);
  const classificationValue = typeof stored?.classification === "string"
    ? stored.classification
    : null;
  const fallbackClassification = inboundAttachmentRoleToClassification(file.role);
  const classification = (
    classificationValue === "PO"
    || classificationValue === "ARTWORK"
    || classificationValue === "REFERENCE"
    || classificationValue === "IGNORE_INLINE"
    || classificationValue === "OTHER"
  ) ? classificationValue : fallbackClassification;
  const breakdown = asRecord(stored?.breakdown);
  const source = stored?.source === "manual_override" ? "manual_override" : "automatic";
  const reasons = Array.isArray(stored?.reasons)
    ? stored.reasons.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
    : [];
  return {
    classification,
    confidence: typeof stored?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(stored.confidence))) : 50,
    reasons: reasons.length > 0 ? reasons : [file.reviewNotes ?? "Classification inferred from stored inbound file role."],
    source,
    breakdown: {
      filename: arrayOfStrings((breakdown?.filename)),
      content: arrayOfStrings((breakdown?.content)),
      metadata: arrayOfStrings((breakdown?.metadata)),
      manual: arrayOfStrings((breakdown?.manual)),
      scores: asNumberRecord(breakdown?.scores),
    },
  };
}

function inboundAttachmentClassificationToRuleClassification(
  classification: InboundAttachmentClassification,
): CreateInboundAttachmentClassificationRuleValues["classification"] {
  if (classification === "PO") return "purchase_order";
  if (classification === "ARTWORK") return "artwork";
  if (classification === "REFERENCE") return "reference";
  if (classification === "IGNORE_INLINE") return "junk_signature";
  return "ignore";
}

function inboundOrderFileRoleForClassification(classification: InboundAttachmentClassification): InboundOrderFile["role"] {
  const role = inboundAttachmentClassificationToRole(classification);
  return role === "other" ? "other" : role;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function buildAttachmentPipelineDiagnostics(
  record: Record<string, unknown>,
  files: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const callEvents = events
    .filter((event) => (
      event.inboundRecordId === record.id
      && (
        event.eventType === "attachment_ingestion_call_started"
        || event.eventType === "attachment_ingestion_call_completed"
        || event.eventType === "attachment_ingestion_call_failed"
      )
    ))
    .map(sanitizeDiagnosticRow);
  const callStarted = callEvents.find((event) => event.eventType === "attachment_ingestion_call_started");
  const callCompleted = callEvents.find((event) => event.eventType === "attachment_ingestion_call_completed");
  const callFailed = callEvents.find((event) => event.eventType === "attachment_ingestion_call_failed");
  const callMetadata = asRecord(callCompleted?.metadataJson)
    ?? asRecord(callFailed?.metadataJson)
    ?? asRecord(callStarted?.metadataJson)
    ?? {};
  const callDiagnostics = asRecord(callMetadata.diagnostics) ?? {};
  const latestEvent = events.find((event) => (
    event.inboundRecordId === record.id
    && event.eventType === "email.attachment_ingestion_diagnostics"
    && asRecord(event.metadataJson)
  ));
  const metadata = asRecord(latestEvent?.metadataJson) ?? {};
  const rawMetadata = Array.isArray(record.rawAttachmentMetadata) ? record.rawAttachmentMetadata : [];
  const fileFailures = files
    .filter((file) => file.inboundRecordId === record.id)
    .map(attachmentFailureDetailFromFile)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const eventFailures = Array.isArray(metadata.failures)
    ? metadata.failures.map((item) => sanitizeDiagnosticRow(asRecord(item) ?? { value: item }))
    : [];
  const recordFiles = files.filter((file) => file.inboundRecordId === record.id);
  const storedFromFiles = recordFiles.filter((file) => file.fileRecordId && file.status !== "quarantined").length;
  const metadataOnlyFromFiles = recordFiles.filter((file) => !file.fileRecordId).length;
  const attachmentIds = Array.isArray(metadata.attachmentIdsDiscovered)
    ? metadata.attachmentIdsDiscovered.filter((item): item is string => typeof item === "string")
    : Array.isArray(callMetadata.attachmentIdsDiscovered)
      ? callMetadata.attachmentIdsDiscovered.filter((item): item is string => typeof item === "string")
    : extractAttachmentIdsFromRawMetadata(rawMetadata);
  const hasIngestionDiagnosticsEvent = Boolean(latestEvent);
  const gmailPartsDiscovered = nonNegativeNumberFromUnknown(metadata.attachmentPartsDiscovered)
    ?? nonNegativeNumberFromUnknown(callMetadata.candidateCount)
    ?? nonNegativeNumberFromUnknown(record.rawAttachmentCount)
    ?? 0;
  const attachmentCandidatesDiscovered = nonNegativeNumberFromUnknown(metadata.attachmentCandidatesDiscovered)
    ?? nonNegativeNumberFromUnknown(metadata.attachmentPartsDiscovered)
    ?? nonNegativeNumberFromUnknown(callMetadata.candidateCount)
    ?? nonNegativeNumberFromUnknown(record.rawAttachmentCount)
    ?? 0;
  const attachmentPartsAttempted = nonNegativeNumberFromUnknown(metadata.attachmentPartsAttempted)
    ?? nonNegativeNumberFromUnknown(callDiagnostics.attachmentPartsAttempted)
    ?? 0;
  const safetyDecisions = Array.isArray(metadata.safetyDecisions)
    ? metadata.safetyDecisions.map((item) => sanitizeDiagnosticRow(asRecord(item) ?? { value: item }))
    : [];
  const trustGatePending = safetyDecisions.some((decision) => (
    decision.attachmentState === "pending_trust"
    || decision.downloadAllowed === false && String(decision.reason ?? "").toLowerCase().includes("not trusted")
  ));
  const callFailedMetadata = asRecord(callFailed?.metadataJson) ?? {};
  const ingestionCallError = typeof callFailedMetadata.errorMessage === "string"
    ? callFailedMetadata.errorMessage
    : null;
  const callStatus = callFailed
    ? "failed"
    : callStarted && !callCompleted
      ? "started_without_result"
      : callCompleted
        ? "completed"
        : "not_called";
  const skippedReason = attachmentCandidatesDiscovered > 0 && !callStarted
    ? "ingestion_not_called"
    : attachmentCandidatesDiscovered > 0 && callStarted && !callCompleted && !callFailed
      ? "ingestion_started_but_no_result"
      : attachmentCandidatesDiscovered > 0 && callFailed
        ? "attachment_ingestion_call_failed"
        : metadata.skippedReason ?? (
    attachmentCandidatesDiscovered > 0 && attachmentPartsAttempted === 0
      ? trustGatePending
        ? "pending_trust"
        : hasIngestionDiagnosticsEvent
        ? "attachment_candidates_discovered_but_not_processed"
        : "attachment_candidates_discovered_but_no_ingestion_event_recorded"
      : null
  );

  return sanitizeDiagnosticRow({
    gmailPartsDiscovered,
    attachmentCandidatesDiscovered,
    attachmentIdsDiscovered: attachmentIds,
    attachmentPartsAttempted,
    downloadAttempts: metadata.downloadAttempts ?? callDiagnostics.downloadAttempts ?? 0,
    downloadSuccesses: metadata.downloadSuccesses ?? callDiagnostics.downloadSuccesses ?? 0,
    downloadFailures: metadata.downloadFailures ?? callDiagnostics.downloadFailures ?? fileFailures.length,
    metadataOnlyRowsCreated: metadata.metadataOnlyRowsCreated ?? callDiagnostics.metadataOnlyRowsCreated ?? metadataOnlyFromFiles,
    storedFileRowsCreated: metadata.storedRowsCreated ?? callDiagnostics.storedRowsCreated ?? storedFromFiles,
    attachmentRowsCreated: metadata.attachmentRowsCreated ?? callDiagnostics.attachmentRowsCreated ?? recordFiles.length,
    skippedExistingProviderAttachments: metadata.skippedExistingProviderAttachments ?? 0,
    skippedReason,
    ingestionCallStatus: callStatus,
    ingestionCallError,
    ingestionCallEvents: callEvents,
    safetyDecisions,
    failures: [...eventFailures, ...fileFailures],
  });
}

function redactIgnoreRuleValue(rule: Pick<InboundEmailIgnoreRule, "ruleType" | "ruleValue">): string {
  const value = rule.ruleValue;
  if (rule.ruleType === "sender_email_exact") {
    const [local, domain] = value.split("@");
    if (!domain) return value.slice(0, 3) + (value.length > 3 ? "..." : "");
    return `${local.slice(0, 2)}${local.length > 2 ? "***" : "*"}@${domain}`;
  }
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function quoteReference(quote: Pick<Quote, "id" | "quoteNumber">): string {
  return quote.quoteNumber != null ? `#${quote.quoteNumber}` : quote.id.slice(0, 8);
}

function formatInboundDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function getRecordString(record: InboundOrderRecord, paths: string[]): string | null {
  for (const path of paths) {
    const value = stringFromUnknown(getPathValue(record, path));
    if (value) return value;
  }
  return null;
}

function getInboundRecordSenderEmail(record: InboundOrderRecord): string | null {
  return getRecordString(record, [
    "rawPayloadJson.sender.email",
    "normalizedPayloadJson.sender.email",
    "extractedCustomerJson.senderEmail",
  ])?.toLowerCase() ?? null;
}

function getInboundRecordSenderDomain(record: InboundOrderRecord): string | null {
  const email = getInboundRecordSenderEmail(record);
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function getInboundRecordSubject(record: InboundOrderRecord): string | null {
  return getRecordString(record, [
    "rawPayloadJson.subject",
    "normalizedPayloadJson.subject",
    "extractedOrderJson.subject",
  ]) ?? record.externalReference ?? null;
}

function getIgnoreRuleRequestsForAction(
  record: InboundOrderRecord,
  action: InboundOrderIgnoreAction,
): Array<{ ruleType: InboundEmailIgnoreRuleType; ruleValue: string }> {
  const senderEmail = getInboundRecordSenderEmail(record);
  const senderDomain = getInboundRecordSenderDomain(record);
  const subject = getInboundRecordSubject(record);
  const rules: Array<{ ruleType: InboundEmailIgnoreRuleType; ruleValue: string }> = [];

  if ((action === "ignore_sender" || action === "ignore_sender_subject") && senderEmail) {
    rules.push({ ruleType: "sender_email_exact", ruleValue: senderEmail });
  }
  if (action === "ignore_domain" && senderDomain) {
    rules.push({ ruleType: "sender_domain", ruleValue: senderDomain });
  }
  if ((action === "ignore_subject" || action === "ignore_sender_subject") && subject) {
    rules.push({ ruleType: "subject_exact", ruleValue: subject.trim() });
  }

  return rules;
}

function normalizeInboundEmailIgnoreRuleValue(ruleType: InboundEmailIgnoreRuleType, value: string): string {
  const trimmed = value.trim();
  if (ruleType === "sender_email_exact" || ruleType === "sender_domain") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function normalizeInboundEmailTrustRuleValue(ruleType: InboundEmailTrustRuleType, value: string): string {
  const trimmed = value.trim();
  if (ruleType === "sender_email_exact" || ruleType === "sender_domain" || ruleType === "customer_contact_email" || ruleType === "customer_domain") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function isEmailRuleType(ruleType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType): boolean {
  return ruleType === "sender_email_exact" || ruleType === "customer_contact_email";
}

function isDomainRuleType(ruleType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType): boolean {
  return ruleType === "sender_domain" || ruleType === "customer_domain";
}

function inboundEmailRuleKindsConflict(
  leftType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType,
  leftValue: string,
  rightType: InboundEmailIgnoreRuleType | InboundEmailTrustRuleType,
  rightValue: string,
): boolean {
  const left = leftValue.trim().toLowerCase();
  const right = rightValue.trim().toLowerCase();
  if (!left || !right || left === "*" || right === "*") return false;
  return left === right && (
    (isEmailRuleType(leftType) && isEmailRuleType(rightType))
    || (isDomainRuleType(leftType) && isDomainRuleType(rightType))
  );
}

function trustStatusForRuleType(ruleType: InboundEmailTrustRuleType): InboundSenderTrustStatus {
  if (ruleType === "sender_email_exact") return "trusted_sender";
  if (ruleType === "sender_domain") return "trusted_domain";
  if (ruleType === "customer_contact_email") return "trusted_contact";
  return "trusted_customer_domain";
}

function inboundIgnoreRuleMatchesSender(rule: InboundEmailIgnoreRule, args: {
  senderEmail: string | null;
  senderDomain: string | null;
  subject?: string | null;
}): boolean {
  const value = rule.ruleValue.trim().toLowerCase();
  if (!value) return false;
  if (rule.ruleType === "sender_email_exact") return Boolean(args.senderEmail && args.senderEmail === value);
  if (rule.ruleType === "sender_domain") return Boolean(args.senderDomain && args.senderDomain === value);
  const subject = args.subject?.trim().toLowerCase() ?? null;
  if (rule.ruleType === "subject_exact") return Boolean(subject && subject === value);
  if (rule.ruleType === "subject_contains") return Boolean(subject && subject.includes(value));
  return false;
}

function assertSenderDomainTrustAllowed(domain: string): void {
  if (isPublicFreeEmailDomain(domain)) {
    throw new InboundOrderTransitionError(
      `Sender domain ${domain} is a public/free email domain. Trust the exact sender email instead.`,
      400,
    );
  }
}

function getRecordAttachmentCandidates(record: InboundOrderRecord): unknown[] {
  const rawAttachments = getPathValue(record, "rawPayloadJson.attachments");
  const normalizedAttachments = getPathValue(record, "normalizedPayloadJson.attachments");
  if (Array.isArray(rawAttachments)) return rawAttachments;
  if (Array.isArray(normalizedAttachments)) return normalizedAttachments;
  return [];
}

function getFileAttachmentState(file: InboundOrderFile): string | null {
  const metadata = asRecord(file.metadataJson);
  return stringFromUnknown(metadata?.attachmentState) ?? null;
}

function isUnsafeForArtworkClassification(file: InboundOrderFile): boolean {
  const attachmentState = getFileAttachmentState(file);
  return file.status === "quarantined"
    || file.status === "rejected"
    || attachmentState === "blocked_file_type"
    || attachmentState === "scan_pending"
    || attachmentState === "quarantined";
}

function isMetadataOnlyAttachment(file: InboundOrderFile): boolean {
  return !file.fileRecordId;
}

function getAttachmentDownloadPolicy(args: {
  record: InboundOrderRecord;
  files: InboundOrderFile[];
  trustSummary: Pick<InboundSenderTrustSummary, "senderTrustStatus" | "canAutoDownloadAttachments">;
}): InboundAttachmentDownloadPolicy {
  const candidateCount = getRecordAttachmentCandidates(args.record).length;
  const hasAttachments = args.files.length > 0 || candidateCount > 0;
  if (!hasAttachments) return "no_attachments";

  const allKnownFilesBlocked = args.files.length > 0
    && args.files.every((file) => getFileAttachmentState(file) === "blocked_file_type");
  if (allKnownFilesBlocked && candidateCount <= args.files.length) return "blocked_file_type_only";

  const hasPendingTrust = args.files.some((file) => getFileAttachmentState(file) === "pending_trust");
  if (hasPendingTrust || !args.trustSummary.canAutoDownloadAttachments) return "pending_trust";

  return "auto_download_allowed";
}

export class InboundOrderService {
  constructor(
    private readonly repository = inboundOrdersRepository,
    private readonly orderRepository = new OrdersRepository(),
    private readonly priceLineItemFn = priceLineItem,
    private readonly customerIntelligence = repository === inboundOrdersRepository
      ? customerIntelligenceService
      : new CustomerIntelligenceService(repository as any),
  ) {}

  async updateAttachmentClassification(args: InboundAttachmentClassificationUpdateInput): Promise<{
    file: InboundOrderFile;
    rule: Awaited<ReturnType<typeof inboundOrdersRepository.createAttachmentClassificationRule>> | null;
    warning: string | null;
  }> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundOrderTransitionError("Inbound order record not found.", 404);
    const file = await this.repository.getFile(args.organizationId, args.inboundRecordId, args.fileId);
    if (!file) throw new InboundOrderTransitionError("Inbound attachment not found.", 404);

    const reason = `Staff manually classified as ${args.classification}.`;
    const previousMetadata = (file.metadataJson ?? {}) as Record<string, unknown>;
    const existingClassification = attachmentClassificationFromInboundFile(file);
    const classificationResult: InboundAttachmentClassificationResult = {
      classification: args.classification,
      confidence: 100,
      reasons: [reason],
      source: "manual_override",
      breakdown: {
        filename: existingClassification.breakdown.filename,
        content: existingClassification.breakdown.content,
        metadata: existingClassification.breakdown.metadata,
        manual: [reason],
        scores: existingClassification.breakdown.scores,
      },
    };

    let rule: Awaited<ReturnType<typeof inboundOrdersRepository.createAttachmentClassificationRule>> | null = null;
    let warning: string | null = null;

    if (args.rememberForCustomer) {
      const customerId = args.rule?.customerId?.trim() || record.matchedCustomerId || null;
      const matchValue = args.rule?.matchValue?.trim() || null;
      if (!customerId) {
        warning = "Classification updated, but no matched customer was available for a customer-specific rule.";
      } else if (!args.rule?.matchType || !matchValue) {
        warning = "Classification updated, but the rule matcher was incomplete.";
      } else {
        try {
          rule = await this.repository.createAttachmentClassificationRule({
            organizationId: args.organizationId,
            customerId,
            senderDomain: args.rule.senderDomain ?? null,
            matchType: args.rule.matchType,
            matchValue,
            classification: inboundAttachmentClassificationToRuleClassification(args.classification),
            createdByUserId: args.actorUserId,
            enabled: true,
          });
          await this.repository.createEvent({
            organizationId: args.organizationId,
            inboundRecordId: record.id,
            actorUserId: args.actorUserId,
            actorType: "user",
            eventType: "attachment.classification_rule.created",
            fromStatus: null,
            toStatus: null,
            message: `Created customer attachment classification rule for ${file.sourceFilename || "attachment"}.`,
            metadataJson: {
              fileId: file.id,
              ruleId: rule.id,
              customerId,
              senderDomain: args.rule.senderDomain ?? null,
              matchType: args.rule.matchType,
              matchValue,
              classification: args.classification,
            },
          });
        } catch (error) {
          warning = error instanceof Error
            ? `Classification updated, but the learning rule was not saved: ${error.message}`
            : "Classification updated, but the learning rule was not saved.";
        }
      }
    }

    const updated = await this.repository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      fileId: args.fileId,
      patch: {
        role: inboundOrderFileRoleForClassification(args.classification),
        metadataJson: {
          ...previousMetadata,
          attachmentClassification: classificationResult,
          attachmentClassificationUpdatedAt: new Date().toISOString(),
          attachmentClassificationUpdatedByUserId: args.actorUserId,
          attachmentClassificationRuleId: rule?.id ?? previousMetadata.attachmentClassificationRuleId ?? null,
          manualAttachmentClassification: true,
          poCandidate: args.classification === "PO",
          artworkCandidate: args.classification === "ARTWORK",
        },
        reviewNotes: reason,
      },
    });
    if (!updated) throw new InboundOrderTransitionError("Inbound attachment classification could not be updated.", 500);

    await this.repository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "attachment.classification.updated",
      fromStatus: null,
      toStatus: null,
      message: `Updated inbound attachment classification for ${updated.sourceFilename || "attachment"}.`,
      metadataJson: {
        fileId: updated.id,
        fileRecordId: updated.fileRecordId,
        classification: args.classification,
        previousClassification: existingClassification.classification,
        ruleId: rule?.id ?? null,
        rememberForCustomer: Boolean(args.rememberForCustomer),
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
      },
    });

    return { file: updated, rule, warning };
  }

  private async resetAttachmentClassification(args: {
    organizationId: string;
    inboundRecordId: string;
    fileId: string;
    actorUserId: string;
  }): Promise<{ file: InboundOrderFile; warning: string | null }> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundOrderTransitionError("Inbound order record not found.", 404);
    const file = await this.repository.getFile(args.organizationId, args.inboundRecordId, args.fileId);
    if (!file) throw new InboundOrderTransitionError("Inbound attachment not found.", 404);

    const previousMetadata = (file.metadataJson ?? {}) as Record<string, unknown>;
    const automaticClassification = classifyInboundAttachment({
      filename: file.sourceFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      contentDisposition: file.contentDisposition,
      contentId: stringFromUnknown(previousMetadata.contentId),
      extractedText: stringFromUnknown(previousMetadata.extractedText),
      sourceHint: stringFromUnknown(previousMetadata.sourceHint),
    });
    const updated = await this.repository.updateFile({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      fileId: args.fileId,
      patch: {
        role: inboundOrderFileRoleForClassification(automaticClassification.classification),
        metadataJson: {
          ...previousMetadata,
          attachmentClassification: automaticClassification,
          attachmentClassificationUpdatedAt: new Date().toISOString(),
          attachmentClassificationUpdatedByUserId: args.actorUserId,
          manualAttachmentClassification: false,
          poCandidate: automaticClassification.classification === "PO",
          artworkCandidate: automaticClassification.classification === "ARTWORK",
        },
        reviewNotes: "Manual attachment classification reset to AI classification.",
      },
    });
    if (!updated) throw new InboundOrderTransitionError("Inbound attachment classification could not be reset.", 500);

    await this.repository.createEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      actorUserId: args.actorUserId,
      actorType: "user",
      eventType: "attachment.classification.reset_to_ai",
      fromStatus: null,
      toStatus: null,
      message: `Reset inbound attachment classification to AI for ${updated.sourceFilename || "attachment"}.`,
      metadataJson: {
        fileId: updated.id,
        fileRecordId: updated.fileRecordId,
        classification: automaticClassification.classification,
        createsQuote: false,
        createsOrder: false,
        createsArtwork: false,
        createsProofs: false,
      },
    });

    return {
      file: updated,
      warning: isMetadataOnlyAttachment(updated)
        ? "Metadata-only attachment was reclassified, but its file content is still unavailable for artwork use."
        : null,
    };
  }

  async bulkUpdateAttachmentClassification(args: InboundAttachmentClassificationBulkInput): Promise<{
    files: InboundOrderFile[];
    errors: Array<{ fileId: string; message: string }>;
    warnings: Array<{ fileId: string; message: string }>;
  }> {
    const fileIds = Array.from(new Set(args.fileIds.map((fileId) => fileId.trim()).filter(Boolean)));
    const files: InboundOrderFile[] = [];
    const errors: Array<{ fileId: string; message: string }> = [];
    const warnings: Array<{ fileId: string; message: string }> = [];

    for (const fileId of fileIds) {
      try {
        const file = await this.repository.getFile(args.organizationId, args.inboundRecordId, fileId);
        if (!file) {
          errors.push({ fileId, message: "Inbound attachment not found." });
          continue;
        }
        if (args.classification === "ARTWORK" && isUnsafeForArtworkClassification(file)) {
          errors.push({ fileId, message: "Unsafe or quarantined attachments cannot be classified as usable artwork. Resolve the attachment safety state first." });
          continue;
        }
        const result = args.classification === "reset_to_ai"
          ? await this.resetAttachmentClassification({ ...args, fileId })
          : await this.updateAttachmentClassification({
            ...args,
            fileId,
            classification: args.classification,
            rememberForCustomer: false,
            rule: null,
          });
        files.push(result.file);
        const warning = result.warning ?? (isMetadataOnlyAttachment(result.file)
          ? "Metadata-only attachment was classified, but its file content is still unavailable for artwork use."
          : null);
        if (warning) warnings.push({ fileId, message: warning });
      } catch (error) {
        errors.push({ fileId, message: error instanceof Error ? error.message : "Attachment classification failed." });
      }
    }

    return { files, errors, warnings };
  }

  private async resolveSenderTrustSummary(args: {
    organizationId: string;
    senderEmail: string | null;
    senderDomain: string | null;
    files?: InboundOrderFile[];
    record?: InboundOrderRecord;
  }): Promise<InboundSenderTrustSummary> {
    const senderEmail = args.senderEmail?.trim().toLowerCase() || null;
    const senderDomain = args.senderDomain?.trim().toLowerCase() || null;
    let base: Omit<InboundSenderTrustSummary, "attachmentDownloadPolicy">;

    if (!senderEmail && !senderDomain) {
      base = {
        senderTrustStatus: "unknown",
        matchedTrustRuleId: null,
        trustRuleType: null,
        trustReason: "No sender email was captured for this inbound message.",
        canAutoDownloadAttachments: false,
      };
    } else {
      const listEnabledIgnoreRules = (this.repository as unknown as {
        listEnabledEmailIgnoreRules?: (organizationId: string) => Promise<InboundEmailIgnoreRule[]>;
      }).listEnabledEmailIgnoreRules;
      const ignoreRules = listEnabledIgnoreRules
        ? await listEnabledIgnoreRules.call(this.repository, args.organizationId)
        : [];
      const subject = args.record ? getInboundRecordSubject(args.record) : null;
      const matchedIgnoreRule = ignoreRules.find((rule) => inboundIgnoreRuleMatchesSender(rule, { senderEmail, senderDomain, subject })) ?? null;
      if (matchedIgnoreRule) {
        const conflictingTrustRule = (await this.repository.listEnabledEmailTrustRules(args.organizationId))
          .find((rule) => inboundEmailRuleKindsConflict(matchedIgnoreRule.ruleType, matchedIgnoreRule.ruleValue, rule.ruleType, rule.ruleValue)) ?? null;
        base = {
          senderTrustStatus: "ignored",
          matchedTrustRuleId: conflictingTrustRule?.id ?? null,
          trustRuleType: conflictingTrustRule?.ruleType ?? null,
          trustReason: conflictingTrustRule
            ? `trust_suppressed_by_ignore: Sender matched inbound ignore rule ${matchedIgnoreRule.ruleType}; conflicting trust rule ${conflictingTrustRule.ruleType} is suppressed.`
            : `ignored_due_to_rule: Sender matched inbound ignore rule ${matchedIgnoreRule.ruleType}.`,
          canAutoDownloadAttachments: false,
        };
        return {
          ...base,
          attachmentDownloadPolicy: args.record
            ? getAttachmentDownloadPolicy({
              record: args.record,
              files: args.files ?? [],
              trustSummary: base,
            })
            : "no_attachments",
        };
      }
      const rules = await this.repository.listEnabledEmailTrustRules(args.organizationId);
      let matchedRule: InboundEmailTrustRule | null = null;
      for (const rule of rules) {
        const value = rule.ruleValue.trim().toLowerCase();
        const matched = rule.ruleType === "sender_email_exact"
          ? Boolean(senderEmail && senderEmail === value)
          : rule.ruleType === "sender_domain"
            ? Boolean(senderDomain && !isPublicFreeEmailDomain(senderDomain) && senderDomain === value)
            : rule.ruleType === "customer_contact_email"
              ? Boolean(senderEmail && (value === "*" || senderEmail === value) && await this.repository.senderEmailMatchesCustomerContact(args.organizationId, senderEmail))
              : Boolean(senderDomain && !isPublicFreeEmailDomain(senderDomain) && (value === "*" || senderDomain === value) && await this.repository.senderDomainMatchesCustomerDomain(args.organizationId, senderDomain));
        if (matched) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        base = {
          senderTrustStatus: trustStatusForRuleType(matchedRule.ruleType),
          matchedTrustRuleId: matchedRule.id,
          trustRuleType: matchedRule.ruleType,
          trustReason: `Sender matched inbound trust rule ${matchedRule.ruleType}.`,
          canAutoDownloadAttachments: true,
        };
      } else if (senderEmail && await this.repository.senderEmailMatchesCustomerContact(args.organizationId, senderEmail)) {
        base = {
          senderTrustStatus: "trusted_contact",
          matchedTrustRuleId: null,
          trustRuleType: "customer_contact_email",
          trustReason: "Sender email matches an active customer contact.",
          canAutoDownloadAttachments: true,
        };
      } else if (senderDomain && !isPublicFreeEmailDomain(senderDomain) && await this.repository.senderDomainMatchesCustomerDomain(args.organizationId, senderDomain)) {
        base = {
          senderTrustStatus: "trusted_customer_domain",
          matchedTrustRuleId: null,
          trustRuleType: "customer_domain",
          trustReason: "Sender domain matches a known customer or customer contact domain.",
          canAutoDownloadAttachments: true,
        };
      } else {
        base = {
          senderTrustStatus: "untrusted",
          matchedTrustRuleId: null,
          trustRuleType: null,
          trustReason: "Sender is not trusted for automatic attachment download.",
          canAutoDownloadAttachments: false,
        };
      }
    }

    return {
      ...base,
      attachmentDownloadPolicy: args.record
        ? getAttachmentDownloadPolicy({
          record: args.record,
          files: args.files ?? [],
          trustSummary: base,
        })
        : "no_attachments",
    };
  }

  private async enrichRecordTrust(args: {
    organizationId: string;
    record: InboundOrderRecord;
    files?: InboundOrderFile[];
  }): Promise<InboundOrderRecordWithTrust> {
    const files = args.files ?? await this.repository.listFiles(args.organizationId, args.record.id);
    const senderEmail = getInboundRecordSenderEmail(args.record);
    const senderDomain = getInboundRecordSenderDomain(args.record);
    const trustSummary = await this.resolveSenderTrustSummary({
      organizationId: args.organizationId,
      senderEmail,
      senderDomain,
      files,
      record: args.record,
    });
    return {
      ...args.record,
      ...trustSummary,
    };
  }

  private matchesTrustFilter(record: InboundOrderRecordWithTrust, trustFilter: InboundOrderListFilters["trustFilter"]): boolean {
    if (!trustFilter || trustFilter === "all") return true;
    if (trustFilter === "trusted") return record.canAutoDownloadAttachments;
    if (trustFilter === "untrusted") return record.senderTrustStatus === "untrusted" || record.senderTrustStatus === "ignored";
    if (trustFilter === "unknown") return record.senderTrustStatus === "unknown";
    return record.attachmentDownloadPolicy === "pending_trust";
  }

  private async enrichDiagnosticRecordTrust(args: {
    organizationId: string;
    record: Record<string, unknown>;
    files: Array<Record<string, unknown>>;
  }): Promise<Record<string, unknown>> {
    const senderEmail = stringFromUnknown(args.record.senderEmail)?.toLowerCase() ?? null;
    const senderDomain = senderEmail?.split("@")[1]?.trim().toLowerCase() || null;
    const base = await this.resolveSenderTrustSummary({
      organizationId: args.organizationId,
      senderEmail,
      senderDomain,
    });
    const recordId = stringFromUnknown(args.record.id);
    const recordFiles = recordId
      ? args.files.filter((file) => file.inboundRecordId === recordId)
      : [];
    const attachmentCount = nonNegativeNumberFromUnknown(args.record.attachmentCount)
      ?? nonNegativeNumberFromUnknown(args.record.rawAttachmentCount)
      ?? nonNegativeNumberFromUnknown(args.record.normalizedAttachmentCount)
      ?? 0;
    const hasAttachments = recordFiles.length > 0 || attachmentCount > 0;
    const allKnownFilesBlocked = recordFiles.length > 0
      && recordFiles.every((file) => {
        const metadata = asRecord(file.metadataJson);
        return metadata?.attachmentState === "blocked_file_type";
      });
    const hasPendingTrust = recordFiles.some((file) => asRecord(file.metadataJson)?.attachmentState === "pending_trust");
    const attachmentDownloadPolicy: InboundAttachmentDownloadPolicy = !hasAttachments
      ? "no_attachments"
      : allKnownFilesBlocked
        ? "blocked_file_type_only"
        : hasPendingTrust || !base.canAutoDownloadAttachments
          ? "pending_trust"
          : "auto_download_allowed";

    return sanitizeDiagnosticRow({
      ...args.record,
      ...base,
      attachmentDownloadPolicy,
    });
  }

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

    const enrichedRecords = await Promise.all(records.map((record) => this.enrichRecordTrust({
      organizationId: args.organizationId,
      record,
    })));

    return {
      records: enrichedRecords.filter((record) => this.matchesTrustFilter(record, args.filters.trustFilter)),
      summary,
    };
  }

  async getInboundOrderCounts(args: { organizationId: string }): Promise<InboundOrderQueueSummary> {
    return this.repository.getInboundOrderCounts(args.organizationId);
  }

  async listEmailIgnoreRules(args: { organizationId: string }): Promise<InboundEmailIgnoreRule[]> {
    return this.repository.listEmailIgnoreRules(args.organizationId);
  }

  async listEmailTrustRules(args: { organizationId: string }): Promise<InboundEmailTrustRule[]> {
    return this.repository.listEmailTrustRules(args.organizationId);
  }

  async listEmailRuleConflicts(args: { organizationId: string }): Promise<Array<{
    ignoreRule: InboundEmailIgnoreRule;
    trustRule: InboundEmailTrustRule;
  }>> {
    const [ignoreRules, trustRules] = await Promise.all([
      this.repository.listEmailIgnoreRules(args.organizationId),
      this.repository.listEmailTrustRules(args.organizationId),
    ]);
    return ignoreRules
      .filter((ignoreRule) => ignoreRule.enabled)
      .flatMap((ignoreRule) => trustRules
        .filter((trustRule) => trustRule.enabled && inboundEmailRuleKindsConflict(ignoreRule.ruleType, ignoreRule.ruleValue, trustRule.ruleType, trustRule.ruleValue))
        .map((trustRule) => ({ ignoreRule, trustRule })));
  }

  private async resolveTrustRuleIgnoreConflict(args: {
    organizationId: string;
    ruleType: InboundEmailTrustRuleType;
    ruleValue: string;
    enabled: boolean;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<void> {
    if (!args.enabled) return;
    const conflict = (await this.repository.listEmailIgnoreRules(args.organizationId))
      .find((rule) => rule.enabled && inboundEmailRuleKindsConflict(rule.ruleType, rule.ruleValue, args.ruleType, args.ruleValue));
    if (!conflict) return;
    if (args.resolveConflict === "disable_conflicting_rule") {
      await this.repository.updateEmailIgnoreRule({
        organizationId: args.organizationId,
        id: conflict.id,
        enabled: false,
      });
      return;
    }
    throw new InboundEmailRuleConflictError(
      "This sender/domain is currently ignored. Trusting it will disable the ignore rule.",
      {
        conflictType: "trust_conflicted_with_ignore",
        conflictingRuleId: conflict.id,
        conflictingRuleType: conflict.ruleType,
        conflictingValue: conflict.ruleValue,
        currentRuleLocation: "Inbound Ignore Rules",
        recommendedResolution: "Trust and disable ignore rule",
      },
    );
  }

  private async resolveIgnoreRuleTrustConflict(args: {
    organizationId: string;
    ruleType: InboundEmailIgnoreRuleType;
    ruleValue: string;
    enabled: boolean;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<void> {
    if (!args.enabled) return;
    const conflict = (await this.repository.listEmailTrustRules(args.organizationId))
      .find((rule) => rule.enabled && inboundEmailRuleKindsConflict(args.ruleType, args.ruleValue, rule.ruleType, rule.ruleValue));
    if (!conflict) return;
    if (args.resolveConflict === "disable_conflicting_rule") {
      await this.repository.updateEmailTrustRule({
        organizationId: args.organizationId,
        id: conflict.id,
        enabled: false,
      });
      return;
    }
    throw new InboundEmailRuleConflictError(
      "This sender/domain is currently trusted. Ignoring it will disable the trust rule.",
      {
        conflictType: "ignore_conflicted_with_trust",
        conflictingRuleId: conflict.id,
        conflictingRuleType: conflict.ruleType,
        conflictingValue: conflict.ruleValue,
        currentRuleLocation: "Trusted Inbound Senders",
        recommendedResolution: "Ignore and disable trust rule",
      },
    );
  }

  async getEmailPullDiagnostics(args: {
    organizationId: string;
    subject?: string | null;
  }): Promise<InboundEmailPullDiagnosticsResponse["data"]> {
    const subject = args.subject?.trim() || null;
    const raw = await this.repository.getEmailPullDiagnostics({
      organizationId: args.organizationId,
      subject,
    });
    const mailboxes = raw.mailboxes.map((mailbox) => ({
      id: mailbox.id,
      provider: mailbox.provider,
      name: mailbox.name,
      emailAddress: mailbox.emailAddress,
      enabled: mailbox.enabled,
      isDefault: mailbox.isDefault,
      lastPulledAt: formatInboundDate(mailbox.lastPulledAt),
      lastPullStatus: mailbox.lastPullStatus,
      lastPullError: mailbox.lastPullError,
      latestPullSummary: safePullSummaryFromSettings(mailbox.settingsJson),
    }));
    const recentGmailProcessedMessages = mailboxes.flatMap((mailbox) => pullSummaryMessagesFromMailbox(mailbox, "processedMessages"));
    const recentGmailSkippedMessages = mailboxes.flatMap((mailbox) => pullSummaryMessagesFromMailbox(mailbox, "skippedMessages"));
    const recentGmailIgnoredMessages = mailboxes.flatMap((mailbox) => pullSummaryMessagesFromMailbox(mailbox, "ignoredMessages"));
    const recentGmailFailedMessages = mailboxes.flatMap((mailbox) => pullSummaryMessagesFromMailbox(mailbox, "failedMessages"));
    const recentGmailListedMessages = listedMessagesWithProcessingOutcome(
      mailboxes.flatMap(gmailListedMessagesFromMailbox),
      recentGmailProcessedMessages,
    );
    const activeIgnoreRules = raw.ignoreRules
      .filter((rule) => rule.enabled)
      .map((rule) => ({
        id: rule.id,
        ruleType: rule.ruleType,
        ruleValuePreview: redactIgnoreRuleValue(rule),
        enabled: rule.enabled,
        matchCount: rule.matchCount,
        lastMatchedAt: formatInboundDate(rule.lastMatchedAt),
        notes: rule.notes ?? null,
      }));
    const ruleConflicts = (await this.listEmailRuleConflicts({ organizationId: args.organizationId })).map(({ ignoreRule, trustRule }) => ({
      ignoreRuleId: ignoreRule.id,
      ignoreRuleType: ignoreRule.ruleType,
      ignoreRuleValue: ignoreRule.ruleValue,
      trustRuleId: trustRule.id,
      trustRuleType: trustRule.ruleType,
      trustRuleValue: trustRule.ruleValue,
      reason: "trust_suppressed_by_ignore",
      recommendedResolution: "Keep trust by disabling the ignore rule, or keep ignore by disabling the trust rule.",
    }));
    const matchingIgnoreRules = subject
      ? activeIgnoreRules.filter((rule) => {
        const original = raw.ignoreRules.find((candidate) => candidate.id === rule.id);
        if (!original) return false;
        const search = subject.toLowerCase();
        return [
          original.ruleType,
          original.ruleValue,
          original.notes,
          rule.ruleValuePreview,
          `${original.matchCount} matches`,
        ].some((value) => String(value ?? "").toLowerCase().includes(search));
      })
      : [];
    const recentPullDiagnostics = raw.recentPullDiagnostics.map(sanitizeDiagnosticRow);
    const subjectPullDiagnostics = raw.subjectPullDiagnostics.map(sanitizeDiagnosticRow);
    const allPullDiagnostics = [...subjectPullDiagnostics, ...recentPullDiagnostics];
    const diagnosticFiles = [...raw.recentFiles, ...raw.subjectFiles].map(sanitizeDiagnosticRow);
    const matchingRecords = await Promise.all(raw.subjectRecords.map(async (record) => ({
      ...await this.enrichDiagnosticRecordTrust({
        organizationId: args.organizationId,
        record: enrichEmailRecordDiagnostic(record),
        files: diagnosticFiles,
      }),
      attachmentPipelineDiagnostics: buildAttachmentPipelineDiagnostics(record, diagnosticFiles, allPullDiagnostics),
    })));
    const matchingFiles = raw.subjectFiles.map(sanitizeDiagnosticRow);
    const matchingGmailListedMessages = subject
      ? recentGmailListedMessages.filter((message) => diagnosticSearchMatches(message, subject))
      : [];
    const matchingProcessedMessages = subject
      ? recentGmailProcessedMessages.filter((message) => diagnosticSearchMatches(message, subject))
      : [];
    const matchingSkippedMessages = subject
      ? recentGmailSkippedMessages.filter((message) => diagnosticSearchMatches(message, subject))
      : [];
    const matchingIgnoredMessages = subject
      ? recentGmailIgnoredMessages.filter((message) => diagnosticSearchMatches(message, subject))
      : [];
    const matchingFailedMessages = subject
      ? recentGmailFailedMessages.filter((message) => diagnosticSearchMatches(message, subject))
      : [];
    const subjectFound = matchingRecords.length > 0
      || matchingFiles.length > 0
      || matchingIgnoreRules.length > 0
      || matchingGmailListedMessages.length > 0
      || matchingProcessedMessages.length > 0
      || matchingSkippedMessages.length > 0
      || matchingIgnoredMessages.length > 0
      || matchingFailedMessages.length > 0;
    const recentCreatedInboundRecords = await Promise.all(raw.recentCreatedRecords.map(async (record) => ({
      ...await this.enrichDiagnosticRecordTrust({
        organizationId: args.organizationId,
        record: enrichEmailRecordDiagnostic(record),
        files: diagnosticFiles,
      }),
      attachmentPipelineDiagnostics: buildAttachmentPipelineDiagnostics(record, diagnosticFiles, allPullDiagnostics),
    })));

    return {
      organizationId: args.organizationId,
      generatedAt: new Date().toISOString(),
      subject,
      enabledMailboxCount: mailboxes.filter((mailbox) => mailbox.enabled).length,
      mailboxes,
      latestPullSummary: mailboxes.find((mailbox) => mailbox.latestPullSummary != null)?.latestPullSummary ?? null,
      recentFailedMessageDiagnostics: raw.recentFailedDiagnostics.map(sanitizeDiagnosticRow),
      recentPullMessageDiagnostics: allPullDiagnostics,
      recentIgnoredMessageDiagnostics: raw.recentIgnoredDiagnostics.map(sanitizeDiagnosticRow),
      recentCreatedInboundRecords,
      recentInboundFiles: raw.recentFiles.map(sanitizeDiagnosticRow),
      recentGmailListedMessages,
      recentGmailProcessedMessages,
      recentGmailSkippedMessages,
      recentGmailIgnoredMessages,
      recentGmailFailedMessages,
      ignoreRuleCount: raw.ignoreRules.length,
      activeIgnoreRules,
      ruleConflicts,
      subjectSearch: {
        provided: Boolean(subject),
        found: subjectFound,
        matchingRecords,
        matchingFiles,
        matchingIgnoreRules,
        matchingGmailListedMessages,
        matchingProcessedMessages,
        matchingSkippedMessages,
        matchingIgnoredMessages,
        matchingFailedMessages,
        notReturnedByGmailListQuery: Boolean(subject && matchingGmailListedMessages.length === 0),
        gmailListMessage: subject && matchingGmailListedMessages.length === 0
          ? "Not returned by Gmail list query for latest pull."
          : null,
        duplicateDetection: {
          durableSkippedMessageLogsStored: false,
          possibleDuplicateRecords: matchingRecords.filter((record) => Boolean((record as Record<string, unknown>).idempotencyKey)),
        },
      },
      storageNotes: {
        latestPullSummaryStored: mailboxes.some((mailbox) => mailbox.latestPullSummary != null),
        perMessageFailureDiagnosticsStored: raw.recentFailedDiagnostics.length > 0 || allPullDiagnostics.length > 0,
        ignoredMessageDiagnosticsStored: raw.recentIgnoredDiagnostics.length > 0,
        duplicateSkipDiagnosticsStored: allPullDiagnostics.some((item) => {
          const metadata = asRecord(item.metadataJson);
          return typeof metadata?.skippedReason === "string" && metadata.skippedReason.includes("duplicate");
        }),
      },
    };
  }

  async createEmailIgnoreRule(args: {
    organizationId: string;
    actorUserId: string;
    ruleType: InboundEmailIgnoreRuleType;
    ruleValue: string;
    notes?: string | null;
    enabled?: boolean;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<InboundEmailIgnoreRule> {
    const ruleValue = normalizeInboundEmailIgnoreRuleValue(args.ruleType, args.ruleValue);
    if (!ruleValue) throw new InboundOrderTransitionError("Rule value is required.", 400);
    const existing = await this.repository.getEmailIgnoreRuleByTypeValue?.({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
    });
    if (existing) {
      throw new InboundOrderTransitionError(
        existing.enabled
          ? "An enabled inbound email ignore rule already exists for this type and value."
          : "An inbound email ignore rule already exists for this type and value. Edit the existing disabled rule instead.",
        409,
      );
    }
    await this.resolveIgnoreRuleTrustConflict({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
      enabled: args.enabled ?? true,
      resolveConflict: args.resolveConflict,
    });
    return this.repository.createEmailIgnoreRule({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
      notes: args.notes ?? null,
      createdByUserId: args.actorUserId,
      enabled: args.enabled ?? true,
    });
  }

  async updateEmailIgnoreRule(args: {
    organizationId: string;
    id: string;
    ruleType?: InboundEmailIgnoreRuleType;
    ruleValue?: string;
    enabled?: boolean;
    notes?: string | null;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<InboundEmailIgnoreRule> {
    const current = (await this.repository.listEmailIgnoreRules(args.organizationId)).find((rule) => rule.id === args.id);
    if (!current) throw new InboundOrderTransitionError("Inbound email ignore rule not found", 404);
    const nextRuleType = args.ruleType ?? current.ruleType;
    const nextRuleValue = typeof args.ruleValue === "string"
      ? normalizeInboundEmailIgnoreRuleValue(nextRuleType, args.ruleValue)
      : current.ruleValue;
    if (!nextRuleValue) throw new InboundOrderTransitionError("Rule value is required.", 400);
    const nextEnabled = typeof args.enabled === "boolean" ? args.enabled : current.enabled;
    const duplicate = await this.repository.getEmailIgnoreRuleByTypeValue?.({
      organizationId: args.organizationId,
      ruleType: nextRuleType,
      ruleValue: nextRuleValue,
    });
    if (duplicate && duplicate.id !== args.id) {
      throw new InboundOrderTransitionError(
        duplicate.enabled && nextEnabled
          ? "An enabled inbound email ignore rule already exists for this type and value."
          : "An inbound email ignore rule already exists for this type and value. Edit the existing rule instead.",
        409,
      );
    }
    await this.resolveIgnoreRuleTrustConflict({
      organizationId: args.organizationId,
      ruleType: nextRuleType,
      ruleValue: nextRuleValue,
      enabled: nextEnabled,
      resolveConflict: args.resolveConflict,
    });
    const rule = await this.repository.updateEmailIgnoreRule({
      ...args,
      ruleType: nextRuleType,
      ruleValue: nextRuleValue,
    });
    if (!rule) throw new InboundOrderTransitionError("Inbound email ignore rule not found", 404);
    return rule;
  }

  async deleteEmailIgnoreRule(args: { organizationId: string; id: string }): Promise<InboundEmailIgnoreRule> {
    const rule = await this.repository.deleteEmailIgnoreRule(args.organizationId, args.id);
    if (!rule) throw new InboundOrderTransitionError("Inbound email ignore rule not found", 404);
    return rule;
  }

  async createEmailTrustRule(args: {
    organizationId: string;
    actorUserId: string;
    ruleType: InboundEmailTrustRuleType;
    ruleValue: string;
    notes?: string | null;
    enabled?: boolean;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<InboundEmailTrustRule> {
    const ruleValue = normalizeInboundEmailTrustRuleValue(args.ruleType, args.ruleValue);
    if (!ruleValue) throw new InboundOrderTransitionError("Rule value is required.", 400);
    if (args.ruleType === "sender_domain") {
      assertSenderDomainTrustAllowed(ruleValue);
    }
    const existing = (await this.repository.listEmailTrustRules(args.organizationId))
      .find((rule) => rule.ruleType === args.ruleType && rule.ruleValue === ruleValue) ?? null;
    if (existing) {
      throw new InboundOrderTransitionError(
        existing.enabled
          ? "An enabled inbound email trust rule already exists for this type and value."
          : "An inbound email trust rule already exists for this type and value. Edit the existing disabled rule instead.",
        409,
      );
    }
    await this.resolveTrustRuleIgnoreConflict({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
      enabled: args.enabled ?? true,
      resolveConflict: args.resolveConflict,
    });
    return this.repository.createEmailTrustRule({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
      notes: args.notes ?? null,
      createdByUserId: args.actorUserId,
      enabled: args.enabled ?? true,
    });
  }

  async updateEmailTrustRule(args: {
    organizationId: string;
    id: string;
    ruleType?: InboundEmailTrustRuleType;
    ruleValue?: string;
    enabled?: boolean;
    notes?: string | null;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<InboundEmailTrustRule> {
    const current = (await this.repository.listEmailTrustRules(args.organizationId)).find((rule) => rule.id === args.id);
    if (!current) throw new InboundOrderTransitionError("Inbound email trust rule not found", 404);
    const nextRuleType = args.ruleType ?? current.ruleType;
    const nextRuleValue = typeof args.ruleValue === "string"
      ? normalizeInboundEmailTrustRuleValue(nextRuleType, args.ruleValue)
      : current.ruleValue;
    if (!nextRuleValue) throw new InboundOrderTransitionError("Rule value is required.", 400);
    if (nextRuleType === "sender_domain") {
      assertSenderDomainTrustAllowed(nextRuleValue);
    }
    const nextEnabled = typeof args.enabled === "boolean" ? args.enabled : current.enabled;
    const duplicate = (await this.repository.listEmailTrustRules(args.organizationId))
      .find((rule) => rule.id !== args.id && rule.ruleType === nextRuleType && rule.ruleValue === nextRuleValue) ?? null;
    if (duplicate) {
      throw new InboundOrderTransitionError(
        duplicate.enabled && nextEnabled
          ? "An enabled inbound email trust rule already exists for this type and value."
          : "An inbound email trust rule already exists for this type and value. Edit the existing rule instead.",
        409,
      );
    }
    await this.resolveTrustRuleIgnoreConflict({
      organizationId: args.organizationId,
      ruleType: nextRuleType,
      ruleValue: nextRuleValue,
      enabled: nextEnabled,
      resolveConflict: args.resolveConflict,
    });
    const rule = await this.repository.updateEmailTrustRule({
      ...args,
      ruleType: nextRuleType,
      ruleValue: nextRuleValue,
    });
    if (!rule) throw new InboundOrderTransitionError("Inbound email trust rule not found", 404);
    return rule;
  }

  async deleteEmailTrustRule(args: { organizationId: string; id: string }): Promise<InboundEmailTrustRule> {
    const rule = await this.repository.deleteEmailTrustRule(args.organizationId, args.id);
    if (!rule) throw new InboundOrderTransitionError("Inbound email trust rule not found", 404);
    return rule;
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
      record: await this.enrichRecordTrust({
        organizationId: args.organizationId,
        record,
        files,
      }),
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

  private async getOrCreateEmailIgnoreRuleForQueueAction(args: {
    organizationId: string;
    actorUserId: string;
    ruleType: InboundEmailIgnoreRuleType;
    ruleValue: string;
    notes?: string | null;
    resolveConflict?: "disable_conflicting_rule";
  }): Promise<{ rule: InboundEmailIgnoreRule; created: boolean }> {
    const ruleValue = normalizeInboundEmailIgnoreRuleValue(args.ruleType, args.ruleValue);
    if (!ruleValue) throw new InboundOrderTransitionError("Rule value is required.", 400);

    const existing = await this.repository.getEmailIgnoreRuleByTypeValue?.({
      organizationId: args.organizationId,
      ruleType: args.ruleType,
      ruleValue,
    });
    if (existing?.enabled) {
      return { rule: existing, created: false };
    }

    try {
      const rule = await this.createEmailIgnoreRule({
        organizationId: args.organizationId,
        ruleType: args.ruleType,
        ruleValue,
        notes: args.notes,
        actorUserId: args.actorUserId,
        resolveConflict: args.resolveConflict,
      });
      return { rule, created: true };
    } catch (error) {
      const duplicate = await this.repository.getEmailIgnoreRuleByTypeValue?.({
        organizationId: args.organizationId,
        ruleType: args.ruleType,
        ruleValue,
      });
      if (duplicate?.enabled && error instanceof InboundOrderTransitionError && error.statusCode === 409) {
        return { rule: duplicate, created: false };
      }
      throw error;
    }
  }

  async applyIgnoreAction(args: InboundOrderIgnoreActionInput): Promise<InboundOrderDetail> {
    return (await this.applyIgnoreActionWithSummary(args)).detail;
  }

  async applyIgnoreActionWithSummary(args: InboundOrderIgnoreActionInput): Promise<InboundOrderIgnoreActionResult> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundOrderTransitionError("Inbound order record not found", 404);
    if (record.createdQuoteId || record.createdOrderId || record.status === "submitted") {
      throw new InboundOrderTransitionError("Converted inbound records cannot be ignored from the queue.", 409);
    }

    const note = args.note?.trim() || null;
    const ruleRequests = getIgnoreRuleRequestsForAction(record, args.action);
    if (args.action !== "ignore_once" && ruleRequests.length === 0) {
      throw new InboundOrderTransitionError("No sender, domain, or subject value was available for this ignore rule.", 400);
    }

    const appliedRules: Array<{ rule: InboundEmailIgnoreRule; created: boolean }> = [];
    for (const request of ruleRequests) {
      appliedRules.push(await this.getOrCreateEmailIgnoreRuleForQueueAction({
        organizationId: args.organizationId,
        ruleType: request.ruleType,
        ruleValue: request.ruleValue,
        notes: note ?? `Created from inbound queue action ${args.action}.`,
        actorUserId: args.actorUserId,
        resolveConflict: args.resolveConflict,
      }));
    }

    const updated = await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch: {
        status: "ignored",
        reviewOutcome: "ignored",
        requiresHumanDecision: false,
        reviewRequiredReason: null,
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.ignored",
        fromStatus: record.status,
        toStatus: "ignored",
        message: note,
        metadataJson: {
          action: args.action,
          ruleIds: appliedRules.map(({ rule }) => rule.id),
          rules: appliedRules.map(({ rule, created }) => ({
            id: rule.id,
            ruleType: rule.ruleType,
            ruleValue: rule.ruleValue,
            created,
          })),
        },
      },
    });

    if (!updated) throw new InboundOrderTransitionError("Inbound order record not found", 404);
    const detail = await this.getDetail({ organizationId: args.organizationId, inboundRecordId: args.inboundRecordId });
    if (!detail) throw new InboundOrderTransitionError("Inbound order record not found after ignore action", 404);
    return {
      detail,
      rulesCreated: appliedRules.filter(({ created }) => created).length,
      rulesAlreadyExisted: appliedRules.filter(({ created }) => !created).length,
    };
  }

  async deleteQueueRecord(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    note?: string | null;
  }): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundOrderTransitionError("Inbound order record not found", 404);
    if (record.createdQuoteId || record.createdOrderId || record.status === "submitted") {
      throw new InboundOrderTransitionError("Converted inbound records cannot be deleted from the queue.", 409);
    }

    const note = args.note?.trim() || null;
    const updated = await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch: {
        status: "terminal",
        reviewOutcome: "deleted",
        archivedAt: new Date(),
        requiresHumanDecision: false,
        reviewRequiredReason: null,
        rejectionReason: null,
        rejectedAt: null,
        rejectedByUserId: null,
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "review.queue_deleted",
        fromStatus: record.status,
        toStatus: "terminal",
        message: note,
        metadataJson: {
          softDelete: true,
          sourceEmailDeleted: false,
          auditEventsPreserved: true,
        },
      },
    });

    if (!updated) throw new InboundOrderTransitionError("Inbound order record not found", 404);
    const detail = await this.getDetail({ organizationId: args.organizationId, inboundRecordId: args.inboundRecordId });
    if (!detail) throw new InboundOrderTransitionError("Inbound order record not found after queue delete", 404);
    return detail;
  }

  async applyBulkQueueAction(args: InboundOrderBulkActionInput): Promise<InboundOrderBulkActionResult> {
    const updatedIds: string[] = [];
    const actualErrors: Array<{ id: string; message: string }> = [];
    let rulesCreated = 0;
    let rulesAlreadyExisted = 0;
    const uniqueIds = Array.from(new Set(args.recordIds));

    for (const inboundRecordId of uniqueIds) {
      try {
        if (args.action === "trust_sender" || args.action === "trust_domain") {
          const record = await this.repository.getRecord(args.organizationId, inboundRecordId);
          if (!record) throw new InboundOrderTransitionError("Inbound order record not found", 404);
          const senderEmail = getInboundRecordSenderEmail(record);
          const senderDomain = getInboundRecordSenderDomain(record);
          const ruleType: InboundEmailTrustRuleType = args.action === "trust_sender"
            ? "sender_email_exact"
            : "sender_domain";
          const ruleValue = args.action === "trust_sender" ? senderEmail : senderDomain;
          if (!ruleValue) {
            throw new InboundOrderTransitionError(
              args.action === "trust_sender"
                ? "No sender email was available for this trust rule."
                : "No sender domain was available for this trust rule.",
              400,
            );
          }
          if (ruleType === "sender_domain") {
            assertSenderDomainTrustAllowed(ruleValue);
          }
          await this.createEmailTrustRule({
            organizationId: args.organizationId,
            ruleType,
            ruleValue,
            notes: args.note?.trim() || `Created from inbound queue bulk action ${args.action}.`,
            actorUserId: args.actorUserId,
            resolveConflict: args.resolveConflict,
          });
        } else if (args.action === "delete") {
          await this.deleteQueueRecord({ ...args, inboundRecordId });
        } else if (args.action === "reject") {
          await this.applyReviewAction({
            organizationId: args.organizationId,
            inboundRecordId,
            actorUserId: args.actorUserId,
            action: "reject",
            note: args.note,
          });
        } else {
          const result = await this.applyIgnoreActionWithSummary({
            organizationId: args.organizationId,
            inboundRecordId,
            actorUserId: args.actorUserId,
            action: args.action,
            note: args.note,
            resolveConflict: args.resolveConflict,
          });
          rulesCreated += result.rulesCreated;
          rulesAlreadyExisted += result.rulesAlreadyExisted;
        }
        updatedIds.push(inboundRecordId);
      } catch (error) {
        actualErrors.push({
          id: inboundRecordId,
          message: error instanceof Error ? error.message : "Failed to update inbound record",
        });
      }
    }

    return {
      updatedIds,
      errors: actualErrors,
      rulesCreated,
      rulesAlreadyExisted,
      emailsProcessed: updatedIds.length,
      emailsSkipped: actualErrors.length,
      actualErrors,
    };
  }

  async combineInboundRecords(args: InboundOrderCombineInput): Promise<InboundOrderCombineResult> {
    const recordIds = Array.from(new Set(args.recordIds));
    if (recordIds.length < 2) {
      throw new InboundOrderTransitionError("Select at least two inbound records to combine.", 400);
    }
    if (!recordIds.includes(args.primaryRecordId)) {
      throw new InboundOrderTransitionError("The primary inbound record must be one of the selected records.", 400);
    }

    const records = await Promise.all(recordIds.map((id) => this.repository.getRecord(args.organizationId, id)));
    if (records.some((record) => !record)) {
      throw new InboundOrderTransitionError("One or more selected inbound records were not found for this organization.", 404);
    }
    const selectedRecords = records as InboundOrderRecord[];
    for (const record of selectedRecords) {
      const normalized = record.normalizedPayloadJson && typeof record.normalizedPayloadJson === "object"
        ? record.normalizedPayloadJson as Record<string, unknown>
        : {};
      if (record.createdQuoteId || record.createdOrderId || record.status === "submitted") {
        throw new InboundOrderTransitionError("Converted inbound records cannot be combined.", 409);
      }
      if (record.status === "terminal" || record.status === "ignored" || normalized.combinedParentRecordId) {
        throw new InboundOrderTransitionError("Rejected, deleted, or already merged inbound records cannot be combined.", 409);
      }
    }

    const customerIds = new Set(selectedRecords.map((record) => record.matchedCustomerId).filter((id): id is string => Boolean(id)));
    if (customerIds.size > 1 && !args.confirmCustomerMismatch) {
      throw new InboundOrderTransitionError("Selected inbound records have different matched customers. Confirm the mismatch before combining.", 409);
    }

    const listSnapshots = (this.repository as Partial<InboundOrdersRepository>).listReviewSnapshots;
    const snapshotsByRecord = await Promise.all(selectedRecords.map(async (record) => ({
      recordId: record.id,
      snapshots: typeof listSnapshots === "function"
        ? await listSnapshots.call(this.repository, args.organizationId, record.id)
        : [],
    })));
    const recordsWithDrafts = snapshotsByRecord.filter(({ snapshots }) => snapshots.length > 0).map(({ recordId }) => recordId);
    if (recordsWithDrafts.length === 1 && recordsWithDrafts[0] !== args.primaryRecordId) {
      throw new InboundOrderTransitionError("Choose the selected inbound record with the existing review draft as the primary job so its draft is preserved.", 409);
    }
    if (recordsWithDrafts.length > 1 && !args.confirmMultipleDrafts) {
      throw new InboundOrderTransitionError("Multiple selected inbound records have review drafts. Choose the primary draft and confirm before combining.", 409);
    }

    const selectedSources = selectedRecords.map((record) => {
      const evidence = getManualInboundEvidence(record);
      return {
        recordId: record.id,
        sourceType: record.sourceType,
        sourceLabel: record.sourceLabel,
        sourceRecordId: record.sourceRecordId,
        sourceMessageId: record.sourceMessageId,
        externalReference: record.externalReference,
        receivedAt: record.receivedAt.toISOString(),
        matchedCustomerId: record.matchedCustomerId,
        hasReviewDraft: recordsWithDrafts.includes(record.id),
        evidence: {
          senderName: evidence.senderName,
          senderEmail: evidence.senderEmail,
          subject: evidence.subject,
          bodyText: evidence.bodyText,
          notes: evidence.notes,
          reference: evidence.reference,
        },
      };
    });
    const primary = selectedRecords.find((record) => record.id === args.primaryRecordId)!;
    const existingPayload = primary.normalizedPayloadJson && typeof primary.normalizedPayloadJson === "object"
      ? primary.normalizedPayloadJson as Record<string, unknown>
      : {};
    const existingSources = Array.isArray(existingPayload.combinedSources)
      ? existingPayload.combinedSources.filter((source): source is Record<string, unknown> => (
        Boolean(source) && typeof source === "object" && !Array.isArray(source)
      ))
      : [];
    const sourcesByRecordId = new Map<string, Record<string, unknown>>();
    for (const source of [...existingSources, ...selectedSources]) {
      const recordId = typeof source.recordId === "string" ? source.recordId : null;
      if (recordId) sourcesByRecordId.set(recordId, source);
    }
    const combinedSources = Array.from(sourcesByRecordId.values());
    const combined = await this.repository.combineRecords({
      organizationId: args.organizationId,
      primaryRecordId: args.primaryRecordId,
      childRecordIds: recordIds.filter((id) => id !== args.primaryRecordId),
      actorUserId: args.actorUserId,
      combinedSources,
    });
    if (!combined) throw new InboundOrderTransitionError("Primary inbound record was not found.", 404);
    const detail = await this.getDetail({ organizationId: args.organizationId, inboundRecordId: combined.id });
    if (!detail) throw new InboundOrderTransitionError("Combined inbound record could not be loaded.", 500);
    return { detail, combinedSourceCount: combinedSources.length, reparseRecommended: true };
  }

  async attachInboundRecordToOrder(args: InboundOrderAttachToOrderInput): Promise<InboundOrderAttachToOrderResult> {
    const detail = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });
    if (!detail) throw new InboundOrderTransitionError("Inbound order record not found.", 404);
    const { record } = detail;
    const normalized = record.normalizedPayloadJson && typeof record.normalizedPayloadJson === "object"
      ? record.normalizedPayloadJson as Record<string, unknown>
      : {};
    if (record.createdQuoteId || record.createdOrderId || record.status === "submitted") {
      throw new InboundOrderTransitionError("Converted inbound records cannot be attached to another order.", 409);
    }
    if (record.status === "terminal" || record.status === "ignored" || normalized.attachedOrderId) {
      throw new InboundOrderTransitionError("Rejected, deleted, merged, or already attached inbound records cannot be attached to an order.", 409);
    }

    const order = await this.orderRepository.getOrderById(args.organizationId, args.orderId);
    if (!order) throw new InboundOrderTransitionError("Selected order was not found for this organization.", 404);
    if (record.matchedCustomerId && order.customerId && record.matchedCustomerId !== order.customerId && !args.confirmCustomerMismatch) {
      throw new InboundOrderTransitionError("The inbound record and selected order have different customers. Confirm the mismatch before attaching.", 409);
    }

    const orderLineItemIds = new Set((order.lineItems ?? []).map((lineItem: any) => String(lineItem.id)));
    const assignments = new Map(args.artworkAssignments.map((assignment) => [assignment.fileId, assignment]));
    for (const assignment of args.artworkAssignments) {
      if (assignment.orderLineItemId && !orderLineItemIds.has(assignment.orderLineItemId)) {
        throw new InboundOrderTransitionError("Selected artwork line item does not belong to the target order.", 400);
      }
    }

    const existingAttachments = typeof (this.orderRepository as any).listAllOrderAttachments === "function"
      ? await (this.orderRepository as any).listAllOrderAttachments(args.orderId)
      : [];
    const existingFileRecordIds = new Set(existingAttachments.map((attachment: any) => attachment.fileRecordId).filter(Boolean));
    const createdAttachmentIds: string[] = [];
    const skippedAttachments: Array<{ fileId: string; reason: string }> = [];

    if (args.includeAttachments) {
      for (const file of detail.files) {
        const classification = attachmentClassificationFromInboundFile(file).classification;
        const isJunk = classification === "IGNORE_INLINE";
        if (isJunk && !args.includeJunkAttachments) {
          skippedAttachments.push({ fileId: file.id, reason: "Junk/signature attachment was not included." });
          continue;
        }
        if (!file.fileRecordId) {
          skippedAttachments.push({ fileId: file.id, reason: "Metadata-only attachment has no usable stored file." });
          continue;
        }
        if (file.status === "rejected" || file.status === "quarantined") {
          skippedAttachments.push({ fileId: file.id, reason: "Unsafe attachment was not added to the order." });
          continue;
        }
        if (existingFileRecordIds.has(file.fileRecordId)) {
          skippedAttachments.push({ fileId: file.id, reason: "This stored file is already attached to the order." });
          continue;
        }
        const assignment = assignments.get(file.id);
        if (assignment && classification !== "ARTWORK") {
          throw new InboundOrderTransitionError("Only artwork-classified inbound files can be assigned to an order line item.", 400);
        }
        const role = classification === "ARTWORK"
          ? "artwork" as const
          : classification === "PO"
            ? "customer_po" as const
            : classification === "REFERENCE"
              ? "reference" as const
              : "other" as const;
        const attachment = await this.orderRepository.createOrderAttachment({
          orderId: args.orderId,
          orderLineItemId: assignment?.orderLineItemId ?? null,
          fileRecordId: file.fileRecordId,
          uploadedByUserId: args.actorUserId,
          uploadedByName: "Inbound order attachment",
          fileName: file.sourceFilename || "Inbound attachment",
          fileUrl: null,
          fileSize: file.sizeBytes ?? null,
          mimeType: file.mimeType ?? null,
          description: `Attached from inbound record ${record.id}${args.includeMessageHistory ? `: ${getManualInboundEvidence(record).subject ?? "inbound message"}` : ""}.`,
          originalFilename: file.sourceFilename ?? null,
          sizeBytes: file.sizeBytes ?? null,
          checksum: file.checksum ?? null,
          role,
          side: assignment?.side ?? "na",
          isPrimary: false,
          customerVisible: false,
        });
        existingFileRecordIds.add(file.fileRecordId);
        createdAttachmentIds.push(attachment.id);
        await this.repository.updateFile({
          organizationId: args.organizationId,
          inboundRecordId: record.id,
          fileId: file.id,
          patch: { createdOrderAttachmentId: attachment.id },
        });
      }
    }

    const evidence = getManualInboundEvidence(record);
    const combinedSourceRecordIds = Array.isArray(normalized.combinedSources)
      ? normalized.combinedSources
        .map((source) => source && typeof source === "object" && !Array.isArray(source) && typeof (source as Record<string, unknown>).recordId === "string"
          ? (source as Record<string, unknown>).recordId as string
          : null)
        .filter((recordId): recordId is string => Boolean(recordId))
      : [record.id];
    const parsedNotes = args.includeParsedNotes
      ? detail.latestReviewSnapshot?.payloadJson ?? null
      : null;
    await this.orderRepository.createOrderAuditLog({
      orderId: args.orderId,
      orderLineItemId: null,
      userId: args.actorUserId,
      userName: null,
      actionType: "inbound_record_attached",
      fromStatus: null,
      toStatus: null,
      note: args.includeMessageHistory
        ? `Inbound message attached: ${evidence.subject ?? record.externalReference ?? record.id}.`
        : `Inbound attachments linked from record ${record.id}.`,
      metadata: {
        inboundRecordId: record.id,
        combinedSourceRecordIds,
        sourceType: record.sourceType,
        senderName: evidence.senderName,
        senderEmail: evidence.senderEmail,
        subject: evidence.subject,
        receivedAt: record.receivedAt.toISOString(),
        included: {
          messageHistory: args.includeMessageHistory,
          attachments: args.includeAttachments,
          parsedNotes: args.includeParsedNotes,
          junkAttachments: args.includeJunkAttachments,
        },
        createdAttachmentIds,
        skippedAttachments,
        parsedNotes,
      },
    });

    const now = new Date();
    const updated = await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: record.id,
      patch: {
        status: "ignored",
        reviewOutcome: "attached_to_order",
        archivedAt: now,
        requiresHumanDecision: false,
        reviewRequiredReason: null,
        normalizedPayloadJson: {
          ...normalized,
          attachedOrderId: args.orderId,
          attachedOrderNumber: (order as any).orderNumber ?? null,
          attachedAt: now.toISOString(),
          attachedByUserId: args.actorUserId,
          attachedAttachmentIds: createdAttachmentIds,
        },
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "order.attached",
        fromStatus: record.status,
        toStatus: "ignored",
        message: `Attached to existing order ${(order as any).orderNumber ?? args.orderId}.`,
        metadataJson: { orderId: args.orderId, createdAttachmentIds, skippedAttachments },
      },
    });
    if (!updated) throw new InboundOrderTransitionError("Inbound record could not be marked attached to the order.", 500);

    return {
      orderId: args.orderId,
      orderNumber: (order as any).orderNumber ?? null,
      inboundRecordId: record.id,
      createdAttachmentIds,
      skippedAttachments,
    };
  }

  async searchActiveOrdersForInboundAttachment(args: {
    organizationId: string;
    search: string | null;
    limit?: number;
  }) {
    const searchOrders = (this.orderRepository as any).searchActiveOrdersForInboundAttachment;
    if (typeof searchOrders !== "function") return [];
    return searchOrders.call(this.orderRepository, args.organizationId, args.search, args.limit ?? 20);
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
      files: await this.repository.listFiles(args.organizationId, args.inboundRecordId),
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
    const normalizedPayload = this.normalizeReviewDraftPayload(record, inboundOrderReviewDraftPayloadSchema.parse({
      ...args.draft,
      status: "draft",
    }));
    const enrichedPayload = await this.enrichReviewDraftPricingReview({
      organizationId: args.organizationId,
      parsedDraft: this.parsedDraftFromAttempt(latestAttempt),
      payload: normalizedPayload,
    });
    const payload = this.normalizeReviewDraftPayload(record, enrichedPayload);
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

  /**
   * Coordinates the normal order-creation path from the exact form state sent
   * by the review UI. The public save and ready commands remain available for
   * review handoffs, but callers no longer need to sequence them themselves.
   */
  async createOrderFromReviewDraft(args: CreateInboundOrderFromReviewDraftInput): Promise<ConvertInboundReviewDraftToOrderResult> {
    const current = await this.getDetail({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
    });
    if (!current) throw new InboundOrderTransitionError("Inbound order record not found", 404);

    // Idempotently resolve a repeated submission before attempting to save the
    // now-immutable draft again.
    if (current.record.createdOrderId) {
      return this.convertInboundReviewDraftToOrder(args);
    }

    // A previous manual ready handoff can be reused only when no form values
    // changed. Since this command accepts authoritative current values, reopen
    // it internally before saving so the latest staff edits always win.
    const currentDraftStatus = current.latestReviewSnapshot
      ? this.reviewDraftPayloadFromSnapshot(current.latestReviewSnapshot)?.status
      : null;
    if (current.record.status === reviewedStatus || currentDraftStatus === "ready_to_convert") {
      await this.reopenReviewDraft(args);
    }

    await this.saveReviewDraft(args);
    try {
      await this.markReviewDraftReady(args);
      return await this.convertInboundReviewDraftToOrder(args);
    } catch (error) {
      // Validation failures occur before ready is persisted. If conversion
      // fails after readiness, restore the editable draft so the record does
      // not remain deceptively ready without an order.
      const latest = await this.getDetail({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
      });
      const latestDraftStatus = latest?.latestReviewSnapshot
        ? this.reviewDraftPayloadFromSnapshot(latest.latestReviewSnapshot)?.status
        : null;
      if (!latest?.record.createdOrderId && (latest?.record.status === reviewedStatus || latestDraftStatus === "ready_to_convert")) {
        try {
          await this.reopenReviewDraft(args);
        } catch {
          // Preserve the original conversion error; the conversion service's
          // own failure event remains the audit/recovery source of truth.
        }
      }
      throw error;
    }
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
    const pricedBaseDto = await this.enrichReviewDraftPricingReview({
      organizationId: args.organizationId,
      parsedDraft: this.parsedDraftFromAttempt(latestAttempt),
      payload: baseDto,
    });
    const normalizedPricedBaseDto = this.normalizeReviewDraftPayload(record, pricedBaseDto);
    const errors = await this.validateReviewDraftReadyForMarkReady(args.organizationId, normalizedPricedBaseDto);
    if (errors.length > 0) {
      throw new InboundOrderReviewDraftValidationError("Review draft is not ready to convert.", errors);
    }

    const sourceAttempt = await this.resolveReviewDraftSourceAttempt(args.organizationId, args.inboundRecordId, existingSnapshot, latestAttempt);
    const payload = this.normalizeReviewDraftPayload(record, inboundOrderReviewDraftPayloadSchema.parse({
      status: "ready_to_convert",
      reviewedCustomerJson: normalizedPricedBaseDto.reviewedCustomerJson,
      reviewedOrderJson: normalizedPricedBaseDto.reviewedOrderJson,
      reviewedLineItemsJson: normalizedPricedBaseDto.reviewedLineItemsJson,
      reviewedArtworkJson: normalizedPricedBaseDto.reviewedArtworkJson,
      missingDecisionsJson: normalizedPricedBaseDto.missingDecisionsJson,
      warningsJson: normalizedPricedBaseDto.warningsJson,
      unsupportedRequestsJson: normalizedPricedBaseDto.unsupportedRequestsJson,
      customerIntelligenceJson: normalizedPricedBaseDto.customerIntelligenceJson,
      reviewNotes: normalizedPricedBaseDto.reviewNotes,
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

    const existingSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    const existingPayload = existingSnapshot ? this.reviewDraftPayloadFromSnapshot(existingSnapshot) : null;
    const payload = this.mergeStaffArtworkLinksIntoRefreshedDraft(
      existingPayload,
      await this.buildEditableReviewDraftFromParse({
        organizationId: args.organizationId,
        record,
        draft: parsedDraft,
        files: await this.repository.listFiles(args.organizationId, args.inboundRecordId),
      }),
    );

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

  async searchProducts(args: {
    organizationId: string;
    search?: string | null;
    limit: number;
  }): Promise<InboundProductSearchResult[]> {
    return this.repository.searchActiveProducts(args.organizationId, args.search ?? null, args.limit);
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

  async priceReviewLine(args: {
    organizationId: string;
    lineItem: unknown;
  }): Promise<InboundOrderLinePricingReview> {
    const lineItem = inboundOrderReviewedLineItemSchema.parse(args.lineItem);
    const previous = lineItem.pricingReviewJson ?? null;
    const quantity = lineItem.quantity ?? 1;
    const nextReview: InboundOrderLinePricingReview = {
      status: "not_available",
      message: null,
      acknowledged: false,
      resolution: null,
      resolutionNote: null,
      poPriceCents: previous?.poPriceCents ?? null,
      poUnitPriceCents: previous?.poUnitPriceCents ?? null,
      poExtendedPriceCents: previous?.poExtendedPriceCents ?? null,
      poRushFeesCents: previous?.poRushFeesCents ?? null,
      poTotalPriceCents: previous?.poTotalPriceCents ?? null,
      systemPriceCents: null,
      systemUnitPriceCents: null,
      differenceCents: null,
      comparisonType: null,
      sourceEvidence: previous?.sourceEvidence ?? [],
      alternatePricingNotes: previous?.alternatePricingNotes ?? [],
      evaluatedAt: new Date().toISOString(),
      priceOverrideMode: null,
      priceOverrideValueCents: null,
      priceOverrideSource: null,
      effectiveUnitPriceCents: null,
      effectiveTotalCents: null,
    };

    if (!lineItem.selectedProductId) {
      return preserveInboundPricingResolution(previous, {
        ...nextReview,
        message: "Select a catalog product before calculating price.",
      }, quantity);
    }
    if (!lineItem.quantity || lineItem.quantity <= 0) {
      return preserveInboundPricingResolution(previous, {
        ...nextReview,
        message: "Enter a valid quantity before calculating price.",
      }, quantity);
    }

    try {
      const pricing = await this.priceInboundReviewLine({
        organizationId: args.organizationId,
        productId: lineItem.selectedProductId,
        quantity: lineItem.quantity,
        width: lineItem.width,
        height: lineItem.height,
        optionSelections: lineItem.optionSelectionsJson,
        pbv2TreeVersionId: lineItem.pbv2TreeVersionId,
      });
      const systemPriceCents = Number.isFinite(pricing.lineTotalCents) ? Math.round(pricing.lineTotalCents) : null;
      const systemUnitPriceCents = systemPriceCents != null && quantity > 0 ? Math.round(systemPriceCents / quantity) : null;
      const comparisons = [
        { type: "total" as const, po: previous?.poTotalPriceCents, system: systemPriceCents },
        { type: "extended" as const, po: previous?.poExtendedPriceCents, system: systemPriceCents },
        {
          type: previous?.comparisonType === "unit" ? "unit" as const : "total" as const,
          po: previous?.poPriceCents,
          system: previous?.comparisonType === "unit" ? systemUnitPriceCents : systemPriceCents,
        },
        { type: "unit" as const, po: previous?.poUnitPriceCents, system: systemUnitPriceCents },
      ]
        .filter((comparison): comparison is {
          type: "total" | "extended" | "unit";
          po: number;
          system: number;
        } => comparison.po != null && comparison.system != null)
        .map((comparison) => ({
          ...comparison,
          differenceCents: comparison.system - comparison.po,
        }));
      const selectedComparison = comparisons.find((comparison) => Math.abs(comparison.differenceCents) >= 1) ?? comparisons[0] ?? null;
      return preserveInboundPricingResolution(previous, {
        ...nextReview,
        status: selectedComparison
          ? Math.abs(selectedComparison.differenceCents) >= 1 ? "mismatch" : "matched"
          : "not_available",
        message: selectedComparison && Math.abs(selectedComparison.differenceCents) >= 1
          ? "PO price differs from system price."
          : null,
        poPriceCents: selectedComparison?.po ?? previous?.poPriceCents ?? null,
        systemPriceCents,
        systemUnitPriceCents,
        differenceCents: selectedComparison?.differenceCents ?? null,
        comparisonType: selectedComparison?.type ?? null,
        sourceEvidence: selectedComparison
          ? [
              ...nextReview.sourceEvidence,
              `System ${selectedComparison.type === "unit" ? "unit" : "line"} price: ${formatCents(selectedComparison.system)}`,
            ]
          : nextReview.sourceEvidence,
      }, quantity);
    } catch (error) {
      const failureReason = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Pricing calculation failed.";
      return preserveInboundPricingResolution(previous, {
        ...nextReview,
        message: `System pricing unavailable: ${failureReason} Enter a valid pricing override before conversion.`,
      }, quantity);
    }
  }

  async matchCustomer(args: MatchInboundCustomerReviewInput): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    if (record.createdQuoteId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot have customer/contact matches changed.");
    }

    if (!args.customerId && !args.contactId) {
      throw new InboundOrderTransitionError("Select a customer, a contact, or both.", 400);
    }
    const customer = args.customerId
      ? await this.repository.getCustomer(args.organizationId, args.customerId)
      : null;
    if (args.customerId && !customer) throw new InboundOrderTransitionError("Customer not found for this organization", 404);

    let contactName: string | null = null;
    let contactEmail: string | null = null;
    if (args.contactId) {
      const contact = args.customerId
        ? await this.repository.getContactForCustomer(args.organizationId, args.customerId, args.contactId)
        : await this.repository.getContact(args.organizationId, args.contactId);

      if (!contact) {
        throw new InboundOrderTransitionError(args.customerId ? "Contact does not belong to the selected customer" : "Contact was not found for this organization", args.customerId ? 400 : 404);
      }

      contactName = `${contact.firstName} ${contact.lastName}`.trim();
      contactEmail = contact.email ?? null;
    }

    const updated = await this.repository.matchCustomerWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      customerId: args.customerId ?? null,
      contactId: args.contactId ?? null,
      staffNote: args.staffNote?.trim() || null,
      customerName: customer?.companyName ?? contactName ?? "Contact-only order",
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

  async createCustomerForInbound(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    companyName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    contactFirstName?: string | null;
    contactLastName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    staffNote?: string | null;
  }): Promise<InboundOrderDetail> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) throw new InboundOrderTransitionError("Inbound order record not found", 404);
    if (record.createdQuoteId || record.createdOrderId) {
      throw new InboundOrderTransitionError("Converted inbound records cannot have customer/contact matches changed.");
    }
    const companyName = args.companyName.trim();
    if (!companyName) throw new InboundOrderTransitionError("Company name is required.", 400);
    const existingCustomers = await this.repository.searchCustomers(args.organizationId, companyName, 10);
    const duplicate = existingCustomers.find((customer) => customer.companyName.trim().toLowerCase() === companyName.toLowerCase());
    if (duplicate) {
      throw new InboundOrderTransitionError("A customer with this company name already exists. Select the existing customer instead.", 409);
    }
    const createAndMatch = (this.repository as any).createCustomerWithPrimaryContactAndMatchInbound;
    if (typeof createAndMatch !== "function") {
      throw new InboundOrderTransitionError("Inbound customer creation is not available.", 500);
    }

    const created = await createAndMatch.call(this.repository, {
      ...args,
      companyName,
      customerEmail: args.customerEmail?.trim() || null,
      customerPhone: args.customerPhone?.trim() || null,
      contactFirstName: args.contactFirstName?.trim() || null,
      contactLastName: args.contactLastName?.trim() || null,
      contactEmail: args.contactEmail?.trim() || null,
      contactPhone: args.contactPhone?.trim() || null,
      staffNote: args.staffNote?.trim() || null,
    });
    if (!created) throw new InboundOrderTransitionError("Failed to create and assign inbound customer.", 500);

    const detail = await this.getDetail({ organizationId: args.organizationId, inboundRecordId: args.inboundRecordId });
    if (!detail) throw new InboundOrderTransitionError("Inbound order record not found after customer creation", 404);
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
        orderNumber: existingOrder.orderNumber,
        inboundOrderId: detail.record.id,
        convertedAt: formatInboundDate(detail.record.submittedAt ?? detail.record.updatedAt) ?? new Date().toISOString(),
        order: existingOrder,
        inbound: detail,
        alreadyConverted: true,
      };
    }

    const latestSnapshot = await this.getLatestEditableReviewDraftSnapshot(args.organizationId, args.inboundRecordId);
    const latestParseAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    const rawPayload = latestSnapshot ? this.reviewDraftPayloadFromSnapshot(latestSnapshot) : null;
    const enrichedPayload = rawPayload
      ? await this.enrichReviewDraftPricingReview({
        organizationId: args.organizationId,
        parsedDraft: this.parsedDraftFromAttempt(latestParseAttempt),
        payload: rawPayload,
      })
      : null;
    const payload = enrichedPayload ? this.normalizeReviewDraftPayload(detail.record, enrichedPayload) : null;
    const validationErrors = await this.validateInboundOrderConversion(detail, payload);

    if (validationErrors.length > 0 || !payload || !latestSnapshot) {
      const errors = validationErrors.length > 0 ? validationErrors : ["Reviewed draft is missing."];
      await this.recordConversionValidationFailure(args, errors);
      throw new InboundOrderConversionValidationError("Inbound review draft is not ready for order conversion.", errors);
    }

    try {
      const convertWithRepositories = async (
        conversionRepository: typeof this.repository,
        orderRepository: typeof this.orderRepository,
        tx: any,
      ): Promise<OrderWithRelations | null> => {
        const claimed = await conversionRepository.claimInboundOrderForOrderConversion({
          organizationId: args.organizationId,
          inboundRecordId: args.inboundRecordId,
          actorUserId: args.actorUserId,
        });

        if (!claimed) return null;

        const orderInput = await this.buildOrderCreateInputFromInboundReview({
          detail,
          snapshotId: latestSnapshot.id,
          snapshotVersion: latestSnapshot.snapshotVersion,
          payload,
          actorUserId: args.actorUserId,
        });
        const order = await orderRepository.createOrder(args.organizationId, {
          ...orderInput,
          invoiceAuditSource: "inbound_order",
        });
        if (!order?.id || !order.orderNumber || order.organizationId !== args.organizationId) {
          throw new InboundOrderTransitionError("Draft order creation did not return a valid tenant-scoped order.", 500);
        }

        const staffInternalNote = payload.reviewedOrderJson.internalNotes?.trim() ?? "";
        if (staffInternalNote) {
          await orderRepository.addOrderInternalNote({
            organizationId: args.organizationId,
            orderId: order.id,
            userId: args.actorUserId,
            noteText: staffInternalNote,
          });
        }

        await this.materializeInboundArtworkForOrder({
          organizationId: args.organizationId,
          inboundRecordId: args.inboundRecordId,
          actorUserId: args.actorUserId,
          payload,
          files: detail.files,
          order,
          conversionRepository,
          orderRepository,
          tx,
        });

        const lineItemLinks = (order.lineItems ?? []).map((lineItem: any, index: number) => ({
          inboundLineItemId: stringFromUnknown(getPathValue(lineItem.specsJson, "inbound.sourceLineItemId"))
            ?? payload.reviewedLineItemsJson[index]?.sourceLineItemId
            ?? null,
          orderLineItemId: String(lineItem.id),
        }));

        const convertedInbound = await conversionRepository.markInboundOrderConvertedToOrder({
          organizationId: args.organizationId,
          inboundRecordId: args.inboundRecordId,
          actorUserId: args.actorUserId,
          orderId: order.id,
          orderNumber: order.orderNumber ?? null,
          lineItemLinks,
        });
        if (!convertedInbound || convertedInbound.createdOrderId !== order.id) {
          throw new InboundOrderTransitionError("Draft order was created but the inbound conversion link could not be persisted.", 500);
        }

        await orderRepository.createOrderAuditLog({
          orderId: order.id,
          userId: args.actorUserId,
          userName: null,
          actionType: "order_created_from_inbound",
          fromStatus: null,
          toStatus: "new",
          note: "Order created from inbound draft.",
          metadata: {
            inboundRecordId: args.inboundRecordId,
            inboundDraftId: args.inboundRecordId,
            sourceType: detail.record.sourceType,
            sourceSubject: stringFromUnknown(getPathValue(detail.record.rawPayloadJson, "subject")),
            sourceReference: detail.record.externalReference ?? null,
            resultingOrderId: order.id,
            resultingOrderNumber: order.orderNumber,
          },
        } as any);

        return order;
      };

      const order = typeof (this.repository as any).transaction === "function"
        ? await (this.repository as any).transaction(async (tx: any, conversionRepository: typeof this.repository) => {
          const orderRepository = typeof (this.orderRepository as any).withExecutor === "function"
            ? (this.orderRepository as any).withExecutor(tx)
            : this.orderRepository;
          return convertWithRepositories(conversionRepository, orderRepository, tx);
        })
        : await this.repository.transaction(async (tx: any, conversionRepository: typeof this.repository) => {
          const orderRepository = typeof (this.orderRepository as any).withExecutor === "function"
            ? (this.orderRepository as any).withExecutor(tx)
            : this.orderRepository;
          return convertWithRepositories(conversionRepository, orderRepository, tx);
        });

      if (!order) {
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
            orderNumber: existingOrder.orderNumber,
            inboundOrderId: latest.record.id,
            convertedAt: formatInboundDate(latest.record.submittedAt ?? latest.record.updatedAt) ?? new Date().toISOString(),
            order: existingOrder,
            inbound: latest,
            alreadyConverted: true,
          };
        }
        throw new InboundOrderTransitionError("Inbound record is not ready for order conversion.", 409);
      }

      const inbound = await this.getDetail({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
      });

      if (!inbound) {
        throw new InboundOrderTransitionError("Inbound order record not found after conversion", 404);
      }

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
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
    const reviewedPayload = latestReviewSnapshot ? this.reviewDraftPayloadFromSnapshot(latestReviewSnapshot) : null;
    const artworkStatus = reviewedPayload?.reviewedArtworkJson.status ?? null;
    const artworkWarning = artworkStatus === "missing"
      ? "Artwork is missing and remains required before production."
      : artworkStatus === "to_follow"
        ? "Artwork is to follow and remains required before production."
        : null;

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
      matchedCustomerId: preview.customer.matchedCustomerId ?? null,
      matchedContactId: preview.contact.matchedContactId ?? null,
      customerName: preview.customer.customerName ?? null,
      contactName: preview.contact.contactName ?? null,
      customerMappingSource: preview.customer.source,
      contactMappingSource: preview.contact.source,
      artworkStatus,
      artworkWarning,
    };
    // quote_list_notes is a compact, staff-editable list annotation. The
    // inbound record and review.quote_created event own source evidence and
    // structured conversion metadata respectively.
    const listLabel = "Created from inbound review";

    const pricedLineItems: InboundQuoteDraftLineInput[] = [];
    for (const lineItem of preview.lineItemsToConvert) {
      const rawOptionSelections = getPathValue(lineItem.snapshotJson, "optionSelectionsJson");
      const optionSelections = this.normalizePbv2Selections(
        rawOptionSelections && typeof rawOptionSelections === "object" && !Array.isArray(rawOptionSelections)
          ? rawOptionSelections as Record<string, unknown>
          : null,
      );
      const pbv2TreeVersionId = stringFromUnknown(
        getPathValue(lineItem.snapshotJson, "pbv2TreeVersionId"),
      );
      const pricingReview = asRecord(getPathValue(lineItem.snapshotJson, "pricingReviewJson")) as InboundOrderLinePricingReview | null;
      let pricing: Awaited<ReturnType<typeof priceLineItem>> | null = null;
      let pricingError: unknown = null;
      try {
        pricing = await this.priceInboundReviewLine({
          organizationId: args.organizationId,
          productId: lineItem.productId,
          quantity: lineItem.quantity,
          width: lineItem.width,
          height: lineItem.height,
          optionSelections,
          pbv2TreeVersionId,
        });
      } catch (error) {
        pricingError = error;
      }
      const calculatedLineTotalCents = pricing && Number.isFinite(pricing.lineTotalCents)
        ? Math.max(0, Math.round(pricing.lineTotalCents))
        : 0;
      const effectivePricing = resolveInboundLineEffectivePricing({
        ...(pricingReview ?? {}),
        systemPriceCents: calculatedLineTotalCents,
      }, lineItem.quantity);
      if (effectivePricing.effectiveTotalCents <= 0) {
        throw new InboundOrderTransitionError(
          `${lineItem.productName}: pricing did not return a valid line total and no valid override was supplied.${pricingError instanceof Error ? ` ${pricingError.message}` : ""}`,
        );
      }
      const pbv2SnapshotJson = pricing?.pbv2SnapshotJson ?? {
        pricingSystem: "manual_override",
        selectedOptions: [],
        pricing: { totalCents: calculatedLineTotalCents },
      };
      pricedLineItems.push({
        ...lineItem,
        snapshotJson: {
          ...(asRecord(lineItem.snapshotJson) ?? {}),
          inboundArtwork: {
            status: artworkStatus,
            warning: artworkWarning,
          },
        },
        pricing: {
          lineTotalCents: effectivePricing.effectiveTotalCents,
          calculatedLineTotalCents,
          pbv2TreeVersionId: pricing?.pbv2TreeVersionId ?? pbv2TreeVersionId,
          pbv2SnapshotJson,
          optionSelectionsJson: optionSelections,
          selectedOptions: pbv2SnapshotJson.selectedOptions ?? [],
          breakdown: {
            baseCents: pricing?.breakdown.baseCents ?? calculatedLineTotalCents,
            optionsCents: pricing?.breakdown.optionsCents ?? 0,
            totalCents: effectivePricing.effectiveTotalCents,
            pricingMethod: pricing?.breakdown.pricingMethod ?? "manual_override",
            nestingDetails: pricing?.breakdown.nestingDetails,
          },
          priceOverrideMode: effectivePricing.priceOverrideMode as "override_unit_after_margin" | "override_total_after_margin" | null,
          priceOverrideValueCents: effectivePricing.priceOverrideValueCents,
          priceOverrideSource: pricingReview?.priceOverrideSource ?? null,
        },
      });
    }

    const result = await this.repository.createQuoteDraftFromInboundReview(args.organizationId, {
      inboundRecordId: args.inboundRecordId,
      actorUserId: args.actorUserId,
      customerId: preview.customer.matchedCustomerId ?? null,
      contactId: preview.contact.matchedContactId ?? null,
      customerName: preview.customer.customerName ?? "Inbound customer",
      contactName: preview.contact.contactName,
      contactEmail: preview.contact.email,
      contactPhone: preview.contact.phone,
      label: preview.label ?? `Inbound ${record.id.slice(0, 8)}`,
      listLabel,
      snapshotId: latestReviewSnapshot.id,
      snapshotVersion: latestReviewSnapshot.snapshotVersion,
      lineItems: pricedLineItems,
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

  private reviewQuantitySource(lineItem: InboundOrderParsedDraft["lineItems"][number]): InboundOrderReviewValueSource {
    return lineItem.warnings.some((warning) => (
      warning.code === "quantity_inferred_from_number_word"
      || warning.code === "quantity_inferred_from_structured_phrase"
    ))
      ? "source_evidence"
      : "ai_inferred";
  }

  private async buildEditableReviewDraftFromParse(args: {
    organizationId: string;
    record: InboundOrderRecord;
    draft: InboundOrderParsedDraft;
    files: InboundOrderFile[];
  }): Promise<InboundOrderReviewDraftPayload> {
    const { draft } = args;
    const warnings = [
      ...draft.globalWarnings,
      ...draft.customer.warnings,
      ...draft.order.warnings,
      ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
      ...draft.artwork.flatMap((artwork) => artwork.warnings),
    ];
    const hasReconciledArtwork = draft.evidence.reconciliation?.artworkStatus.value === "supplied";
    const hasArtwork = hasReconciledArtwork || draft.artwork.length > 0 || draft.lineItems.some((lineItem) => lineItem.artworkRefs.length > 0);
    const reconciledRush = draft.evidence.reconciliation?.rushStatus.value === "rush";
    const customerInterpretation = await this.interpretCustomerAndContact(args.organizationId, draft);
    const customerIntelligence = await this.resolveCustomerIntelligence({
      organizationId: args.organizationId,
      draft,
      customerId: customerInterpretation.customerId,
    });
    if (customerIntelligence.warning && !warnings.some((item) => item.code === customerIntelligence.warning?.code)) {
      warnings.push(customerIntelligence.warning);
    }
    const customerIntelligenceJson = customerIntelligence.summary;
    const reviewedLineItemsJson: InboundOrderReviewDraftPayload["reviewedLineItemsJson"] = [];
    const unsupportedRequestsJson: InboundUnsupportedRequestFinding[] = [];
    for (const lineItem of draft.lineItems) {
      const productInterpretation = await this.interpretLineItemProduct(args.organizationId, lineItem);
      const selectedProductId = productInterpretation?.productId ?? null;
      let optionSelectionsJson: LineItemOptionSelectionsV2 | null = null;
      let pbv2TreeVersionId: string | null = null;
      let pbv2OptionSuggestions: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]["pbv2OptionSuggestions"] = [];

      if (selectedProductId) {
        const productOptions = await this.repository.getProductActivePbv2Tree(args.organizationId, selectedProductId);
        const treeJson = (productOptions?.activeTree?.treeJson ?? null) as OptionTreeV2 | null;
        const optionEvidenceText = this.lineItemOptionEvidenceText({
          sourceLineItemId: null,
          sourceText: lineItem.sourceText,
          productName: lineItem.productName,
          selectedProductId,
          selectedProductSource: productInterpretation ? "ai_inferred" : null,
          interpretedProductId: productInterpretation?.productId ?? null,
          interpretedProductReason: productInterpretation?.reason ?? null,
          interpretedProductConfidence: productInterpretation?.confidence ?? null,
          productUnresolved: false,
          quantity: lineItem.quantity,
          quantitySource: lineItem.quantity ? this.reviewQuantitySource(lineItem) : null,
          width: lineItem.width,
          height: lineItem.height,
          dimensionsUnit: lineItem.dimensionsUnit,
          dimensionsSource: lineItem.width || lineItem.height || lineItem.dimensionsUnit ? "ai_inferred" : null,
          materialText: lineItem.materialText,
          materialSource: lineItem.materialText ? "ai_inferred" : null,
          printSpecs: lineItem.optionTexts,
          printSpecsSource: lineItem.optionTexts.length > 0 ? "ai_inferred" : null,
          optionTexts: lineItem.optionTexts,
          optionTextsSource: lineItem.optionTexts.length > 0 ? "ai_inferred" : null,
          finishingTexts: lineItem.finishingTexts,
          finishingTextsSource: lineItem.finishingTexts.length > 0 ? "ai_inferred" : null,
          optionSelectionsJson: null,
          pbv2TreeVersionId: null,
          pbv2OptionSuggestions: [],
          pricingReviewJson: null,
          artworkLinks: [],
          artworkQuantityMode: "same_quantity_each",
          notes: null,
        });
        if (treeJson) {
          const hydrated = hydrateInboundPbv2Selections(treeJson, optionEvidenceText);
          optionSelectionsJson = Object.keys(hydrated.selections.selected).length > 0 ? hydrated.selections : null;
          pbv2TreeVersionId = productOptions?.activeTree?.id ?? productOptions?.product.pbv2ActiveTreeVersionId ?? null;
          pbv2OptionSuggestions = hydrated.suggestions;
        }
        unsupportedRequestsJson.push(...detectUnsupportedInboundRequests(
          treeJson,
          optionEvidenceText,
          productInterpretation?.label ?? productOptions?.product.name ?? lineItem.productName ?? selectedProductId,
        ));
      }

      reviewedLineItemsJson.push({
        sourceLineItemId: null,
        sourceText: lineItem.sourceText,
        productName: productInterpretation?.label ?? lineItem.productName,
        selectedProductId,
        selectedProductSource: productInterpretation ? "ai_inferred" : null,
        interpretedProductId: productInterpretation?.productId ?? null,
        interpretedProductReason: productInterpretation?.reason ?? null,
        interpretedProductConfidence: productInterpretation?.confidence ?? null,
        productUnresolved: !selectedProductId,
        quantity: lineItem.quantity,
        quantitySource: lineItem.quantity ? this.reviewQuantitySource(lineItem) : null,
        width: lineItem.width,
        height: lineItem.height,
        dimensionsUnit: lineItem.dimensionsUnit,
        dimensionsSource: lineItem.width || lineItem.height || lineItem.dimensionsUnit ? "ai_inferred" : null,
        materialText: lineItem.materialText,
        materialSource: lineItem.materialText ? "ai_inferred" : null,
        printSpecs: lineItem.optionTexts,
        printSpecsSource: lineItem.optionTexts.length > 0 ? "ai_inferred" : null,
        optionTexts: lineItem.optionTexts,
        optionTextsSource: lineItem.optionTexts.length > 0 ? "ai_inferred" : null,
        finishingTexts: lineItem.finishingTexts,
        finishingTextsSource: lineItem.finishingTexts.length > 0 ? "ai_inferred" : null,
        optionSelectionsJson,
        pbv2TreeVersionId,
        pbv2OptionSuggestions,
        pricingReviewJson: null,
        artworkLinks: [],
        artworkQuantityMode: "same_quantity_each",
        notes: null,
      });
    }
    const artworkLinkSuggestions = this.suggestArtworkLinksForReviewDraft({
      draft,
      files: args.files,
      reviewedLineItemsJson,
    });

    const payload = inboundOrderReviewDraftPayloadSchema.parse({
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
        unresolvedCustomer: !customerInterpretation.customerId,
        unresolvedContact: !customerInterpretation.contactId,
        notes: null,
      },
      reviewedOrderJson: {
        poNumber: draft.order.poNumber,
        dueDate: normalizeInboundReviewedDueDate(draft.order.requestedDueDate, args.record.receivedAt),
        priority: reconciledRush ? "rush" : "normal",
        shipMethod: draft.order.requestedShipMethod,
        fulfillmentType: draft.order.requestedPickup === true ? "pickup" : "unknown",
        internalNotes: draft.order.notes,
        customerNotes: null,
      },
      reviewedLineItemsJson: artworkLinkSuggestions.reviewedLineItemsJson,
      reviewedArtworkJson: {
        status: hasArtwork ? "supplied" : "missing",
        refs: draft.artwork.map((artwork) => ({
          filename: artwork.filename,
          sourceReference: artwork.sourceReference,
          likelyLineItemIndex: artwork.likelyLineItemIndex,
          purpose: artwork.purpose,
        })),
        unassignedAttachments: artworkLinkSuggestions.unassignedAttachments,
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
      unsupportedRequestsJson,
      customerIntelligenceJson,
      reviewNotes: null,
    });
    return this.enrichReviewDraftPricingReview({
      organizationId: args.organizationId,
      parsedDraft: draft,
      payload,
    });
  }

  private suggestArtworkLinksForReviewDraft(args: {
    draft: InboundOrderParsedDraft;
    files: InboundOrderFile[];
    reviewedLineItemsJson: InboundOrderReviewDraftPayload["reviewedLineItemsJson"];
  }): {
    reviewedLineItemsJson: InboundOrderReviewDraftPayload["reviewedLineItemsJson"];
    unassignedAttachments: InboundOrderArtworkLink[];
  } {
    const reviewedLineItemsJson = args.reviewedLineItemsJson.map((lineItem) => ({
      ...lineItem,
      artworkLinks: [...lineItem.artworkLinks],
    }));
    const unassignedAttachments: InboundOrderArtworkLink[] = [];

    for (const file of args.files) {
      const baseLink = this.artworkLinkFromInboundFile(file, "unresolved", null, "Stored inbound attachment awaiting staff assignment.");
      if (baseLink.classification !== "ARTWORK") {
        unassignedAttachments.push({
          ...baseLink,
          confidence: baseLink.classificationConfidence ?? null,
          reason: baseLink.classificationReasons.length > 0
            ? baseLink.classificationReasons.join("; ")
            : "Attachment is not classified as artwork; staff review is required.",
        });
        continue;
      }
      const scores = reviewedLineItemsJson.map((lineItem, index) => ({
        index,
        score: this.scoreArtworkFileForLineItem(file, args.draft, lineItem, index),
      }));
      const ranked = scores.sort((a, b) => b.score.score - a.score.score);
      const top = ranked[0] ?? null;
      const runnerUp = ranked[1] ?? null;
      const confident = Boolean(top && top.score.score >= 70 && (!runnerUp || top.score.score - runnerUp.score.score >= 12));

      if (confident && top) {
        reviewedLineItemsJson[top.index].artworkLinks.push({
          ...baseLink,
          source: "ai_suggested",
          confidence: Math.min(100, Math.round(top.score.score)),
          reason: top.score.reason,
        });
        continue;
      }

      unassignedAttachments.push({
        ...baseLink,
        confidence: top ? Math.min(100, Math.round(top.score.score)) : null,
        reason: top?.score.reason ?? "No reliable line-item match was detected.",
      });
    }

    return { reviewedLineItemsJson, unassignedAttachments };
  }

  private artworkLinkFromInboundFile(
    file: InboundOrderFile,
    source: InboundOrderArtworkLink["source"],
    confidence: number | null,
    reason: string | null,
  ): InboundOrderArtworkLink {
    const classification = attachmentClassificationFromInboundFile(file);
    const role = inboundAttachmentClassificationToRole(classification.classification);
    return {
      fileId: file.id,
      fileRecordId: file.fileRecordId ?? null,
      filename: file.sourceFilename ?? null,
      mimeType: file.mimeType ?? null,
      sizeBytes: file.sizeBytes ?? null,
      role,
      assignmentSide: "unassigned",
      productionQuantity: role === "artwork" ? defaultNewProductionArtworkAllocation("artwork") : null,
      productionGroupId: null,
      source,
      confidence,
      reason,
      classification: classification.classification,
      classificationConfidence: classification.confidence,
      classificationReasons: classification.reasons,
      classificationSource: classification.source,
      automaticClassification: classification.classification,
      automaticClassificationConfidence: classification.confidence,
      automaticClassificationReasons: classification.reasons,
      classificationBreakdown: classification.breakdown,
      manualOverride: classification.source === "manual_override",
    };
  }

  private scoreArtworkFileForLineItem(
    file: InboundOrderFile,
    draft: InboundOrderParsedDraft,
    lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number],
    lineItemIndex: number,
  ): { score: number; reason: string } {
    const filename = file.sourceFilename ?? "";
    const normalizedFilename = normalizeArtworkMatchText(filename);
    const compactFilename = compactArtworkMatchText(filename);
    const parsedLineItem = draft.lineItems[lineItemIndex];
    const parsedArtworkReferences = draft.artwork.filter((artwork) => artwork.likelyLineItemIndex === lineItemIndex);
    const lineEvidence = [
      lineItem.sourceText,
      lineItem.productName,
      lineItem.materialText,
      ...lineItem.optionTexts,
      ...lineItem.finishingTexts,
      ...(parsedLineItem?.artworkRefs ?? []),
      ...parsedArtworkReferences.flatMap((artwork) => [artwork.filename, artwork.sourceReference]),
    ].filter(Boolean).join(" ");
    const normalizedEvidence = normalizeArtworkMatchText(lineEvidence);
    const compactEvidence = compactArtworkMatchText(lineEvidence);
    const reasons: string[] = [];
    let score = file.role === "po" || file.role === "source_payload" ? 5 : 25;

    for (const artwork of parsedArtworkReferences) {
      const artworkName = artwork.filename ?? artwork.sourceReference ?? "";
      const compactArtworkName = compactArtworkMatchText(artworkName);
      if (compactArtworkName && (compactFilename.includes(compactArtworkName) || compactArtworkName.includes(compactFilename))) {
        score += 45;
        reasons.push("filename matches parsed artwork reference");
        break;
      }
    }

    if (lineItem.width && lineItem.height) {
      const width = normalizeDimensionToken(lineItem.width);
      const height = normalizeDimensionToken(lineItem.height);
      if (width && height && compactFilename.includes(width) && compactFilename.includes(height)) {
        score += 30;
        reasons.push("filename includes line-item dimensions");
      }
    }

    const productTokens = artworkMatchTokens([lineItem.productName, lineItem.materialText].filter(Boolean).join(" "));
    const matchedProductTokens = productTokens.filter((token) => normalizedFilename.includes(token));
    if (matchedProductTokens.length > 0) {
      score += Math.min(30, matchedProductTokens.length * 20);
      reasons.push("filename matches product or material text");
    }

    if (lineItem.quantity && normalizedFilename.includes(String(lineItem.quantity))) {
      score += 5;
      reasons.push("filename includes quantity");
    }

    const sourceTokens = artworkMatchTokens(normalizedEvidence);
    const sharedSourceTokens = sourceTokens.filter((token) => normalizedFilename.includes(token));
    if (sharedSourceTokens.length > 0) {
      score += Math.min(15, sharedSourceTokens.length * 3);
      reasons.push("filename shares parsed source text clues");
    }

    if (compactEvidence && compactFilename && compactEvidence.includes(compactFilename)) {
      score += 20;
      reasons.push("email or PO evidence references filename");
    }

    return {
      score,
      reason: reasons.length > 0 ? reasons.join("; ") : "No strong filename, evidence, product, size, or quantity clue matched this line item.",
    };
  }

  private mergeStaffArtworkLinksIntoRefreshedDraft(
    existingPayload: InboundOrderReviewDraftPayload | null,
    refreshedPayload: InboundOrderReviewDraftPayload,
  ): InboundOrderReviewDraftPayload {
    if (!existingPayload) return refreshedPayload;
    const reviewedLineItemsJson = refreshedPayload.reviewedLineItemsJson.map((lineItem, index) => {
      const existingLineItem = existingPayload.reviewedLineItemsJson[index];
      if (!existingLineItem) return lineItem;
      const quantityWasStaffSelected = existingLineItem.quantitySource === "staff_selected";
      const staffLinks = existingLineItem.artworkLinks.filter((link) => (
        link.source === "staff_selected" || link.source === "staff_removed"
      ));
      const refreshedQuantity = quantityWasStaffSelected ? existingLineItem.quantity : lineItem.quantity;
      const pricingReviewJson = existingLineItem.pricingReviewJson?.acknowledged || existingLineItem.pricingReviewJson?.priceOverrideMode
        ? preserveInboundPricingResolution(existingLineItem.pricingReviewJson, lineItem.pricingReviewJson ?? {
          status: "not_available",
          message: null,
          acknowledged: false,
          resolution: null,
          resolutionNote: null,
          poPriceCents: null,
          poUnitPriceCents: null,
          poExtendedPriceCents: null,
          poRushFeesCents: null,
          poTotalPriceCents: null,
          systemPriceCents: null,
          systemUnitPriceCents: null,
          differenceCents: null,
          comparisonType: null,
          sourceEvidence: [],
          alternatePricingNotes: [],
          evaluatedAt: null,
          priceOverrideMode: null,
          priceOverrideValueCents: null,
          priceOverrideSource: null,
          effectiveUnitPriceCents: null,
          effectiveTotalCents: null,
        }, refreshedQuantity ?? 1)
        : lineItem.pricingReviewJson;
      const refreshedLineItem = {
        ...lineItem,
        quantity: refreshedQuantity,
        quantitySource: quantityWasStaffSelected ? existingLineItem.quantitySource : lineItem.quantitySource,
        pricingReviewJson,
      };
      if (staffLinks.length === 0) return refreshedLineItem;
      const staffKeys = new Set(staffLinks.map((link) => artworkLinkKey(link)));
      const retainedLinks = lineItem.artworkLinks.filter((link) => !staffKeys.has(artworkLinkKey(link)));
      return {
        ...refreshedLineItem,
        artworkLinks: [...retainedLinks, ...staffLinks],
      };
    });
    const staffSelectedKeys = new Set(
      reviewedLineItemsJson
        .flatMap((lineItem) => lineItem.artworkLinks)
        .filter((link) => link.source === "staff_selected")
        .map((link) => artworkLinkKey(link)),
    );
    const manualUnassignedByKey = new Map(existingPayload.reviewedArtworkJson.unassignedAttachments
      .filter((link) => link.manualOverride || link.classificationSource === "manual_override")
      .map((link) => [artworkLinkKey(link), link]));
    const refreshedUnassigned = refreshedPayload.reviewedArtworkJson.unassignedAttachments
      .filter((link) => !staffSelectedKeys.has(artworkLinkKey(link)))
      .map((link) => manualUnassignedByKey.get(artworkLinkKey(link)) ?? link);
    const refreshedUnassignedKeys = new Set(refreshedUnassigned.map((link) => artworkLinkKey(link)));
    return inboundOrderReviewDraftPayloadSchema.parse({
      ...refreshedPayload,
      reviewedLineItemsJson,
      reviewedArtworkJson: {
        ...refreshedPayload.reviewedArtworkJson,
        unassignedAttachments: [
          ...refreshedUnassigned,
          ...Array.from(manualUnassignedByKey.values()).filter((link) => !refreshedUnassignedKeys.has(artworkLinkKey(link))),
        ],
      },
    });
  }

  private async enrichReviewDraftPricingReview(args: {
    organizationId: string;
    parsedDraft: InboundOrderParsedDraft | null;
    payload: InboundOrderReviewDraftPayload;
  }): Promise<InboundOrderReviewDraftPayload> {
    const reviewedLineItemsJson: InboundOrderReviewDraftPayload["reviewedLineItemsJson"] = [];
    for (let index = 0; index < args.payload.reviewedLineItemsJson.length; index += 1) {
      const lineItem = args.payload.reviewedLineItemsJson[index];
      const poPricing = firstPoPricingForLine(args.parsedDraft, index);
      const quantity = lineItem.quantity ?? 1;
      let nextReview: InboundOrderLinePricingReview = {
        status: "not_available",
        message: null,
        acknowledged: false,
        resolution: null,
        resolutionNote: null,
        poPriceCents: null,
        poUnitPriceCents: poPricing?.pricing.unitPriceCents ?? null,
        poExtendedPriceCents: poPricing?.pricing.extendedPriceCents ?? null,
        poRushFeesCents: poPricing?.pricing.rushFeesCents ?? null,
        poTotalPriceCents: poPricing?.pricing.totalPriceCents ?? null,
        systemPriceCents: null,
        systemUnitPriceCents: null,
        differenceCents: null,
        comparisonType: null,
        sourceEvidence: poPricing?.sourceEvidence ?? [],
        alternatePricingNotes: poPricing?.pricing.alternatePricingNotes ?? [],
        evaluatedAt: new Date().toISOString(),
        priceOverrideMode: null,
        priceOverrideValueCents: null,
        priceOverrideSource: null,
        effectiveUnitPriceCents: null,
        effectiveTotalCents: null,
      };

      if (lineItem.selectedProductId && lineItem.quantity) {
        try {
          const pricing = await this.priceInboundReviewLine({
            organizationId: args.organizationId,
            productId: lineItem.selectedProductId,
            quantity: lineItem.quantity,
            width: lineItem.width,
            height: lineItem.height,
            optionSelections: lineItem.optionSelectionsJson,
            pbv2TreeVersionId: lineItem.pbv2TreeVersionId,
          });
          const systemPriceCents = Number.isFinite(pricing.lineTotalCents) ? Math.round(pricing.lineTotalCents) : null;
          const systemUnitPriceCents = systemPriceCents != null && quantity > 0 ? Math.round(systemPriceCents / quantity) : null;
          nextReview = {
            ...nextReview,
            systemPriceCents,
            systemUnitPriceCents,
          };
          const comparisons = [
            { type: "total" as const, po: poPricing?.pricing.totalPriceCents, system: systemPriceCents },
            { type: "extended" as const, po: poPricing?.pricing.extendedPriceCents, system: systemPriceCents },
            { type: "approved" as const, po: poPricing?.pricing.approvedPriceCents, system: systemPriceCents },
            { type: "unit" as const, po: poPricing?.pricing.unitPriceCents, system: systemUnitPriceCents },
          ]
            .filter((comparison): comparison is {
              type: "total" | "extended" | "approved" | "unit";
              po: number;
              system: number;
            } => comparison.po != null && comparison.system != null)
            .map((comparison) => ({
              ...comparison,
              differenceCents: comparison.system - comparison.po,
            }));
          const selectedComparison = comparisons.find((comparison) => Math.abs(comparison.differenceCents) >= 1) ?? comparisons[0] ?? null;
          if (selectedComparison) {
            const mismatch = Math.abs(selectedComparison.differenceCents) >= 1;
            nextReview = {
              ...nextReview,
              status: mismatch ? "mismatch" : "matched",
              message: mismatch ? "PO price differs from system price." : null,
              poPriceCents: selectedComparison.po,
              systemPriceCents,
              systemUnitPriceCents,
              differenceCents: selectedComparison.differenceCents,
              comparisonType: selectedComparison.type,
              sourceEvidence: [
                ...nextReview.sourceEvidence,
                `System ${selectedComparison.type === "unit" ? "unit" : "line"} price: ${formatCents(selectedComparison.system)}`,
              ],
            };
          }
        } catch (error) {
          const failureReason = error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "Pricing calculation failed.";
          nextReview = {
            ...nextReview,
            message: poPricing
              ? `System pricing unavailable for PO price comparison: ${failureReason}`
              : `System pricing unavailable: ${failureReason} Enter a valid pricing override before conversion.`,
          };
        }
      }

      reviewedLineItemsJson.push({
        ...lineItem,
        pricingReviewJson: preserveInboundPricingResolution(lineItem.pricingReviewJson, nextReview, quantity),
      });
    }

    return inboundOrderReviewDraftPayloadSchema.parse({
      ...args.payload,
      reviewedLineItemsJson,
    });
  }

  private normalizeReviewDraftPayload(
    record: InboundOrderRecord,
    payload: InboundOrderReviewDraftPayload,
  ): InboundOrderReviewDraftPayload {
    const artworkAssigned = hasAssignedClassifiedArtwork(payload);
    const missingDecisionsJson = payload.missingDecisionsJson.map((decision) => {
      if (decision.status !== "still_blocking") return decision;
      if (decisionReferencesRemovedLine(payload, decision)) {
        return {
          ...decision,
          status: "resolved" as const,
          resolutionNote: "Obsolete: reviewed line item was removed.",
        };
      }
      if (isArtworkDecision(decision) && artworkDecisionIsResolvedByAssignment(payload, decision)) {
        return {
          ...decision,
          status: "resolved" as const,
          resolutionNote: decision.resolutionNote ?? "Resolved by artwork assigned to a reviewed line item.",
        };
      }
      if (isQuantityDecision(decision) && quantityDecisionIsResolvedByLineItem(payload, decision)) {
        return {
          ...decision,
          status: "resolved" as const,
          resolutionNote: decision.resolutionNote ?? "Resolved by staff-confirmed line item quantity.",
        };
      }
      if (isDimensionsDecision(decision) && dimensionsDecisionIsResolvedByLineItem(payload, decision)) {
        return {
          ...decision,
          status: "resolved" as const,
          resolutionNote: decision.resolutionNote ?? "Resolved by staff-confirmed line item size.",
        };
      }
      return decision;
    });
    return inboundOrderReviewDraftPayloadSchema.parse({
      ...payload,
      reviewedOrderJson: {
        ...payload.reviewedOrderJson,
        dueDate: normalizeInboundReviewedDueDate(payload.reviewedOrderJson.dueDate, record.receivedAt),
      },
      reviewedArtworkJson: artworkAssigned
        ? { ...payload.reviewedArtworkJson, status: "supplied" }
        : payload.reviewedArtworkJson,
      missingDecisionsJson,
      warningsJson: artworkAssigned
        ? payload.warningsJson.filter((warning) => !isStaleMissingArtworkWarning(payload, warning))
        : payload.warningsJson,
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
    const customerIntelligence = await this.resolveCustomerIntelligence({
      organizationId: args.organizationId,
      draft: parsedDraft,
      customerId: customer.selectedCustomerId ?? interpreted.customerId,
      existingSummary: payload.customerIntelligenceJson,
    });
    const customerIntelligenceJson = customerIntelligence.summary;
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

    const hasNewCustomerIntelligence = !payload.customerIntelligenceJson && Boolean(customerIntelligenceJson);
    if (!changed && !hasNewCustomerIntelligence) return args.snapshot;

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
        customerIntelligenceJson,
        warningsJson: customerIntelligence.warning
          && !payload.warningsJson.some((item) => item.code === customerIntelligence.warning?.code)
          ? [...payload.warningsJson, { ...customerIntelligence.warning, acknowledged: false, acknowledgementNote: null }]
          : payload.warningsJson,
      },
      status: payload.status,
      eventType: "review_draft.interpreted_customer_contact_backfilled",
      message: "Interpreted customer/contact selections backfilled into editable review draft.",
      initializedFromParse: false,
    });
  }

  private async resolveCustomerIntelligence(args: {
    organizationId: string;
    draft: InboundOrderParsedDraft;
    customerId: string | null;
    existingSummary?: InboundCustomerIntelligenceSummary | null;
  }): Promise<{
    summary: InboundCustomerIntelligenceSummary | null;
    warning: InboundOrderParsedDraft["globalWarnings"][number] | null;
  }> {
    try {
      const candidate = args.existingSummary
        ?? args.draft.customerIntelligence
        ?? (args.customerId
          ? await this.customerIntelligence.buildSummary({
            organizationId: args.organizationId,
            customerId: args.customerId,
          })
          : null);
      if (!candidate) return { summary: null, warning: null };

      const validated = inboundCustomerIntelligenceSummarySchema.safeParse(candidate);
      if (validated.success) return { summary: validated.data, warning: null };

      console.warn("[INBOUND_ORDER_REVIEW_DRAFT] Customer intelligence summary was invalid; omitting advisory context.", {
        organizationId: args.organizationId,
        issueCount: validated.error.issues.length,
      });
    } catch (error) {
      console.warn("[INBOUND_ORDER_REVIEW_DRAFT] Customer intelligence was unavailable; continuing without advisory context.", {
        organizationId: args.organizationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }

    return {
      summary: null,
      warning: {
        code: "customer_intelligence_unavailable",
        message: "Customer history suggestions were partially unavailable.",
        severity: "info",
        fieldPath: null,
      },
    };
  }

  private async interpretCustomerAndContact(
    organizationId: string,
    draft: InboundOrderParsedDraft,
  ): Promise<{
    customerId: string | null;
    customerSource: "ai_inferred" | "crm_match" | null;
    customerReason: string | null;
    customerConfidence: number | null;
    contactId: string | null;
    contactSource: "ai_inferred" | "crm_match" | null;
    contactReason: string | null;
    contactConfidence: number | null;
  }> {
    const customerCandidates = new Map<string, { id: string; confidence: number; reason: string; source: "ai_inferred" | "crm_match" }>();
    for (const candidate of draft.customer.customerCandidates) {
      customerCandidates.set(candidate.id, {
        id: candidate.id,
        confidence: candidate.confidence,
        reason: candidate.reason || "Matched parsed customer candidate.",
        source: "ai_inferred",
      });
    }

    const addCustomerSearchResults = (results: InboundCustomerSearchResult[], confidence: number, reason: string) => {
      for (const result of results) {
        const existing = customerCandidates.get(result.id);
        if (!existing) {
          customerCandidates.set(result.id, { id: result.id, confidence, reason, source: "crm_match" });
        } else {
          customerCandidates.set(result.id, {
            id: result.id,
            confidence: Math.max(existing.confidence, confidence),
            reason: existing.reason.includes(reason) ? existing.reason : `${existing.reason} ${reason}`,
            source: existing.source === "ai_inferred" && existing.confidence >= confidence ? existing.source : "crm_match",
          });
        }
      }
    };

    const sourceEmail = draft.customer.sourceEmail?.trim() || null;
    const companyName = draft.customer.companyName?.trim() || null;
    const sourceName = draft.customer.sourceName?.trim() || null;
    const emailDomain = sourceEmail?.split("@")[1]?.trim() || null;
    if (sourceEmail) {
      addCustomerSearchResults(
        await this.repository.searchCustomers(organizationId, sourceEmail, 5),
        94,
        "Matched by sender email.",
      );
      if (emailDomain) {
        addCustomerSearchResults(
          await this.repository.searchCustomers(organizationId, emailDomain, 5),
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
    if (sourceName && sourceName !== companyName) {
      const matches = await this.repository.searchCustomers(organizationId, sourceName, 5);
      addCustomerSearchResults(
        matches,
        matches.length === 1 ? 88 : 80,
        "Matched by sender name.",
      );
    }

    const contactCandidates = new Map<string, { id: string; customerId: string | null; confidence: number; reason: string; source: "ai_inferred" | "crm_match" }>();
    for (const candidate of draft.customer.contactCandidates) {
      contactCandidates.set(candidate.id, {
        id: candidate.id,
        customerId: null,
        confidence: candidate.confidence,
        reason: candidate.reason || "Matched parsed contact candidate.",
        source: "ai_inferred",
      });
    }
    const addContactSearchResults = (results: InboundContactSearchResult[], confidence: number, reason: string) => {
      for (const result of results) {
        const existing = contactCandidates.get(result.id);
        if (!existing) {
          contactCandidates.set(result.id, { id: result.id, customerId: result.customerId, confidence, reason, source: "crm_match" });
        } else {
          contactCandidates.set(result.id, {
            id: result.id,
            customerId: existing.customerId ?? result.customerId,
            confidence: Math.max(existing.confidence, confidence),
            reason: existing.reason.includes(reason) ? existing.reason : `${existing.reason} ${reason}`,
            source: existing.source === "ai_inferred" && existing.confidence >= confidence ? existing.source : "crm_match",
          });
        }
      }
    };

    if (sourceEmail) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, null, sourceEmail, 5),
        100,
        "Matched by contact email.",
      );
    }
    if (sourceName) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, null, sourceName, 5),
        88,
        "Matched by sender name.",
      );
    }
    if (emailDomain) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, null, emailDomain, 5),
        84,
        "Matched by contact email domain.",
      );
    }

    const selectedContactBeforeCustomer = this.pickSingleStrongMatch(Array.from(contactCandidates.values()), 88);
    if (selectedContactBeforeCustomer?.customerId && !customerCandidates.has(selectedContactBeforeCustomer.customerId)) {
      customerCandidates.set(selectedContactBeforeCustomer.customerId, {
        id: selectedContactBeforeCustomer.customerId,
        confidence: Math.max(90, selectedContactBeforeCustomer.confidence - 4),
        reason: "Matched through sender contact CRM link.",
        source: "crm_match",
      });
    }

    const selectedCustomer = this.pickSingleStrongMatch(Array.from(customerCandidates.values()), 88);
    const selectedCustomerId = selectedCustomer?.id ?? null;

    if (selectedCustomerId && sourceEmail) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, sourceEmail, 5),
        100,
        "Matched by email.",
      );
    }
    if (selectedCustomerId && sourceName) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, sourceName, 5),
        86,
        "Matched by contact name.",
      );
    }
    if (selectedCustomerId && emailDomain) {
      addContactSearchResults(
        await this.repository.searchCustomerContacts(organizationId, selectedCustomerId, emailDomain, 5),
        80,
        "Matched by customer contact domain.",
      );
    }

    const selectedContact = selectedCustomerId
      ? this.pickSingleStrongMatch(
        Array.from(contactCandidates.values()).filter((candidate) => !candidate.customerId || candidate.customerId === selectedCustomerId),
        80,
      )
      : selectedContactBeforeCustomer;

    return {
      customerId: selectedCustomerId,
      customerSource: selectedCustomer ? selectedCustomer.source : null,
      customerReason: selectedCustomer ? selectedCustomer.reason : null,
      customerConfidence: selectedCustomer ? selectedCustomer.confidence : null,
      contactId: selectedContact?.id ?? null,
      contactSource: selectedContact ? selectedContact.source : null,
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
      { token: "Foam Board", positive: /\b(foam\s*core|foamcore|foam\s*board|foam\s+signs?)\b/, conflicts: /\b(pvc|coroplast|acm|dibond|max\s*metal|aluminum|magnet|magnetic)\b/ },
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
    const snapshotPayload = this.reviewDraftPayloadFromSnapshot(snapshot);
    if (!snapshotPayload) {
      throw new InboundOrderTransitionError("Editable review draft snapshot is invalid.", 500);
    }
    // Parse-time decisions remain auditable in the snapshot, but readiness is
    // derived from the current reviewed line-item values.
    const payload = this.normalizeReviewDraftPayload(record, snapshotPayload);
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
    const normalizedPayload = payload ? this.normalizeReviewDraftPayload(record, payload) : null;

    if (record.createdOrderId) return errors;
    if (record.createdQuoteId) errors.push("Inbound record has already been converted to a quote draft.");
    if (record.status !== reviewedStatus) errors.push("Inbound record must be ready before order conversion.");
    if (!normalizedPayload) {
      errors.push("Reviewed draft is missing.");
      return Array.from(new Set(errors));
    }
    if (normalizedPayload.status !== "ready_to_convert") {
      errors.push("Reviewed draft must be marked ready to convert.");
    }

    const selectedCustomerId = normalizedPayload.reviewedCustomerJson.selectedCustomerId;
    const selectedContactId = normalizedPayload.reviewedCustomerJson.selectedContactId;
    if (!selectedCustomerId && !selectedContactId) {
      errors.push("Select an existing customer, a contact, or both before creating a draft order.");
    } else if (selectedCustomerId) {
      const customer = await this.repository.getCustomer(record.organizationId, selectedCustomerId);
      if (!customer) errors.push("Selected customer was not found for this organization.");
    }

    if (selectedCustomerId && selectedContactId) {
      const contact = await this.repository.getContactForCustomer(record.organizationId, selectedCustomerId, selectedContactId);
      if (!contact) errors.push("Selected contact does not belong to the selected customer.");
    } else if (selectedContactId) {
      const contact = await this.repository.getContact(record.organizationId, selectedContactId);
      if (!contact) errors.push("Selected contact was not found for this organization.");
    }

    if (normalizedPayload.reviewedLineItemsJson.length === 0) {
      errors.push("At least one reviewed line item is required.");
    }

    const artworkBypassed = hasArtworkBypassForOrder(normalizedPayload);
    const artworkRequired = artworkIsRequiredForOrder(normalizedPayload);
    if (artworkRequired && !artworkBypassed) {
      errors.push("Artwork is missing. Assign artwork or select Bypass artwork before creating a draft order.");
    }

    for (let index = 0; index < normalizedPayload.reviewedLineItemsJson.length; index += 1) {
      const lineItem = normalizedPayload.reviewedLineItemsJson[index];
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
      if (this.lineItemRequiresDimensions(lineItem) && !hasValidLineItemDimensions(lineItem)) {
        errors.push(`${label}: width and height are required for this product type.`);
      }
      if (lineItem.pricingReviewJson?.status === "mismatch" && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution)) {
        errors.push(`${label}: PO price differs from system price. Acknowledge or resolve pricing before conversion.`);
      }
      if (!hasUsableInboundLinePrice(lineItem.pricingReviewJson, lineItem.quantity)) {
        errors.push(`${label}: system pricing is unavailable or zero. Enter a valid unit or total price override before conversion.`);
      }
      if (!artworkBypassed && normalizedPayload.reviewedArtworkJson.status !== "not_required" && !hasCompleteDoubleSidedArtwork(lineItem)) {
        errors.push(`${label}: assign Back artwork or choose the same artwork for both sides.`);
      }
    }

    if (!artworkBypassed && draftHasArtworkThatNeedsAssignment(normalizedPayload)) {
      const targetLineIndex = normalizedPayload.reviewedLineItemsJson.findIndex((lineItem) => !lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
      errors.push(`Line ${Math.max(0, targetLineIndex) + 1} needs artwork assignment.`);
    }

    normalizedPayload.missingDecisionsJson.forEach((decision) => {
      if (decision.status !== "still_blocking") return;
      if (decisionReferencesRemovedLine(normalizedPayload, decision)) return;
      if (isDimensionsDecision(decision) && dimensionsDecisionIsResolvedByLineItem(normalizedPayload, decision)) return;
      if (decision.severity === "blocking") {
        errors.push(`${decision.label}: resolve or acknowledge this blocking decision.`);
      }
    });

    errors.push(...await this.validateRequiredPbv2Selections(record.organizationId, normalizedPayload));

    return Array.from(new Set(errors));
  }

  /**
   * Materialize reviewed artwork as real, line-item-scoped order attachments.
   * The reviewed draft keeps provenance in specsJson, but production and
   * prepress consume order_attachments. Keeping both representations aligned
   * lets one reviewed line carry many artwork files without leaving those files
   * stranded in inbound metadata after conversion.
   */
  private async materializeInboundArtworkForOrder(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    payload: InboundOrderReviewDraftPayload;
    files: InboundOrderFile[];
    order: OrderWithRelations;
    conversionRepository: InboundOrdersRepository;
    orderRepository: OrdersRepository;
    tx: any;
  }): Promise<void> {
    const filesById = new Map(args.files.map((file) => [file.id, file]));

    for (let index = 0; index < args.payload.reviewedLineItemsJson.length; index += 1) {
      const reviewedLineItem = args.payload.reviewedLineItemsJson[index];
      const orderLineItem = args.order.lineItems?.[index];
      const description = reviewedLineItem.productName || reviewedLineItem.sourceText || `Line ${index + 1}`;
      const activeArtworkLinks = reviewedLineItem.artworkLinks.filter(isActiveClassifiedArtworkLink);

      if (activeArtworkLinks.length === 0) continue;

      if (!orderLineItem) {
        throw new InboundOrderConversionValidationError(
          "Inbound review draft is not ready for order conversion.",
          [`${description}: the converted order is missing its line item, so artwork could not be attached.`],
        );
      }

      const materializedArtworkKeys = new Set<string>();
      for (const artworkLink of activeArtworkLinks) {
        const key = artworkLinkKey(artworkLink);
        if (materializedArtworkKeys.has(key)) continue;
        materializedArtworkKeys.add(key);

        const inboundFile = filesById.get(artworkLink.fileId);
        if (!inboundFile?.fileRecordId || isUnsafeForArtworkClassification(inboundFile)) {
          throw new InboundOrderConversionValidationError(
            "Inbound review draft is not ready for order conversion.",
            [`${description}: assigned artwork ${artworkLink.filename ?? "attachment"} is unavailable or unsafe. Resolve its attachment state before conversion.`],
          );
        }

        const attachmentSides = artworkLink.assignmentSide === "both"
          ? ["front", "back"] as const
          : artworkLink.assignmentSide === "front" || artworkLink.assignmentSide === "back"
            ? [artworkLink.assignmentSide]
            : ["na"] as const;
        const createdAttachments = [];
        for (const side of attachmentSides) {
          await canonicalArtworkWriteService.attachSourceArtwork({
            tx: args.tx,
            organizationId: args.organizationId,
            orderId: args.order.id,
            lineItemId: String(orderLineItem.id),
            fileRecordId: inboundFile.fileRecordId,
            side,
            allocationQuantity: artworkLink.productionQuantity,
            allocationGroupId: artworkLink.productionGroupId ?? null,
            actorUserId: args.actorUserId,
            origin: "customer_upload",
          });
          createdAttachments.push(await args.orderRepository.createOrderAttachment({
            orderId: args.order.id,
            orderLineItemId: String(orderLineItem.id),
            fileRecordId: inboundFile.fileRecordId,
            uploadedByUserId: args.actorUserId,
            uploadedByName: null,
            fileName: inboundFile.sourceFilename ?? artworkLink.filename ?? "Inbound artwork",
            fileUrl: null,
            fileSize: inboundFile.sizeBytes ?? artworkLink.sizeBytes ?? null,
            mimeType: inboundFile.mimeType ?? artworkLink.mimeType ?? null,
            description: `Artwork attached during inbound review conversion (${args.inboundRecordId})${artworkLink.assignmentSide === "both" ? "; same artwork for both sides." : ""}`,
            originalFilename: inboundFile.sourceFilename ?? artworkLink.filename ?? null,
            role: "artwork",
            side,
            isPrimary: side !== "na",
            productionQuantity: artworkLink.productionQuantity,
            productionGroupId: artworkLink.productionGroupId ?? null,
          }));
        }

        const updated = await args.conversionRepository.updateFile({
          organizationId: args.organizationId,
          inboundRecordId: args.inboundRecordId,
          fileId: inboundFile.id,
          patch: { createdOrderAttachmentId: createdAttachments[0].id },
        });
        if (!updated) {
          throw new InboundOrderConversionValidationError(
            "Inbound review draft is not ready for order conversion.",
            [`${description}: artwork ${artworkLink.filename ?? "attachment"} could not be linked to the converted order.`],
          );
        }
      }
    }
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
    const artworkBypassed = hasArtworkBypassForOrder(payload);
    const reference = order.poNumber || detail.record.externalReference || detail.record.id.slice(0, 8);
    const lineItems: CreateOrderLineItemInput[] = [];
    for (let index = 0; index < payload.reviewedLineItemsJson.length; index += 1) {
      const lineItem = payload.reviewedLineItemsJson[index];
      const description = lineItem.productName || lineItem.sourceText || `Inbound reviewed item ${index + 1}`;
      const selections = this.normalizePbv2Selections(lineItem.optionSelectionsJson);
      let pricing: Awaited<ReturnType<typeof priceLineItem>> | null = null;
      let pricingError: unknown = null;
      try {
        pricing = await this.priceInboundReviewLine({
          organizationId: detail.record.organizationId,
          productId: lineItem.selectedProductId!,
          quantity: lineItem.quantity ?? 1,
          width: lineItem.width,
          height: lineItem.height,
          optionSelections: selections,
          pbv2TreeVersionId: lineItem.pbv2TreeVersionId,
        });
      } catch (error) {
        pricingError = error;
      }
      const currentSystemTotalCents = pricing && Number.isFinite(pricing.lineTotalCents)
        ? Math.max(0, Math.round(pricing.lineTotalCents))
        : 0;
      const effectivePricing = resolveInboundLineEffectivePricing({
        ...lineItem.pricingReviewJson,
        systemPriceCents: currentSystemTotalCents,
      }, lineItem.quantity);
      if (effectivePricing.effectiveTotalCents <= 0) {
        throw new InboundOrderConversionValidationError(
          "Inbound review draft is not ready for order conversion.",
          [`${description}: pricing could not calculate a non-zero total and no valid override was supplied.${pricingError instanceof Error ? ` ${pricingError.message}` : ""}`],
        );
      }
      const pbv2SnapshotJson = pricing?.pbv2SnapshotJson ?? {
        pricingSystem: "manual_override",
        selectedOptions: [],
        pricing: { totalCents: currentSystemTotalCents },
      };

      lineItems.push({
        productId: lineItem.selectedProductId!,
        productType: "wide_roll",
        description,
        productName: description,
        width: lineItem.width ?? null,
        height: lineItem.height ?? null,
        quantity: lineItem.quantity ?? 1,
        sqft: null,
        unitPrice: effectivePricing.effectiveUnitPriceCents / 100,
        totalPrice: effectivePricing.effectiveTotalCents / 100,
        status: "new",
        workflowState: "new",
        requiresDesign: false,
        requiresPrepress: artworkBypassed,
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
            artworkBypassed,
            artworkStatusNote: artworkBypassed
              ? "Artwork was intentionally bypassed during inbound order conversion and remains required before prepress or proofing."
              : null,
            artworkReferences: artwork.refs,
            artworkLinks: lineItem.artworkLinks,
            artworkQuantityMode: lineItem.artworkQuantityMode,
            artworkFileCount: lineItem.artworkLinks.filter(isActiveClassifiedArtworkLink).length,
            unassignedArtworkAttachments: artwork.unassignedAttachments,
            unsupportedRequests: payload.unsupportedRequestsJson,
          },
          staffReviewedDraft: lineItem,
        },
        pbv2TreeVersionId: pricing?.pbv2TreeVersionId ?? lineItem.pbv2TreeVersionId,
        optionSelectionsJson: selections,
        pbv2SnapshotJson,
        selectedOptions: pbv2SnapshotJson.selectedOptions ?? [],
        priceOverrideMode: effectivePricing.priceOverrideMode,
        priceOverrideValueCents: effectivePricing.priceOverrideValueCents,
        overridePriceCents: effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null,
        overrideReason: effectivePricing.hasPriceOverride
          ? lineItem.pricingReviewJson?.priceOverrideSource === "po" ? "Inbound PO price override" : "Inbound staff price override"
          : null,
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

    const taxCalculation = await calculateAuthoritativeOrderTax({
      organizationId: detail.record.organizationId,
      customerId: customer.selectedCustomerId ?? null,
      lines: lineItems,
    });
    taxCalculation.totals.lineItemsWithTax.forEach((lineTax, index) => {
      lineItems[index]!.taxAmount = lineTax.taxAmount;
      lineItems[index]!.isTaxableSnapshot = lineTax.isTaxableSnapshot;
    });

    return {
      customerId: customer.selectedCustomerId ?? null,
      contactId: customer.selectedContactId ?? null,
      label: `Inbound ${reference}`,
      poNumber: order.poNumber ?? detail.record.externalReference ?? null,
      status: "new",
      priority: order.priority,
      dueDate: normalizedDueDate,
      requestedDueDate: normalizedDueDate,
      // Provenance belongs to the inbound relationship and immutable order
      // history. Staff-authored notes are added as structured note rows after
      // creation, never embedded in this legacy free-text field.
      notesInternal: null,
      createdByUserId: args.actorUserId,
      lineItems,
      taxRate: taxCalculation.totals.taxRate,
      taxAmount: taxCalculation.totals.taxAmount,
      taxableSubtotal: taxCalculation.totals.taxableSubtotal,
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
            pricingReview: pricingReviewAuditSummary(args.payload),
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
          pricingReview: pricingReviewAuditSummary(args.payload),
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
            pricingReview: pricingReviewAuditSummary(args.payload),
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
      if (this.lineItemRequiresDimensions(lineItem) && !hasValidLineItemDimensions(lineItem)) {
        errors.push(`${label}: width and height are required for this product type.`);
      }
      if (lineItem.pricingReviewJson?.status === "mismatch" && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution)) {
        errors.push(`${label}: PO price differs from system price. Acknowledge or resolve pricing before conversion.`);
      }
      if (!hasUsableInboundLinePrice(lineItem.pricingReviewJson, lineItem.quantity)) {
        errors.push(`${label}: system pricing is unavailable or zero. Enter a valid unit or total price override before conversion.`);
      }
      const artworkBypassed = hasArtworkBypassForOrder(draft);
      if (!artworkBypassed && draft.reviewedArtworkJson.status !== "not_required" && !hasCompleteDoubleSidedArtwork(lineItem)) {
        errors.push(`${label}: assign Back artwork or choose the same artwork for both sides.`);
      }
    });

    const artworkBypassed = hasArtworkBypassForOrder(draft);
    const artworkRequired = artworkIsRequiredForOrder(draft);
    if (artworkRequired && !artworkBypassed) {
      errors.push("Artwork is missing. Assign artwork or select Bypass artwork before marking the draft ready for order conversion.");
    }

    if (!artworkBypassed && draftHasArtworkThatNeedsAssignment(draft)) {
      const targetLineIndex = draft.reviewedLineItemsJson.findIndex((lineItem) => !lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
      errors.push(`Line ${Math.max(0, targetLineIndex) + 1} needs artwork assignment.`);
    }

    draft.missingDecisionsJson.forEach((decision) => {
      if (decision.status !== "still_blocking") return;
      if (decisionReferencesRemovedLine(draft, decision)) return;
      if (isDimensionsDecision(decision) && dimensionsDecisionIsResolvedByLineItem(draft, decision)) return;
      if (decision.severity === "blocking") {
        errors.push(`${decision.label}: resolve or acknowledge this blocking decision.`);
      } else if (!artworkBypassed && isArtworkDecision(decision)) {
        errors.push(`Line ${(artworkLineIndex(decision.field) ?? 0) + 1} needs artwork assignment or an explicit artwork-status decision.`);
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

  /**
   * Keep inbound pricing inputs aligned with the direct quote-entry path before
   * delegating to the authoritative PricingService. Inbound captures raw
   * dimensions, while quote entry normalizes quantity-only and PBV2 fixed-size
   * products first.
   */
  private async priceInboundReviewLine(args: {
    organizationId: string;
    productId: string;
    quantity: number;
    width: number | null | undefined;
    height: number | null | undefined;
    optionSelections: LineItemOptionSelectionsV2 | Record<string, unknown> | null | undefined;
    pbv2TreeVersionId: string | null | undefined;
  }): Promise<Awaited<ReturnType<typeof priceLineItem>>> {
    const product = await this.repository.getProduct(args.organizationId, args.productId);
    if (!product) {
      throw new Error("Selected product was not found for this organization.");
    }

    const selections = this.normalizePbv2Selections(args.optionSelections);
    let { widthIn, heightIn } = dimensionsForProductPricing(product, args.width, args.height);
    const activeTree = await this.repository.getProductActivePbv2Tree(args.organizationId, args.productId);
    const activeTreeVersionId = activeTree?.activeTree?.id ?? null;

    // Match direct quote entry when its active PBV2 tree is in use. A historic
    // explicit version is still handed to PricingService, which loads that
    // exact version and remains the authority for its runtime dimensions.
    if (
      product.measurementMode !== "quantity_only"
      && product.pricingProfileKey !== "fee"
      && activeTree?.activeTree?.treeJson
      && (!args.pbv2TreeVersionId || args.pbv2TreeVersionId === activeTreeVersionId)
    ) {
      ({ widthIn, heightIn } = resolvePbv2RuntimeDimensions({
        treeJson: activeTree.activeTree.treeJson,
        widthIn,
        heightIn,
      }));
    }

    return this.priceLineItemFn({
      organizationId: args.organizationId,
      productId: args.productId,
      quantity: args.quantity,
      widthIn,
      heightIn,
      pbv2ExplicitSelections: selections.selected,
      pbv2TreeVersionIdOverride: args.pbv2TreeVersionId ?? undefined,
    });
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
    const warnings: string[] = [];
    const snapshotKind = stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "metadata.snapshotKind"));

    if (record.status === rejectedStatus || record.reviewOutcome === "rejected") {
      blockingReasons.push("Rejected inbound records must be reopened before quote conversion.");
    }

    if (record.createdQuoteId) {
      blockingReasons.push("Inbound record already has a converted quote.");
    }

    if (!latestReviewSnapshot) {
      blockingReasons.push("A staff review snapshot is required before quote conversion.");
    } else if (snapshotKind !== "staff_review_draft" && snapshotKind !== editableReviewDraftKind) {
      blockingReasons.push("Latest review snapshot is not a staff-reviewed draft.");
    }

    const sourceLineItemsById = new Map(detail.lineItems.map((lineItem) => [lineItem.id, lineItem]));
    const reviewedPayload = latestReviewSnapshot && snapshotKind === editableReviewDraftKind
      ? this.reviewDraftPayloadFromSnapshot(latestReviewSnapshot)
      : null;
    const lineItemDraftsValue = reviewedPayload?.reviewedLineItemsJson ?? getPathValue(latestReviewSnapshot?.payloadJson, "lineItemDrafts");
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
      const productId = stringFromUnknown(draft.selectedProductId) ?? sourceLineItem?.productId ?? null;
      const width = positiveNumberFromUnknown(draft.width) ?? positiveNumberFromUnknown(sourceLineItem?.width);
      const height = positiveNumberFromUnknown(draft.height) ?? positiveNumberFromUnknown(sourceLineItem?.height);
      const quantity = positiveIntegerFromUnknown(draft.quantity) ?? positiveIntegerFromUnknown(sourceLineItem?.quantity);

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

      const reviewedLineItem = reviewedPayload?.reviewedLineItemsJson[index] ?? null;
      const requiresDimensions = reviewedLineItem
        ? this.lineItemRequiresDimensions(reviewedLineItem)
        : true;
      if (requiresDimensions && (!width || !height)) {
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
        sourceLineItemId: sourceLineItem?.id ?? sourceLineItemId ?? null,
        productId,
        variantId: sourceLineItem?.variantId ?? stringFromUnknown(draft.variantId),
        productName: productName ?? "Inbound review item",
        description: stringFromUnknown(draft.description) ?? stringFromUnknown(draft.sourceText) ?? sourceLineItem?.description ?? null,
        productType: stringFromUnknown(draft.productType),
        // Quote line dimensions are currently non-null in the persisted schema.
        // Quantity-only/service lines use neutral compatibility dimensions; their
        // measurement mode keeps these values out of order entry and pricing.
        width: width ?? 1,
        height: height ?? 1,
        quantity,
        notes: stringFromUnknown(draft.notes),
        artworkFileIds: reviewedPayload?.reviewedLineItemsJson[index]?.artworkLinks
          .filter(isActiveClassifiedArtworkLink)
          .map((link) => link.fileId) ?? [],
        artworkAllocations: reviewedPayload?.reviewedLineItemsJson[index]?.artworkLinks
          .filter(isActiveClassifiedArtworkLink)
          .map((link) => ({
            fileId: link.fileId,
            productionQuantity: link.productionQuantity,
            productionGroupId: link.productionGroupId,
          })) ?? [],
        snapshotJson: draft,
      });
    }

    const reviewedCustomer = reviewedPayload?.reviewedCustomerJson ?? null;
    const reviewedSelectedCustomerId = reviewedCustomer?.selectedCustomerId ?? null;
    const reviewedSelectedContactId = reviewedCustomer?.selectedContactId ?? null;
    const customerName = detail.matchedCustomer?.companyName
      ?? reviewedCustomer?.companyName
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "customerDraft.name"))
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "customerDraft.text"))
      ?? record.sourceLabel
      ?? null;
    const contactName = detail.matchedContact?.name
      ?? reviewedCustomer?.sourceName
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.name"));
    const contactEmail = detail.matchedContact?.email
      ?? reviewedCustomer?.sourceEmail
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.email"));
    const contactPhone = detail.matchedContact?.phone
      ?? detail.matchedContact?.mobile
      ?? reviewedCustomer?.sourcePhone
      ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "contactDraft.phone"));
    const desiredOutputType = reviewedPayload?.reviewedOrderJson.intent ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "desiredOutputType"));
    const orderNotes = reviewedPayload?.reviewedOrderJson.internalNotes ?? stringFromUnknown(getPathValue(latestReviewSnapshot?.payloadJson, "orderNotes"));
    const externalReference = record.externalReference ?? record.sourceRecordId ?? record.id.slice(0, 8);
    if (!reviewedSelectedCustomerId && !record.matchedCustomerId && !reviewedSelectedContactId && !record.matchedContactId) {
      blockingReasons.push("Assign an existing customer, a contact, or both before creating a quote draft.");
    }
    if (lineItemsToConvert.length === 0) {
      blockingReasons.push("At least one valid line item is required before creating a quote draft.");
    }
    if (reviewedPayload?.reviewedArtworkJson.status === "missing") {
      warnings.push("Artwork is missing. The quote draft will carry an artwork-missing warning.");
    } else if (reviewedPayload?.reviewedArtworkJson.status === "to_follow") {
      warnings.push("Artwork is marked to follow and will not block quote draft creation.");
    }

    return {
      eligible: blockingReasons.length === 0,
      blockingReasons,
      warnings,
      alreadyConverted: Boolean(record.createdQuoteId),
      latestSnapshot: {
        id: latestReviewSnapshot?.id ?? null,
        snapshotVersion: latestReviewSnapshot?.snapshotVersion ?? null,
        snapshotType: latestReviewSnapshot?.snapshotType ?? null,
        snapshotKind,
        createdAt: latestReviewSnapshot?.createdAt ?? null,
      },
      customer: {
        matchedCustomerId: record.matchedCustomerId ?? reviewedSelectedCustomerId ?? null,
        customerName,
        source: record.matchedCustomerId ? "matched_customer" : reviewedSelectedCustomerId ? "reviewed_customer" : customerName ? "manual_text" : "missing",
      },
      contact: {
        matchedContactId: record.matchedContactId ?? reviewedSelectedContactId ?? null,
        contactName,
        email: contactEmail,
        phone: contactPhone,
        source: record.matchedContactId
          ? "matched_contact"
          : reviewedSelectedContactId
            ? "reviewed_contact"
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
