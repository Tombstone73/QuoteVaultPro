import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  FileText,
  Inbox,
  Loader2,
  Plus,
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
  createdAt: string;
  updatedAt: string;
};

type InboundOrderLineItem = {
  id: string;
  sortOrder: number;
  status: string;
  productNameRaw: string | null;
  description: string | null;
  width: string | null;
  height: string | null;
  quantity: number | null;
  normalizedLineJson: Record<string, unknown>;
  confidenceScore: string | null;
};

type InboundOrderFile = {
  id: string;
  sourceFilename: string | null;
  role: string;
  status: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

type InboundOrderWarning = {
  id: string;
  severity: string;
  code: string;
  message: string;
  status: string;
};

type InboundOrderDecisionFlag = {
  id: string;
  flagType: string;
  summary: string;
  status: string;
  confidenceScore: string | null;
};

type InboundOrderEvent = {
  id: string;
  eventType: string;
  actorType: string;
  message: string | null;
  createdAt: string;
};

type InboundOrdersListResponse = {
  success: boolean;
  data: InboundOrderRecord[];
  pagination: {
    limit: number;
    offset: number;
  };
};

type InboundOrderDetailResponse = {
  success: boolean;
  data: {
    record: InboundOrderRecord;
    lineItems: InboundOrderLineItem[];
    files: InboundOrderFile[];
    warnings: InboundOrderWarning[];
    decisionFlags: InboundOrderDecisionFlag[];
    events: InboundOrderEvent[];
    reviewSnapshots: unknown[];
  };
};

type ManualInboundOrderCreateResponse = {
  success: boolean;
  data: {
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  };
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

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Source Payload</h2>
            <Badge variant="outline">{selectedRecord.sourceType}</Badge>
          </div>
          <JsonBlock value={detail?.record.rawPayloadJson ?? selectedRecord.rawPayloadJson} />
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Files</h3>
          <div className="mt-3 space-y-2">
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
                      {file.role} / {file.mimeType || "unknown"}
                    </div>
                  </div>
                  <Badge variant="secondary">{file.status}</Badge>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Event Timeline</h3>
          <div className="mt-3 space-y-3">
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
}: {
  detail: InboundOrderDetailResponse["data"] | undefined;
  selectedRecord: InboundOrderRecord | null;
  isLoading: boolean;
}) {
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
  const warnings = detail?.warnings ?? [];
  const decisionFlags = detail?.decisionFlags ?? [];
  const lineItems = detail?.lineItems ?? [];

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
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Review State</h3>
          </div>
          <div className="mt-3 space-y-2">
            {warnings.length === 0 && decisionFlags.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings or decision flags loaded.</div>
            ) : (
              <>
                {warnings.map((warning) => (
                  <div key={warning.id} className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{warning.code}</span>
                      <Badge variant={warning.severity === "blocking" ? "destructive" : "secondary"}>
                        {warning.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{warning.message}</div>
                  </div>
                ))}
                {decisionFlags.map((flag) => (
                  <div key={flag.id} className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{flag.flagType}</span>
                      <Badge variant="outline">{flag.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{flag.summary}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
          <div className="mt-3 space-y-2">
            {lineItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">No extracted line items.</div>
            ) : (
              lineItems.map((lineItem) => (
                <div key={lineItem.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {lineItem.productNameRaw || lineItem.description || `Line ${lineItem.sortOrder + 1}`}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Qty {lineItem.quantity ?? "-"} / {formatDimension(lineItem)}
                      </div>
                    </div>
                    <Badge variant="secondary">{lineItem.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Normalized Draft</h3>
          <JsonBlock value={record.normalizedPayloadJson} />
        </section>
      </div>
    </ScrollArea>
  );
}

export default function InboundOrdersPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["/api/inbound-orders"],
    queryFn: () => readJson<InboundOrdersListResponse>("/api/inbound-orders"),
  });

  const records = listQuery.data?.data ?? [];

  useEffect(() => {
    if (!selectedId && records.length > 0) {
      setSelectedId(records[0].id);
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
            }}
            disabled={listQuery.isFetching || detailQuery.isFetching}
          >
            {listQuery.isFetching || detailQuery.isFetching ? (
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
            <Badge variant="outline">Read Only</Badge>
          </div>
          <div className="h-[calc(100%-3rem)]">
            <DraftBuilderPanel
              detail={detailQuery.data?.data}
              selectedRecord={selectedRecord}
              isLoading={detailQuery.isLoading}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
