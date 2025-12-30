import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { orderTimelineQueryKey } from "@/hooks/useOrders";

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
        <div className="space-y-3">
          {data.map((evt) => {
            const when = evt.occurredAt ? new Date(evt.occurredAt) : null;
            const whenText = when && !Number.isNaN(when.getTime()) ? format(when, "MMM d, yyyy h:mm a") : "—";
            const actor = evt.actorName || "System";
            return (
              <div key={evt.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{evt.message}</div>
                  <div className="text-xs text-muted-foreground">
                    {actor}{evt.entityType ? ` • ${evt.entityType}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">{whenText}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
