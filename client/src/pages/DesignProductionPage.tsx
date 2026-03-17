import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDesignQueue } from "@/hooks/useOrders";

const WORKFLOW_LABELS: Record<string, string> = {
  needs_design: "Needs Design",
  in_design: "In Design",
  ready_for_prepress: "Ready for Prepress",
  on_hold: "On Hold",
  canceled: "Canceled",
};

function getDesignActions(state: string | undefined) {
  switch (state) {
    case "needs_design":
      return [
        { label: "Start Design", action: "start" },
        { label: "Hold", toState: "on_hold" },
        { label: "Cancel", toState: "canceled" },
      ];
    case "in_design":
      return [
        { label: "Return to Needs Design", action: "return-to-needs-design" },
        { label: "Send to Prepress", action: "send-to-prepress" },
        { label: "Hold", toState: "on_hold" },
      ];
    case "new":
      return [
        { label: "Send to Design", action: "send" },
      ];
    default:
      return [];
  }
}

export default function DesignProductionPage() {
  const queryClient = useQueryClient();
  const { data: queue = [], isLoading } = useDesignQueue();
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedLineItemId && queue[0]?.lineItemId) {
      setSelectedLineItemId(queue[0].lineItemId);
    }
  }, [queue, selectedLineItemId]);

  const selectedItem = useMemo(
    () => queue.find((item: any) => item.lineItemId === selectedLineItemId) ?? queue[0] ?? null,
    [queue, selectedLineItemId],
  );

  const transitionWorkflow = useMutation({
    mutationFn: async ({ lineItemId, toState, action }: { lineItemId: string; toState?: string; action?: string }) => {
      const endpoint = action
        ? `/api/design/line-item/${lineItemId}/${action}`
        : `/api/line-items/${lineItemId}/workflow-transition`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(toState ? { toState } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to transition workflow");
      }
      return data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      if (selectedItem?.orderId) {
        queryClient.invalidateQueries({ queryKey: ["orders", "detail", selectedItem.orderId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Design Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[70vh]">
            <div className="divide-y divide-border/60">
              {isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading queue…</div>
              ) : queue.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No line items are currently assigned to Design.</div>
              ) : (
                queue.map((item: any) => (
                  <button
                    key={item.lineItemId}
                    type="button"
                    onClick={() => setSelectedLineItemId(item.lineItemId)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/30 ${selectedItem?.lineItemId === item.lineItemId ? "bg-muted/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.jobNumber}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.customerName}</div>
                      </div>
                      <Badge variant={item.workflowState === "in_design" ? "default" : "outline"}>
                        {WORKFLOW_LABELS[item.workflowState] || item.workflowState}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-sm">{item.productName}</div>
                    <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                      <span>Art: {item.fileCounts?.originals || 0}</span>
                      <span>Proofs: {item.fileCounts?.proofs || 0}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Design Work Surface</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedItem ? (
            <div className="text-sm text-muted-foreground">Select a line item from the queue.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selectedItem.workflowState === "in_design" ? "default" : "outline"}>
                  {WORKFLOW_LABELS[selectedItem.workflowState] || selectedItem.workflowState}
                </Badge>
                {(selectedItem.activeOwnerStepKey || selectedItem.activeOwnerStationKey) && (
                  <Badge variant="secondary">
                    Owner: {selectedItem.activeOwnerStepKey || selectedItem.activeOwnerStationKey}
                  </Badge>
                )}
                {selectedItem.requiresPrepress && <Badge variant="outline">Requires Prepress</Badge>}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Job</div>
                  <div className="mt-1 text-sm font-medium">{selectedItem.jobNumber}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</div>
                  <div className="mt-1 text-sm">{selectedItem.customerName}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Product</div>
                  <div className="mt-1 text-sm">{selectedItem.productName}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due Date</div>
                  <div className="mt-1 text-sm">{selectedItem.dueDate ? new Date(selectedItem.dueDate).toLocaleString() : "—"}</div>
                </div>
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                {getDesignActions(selectedItem.workflowState).map((action) => (
                  <Button
                    key={action.action || action.toState}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={transitionWorkflow.isPending}
                    onClick={() => transitionWorkflow.mutate({
                      lineItemId: selectedItem.lineItemId,
                      toState: action.toState,
                      action: action.action,
                    })}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/orders/${selectedItem.orderId}`}>Open Order</Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}