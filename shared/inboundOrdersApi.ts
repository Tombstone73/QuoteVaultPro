import { z } from "zod";
import {
  inboundEmailIgnoreRuleTypeSchema,
  inboundOrderRecordStatusSchema,
  inboundOrderSourceTypeSchema,
  type InboundEmailIgnoreRule,
  type InboundEmailIgnoreRuleType,
  type InboundOrderParseAttempt,
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
} from "./schema";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "./optionTreeV2";
import type { InboundPbv2OptionSuggestion, InboundPbv2RequiredOption } from "./inboundOrderPbv2Options";

export const inboundOrderStatusGroupSchema = z.enum([
  "active",
  "needs_review",
  "waiting",
  "ready",
  "converted",
  "rejected",
  "ignored",
]);

export const inboundOrderListQuerySchema = z.object({
  status: inboundOrderRecordStatusSchema.optional(),
  statusGroup: inboundOrderStatusGroupSchema.optional(),
  reviewOutcome: z.string().trim().min(1).max(100).optional(),
  sourceType: inboundOrderSourceTypeSchema.optional(),
  sourceId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
  hasWarnings: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  hasDecisionFlags: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  converted: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  linkedQuoteStatus: z.enum(["draft", "pending_approval", "pending", "active", "canceled"]).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const manualInboundOrderCreateSchema = z.object({
  reference: z.string().trim().max(255).optional().nullable(),
  senderName: z.string().trim().max(255).optional().nullable(),
  senderEmail: z.string().trim().email().max(255).optional().nullable(),
  subject: z.string().trim().max(500).optional().nullable(),
  bodyText: z.string().trim().min(1, "Body text is required.").max(50000),
  notes: z.string().trim().max(10000).optional().nullable(),
});

export const inboundOrderStatusUpdateSchema = z.object({
  status: z.union([
    inboundOrderRecordStatusSchema,
    z.enum(["waiting", "converted", "rejected", "ignored"]),
  ]),
});

export const inboundEmailIgnoreRuleCreateSchema = z.object({
  ruleType: inboundEmailIgnoreRuleTypeSchema,
  ruleValue: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const inboundEmailIgnoreRuleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const inboundOrderIgnoreActionSchema = z.object({
  action: z.enum([
    "ignore_once",
    "ignore_sender",
    "ignore_domain",
    "ignore_subject",
    "ignore_sender_subject",
  ]),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const inboundOrderBulkActionSchema = z.object({
  recordIds: z.array(z.string().trim().min(1)).min(1).max(100),
  action: z.enum([
    "ignore_once",
    "ignore_sender",
    "ignore_domain",
    "ignore_subject",
    "ignore_sender_subject",
    "delete",
    "reject",
  ]),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const inboundOrderParseAttemptStatusValues = ["success", "failed", "repaired", "fallback"] as const;
export const inboundOrderParseAttemptStatusSchema = z.enum(inboundOrderParseAttemptStatusValues);

export const inboundOrderParseWarningSchema = z.object({
  code: z.string().trim().min(1).max(100).default("parse_warning"),
  message: z.string().trim().min(1).max(1000),
  severity: z.enum(["info", "warning", "blocking"]).default("warning"),
  fieldPath: z.string().trim().max(255).optional().nullable(),
});

export const inboundOrderCandidateSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  confidence: z.number().min(0).max(100),
  reason: z.string().trim().max(1000).optional().nullable(),
  metadata: z.record(z.unknown()).default({}),
});

export const inboundOrderEvidenceItemSchema = z.object({
  type: z.enum(["EMAIL_SUBJECT", "EMAIL_BODY", "PDF_ATTACHMENT", "TEXT_ATTACHMENT", "MANUAL_NOTES"]),
  label: z.string().trim().min(1).max(255),
  sourceId: z.string().trim().max(255).optional().nullable(),
  fileName: z.string().trim().max(512).optional().nullable(),
  mimeType: z.string().trim().max(255).optional().nullable(),
  rawText: z.string().trim().max(50000).optional().nullable(),
  pageCount: z.number().int().positive().optional().nullable(),
  documentType: z.enum(["purchase_order", "artwork_reference", "unknown"]).default("unknown"),
  documentConfidence: z.number().min(0).max(100).default(0),
  extractionStatus: z.enum(["successful", "failed", "not_attempted"]).default("not_attempted"),
  poSummary: z.object({
    poNumber: z.string().trim().max(255).optional().nullable(),
    customer: z.string().trim().max(255).optional().nullable(),
    contact: z.string().trim().max(255).optional().nullable(),
    dueDate: z.string().trim().max(80).optional().nullable(),
    quantity: z.number().positive().optional().nullable(),
    productDescription: z.string().trim().max(1000).optional().nullable(),
    material: z.string().trim().max(255).optional().nullable(),
    dimensions: z.string().trim().max(120).optional().nullable(),
    printSpecs: z.array(z.string().trim().min(1).max(255)).default([]),
    shippingNotes: z.string().trim().max(2000).optional().nullable(),
    price: z.string().trim().max(120).optional().nullable(),
    versionCount: z.number().positive().optional().nullable(),
    dateCandidates: z.array(z.object({
      parsedDate: z.string().trim().max(80),
      sourceText: z.string().trim().max(500),
      classification: z.enum(["PO_DATE", "ORDER_DATE", "DUE_DATE", "ARRIVAL_DATE", "SHIP_DATE", "EVENT_DATE", "UNKNOWN"]),
      confidence: z.number().min(0).max(100),
    })).default([]),
    fieldSources: z.record(z.object({
      value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
      sourceType: z.enum(["EMAIL_SUBJECT", "EMAIL_BODY", "PDF_ATTACHMENT", "TEXT_ATTACHMENT", "MANUAL_NOTES"]),
      sourceDocument: z.string().trim().max(512).optional().nullable(),
      sourceText: z.string().trim().max(1000).optional().nullable(),
      confidence: z.number().min(0).max(100),
    })).default({}),
  }).optional().nullable(),
  warnings: z.array(inboundOrderParseWarningSchema).default([]),
});

const confidenceSchema = z.number().min(0).max(100).default(0);
const stringArraySchema = z.array(z.string().trim().min(1).max(500)).default([]);

export const inboundOrderParsedDraftSchema = z.object({
  customer: z.object({
    sourceName: z.string().trim().max(255).nullable().default(null),
    sourceEmail: z.string().trim().max(255).nullable().default(null),
    sourcePhone: z.string().trim().max(80).nullable().default(null),
    companyName: z.string().trim().max(255).nullable().default(null),
    candidateCustomerIds: z.array(z.string()).default([]),
    candidateContactIds: z.array(z.string()).default([]),
    customerCandidates: z.array(inboundOrderCandidateSchema).default([]),
    contactCandidates: z.array(inboundOrderCandidateSchema).default([]),
    confidence: confidenceSchema,
    warnings: z.array(inboundOrderParseWarningSchema).default([]),
  }),
  order: z.object({
    requestedDueDate: z.string().trim().max(80).nullable().default(null),
    requestedShipMethod: z.string().trim().max(160).nullable().default(null),
    requestedPickup: z.boolean().nullable().default(null),
    poNumber: z.string().trim().max(255).nullable().default(null),
    notes: z.string().trim().max(10000).nullable().default(null),
    confidence: confidenceSchema,
    warnings: z.array(inboundOrderParseWarningSchema).default([]),
  }),
  lineItems: z.array(z.object({
    sourceText: z.string().trim().max(5000).nullable().default(null),
    productName: z.string().trim().max(255).nullable().default(null),
    candidateProductIds: z.array(z.string()).default([]),
    productCandidates: z.array(inboundOrderCandidateSchema).default([]),
    quantity: z.number().positive().nullable().default(null),
    width: z.number().positive().nullable().default(null),
    height: z.number().positive().nullable().default(null),
    dimensionsUnit: z.string().trim().max(40).nullable().default(null),
    materialText: z.string().trim().max(255).nullable().default(null),
    optionTexts: stringArraySchema,
    finishingTexts: stringArraySchema,
    artworkRefs: stringArraySchema,
    confidence: confidenceSchema,
    warnings: z.array(inboundOrderParseWarningSchema).default([]),
  })).default([]),
  artwork: z.array(z.object({
    filename: z.string().trim().max(512).nullable().default(null),
    sourceReference: z.string().trim().max(512).nullable().default(null),
    likelyLineItemIndex: z.number().int().min(0).nullable().default(null),
    purpose: z.enum(["artwork", "proof", "reference", "unknown"]).default("unknown"),
    confidence: confidenceSchema,
    warnings: z.array(inboundOrderParseWarningSchema).default([]),
  })).default([]),
  globalWarnings: z.array(inboundOrderParseWarningSchema).default([]),
  missingDecisions: z.array(z.object({
    field: z.string().trim().min(1).max(255),
    label: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(1).max(1000),
    severity: z.enum(["info", "warning", "blocking"]).default("warning"),
  })).default([]),
  evidence: z.object({
    items: z.array(inboundOrderEvidenceItemSchema).default([]),
    conflicts: z.array(inboundOrderParseWarningSchema).default([]),
  }).default({ items: [], conflicts: [] }),
});

export const inboundOrderReviewDraftStatusValues = ["draft", "ready_to_convert", "rejected"] as const;
export const inboundOrderReviewDraftStatusSchema = z.enum(inboundOrderReviewDraftStatusValues);

export const inboundOrderReviewDecisionStatusValues = ["resolved", "acknowledged", "still_blocking"] as const;
export const inboundOrderReviewDecisionStatusSchema = z.enum(inboundOrderReviewDecisionStatusValues);

export const inboundOrderArtworkReviewStatusValues = ["supplied", "to_follow", "missing", "not_required"] as const;
export const inboundOrderArtworkReviewStatusSchema = z.enum(inboundOrderArtworkReviewStatusValues);

const nullableTextSchema = z.string().trim().max(10000).optional().nullable();
export const inboundOrderReviewValueSourceSchema = z.enum([
  "ai_inferred",
  "crm_match",
  "catalog_match",
  "source_evidence",
  "staff_selected",
]);

export const inboundOrderReviewedCustomerSchema = z.object({
  sourceName: z.string().trim().max(255).nullable().default(null),
  sourceEmail: z.string().trim().max(255).nullable().default(null),
  sourcePhone: z.string().trim().max(80).nullable().default(null),
  companyName: z.string().trim().max(255).nullable().default(null),
  selectedCustomerId: z.string().trim().min(1).nullable().default(null),
  selectedCustomerSource: z.enum(["interpreted_customer_match", "ai_inferred", "crm_match", "staff_selected"]).nullable().default(null),
  selectedCustomerReason: z.string().trim().max(1000).nullable().default(null),
  selectedCustomerConfidence: z.number().min(0).max(100).nullable().default(null),
  selectedContactId: z.string().trim().min(1).nullable().default(null),
  selectedContactSource: z.enum(["interpreted_contact_match", "ai_inferred", "crm_match", "staff_selected"]).nullable().default(null),
  selectedContactReason: z.string().trim().max(1000).nullable().default(null),
  selectedContactConfidence: z.number().min(0).max(100).nullable().default(null),
  unresolvedCustomer: z.boolean().default(false),
  unresolvedContact: z.boolean().default(false),
  notes: nullableTextSchema.default(null),
});

export const inboundOrderReviewedOrderSchema = z.object({
  poNumber: z.string().trim().max(255).nullable().default(null),
  dueDate: z.string().trim().max(80).nullable().default(null),
  shipMethod: z.string().trim().max(160).nullable().default(null),
  fulfillmentType: z.enum(["pickup", "shipping", "unknown"]).default("unknown"),
  internalNotes: nullableTextSchema.default(null),
  customerNotes: nullableTextSchema.default(null),
});

export const inboundOrderReviewedLineItemSchema = z.object({
  sourceLineItemId: z.string().trim().min(1).nullable().default(null),
  sourceText: z.string().trim().max(5000).nullable().default(null),
  productName: z.string().trim().max(255).nullable().default(null),
  selectedProductId: z.string().trim().min(1).nullable().default(null),
  selectedProductSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  interpretedProductId: z.string().trim().min(1).nullable().default(null),
  interpretedProductReason: z.string().trim().max(1000).nullable().default(null),
  interpretedProductConfidence: z.number().min(0).max(100).nullable().default(null),
  productUnresolved: z.boolean().default(false),
  quantity: z.number().positive().nullable().default(null),
  quantitySource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  width: z.number().positive().nullable().default(null),
  height: z.number().positive().nullable().default(null),
  dimensionsUnit: z.string().trim().max(40).nullable().default(null),
  dimensionsSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  materialText: z.string().trim().max(255).nullable().default(null),
  materialSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  printSpecs: z.array(z.string().trim().min(1).max(255)).default([]),
  printSpecsSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  optionTexts: stringArraySchema,
  optionTextsSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  finishingTexts: stringArraySchema,
  finishingTextsSource: inboundOrderReviewValueSourceSchema.nullable().default(null),
  optionSelectionsJson: z.object({
    schemaVersion: z.literal(2).default(2),
    selected: z.record(z.object({
      value: z.unknown(),
      note: z.string().trim().max(1000).optional(),
      origin: z.enum(["DEFAULT", "AI_INFERRED", "SOURCE_EVIDENCE", "USER_SELECTED"]).optional(),
      evidence: z.string().trim().max(1000).nullable().optional(),
    })).default({}),
    resolved: z.record(z.unknown()).optional(),
  }).nullable().default(null),
  pbv2TreeVersionId: z.string().trim().min(1).nullable().default(null),
  pbv2OptionSuggestions: z.array(z.object({
    selectionKey: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    value: z.unknown(),
    choiceLabel: z.string().trim().min(1),
    source: z.enum(["product_default", "source_evidence", "deterministic_print_spec_rule", "customer_history", "staff_selected"]).default("source_evidence"),
    origin: z.enum(["DEFAULT", "AI_INFERRED", "SOURCE_EVIDENCE", "USER_SELECTED"]).default("SOURCE_EVIDENCE"),
    evidence: z.string().trim().max(1000).nullable().default(null),
    conflictsWithDefault: z.boolean().default(false),
    defaultChoiceLabel: z.string().trim().max(255).nullable().default(null),
    confidence: z.number().min(0).max(100),
    reason: z.string().trim().min(1).max(1000),
  })).default([]),
  notes: nullableTextSchema.default(null),
});

export const inboundOrderReviewedArtworkSchema = z.object({
  status: inboundOrderArtworkReviewStatusSchema.default("missing"),
  refs: z.array(z.object({
    filename: z.string().trim().max(512).nullable().default(null),
    sourceReference: z.string().trim().max(512).nullable().default(null),
    likelyLineItemIndex: z.number().int().min(0).nullable().default(null),
    purpose: z.enum(["artwork", "proof", "reference", "unknown"]).default("unknown"),
  })).default([]),
  notes: nullableTextSchema.default(null),
});

export const inboundOrderReviewedMissingDecisionSchema = z.object({
  field: z.string().trim().min(1).max(255),
  label: z.string().trim().min(1).max(255),
  reason: z.string().trim().min(1).max(1000),
  severity: z.enum(["info", "warning", "blocking"]).default("warning"),
  status: inboundOrderReviewDecisionStatusSchema.default("still_blocking"),
  resolutionNote: nullableTextSchema.default(null),
});

export const inboundOrderReviewedWarningSchema = inboundOrderParseWarningSchema.extend({
  acknowledged: z.boolean().default(false),
  acknowledgementNote: nullableTextSchema.default(null),
});

export const inboundOrderUnsupportedRequestFindingSchema = z.object({
  type: z.literal("UNSUPPORTED_REQUEST"),
  requestedText: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(100),
  matchedProduct: z.string().trim().max(255).nullable().default(null),
  reason: z.string().trim().min(1).max(1000),
  severity: z.literal("review_required").default("review_required"),
  suggestedAction: z.string().trim().min(1).max(1000),
});

export const inboundOrderReviewDraftPayloadSchema = z.object({
  status: inboundOrderReviewDraftStatusSchema.default("draft"),
  reviewedCustomerJson: inboundOrderReviewedCustomerSchema,
  reviewedOrderJson: inboundOrderReviewedOrderSchema,
  reviewedLineItemsJson: z.array(inboundOrderReviewedLineItemSchema).default([]),
  reviewedArtworkJson: inboundOrderReviewedArtworkSchema,
  missingDecisionsJson: z.array(inboundOrderReviewedMissingDecisionSchema).default([]),
  warningsJson: z.array(inboundOrderReviewedWarningSchema).default([]),
  unsupportedRequestsJson: z.array(inboundOrderUnsupportedRequestFindingSchema).default([]),
  reviewNotes: nullableTextSchema.default(null),
});

export const inboundOrderReviewDraftSaveSchema = inboundOrderReviewDraftPayloadSchema.omit({ status: true }).extend({
  status: z.literal("draft").optional().default("draft"),
});

export type InboundOrderReviewDraftStatus = z.infer<typeof inboundOrderReviewDraftStatusSchema>;
export type InboundOrderReviewDecisionStatus = z.infer<typeof inboundOrderReviewDecisionStatusSchema>;
export type InboundOrderArtworkReviewStatus = z.infer<typeof inboundOrderArtworkReviewStatusSchema>;
export type InboundOrderReviewValueSource = z.infer<typeof inboundOrderReviewValueSourceSchema>;
export type InboundOrderReviewDraftPayload = z.infer<typeof inboundOrderReviewDraftPayloadSchema>;
export type InboundOrderUnsupportedRequestFinding = z.infer<typeof inboundOrderUnsupportedRequestFindingSchema>;
export type InboundOrderReviewDraftSaveRequest = Omit<z.infer<typeof inboundOrderReviewDraftSaveSchema>, "unsupportedRequestsJson"> & {
  unsupportedRequestsJson?: InboundOrderUnsupportedRequestFinding[];
};

export type InboundOrderReviewReadinessScore = {
  overall: number;
  customer: number;
  contact: number;
  product: number;
  options: number;
  artwork: {
    score: number;
    status: InboundOrderArtworkReviewStatus;
    label: string;
  };
};

export type InboundOrderInterpretationConfidence = {
  product: number;
  options: number;
  overall: number;
};

export type InboundOrderReviewDraftDto = InboundOrderReviewDraftPayload & {
  id: string | null;
  snapshotId: string | null;
  snapshotVersion: number | null;
  inboundOrderRecordId: string;
  organizationId: string;
  sourceParseAttemptId: string | null;
  sourceParseAttemptCreatedAt: string | null;
  latestParseAttemptId: string | null;
  latestParseAttemptCreatedAt: string | null;
  hasNewerParse: boolean;
  initializedFromParse: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  validationErrors: string[];
  readinessScore: InboundOrderReviewReadinessScore;
  interpretationConfidence: InboundOrderInterpretationConfidence;
};

export type InboundOrderParseAttemptStatus = z.infer<typeof inboundOrderParseAttemptStatusSchema>;
export type InboundOrderParsedDraft = z.infer<typeof inboundOrderParsedDraftSchema>;
export type InboundOrderParseWarning = z.infer<typeof inboundOrderParseWarningSchema>;
export type InboundOrderCandidate = z.infer<typeof inboundOrderCandidateSchema>;
export type InboundOrderEvidenceItem = z.infer<typeof inboundOrderEvidenceItemSchema>;

export type ManualInboundOrderCreateRequest = z.infer<typeof manualInboundOrderCreateSchema>;
export type InboundOrderStatusUpdateRequest = z.infer<typeof inboundOrderStatusUpdateSchema>;
export type InboundOrderListQuery = z.infer<typeof inboundOrderListQuerySchema>;
export type InboundOrderStatusGroup = z.infer<typeof inboundOrderStatusGroupSchema>;

export type InboundOrderConvertToOrderResponse = {
  success: boolean;
  data: {
    orderId: string;
    inboundOrderId: string;
    convertedAt: string;
    alreadyConverted?: boolean;
    order?: unknown;
    inbound?: InboundOrderDetail;
  };
  errors?: string[];
  message?: string;
};

export type InboundOrderProductOptionsResponse = {
  success: boolean;
  data: {
    productId: string;
    productName: string | null;
    activeTreeVersionId: string | null;
    treeJson: OptionTreeV2 | null;
    requiredOptions: InboundPbv2RequiredOption[];
    suggestedSelections: LineItemOptionSelectionsV2;
    suggestions: InboundPbv2OptionSuggestion[];
  };
  message?: string;
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

export type InboundProductSearchResponse = {
  success: boolean;
  data: InboundProductSearchResult[];
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

export type InboundEmailIgnoreRuleDto = Omit<InboundEmailIgnoreRule, "createdAt" | "updatedAt" | "lastMatchedAt"> & {
  createdAt: string;
  updatedAt: string;
  lastMatchedAt: string | null;
};

export type InboundEmailIgnoreRuleListResponse = {
  success: true;
  data: {
    rules: InboundEmailIgnoreRuleDto[];
  };
};

export type InboundEmailIgnoreRuleMutationResponse = {
  success: true;
  data: InboundEmailIgnoreRuleDto;
};

export type InboundEmailIgnoreRuleCreateRequest = z.infer<typeof inboundEmailIgnoreRuleCreateSchema>;
export type InboundEmailIgnoreRuleUpdateRequest = z.infer<typeof inboundEmailIgnoreRuleUpdateSchema>;
export type InboundEmailIgnoreRuleTypeValue = InboundEmailIgnoreRuleType;
export type InboundOrderIgnoreActionRequest = z.infer<typeof inboundOrderIgnoreActionSchema>;
export type InboundOrderBulkActionRequest = z.infer<typeof inboundOrderBulkActionSchema>;

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

export type InboundQuoteActivityProjection = {
  syncStatus: "quote_missing" | "quote_exists" | "quote_deleted_or_inaccessible" | "quote_status_changed";
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

export type InboundOrdersListResponse = {
  success: true;
  data: InboundOrderRecord[];
  summary: InboundOrderQueueSummary;
  pagination: {
    limit: number;
    offset: number;
  };
};

export type InboundOrderDetailResponse = {
  success: true;
  data: InboundOrderDetail;
};

export type ManualInboundOrderCreateResponse = {
  success: true;
  data: {
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  };
};

export type InboundOrderStatusUpdateResponse = InboundOrderDetailResponse;

export type InboundOrderParseAttemptDto = Omit<InboundOrderParseAttempt, "createdAt"> & {
  createdAt: string;
};

export type InboundOrderDraftPreviewResponse = {
  success: true;
  data: {
    draft: InboundOrderParsedDraft | null;
    latestAttempt: InboundOrderParseAttemptDto | null;
  };
};

export type InboundOrderParseResponse = {
  success: true;
  data: {
    draft: InboundOrderParsedDraft | null;
    latestAttempt: InboundOrderParseAttemptDto;
    record: InboundOrderRecord;
  };
};

export type InboundOrderParseAttemptsResponse = {
  success: true;
  data: InboundOrderParseAttemptDto[];
};

export type InboundOrderReviewDraftResponse = {
  success: true;
  data: InboundOrderReviewDraftDto;
};

export function normalizeInboundOrderStatusForStorage(
  status: InboundOrderStatusUpdateRequest["status"],
): InboundOrderRecordStatus {
  if (status === "waiting") return "waiting_on_customer";
  if (status === "converted") return "submitted";
  if (status === "rejected") return "terminal";
  if (status === "ignored") return "ignored";
  return status;
}

export function getManualInboundEvidence(record: Pick<InboundOrderRecord, "rawPayloadJson" | "normalizedPayloadJson" | "externalReference">) {
  const raw = record.rawPayloadJson ?? {};
  const normalized = record.normalizedPayloadJson ?? {};
  return {
    reference: stringFromPath(raw, "reference") ?? record.externalReference ?? null,
    senderName: stringFromPath(raw, "sender.name") ?? stringFromPath(normalized, "sender.name") ?? null,
    senderEmail: stringFromPath(raw, "sender.email") ?? stringFromPath(normalized, "sender.email") ?? null,
    subject: stringFromPath(raw, "subject") ?? stringFromPath(normalized, "subject") ?? null,
    bodyText: stringFromPath(raw, "bodyText") ?? stringFromPath(normalized, "bodyText") ?? null,
    notes: stringFromPath(raw, "notes") ?? stringFromPath(normalized, "notes") ?? null,
  };
}

function stringFromPath(source: unknown, path: string): string | null {
  const value = path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type InboundOrderRecordDto = InboundOrderRecord & {
  receivedAt: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rejectedAt: string | null;
};

export type InboundOrderSourceTypeValue = InboundOrderSourceType;
