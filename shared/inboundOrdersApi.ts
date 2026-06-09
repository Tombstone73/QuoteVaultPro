import { z } from "zod";
import {
  inboundOrderRecordStatusSchema,
  inboundOrderSourceTypeSchema,
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

export const inboundOrderStatusGroupSchema = z.enum([
  "needs_review",
  "waiting",
  "ready",
  "converted",
  "rejected",
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
    z.enum(["waiting", "converted", "rejected"]),
  ]),
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
});

export type InboundOrderParseAttemptStatus = z.infer<typeof inboundOrderParseAttemptStatusSchema>;
export type InboundOrderParsedDraft = z.infer<typeof inboundOrderParsedDraftSchema>;
export type InboundOrderParseWarning = z.infer<typeof inboundOrderParseWarningSchema>;
export type InboundOrderCandidate = z.infer<typeof inboundOrderCandidateSchema>;

export type ManualInboundOrderCreateRequest = z.infer<typeof manualInboundOrderCreateSchema>;
export type InboundOrderStatusUpdateRequest = z.infer<typeof inboundOrderStatusUpdateSchema>;
export type InboundOrderListQuery = z.infer<typeof inboundOrderListQuerySchema>;
export type InboundOrderStatusGroup = z.infer<typeof inboundOrderStatusGroupSchema>;

export type InboundOrderQueueSummary = {
  needsReview: number;
  waitingOnCustomer: number;
  readyReviewed: number;
  convertedSubmitted: number;
  rejectedTerminal: number;
  withWarnings: number;
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

export function normalizeInboundOrderStatusForStorage(
  status: InboundOrderStatusUpdateRequest["status"],
): InboundOrderRecordStatus {
  if (status === "waiting") return "waiting_on_customer";
  if (status === "converted") return "submitted";
  if (status === "rejected") return "terminal";
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
