import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { orderTimelineQueryKey } from "@/hooks/useOrders";
import type { StructuredTimelineEvent } from "@shared/timelineEvents";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import styles from "./TimelinePanel.module.css";

type TimelineEventDto = {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorUserId: string | null;
  entityType: string;
  eventType: string;
  message: string;
  metadata: any;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStructuredEvent(evt: TimelineEventDto): StructuredTimelineEvent | null {
  const meta = evt?.metadata;
  const candidate =
    (isRecord(meta) ? meta.structuredEvent : null) ??
    (isRecord(meta) && isRecord(meta.metadata) ? meta.metadata.structuredEvent : null);

  if (!isRecord(candidate)) return null;
  if (typeof candidate.eventType !== "string") return null;
  if (typeof candidate.entityType !== "string") return null;
  if (typeof candidate.entityId !== "string") return null;
  if (typeof candidate.displayLabel !== "string") return null;
  if (typeof candidate.createdAt !== "string") return null;

  return candidate as StructuredTimelineEvent;
}

function formatMoneyFromCents(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const dollars = n / 100;
  return dollars.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function toDisplayValue(fieldKey: string | undefined, value: unknown): string {
  if (value == null || value === "") return "—";

  if (fieldKey === "unitPriceCents" || fieldKey === "totalPriceCents") {
    return formatMoneyFromCents(value) ?? String(value);
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";

    if (fieldKey === "dueDate" || fieldKey === "promisedDate") {
      const d = new Date(trimmed);
      if (Number.isFinite(d.getTime())) return format(d, "MMM d, yyyy");
    }

    if (fieldKey === "status") {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }

    return trimmed;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getFieldLabel(structured: StructuredTimelineEvent): string {
  const { fieldKey } = structured;

  if (fieldKey?.startsWith("option:")) {
    const optLabel = structured.metadata?.optionLabel;
    const optId = fieldKey.slice("option:".length);
    return typeof optLabel === "string" && optLabel.trim() ? optLabel.trim() : `Option ${optId}`;
  }

  switch (fieldKey) {
    case "poNumber":
      return "PO #";
    case "jobLabel":
      return "Job Label";
    case "priority":
      return "Priority";
    case "dueDate":
      return "Due Date";
    case "promisedDate":
      return "Promised Date";
    case "billingReadyOverride":
      return "Billing Ready";
    case "fulfillmentType":
      return "Fulfillment";
    case "customerNotes":
      return "Customer Notes";

    case "description":
      return "Description";
    case "quantity":
      return "Quantity";
    case "unitPriceCents":
      return "Unit Price";
    case "totalPriceCents":
      return "Total";
    case "overrideEnabled":
      return "Price Override";
    case "status":
      return "Status";

    default:
      return typeof fieldKey === "string" && fieldKey.trim() ? fieldKey : "Update";
  }
}

function formatStructuredMessage(structured: StructuredTimelineEvent): string {
  const fieldLabel = getFieldLabel(structured);

  if (structured.eventType === "file.attached") {
    const fileName = structured.metadata?.fileName;
    if (typeof fileName === "string" && fileName.trim()) {
      return `${structured.displayLabel} — File attached: ${fileName.trim()}`;
    }
    return `${structured.displayLabel} — File attached`;
  }

  if (structured.eventType === "file.removed") {
    const fileName = structured.metadata?.fileName;
    if (typeof fileName === "string" && fileName.trim()) {
      return `${structured.displayLabel} — File removed: ${fileName.trim()}`;
    }
    return `${structured.displayLabel} — File removed`;
  }

  const fromText = toDisplayValue(structured.fieldKey, structured.fromValue);
  const toText = toDisplayValue(structured.fieldKey, structured.toValue);

  return `${structured.displayLabel} — ${fieldLabel}: ${fromText} → ${toText}`;
}

function formatEntityLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").toString().trim();
  if (!s) return "—";
  return s.replace(/_/g, " ");
}

export function TimelinePanel({
  quoteId,
  orderId,
  limit = 50,
}: {
  quoteId?: string;
  orderId?: string;
  limit?: number;
}) {
  const enabled = Boolean(quoteId || orderId);

  const { data, isLoading, error } = useQuery<TimelineEventDto[]>({
    queryKey: orderId 
      ? orderTimelineQueryKey(orderId)
      : ["/api/timeline", { quoteId: quoteId ?? null, orderId: orderId ?? null, limit }],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (quoteId) params.set("quoteId", quoteId);
      if (orderId) params.set("orderId", orderId);
      if (limit) params.set("limit", String(limit));

      const response = await fetch(`/api/timeline?${params.toString()}`, {
        credentials: "include",
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.message || json?.error || "Failed to load timeline");
      }

      const payload = json?.data ?? json;
      return Array.isArray(payload) ? payload : [];
    },
  });

  return (
    <>
      {!enabled ? (
        <div className="text-sm text-muted-foreground">No timeline context provided.</div>
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : error ? (
        <div className="text-sm text-destructive">{(error as Error).message}</div>
      ) : !data || data.length === 0 ? (
        <div className="text-sm text-muted-foreground">No timeline events.</div>
      ) : (
        <TooltipProvider delayDuration={350}>
          <div className="space-y-3">
            {data.map((evt) => {
              const when = evt.occurredAt ? new Date(evt.occurredAt) : null;
              const whenText = when && !Number.isNaN(when.getTime()) ? format(when, "MMM d, yyyy h:mm a") : "—";
              const actor = evt.actorName && evt.actorName.trim() ? evt.actorName : "Unknown";

              const structured = getStructuredEvent(evt);
              const message = structured ? formatStructuredMessage(structured) : evt.message;
              const entityLabel = formatEntityLabel(structured?.entityType ?? evt.entityType);

              const isLineItemJump = structured?.entityType === "line_item" && Boolean(structured?.entityId);

              const messageNode = isLineItemJump ? (
                <button
                  type="button"
                  className={
                    "w-full text-left text-sm text-foreground break-words hover:underline focus:outline-none"
                  }
                  onClick={() => {
                    try {
                      window.dispatchEvent(
                        new CustomEvent("titanos:jump-to-line-item", {
                          detail: { lineItemId: structured?.entityId },
                        })
                      );
                    } catch {
                      // ignore
                    }
                  }}
                  title="Jump to line item"
                >
                  <span className={styles.messageClamp2}>{message}</span>
                </button>
              ) : (
                <div className={"text-sm text-foreground break-words"}>
                  <span className={styles.messageClamp2}>{message}</span>
                </div>
              );

              return (
                <div key={evt.id} className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>{messageNode}</TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <div className="text-sm whitespace-pre-wrap break-words">{message}</div>
                    </TooltipContent>
                  </Tooltip>
                  <div className="text-xs text-muted-foreground truncate whitespace-nowrap">
                    {actor} • {entityLabel} • {whenText}
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      )}
    </>
  );
}
