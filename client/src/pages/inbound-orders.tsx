import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
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
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  getManualInboundEvidence,
  type InboundOrderDetailResponse,
  type InboundOrderDraftPreviewResponse,
  type InboundOrderParsedDraft,
  type InboundOrderParseResponse,
  type InboundOrdersListResponse,
  type InboundOrderStatusGroup,
  type InboundOrderQueueSummary,
  type ManualInboundOrderCreateRequest,
  type ManualInboundOrderCreateResponse,
} from "@shared/inboundOrdersApi";
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

type ClientInboundOrderParseResponse = Omit<InboundOrderParseResponse, "data"> & {
  data: Omit<InboundOrderParseResponse["data"], "record"> & {
    record: ClientInboundOrderRecord;
  };
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

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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
    { value: "all", label: "All", count: null },
    { value: "needs_review", label: "Needs Review", count: summary?.needsReview ?? 0 },
    { value: "waiting", label: "Waiting", count: summary?.waitingOnCustomer ?? 0 },
    { value: "ready", label: "Ready", count: summary?.readyReviewed ?? 0 },
    { value: "converted", label: "Converted", count: summary?.convertedSubmitted ?? 0 },
    { value: "rejected", label: "Rejected", count: summary?.rejectedTerminal ?? 0 },
  ];

  return (
    <div className="space-y-3 border-b border-border p-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          value={filters.search}
          onChange={(event) => setFilter({ search: event.target.value })}
          placeholder="Search reference, sender, notes, subject, body"
          disabled={isLoading}
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {statusButtons.map((button) => (
          <Button
            key={button.value}
            type="button"
            size="sm"
            variant={filters.statusGroup === button.value ? "default" : "outline"}
            onClick={() => setFilter({ statusGroup: button.value })}
          >
            {button.label}
            {button.count !== null && <Badge variant="secondary" className="ml-2">{button.count}</Badge>}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          value={filters.sourceType}
          onChange={(event) => setFilter({ sourceType: event.target.value as QueueFilters["sourceType"] })}
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
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {records.map((record) => {
          const evidence = getManualInboundEvidence(record);
          return (
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
                  <div className="truncate text-sm font-semibold text-foreground">{getRecordTitle(record)}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{getSenderLabel(record)}</div>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Source</div>
                  <div className="truncate font-medium text-foreground">{titleCase(record.sourceType)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Reference</div>
                  <div className="truncate font-medium text-foreground">{evidence.reference || "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="truncate font-medium text-foreground">{formatRelative(record.createdAt)}</div>
                </div>
              </div>
              {record.requiresHumanDecision && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="line-clamp-2">{record.reviewRequiredReason || "Needs staff review"}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function SourceEvidencePanel({
  detail,
  selectedRecord,
  isLoading,
  latestAttempt,
  parseError,
  isParsing,
  parseDisabled,
  onParse,
}: {
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  latestAttempt: ClientInboundOrderParseAttempt | null;
  parseError: Error | null;
  isParsing: boolean;
  parseDisabled: boolean;
  onParse: () => void;
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

function DraftBuilderPanel({
  selectedRecord,
  isLoading,
  draftPreview,
  previewError,
}: {
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  previewError: Error | null;
}) {
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

  if (previewError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Draft preview unavailable</AlertTitle>
          <AlertDescription>{previewError.message}</AlertDescription>
        </Alert>
        <div className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
          Phase 2: parsing only. Order creation is disabled.
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
          Phase 2: parsing only. Order creation is disabled.
        </div>
        {latestAttempt?.status === "failed" && (
          <div className="mt-3 max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Last parse failed. Source evidence remains available for retry.
          </div>
        )}
        <Button type="button" className="mt-4" disabled>
          Create Draft Order
        </Button>
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

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Phase 2: parsing only. Order creation is disabled.</AlertTitle>
          <AlertDescription>
            Review candidate matches and missing decisions here. This panel does not create customers, products, orders, production jobs, fulfillment, or invoices.
          </AlertDescription>
        </Alert>

        <section className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Parse Summary</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{latestAttempt?.confidence ?? 0}% confidence</Badge>
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
          <h3 className="text-sm font-semibold text-foreground">Customer Match Candidates</h3>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <InlineField label="Source name" value={draft.customer.sourceName} />
            <InlineField label="Source email" value={draft.customer.sourceEmail} />
            <InlineField label="Company" value={draft.customer.companyName} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            <CandidateList title="Customers" candidates={draft.customer.customerCandidates} />
            <CandidateList title="Contacts" candidates={draft.customer.contactCandidates} />
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Order Details</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <InlineField label="PO number" value={draft.order.poNumber} />
            <InlineField label="Due date" value={draft.order.requestedDueDate} />
            <InlineField label="Ship method" value={draft.order.requestedShipMethod} />
            <InlineField label="Pickup" value={draft.order.requestedPickup} />
          </div>
          {draft.order.notes && (
            <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-sm text-foreground">
              {draft.order.notes}
            </div>
          )}
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
              draft.lineItems.map((lineItem, index) => (
                <div key={index} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">
                      {lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`}
                    </h4>
                    <Badge variant="secondary">{lineItem.confidence}% confidence</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <InlineField label="Quantity" value={lineItem.quantity} />
                    <InlineField
                      label="Dimensions"
                      value={lineItem.width && lineItem.height
                        ? `${lineItem.width} x ${lineItem.height}${lineItem.dimensionsUnit ? ` ${lineItem.dimensionsUnit}` : ""}`
                        : null}
                    />
                    <InlineField label="Material" value={lineItem.materialText} />
                    <InlineField label="Artwork refs" value={lineItem.artworkRefs.join(", ") || null} />
                  </div>
                  <div className="mt-3">
                    <CandidateList title="Products" candidates={lineItem.productCandidates} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Artwork / References</h3>
            <Badge variant="outline">{draft.artwork.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {draft.artwork.length === 0 ? (
              <div className="text-sm text-muted-foreground">No artwork references detected.</div>
            ) : (
              draft.artwork.map((artwork, index) => (
                <div key={index} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{artwork.filename || artwork.sourceReference || `Artwork ${index + 1}`}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {titleCase(artwork.purpose)} / line {artwork.likelyLineItemIndex !== null ? artwork.likelyLineItemIndex + 1 : "-"} / {artwork.confidence}% confidence
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Missing Decisions</h3>
            <Badge variant="outline">{draft.missingDecisions.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {draft.missingDecisions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No missing decisions detected.</div>
            ) : (
              draft.missingDecisions.map((decision) => (
                <div key={decision.field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{decision.label}</div>
                    <Badge variant={decision.severity === "blocking" ? "destructive" : "outline"}>
                      {titleCase(decision.severity)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{decision.reason}</div>
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
          <WarningList warnings={allWarnings} />
        </section>

        <Button type="button" className="w-full" disabled>
          Create Draft Order
        </Button>
      </div>
    </ScrollArea>
  );
}

export default function InboundOrdersPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(defaultQueueFilters);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [parsingRecordId, setParsingRecordId] = useState<string | null>(null);
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

  const isParseInFlight = Boolean(parsingRecordId) || parseMutation.isPending;
  const isSelectedRecordParsing = Boolean(selectedId && parsingRecordId === selectedId);
  const runParseForSelectedRecord = () => {
    if (!selectedId || parseInFlightRef.current) return;
    parseInFlightRef.current = true;
    setParsingRecordId(selectedId);
    parseMutation.mutate(selectedId);
  };

  const pageError = getErrorTone(
    (listQuery.error as Error | null)
      || (detailQuery.error as Error | null)
      || (draftPreviewQuery.error as Error | null),
  );
  const listError = getErrorTone(listQuery.error as Error | null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-4 py-3">
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
              }}
              disabled={listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching}
            >
              {listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching ? (
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
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(280px,360px)_minmax(360px,1fr)_minmax(320px,480px)]">
        <section className="min-h-[300px] min-w-0 border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Inbound Queue</div>
            <Badge variant="outline">{records.length}</Badge>
          </div>
          <div className="flex h-[calc(100%-3rem)] min-h-0 flex-col">
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
        </section>

        <section className="min-h-[360px] min-w-0 border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Source Evidence</div>
            {selectedRecord && <Badge variant="secondary">{titleCase(selectedRecord.sourceType)}</Badge>}
          </div>
          <div className="h-[calc(100%-3rem)]">
            <SourceEvidencePanel
              detail={detailQuery.data?.data}
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading}
              latestAttempt={draftPreviewQuery.data?.data.latestAttempt ?? null}
              parseError={parseMutation.error as Error | null}
              isParsing={isSelectedRecordParsing}
              parseDisabled={isParseInFlight}
              onParse={runParseForSelectedRecord}
            />
          </div>
        </section>

        <section className="min-h-[320px] min-w-0 lg:min-h-0">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <div className="text-sm font-semibold text-foreground">Draft Builder</div>
            <Badge variant="outline">Phase 2</Badge>
          </div>
          <div className="h-[calc(100%-3rem)]">
            <DraftBuilderPanel
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading || draftPreviewQuery.isLoading}
              draftPreview={draftPreviewQuery.data?.data}
              previewError={draftPreviewQuery.error as Error | null}
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
