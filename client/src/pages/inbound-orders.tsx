import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  FileText,
  GripVertical,
  Inbox,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ProductOptionsPanelV2 } from "@/features/quotes/editor/components/ProductOptionsPanelV2";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  getManualInboundEvidence,
  type InboundOrderDetailResponse,
  type InboundOrderDraftPreviewResponse,
  type InboundOrderParsedDraft,
  type InboundOrderParseResponse,
  type InboundOrderReviewDraftDto,
  type InboundOrderReviewDraftResponse,
  type InboundOrderReviewDraftSaveRequest,
  type InboundOrdersListResponse,
  type InboundOrderStatusGroup,
  type InboundOrderQueueSummary,
  type InboundOrderConvertToOrderResponse,
  type InboundOrderProductOptionsResponse,
  type InboundMatchedContactSummary,
  type InboundMatchedCustomerSummary,
  type ManualInboundOrderCreateRequest,
  type ManualInboundOrderCreateResponse,
} from "@shared/inboundOrdersApi";
import type { LineItemOptionSelectionsV2 } from "@shared/optionTreeV2";
import { getMissingInboundPbv2RequiredOptions } from "@shared/inboundOrderPbv2Options";
import type {
  InboundOrderRecord,
  InboundOrderRecordStatus,
  InboundOrderSourceType,
} from "@shared/schema";

type ClientInboundOrderRecord = Omit<
  InboundOrderRecord,
  "receivedAt" | "submittedAt" | "createdAt" | "updatedAt" | "rejectedAt"
> & {
  receivedAt: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rejectedAt: string | null;
};

type ClientInboundOrdersListResponse = Omit<InboundOrdersListResponse, "data"> & {
  data: ClientInboundOrderRecord[];
};

type ClientInboundOrderDetailResponse = Omit<InboundOrderDetailResponse, "data"> & {
  data: Omit<InboundOrderDetailResponse["data"], "record"> & {
    record: ClientInboundOrderRecord;
  };
};

type ClientInboundOrderParseAttempt = NonNullable<InboundOrderDraftPreviewResponse["data"]["latestAttempt"]>;

type ClientInboundOrderDraftPreviewResponse = InboundOrderDraftPreviewResponse;
type ClientInboundOrderReviewDraftResponse = InboundOrderReviewDraftResponse;
type ReviewDraftFormState = InboundOrderReviewDraftSaveRequest;

type ClientInboundOrderParseResponse = Omit<InboundOrderParseResponse, "data"> & {
  data: Omit<InboundOrderParseResponse["data"], "record"> & {
    record: ClientInboundOrderRecord;
  };
};

type InboundCustomerSearchResponse = {
  success: true;
  data: InboundMatchedCustomerSummary[];
};

type InboundContactSearchResponse = {
  success: true;
  data: Array<InboundMatchedContactSummary & {
    firstName?: string | null;
    lastName?: string | null;
    isPrimary?: boolean;
  }>;
};

type QueueStatusFilter = "all" | InboundOrderStatusGroup;

type QueueFilters = {
  statusGroup: QueueStatusFilter;
  sourceType: "all" | InboundOrderSourceType;
  hasWarnings: boolean;
  unconvertedOnly: boolean;
  search: string;
};

const defaultQueueFilters: QueueFilters = {
  statusGroup: "all",
  sourceType: "all",
  hasWarnings: false,
  unconvertedOnly: true,
  search: "",
};

const workspaceLayoutStorageKeys = {
  queueCollapsed: "titanos.inboundOrders.queueCollapsed",
  evidenceWidth: "titanos.inboundOrders.evidenceWidth",
  draftWidth: "titanos.inboundOrders.draftWidth",
} as const;

const workspaceLayoutDefaults = {
  queueExpandedWidth: 360,
  queueCollapsedWidth: 56,
  evidenceWidth: 440,
  draftWidth: 520,
  minQueueExpandedWidth: 360,
  minEvidenceWidth: 420,
  minDraftWidth: 480,
  compactEvidenceWidth: 340,
  compactDraftWidth: 380,
  desktopBreakpoint: 1180,
  wideDesktopBreakpoint: 1500,
} as const;

const statusLabels: Record<InboundOrderRecordStatus, string> = {
  received: "Received",
  processing: "Processing",
  needs_review: "Needs Review",
  waiting_on_customer: "Waiting",
  ready: "Ready",
  approved: "Approved",
  submitted: "Converted",
  failed: "Failed",
  terminal: "Rejected",
};

const sourceTypeOptions: Array<{ value: QueueFilters["sourceType"]; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "email", label: "Email" },
  { value: "customer_api", label: "API" },
  { value: "webhook", label: "Webhook" },
  { value: "csv_import", label: "CSV" },
  { value: "portal", label: "Portal" },
  { value: "n8n", label: "n8n" },
  { value: "zapier", label: "Zapier" },
  { value: "edi", label: "EDI" },
];

function buildInboundOrderListUrl(filters: QueueFilters) {
  const params = new URLSearchParams();
  params.set("limit", "50");
  params.set("offset", "0");

  if (filters.statusGroup !== "all") params.set("statusGroup", filters.statusGroup);
  if (filters.sourceType !== "all") params.set("sourceType", filters.sourceType);
  if (filters.hasWarnings) params.set("hasWarnings", "true");
  if (filters.unconvertedOnly && filters.statusGroup !== "converted") params.set("converted", "false");
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
    const error = new Error(message) as Error & { errors?: string[] };
    if (Array.isArray(json?.errors)) error.errors = json.errors.filter((item: unknown): item is string => typeof item === "string");
    throw error;
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
    const error = new Error(message) as Error & { errors?: string[] };
    if (Array.isArray(json?.errors)) error.errors = json.errors.filter((item: unknown): item is string => typeof item === "string");
    throw error;
  }

  return json as T;
}

async function putJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "PUT",
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
    const error = new Error(message) as Error & { errors?: string[] };
    if (Array.isArray(json?.errors)) error.errors = json.errors.filter((item: unknown): item is string => typeof item === "string");
    throw error;
  }

  return json as T;
}

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) === "true" ? true : fallback;
}

function readStoredNumber(key: string, fallback: number, minimum: number, maximum = 900): number {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? clampWorkspaceWidth(value, minimum, maximum) : fallback;
}

function clampWorkspaceWidth(value: number, minimum: number, maximum = 900): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function getMeasuredWorkspaceWidth(workspaceWidth: number): number {
  if (workspaceWidth > 0) return workspaceWidth;
  if (typeof window === "undefined") return 0;
  return window.innerWidth;
}

function getVisibleWorkspaceWidth(element: HTMLElement | null): number {
  if (!element || typeof window === "undefined") return 0;
  const rect = element.getBoundingClientRect();
  const measuredWidth = rect.width || element.clientWidth;
  const visibleWidth = Math.max(0, window.innerWidth - Math.max(0, rect.left));
  const boundedWidth = visibleWidth > 0 ? Math.min(measuredWidth, visibleWidth) : measuredWidth;
  return Math.max(0, Math.round(boundedWidth));
}

function getWorkspaceQueueWidth(queueCollapsed: boolean): number {
  return queueCollapsed
    ? workspaceLayoutDefaults.queueCollapsedWidth
    : workspaceLayoutDefaults.queueExpandedWidth;
}

function getWorkspaceAvailablePanelWidth(args: { queueCollapsed: boolean; workspaceWidth: number }): number {
  const measuredWidth = getMeasuredWorkspaceWidth(args.workspaceWidth);
  if (measuredWidth < workspaceLayoutDefaults.desktopBreakpoint) {
    return workspaceLayoutDefaults.evidenceWidth + workspaceLayoutDefaults.draftWidth;
  }
  return Math.max(0, measuredWidth - getWorkspaceQueueWidth(args.queueCollapsed));
}

function getWorkspacePanelMinimums(args: { queueCollapsed: boolean; workspaceWidth: number }) {
  const availableWidth = getWorkspaceAvailablePanelWidth(args);
  if (args.workspaceWidth >= workspaceLayoutDefaults.wideDesktopBreakpoint || availableWidth >= 980) {
    return {
      evidence: workspaceLayoutDefaults.minEvidenceWidth,
      draft: workspaceLayoutDefaults.minDraftWidth,
    };
  }
  return {
    evidence: Math.min(workspaceLayoutDefaults.minEvidenceWidth, workspaceLayoutDefaults.compactEvidenceWidth),
    draft: Math.min(workspaceLayoutDefaults.minDraftWidth, workspaceLayoutDefaults.compactDraftWidth),
  };
}

function reconcileWorkspacePanelWidths(args: {
  evidenceWidth: number;
  draftWidth: number;
  queueCollapsed: boolean;
  workspaceWidth: number;
}) {
  const availableWidth = getWorkspaceAvailablePanelWidth(args);
  const minimums = getWorkspacePanelMinimums(args);
  if (availableWidth <= 0) {
    return {
      evidenceWidth: workspaceLayoutDefaults.evidenceWidth,
      draftWidth: workspaceLayoutDefaults.draftWidth,
    };
  }
  const maxEvidenceWidth = Math.max(minimums.evidence, availableWidth - minimums.draft);
  const evidenceWidth = clampWorkspaceWidth(
    args.evidenceWidth,
    minimums.evidence,
    maxEvidenceWidth,
  );
  return {
    evidenceWidth,
    draftWidth: clampWorkspaceWidth(
      args.draftWidth,
      minimums.draft,
      Math.max(minimums.draft, availableWidth - evidenceWidth),
    ),
  };
}

function cloneReviewDraft(draft: InboundOrderReviewDraftDto): ReviewDraftFormState {
  return JSON.parse(JSON.stringify({
    status: "draft",
    reviewedCustomerJson: draft.reviewedCustomerJson,
    reviewedOrderJson: draft.reviewedOrderJson,
    reviewedLineItemsJson: draft.reviewedLineItemsJson,
    reviewedArtworkJson: draft.reviewedArtworkJson,
    missingDecisionsJson: draft.missingDecisionsJson,
    warningsJson: draft.warningsJson,
    reviewNotes: draft.reviewNotes,
  })) as ReviewDraftFormState;
}

function formStatesEqual(left: ReviewDraftFormState | null, right: ReviewDraftFormState | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function titleCase(value: string | null | undefined) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "-";
}

function evidenceSourceLabel(value: string | null | undefined) {
  if (value === "PDF_ATTACHMENT") return "PDF Attachment";
  if (value === "EMAIL_BODY") return "Email Body";
  if (value === "EMAIL_SUBJECT") return "Email Subject";
  if (value === "TEXT_ATTACHMENT") return "Text Attachment";
  if (value === "MANUAL_NOTES") return "Manual Notes";
  return titleCase(value);
}

function getRecordTitle(record: ClientInboundOrderRecord) {
  const evidence = getManualInboundEvidence(record);
  return evidence.reference || evidence.subject || record.externalReference || `Inbound ${record.id.slice(0, 8)}`;
}

function getSenderLabel(record: ClientInboundOrderRecord) {
  const evidence = getManualInboundEvidence(record);
  return [evidence.senderName, evidence.senderEmail].filter(Boolean).join(" / ") || "No sender captured";
}

function getErrorTone(error: Error | null) {
  if (!error) return null;
  const message = error.message.toLowerCase();
  if (
    message.includes("inbound order tables are not available")
    || message.includes("does not exist")
    || message.includes("relation")
    || message.includes("inbound_order")
  ) {
    return "Inbound order tables are not available yet. The page is ready, but the inbound migration must run before staff can use the queue.";
  }
  return error.message;
}

function StatusBadge({ status }: { status: InboundOrderRecordStatus }) {
  const variant = status === "terminal" || status === "failed"
    ? "destructive"
    : status === "needs_review"
      ? "default"
      : "secondary";

  return <Badge variant={variant}>{statusLabels[status] ?? status}</Badge>;
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mt-4 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border bg-card p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-3 h-3 w-1/2" />
          <Skeleton className="mt-4 h-8 w-full" />
        </div>
      ))}
    </div>
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

function InlineField({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-foreground">{display ?? "-"}</div>
    </div>
  );
}

function WarningList({ warnings }: { warnings: InboundOrderParsedDraft["globalWarnings"] }) {
  if (warnings.length === 0) {
    return <div className="text-sm text-muted-foreground">No parse warnings.</div>;
  }

  return (
    <div className="space-y-2">
      {warnings.map((warning, index) => (
        <div key={`${warning.code}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">{warning.code}</div>
            <Badge variant={warning.severity === "blocking" ? "destructive" : "outline"}>
              {titleCase(warning.severity)}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{warning.message}</div>
        </div>
      ))}
    </div>
  );
}

function CandidateList({
  title,
  candidates,
}: {
  title: string;
  candidates: InboundOrderParsedDraft["customer"]["customerCandidates"];
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
        <Badge variant="outline">{candidates.length}</Badge>
      </div>
      {candidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">No candidates found.</div>
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-md bg-muted/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{candidate.label}</div>
                  {candidate.reason && <div className="mt-1 text-xs text-muted-foreground">{candidate.reason}</div>}
                </div>
                <Badge variant="secondary">{candidate.confidence}%</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getStringArrayMetadata(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number], key: string): string[] {
  const value = candidate.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function getBreakdownMetadata(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number]) {
  const value = candidate.metadata?.matchBreakdown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ProductMatchReasoning({ candidates }: { candidates: InboundOrderParsedDraft["lineItems"][number]["productCandidates"] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Product Match Reasoning</h4>
        <Badge variant="outline">{candidates.length}</Badge>
      </div>
      {candidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">No product match reasoning available.</div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const reasons = getStringArrayMetadata(candidate, "matchReasons");
            const breakdown = getBreakdownMetadata(candidate);
            return (
              <div key={candidate.id} className="rounded-md bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{candidate.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{candidate.reason || "Candidate returned by product matcher."}</div>
                  </div>
                  <Badge variant="secondary">{candidate.confidence}%</Badge>
                </div>
                {reasons.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {reasons.slice(0, 5).map((reason, index) => (
                      <li key={`${candidate.id}-reason-${index}`}>{reason}</li>
                    ))}
                  </ul>
                )}
                {breakdown && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Final Score {String(breakdown.combinedConfidence ?? candidate.confidence)}</span>
                    <span>Material Score {String(breakdown.materialScore ?? 0)}</span>
                    <span>Category Score {String(breakdown.categoryScore ?? 0)}</span>
                    <span>Description Score {String(breakdown.descriptionScore ?? 0)}</span>
                    <span>Keyword Score {String(breakdown.keywordScore ?? breakdown.nameScore ?? 0)}</span>
                    <span>Metadata Score {String(breakdown.metadataScore ?? 0)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PoSummaryGrid({ summary }: { summary: NonNullable<InboundOrderParsedDraft["evidence"]["items"][number]["poSummary"]> }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <InlineField label="PO Number" value={summary.poNumber} />
      <InlineField label="Due Date" value={summary.dueDate} />
      <InlineField label="Quantity" value={summary.quantity} />
      <InlineField label="Product" value={summary.productDescription} />
      <InlineField label="Material" value={summary.material} />
      <InlineField label="Size" value={summary.dimensions} />
    </div>
  );
}

const fieldSourceLabels: Record<string, string> = {
  poNumber: "PO Number",
  dueDate: "Due Date",
  quantity: "Quantity",
  dimensions: "Dimensions",
  material: "Material",
  productDescription: "Product",
};

function FieldSourceSection({ draft }: { draft: InboundOrderParsedDraft }) {
  const sourceEntries = draft.evidence.items
    .filter((item) => item.poSummary?.fieldSources)
    .flatMap((item) => Object.entries(item.poSummary?.fieldSources ?? {}).map(([field, source]) => ({ field, source })))
    .filter((entry) => fieldSourceLabels[entry.field]);

  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Field Sources</h3>
        <Badge variant="outline">{sourceEntries.length}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        {sourceEntries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No field source details available.</div>
        ) : (
          sourceEntries.map(({ field, source }) => (
            <div key={field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{fieldSourceLabels[field]}</div>
                  <div className="mt-1 break-words text-sm text-foreground">{String(source.value ?? "-")}</div>
                </div>
                <Badge variant="secondary">{source.confidence}%</Badge>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                <div>Value: {String(source.value ?? "-")}</div>
                <div>Source: {evidenceSourceLabel(source.sourceType)}</div>
                {source.sourceDocument && <div>Document: {source.sourceDocument}</div>}
                {source.sourceText && <div>Source Text: {source.sourceText}</div>}
                <div>Confidence: {source.confidence}%</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function QueueTriageControls({
  filters,
  summary,
  isLoading,
  onChange,
}: {
  filters: QueueFilters;
  summary: InboundOrderQueueSummary | null;
  isLoading: boolean;
  onChange: (filters: QueueFilters) => void;
}) {
  const setFilter = (patch: Partial<QueueFilters>) => onChange({ ...filters, ...patch });
  const statusButtons: Array<{ value: QueueStatusFilter; label: string; count: number | null }> = [
    {
      value: "all",
      label: "Active",
      count: summary
        ? summary.needsReview + summary.waitingOnCustomer + summary.readyReviewed
        : null,
    },
    { value: "needs_review", label: "Needs Review", count: summary?.needsReview ?? 0 },
    { value: "waiting", label: "Waiting", count: summary?.waitingOnCustomer ?? 0 },
    { value: "ready", label: "Ready", count: summary?.readyReviewed ?? 0 },
    { value: "converted", label: "Converted", count: summary?.convertedSubmitted ?? 0 },
    { value: "rejected", label: "Rejected", count: summary?.rejectedTerminal ?? 0 },
  ];

  return (
    <div className="box-border min-w-0 max-w-full space-y-3 overflow-x-hidden border-b border-border p-3">
      <label className="relative block min-w-0 max-w-full">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="w-full max-w-full pl-8"
          value={filters.search}
          onChange={(event) => setFilter({ search: event.target.value })}
          placeholder="Search reference, sender, notes, subject, body"
          disabled={isLoading}
        />
      </label>

      <div className="flex max-w-full flex-wrap gap-1.5 overflow-hidden">
        {statusButtons.map((button) => (
          <Button
            key={button.value}
            type="button"
            size="sm"
            className="h-auto min-h-8 min-w-0 max-w-full whitespace-normal"
            variant={filters.statusGroup === button.value ? "default" : "outline"}
            onClick={() => setFilter({
              statusGroup: button.value,
              unconvertedOnly: button.value === "converted" ? false : filters.unconvertedOnly,
            })}
          >
            {button.label}
            {button.count !== null && <Badge variant="secondary" className="ml-2">{button.count}</Badge>}
          </Button>
        ))}
      </div>

      <div className="flex max-w-full flex-wrap items-center gap-2 overflow-hidden">
        <select
          className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
          value={filters.sourceType}
          onChange={(event) => setFilter({ sourceType: event.target.value as QueueFilters["sourceType"] })}
          disabled={isLoading}
        >
          {sourceTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <label className="flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-input px-2 py-1 text-xs text-foreground">
          <input
            type="checkbox"
            checked={filters.hasWarnings}
            onChange={(event) => setFilter({ hasWarnings: event.target.checked })}
            disabled={isLoading}
          />
          Warnings
          <Badge variant="secondary">{summary?.withWarnings ?? 0}</Badge>
        </label>
        <label className="flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-input px-2 py-1 text-xs text-foreground">
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
  );
}

function ManualIntakeDialog({
  open,
  isCreating,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  isCreating: boolean;
  error: Error | null;
  onClose: () => void;
  onCreate: (payload: ManualInboundOrderCreateRequest) => Promise<void>;
}) {
  const [form, setForm] = useState({
    reference: "",
    senderName: "",
    senderEmail: "",
    subject: "",
    bodyText: "",
    notes: "",
  });
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const setField = (field: keyof typeof form, value: string) => {
    setLocalError(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const bodyText = form.bodyText.trim();
    if (!bodyText) {
      setLocalError("Body text is required.");
      return;
    }

    try {
      await onCreate({
        reference: trimToNull(form.reference),
        senderName: trimToNull(form.senderName),
        senderEmail: trimToNull(form.senderEmail),
        subject: trimToNull(form.subject),
        bodyText,
        notes: trimToNull(form.notes),
      });
      setForm({ reference: "", senderName: "", senderEmail: "", subject: "", bodyText: "", notes: "" });
      onClose();
    } catch (createError) {
      setLocalError(createError instanceof Error ? createError.message : "Failed to create manual intake record.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-xl rounded-md border border-border bg-background p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Manual Intake</h2>
            <p className="mt-1 text-sm text-muted-foreground">Create a TEMP_INBOUND record for staff review.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isCreating}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reference</span>
            <Input value={form.reference} onChange={(event) => setField("reference", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sender email</span>
            <Input value={form.senderEmail} onChange={(event) => setField("senderEmail", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sender name</span>
            <Input value={form.senderName} onChange={(event) => setField("senderName", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Subject</span>
            <Input value={form.subject} onChange={(event) => setField("subject", event.target.value)} maxLength={500} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Body text</span>
            <Textarea
              value={form.bodyText}
              onChange={(event) => setField("bodyText", event.target.value)}
              rows={6}
              required
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <Textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} />
          </label>
        </div>

        {(localError || error) && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {localError || error?.message}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button type="submit" disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create TEMP Record
          </Button>
        </div>
      </form>
    </div>
  );
}

function InboundQueuePanel({
  records,
  selectedId,
  onSelect,
}: {
  records: ClientInboundOrderRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (records.length === 0) {
    return (
      <EmptyPanel
        title="No inbound records"
        detail="Create a manual TEMP_INBOUND record, adjust the filters, or run the inbound migration if this environment is not migrated yet."
      />
    );
  }

  return (
    <div className="h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden">
      <div className="box-border w-full min-w-0 max-w-full space-y-2 overflow-x-hidden p-3">
        {records.map((record) => {
          const evidence = getManualInboundEvidence(record);
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => onSelect(record.id)}
              className={cn(
                "block box-border w-full min-w-0 max-w-full overflow-x-hidden rounded-md border p-3 text-left transition-colors",
                selectedId === record.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <div className="flex min-w-0 max-w-full items-start justify-between gap-2 overflow-hidden">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="block max-w-full truncate text-sm font-semibold text-foreground">{getRecordTitle(record)}</div>
                  <div className="mt-1 block max-w-full truncate text-xs text-muted-foreground">{getSenderLabel(record)}</div>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={record.status} />
                </div>
              </div>
              <div className="mt-3 grid max-w-full grid-cols-2 gap-2 overflow-hidden text-xs">
                <div className="min-w-0 overflow-hidden">
                  <div className="text-muted-foreground">Source</div>
                  <div className="truncate font-medium text-foreground">{titleCase(record.sourceType)}</div>
                </div>
                <div className="min-w-0 overflow-hidden">
                  <div className="text-muted-foreground">Reference</div>
                  <div className="truncate font-medium text-foreground">{evidence.reference || "-"}</div>
                </div>
                <div className="min-w-0 overflow-hidden">
                  <div className="text-muted-foreground">Created</div>
                  <div className="truncate font-medium text-foreground">{formatRelative(record.createdAt)}</div>
                </div>
              </div>
              {record.requiresHumanDecision && (
                <div className="mt-3 flex min-w-0 max-w-full items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs leading-snug text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{record.reviewRequiredReason || "Needs staff review"}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SourceEvidencePanel({
  detail,
  selectedRecord,
  isLoading,
  latestAttempt,
  draftPreview,
  parseError,
  isParsing,
  parseDisabled,
  isRejecting,
  rejectDisabled,
  onParse,
  onReject,
}: {
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  latestAttempt: ClientInboundOrderParseAttempt | null;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  parseError: Error | null;
  isParsing: boolean;
  parseDisabled: boolean;
  isRejecting: boolean;
  rejectDisabled: boolean;
  onParse: () => void;
  onReject: () => void;
}) {
  if (!selectedRecord) {
    return <EmptyPanel title="Select a record" detail="Source evidence will appear once an inbound item is selected." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const record = detail?.record ?? selectedRecord;
  const evidence = getManualInboundEvidence(record);
  const warnings = detail?.warnings ?? [];
  const evidenceItems = draftPreview?.draft?.evidence?.items ?? [];
  const attachmentEvidence = evidenceItems.filter((item) => (
    item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT"
  ));
  const evidenceConflicts = draftPreview?.draft?.evidence?.conflicts ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{getRecordTitle(record)}</h2>
              <div className="mt-1 text-xs text-muted-foreground">TEMP_INBOUND / review-first intake</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge variant="secondary">{titleCase(record.sourceType)}</Badge>
              <StatusBadge status={record.status} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={rejectDisabled}
                aria-label="Reject inbound record"
              >
                {isRejecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                )}
                Reject
              </Button>
              <Button type="button" size="sm" onClick={onParse} disabled={parseDisabled}>
                {isParsing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {isParsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <DetailField label="Reference" value={evidence.reference} />
            <DetailField label="Sender" value={getSenderLabel(record)} />
            <DetailField label="Subject" value={evidence.subject} />
            <DetailField label="Source type" value={titleCase(record.sourceType)} />
            <DetailField label="Created" value={formatTimestamp(record.createdAt)} />
            <DetailField label="Updated" value={formatTimestamp(record.updatedAt)} />
          </div>
          <div className="mt-4 rounded-md border border-border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">AI Parse Attempt</div>
              {latestAttempt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={latestAttempt.status === "failed" ? "destructive" : "secondary"}>
                    {titleCase(latestAttempt.status)}
                  </Badge>
                  <Badge variant="outline">{latestAttempt.confidence ?? 0}% confidence</Badge>
                  <Badge variant="outline">{Array.isArray(latestAttempt.warnings) ? latestAttempt.warnings.length : 0} warnings</Badge>
                </div>
              ) : (
                <Badge variant="outline">Not parsed</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {latestAttempt ? `Last attempt ${formatRelative(latestAttempt.createdAt)}` : "No AI parse has been run for this record."}
            </div>
            {isParsing && (
              <div className="mt-2 flex items-center gap-2 text-xs font-medium text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Parsing source evidence...
              </div>
            )}
          </div>
          {!isParsing && (parseError || latestAttempt?.status === "failed") && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Parse unavailable</AlertTitle>
              <AlertDescription>
                {parseError?.message
                  || (Array.isArray(latestAttempt?.errors) && latestAttempt.errors.length > 0
                    ? latestAttempt.errors.map((error: any) => error?.message).filter(Boolean).join(" ")
                    : "AI parsing failed. Source evidence remains available for retry.")}
              </AlertDescription>
            </Alert>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Body Text</h3>
          </div>
          {evidence.bodyText ? (
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
              {evidence.bodyText}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No body text was captured.</div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Notes</h3>
          <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{evidence.notes || "No notes."}</div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Attachments</h3>
            <Badge variant="outline">{detail?.files?.length ?? 0}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {(detail?.files ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No attachments linked to this inbound record.</div>
            ) : (
              (detail?.files ?? []).map((file) => {
                const extracted = attachmentEvidence.find((item) => item.sourceId === file.id);
                return (
                  <div key={file.id} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{file.sourceFilename || "Attachment"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {file.mimeType || "unknown type"} / {file.role}
                        </div>
                        {extracted && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Pages: {extracted.pageCount ?? "-"} / Extraction: {titleCase(extracted.extractionStatus)}
                          </div>
                        )}
                      </div>
                      {extracted ? (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={extracted.documentType === "purchase_order" ? "default" : "outline"}>
                            {titleCase(extracted.documentType)}
                          </Badge>
                          <Badge variant="secondary">{extracted.documentConfidence}%</Badge>
                        </div>
                      ) : (
                        <Badge variant="outline">Not extracted</Badge>
                      )}
                    </div>
                    {extracted?.poSummary && (
                      <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">PO Extraction Summary</div>
                        <PoSummaryGrid summary={extracted.poSummary} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {evidenceConflicts.length > 0 && (
            <div className="mt-3 space-y-2">
              {evidenceConflicts.map((conflict, index) => (
                <div key={`${conflict.code}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <div className="font-medium">{conflict.code}</div>
                  <div className="text-xs">{conflict.message}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Warnings</h3>
            <Badge variant="outline">{warnings.length}</Badge>
          </div>
          <div className="mt-2 space-y-2">
            {warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings.</div>
            ) : (
              warnings.map((warning) => (
                <div key={warning.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="font-medium text-foreground">{warning.code}</div>
                  <div className="text-xs text-muted-foreground">{warning.message}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Audit Trail</h3>
          </div>
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

type ReviewSelectOption = {
  id: string;
  label: string;
  description?: string | null;
};

function candidateToReviewOption(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number]): ReviewSelectOption {
  return {
    id: candidate.id,
    label: candidate.label,
    description: candidate.reason,
  };
}

function customerToReviewOption(customer: InboundMatchedCustomerSummary): ReviewSelectOption {
  return {
    id: customer.id,
    label: customer.companyName || customer.email || customer.id,
    description: [customer.email, customer.phone, customer.status].filter(Boolean).join(" / ") || null,
  };
}

function contactToReviewOption(contact: InboundContactSearchResponse["data"][number]): ReviewSelectOption {
  return {
    id: contact.id,
    label: contact.name || contact.email || contact.id,
    description: [
      contact.email,
      contact.phone ?? contact.mobile,
      contact.isPrimary ? "Primary" : null,
    ].filter(Boolean).join(" / ") || null,
  };
}

function mergeReviewOptions(...groups: ReviewSelectOption[][]): ReviewSelectOption[] {
  const seen = new Set<string>();
  const merged: ReviewSelectOption[] = [];
  groups.flat().forEach((option) => {
    if (!option.id || seen.has(option.id)) return;
    seen.add(option.id);
    merged.push(option);
  });
  return merged;
}

function SearchableReviewSelector({
  label,
  searchLabel,
  searchPlaceholder,
  value,
  searchValue,
  options,
  isLoading,
  disabled,
  onSearchChange,
  onChange,
}: {
  label: string;
  searchLabel: string;
  searchPlaceholder: string;
  value: string | null;
  searchValue: string;
  options: ReviewSelectOption[];
  isLoading: boolean;
  disabled?: boolean;
  onSearchChange: (value: string) => void;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">
        {searchLabel}
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        {label}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={value ?? ""}
          onChange={(event) => onChange(trimToNull(event.target.value))}
          disabled={disabled}
        >
          <option value="">{isLoading ? "Searching..." : "Unselected"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.description ? `${option.label} - ${option.description}` : option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ensurePbv2Selections(value: unknown): LineItemOptionSelectionsV2 {
  if (value && typeof value === "object" && (value as any).schemaVersion === 2 && (value as any).selected) {
    return value as LineItemOptionSelectionsV2;
  }
  return { schemaVersion: 2, selected: {} };
}

function selectionSourceLabel(source: string | null | undefined, note: string | null | undefined): string {
  if (source === "product_default" || note === "Default") return "Default";
  if (source === "deterministic_print_spec_rule" || note === "Deterministic print spec rule") return "Print rule";
  if (source === "source_evidence" || note === "Suggested from PO" || note === "Suggested from inbound source evidence.") return "Suggested from PO";
  if (source === "customer_history") return "Customer history";
  if (source === "staff_selected" || note === "Staff selected") return "Staff selected";
  return "Suggested";
}

function customerSelectionIntro(source: string | null | undefined): string {
  if (source === "interpreted_customer_match" || source === "interpreted_contact_match") return "Auto-selected";
  if (source === "staff_selected") return "Staff selected";
  return "Selection";
}

function markChangedPbv2SelectionsAsStaffSelected(
  next: LineItemOptionSelectionsV2,
  previous: LineItemOptionSelectionsV2,
): LineItemOptionSelectionsV2 {
  return {
    ...next,
    selected: Object.fromEntries(Object.entries(next.selected ?? {}).map(([key, entry]) => {
      const previousValue = previous.selected?.[key]?.value;
      const changed = JSON.stringify(previousValue ?? null) !== JSON.stringify(entry?.value ?? null);
      return [key, changed ? { ...entry, note: "Staff selected" } : entry];
    })),
  };
}

function ReviewLineItemProductOptions({
  lineItem,
  index,
  onChange,
}: {
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number];
  index: number;
  onChange: (patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => void;
}) {
  const productId = lineItem.selectedProductId;
  const query = useQuery({
    queryKey: ["/api/inbound-orders/product-options", productId, index, lineItem.sourceText, lineItem.materialText, lineItem.optionTexts, lineItem.finishingTexts],
    queryFn: () => postJson<InboundOrderProductOptionsResponse>(`/api/inbound-orders/product-options/${productId}`, { lineItem }),
    enabled: Boolean(productId),
  });
  const config = query.data?.data ?? null;
  const selections = ensurePbv2Selections(lineItem.optionSelectionsJson);

  useEffect(() => {
    if (!config || lineItem.optionSelectionsJson) return;
    if (Object.keys(config.suggestedSelections.selected ?? {}).length === 0) return;
    onChange({
      optionSelectionsJson: config.suggestedSelections,
      pbv2TreeVersionId: config.activeTreeVersionId,
      pbv2OptionSuggestions: config.suggestions,
    });
  }, [config, lineItem.optionSelectionsJson, onChange]);

  if (!productId) return null;
  if (query.isLoading) {
    return <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Loading product options...</div>;
  }
  if (query.isError) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Product options could not be loaded.</div>;
  }
  if (!config?.treeJson) {
    return <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">No active PBV2 options found for selected product.</div>;
  }

  const missing = getMissingInboundPbv2RequiredOptions(config.treeJson, selections);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Product options</div>
        {config.suggestions.length > 0 && <Badge variant="outline">{config.suggestions.length} suggested</Badge>}
      </div>
      {config.suggestions.length > 0 && (
        <div className="space-y-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
          {config.suggestions.map((suggestion) => (
            <div key={`${suggestion.selectionKey}-${String(suggestion.value)}`} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{selectionSourceLabel(suggestion.source, null)}</Badge>
              <span>{suggestion.label}: {suggestion.choiceLabel}</span>
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Missing required options: {missing.map((option) => option.label).join(", ")}
        </div>
      )}
      <ProductOptionsPanelV2
        tree={config.treeJson}
        selections={selections}
        onSelectionsChange={(next) => {
          const marked = markChangedPbv2SelectionsAsStaffSelected(next, selections);
          onChange({
            optionSelectionsJson: marked,
            pbv2TreeVersionId: config.activeTreeVersionId,
            pbv2OptionSuggestions: config.suggestions,
          });
        }}
      />
      {Object.entries(selections.selected ?? {}).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(selections.selected).map(([key, entry]) => (
            <Badge key={key} variant="secondary">{key}: {selectionSourceLabel(null, entry?.note)}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftBuilderPanel({
  selectedRecord,
  isLoading,
  draftPreview,
  reviewDraft,
  previewError,
  reviewDraftError,
  isSaving,
  isMarkingReady,
  isReopening,
  isConverting,
  saveError,
  markReadyError,
  convertError,
  onSave,
  onMarkReady,
  onReopen,
  onConvert,
}: {
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  reviewDraft: InboundOrderReviewDraftDto | undefined;
  previewError: Error | null;
  reviewDraftError: Error | null;
  isSaving: boolean;
  isMarkingReady: boolean;
  isReopening: boolean;
  isConverting: boolean;
  saveError: Error | null;
  markReadyError: (Error & { errors?: string[] }) | null;
  convertError: (Error & { errors?: string[] }) | null;
  onSave: (draft: ReviewDraftFormState) => Promise<void>;
  onMarkReady: (draft: ReviewDraftFormState, dirty: boolean) => Promise<void>;
  onReopen: () => Promise<void>;
  onConvert: () => Promise<void>;
}) {
  const [form, setForm] = useState<ReviewDraftFormState | null>(null);
  const [baseForm, setBaseForm] = useState<ReviewDraftFormState | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  useEffect(() => {
    if (!reviewDraft) {
      setForm(null);
      setBaseForm(null);
      return;
    }
    const next = cloneReviewDraft(reviewDraft);
    setForm(next);
    setBaseForm(next);
  }, [reviewDraft?.snapshotId, reviewDraft?.updatedAt, reviewDraft?.status]);

  useEffect(() => {
    setCustomerSearch("");
    setContactSearch("");
  }, [selectedRecord?.id]);

  const draftForSelectors = draftPreview?.draft ?? null;
  const selectedCustomerId = form?.reviewedCustomerJson.selectedCustomerId ?? null;
  const customerSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/customer-search", customerSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (customerSearch.trim()) params.set("search", customerSearch.trim());
      return readJson<InboundCustomerSearchResponse>(`/api/inbound-orders/customer-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftForSelectors && reviewDraft),
  });
  const contactSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/contact-search", selectedCustomerId, contactSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      if (contactSearch.trim()) params.set("search", contactSearch.trim());
      return readJson<InboundContactSearchResponse>(`/api/inbound-orders/contact-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftForSelectors && reviewDraft),
  });

  if (!selectedRecord) {
    return <EmptyPanel title="Draft builder" detail="Draft builder will appear after parsing." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (previewError || reviewDraftError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Draft review unavailable</AlertTitle>
          <AlertDescription>{previewError?.message ?? reviewDraftError?.message}</AlertDescription>
        </Alert>
        <div className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
          Order creation starts in Phase 4.
        </div>
      </div>
    );
  }

  const draft = draftPreview?.draft ?? null;
  const latestAttempt = draftPreview?.latestAttempt ?? null;

  if (!draft) {
    return (
      <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-4 text-sm font-semibold text-foreground">Draft builder will appear after parsing.</div>
        <div className="mt-1 max-w-sm text-sm text-muted-foreground">
          Phase 4 conversion starts after a successful parse and ready review.
        </div>
        {latestAttempt?.status === "failed" && (
          <div className="mt-3 max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Last parse failed. Source evidence remains available for retry.
          </div>
        )}
        <Button type="button" className="mt-4" disabled title="Create Draft Order is available after ready review.">
          Create Draft Order
        </Button>
      </div>
    );
  }

  if (!reviewDraft || !form) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const allWarnings = [
    ...draft.globalWarnings,
    ...draft.customer.warnings,
    ...draft.order.warnings,
    ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
    ...draft.artwork.flatMap((artwork) => artwork.warnings),
  ];
  const customerOptions = mergeReviewOptions(
    draft.customer.customerCandidates.map(candidateToReviewOption),
    (customerSearchQuery.data?.data ?? []).map(customerToReviewOption),
  );
  const contactOptions = mergeReviewOptions(
    draft.customer.contactCandidates.map(candidateToReviewOption),
    (contactSearchQuery.data?.data ?? []).map(contactToReviewOption),
  );
  const dirty = !formStatesEqual(form, baseForm);
  const actionPending = isSaving || isMarkingReady || isReopening || isConverting;
  const validationErrors = markReadyError?.errors ?? reviewDraft.validationErrors ?? [];
  const conversionErrors = convertError?.errors ?? [];
  const canCreateDraftOrder = selectedRecord.status === "ready"
    && reviewDraft.status === "ready_to_convert"
    && validationErrors.length === 0;
  const updateForm = (patch: Partial<ReviewDraftFormState>) => {
    setForm((current) => current ? { ...current, ...patch } : current);
  };
  const updateCustomer = (patch: Partial<ReviewDraftFormState["reviewedCustomerJson"]>) => {
    updateForm({ reviewedCustomerJson: { ...form.reviewedCustomerJson, ...patch } });
  };
  const updateOrder = (patch: Partial<ReviewDraftFormState["reviewedOrderJson"]>) => {
    updateForm({ reviewedOrderJson: { ...form.reviewedOrderJson, ...patch } });
  };
  const updateLineItem = (index: number, patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => {
    updateForm({
      reviewedLineItemsJson: form.reviewedLineItemsJson.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    });
  };
  const updateDecision = (index: number, patch: Partial<ReviewDraftFormState["missingDecisionsJson"][number]>) => {
    updateForm({
      missingDecisionsJson: form.missingDecisionsJson.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    });
  };
  const updateWarning = (index: number, patch: Partial<ReviewDraftFormState["warningsJson"][number]>) => {
    updateForm({
      warningsJson: form.warningsJson.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Phase 4: Create draft order from reviewed inbound record.</AlertTitle>
          <AlertDescription>
            This creates a real draft order only. It does not release production, create proofs, invoices, fulfillment, or payments.
          </AlertDescription>
        </Alert>
        {reviewDraft.hasNewerParse && (
          <Alert>
            <RefreshCw className="h-4 w-4" />
            <AlertTitle>Newer parse available.</AlertTitle>
            <AlertDescription>
              Existing staff edits are preserved. Refresh review draft from latest parse is intentionally manual and not automatic.
            </AlertDescription>
          </Alert>
        )}
        {(saveError || markReadyError) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Review draft action failed</AlertTitle>
            <AlertDescription>{(markReadyError ?? saveError)?.message}</AlertDescription>
          </Alert>
        )}
        {convertError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Draft order creation failed</AlertTitle>
            <AlertDescription>{convertError.message}</AlertDescription>
            {conversionErrors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {conversionErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
          </Alert>
        )}

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Parse Summary</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{latestAttempt?.confidence ?? 0}% confidence</Badge>
              <Badge variant={reviewDraft.status === "ready_to_convert" ? "default" : "outline"}>{titleCase(reviewDraft.status)}</Badge>
              {dirty && <Badge variant="outline">Unsaved changes</Badge>}
              <Badge variant="outline">{allWarnings.length} warnings</Badge>
              <Badge variant="outline">{draft.missingDecisions.length} missing decisions</Badge>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <InlineField label="Status" value={latestAttempt ? titleCase(latestAttempt.status) : "Parsed"} />
            <InlineField label="Parsed" value={latestAttempt ? formatTimestamp(latestAttempt.createdAt) : null} />
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Review Readiness</h3>
            <Badge variant="secondary">{reviewDraft.readinessScore.overall}% overall</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>Customer {reviewDraft.readinessScore.customer}%</span>
            <span>Contact {reviewDraft.readinessScore.contact}%</span>
            <span>Product {reviewDraft.readinessScore.product}%</span>
            <span>Options {reviewDraft.readinessScore.options}%</span>
            <span>Artwork {reviewDraft.readinessScore.artwork.label}</span>
          </div>
        </section>

        <FieldSourceSection draft={draft} />

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Customer</h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Source name
              <Input value={form.reviewedCustomerJson.sourceName ?? ""} onChange={(event) => updateCustomer({ sourceName: trimToNull(event.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Source email
              <Input value={form.reviewedCustomerJson.sourceEmail ?? ""} onChange={(event) => updateCustomer({ sourceEmail: trimToNull(event.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Company
              <Input value={form.reviewedCustomerJson.companyName ?? ""} onChange={(event) => updateCustomer({ companyName: trimToNull(event.target.value) })} />
            </label>
            <SearchableReviewSelector
              label="Selected customer"
              searchLabel="Customer search"
              searchPlaceholder="Search all customers"
              value={form.reviewedCustomerJson.selectedCustomerId}
              searchValue={customerSearch}
              options={customerOptions}
              isLoading={customerSearchQuery.isFetching}
              onSearchChange={setCustomerSearch}
              onChange={(customerId) => updateCustomer({
                selectedCustomerId: customerId,
                selectedCustomerSource: customerId ? "staff_selected" : null,
                selectedCustomerReason: customerId ? "Staff selected customer." : null,
                selectedCustomerConfidence: null,
                selectedContactId: null,
                selectedContactSource: null,
                selectedContactReason: null,
                selectedContactConfidence: null,
                unresolvedCustomer: false,
              })}
            />
            {form.reviewedCustomerJson.selectedCustomerId && form.reviewedCustomerJson.selectedCustomerReason && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{customerSelectionIntro(form.reviewedCustomerJson.selectedCustomerSource)} customer</div>
                <div>
                  {form.reviewedCustomerJson.selectedCustomerReason}
                  {form.reviewedCustomerJson.selectedCustomerConfidence != null ? ` Confidence ${form.reviewedCustomerJson.selectedCustomerConfidence}%.` : ""}
                </div>
              </div>
            )}
            <SearchableReviewSelector
              label="Selected contact"
              searchLabel="Contact search"
              searchPlaceholder={form.reviewedCustomerJson.selectedCustomerId ? "Search contacts for selected customer" : "Search all contacts"}
              value={form.reviewedCustomerJson.selectedContactId}
              searchValue={contactSearch}
              options={contactOptions}
              isLoading={contactSearchQuery.isFetching}
              onSearchChange={setContactSearch}
              onChange={(contactId) => updateCustomer({
                selectedContactId: contactId,
                selectedContactSource: contactId ? "staff_selected" : null,
                selectedContactReason: contactId ? "Staff selected contact." : null,
                selectedContactConfidence: null,
                unresolvedContact: false,
              })}
            />
            {form.reviewedCustomerJson.selectedContactId && form.reviewedCustomerJson.selectedContactReason && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{customerSelectionIntro(form.reviewedCustomerJson.selectedContactSource)} contact</div>
                <div>
                  {form.reviewedCustomerJson.selectedContactReason}
                  {form.reviewedCustomerJson.selectedContactConfidence != null ? ` Confidence ${form.reviewedCustomerJson.selectedContactConfidence}%.` : ""}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.reviewedCustomerJson.unresolvedCustomer}
                onChange={(event) => updateCustomer({
                  unresolvedCustomer: event.target.checked,
                  selectedCustomerId: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerId,
                  selectedCustomerSource: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerSource,
                  selectedCustomerReason: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerReason,
                  selectedCustomerConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerConfidence,
                  selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                  selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                  selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                  selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                })}
              />
              Customer unresolved
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.reviewedCustomerJson.unresolvedContact ?? false}
                onChange={(event) => updateCustomer({
                  unresolvedContact: event.target.checked,
                  selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                  selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                  selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                  selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                })}
              />
              Contact unresolved
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Customer review notes
              <Textarea value={form.reviewedCustomerJson.notes ?? ""} onChange={(event) => updateCustomer({ notes: trimToNull(event.target.value) })} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            <CandidateList title="Customers" candidates={draft.customer.customerCandidates} />
            <CandidateList title="Contacts" candidates={draft.customer.contactCandidates} />
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Order Details</h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">PO number<Input value={form.reviewedOrderJson.poNumber ?? ""} onChange={(event) => updateOrder({ poNumber: trimToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Due date<Input type="date" value={form.reviewedOrderJson.dueDate ?? ""} onChange={(event) => updateOrder({ dueDate: trimToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Ship method<Input value={form.reviewedOrderJson.shipMethod ?? ""} onChange={(event) => updateOrder({ shipMethod: trimToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Pickup / shipping
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedOrderJson.fulfillmentType} onChange={(event) => updateOrder({ fulfillmentType: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["fulfillmentType"] })}>
                <option value="unknown">Unknown</option>
                <option value="pickup">Pickup</option>
                <option value="shipping">Shipping</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">Internal notes<Textarea value={form.reviewedOrderJson.internalNotes ?? ""} onChange={(event) => updateOrder({ internalNotes: trimToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Customer notes<Textarea value={form.reviewedOrderJson.customerNotes ?? ""} onChange={(event) => updateOrder({ customerNotes: trimToNull(event.target.value) })} /></label>
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
            <Badge variant="outline">{draft.lineItems.length}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {draft.lineItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">No line items detected.</div>
            ) : (
              form.reviewedLineItemsJson.map((lineItem, index) => {
                const parsedLine = draft.lineItems[index];
                const primaryInterpretedProductId = lineItem.interpretedProductId ?? lineItem.selectedProductId;
                const primaryInterpretedProductLabel = lineItem.productName || primaryInterpretedProductId;
                const productOptions = mergeReviewOptions(
                  (parsedLine?.productCandidates ?? []).map(candidateToReviewOption),
                  lineItem.selectedProductId && !(parsedLine?.productCandidates ?? []).some((candidate) => candidate.id === lineItem.selectedProductId)
                    ? [{
                        id: lineItem.selectedProductId,
                        label: lineItem.productName || lineItem.selectedProductId,
                        description: lineItem.interpretedProductReason,
                      }]
                    : [],
                );
                return (
                <div key={index} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">
                      {lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`}
                    </h4>
                    {parsedLine && <Badge variant="secondary">{parsedLine.confidence}% confidence</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Product candidate
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={lineItem.selectedProductId ?? ""} onChange={(event) => updateLineItem(index, {
                        selectedProductId: trimToNull(event.target.value),
                        interpretedProductId: null,
                        interpretedProductReason: trimToNull(event.target.value) ? "Staff selected product. Candidate ranking is advisory." : null,
                        interpretedProductConfidence: null,
                        optionSelectionsJson: null,
                        pbv2TreeVersionId: null,
                        pbv2OptionSuggestions: [],
                      })}>
                        <option value="">Unselected</option>
                        {productOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.description ? `${option.label} - ${option.description}` : option.label}</option>
                        ))}
                      </select>
                    </label>
                    {primaryInterpretedProductId && lineItem.interpretedProductReason && (
                      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        <div className="mb-1 font-semibold text-foreground">Primary Interpreted Product</div>
                        <div>{primaryInterpretedProductLabel}</div>
                        {lineItem.interpretedProductReason}
                        {lineItem.interpretedProductConfidence != null ? ` (${lineItem.interpretedProductConfidence}% confidence)` : ""}
                      </div>
                    )}
                    <ReviewLineItemProductOptions
                      lineItem={lineItem}
                      index={index}
                      onChange={(patch) => updateLineItem(index, patch)}
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={lineItem.productUnresolved} onChange={(event) => updateLineItem(index, { productUnresolved: event.target.checked })} />
                      Product unresolved
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">Quantity<Input value={lineItem.quantity ?? ""} onChange={(event) => updateLineItem(index, { quantity: optionalNumber(event.target.value) })} /></label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1 text-xs text-muted-foreground">Width<Input value={lineItem.width ?? ""} onChange={(event) => updateLineItem(index, { width: optionalNumber(event.target.value) })} /></label>
                      <label className="space-y-1 text-xs text-muted-foreground">Height<Input value={lineItem.height ?? ""} onChange={(event) => updateLineItem(index, { height: optionalNumber(event.target.value) })} /></label>
                      <label className="space-y-1 text-xs text-muted-foreground">Unit<Input value={lineItem.dimensionsUnit ?? ""} onChange={(event) => updateLineItem(index, { dimensionsUnit: trimToNull(event.target.value) })} /></label>
                    </div>
                    <label className="space-y-1 text-xs text-muted-foreground">Material<Input value={lineItem.materialText ?? ""} onChange={(event) => updateLineItem(index, { materialText: trimToNull(event.target.value) })} /></label>
                    <label className="space-y-1 text-xs text-muted-foreground">Print specs<Input value={lineItem.printSpecs.join(", ")} onChange={(event) => updateLineItem(index, { printSpecs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
                    <label className="space-y-1 text-xs text-muted-foreground">Options<Input value={lineItem.optionTexts.join(", ")} onChange={(event) => updateLineItem(index, { optionTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
                    <label className="space-y-1 text-xs text-muted-foreground">Finishing<Input value={lineItem.finishingTexts.join(", ")} onChange={(event) => updateLineItem(index, { finishingTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
                    <label className="space-y-1 text-xs text-muted-foreground">Line item notes<Textarea value={lineItem.notes ?? ""} onChange={(event) => updateLineItem(index, { notes: trimToNull(event.target.value) })} /></label>
                  </div>
                  {parsedLine && <div className="mt-3"><ProductMatchReasoning candidates={parsedLine.productCandidates} /></div>}
                </div>
              );})
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Artwork / References</h3>
            <Badge variant="outline">{draft.artwork.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {form.reviewedArtworkJson.refs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No artwork references detected.</div>
            ) : (
              form.reviewedArtworkJson.refs.map((artwork, index) => (
                <div key={index} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{artwork.filename || artwork.sourceReference || `Artwork ${index + 1}`}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {titleCase(artwork.purpose)} / line {artwork.likelyLineItemIndex !== null ? artwork.likelyLineItemIndex + 1 : "-"}
                  </div>
                </div>
              ))
            )}
            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
              Artwork status
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedArtworkJson.status} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, status: event.target.value as ReviewDraftFormState["reviewedArtworkJson"]["status"] } })}>
                <option value="supplied">Supplied</option>
                <option value="to_follow">To follow</option>
                <option value="missing">Missing</option>
                <option value="not_required">Not required</option>
              </select>
            </label>
            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">Artwork notes<Textarea value={form.reviewedArtworkJson.notes ?? ""} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, notes: trimToNull(event.target.value) } })} /></label>
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Missing Decisions</h3>
            <Badge variant="outline">{draft.missingDecisions.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {form.missingDecisionsJson.length === 0 ? (
              <div className="text-sm text-muted-foreground">No missing decisions detected.</div>
            ) : (
              form.missingDecisionsJson.map((decision, index) => (
                <div key={decision.field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{decision.label}</div>
                    <Badge variant={decision.severity === "blocking" ? "destructive" : "outline"}>
                      {titleCase(decision.severity)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{decision.reason}</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={decision.status} onChange={(event) => updateDecision(index, { status: event.target.value as ReviewDraftFormState["missingDecisionsJson"][number]["status"] })}>
                      <option value="resolved">Resolved</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="still_blocking">Still blocking</option>
                    </select>
                    <Textarea value={decision.resolutionNote ?? ""} onChange={(event) => updateDecision(index, { resolutionNote: trimToNull(event.target.value) })} placeholder="Resolution note" />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Warnings</h3>
            <Badge variant="outline">{allWarnings.length}</Badge>
          </div>
          <div className="space-y-2">
            {form.warningsJson.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings.</div>
            ) : (
              form.warningsJson.map((warning, index) => (
                <div key={`${warning.code}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{warning.code}</div>
                  <div className="text-xs text-muted-foreground">{warning.message}</div>
                  <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={warning.acknowledged} onChange={(event) => updateWarning(index, { acknowledged: event.target.checked })} />
                    Acknowledged
                  </label>
                </div>
              ))
            )}
          </div>
        </section>

        {validationErrors.length > 0 && (
          <section className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <h3 className="text-sm font-semibold text-destructive">Ready validation</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-destructive">
              {validationErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </section>
        )}

        <section className="sticky bottom-0 z-10 rounded-md border border-border bg-background p-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)]">
          <label className="space-y-1 text-xs text-muted-foreground">Review notes<Textarea value={form.reviewNotes ?? ""} onChange={(event) => updateForm({ reviewNotes: trimToNull(event.target.value) })} /></label>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" onClick={() => { void onSave(form).catch(() => undefined); }} disabled={!dirty || actionPending}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Review Draft
            </Button>
            {reviewDraft.status === "ready_to_convert" ? (
              <Button type="button" variant="outline" onClick={() => { void onReopen().catch(() => undefined); }} disabled={actionPending}>
                {isReopening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reopen Draft
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => { void onMarkReady(form, dirty).catch(() => undefined); }} disabled={actionPending}>
                {isMarkingReady && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark Ready to Convert
              </Button>
            )}
          </div>
          <Button
            type="button"
            className="mt-3 w-full"
            onClick={() => { void onConvert().catch(() => undefined); }}
            disabled={!canCreateDraftOrder || actionPending}
            title={canCreateDraftOrder ? "Create a draft order from this reviewed inbound record." : "Mark the inbound draft ready and resolve validation errors first."}
          >
            {isConverting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isConverting ? "Creating Draft Order..." : "Create Draft Order"}
          </Button>
        </section>
      </div>
    </ScrollArea>
  );
}

export default function InboundOrdersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(defaultQueueFilters);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [parsingRecordId, setParsingRecordId] = useState<string | null>(null);
  const [lastConvertedOrderId, setLastConvertedOrderId] = useState<string | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(() => (
    readStoredBoolean(workspaceLayoutStorageKeys.queueCollapsed, false)
  ));
  const [evidenceWidth, setEvidenceWidth] = useState(() => (
    readStoredNumber(
      workspaceLayoutStorageKeys.evidenceWidth,
      workspaceLayoutDefaults.evidenceWidth,
      workspaceLayoutDefaults.compactEvidenceWidth,
    )
  ));
  const [draftWidth, setDraftWidth] = useState(() => (
    readStoredNumber(
      workspaceLayoutStorageKeys.draftWidth,
      workspaceLayoutDefaults.draftWidth,
      workspaceLayoutDefaults.compactDraftWidth,
    )
  ));
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const parseInFlightRef = useRef(false);
  const listUrl = useMemo(() => buildInboundOrderListUrl(queueFilters), [queueFilters]);

  const listQuery = useQuery({
    queryKey: ["/api/inbound-orders", queueFilters],
    queryFn: () => readJson<ClientInboundOrdersListResponse>(listUrl),
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

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.queueCollapsed, String(queueCollapsed));
  }, [queueCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.evidenceWidth, String(evidenceWidth));
  }, [evidenceWidth]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.draftWidth, String(draftWidth));
  }, [draftWidth]);

  useEffect(() => {
    const measureWorkspace = () => {
      const measuredWidth = getVisibleWorkspaceWidth(workspaceRef.current);
      setWorkspaceWidth(measuredWidth > 0 ? measuredWidth : window.innerWidth);
    };

    measureWorkspace();
    const observer = typeof ResizeObserver !== "undefined" && workspaceRef.current
      ? new ResizeObserver(measureWorkspace)
      : null;
    if (workspaceRef.current) observer?.observe(workspaceRef.current);
    window.addEventListener("resize", measureWorkspace);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureWorkspace);
    };
  }, []);

  useEffect(() => {
    const reconcileToViewport = () => {
      const measuredWidth = getMeasuredWorkspaceWidth(workspaceWidth);
      if (measuredWidth < workspaceLayoutDefaults.desktopBreakpoint) return;
      const next = reconcileWorkspacePanelWidths({
        evidenceWidth,
        draftWidth,
        queueCollapsed,
        workspaceWidth: measuredWidth,
      });

      if (next.evidenceWidth !== evidenceWidth) setEvidenceWidth(next.evidenceWidth);
      if (next.draftWidth !== draftWidth) setDraftWidth(next.draftWidth);
    };

    reconcileToViewport();
    window.addEventListener("resize", reconcileToViewport);
    return () => window.removeEventListener("resize", reconcileToViewport);
  }, [queueCollapsed, evidenceWidth, draftWidth, workspaceWidth]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const detailQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId],
    queryFn: () => readJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const draftPreviewQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId, "draft-preview"],
    queryFn: () => readJson<ClientInboundOrderDraftPreviewResponse>(`/api/inbound-orders/${selectedId}/draft-preview`),
    enabled: Boolean(selectedId),
  });

  const reviewDraftQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId, "review-draft"],
    queryFn: () => readJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${selectedId}/review-draft`),
    enabled: Boolean(selectedId && draftPreviewQuery.data?.data.draft),
  });

  const createManualMutation = useMutation({
    mutationFn: (payload: ManualInboundOrderCreateRequest) => (
      postJson<ManualInboundOrderCreateResponse>("/api/inbound-orders/manual", payload)
    ),
    onSuccess: async (response) => {
      const createdRecordId = response.data.record.id;
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await listQuery.refetch();
      setSelectedId(createdRecordId);
    },
  });

  const parseMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderParseResponse>(`/api/inbound-orders/${recordId}/parse`, {}),
    onSuccess: async (response) => {
      const parsedRecordId = response.data.record.id;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId, "review-draft"] }),
      ]);
      queryClient.setQueryData(["/api/inbound-orders", parsedRecordId, "draft-preview"], {
        success: true,
        data: {
          draft: response.data.draft,
          latestAttempt: response.data.latestAttempt,
        },
      } satisfies ClientInboundOrderDraftPreviewResponse);
      setSelectedId(parsedRecordId);
    },
    onSettled: () => {
      parseInFlightRef.current = false;
      setParsingRecordId(null);
    },
  });

  const saveReviewDraftMutation = useMutation({
    mutationFn: ({ recordId, draft }: { recordId: string; draft: ReviewDraftFormState }) => (
      putJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft`, draft)
    ),
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId, "review-draft"], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId] });
    },
  });

  const markReviewDraftReadyMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft/mark-ready`, {}),
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(["/api/inbound-orders", recordId, "review-draft"], response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
      ]);
    },
  });

  const reopenReviewDraftMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft/reopen`, {}),
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(["/api/inbound-orders", recordId, "review-draft"], response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
      ]);
    },
  });

  const rejectInboundOrderMutation = useMutation({
    mutationFn: ({ recordId, reason }: { recordId: string; reason: string | null }) => (
      postJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${recordId}/reject`, { reason })
    ),
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      if (queueFilters.statusGroup === "rejected") {
        setSelectedId(variables.recordId);
      } else {
        setSelectedId(null);
      }
    },
  });

  const convertToOrderMutation = useMutation({
    mutationFn: (recordId: string) => (
      postJson<InboundOrderConvertToOrderResponse>(`/api/inbound-orders/${recordId}/convert-to-order`, {})
    ),
    onSuccess: async (response, recordId) => {
      const orderId = response.data.orderId;
      setLastConvertedOrderId(orderId);
      if (response.data.inbound) {
        queryClient.setQueryData(["/api/inbound-orders", recordId], {
          success: true,
          data: response.data.inbound as any,
        } satisfies ClientInboundOrderDetailResponse);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] });
      toast({
        title: response.data.alreadyConverted ? "Draft order already exists" : "Draft order created",
        description: "Draft order created. Proofs, production, invoices, and fulfillment were not started.",
      });
      if (queueFilters.statusGroup === "converted") {
        setSelectedId(recordId);
      } else {
        setSelectedId(null);
      }
    },
  });

  const isParseInFlight = Boolean(parsingRecordId) || parseMutation.isPending;
  const isSelectedRecordParsing = Boolean(selectedId && parsingRecordId === selectedId);
  const selectedRecordIsTerminal = Boolean(
    selectedRecord
      && (
        selectedRecord.status === "terminal"
        || selectedRecord.status === "submitted"
        || selectedRecord.status === "approved"
        || selectedRecord.createdQuoteId
        || selectedRecord.createdOrderId
      ),
  );
  const runParseForSelectedRecord = () => {
    if (!selectedId || parseInFlightRef.current) return;
    parseInFlightRef.current = true;
    setParsingRecordId(selectedId);
    parseMutation.mutate(selectedId);
  };
  const rejectSelectedRecord = () => {
    if (!selectedId || rejectInboundOrderMutation.isPending || selectedRecordIsTerminal) return;
    const reason = window.prompt("Optional reason for removing this inbound record from the active queue:");
    if (reason === null) return;
    rejectInboundOrderMutation.mutate({ recordId: selectedId, reason: trimToNull(reason) });
  };
  const convertSelectedRecordToOrder = async () => {
    if (!selectedId || convertToOrderMutation.isPending) return;
    const confirmed = window.confirm("Create a draft order from this reviewed inbound record? This will create a real order but will not release production, create proofs, invoices, fulfillment, or payments.");
    if (!confirmed) return;
    await convertToOrderMutation.mutateAsync(selectedId);
  };

  const startResize = (
    panel: "evidence" | "draft",
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startingEvidenceWidth = evidenceWidth;
    const startingDraftWidth = draftWidth;
    const measuredWidth = getMeasuredWorkspaceWidth(workspaceWidth);
    const availablePanelWidth = getWorkspaceAvailablePanelWidth({ queueCollapsed, workspaceWidth: measuredWidth });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const minimums = getWorkspacePanelMinimums({ queueCollapsed, workspaceWidth: measuredWidth });
      if (panel === "evidence") {
        const nextEvidenceWidth = clampWorkspaceWidth(
          startingEvidenceWidth + delta,
          minimums.evidence,
          Math.max(minimums.evidence, availablePanelWidth - minimums.draft),
        );
        setEvidenceWidth(nextEvidenceWidth);
        setDraftWidth(Math.max(minimums.draft, Math.round(availablePanelWidth - nextEvidenceWidth)));
        return;
      }
      const nextDraftWidth = clampWorkspaceWidth(
        startingDraftWidth - delta,
        minimums.draft,
        Math.max(minimums.draft, availablePanelWidth - minimums.evidence),
      );
      setDraftWidth(nextDraftWidth);
      setEvidenceWidth(Math.max(minimums.evidence, Math.round(availablePanelWidth - nextDraftWidth)));
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const restoreLayout = () => {
    setQueueCollapsed(false);
    setEvidenceWidth(workspaceLayoutDefaults.evidenceWidth);
    setDraftWidth(workspaceLayoutDefaults.draftWidth);
  };

  const expandEvidence = () => {
    setQueueCollapsed(true);
    setEvidenceWidth(720);
    setDraftWidth(workspaceLayoutDefaults.minDraftWidth);
  };

  const expandDraftBuilder = () => {
    setQueueCollapsed(true);
    setEvidenceWidth(workspaceLayoutDefaults.minEvidenceWidth);
    setDraftWidth(720);
  };

  const pageError = getErrorTone(
    (listQuery.error as Error | null)
      || (detailQuery.error as Error | null)
      || (draftPreviewQuery.error as Error | null),
  );
  const listError = getErrorTone(listQuery.error as Error | null);
  const queueWidth = getWorkspaceQueueWidth(queueCollapsed);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold tracking-normal text-foreground">Inbound Orders</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">TEMP_INBOUND review queue</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => setManualDialogOpen(true)} disabled={Boolean(listError)}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                listQuery.refetch();
                if (selectedId) detailQuery.refetch();
                if (selectedId) draftPreviewQuery.refetch();
                if (selectedId) reviewDraftQuery.refetch();
              }}
              disabled={listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching || reviewDraftQuery.isFetching}
            >
              {listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching || reviewDraftQuery.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
        {pageError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Inbound queue unavailable</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        )}
        {lastConvertedOrderId && (
          <Alert className="mt-3">
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Draft order created</AlertTitle>
            <AlertDescription>
              <a className="font-medium text-primary underline" href={`/orders/${lastConvertedOrderId}`}>
                Open created order
              </a>
            </AlertDescription>
          </Alert>
        )}
      </header>

      <div
        ref={workspaceRef}
        className="flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden min-[1180px]:flex-row"
        data-testid="inbound-review-workspace"
        style={{
          "--workspace-queue-width": `${queueWidth}px`,
          "--workspace-evidence-width": `${evidenceWidth}px`,
          "--workspace-draft-width": `${draftWidth}px`,
        } as CSSProperties}
      >
        <section
          className={cn(
            "flex min-w-0 shrink-0 flex-col overflow-hidden border-b border-border min-[1180px]:h-full min-[1180px]:w-[var(--workspace-queue-width)] min-[1180px]:min-w-[var(--workspace-queue-width)] min-[1180px]:max-w-[var(--workspace-queue-width)] min-[1180px]:border-b-0 min-[1180px]:border-r",
            queueCollapsed ? "h-14 min-[1180px]:h-full" : "min-h-[300px] flex-1 min-[1180px]:min-h-0 min-[1180px]:flex-none",
          )}
          data-testid="inbound-queue-panel"
          style={{
            width: `${queueWidth}px`,
            minWidth: `${queueWidth}px`,
            maxWidth: `${queueWidth}px`,
            flex: `0 0 ${queueWidth}px`,
          } as CSSProperties}
        >
          {queueCollapsed ? (
            <div className="flex h-14 items-center gap-3 px-3 py-2 min-[1180px]:h-full min-[1180px]:flex-col min-[1180px]:px-2 min-[1180px]:py-3" aria-label="Collapsed inbound queue">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setQueueCollapsed(false)}
                aria-label="Expand inbound queue"
                title="Expand queue"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted">
                <Inbox className="h-4 w-4 text-muted-foreground" />
              </div>
              <Badge variant="outline">{records.length}</Badge>
            </div>
          ) : (
            <>
              <div className="flex h-12 items-center justify-between border-b border-border px-4">
                <div className="text-sm font-semibold text-foreground">Inbound Queue</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{records.length}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setQueueCollapsed(true)}
                    aria-label="Collapse inbound queue"
                    title="Collapse queue"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <QueueTriageControls
                  filters={queueFilters}
                  summary={queueSummary}
                  isLoading={listQuery.isFetching}
                  onChange={setQueueFilters}
                />
                <div className="min-h-0 flex-1">
                  {listQuery.isLoading ? (
                    <QueueSkeleton />
                  ) : (
                    <InboundQueuePanel records={records} selectedId={selectedId} onSelect={setSelectedId} />
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        <section
          className="relative flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden border-b border-border min-[1180px]:h-full min-[1180px]:min-h-0 min-[1180px]:basis-[var(--workspace-evidence-width)] min-[1180px]:border-b-0 min-[1180px]:border-r min-[1500px]:min-w-[420px]"
          data-testid="inbound-evidence-panel"
          style={{ flex: `1 1 ${evidenceWidth}px` } as CSSProperties}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Source Evidence</div>
            <div className="flex items-center gap-2">
              {selectedRecord && <Badge variant="secondary">{titleCase(selectedRecord.sourceType)}</Badge>}
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={expandEvidence} aria-label="Expand evidence panel" title="Expand evidence">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <SourceEvidencePanel
              detail={detailQuery.data?.data}
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading}
              latestAttempt={draftPreviewQuery.data?.data.latestAttempt ?? null}
              draftPreview={draftPreviewQuery.data?.data}
              parseError={parseMutation.error as Error | null}
              isParsing={isSelectedRecordParsing}
              parseDisabled={isParseInFlight || selectedRecordIsTerminal}
              isRejecting={rejectInboundOrderMutation.isPending}
              rejectDisabled={rejectInboundOrderMutation.isPending || selectedRecordIsTerminal}
              onParse={runParseForSelectedRecord}
              onReject={rejectSelectedRecord}
            />
          </div>
          <button
            type="button"
            className="absolute right-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 min-[1180px]:flex"
            onMouseDown={(event) => startResize("evidence", event)}
            aria-label="Resize evidence panel"
            title="Drag to resize evidence"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </section>

        <section
          className="relative flex min-h-[320px] min-w-0 flex-[1.1_1_0] flex-col overflow-hidden min-[1180px]:h-full min-[1180px]:min-h-0 min-[1180px]:basis-[var(--workspace-draft-width)] min-[1500px]:min-w-[480px]"
          data-testid="inbound-draft-panel"
          style={{ flex: `1.1 1 ${draftWidth}px` } as CSSProperties}
        >
          <button
            type="button"
            className="absolute left-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 min-[1180px]:flex"
            onMouseDown={(event) => startResize("draft", event)}
            aria-label="Resize draft builder panel"
            title="Drag to resize draft builder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Draft Builder</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={expandDraftBuilder} aria-label="Expand draft builder panel" title="Expand draft builder">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={restoreLayout} aria-label="Restore inbound workspace layout" title="Restore layout">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Badge variant="outline">Phase 4</Badge>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <DraftBuilderPanel
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading || draftPreviewQuery.isLoading || reviewDraftQuery.isLoading}
              draftPreview={draftPreviewQuery.data?.data}
              reviewDraft={reviewDraftQuery.data?.data}
              previewError={draftPreviewQuery.error as Error | null}
              reviewDraftError={reviewDraftQuery.error as Error | null}
              isSaving={saveReviewDraftMutation.isPending}
              isMarkingReady={markReviewDraftReadyMutation.isPending}
              isReopening={reopenReviewDraftMutation.isPending}
              isConverting={convertToOrderMutation.isPending}
              saveError={saveReviewDraftMutation.error as Error | null}
              markReadyError={markReviewDraftReadyMutation.error as (Error & { errors?: string[] }) | null}
              convertError={convertToOrderMutation.error as (Error & { errors?: string[] }) | null}
              onSave={async (draft) => {
                if (!selectedId) return;
                await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
              }}
              onMarkReady={async (draft, dirty) => {
                if (!selectedId) return;
                if (dirty) {
                  await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
                }
                await markReviewDraftReadyMutation.mutateAsync(selectedId);
              }}
              onReopen={async () => {
                if (!selectedId) return;
                await reopenReviewDraftMutation.mutateAsync(selectedId);
              }}
              onConvert={convertSelectedRecordToOrder}
            />
          </div>
        </section>
      </div>

      <ManualIntakeDialog
        open={manualDialogOpen}
        isCreating={createManualMutation.isPending}
        error={createManualMutation.error as Error | null}
        onClose={() => setManualDialogOpen(false)}
        onCreate={(payload) => createManualMutation.mutateAsync(payload).then(() => undefined)}
      />
    </div>
  );
}
