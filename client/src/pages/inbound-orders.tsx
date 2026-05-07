import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Clock,
  Flag,
  FileText,
  Inbox,
  Loader2,
  Plus,
  Rows3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type InboundOrderRecordStatus =
  | "received"
  | "processing"
  | "needs_review"
  | "waiting_on_customer"
  | "ready"
  | "approved"
  | "submitted"
  | "failed"
  | "terminal";

type InboundOrderRecord = {
  id: string;
  sourceType: string;
  sourceLabel: string | null;
  sourceTrustLevel: string;
  status: InboundOrderRecordStatus;
  reviewOutcome: string | null;
  requiresHumanDecision: boolean;
  reviewRequiredReason: string | null;
  externalReference: string | null;
  rawPayloadJson: Record<string, unknown>;
  normalizedPayloadJson: Record<string, unknown>;
  extractedCustomerJson: Record<string, unknown> | null;
  extractedOrderJson: Record<string, unknown> | null;
  extractedShippingJson: Record<string, unknown> | null;
  confidenceScore: string | null;
  duplicateScore: string | null;
  matchedCustomerId: string | null;
  matchedContactId: string | null;
  createdQuoteId: string | null;
  createdOrderId: string | null;
  receivedAt: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type InboundOrderSource = {
  id: string;
  sourceType: string;
  name: string;
  status: string;
  sourceTrustLevel: string;
  externalAccountId: string | null;
  createdAt: string;
  updatedAt: string;
};

type InboundOrderLineItem = {
  id: string;
  sortOrder: number;
  status: string;
  rawLineJson: Record<string, unknown>;
  productId: string | null;
  variantId: string | null;
  productNameRaw: string | null;
  description: string | null;
  width: string | null;
  height: string | null;
  quantity: number | null;
  normalizedLineJson: Record<string, unknown>;
  optionSelectionsJson: Record<string, unknown> | null;
  warningsJson: Array<Record<string, unknown>>;
  confidenceScore: string | null;
  createdAt: string;
  updatedAt: string;
};

type InboundOrderFile = {
  id: string;
  sourceFilename: string | null;
  role: string;
  status: string;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  reviewNotes: string | null;
  createdAt: string;
};

type InboundOrderWarning = {
  id: string;
  severity: string;
  code: string;
  message: string;
  fieldPath: string | null;
  status: string;
  createdAt: string;
};

type InboundOrderDecisionFlag = {
  id: string;
  flagType: string;
  fieldPath: string | null;
  summary: string;
  suggestedValueJson: Record<string, unknown> | null;
  candidateValuesJson: Array<Record<string, unknown>>;
  status: string;
  confidenceScore: string | null;
  createdAt: string;
};

type InboundOrderEvent = {
  id: string;
  eventType: string;
  actorType: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
};

type InboundOrderReviewSnapshot = {
  id: string;
  snapshotType: string;
  snapshotVersion: number;
  payloadJson: Record<string, unknown>;
  createdAt: string;
};

type InboundLinkedQuoteSummary = {
  id: string;
  quoteNumber: number | null;
  reference: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  customerId: string | null;
  contactId: string | null;
  customerName: string | null;
};

type InboundQuoteActivity = {
  syncStatus: "quote_missing" | "quote_exists" | "quote_deleted_or_inaccessible" | "quote_status_changed";
  lastQuoteUpdatedAt: string | null;
  currentQuoteStatus: string | null;
  originalQuoteStatus: string | null;
  divergedFromReviewSnapshot: boolean;
  divergenceReasons: string[];
  lastSyncEventAt: string | null;
};

type InboundMatchedCustomerSummary = {
  id: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

type InboundMatchedContactSummary = {
  id: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
};

type InboundOrdersListResponse = {
  success: boolean;
  data: InboundOrderRecord[];
  summary: InboundQueueSummary;
  pagination: {
    limit: number;
    offset: number;
  };
};

type InboundQueueSummary = {
  needsReview: number;
  waitingOnCustomer: number;
  readyReviewed: number;
  convertedSubmitted: number;
  rejectedTerminal: number;
  withWarnings: number;
};

type QueueStatusGroup = "all" | "needs_review" | "waiting" | "ready" | "converted" | "rejected";

type QueueFilters = {
  statusGroup: QueueStatusGroup;
  sourceType: string;
  hasWarnings: boolean;
  unconvertedOnly: boolean;
  search: string;
};

type ProductOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  isActive?: boolean;
};

type CustomerMatchOption = {
  id: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

type ContactMatchOption = {
  id: string;
  customerId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
};

type CustomerSearchResponse = {
  success: boolean;
  data: CustomerMatchOption[];
};

type ContactSearchResponse = {
  success: boolean;
  data: ContactMatchOption[];
};

type InboundOrderDetailResponse = {
  success: boolean;
  data: {
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
    quoteActivity: InboundQuoteActivity;
    matchedCustomer: InboundMatchedCustomerSummary | null;
    matchedContact: InboundMatchedContactSummary | null;
  };
};

type ManualInboundOrderCreateResponse = {
  success: boolean;
  data: {
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  };
};

type CreatedQuoteSummary = {
  id: string;
  quoteNumber: number | null;
  reference: string;
  status: string;
  customerId: string | null;
  contactId: string | null;
  customerName: string | null;
  contactName: string | null;
  totalPrice: string;
  createdAt: string;
  lineItemsCreated: number;
  convertedLineItemCount: number;
  skippedLineItemCount: number;
  skippedLineItems: Array<Record<string, unknown>>;
  alreadyConverted?: boolean;
};

type CreateQuoteDraftResponse = {
  success: boolean;
  data: {
    quote: CreatedQuoteSummary;
    inbound: InboundOrderDetailResponse["data"];
  };
};

type QuoteDraftPreviewLineItem = {
  index: number;
  sourceLineItemId: string | null;
  productId: string;
  productName: string;
  description: string | null;
  width: number;
  height: number;
  quantity: number;
  notes: string | null;
};

type QuoteDraftPreviewSkippedLineItem = {
  index: number;
  sourceLineItemId: string | null;
  productName: string | null;
  reason: string;
  detail: string;
};

type QuoteDraftPreview = {
  eligible: boolean;
  blockingReasons: string[];
  alreadyConverted: boolean;
  latestSnapshot: {
    id: string | null;
    snapshotVersion: number | null;
    snapshotType: string | null;
    snapshotKind: string | null;
    createdAt: string | null;
  };
  customer: {
    matchedCustomerId: string | null;
    customerName: string | null;
    source: string;
  };
  contact: {
    matchedContactId: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    source: string;
  };
  desiredOutputType: string | null;
  orderNotes: string | null;
  label: string | null;
  lineItemsToConvert: QuoteDraftPreviewLineItem[];
  skippedLineItems: QuoteDraftPreviewSkippedLineItem[];
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

type QuoteDraftPreviewResponse = {
  success: boolean;
  data: QuoteDraftPreview;
};

type ReviewAction = "mark-reviewed" | "needs-clarification" | "reject" | "reopen";

type ReviewLineItemDraft = {
  id: string;
  sourceLineItemId: string | null;
  productName: string;
  description: string;
  quantity: string;
  width: string;
  height: string;
  notes: string;
};

type ReviewDraftFormValues = {
  customerName: string;
  customerText: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactText: string;
  desiredOutputType: string;
  orderNotes: string;
  lineItemDrafts: ReviewLineItemDraft[];
  staffNotes: string;
};

type ManualIntakeFormValues = {
  sourceLabel: string;
  externalReference: string;
  customerText: string;
  contactText: string;
  sourceText: string;
  desiredOutputType: string;
};

const statusLabels: Record<InboundOrderRecordStatus, string> = {
  received: "Received",
  processing: "Processing",
  needs_review: "Needs Review",
  waiting_on_customer: "Waiting",
  ready: "Ready",
  approved: "Approved",
  submitted: "Submitted",
  failed: "Failed",
  terminal: "Terminal",
};

const defaultQueueFilters: QueueFilters = {
  statusGroup: "all",
  sourceType: "all",
  hasWarnings: false,
  unconvertedOnly: false,
  search: "",
};

const sourceTypeOptions = [
  { value: "all", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "email", label: "Email" },
  { value: "customer_api", label: "API" },
  { value: "webhook", label: "Webhook" },
  { value: "csv_import", label: "CSV" },
  { value: "portal", label: "Portal" },
];

function buildInboundOrderListUrl(filters: QueueFilters) {
  const params = new URLSearchParams();
  params.set("limit", "50");
  params.set("offset", "0");

  if (filters.statusGroup !== "all") params.set("statusGroup", filters.statusGroup);
  if (filters.sourceType !== "all") params.set("sourceType", filters.sourceType);
  if (filters.hasWarnings) params.set("hasWarnings", "true");
  if (filters.unconvertedOnly) params.set("converted", "false");
  if (filters.search.trim()) params.set("search", filters.search.trim());

  return `/api/inbound-orders?${params.toString()}`;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "Request failed";
    throw new Error(message);
  }

  return json as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "Request failed";
    throw new Error(message);
  }

  return json as T;
}

function getReviewActionEndpoint(recordId: string, action: ReviewAction) {
  return `/api/inbound-orders/${recordId}/${action}`;
}

function getQuoteDisplay(quote: CreatedQuoteSummary | null | undefined) {
  if (!quote) return null;
  return quote.quoteNumber ? `Quote #${quote.quoteNumber}` : `Quote ${quote.id.slice(0, 8)}`;
}

function getLinkedQuoteDisplay(quote: InboundLinkedQuoteSummary | null | undefined) {
  if (!quote) return null;
  return quote.quoteNumber ? `Quote #${quote.quoteNumber}` : `Quote ${quote.id.slice(0, 8)}`;
}

function getQuoteActivityLabel(activity: InboundQuoteActivity | null | undefined, quote: InboundLinkedQuoteSummary | null | undefined) {
  if (!activity || activity.syncStatus === "quote_missing") return "No Quote";
  if (activity.syncStatus === "quote_deleted_or_inaccessible") return "Quote Deleted/Missing";
  if (quote?.status === "draft") return "Quote Draft";
  if (quote?.status === "pending_approval" || quote?.status === "pending" || quote?.status === "active") return "Quote Approved";
  if (activity.syncStatus === "quote_status_changed") return "Quote Updated";
  return "Quote Exists";
}

function getQuoteCreatedEvent(events: InboundOrderEvent[], quoteId: string | null | undefined) {
  if (!quoteId) return null;
  return events.find((event) => (
    event.eventType === "review.quote_created"
    && stringFromUnknown(getPathValue(event.metadataJson, "quoteId")) === quoteId
  )) ?? null;
}

function numberFromUnknown(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getSkippedLineItemsFromEvent(event: InboundOrderEvent | null) {
  const direct = getPathValue(event?.metadataJson, "skippedLineItems");
  const nested = getPathValue(event?.metadataJson, "conversionMetadata.skippedLineItems");
  const value = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function getSkippedItemLabel(item: Record<string, unknown>, index: number) {
  return stringFromUnknown(item.productName) || `Draft row ${numberFromUnknown(item.index) || index + 1}`;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatTrustLevel(value: string | null | undefined) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "-";
}

function formatPercent(value: string | null | undefined) {
  if (!value) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${Math.round(numeric * 100)}%`;
}

function formatDimension(lineItem: InboundOrderLineItem) {
  if (!lineItem.width && !lineItem.height) return "-";
  return `${lineItem.width ?? "?"} x ${lineItem.height ?? "?"}`;
}

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function stringifyJson(value: unknown) {
  if (value == null) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getRecordTitle(record: InboundOrderRecord) {
  return record.externalReference || record.sourceLabel || `Inbound ${record.id.slice(0, 8)}`;
}

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildManualIntakePayload(values: ManualIntakeFormValues) {
  const sourceLabel = trimToNull(values.sourceLabel);
  const externalReference = trimToNull(values.externalReference);
  const customerText = trimToNull(values.customerText);
  const contactText = trimToNull(values.contactText);
  const sourceText = trimToNull(values.sourceText);
  const desiredOutputType = trimToNull(values.desiredOutputType);

  return {
    sourceLabel,
    externalReference,
    rawPayloadJson: {
      intakeMode: "manual_internal",
      sourceText,
      customerText,
      contactText,
      desiredOutputType,
    },
    normalizedPayloadJson: {
      source: {
        label: sourceLabel,
        type: "manual",
      },
      customer: {
        rawText: customerText,
      },
      contact: {
        rawText: contactText,
      },
      order: {
        externalReference,
        notes: sourceText,
        desiredOutputType,
      },
    },
    extractedCustomerJson: {
      rawCustomerText: customerText,
      rawContactText: contactText,
    },
    extractedOrderJson: {
      externalReference,
      notes: sourceText,
      desiredOutputType,
    },
  };
}

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

function getStringFromPaths(source: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getSourceText(record: InboundOrderRecord) {
  return getStringFromPaths(record.rawPayloadJson, [
    "sourceText",
    "body",
    "message",
    "text",
    "notes",
  ]) || getStringFromPaths(record.normalizedPayloadJson, [
    "order.notes",
    "source.text",
  ]);
}

function getDesiredOutputType(record: InboundOrderRecord) {
  return getStringFromPaths(record.normalizedPayloadJson, [
    "order.desiredOutputType",
    "desiredOutputType",
  ]) || getStringFromPaths(record.extractedOrderJson, [
    "desiredOutputType",
    "outputType",
  ]);
}

function getOrderNotes(record: InboundOrderRecord) {
  return getStringFromPaths(record.extractedOrderJson, [
    "notes",
    "orderNotes",
  ]) || getStringFromPaths(record.normalizedPayloadJson, [
    "order.notes",
    "notes",
  ]) || getSourceText(record) || "";
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function createEmptyLineItemDraft(): ReviewLineItemDraft {
  return {
    id: crypto.randomUUID(),
    sourceLineItemId: null,
    productName: "",
    description: "",
    quantity: "",
    width: "",
    height: "",
    notes: "",
  };
}

function buildReviewDraftFromDetail(detail: InboundOrderDetailResponse["data"]): ReviewDraftFormValues {
  const snapshotPayload = detail.latestReviewSnapshot?.payloadJson;
  const snapshotKind = getPathValue(snapshotPayload, "metadata.snapshotKind");

  if (snapshotKind === "staff_review_draft") {
    const lineItemDraftsValue = getPathValue(snapshotPayload, "lineItemDrafts");
    const lineItemDrafts = Array.isArray(lineItemDraftsValue)
      ? lineItemDraftsValue.map((item) => {
        const row = asRecord(item) ?? {};
        return {
          id: stringFromUnknown(row.id) || crypto.randomUUID(),
          sourceLineItemId: stringFromUnknown(row.sourceLineItemId) || null,
          productName: stringFromUnknown(row.productName),
          description: stringFromUnknown(row.description),
          quantity: stringFromUnknown(row.quantity),
          width: stringFromUnknown(row.width),
          height: stringFromUnknown(row.height),
          notes: stringFromUnknown(row.notes),
        };
      })
      : [];

    return {
      customerName: stringFromUnknown(getPathValue(snapshotPayload, "customerDraft.name")),
      customerText: stringFromUnknown(getPathValue(snapshotPayload, "customerDraft.text")),
      contactName: stringFromUnknown(getPathValue(snapshotPayload, "contactDraft.name")),
      contactEmail: stringFromUnknown(getPathValue(snapshotPayload, "contactDraft.email")),
      contactPhone: stringFromUnknown(getPathValue(snapshotPayload, "contactDraft.phone")),
      contactText: stringFromUnknown(getPathValue(snapshotPayload, "contactDraft.text")),
      desiredOutputType: stringFromUnknown(getPathValue(snapshotPayload, "desiredOutputType")),
      orderNotes: stringFromUnknown(getPathValue(snapshotPayload, "orderNotes")),
      lineItemDrafts,
      staffNotes: stringFromUnknown(getPathValue(snapshotPayload, "staffNotes")),
    };
  }

  const record = detail.record;
  const extractedCustomer = record.extractedCustomerJson ?? {};
  const normalizedCustomer = getPathValue(record.normalizedPayloadJson, "customer");
  const normalizedContact = getPathValue(record.normalizedPayloadJson, "contact");

  return {
    customerName: getStringFromPaths(extractedCustomer, ["name", "customerName"])
      || getStringFromPaths(normalizedCustomer, ["name", "customerName"])
      || "",
    customerText: getStringFromPaths(extractedCustomer, ["rawCustomerText", "text", "rawText"])
      || getStringFromPaths(normalizedCustomer, ["rawText", "text"])
      || "",
    contactName: getStringFromPaths(normalizedContact, ["name", "contactName"])
      || getStringFromPaths(extractedCustomer, ["contact.name", "contactName"])
      || "",
    contactEmail: getStringFromPaths(normalizedContact, ["email"])
      || getStringFromPaths(extractedCustomer, ["contact.email", "email"])
      || "",
    contactPhone: getStringFromPaths(normalizedContact, ["phone"])
      || getStringFromPaths(extractedCustomer, ["contact.phone", "phone"])
      || "",
    contactText: getStringFromPaths(extractedCustomer, ["rawContactText", "contact.rawText", "contactText"])
      || getStringFromPaths(normalizedContact, ["rawText", "text"])
      || "",
    desiredOutputType: getDesiredOutputType(record) || "",
    orderNotes: getOrderNotes(record),
    lineItemDrafts: detail.lineItems.map((lineItem) => ({
      id: crypto.randomUUID(),
      sourceLineItemId: lineItem.id,
      productName: lineItem.productNameRaw || "",
      description: lineItem.description || "",
      quantity: lineItem.quantity == null ? "" : String(lineItem.quantity),
      width: lineItem.width ?? "",
      height: lineItem.height ?? "",
      notes: stringFromUnknown(getPathValue(lineItem.normalizedLineJson, "notes")),
    })),
    staffNotes: "",
  };
}

function buildReviewSnapshotPayload(values: ReviewDraftFormValues) {
  return {
    customerDraft: {
      name: trimToNull(values.customerName),
      text: trimToNull(values.customerText),
    },
    contactDraft: {
      name: trimToNull(values.contactName),
      email: trimToNull(values.contactEmail),
      phone: trimToNull(values.contactPhone),
      text: trimToNull(values.contactText),
    },
    desiredOutputType: trimToNull(values.desiredOutputType),
    orderNotes: trimToNull(values.orderNotes),
    lineItemDrafts: values.lineItemDrafts.map((lineItem, index) => ({
      ...lineItem,
      sortOrder: index,
      productName: trimToNull(lineItem.productName),
      description: trimToNull(lineItem.description),
      quantity: trimToNull(lineItem.quantity),
      width: trimToNull(lineItem.width),
      height: trimToNull(lineItem.height),
      notes: trimToNull(lineItem.notes),
    })),
    staffNotes: trimToNull(values.staffNotes),
    metadata: {
      snapshotKind: "staff_review_draft",
      editor: "staff",
    },
  };
}

function getErrorTone(error: Error | null) {
  if (!error) return null;
  const message = error.message.toLowerCase();
  if (
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("inbound_order")
  ) {
    return "Schema tables are not available yet. This shell is ready for the future migration chunk.";
  }
  return error.message;
}

function QueueSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border bg-card p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-3 h-3 w-1/2" />
          <Skeleton className="mt-4 h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: InboundOrderRecordStatus }) {
  const variant =
    status === "failed" || status === "terminal"
      ? "destructive"
      : status === "ready" || status === "approved" || status === "submitted"
        ? "default"
        : "secondary";

  return <Badge variant={variant}>{statusLabels[status] ?? status}</Badge>;
}

function EmptyPanel({ icon: Icon, title, detail }: {
  icon: typeof Inbox;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mt-4 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="min-h-[240px] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
      {stringifyJson(value)}
    </pre>
  );
}

function CompactJsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
      {stringifyJson(value)}
    </pre>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium text-foreground">{value || "-"}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon?: typeof Inbox;
  title: string;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {typeof count === "number" && <Badge variant="outline">{count}</Badge>}
    </div>
  );
}

function getAllowedReviewActions(record: InboundOrderRecord) {
  const status = record.status;

  if (status === "approved" || status === "submitted") {
    return [] as ReviewAction[];
  }

  if (status === "terminal" || status === "ready") {
    return ["reopen"] as ReviewAction[];
  }

  if (status === "waiting_on_customer") {
    return ["mark-reviewed", "reject", "reopen"] as ReviewAction[];
  }

  return ["mark-reviewed", "needs-clarification", "reject"] as ReviewAction[];
}

function ReviewActionBar({
  record,
  isPending,
  error,
  onAction,
}: {
  record: InboundOrderRecord;
  isPending: boolean;
  error: Error | null;
  onAction: (action: ReviewAction) => void;
}) {
  const allowedActions = getAllowedReviewActions(record);

  if (allowedActions.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        This record has moved beyond review actions.
      </div>
    );
  }

  const can = (action: ReviewAction) => allowedActions.includes(action);

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Human review actions. These do not create quotes or orders.
      </div>
      <div className="flex flex-wrap gap-2">
        {can("mark-reviewed") && (
          <Button type="button" size="sm" onClick={() => onAction("mark-reviewed")} disabled={isPending}>
            Mark Reviewed
          </Button>
        )}
        {can("needs-clarification") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAction("needs-clarification")}
            disabled={isPending}
          >
            Needs Clarification
          </Button>
        )}
        {can("reject") && (
          <Button type="button" size="sm" variant="destructive" onClick={() => onAction("reject")} disabled={isPending}>
            Reject
          </Button>
        )}
        {can("reopen") && (
          <Button type="button" size="sm" variant="outline" onClick={() => onAction("reopen")} disabled={isPending}>
            Reopen
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error.message}
        </div>
      )}
    </div>
  );
}

function ManualIntakePanel({
  disabled,
  isCreating,
  error,
  onCreate,
}: {
  disabled: boolean;
  isCreating: boolean;
  error: Error | null;
  onCreate: (values: ManualIntakeFormValues) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [values, setValues] = useState<ManualIntakeFormValues>({
    sourceLabel: "",
    externalReference: "",
    customerText: "",
    contactText: "",
    sourceText: "",
    desiredOutputType: "",
  });

  const updateField = (field: keyof ManualIntakeFormValues, value: string) => {
    setLocalError(null);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const resetForm = () => {
    setValues({
      sourceLabel: "",
      externalReference: "",
      customerText: "",
      contactText: "",
      sourceText: "",
      desiredOutputType: "",
    });
  };

  const hasMinimumContent = Boolean(
    trimToNull(values.externalReference) ||
    trimToNull(values.customerText) ||
    trimToNull(values.contactText) ||
    trimToNull(values.sourceText) ||
    trimToNull(values.desiredOutputType),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (!hasMinimumContent) {
      setLocalError("Add source text, customer text, output type, or an external reference.");
      return;
    }

    try {
      await onCreate(values);
      resetForm();
      setIsOpen(false);
    } catch (createError) {
      setLocalError(createError instanceof Error ? createError.message : "Failed to create inbound record.");
    }
  };

  return (
    <div className="border-b border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Manual Intake</div>
          <div className="text-xs text-muted-foreground">Create a staff-entered inbound record.</div>
        </div>
        <Button
          type="button"
          variant={isOpen ? "secondary" : "outline"}
          size="sm"
          onClick={() => setIsOpen((current) => !current)}
          disabled={disabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </div>

      {disabled && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Manual intake is unavailable until the inbound queue endpoint is available.
        </div>
      )}

      {isOpen && !disabled && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Source label</span>
              <Input
                value={values.sourceLabel}
                onChange={(event) => updateField("sourceLabel", event.target.value)}
                placeholder="Walk-in request, phone order, counter note"
                maxLength={255}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">External reference</span>
              <Input
                value={values.externalReference}
                onChange={(event) => updateField("externalReference", event.target.value)}
                placeholder="PO, customer ref, job name"
                maxLength={255}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Customer text</span>
              <Input
                value={values.customerText}
                onChange={(event) => updateField("customerText", event.target.value)}
                placeholder="Customer or company name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Contact text</span>
              <Input
                value={values.contactText}
                onChange={(event) => updateField("contactText", event.target.value)}
                placeholder="Contact name, email, or phone"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Desired output type</span>
              <Input
                value={values.desiredOutputType}
                onChange={(event) => updateField("desiredOutputType", event.target.value)}
                placeholder="Banner, decals, signs, apparel"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Order notes/source text</span>
              <Textarea
                value={values.sourceText}
                onChange={(event) => updateField("sourceText", event.target.value)}
                placeholder="Paste or summarize the inbound request"
                rows={4}
              />
            </label>
          </div>

          {(localError || error) && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {localError || error?.message}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function InboundQueuePanel({
  records,
  selectedId,
  onSelect,
}: {
  records: InboundOrderRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (records.length === 0) {
    return (
      <EmptyPanel
        icon={Inbox}
        title="No inbound records"
        detail="The queue is empty, or the inbound tables have not been migrated yet."
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {records.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => onSelect(record.id)}
            className={cn(
              "w-full rounded-md border p-3 text-left transition-colors",
              selectedId === record.id
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/50",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {getRecordTitle(record)}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {record.sourceLabel || formatTrustLevel(record.sourceTrustLevel)}
                </div>
              </div>
              <StatusBadge status={record.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Trust</div>
                <div className="truncate font-medium text-foreground">
                  {formatTrustLevel(record.sourceTrustLevel)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Score</div>
                <div className="font-medium text-foreground">{formatPercent(record.confidenceScore)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Received</div>
                <div className="truncate font-medium text-foreground">{formatRelative(record.receivedAt)}</div>
              </div>
            </div>
            {record.requiresHumanDecision && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-2">{record.reviewRequiredReason || "Human review required"}</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

function QueueTriageControls({
  filters,
  summary,
  isLoading,
  onChange,
}: {
  filters: QueueFilters;
  summary: InboundQueueSummary | null;
  isLoading: boolean;
  onChange: (filters: QueueFilters) => void;
}) {
  const setFilter = (patch: Partial<QueueFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const statusButtons: Array<{ value: QueueStatusGroup; label: string; count: number }> = [
    { value: "needs_review", label: "Needs Review", count: summary?.needsReview ?? 0 },
    { value: "waiting", label: "Waiting", count: summary?.waitingOnCustomer ?? 0 },
    { value: "ready", label: "Ready", count: summary?.readyReviewed ?? 0 },
    { value: "converted", label: "Converted", count: summary?.convertedSubmitted ?? 0 },
    { value: "rejected", label: "Rejected", count: summary?.rejectedTerminal ?? 0 },
  ];

  return (
    <div className="border-b border-border p-3">
      <div className="space-y-2">
        <Input
          value={filters.search}
          onChange={(event) => setFilter({ search: event.target.value })}
          placeholder="Search reference, customer, notes"
          disabled={isLoading}
        />

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={filters.statusGroup === "all" ? "default" : "outline"}
            onClick={() => setFilter({ statusGroup: "all" })}
          >
            All
          </Button>
          {statusButtons.map((button) => (
            <Button
              key={button.value}
              type="button"
              size="sm"
              variant={filters.statusGroup === button.value ? "default" : "outline"}
              onClick={() => setFilter({ statusGroup: button.value })}
            >
              {button.label}
              <Badge variant="secondary" className="ml-2">{button.count}</Badge>
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={filters.sourceType}
            onChange={(event) => setFilter({ sourceType: event.target.value })}
            disabled={isLoading}
          >
            {sourceTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <label className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={filters.hasWarnings}
              onChange={(event) => setFilter({ hasWarnings: event.target.checked })}
              disabled={isLoading}
            />
            Warnings
            <Badge variant="secondary">{summary?.withWarnings ?? 0}</Badge>
          </label>
          <label className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={filters.unconvertedOnly}
              onChange={(event) => setFilter({ unconvertedOnly: event.target.checked })}
              disabled={isLoading}
            />
            Unconverted
          </label>
        </div>
      </div>
    </div>
  );
}

function SourceEvidencePanel({
  detail,
  selectedRecord,
  isLoading,
}: {
  detail: InboundOrderDetailResponse["data"] | undefined;
  selectedRecord: InboundOrderRecord | null;
  isLoading: boolean;
}) {
  if (!selectedRecord) {
    return (
      <EmptyPanel
        icon={FileText}
        title="Select a record"
        detail="Source evidence will appear here once an inbound item is selected."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const record = detail?.record ?? selectedRecord;
  const source = detail?.source ?? null;
  const sourceText = getSourceText(record);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {record.sourceLabel || source?.name || "Inbound source"}
              </h2>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatTrustLevel(record.sourceTrustLevel)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">{record.sourceType}</Badge>
              <StatusBadge status={record.status} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <DetailField label="External reference" value={record.externalReference} />
            <DetailField label="Source status" value={source?.status ?? null} />
            <DetailField label="Received" value={formatRelative(record.receivedAt)} />
            <DetailField label="Created" value={formatRelative(record.createdAt)} />
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={FileText} title="Raw Source Text" />
          {sourceText ? (
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
              {sourceText}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No source text was captured for this record.</div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader title="Raw Payload JSON" />
          <CompactJsonBlock value={record.rawPayloadJson} />
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader title="Normalized Payload JSON" />
          <CompactJsonBlock value={record.normalizedPayloadJson} />
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader title="Extracted Customer" />
          <CompactJsonBlock value={record.extractedCustomerJson ?? {}} />
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader title="Extracted Order" />
          <CompactJsonBlock value={record.extractedOrderJson ?? {}} />
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader title="Extracted Shipping" />
          <CompactJsonBlock value={record.extractedShippingJson ?? {}} />
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={FileText} title="Files" count={detail?.files.length ?? 0} />
          <div className="space-y-2">
            {(detail?.files ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No files linked.</div>
            ) : (
              detail?.files.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {file.sourceFilename || file.id}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {file.role} / {file.mimeType || "unknown"} / {formatBytes(file.sizeBytes)}
                    </div>
                  </div>
                  <Badge variant="secondary">{file.status}</Badge>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={Clock} title="Event Timeline" count={detail?.events.length ?? 0} />
          <div className="space-y-3">
            {(detail?.events ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No events recorded.</div>
            ) : (
              detail?.events.map((event) => (
                <div key={event.id} className="border-l border-border pl-3">
                  <div className="text-sm font-medium text-foreground">{event.eventType}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.message || event.actorType} / {formatRelative(event.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function DraftBuilderPanel({
  detail,
  selectedRecord,
  isLoading,
  isActionPending,
  actionError,
  isSnapshotSaving,
  snapshotError,
  isQuoteCreating,
  quoteCreateError,
  createdQuote,
  quoteDraftPreview,
  isQuotePreviewLoading,
  quotePreviewError,
  products,
  isProductsLoading,
  isLineItemMatching,
  isCustomerMatching,
  isReviewResolutionPending,
  reviewResolutionError,
  onReviewAction,
  onSaveSnapshot,
  onCreateQuoteDraft,
  onMatchCustomer,
  onMatchLineItemProduct,
  onResolveWarning,
  onResolveDecisionFlag,
}: {
  detail: InboundOrderDetailResponse["data"] | undefined;
  selectedRecord: InboundOrderRecord | null;
  isLoading: boolean;
  isActionPending: boolean;
  actionError: Error | null;
  isSnapshotSaving: boolean;
  snapshotError: Error | null;
  isQuoteCreating: boolean;
  quoteCreateError: Error | null;
  createdQuote: CreatedQuoteSummary | null;
  quoteDraftPreview: QuoteDraftPreview | null;
  isQuotePreviewLoading: boolean;
  quotePreviewError: Error | null;
  products: ProductOption[];
  isProductsLoading: boolean;
  isLineItemMatching: boolean;
  isCustomerMatching: boolean;
  isReviewResolutionPending: boolean;
  reviewResolutionError: Error | null;
  onReviewAction: (action: ReviewAction) => void;
  onSaveSnapshot: (payload: ReturnType<typeof buildReviewSnapshotPayload>) => Promise<void>;
  onCreateQuoteDraft: () => void;
  onMatchCustomer: (customerId: string, contactId?: string | null) => void;
  onMatchLineItemProduct: (lineItemId: string, productId: string, staffNote?: string | null) => void;
  onResolveWarning: (warningId: string, status: "resolved" | "ignored", note?: string | null) => void;
  onResolveDecisionFlag: (flagId: string, status: "accepted" | "overridden" | "dismissed", note?: string | null) => void;
}) {
  const [draftValues, setDraftValues] = useState<ReviewDraftFormValues | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [selectedCustomerMatchId, setSelectedCustomerMatchId] = useState("");
  const [selectedContactMatchId, setSelectedContactMatchId] = useState("");

  useEffect(() => {
    if (!detail) {
      setDraftValues(null);
      setSavedMessage(null);
      return;
    }

    setDraftValues(buildReviewDraftFromDetail(detail));
    setSavedMessage(null);
    setSelectedCustomerMatchId(detail.record.matchedCustomerId ?? "");
    setSelectedContactMatchId(detail.record.matchedContactId ?? "");
  }, [detail?.record.id, detail?.latestReviewSnapshot?.id]);

  const customerMatchQuery = useQuery({
    queryKey: ["/api/inbound-orders/customer-search", customerSearch],
    queryFn: () => readJson<CustomerSearchResponse>(
      `/api/inbound-orders/customer-search?${new URLSearchParams({
        search: customerSearch,
        limit: "25",
      }).toString()}`,
    ),
  });

  const contactMatchQuery = useQuery({
    queryKey: ["/api/inbound-orders/contact-search", selectedCustomerMatchId, contactSearch],
    queryFn: () => readJson<ContactSearchResponse>(
      `/api/inbound-orders/contact-search?${new URLSearchParams({
        customerId: selectedCustomerMatchId,
        search: contactSearch,
        limit: "25",
      }).toString()}`,
    ),
    enabled: Boolean(selectedCustomerMatchId),
  });

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products.slice(0, 80);
    return products
      .filter((product) => (
        product.name.toLowerCase().includes(query)
        || product.category?.toLowerCase().includes(query)
      ))
      .slice(0, 80);
  }, [products, productSearch]);

  if (!selectedRecord) {
    return (
      <EmptyPanel
        icon={Sparkles}
        title="Draft builder"
        detail="TitanOS draft fields will appear here for the selected inbound record."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const record = detail?.record ?? selectedRecord;
  const hasSnapshot = Boolean(detail?.latestReviewSnapshot);
  const warnings = detail?.warnings ?? [];
  const decisionFlags = detail?.decisionFlags ?? [];
  const lineItems = detail?.lineItems ?? [];
  const files = detail?.files ?? [];
  const events = detail?.events ?? [];
  const desiredOutputType = getDesiredOutputType(record);
  const currentDraft = draftValues ?? (detail ? buildReviewDraftFromDetail(detail) : null);
  const linkedQuote = detail?.linkedQuote ?? null;
  const quoteActivity = detail?.quoteActivity ?? null;
  const convertedQuoteId = record.createdQuoteId ?? createdQuote?.id ?? null;
  const isConverted = Boolean(record.createdQuoteId);
  const quoteCreatedEvent = getQuoteCreatedEvent(events, convertedQuoteId);
  const quoteCreatedMetadata = asRecord(quoteCreatedEvent?.metadataJson) ?? {};
  const conversionMetadata = asRecord(getPathValue(quoteCreatedMetadata, "conversionMetadata")) ?? {};
  const eventSkippedLineItems = getSkippedLineItemsFromEvent(quoteCreatedEvent);
  const eventConvertedLineItemCount = numberFromUnknown(
    quoteCreatedMetadata.convertedLineItemCount ?? conversionMetadata.convertedLineItemCount,
  );
  const eventSkippedLineItemCount = numberFromUnknown(
    quoteCreatedMetadata.skippedLineItemCount ?? conversionMetadata.skippedLineItemCount,
  );
  const canCreateQuoteDraft = Boolean(quoteDraftPreview?.eligible) && !record.createdQuoteId;
  const displayedQuote = createdQuote && createdQuote.id === convertedQuoteId
    ? createdQuote
    : linkedQuote
      ? {
        id: linkedQuote.id,
        quoteNumber: linkedQuote.quoteNumber,
        reference: linkedQuote.reference,
        status: linkedQuote.status,
        customerId: linkedQuote.customerId,
        contactId: linkedQuote.contactId,
        customerName: linkedQuote.customerName,
        contactName: detail?.matchedContact?.name ?? null,
        totalPrice: "0",
        createdAt: linkedQuote.createdAt,
        lineItemsCreated: eventConvertedLineItemCount,
        convertedLineItemCount: eventConvertedLineItemCount,
        skippedLineItemCount: eventSkippedLineItemCount,
        skippedLineItems: eventSkippedLineItems,
      }
    : convertedQuoteId
      ? {
        id: convertedQuoteId,
        quoteNumber: null,
        reference: convertedQuoteId.slice(0, 8),
        status: "draft",
        customerId: record.matchedCustomerId ?? null,
        contactId: record.matchedContactId ?? null,
        customerName: null,
        contactName: detail?.matchedContact?.name ?? null,
        totalPrice: "0",
        createdAt: record.submittedAt ?? record.updatedAt,
        lineItemsCreated: eventConvertedLineItemCount,
        convertedLineItemCount: eventConvertedLineItemCount,
        skippedLineItemCount: eventSkippedLineItemCount,
        skippedLineItems: eventSkippedLineItems,
      }
      : null;

  const updateDraftField = (field: keyof ReviewDraftFormValues, value: string) => {
    setSavedMessage(null);
    setDraftValues((current) => current ? { ...current, [field]: value } : current);
  };

  const updateLineItemDraft = (id: string, field: keyof ReviewLineItemDraft, value: string) => {
    setSavedMessage(null);
    setDraftValues((current) => current
      ? {
        ...current,
        lineItemDrafts: current.lineItemDrafts.map((lineItem) => (
          lineItem.id === id ? { ...lineItem, [field]: value } : lineItem
        )),
      }
      : current);
  };

  const addLineItemDraft = () => {
    setSavedMessage(null);
    setDraftValues((current) => current
      ? { ...current, lineItemDrafts: [...current.lineItemDrafts, createEmptyLineItemDraft()] }
      : current);
  };

  const removeLineItemDraft = (id: string) => {
    setSavedMessage(null);
    setDraftValues((current) => current
      ? { ...current, lineItemDrafts: current.lineItemDrafts.filter((lineItem) => lineItem.id !== id) }
      : current);
  };

  const resetDraft = () => {
    if (!detail) return;
    setDraftValues(buildReviewDraftFromDetail({
      ...detail,
      latestReviewSnapshot: null,
    }));
    setSavedMessage(null);
  };

  const saveDraft = async () => {
    if (!currentDraft) return;
    if (isConverted) return;
    await onSaveSnapshot(buildReviewSnapshotPayload(currentDraft));
    setSavedMessage("Draft snapshot saved.");
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Record Summary</h2>
            <StatusBadge status={record.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Reference</div>
              <div className="truncate font-medium text-foreground">{record.externalReference || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Confidence</div>
              <div className="font-medium text-foreground">{formatPercent(record.confidenceScore)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duplicate</div>
              <div className="font-medium text-foreground">{formatPercent(record.duplicateScore)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Trust</div>
              <div className="truncate font-medium text-foreground">{formatTrustLevel(record.sourceTrustLevel)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground">Desired output</div>
              <div className="truncate font-medium text-foreground">{desiredOutputType || "-"}</div>
            </div>
          </div>
          {record.requiresHumanDecision && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{record.reviewRequiredReason || "Human review required before this can move forward."}</span>
            </div>
          )}
        </section>

        <ReviewActionBar
          record={record}
          isPending={isActionPending}
          error={actionError}
          onAction={onReviewAction}
        />

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionHeader title="Customer Match" />
              <div className="text-xs text-muted-foreground">
                Extracted text stays here; matching links the future quote to an existing TitanOS customer.
              </div>
            </div>
            <Badge variant={record.matchedCustomerId ? "secondary" : "outline"}>
              {record.matchedCustomerId ? "Existing Customer" : "Manual Text"}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 text-sm">
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">Extracted customer/contact</div>
              <div className="mt-1 text-foreground">
                {currentDraft?.customerName || currentDraft?.customerText || "No extracted customer text."}
              </div>
              {(currentDraft?.contactName || currentDraft?.contactEmail || currentDraft?.contactPhone || currentDraft?.contactText) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {[currentDraft.contactName, currentDraft.contactEmail, currentDraft.contactPhone].filter(Boolean).join(" / ")
                    || currentDraft.contactText}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Matched TitanOS customer</div>
                  <div className="font-medium text-foreground">
                    {detail?.matchedCustomer?.companyName || "No customer matched"}
                  </div>
                  {detail?.matchedContact && (
                    <div className="text-xs text-muted-foreground">
                      Contact: {detail.matchedContact.name}
                      {detail.matchedContact.email ? ` / ${detail.matchedContact.email}` : ""}
                    </div>
                  )}
                </div>
                {record.matchedCustomerId && (
                  <Button asChild size="sm" variant="outline">
                    <a href={ROUTES.customers.detail(record.matchedCustomerId)}>Open Customer</a>
                  </Button>
                )}
              </div>

              {!isConverted && (
                <div className="mt-3 space-y-2">
                  <Input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Search customers by name, email, phone"
                  />
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    value={selectedCustomerMatchId}
                    onChange={(event) => {
                      setSelectedCustomerMatchId(event.target.value);
                      setSelectedContactMatchId("");
                    }}
                    disabled={customerMatchQuery.isLoading}
                  >
                    <option value="">Select existing customer...</option>
                    {(customerMatchQuery.data?.data ?? []).map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.companyName}{customer.email ? ` / ${customer.email}` : ""}
                      </option>
                    ))}
                  </select>

                  {selectedCustomerMatchId && (
                    <>
                      <Input
                        value={contactSearch}
                        onChange={(event) => setContactSearch(event.target.value)}
                        placeholder="Search contacts for selected customer"
                      />
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={selectedContactMatchId}
                        onChange={(event) => setSelectedContactMatchId(event.target.value)}
                        disabled={contactMatchQuery.isLoading}
                      >
                        <option value="">No contact / choose later</option>
                        {(contactMatchQuery.data?.data ?? []).map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}{contact.email ? ` / ${contact.email}` : ""}{contact.isPrimary ? " / Primary" : ""}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onMatchCustomer(selectedCustomerMatchId, selectedContactMatchId || null)}
                    disabled={!selectedCustomerMatchId || isCustomerMatching}
                  >
                    {isCustomerMatching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Match
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionHeader title="Linked Quote" />
              <div className="text-xs text-muted-foreground">
                Downstream quote visibility. Inbound review remains historical.
              </div>
            </div>
            <Badge variant={quoteActivity?.syncStatus === "quote_deleted_or_inaccessible" ? "destructive" : "secondary"}>
              {getQuoteActivityLabel(quoteActivity, linkedQuote)}
            </Badge>
          </div>

          {!record.createdQuoteId ? (
            <div className="mt-3 text-xs text-muted-foreground">
              No permanent quote has been created from this inbound review yet.
            </div>
          ) : linkedQuote ? (
            <div className="mt-3 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Quote</div>
                  <div className="font-medium text-foreground">{getLinkedQuoteDisplay(linkedQuote)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Current status</div>
                  <div className="font-medium text-foreground">{linkedQuote.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Created</div>
                  <div className="font-medium text-foreground">{formatRelative(linkedQuote.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last quote update</div>
                  <div className="font-medium text-foreground">{formatRelative(quoteActivity?.lastQuoteUpdatedAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Source snapshot</div>
                  <div className="font-medium text-foreground">
                    {stringFromUnknown(conversionMetadata.snapshotVersion)
                      ? `v${stringFromUnknown(conversionMetadata.snapshotVersion)}`
                      : stringFromUnknown(quoteCreatedMetadata.snapshotVersion)
                        ? `v${stringFromUnknown(quoteCreatedMetadata.snapshotVersion)}`
                        : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Inbound reference</div>
                  <div className="truncate font-medium text-foreground">
                    {stringFromUnknown(conversionMetadata.externalReference)
                      || stringFromUnknown(conversionMetadata.inboundRecordId)
                      || record.id.slice(0, 8)}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Customer</div>
                  <div className="font-medium text-foreground">{linkedQuote.customerName || "-"}</div>
                </div>
              </div>

              {quoteActivity?.divergedFromReviewSnapshot && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  <div className="font-medium">Linked quote differs from the reviewed conversion state.</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {quoteActivity.divergenceReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={ROUTES.quotes.detail(linkedQuote.id)}>Open Quote</a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => document.getElementById("inbound-review-history")?.scrollIntoView({ block: "start" })}
                >
                  Return to Inbound Review
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Linked quote {record.createdQuoteId.slice(0, 8)} is missing or inaccessible.
            </div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionHeader title="Quote Draft Conversion" />
              <div className="text-xs text-muted-foreground">
                Creates the first permanent business object from the staff-reviewed snapshot.
              </div>
            </div>
            {displayedQuote ? (
              <Button asChild size="sm" variant="outline">
                <a href={ROUTES.quotes.detail(displayedQuote.id)}>Open Quote</a>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={onCreateQuoteDraft}
                disabled={!canCreateQuoteDraft || isQuoteCreating}
              >
                {isQuoteCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Quote Draft
              </Button>
            )}
          </div>

          {displayedQuote ? (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              <div className="font-medium">Converted Quote: {getQuoteDisplay(displayedQuote)}</div>
              <div className="mt-1 text-xs">
                Status {displayedQuote.status} / {formatRelative(displayedQuote.createdAt)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="font-medium">Customer used</div>
                  <div>{displayedQuote.customerName || detail?.matchedCustomer?.companyName || "Manual inbound text"}</div>
                </div>
                <div>
                  <div className="font-medium">Contact used</div>
                  <div>{displayedQuote.contactName || detail?.matchedContact?.name || "-"}</div>
                </div>
                <div>
                  <div className="font-medium">Converted line items</div>
                  <div>{displayedQuote.convertedLineItemCount || displayedQuote.lineItemsCreated}</div>
                </div>
                <div>
                  <div className="font-medium">Skipped line items</div>
                  <div>{displayedQuote.skippedLineItemCount || displayedQuote.skippedLineItems.length}</div>
                </div>
              </div>
              {displayedQuote.skippedLineItems.length > 0 && (
                <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-950">
                  <div className="font-medium">Manual quote cleanup may be needed</div>
                  {displayedQuote.skippedLineItems.map((item, index) => (
                    <div key={`${stringFromUnknown(item.sourceLineItemId) || "skipped"}-${index}`}>
                      {getSkippedItemLabel(item, index)}: {stringFromUnknown(item.reason) || "skipped"}
                      {stringFromUnknown(item.detail) ? ` / ${stringFromUnknown(item.detail)}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 text-xs text-muted-foreground">
              Available when the preview confirms the reviewed snapshot can safely create a draft quote.
            </div>
          )}

          <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                Conversion Preview
              </div>
              {isQuotePreviewLoading ? (
                <Badge variant="outline">Loading</Badge>
              ) : quoteDraftPreview?.eligible ? (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Eligible</Badge>
              ) : (
                <Badge variant="secondary">Not eligible</Badge>
              )}
            </div>

            {quotePreviewError ? (
              <div className="mt-2 text-xs text-destructive">{quotePreviewError.message}</div>
            ) : quoteDraftPreview ? (
              <div className="mt-3 space-y-3 text-xs">
                {quoteDraftPreview.blockingReasons.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                    <div className="font-medium">Blocked before permanent quote creation</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {quoteDraftPreview.blockingReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-muted-foreground">Quote label</div>
                    <div className="font-medium text-foreground">{quoteDraftPreview.label || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Snapshot</div>
                    <div className="font-medium text-foreground">
                      {quoteDraftPreview.latestSnapshot.snapshotVersion
                        ? `v${quoteDraftPreview.latestSnapshot.snapshotVersion}`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Customer</div>
                    <div className="font-medium text-foreground">{quoteDraftPreview.customer.customerName || "-"}</div>
                    <div className="text-muted-foreground">{quoteDraftPreview.customer.source}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Contact</div>
                    <div className="font-medium text-foreground">
                      {quoteDraftPreview.contact.contactName || quoteDraftPreview.contact.email || "-"}
                    </div>
                    <div className="text-muted-foreground">{quoteDraftPreview.contact.source}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Creates {quoteDraftPreview.lineItemsToConvert.length} line items</Badge>
                  <Badge variant={quoteDraftPreview.skippedLineItems.length ? "secondary" : "outline"}>
                    Skips {quoteDraftPreview.skippedLineItems.length}
                  </Badge>
                  <Badge variant={quoteDraftPreview.warningsSummary.open ? "secondary" : "outline"}>
                    Open warnings {quoteDraftPreview.warningsSummary.open}
                  </Badge>
                  <Badge variant={quoteDraftPreview.decisionFlagsSummary.open ? "secondary" : "outline"}>
                    Open flags {quoteDraftPreview.decisionFlagsSummary.open}
                  </Badge>
                </div>

                <div>
                  <div className="mb-1 font-medium text-foreground">Line items to create</div>
                  {quoteDraftPreview.lineItemsToConvert.length === 0 ? (
                    <div className="text-muted-foreground">No line items will be created.</div>
                  ) : (
                    <div className="space-y-1">
                      {quoteDraftPreview.lineItemsToConvert.slice(0, 5).map((lineItem) => (
                        <div key={`${lineItem.sourceLineItemId}-${lineItem.index}`} className="rounded border border-border px-2 py-1">
                          <span className="font-medium text-foreground">{lineItem.productName}</span>
                          <span className="text-muted-foreground">
                            {" "} / {lineItem.quantity} @ {lineItem.width} x {lineItem.height}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {quoteDraftPreview.skippedLineItems.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-foreground">Skipped line items</div>
                    <div className="space-y-1">
                      {quoteDraftPreview.skippedLineItems.map((lineItem) => (
                        <div key={`${lineItem.sourceLineItemId ?? "draft"}-${lineItem.index}`} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">
                          <div className="font-medium">{lineItem.productName || `Draft row ${lineItem.index + 1}`}</div>
                          <div>{lineItem.reason}: {lineItem.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                Select a record to inspect quote conversion facts.
              </div>
            )}
          </div>

          {quoteCreateError && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {quoteCreateError.message}
            </div>
          )}
        </section>

        {currentDraft && (
          <section className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <SectionHeader icon={Sparkles} title="Staff Review Draft" />
                <div className="text-xs text-muted-foreground">
                  {isConverted
                    ? "Locked historical draft. The linked quote is now the operational business object."
                    : "Editable working draft. Source evidence remains unchanged."}
                </div>
                {detail?.latestReviewSnapshot && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last saved snapshot v{detail.latestReviewSnapshot.snapshotVersion} / {formatRelative(detail.latestReviewSnapshot.createdAt)}
                  </div>
                )}
                {!hasSnapshot && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Initialized from extracted/manual intake data.
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={resetDraft} disabled={isSnapshotSaving || isConverted}>
                  Reset From Source
                </Button>
                <Button type="button" size="sm" onClick={saveDraft} disabled={isSnapshotSaving || isConverted}>
                  {isSnapshotSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Draft Snapshot
                </Button>
              </div>
            </div>
            {isConverted && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Snapshot editing is disabled after quote conversion. Review history and source evidence stay available here.
              </div>
            )}
            {savedMessage && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                {savedMessage}
              </div>
            )}
            {snapshotError && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {snapshotError.message}
              </div>
            )}
            {reviewResolutionError && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {reviewResolutionError.message}
              </div>
            )}
          </section>
        )}

        {currentDraft && (
          <section className="rounded-md border border-border p-3">
            <SectionHeader title="Customer Draft" />
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Customer name/text</span>
                <Input
                  value={currentDraft.customerName}
                  onChange={(event) => updateDraftField("customerName", event.target.value)}
                  placeholder="Customer or company name"
                  disabled={isConverted}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Customer source text</span>
                <Textarea
                  value={currentDraft.customerText}
                  onChange={(event) => updateDraftField("customerText", event.target.value)}
                  rows={3}
                  placeholder="Raw customer notes"
                  disabled={isConverted}
                />
              </label>
            </div>
          </section>
        )}

        {currentDraft && (
          <section className="rounded-md border border-border p-3">
            <SectionHeader title="Contact Draft" />
            <div className="grid grid-cols-1 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Contact name</span>
                <Input
                  value={currentDraft.contactName}
                  onChange={(event) => updateDraftField("contactName", event.target.value)}
                  placeholder="Contact name"
                  disabled={isConverted}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Email</span>
                  <Input
                    value={currentDraft.contactEmail}
                    onChange={(event) => updateDraftField("contactEmail", event.target.value)}
                    placeholder="email@example.com"
                    disabled={isConverted}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Phone</span>
                  <Input
                    value={currentDraft.contactPhone}
                    onChange={(event) => updateDraftField("contactPhone", event.target.value)}
                    placeholder="Phone"
                    disabled={isConverted}
                  />
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Contact source text</span>
                <Textarea
                  value={currentDraft.contactText}
                  onChange={(event) => updateDraftField("contactText", event.target.value)}
                  rows={3}
                  placeholder="Raw contact notes"
                  disabled={isConverted}
                />
              </label>
            </div>
          </section>
        )}

        {currentDraft && (
          <section className="rounded-md border border-border p-3">
            <SectionHeader title="Order Draft" />
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Desired output type</span>
                <Input
                  value={currentDraft.desiredOutputType}
                  onChange={(event) => updateDraftField("desiredOutputType", event.target.value)}
                  placeholder={desiredOutputType || "Banner, decals, signs"}
                  disabled={isConverted}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Order notes</span>
                <Textarea
                  value={currentDraft.orderNotes}
                  onChange={(event) => updateDraftField("orderNotes", event.target.value)}
                  rows={5}
                  placeholder="Staff-reviewed order notes"
                  disabled={isConverted}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Staff review notes</span>
                <Textarea
                  value={currentDraft.staffNotes}
                  onChange={(event) => updateDraftField("staffNotes", event.target.value)}
                  rows={3}
                  placeholder="Internal notes for this reviewed draft"
                  disabled={isConverted}
                />
              </label>
            </div>
          </section>
        )}

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={ShieldCheck} title="Warnings" count={warnings.length} />
          <div className="space-y-2">
            {warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings.</div>
            ) : (
              warnings.map((warning) => (
                <div
                  key={warning.id}
                  className={cn(
                    "rounded-md px-3 py-2",
                    warning.status === "open" ? "bg-muted/40" : "border border-border bg-background opacity-75",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{warning.code}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={warning.severity === "blocking" && warning.status === "open" ? "destructive" : "secondary"}>
                        {warning.severity}
                      </Badge>
                      <Badge variant="outline">{warning.status}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{warning.message}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{warning.status}</span>
                    {warning.fieldPath && <span>{warning.fieldPath}</span>}
                    <span>{formatRelative(warning.createdAt)}</span>
                  </div>
                  {warning.status === "open" && !isConverted && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onResolveWarning(warning.id, "resolved")}
                        disabled={isReviewResolutionPending}
                      >
                        Mark Resolved
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onResolveWarning(warning.id, "ignored")}
                        disabled={isReviewResolutionPending}
                      >
                        Ignore
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={Flag} title="Decision Flags" count={decisionFlags.length} />
          <div className="space-y-2">
            {decisionFlags.length === 0 ? (
              <div className="text-sm text-muted-foreground">No decision flags.</div>
            ) : (
              decisionFlags.map((flag) => (
                <div
                  key={flag.id}
                  className={cn(
                    "rounded-md px-3 py-2",
                    flag.status === "open" ? "bg-muted/40" : "border border-border bg-background opacity-75",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{flag.flagType}</span>
                    <Badge variant="outline">{flag.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{flag.summary}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Confidence {formatPercent(flag.confidenceScore)}</span>
                    {flag.fieldPath && <span>{flag.fieldPath}</span>}
                    <span>{formatRelative(flag.createdAt)}</span>
                  </div>
                  {flag.status === "open" && !isConverted && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onResolveDecisionFlag(flag.id, "accepted")}
                        disabled={isReviewResolutionPending}
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onResolveDecisionFlag(flag.id, "overridden")}
                        disabled={isReviewResolutionPending}
                      >
                        Override
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onResolveDecisionFlag(flag.id, "dismissed")}
                        disabled={isReviewResolutionPending}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Rows3 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Line Item Drafts</h3>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{currentDraft?.lineItemDrafts.length ?? lineItems.length}</Badge>
              {currentDraft && (
                <Button type="button" size="sm" variant="outline" onClick={addLineItemDraft} disabled={isConverted}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Row
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {!currentDraft || currentDraft.lineItemDrafts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No line item draft rows.</div>
            ) : (
              currentDraft.lineItemDrafts.map((lineItem, index) => {
                const sourceLineItem = lineItem.sourceLineItemId
                  ? lineItems.find((candidate) => candidate.id === lineItem.sourceLineItemId)
                  : null;
                const matchedProduct = sourceLineItem?.productId ? productById.get(sourceLineItem.productId) : null;

                return (
                  <div key={lineItem.id} className="rounded-md bg-muted/40 px-3 py-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Draft line {index + 1}</div>
                        {sourceLineItem?.productId && (
                          <div className="mt-1 text-xs text-emerald-700">
                            Matched: {matchedProduct?.name ?? sourceLineItem.productId.slice(0, 8)}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLineItemDraft(lineItem.id)}
                        disabled={isConverted}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Product/name</span>
                        <Input
                          value={lineItem.productName}
                          onChange={(event) => updateLineItemDraft(lineItem.id, "productName", event.target.value)}
                          placeholder="Product or requested item"
                          disabled={isConverted}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Description</span>
                        <Textarea
                          value={lineItem.description}
                          onChange={(event) => updateLineItemDraft(lineItem.id, "description", event.target.value)}
                          rows={2}
                          placeholder="Line item description"
                          disabled={isConverted}
                        />
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Qty</span>
                          <Input
                            value={lineItem.quantity}
                            onChange={(event) => updateLineItemDraft(lineItem.id, "quantity", event.target.value)}
                            disabled={isConverted}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Width</span>
                          <Input
                            value={lineItem.width}
                            onChange={(event) => updateLineItemDraft(lineItem.id, "width", event.target.value)}
                            disabled={isConverted}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Height</span>
                          <Input
                            value={lineItem.height}
                            onChange={(event) => updateLineItemDraft(lineItem.id, "height", event.target.value)}
                            disabled={isConverted}
                          />
                        </label>
                      </div>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Line notes</span>
                        <Input
                          value={lineItem.notes}
                          onChange={(event) => updateLineItemDraft(lineItem.id, "notes", event.target.value)}
                          placeholder="Internal line notes"
                          disabled={isConverted}
                        />
                      </label>
                      {lineItem.sourceLineItemId && (
                        <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                              Source line item: {lineItem.sourceLineItemId.slice(0, 8)}
                            </div>
                            <Badge variant={sourceLineItem?.productId ? "secondary" : "outline"}>
                              {sourceLineItem?.productId ? "Human matched" : "Needs product match"}
                            </Badge>
                          </div>
                          {!isConverted && (
                            <div className="space-y-2">
                              <Input
                                value={productSearch}
                                onChange={(event) => setProductSearch(event.target.value)}
                                placeholder="Search active products"
                                disabled={isProductsLoading}
                              />
                              <div className="flex gap-2">
                                <select
                                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                                  value={sourceLineItem?.productId ?? ""}
                                  onChange={(event) => {
                                    if (!event.target.value) return;
                                    onMatchLineItemProduct(lineItem.sourceLineItemId!, event.target.value);
                                  }}
                                  disabled={isProductsLoading || isLineItemMatching}
                                >
                                  <option value="">Select product...</option>
                                  {filteredProducts.map((product) => (
                                    <option key={product.id} value={product.id}>{product.name}</option>
                                  ))}
                                </select>
                                {isLineItemMatching && <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <SectionHeader icon={FileText} title="Files" count={files.length} />
          <div className="space-y-2">
            {files.length === 0 ? (
              <div className="text-sm text-muted-foreground">No files linked.</div>
            ) : (
              files.map((file) => (
                <div key={file.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {file.sourceFilename || file.id}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {file.role} / {file.mimeType || "unknown"} / {formatBytes(file.sizeBytes)}
                      </div>
                    </div>
                    <Badge variant="secondary">{file.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section id="inbound-review-history" className="rounded-md border border-border p-3">
          <SectionHeader icon={Clock} title="Event Timeline" count={events.length} />
          <div className="space-y-3">
            {events.length === 0 ? (
              <div className="text-sm text-muted-foreground">No events recorded.</div>
            ) : (
              events.map((event) => (
                <div key={event.id} className="border-l border-border pl-3">
                  <div className="text-sm font-medium text-foreground">{event.eventType}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.message || event.actorType} / {formatRelative(event.createdAt)}
                  </div>
                  {(event.fromStatus || event.toStatus) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {event.fromStatus || "-"} to {event.toStatus || "-"}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {detail?.latestReviewSnapshot && (
          <section className="rounded-md border border-border p-3">
            <SectionHeader title="Latest Review Snapshot" />
            <div className="mb-2 text-xs text-muted-foreground">
              {detail.latestReviewSnapshot.snapshotType} v{detail.latestReviewSnapshot.snapshotVersion} / {formatRelative(detail.latestReviewSnapshot.createdAt)}
            </div>
            <CompactJsonBlock value={detail.latestReviewSnapshot.payloadJson} />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Normalized Draft</h3>
          <JsonBlock value={record.normalizedPayloadJson} />
        </section>
      </div>
    </ScrollArea>
  );
}

export default function InboundOrdersPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(defaultQueueFilters);
  const listUrl = useMemo(() => buildInboundOrderListUrl(queueFilters), [queueFilters]);

  const listQuery = useQuery({
    queryKey: ["/api/inbound-orders", queueFilters],
    queryFn: () => readJson<InboundOrdersListResponse>(listUrl),
  });

  const records = listQuery.data?.data ?? [];
  const queueSummary = listQuery.data?.summary ?? null;

  useEffect(() => {
    if (!selectedId && records.length > 0) {
      setSelectedId(records[0].id);
      return;
    }

    if (selectedId && records.length > 0 && !records.some((record) => record.id === selectedId)) {
      setSelectedId(records[0].id);
      return;
    }

    if (selectedId && records.length === 0) {
      setSelectedId(null);
    }
  }, [records, selectedId]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const detailQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId],
    queryFn: () => readJson<InboundOrderDetailResponse>(`/api/inbound-orders/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const quoteDraftPreviewQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId, "quote-draft-preview"],
    queryFn: () => readJson<QuoteDraftPreviewResponse>(`/api/inbound-orders/${selectedId}/quote-draft-preview`),
    enabled: Boolean(selectedId),
  });

  const productsQuery = useQuery({
    queryKey: ["/api/products", "activeOnly"],
    queryFn: () => readJson<ProductOption[]>("/api/products?activeOnly=true"),
  });

  const errorMessage = getErrorTone(
    (listQuery.error as Error | null) || (detailQuery.error as Error | null),
  );
  const listErrorMessage = getErrorTone(listQuery.error as Error | null);

  const createManualMutation = useMutation({
    mutationFn: async (values: ManualIntakeFormValues) => {
      return postJson<ManualInboundOrderCreateResponse>(
        "/api/inbound-orders/manual",
        buildManualIntakePayload(values),
      );
    },
    onSuccess: async (response) => {
      const createdRecordId = response.data.record.id;
      await listQuery.refetch();
      setSelectedId(createdRecordId);
    },
  });

  const reviewActionMutation = useMutation({
    mutationFn: async (input: { recordId: string; action: ReviewAction; note?: string | null }) => {
      return postJson<InboundOrderDetailResponse>(
        getReviewActionEndpoint(input.recordId, input.action),
        { note: input.note ?? null },
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });

  const reviewSnapshotMutation = useMutation({
    mutationFn: async (input: { recordId: string; payload: ReturnType<typeof buildReviewSnapshotPayload> }) => {
      return postJson<InboundOrderDetailResponse>(
        `/api/inbound-orders/${input.recordId}/review-snapshot`,
        input.payload,
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });

  const createQuoteDraftMutation = useMutation({
    mutationFn: async (recordId: string) => {
      return postJson<CreateQuoteDraftResponse>(
        `/api/inbound-orders/${recordId}/create-quote-draft`,
        {},
      );
    },
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(
        ["/api/inbound-orders", recordId],
        { success: true, data: response.data.inbound } satisfies InboundOrderDetailResponse,
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(recordId);
    },
  });

  const lineItemMatchMutation = useMutation({
    mutationFn: async (input: { recordId: string; lineItemId: string; productId: string; staffNote?: string | null }) => {
      return postJson<InboundOrderDetailResponse>(
        `/api/inbound-orders/${input.recordId}/line-items/${input.lineItemId}/match-product`,
        {
          productId: input.productId,
          staffNote: input.staffNote ?? null,
        },
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });

  const customerMatchMutation = useMutation({
    mutationFn: async (input: { recordId: string; customerId: string; contactId?: string | null; staffNote?: string | null }) => {
      return postJson<InboundOrderDetailResponse>(
        `/api/inbound-orders/${input.recordId}/match-customer`,
        {
          customerId: input.customerId,
          contactId: input.contactId ?? null,
          staffNote: input.staffNote ?? null,
        },
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });


  const warningResolutionMutation = useMutation({
    mutationFn: async (input: { recordId: string; warningId: string; status: "resolved" | "ignored"; resolutionNote?: string | null }) => {
      return postJson<InboundOrderDetailResponse>(
        `/api/inbound-orders/${input.recordId}/warnings/${input.warningId}/resolve`,
        {
          status: input.status,
          resolutionNote: input.resolutionNote ?? null,
        },
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });

  const decisionFlagResolutionMutation = useMutation({
    mutationFn: async (input: { recordId: string; flagId: string; status: "accepted" | "overridden" | "dismissed"; decisionNote?: string | null }) => {
      return postJson<InboundOrderDetailResponse>(
        `/api/inbound-orders/${input.recordId}/decision-flags/${input.flagId}/resolve`,
        {
          status: input.status,
          decisionNote: input.decisionNote ?? null,
        },
      );
    },
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "quote-draft-preview"] });
      await listQuery.refetch();
      setSelectedId(variables.recordId);
    },
  });

  const handleReviewAction = (action: ReviewAction) => {
    if (!selectedId) return;

    let note: string | null = null;

    if (action === "needs-clarification" || action === "reject") {
      const promptLabel = action === "needs-clarification"
        ? "Add a short clarification note for staff:"
        : "Add a short rejection reason:";
      const value = window.prompt(promptLabel);

      if (value === null) return;
      note = trimToNull(value);

      if (!note) return;
    }

    reviewActionMutation.mutate({
      recordId: selectedId,
      action,
      note,
    });
  };

  const handleSaveSnapshot = async (payload: ReturnType<typeof buildReviewSnapshotPayload>) => {
    if (!selectedId) return;
    await reviewSnapshotMutation.mutateAsync({
      recordId: selectedId,
      payload,
    });
  };

  const handleCreateQuoteDraft = () => {
    if (!selectedId) return;
    const preview = quoteDraftPreviewQuery.data?.data;

    if (!preview?.eligible) {
      window.alert(preview?.blockingReasons[0] ?? "This inbound record is not eligible for quote conversion yet.");
      return;
    }

    const confirmed = window.confirm(
      [
        "Create this draft quote from the conversion preview?",
        "",
        `Quote label: ${preview.label || "Inbound quote draft"}`,
        `Customer: ${preview.customer.customerName || "Manual inbound customer text"}`,
        `Line items to create: ${preview.lineItemsToConvert.length}`,
        `Line items to skip: ${preview.skippedLineItems.length}`,
        "",
        "This creates the first permanent business object. No order will be created.",
      ].join("\n"),
    );

    if (!confirmed) return;
    createQuoteDraftMutation.mutate(selectedId);
  };

  const handleMatchLineItemProduct = (lineItemId: string, productId: string) => {
    if (!selectedId) return;
    const note = window.prompt("Optional note for this product match:");
    if (note === null) return;

    lineItemMatchMutation.mutate({
      recordId: selectedId,
      lineItemId,
      productId,
      staffNote: trimToNull(note),
    });
  };

  const handleMatchCustomer = (customerId: string, contactId?: string | null) => {
    if (!selectedId || !customerId) return;
    const note = window.prompt("Optional note for this customer/contact match:");
    if (note === null) return;

    customerMatchMutation.mutate({
      recordId: selectedId,
      customerId,
      contactId: contactId ?? null,
      staffNote: trimToNull(note),
    });
  };

  const handleResolveWarning = (warningId: string, status: "resolved" | "ignored") => {
    if (!selectedId) return;
    const note = window.prompt("Optional resolution note:");
    if (note === null) return;

    warningResolutionMutation.mutate({
      recordId: selectedId,
      warningId,
      status,
      resolutionNote: trimToNull(note),
    });
  };

  const handleResolveDecisionFlag = (flagId: string, status: "accepted" | "overridden" | "dismissed") => {
    if (!selectedId) return;
    const note = window.prompt("Optional decision note:");
    if (note === null) return;

    decisionFlagResolutionMutation.mutate({
      recordId: selectedId,
      flagId,
      status,
      decisionNote: trimToNull(note),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold tracking-normal text-foreground">
                Inbound Orders
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Queue review workspace
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              listQuery.refetch();
              if (selectedId) detailQuery.refetch();
              if (selectedId) quoteDraftPreviewQuery.refetch();
            }}
            disabled={listQuery.isFetching || detailQuery.isFetching || quoteDraftPreviewQuery.isFetching}
          >
            {listQuery.isFetching || detailQuery.isFetching || quoteDraftPreviewQuery.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        {errorMessage && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Inbound queue unavailable</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(260px,340px)_minmax(360px,1fr)_minmax(360px,1fr)]">
        <section className="min-h-[280px] min-w-0 border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Inbound Queue</div>
            <Badge variant="outline">{records.length}</Badge>
          </div>
          <div className="h-[calc(100%-3rem)]">
            <div className="flex h-full min-h-0 flex-col">
              <QueueTriageControls
                filters={queueFilters}
                summary={queueSummary}
                isLoading={listQuery.isFetching}
                onChange={setQueueFilters}
              />
              <ManualIntakePanel
                disabled={Boolean(listErrorMessage)}
                isCreating={createManualMutation.isPending}
                error={createManualMutation.error as Error | null}
                onCreate={(values) => createManualMutation.mutateAsync(values).then(() => undefined)}
              />
              <div className="min-h-0 flex-1">
                {listQuery.isLoading ? (
                  <QueueSkeleton />
                ) : (
                  <InboundQueuePanel
                    records={records}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="min-h-[360px] min-w-0 border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Source Evidence</div>
            {selectedRecord && <Badge variant="secondary">{formatTrustLevel(selectedRecord.sourceTrustLevel)}</Badge>}
          </div>
          <div className="h-[calc(100%-3rem)]">
            <SourceEvidencePanel
              detail={detailQuery.data?.data}
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading}
            />
          </div>
        </section>

        <section className="min-h-[360px] min-w-0 lg:min-h-0">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">TitanOS Draft Builder</div>
            <Badge variant="outline">Review Draft</Badge>
          </div>
          <div className="h-[calc(100%-3rem)]">
            <DraftBuilderPanel
              detail={detailQuery.data?.data}
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading}
              isActionPending={reviewActionMutation.isPending}
              actionError={reviewActionMutation.error as Error | null}
              isSnapshotSaving={reviewSnapshotMutation.isPending}
              snapshotError={reviewSnapshotMutation.error as Error | null}
              isQuoteCreating={createQuoteDraftMutation.isPending}
              quoteCreateError={createQuoteDraftMutation.error as Error | null}
              createdQuote={createQuoteDraftMutation.data?.data.quote ?? null}
              quoteDraftPreview={quoteDraftPreviewQuery.data?.data ?? null}
              isQuotePreviewLoading={quoteDraftPreviewQuery.isLoading}
              quotePreviewError={quoteDraftPreviewQuery.error as Error | null}
              products={productsQuery.data ?? []}
              isProductsLoading={productsQuery.isLoading}
              isLineItemMatching={lineItemMatchMutation.isPending}
              isCustomerMatching={customerMatchMutation.isPending}
              isReviewResolutionPending={warningResolutionMutation.isPending || decisionFlagResolutionMutation.isPending}
              reviewResolutionError={
                (lineItemMatchMutation.error as Error | null)
                || (customerMatchMutation.error as Error | null)
                || (warningResolutionMutation.error as Error | null)
                || (decisionFlagResolutionMutation.error as Error | null)
              }
              onReviewAction={handleReviewAction}
              onSaveSnapshot={handleSaveSnapshot}
              onCreateQuoteDraft={handleCreateQuoteDraft}
              onMatchCustomer={handleMatchCustomer}
              onMatchLineItemProduct={handleMatchLineItemProduct}
              onResolveWarning={handleResolveWarning}
              onResolveDecisionFlag={handleResolveDecisionFlag}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
