import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Layers3,
  Package2,
  Palette,
  Send,
} from "lucide-react";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import type { DesignQueueItem, DesignQueueWorkflowState } from "@/hooks/useOrders";
import { useDesignQueue, useOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import type { ProofingReadModel } from "@shared/proofing";

const WORKFLOW_LABELS: Record<string, string> = {
  needs_design: "Needs Design",
  in_design: "In Design",
  design_complete: "Design Complete",
  ready_for_prepress: "Ready for Prepress",
  on_hold: "On Hold",
  canceled: "Canceled",
};

function getDesignActions(state: DesignQueueWorkflowState | undefined) {
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
        { label: "Complete Design", action: "complete" },
        { label: "Hold", toState: "on_hold" },
      ];
    default:
      return [];
  }
}

function formatOwnerLabel(item: DesignQueueItem) {
  if (item.activeOwnerStepKey) {
    return item.activeOwnerStepKey.replace(/_/g, " ");
  }

  if (item.activeOwnerStationKey) {
    return item.activeOwnerStationKey.replace(/_/g, " ");
  }

  return null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, { addSuffix: true });
}

function getSpecRows(selectedItem: DesignQueueItem, selectedLineItem: any) {
  const rows = [
    { label: "Quantity", value: selectedLineItem?.quantity ?? selectedItem.quantity ?? null },
    {
      label: "Size",
      value:
        selectedLineItem?.width && selectedLineItem?.height
          ? `${selectedLineItem.width} × ${selectedLineItem.height}`
          : selectedItem.width && selectedItem.height
            ? `${selectedItem.width} × ${selectedItem.height}`
            : null,
    },
    { label: "Material", value: selectedItem.media ?? null },
    { label: "Print Type", value: selectedItem.printType ?? null },
    {
      label: "Sq Ft",
      value: selectedItem.sqFootage != null ? `${selectedItem.sqFootage}` : null,
    },
    {
      label: "Product",
      value: selectedLineItem?.product?.name ?? selectedItem.productName ?? null,
    },
  ];

  return rows.filter((row) => row.value !== null && row.value !== undefined && `${row.value}`.trim() !== "");
}

function getInstructionItems(selectedLineItem: any, selectedItem: DesignQueueItem) {
  const optionRows = Array.isArray(selectedLineItem?.specsJson?.selectedOptions)
    ? selectedLineItem.specsJson.selectedOptions
        .map((option: any) => {
          const name = String(option?.optionName || option?.label || option?.name || "").trim();
          const value = String(option?.displayValue ?? option?.value ?? "").trim();
          if (!name || !value) return null;
          return `${name}: ${value}`;
        })
        .filter(Boolean)
    : [];

  return [
    selectedItem.printType ? `Print type: ${selectedItem.printType}` : null,
    selectedItem.media ? `Material: ${selectedItem.media}` : null,
    ...(optionRows as string[]),
  ].slice(0, 6).filter(Boolean) as string[];
}

function getRecommendedAction(args: {
  item: DesignQueueItem;
  proofing: ProofingReadModel | undefined;
  artworkCount: number;
}) {
  const { item, proofing, artworkCount } = args;

  if (artworkCount === 0) {
    return {
      title: "Review missing source files",
      detail: "No artwork or source files are attached to this line item yet. Gather references before starting design.",
    };
  }

  if (proofing?.proofDecisionHistory[0]?.decision === "revision_requested") {
    return {
      title: "Address the latest revision request",
      detail: proofing.proofDecisionHistory[0].responseNotes || "A customer revision was requested on the latest proof. Update artwork and prepare the next version.",
    };
  }

  if (item.workflowState === "needs_design") {
    return {
      title: "Start Design",
      detail: "Move this line item into active design work so ownership and downstream routing stay aligned.",
    };
  }

  if (item.requiresProofApproval && proofing?.proofVersionHistory[0]?.status === "draft") {
    return {
      title: "Create & Send Proof",
      detail: "A draft proof exists. Hand off to Proofing to send the next version for approval.",
    };
  }

  if (item.requiresProofApproval) {
    return {
      title: "Complete Design and route to Proofing",
      detail: "Finish the design pass, then move the line item into proofing using the existing downstream workflow.",
    };
  }

  return {
    title: "Complete Design",
    detail: "Once artwork is ready, complete design so the line item can continue into prepress or production.",
  };
}

export default function DesignProductionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: queue = [], isLoading } = useDesignQueue();
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);

  useEffect(() => {
    if (queue.length === 0) {
      if (selectedLineItemId !== null) {
        setSelectedLineItemId(null);
      }
      return;
    }

    const selectionStillExists = selectedLineItemId
      ? queue.some((item) => item.lineItemId === selectedLineItemId)
      : false;

    if (!selectionStillExists) {
      setSelectedLineItemId(queue[0].lineItemId);
    }
  }, [queue, selectedLineItemId]);

  const selectedItem = useMemo(
    () => queue.find((item) => item.lineItemId === selectedLineItemId) ?? queue[0] ?? null,
    [queue, selectedLineItemId],
  );

  const selectedOwnerLabel = selectedItem ? formatOwnerLabel(selectedItem) : null;

  const orderQuery = useOrder(selectedItem?.orderId);
  const order = orderQuery.data;

  const selectedLineItem = useMemo(
    () => order?.lineItems?.find((lineItem) => lineItem.id === selectedItem?.lineItemId) ?? null,
    [order, selectedItem?.lineItemId],
  );

  const proofingQuery = useQuery<ProofingReadModel>({
    queryKey: ["/api/proofing/line-item", selectedItem?.lineItemId],
    queryFn: async () => {
      const response = await fetch(`/api/proofing/line-item/${selectedItem?.lineItemId}`, {
        credentials: "include",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || "Failed to fetch proofing detail");
      }
      return json.data as ProofingReadModel;
    },
    enabled: Boolean(selectedItem?.lineItemId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const proofing = proofingQuery.data;
  const specRows = selectedItem ? getSpecRows(selectedItem, selectedLineItem) : [];
  const instructionItems = selectedItem ? getInstructionItems(selectedLineItem, selectedItem) : [];
  const proofVersionHistory = proofing?.proofVersionHistory.slice(0, 4) ?? [];
  const recentActivity = useMemo(() => {
    if (!proofing) return [] as Array<{ label: string; detail: string; at: string | null }>;

    const activities: Array<{ label: string; detail: string; at: string | null }> = [];

    proofing.proofDecisionHistory.slice(0, 2).forEach((entry) => {
      activities.push({
        label: `Proof ${entry.decision.replace(/_/g, " ")}`,
        detail: entry.responseNotes || entry.responderName || entry.responderEmail || "Proof response recorded",
        at: entry.respondedAt,
      });
    });

    proofing.manualApprovalOverrideHistory.slice(0, 1).forEach((entry) => {
      activities.push({
        label: "Manual approval override",
        detail: entry.overrideReason,
        at: entry.overriddenAt,
      });
    });

    return activities.slice(0, 3);
  }, [proofing]);

  const recommendedAction = selectedItem
    ? getRecommendedAction({
        item: selectedItem,
        proofing,
        artworkCount: selectedItem.fileCounts?.originals || 0,
      })
    : null;

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      if (selectedItem?.orderId) {
        queryClient.invalidateQueries({ queryKey: ["orders", "detail", selectedItem.orderId] });
      }
      if (selectedItem?.lineItemId) {
        queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", selectedItem.lineItemId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Workflow update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canStartDesign = selectedItem?.workflowState === "needs_design";
  const canCompleteDesign = selectedItem?.workflowState === "in_design";
  const canCreateProof = Boolean(selectedItem?.requiresProofApproval);

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Design Queue</CardTitle>
          <CardDescription>Live line items currently in design workflow.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[78vh]">
            <div className="divide-y divide-border/60">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 w-full" />
                  ))}
                </div>
              ) : queue.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No line items are currently assigned to Design.</div>
              ) : (
                queue.map((item) => (
                  <button
                    key={item.lineItemId}
                    type="button"
                    onClick={() => setSelectedLineItemId(item.lineItemId)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/30 ${selectedItem?.lineItemId === item.lineItemId ? "bg-muted/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">#{item.jobNumber}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.customerName}</div>
                      </div>
                      <Badge variant={item.designStatus === "in_design" ? "default" : "outline"}>
                        {WORKFLOW_LABELS[item.designStatus] || item.designStatus}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-sm">{item.productName}</div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <div className="flex gap-3">
                        <span>Art: {item.fileCounts?.originals || 0}</span>
                        <span>Proofs: {item.fileCounts?.proofs || 0}</span>
                      </div>
                      <span>{item.dueDate ? formatRelativeTime(item.dueDate) : "No due date"}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {!selectedItem ? (
        <Card className="border-border bg-card">
          <CardContent className="p-8 text-sm text-muted-foreground">Select a line item from the queue to open the designer workspace.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Card className="border-border bg-card">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-2xl">{selectedLineItem?.product?.name ?? selectedItem.productName}</CardTitle>
                    <CardDescription>
                      Order #{selectedItem.jobNumber} • {selectedItem.customerName}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedItem.designStatus === "in_design" ? "default" : "outline"}>
                      {WORKFLOW_LABELS[selectedItem.designStatus] || selectedItem.designStatus}
                    </Badge>
                    {selectedOwnerLabel ? <Badge variant="secondary">Owner: {selectedOwnerLabel}</Badge> : null}
                    {selectedItem.requiresProofApproval ? <Badge variant="outline">Requires Proof Approval</Badge> : null}
                    {selectedItem.requiresPrepress ? <Badge variant="outline">Routes to Prepress</Badge> : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Job / Line Item</div>
                    <div className="mt-1 text-sm font-medium">#{selectedItem.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">{selectedItem.lineItemId}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Due Date</div>
                    <div className="mt-1 text-sm font-medium">{formatDateTime(order?.dueDate ?? selectedItem.dueDate)}</div>
                    <div className="text-xs text-muted-foreground">{formatRelativeTime(order?.dueDate ?? selectedItem.dueDate)}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer</div>
                    <div className="mt-1 text-sm font-medium">{selectedItem.customerName}</div>
                    <div className="text-xs text-muted-foreground">{selectedItem.printType ?? "Design work item"}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Files on Item</div>
                    <div className="mt-1 text-sm font-medium">{selectedItem.fileCounts?.originals || 0} source</div>
                    <div className="text-xs text-muted-foreground">{selectedItem.fileCounts?.proofs || 0} proof files already attached</div>
                  </div>
                </div>

                {specRows.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {specRows.map((row) => (
                      <div key={row.label} className="rounded-lg border border-border/60 p-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</div>
                        <div className="mt-1 text-sm font-medium">{row.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Design Brief
                  </CardTitle>
                  <CardDescription>What this job is and what the designer needs to produce.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm leading-6">
                    {selectedLineItem?.description || selectedItem.productName || "No detailed design brief captured on this line item."}
                  </div>

                  {instructionItems.length > 0 ? (
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Key Instructions</div>
                      <ul className="space-y-2 text-sm text-foreground">
                        {instructionItems.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                      No structured design instructions were captured beyond the line item description.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    Notes & Context
                  </CardTitle>
                  <CardDescription>Sales handoff, internal context, and customer feedback already on the record.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Order Internal Notes</div>
                    {orderQuery.isLoading ? (
                      <Skeleton className="h-20 w-full" />
                    ) : order?.notesInternal ? (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 leading-6">{order.notesInternal}</div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/60 p-4 text-muted-foreground">
                        No order-level internal notes are attached to this job yet.
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest Proof Feedback</div>
                    {proofingQuery.isLoading ? (
                      <Skeleton className="h-16 w-full" />
                    ) : proofing?.proofDecisionHistory[0] ? (
                      <div className="rounded-lg border border-border/60 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">{proofing.proofDecisionHistory[0].decision.replace(/_/g, " ")}</Badge>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(proofing.proofDecisionHistory[0].respondedAt)}</span>
                        </div>
                        <p className="mt-3 leading-6 text-foreground">
                          {proofing.proofDecisionHistory[0].responseNotes || "No written feedback was captured on the latest proof response."}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/60 p-4 text-muted-foreground">
                        No proof feedback exists on this line item yet.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border bg-card">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Layers3 className="h-4 w-4 text-muted-foreground" />
                      Files & References
                    </CardTitle>
                    <CardDescription>Use the existing line-item file manager for source art, references, and uploads.</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={ROUTES.orders.detail(selectedItem.orderId)}>
                      Open Order
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selectedItem.fileCounts?.originals || 0} source files</Badge>
                  <Badge variant="outline">{selectedItem.fileCounts?.proofs || 0} proof files</Badge>
                  {selectedItem.requiresProofApproval ? <Badge variant="secondary">Proof handoff required</Badge> : null}
                </div>

                <LineItemAttachmentsPanel
                  quoteId={null}
                  parentType="order"
                  orderId={selectedItem.orderId}
                  lineItemId={selectedItem.lineItemId}
                  lineItemKey={selectedItem.lineItemId}
                  productName={selectedItem.productName}
                  defaultExpanded={true}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Workflow Rail</CardTitle>
                <CardDescription>What stage this line item is in and the cleanest next move.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-primary/80">Recommended Next Action</div>
                  <div className="mt-2 text-lg font-semibold">{recommendedAction?.title ?? "Review line item"}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{recommendedAction?.detail ?? "Use the workspace to review files, notes, and workflow state."}</p>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workflow State</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                      {WORKFLOW_LABELS[selectedItem.workflowState] || selectedItem.workflowState}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Design Status</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                      {WORKFLOW_LABELS[selectedItem.designStatus] || selectedItem.designStatus}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Downstream Path</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      {selectedItem.requiresProofApproval
                        ? "Proofing"
                        : selectedItem.requiresPrepress
                          ? "Prepress"
                          : "Production"}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    className="w-full justify-between"
                    disabled={!canStartDesign || transitionWorkflow.isPending}
                    onClick={() => transitionWorkflow.mutate({ lineItemId: selectedItem.lineItemId, action: "start" })}
                  >
                    <span>Start Design</span>
                    <Palette className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={!canCompleteDesign || transitionWorkflow.isPending}
                    onClick={() => transitionWorkflow.mutate({ lineItemId: selectedItem.lineItemId, action: "complete" })}
                  >
                    <span>Complete Design</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-between"
                    disabled={!canCreateProof}
                    onClick={() => navigate(`${ROUTES.production.proofing}?lineItemId=${selectedItem.lineItemId}&slice=all`)}
                  >
                    <span>Create & Send Proof</span>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>

                <Separator />

                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <Clock3 className="h-4 w-4" />
                      Last order update
                    </span>
                    <span>{formatRelativeTime(order?.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Proof versions
                    </span>
                    <span>{proofing?.proofVersionHistory.length ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <Package2 className="h-4 w-4" />
                      Source files
                    </span>
                    <span>{selectedItem.fileCounts?.originals || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Versions</CardTitle>
                <CardDescription>Existing proof/version history already attached to this line item.</CardDescription>
              </CardHeader>
              <CardContent>
                {proofingQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-14 w-full" />
                    ))}
                  </div>
                ) : proofVersionHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    No proof versions exist yet for this line item.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {proofVersionHistory.map((version) => (
                      <div key={version.id} className="rounded-lg border border-border/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">Version {version.versionNumber}</div>
                          <Badge variant={version.status === "approved" ? "default" : "outline"}>
                            {version.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Created {formatRelativeTime(version.createdAt)}
                          {version.sentAt ? ` • Sent ${formatRelativeTime(version.sentAt)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Recent Activity</CardTitle>
                <CardDescription>Latest proofing and approval activity already recorded on this job.</CardDescription>
              </CardHeader>
              <CardContent>
                {proofingQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-12 w-full" />
                    ))}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    No proofing activity is recorded yet. Use the workflow rail when this job is ready for proof creation.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentActivity.map((activity) => (
                      <div key={`${activity.label}-${activity.at}`} className="rounded-lg border border-border/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{activity.label}</div>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(activity.at)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{activity.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}