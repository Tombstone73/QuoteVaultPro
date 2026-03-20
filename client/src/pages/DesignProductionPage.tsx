import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CircleAlert, ExternalLink, Palette, Send } from "lucide-react";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES } from "@/config/routes";
import { useAuth } from "@/hooks/useAuth";
import type { DesignQueueItem } from "@/hooks/useOrders";
import { useDesignQueue, useOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ProofingReadModel } from "@shared/proofing";

const WORKFLOW_LABELS: Record<string, string> = {
  needs_design: "Needs Design",
  in_design: "In Design",
  paused: "Paused",
  design_complete: "Design Complete",
  ready_for_prepress: "Ready for Prepress",
  awaiting_proof_approval: "Ready for Proof",
  on_hold: "On Hold",
  canceled: "Canceled",
};

type DesignNoteKind = "internal_note" | "progress_update" | "blocker_update";

type DesignWorkspaceData = {
  effectiveState: string;
  session: {
    status: "idle" | "active" | "paused";
    startedAt: string | null;
    activeStartedAt: string | null;
    pausedAt: string | null;
    elapsedMs: number;
  };
  totalTrackedMs: number;
  rawTrackedMs: number;
  totalAdjustmentMs: number;
  notes: Array<{
    id: string;
    at: string;
    userName: string | null;
    noteKind: DesignNoteKind;
    noteText: string;
  }>;
  adjustments: Array<{
    id: string;
    at: string;
    userName: string | null;
    reason: string;
    beforeMs: number;
    afterMs: number;
    deltaMs: number;
  }>;
  activity: Array<{
    id: string;
    at: string;
    type: "session" | "note" | "adjustment" | "audit";
    label: string;
    detail: string;
    userName: string | null;
  }>;
};

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
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatElapsedTime(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatDurationLabel(totalMs: number) {
  const totalMinutes = Math.max(0, Math.round(totalMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function looksLikeUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function getReadableLabel(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || looksLikeUuid(text)) return null;
  return text;
}

function getDisplayPrintType(selectedItem: DesignQueueItem, selectedLineItem: any) {
  return (
    getReadableLabel(selectedLineItem?.productVariant?.name) ||
    getReadableLabel(selectedLineItem?.specsJson?.printTypeLabel) ||
    getReadableLabel(selectedItem.printType)
  );
}

function getDisplayMaterial(selectedItem: DesignQueueItem, selectedLineItem: any) {
  return getReadableLabel(selectedLineItem?.specsJson?.materialLabel) || getReadableLabel(selectedItem.media);
}

function getSpecRows(
  selectedItem: DesignQueueItem,
  selectedLineItem: any,
  displayPrintType: string | null,
  displayMaterial: string | null,
) {
  const rows = [
    { label: "Quantity", value: selectedLineItem?.quantity ?? selectedItem.quantity ?? null },
    {
      label: "Size",
      value:
        selectedLineItem?.width && selectedLineItem?.height
          ? `${selectedLineItem.width} x ${selectedLineItem.height}`
          : selectedItem.width && selectedItem.height
            ? `${selectedItem.width} x ${selectedItem.height}`
            : null,
    },
    { label: "Print Type", value: displayPrintType },
    {
      label: "Product",
      value: getReadableLabel(selectedLineItem?.product?.name) || getReadableLabel(selectedItem.productName),
    },
    { label: "Material", value: displayMaterial },
    {
      label: "Sq Ft",
      value: selectedItem.sqFootage != null ? `${selectedItem.sqFootage}` : null,
    },
  ];

  return rows.filter((row) => row.value !== null && row.value !== undefined && `${row.value}`.trim() !== "");
}

function getInstructionItems(
  selectedLineItem: any,
  displayPrintType: string | null,
  displayMaterial: string | null,
) {
  const optionRows = Array.isArray(selectedLineItem?.specsJson?.selectedOptions)
    ? selectedLineItem.specsJson.selectedOptions
        .map((option: any) => {
          const name = String(option?.optionName || option?.label || option?.name || "").trim();
          const value = String(option?.displayValue ?? option?.value ?? "").trim();
          if (!name || !value || looksLikeUuid(value)) return null;
          return `${name}: ${value}`;
        })
        .filter(Boolean)
    : [];

  return [
    displayPrintType ? `Print type: ${displayPrintType}` : null,
    displayMaterial ? `Material: ${displayMaterial}` : null,
    ...(optionRows as string[]),
  ]
    .slice(0, 6)
    .filter(Boolean) as string[];
}

function getRecommendedAction(args: {
  item: DesignQueueItem;
  proofing: ProofingReadModel | undefined;
  artworkCount: number;
}) {
  const { item, proofing, artworkCount } = args;

  if (artworkCount === 0) {
    return {
      title: "Review source files",
      detail: "No artwork is attached to this line item yet.",
    };
  }

  if (proofing?.proofDecisionHistory[0]?.decision === "revision_requested") {
    return {
      title: "Address the latest revision request",
      detail:
        proofing.proofDecisionHistory[0].responseNotes ||
        "A customer revision was requested on the latest proof. Update artwork and prepare the next version.",
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
      detail: "A draft proof exists and is ready for proofing handoff.",
    };
  }

  if (item.requiresProofApproval) {
    return {
      title: "Complete Design",
      detail: "Finish the design pass so proofing can take the next step.",
    };
  }

  return {
    title: "Complete Design",
    detail: "Finish artwork and route the line item downstream.",
  };
}

function getDownstreamPath(item: DesignQueueItem) {
  if (item.requiresProofApproval) return "Proofing";
  if (item.requiresPrepress) return "Prepress";
  return "Production";
}

function getNoteKindLabel(kind: DesignNoteKind) {
  switch (kind) {
    case "progress_update":
      return "Progress";
    case "blocker_update":
      return "Blocker";
    default:
      return "Internal";
  }
}

function getActivityTypeLabel(type: DesignWorkspaceData["activity"][number]["type"]) {
  switch (type) {
    case "session":
      return "Session";
    case "note":
      return "Note";
    case "adjustment":
      return "Adjustment";
    default:
      return "Audit";
  }
}

function getActivityVariant(type: DesignWorkspaceData["activity"][number]["type"]) {
  switch (type) {
    case "session":
      return "secondary" as const;
    case "adjustment":
      return "default" as const;
    default:
      return "outline" as const;
  }
}

function parseSignedMinutesInput(rawValue: string, currentTotalMinutes: number) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { isValid: false, adjustedTotalMinutes: null as number | null, deltaMinutes: null as number | null };
  }

  if (!/^[+-]\d+$/.test(trimmed)) {
    return { isValid: false, adjustedTotalMinutes: null as number | null, deltaMinutes: null as number | null };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return { isValid: false, adjustedTotalMinutes: null as number | null, deltaMinutes: null as number | null };
  }

  const deltaMinutes = parsed;
  const adjustedTotalMinutes = currentTotalMinutes + deltaMinutes;

  if (!Number.isFinite(adjustedTotalMinutes) || adjustedTotalMinutes < 0) {
    return { isValid: false, adjustedTotalMinutes: null as number | null, deltaMinutes: null as number | null };
  }

  return { isValid: true, adjustedTotalMinutes, deltaMinutes };
}

async function readJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as any).error || (json as any).message || "Request failed");
  }
  return json as T;
}

function MetaCard(props: { label: string; primary: string; secondary?: string | null; className?: string }) {
  const { label, primary, secondary, className } = props;

  return (
    <div className={cn("min-w-0 rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5 shadow-sm shadow-black/10", className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium text-foreground">{primary}</div>
      {secondary ? <div className="truncate text-xs text-muted-foreground">{secondary}</div> : null}
    </div>
  );
}

function CompactInfoRow(props: { label: string; value: string; valueClassName?: string }) {
  const { label, value, valueClassName } = props;

  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 text-sm leading-5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("min-w-0 text-foreground", valueClassName)}>{value}</div>
    </div>
  );
}

export default function DesignProductionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const { data: queue = [], isLoading } = useDesignQueue();
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [noteDraft, setNoteDraft] = useState("");
  const [noteKind, setNoteKind] = useState<DesignNoteKind>("internal_note");
  const [adjustMinutesDraft, setAdjustMinutesDraft] = useState("");
  const [adjustReasonDraft, setAdjustReasonDraft] = useState("");
  const [activitySort, setActivitySort] = useState<"newest" | "oldest">("newest");

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

  useEffect(() => {
    setNoteDraft("");
    setNoteKind("internal_note");
    setAdjustMinutesDraft("");
    setAdjustReasonDraft("");
  }, [selectedItem?.lineItemId]);

  const selectedOwnerLabel = selectedItem ? formatOwnerLabel(selectedItem) : null;
  const isAdminOrOwner = user?.role === "owner" || user?.role === "admin" || Boolean(isAdmin || user?.isAdmin);

  const orderQuery = useOrder(selectedItem?.orderId);
  const order = orderQuery.data;

  const selectedLineItem = useMemo(
    () => order?.lineItems?.find((lineItem) => lineItem.id === selectedItem?.lineItemId) ?? null,
    [order, selectedItem?.lineItemId],
  );

  const proofingQuery = useQuery<ProofingReadModel>({
    queryKey: ["/api/proofing/line-item", selectedItem?.lineItemId],
    queryFn: async () => {
      const json = await readJson<{ data: ProofingReadModel }>(`/api/proofing/line-item/${selectedItem?.lineItemId}`);
      return json.data;
    },
    enabled: Boolean(selectedItem?.lineItemId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const workspaceQuery = useQuery<DesignWorkspaceData>({
    queryKey: ["/api/design/line-item", selectedItem?.lineItemId, "workspace"],
    queryFn: async () => {
      const json = await readJson<{ data: DesignWorkspaceData }>(`/api/design/line-item/${selectedItem?.lineItemId}/workspace`);
      return json.data;
    },
    enabled: Boolean(selectedItem?.lineItemId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const proofing = proofingQuery.data;
  const workspace = workspaceQuery.data;
  const displayPrintType = selectedItem ? getDisplayPrintType(selectedItem, selectedLineItem) : null;
  const displayMaterial = selectedItem ? getDisplayMaterial(selectedItem, selectedLineItem) : null;
  const specRows = selectedItem ? getSpecRows(selectedItem, selectedLineItem, displayPrintType, displayMaterial) : [];
  const instructionItems = selectedItem ? getInstructionItems(selectedLineItem, displayPrintType, displayMaterial) : [];
  const proofVersionHistory = proofing?.proofVersionHistory.slice(0, 4) ?? [];
  const recommendedAction = selectedItem
    ? getRecommendedAction({
        item: selectedItem,
        proofing,
        artworkCount: selectedItem.fileCounts?.originals || 0,
      })
    : null;

  useEffect(() => {
    if (workspace?.session.status !== "active") return;

    const intervalId = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [workspace?.session.status, workspace?.session.activeStartedAt]);

  const invalidateDesignWorkspace = async (lineItemId?: string | null, orderId?: string | null) => {
    await queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
    if (lineItemId) {
      await queryClient.invalidateQueries({ queryKey: ["/api/design/line-item", lineItemId, "workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId] });
    }
    if (orderId) {
      await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
    }
  };

  const sessionMutation = useMutation({
    mutationFn: async (action: "start" | "pause" | "resume") => {
      if (!selectedItem) throw new Error("Select a line item first");

      if (action === "start") {
        if (selectedItem.workflowState !== "in_design") {
          await readJson(`/api/design/line-item/${selectedItem.lineItemId}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        }
        await readJson(`/api/design/line-item/${selectedItem.lineItemId}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        return;
      }

      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    },
    onSuccess: async (_, action) => {
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      if (action === "pause") {
        toast({ title: "Design paused", description: "The active design session was paused." });
      }
      if (action === "resume") {
        toast({ title: "Design resumed", description: "A new working segment resumed on this line item." });
      }
      if (action === "start") {
        toast({ title: "Design started", description: "A new design session was created for this line item." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Session update failed", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Select a line item first");
      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    },
    onSuccess: async () => {
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      toast({ title: "Design completed", description: "The line item was advanced to its next workflow state." });
    },
    onError: (error: Error) => {
      toast({ title: "Complete design failed", description: error.message, variant: "destructive" });
    },
  });

  const noteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Select a line item first");
      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: noteDraft.trim(), noteKind }),
      });
    },
    onSuccess: async () => {
      setNoteDraft("");
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      toast({ title: "Note saved", description: "The working log note was added." });
    },
    onError: (error: Error) => {
      toast({ title: "Note save failed", description: error.message, variant: "destructive" });
    },
  });

  const currentTotalMinutes = Math.round((workspace?.totalTrackedMs ?? 0) / 60_000);
  const parsedAdjustment = parseSignedMinutesInput(adjustMinutesDraft, currentTotalMinutes);

  const adjustTimeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Select a line item first");
      if (
        !parsedAdjustment.isValid ||
        parsedAdjustment.adjustedTotalMinutes == null ||
        parsedAdjustment.deltaMinutes == null
      ) {
        throw new Error("Enter a valid minute adjustment");
      }
      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/time-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deltaMinutes: parsedAdjustment.deltaMinutes,
          adjustedTotalMinutes: parsedAdjustment.adjustedTotalMinutes,
          reason: adjustReasonDraft.trim(),
        }),
      });
    },
    onSuccess: async () => {
      setAdjustMinutesDraft("");
      setAdjustReasonDraft("");
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      toast({ title: "Time corrected", description: "The tracked design time was updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Time correction failed", description: error.message, variant: "destructive" });
    },
  });

  const liveElapsedMs = useMemo(() => {
    if (!workspace) return 0;
    if (workspace.session.status !== "active" || !workspace.session.activeStartedAt) {
      return workspace.totalTrackedMs;
    }
    const activeStartedMs = new Date(workspace.session.activeStartedAt).getTime();
    if (!Number.isFinite(activeStartedMs)) return workspace.totalTrackedMs;
    return workspace.totalTrackedMs + Math.max(0, timerNow - activeStartedMs);
  }, [timerNow, workspace]);

  const sessionStatusText = useMemo(() => {
    if (!workspace) return "Ready to start";
    if (workspace.session.status === "paused") {
      return `Paused ${formatRelativeTime(workspace.session.pausedAt)}`;
    }
    if (workspace.session.status === "active") {
      return `Started ${formatRelativeTime(workspace.session.activeStartedAt || workspace.session.startedAt)}`;
    }
    return "Ready to start";
  }, [workspace]);

  const primarySessionAction = useMemo(() => {
    if (!workspace) return { label: "Start", action: "start" as const };
    if (workspace.session.status === "active") return { label: "Pause", action: "pause" as const };
    if (workspace.session.status === "paused") return { label: "Resume", action: "resume" as const };
    return { label: "Start", action: "start" as const };
  }, [workspace]);

  const sortedActivity = useMemo(() => {
    const activity = [...(workspace?.activity ?? [])];
    activity.sort((left, right) => {
      const leftTime = new Date(left.at).getTime();
      const rightTime = new Date(right.at).getTime();
      return activitySort === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });
    return activity;
  }, [activitySort, workspace?.activity]);

  const canCompleteDesign = selectedItem?.workflowState === "in_design" || workspace?.session.status === "paused";
  const canCreateProof = Boolean(selectedItem?.requiresProofApproval && selectedItem?.lineItemId);
  const canSaveNote = noteDraft.trim().length > 0;
  const canSubmitAdjustment =
    isAdminOrOwner &&
    parsedAdjustment.isValid &&
    parsedAdjustment.adjustedTotalMinutes != null &&
    adjustReasonDraft.trim().length >= 3 &&
    parsedAdjustment.adjustedTotalMinutes !== currentTotalMinutes;

  const metadataColumnOne = selectedItem
    ? [
        {
          label: "Order / Line Item",
          value: selectedOwnerLabel ? `#${selectedItem.jobNumber} • ${selectedOwnerLabel}` : `#${selectedItem.jobNumber} • ${selectedItem.lineItemId}`,
        },
        {
          label: "Customer",
          value: selectedItem.customerName,
        },
        {
          label: "Due Date",
          value: `${formatDateTime(order?.dueDate ?? selectedItem.dueDate)}${order?.dueDate ?? selectedItem.dueDate ? ` • ${formatRelativeTime(order?.dueDate ?? selectedItem.dueDate)}` : ""}`,
        },
      ]
    : [];

  const metadataColumnTwo = selectedItem
    ? [
        {
          label: "Quantity",
          value: String(selectedLineItem?.quantity ?? selectedItem.quantity ?? "-"),
        },
        {
          label: "Size",
          value: (specRows.find((row) => row.label === "Size")?.value as string | undefined) || "-",
        },
        {
          label: "Product",
          value: getReadableLabel(selectedLineItem?.product?.name) || getReadableLabel(selectedItem.productName) || "-",
        },
      ]
    : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Design Queue</CardTitle>
            <Badge variant="outline">{queue.length}</Badge>
          </div>
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
                <div className="px-4 py-5 text-sm text-muted-foreground">No line items are currently assigned to Design.</div>
              ) : (
                queue.map((item) => (
                  <button
                    key={item.lineItemId}
                    type="button"
                    onClick={() => setSelectedLineItemId(item.lineItemId)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/30",
                      selectedItem?.lineItemId === item.lineItemId && "bg-muted/40",
                    )}
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
        <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
          <CardContent className="p-8 text-sm text-muted-foreground">
            Select a line item from the queue to open the designer workspace.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="truncate text-[15px] font-semibold leading-5 sm:text-base">
                      {selectedLineItem?.product?.name ?? selectedItem.productName}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground">
                      Order #{selectedItem.jobNumber} • {selectedItem.customerName}
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={ROUTES.orders.detail(selectedItem.orderId)}>
                      Open Order
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2.5">
                        {metadataColumnOne.map((item) => (
                          <CompactInfoRow key={item.label} label={item.label} value={item.value} valueClassName="break-words" />
                        ))}
                      </div>
                      <div className="space-y-2.5 border-border/50 md:border-l md:pl-4">
                        {metadataColumnTwo.map((item) => (
                          <CompactInfoRow key={item.label} label={item.label} value={item.value} valueClassName="break-words" />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-3 shadow-sm shadow-black/10">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-2xl font-semibold tracking-tight text-foreground">
                          {formatElapsedTime(liveElapsedMs)}
                        </div>
                        <div className="text-sm text-muted-foreground">{sessionStatusText}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        className="w-full justify-between"
                        disabled={sessionMutation.isPending}
                        onClick={() => sessionMutation.mutate(primarySessionAction.action)}
                      >
                        <span>{primarySessionAction.label}</span>
                        <Palette className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between"
                        disabled={!canCompleteDesign || completeMutation.isPending}
                        onClick={() => completeMutation.mutate()}
                      >
                        <span>Complete Design</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Design Brief</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-sm leading-6 text-foreground">
                  {selectedLineItem?.description || selectedItem.productName || "No detailed design brief captured on this line item."}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Key Instructions</div>
                    {instructionItems.length > 0 ? (
                      <ul className="space-y-2 text-sm text-foreground">
                        {instructionItems.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                        No structured design instructions captured.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Internal Notes</div>
                      {orderQuery.isLoading ? (
                        <Skeleton className="h-16 w-full" />
                      ) : order?.notesInternal ? (
                        <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-sm leading-6">
                          {order.notesInternal}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                          No internal notes.
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest Proof Feedback</div>
                      {proofingQuery.isLoading ? (
                        <Skeleton className="h-16 w-full" />
                      ) : proofing?.proofDecisionHistory[0] ? (
                        <div className="rounded-lg border border-border/80 bg-muted/15 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline">
                              {proofing.proofDecisionHistory[0].decision.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(proofing.proofDecisionHistory[0].respondedAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-foreground">
                            {proofing.proofDecisionHistory[0].responseNotes || "No written feedback captured."}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                          No proof feedback yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Working Log</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 md:grid-cols-3">
                  <MetaCard label="Total Tracked" primary={formatDurationLabel(workspace?.totalTrackedMs ?? 0)} secondary={formatElapsedTime(workspace?.totalTrackedMs ?? 0)} />
                  <MetaCard label="Raw Sessions" primary={formatDurationLabel(workspace?.rawTrackedMs ?? 0)} secondary={`${workspace?.notes.length ?? 0} notes`} />
                  <MetaCard label="Adjustments" primary={formatDurationLabel(workspace?.totalAdjustmentMs ?? 0)} secondary={`${workspace?.adjustments.length ?? 0} entries`} />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-3 rounded-lg border border-border/80 bg-muted/15 p-3">
                    <div className="flex flex-wrap gap-2">
                      {(["internal_note", "progress_update", "blocker_update"] as DesignNoteKind[]).map((kind) => (
                        <Button
                          key={kind}
                          type="button"
                          size="sm"
                          variant={noteKind === kind ? "secondary" : "outline"}
                          className="h-8"
                          onClick={() => setNoteKind(kind)}
                        >
                          {getNoteKindLabel(kind)}
                        </Button>
                      ))}
                    </div>
                    <Textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Add a concise working note"
                      className="min-h-[108px] resize-y border-border/80 bg-background/60"
                    />
                    <div className="flex justify-end">
                      <Button type="button" disabled={!canSaveNote || noteMutation.isPending} onClick={() => noteMutation.mutate()}>
                        Save Note
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border/80 bg-muted/15 p-3">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Time Correction</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Time correction help"
                          >
                            <CircleAlert className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-5">
                          Use + or - with whole minutes to adjust the current total.
                          Example: +15 adds 15 minutes, -30 removes 30 minutes.
                          All corrections are recorded.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      value={adjustMinutesDraft}
                      onChange={(event) => setAdjustMinutesDraft(event.target.value)}
                      placeholder="Enter +15 or -30"
                      className="border-border/80 bg-background/60"
                      disabled={!isAdminOrOwner}
                    />
                    <Textarea
                      value={adjustReasonDraft}
                      onChange={(event) => setAdjustReasonDraft(event.target.value)}
                      placeholder="Reason required"
                      className="min-h-[88px] resize-y border-border/80 bg-background/60"
                      disabled={!isAdminOrOwner}
                    />
                    <Button
                      type="button"
                      className="w-full"
                      disabled={!canSubmitAdjustment || adjustTimeMutation.isPending}
                      onClick={() => adjustTimeMutation.mutate()}
                    >
                      Apply Time Correction
                    </Button>
                    {/* TODO: if exact-total mode is added later, keep it admin-only and expose it via a separate secondary action such as a modal. */}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Files & References</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selectedItem.fileCounts?.originals || 0} source files</Badge>
                  <Badge variant="outline">{selectedItem.fileCounts?.proofs || 0} proof files</Badge>
                  {selectedItem.requiresProofApproval ? <Badge variant="secondary">Proof required</Badge> : null}
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

          <div className="space-y-3">
            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Next Action</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-primary/80">Recommended Next Action</div>
                  <div className="mt-1 text-base font-semibold text-foreground">{recommendedAction?.title ?? "Review line item"}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recommendedAction?.detail ?? "Use the workspace to review files, notes, and workflow state."}
                  </p>
                </div>

                <div className="grid gap-2">
                  <MetaCard
                    label="Workflow"
                    primary={WORKFLOW_LABELS[workspace?.effectiveState || selectedItem.workflowState] || workspace?.effectiveState || selectedItem.workflowState}
                    secondary={`Routes to ${getDownstreamPath(selectedItem)}`}
                  />
                  <MetaCard
                    label="Last Order Update"
                    primary={formatRelativeTime(order?.updatedAt)}
                    secondary={`${proofing?.proofVersionHistory.length ?? 0} versions • ${selectedItem.fileCounts?.originals || 0} source files`}
                  />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-between disabled:pointer-events-none disabled:opacity-50"
                  disabled={!canCreateProof}
                  onClick={() => navigate(`${ROUTES.production.proofing}?lineItemId=${selectedItem.lineItemId}&slice=all`)}
                >
                  <span>Create & Send Proof</span>
                  <Send className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Versions</CardTitle>
              </CardHeader>
              <CardContent>
                {proofingQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-14 w-full" />
                    ))}
                  </div>
                ) : proofVersionHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">No versions yet</div>
                ) : (
                  <div className="space-y-2">
                    {proofVersionHistory.map((version) => (
                      <div key={version.id} className="rounded-lg border border-border/80 bg-muted/15 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-foreground">Version {version.versionNumber}</div>
                          <Badge variant={version.status === "approved" ? "default" : "outline"}>
                            {version.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Created {formatRelativeTime(version.createdAt)}
                          {version.sentAt ? ` • Sent ${formatRelativeTime(version.sentAt)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-sm shadow-black/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Recent Activity</CardTitle>
                  <div className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/20 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={activitySort === "newest" ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setActivitySort("newest")}
                    >
                      Newest first
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={activitySort === "oldest" ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setActivitySort("oldest")}
                    >
                      Oldest first
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {workspaceQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-14 w-full" />
                    ))}
                  </div>
                ) : sortedActivity.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                    No recent activity yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sortedActivity.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-border/80 bg-muted/15 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={getActivityVariant(entry.type)}>{getActivityTypeLabel(entry.type)}</Badge>
                              <div className="text-sm font-medium text-foreground">{entry.label}</div>
                            </div>
                            <div className="text-sm text-muted-foreground">{entry.detail}</div>
                            {entry.userName ? <div className="text-xs text-muted-foreground">{entry.userName}</div> : null}
                          </div>
                          <div className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(entry.at)}</div>
                        </div>
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