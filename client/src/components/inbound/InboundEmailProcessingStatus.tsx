import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { inboundEmailProcessingLabels, type InboundEmailProcessingView } from "@shared/inboundEmailProcessing";

export function InboundEmailProcessingStatus({ recordId }: { recordId: string }) {
  const client = useQueryClient();
  const key = ["/api/inbound-orders", recordId, "processing"];
  const query = useQuery<{ success: true; data: InboundEmailProcessingView }>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/inbound-orders/${encodeURIComponent(recordId)}/processing`)).json(),
    refetchInterval: current => current.state.data?.data.enabled && ["waiting", "processing"].includes(current.state.data.data.job?.status ?? "") ? 5_000 : false,
  });
  const retry = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/inbound-orders/${encodeURIComponent(recordId)}/processing/retry`, {})).json(),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key, exact: true }); },
  });
  const status = query.data?.data.job?.status;
  useEffect(() => {
    if (status !== "review_ready" && status !== "needs_attention") return;
    // Refresh source/parse visibility. Never invalidate a staff draft query:
    // the review page may have unsaved edits. Its initial query becomes enabled
    // naturally when the first parsed draft appears.
    void client.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId], exact: true });
    void client.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId, "draft-preview"], exact: true });
  }, [client, recordId, status]);
  if (query.isError) return <p role="status" className="mt-2 text-sm text-muted-foreground">Draft preparation status is unavailable. Source evidence is retained; use Refresh to check again.</p>;
  const view = query.data?.data;
  if (!view?.job) return null;
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3" role="status" aria-live="polite">
    <div className="min-w-0 text-sm">
      <p className="font-medium">{inboundEmailProcessingLabels[view.job.status]}</p>
      {!view.enabled && <p className="text-muted-foreground">Automatic draft preparation is paused for this organization.</p>}
      {view.job.message && <p className="text-muted-foreground">{view.job.message}</p>}
      {status === "waiting" && view.job.attempts > 0 && <p className="text-muted-foreground">Retry scheduled after {new Date(view.job.nextAttemptAt).toLocaleString()}.</p>}
      <p className="text-muted-foreground">AI preparation does not dismiss the email or create an Order. Staff approval is required.</p>
      {retry.isError && <p className="text-destructive">Retry could not be queued. Refresh the record before trying again.</p>}
    </div>
    {view.job.canRetry && <Button type="button" size="sm" variant="outline" disabled={!view.enabled || retry.isPending} onClick={() => retry.mutate()}>
      {retry.isPending ? "Queuing retry…" : "Retry draft preparation"}
    </Button>}
  </div>;
}
