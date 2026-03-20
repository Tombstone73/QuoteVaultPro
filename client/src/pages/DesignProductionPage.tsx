import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  FileText,
  Package2,
  Pause,
  Play,
  Send,
} from "lucide-react";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import { useAuth } from "@/hooks/useAuth";
import type { DesignQueueItem } from "@/hooks/useOrders";
import { useDesignQueue, useOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
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

const NOTE_KIND_LABELS = {
  internal_note: "Internal Note",
  progress_update: "Progress Update",
  blocker_update: "Blocker / Issue",
} as const;

const SHELL_PANEL = "border border-white/[0.07] bg-[#121b29] shadow-[0_20px_50px_rgba(0,0,0,0.28)]";
const SECTION_PANEL = "rounded-[18px] border border-white/[0.06] bg-[#111927]";
const META_PANEL = "rounded-[14px] border border-white/[0.08] bg-[#0d1623]";
const MUTED_PANEL = "rounded-[16px] border border-white/[0.06] bg-[#0f1724]";

type DesignNoteKind = keyof typeof NOTE_KIND_LABELS;
type EffectiveDesignState = "needs_design" | "in_design" | "paused" | "design_complete";

type WorkingLogEntry = {
  id: string;
  at: string;
  type: "session" | "note" | "adjustment" | "audit";
  label: string;
  detail: string;
  userName: string | null;
};

type DesignWorkspaceData = {
  effectiveState: EffectiveDesignState;
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
  activity: WorkingLogEntry[];
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

function looksLikeUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function getReadableLabel(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || looksLikeUuid(trimmed)) return null;
  return trimmed;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
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

function getQueueBadgeClasses(state: string | null | undefined) {
  switch (state) {
    case "in_design":
      return "border border-[#2d62f5]/40 bg-[#1337ec]/18 text-[#89a9ff]";
    case "needs_design":
      return "border border-white/10 bg-white/[0.03] text-slate-200";
    case "design_complete":
      return "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "on_hold":
      return "border border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border border-white/10 bg-white/[0.03] text-slate-300";
  }
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
          ? `${selectedLineItem.width} × ${selectedLineItem.height}`
          : selectedItem.width && selectedItem.height
            ? `${selectedItem.width} × ${selectedItem.height}`
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
      title: "Review missing source files",
      detail: "No artwork or source files are attached to this line item yet. Gather references before starting design.",
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
      detail: "Open a new design session and move the item into active work.",
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
      detail: "Finish this design pass, then move the line item into proofing using the existing downstream workflow.",
    };
  }

  return {
    title: "Complete Design",
    detail: "Once artwork is ready, complete design so the line item can continue into prepress or production.",
  };
}

function getDownstreamPath(item: DesignQueueItem) {
  if (item.requiresProofApproval) return "Proofing";
  if (item.requiresPrepress) return "Prepress";
  return "Production";
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

export default function DesignProductionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: queue = [], isLoading } = useDesignQueue();
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteKind, setNoteKind] = useState<DesignNoteKind>("internal_note");
  const [timerNow, setTimerNow] = useState(Date.now());
  const [adjustedMinutesDraft, setAdjustedMinutesDraft] = useState("");
  const [adjustReasonDraft, setAdjustReasonDraft] = useState("");

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
    setAdjustReasonDraft("");
  }, [selectedItem?.lineItemId]);

  const selectedOwnerLabel = selectedItem ? formatOwnerLabel(selectedItem) : null;
  const isAdminOrOwner = user?.role === "owner" || user?.role === "admin" || Boolean(user?.isAdmin);

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
  const effectiveState = workspace?.effectiveState ?? "needs_design";
  const displayPrintType = selectedItem ? getDisplayPrintType(selectedItem, selectedLineItem) : null;
  const displayMaterial = selectedItem ? getDisplayMaterial(selectedItem, selectedLineItem) : null;
  const specRows = selectedItem ? getSpecRows(selectedItem, selectedLineItem, displayPrintType, displayMaterial) : [];
  const instructionItems = selectedItem ? getInstructionItems(selectedLineItem, displayPrintType, displayMaterial) : [];
  const proofVersionHistory = proofing?.proofVersionHistory.slice(0, 4) ?? [];

  useEffect(() => {
    if (!workspace) return;
    setAdjustedMinutesDraft((workspace.totalTrackedMs / 60000).toFixed(2));
  }, [workspace?.totalTrackedMs]);

  const proofingActivity = useMemo(() => {
    if (!proofing) return [] as Array<{ id: string; label: string; detail: string; at: string | null }>;

    const items: Array<{ id: string; label: string; detail: string; at: string | null }> = [];

    proofing.proofDecisionHistory.slice(0, 2).forEach((entry, index) => {
      items.push({
        id: `decision-${entry.respondedAt}-${index}`,
        label: `Proof ${entry.decision.replace(/_/g, " ")}`,
        detail: entry.responseNotes || entry.responderName || entry.responderEmail || "Proof response recorded",
        at: entry.respondedAt,
      });
    });

    proofing.manualApprovalOverrideHistory.slice(0, 1).forEach((entry, index) => {
      items.push({
        id: `override-${entry.overriddenAt}-${index}`,
        label: "Manual approval override",
        detail: entry.overrideReason,
        at: entry.overriddenAt,
      });
    });

    return items;
  }, [proofing]);

  const recentActivity = useMemo(() => {
    const workspaceActivity = [...(workspace?.activity ?? [])]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 4)
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        detail: entry.detail,
        at: entry.at,
      }));

    return [...workspaceActivity, ...proofingActivity]
      .filter((entry) => !!entry.at)
      .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
      .slice(0, 4);
  }, [proofingActivity, workspace?.activity]);

  const adjustmentMap = useMemo(() => {
    const map = new Map<string, DesignWorkspaceData["adjustments"][number]>();
    for (const adjustment of workspace?.adjustments ?? []) {
      map.set(adjustment.id, adjustment);
    }
    return map;
  }, [workspace?.adjustments]);

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
      toast({ title: "Design completed", description: "The working period was closed and completion was recorded." });
    },
    onError: (error: Error) => {
      toast({ title: "Complete design failed", description: error.message, variant: "destructive" });
    },
  });

  const noteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Select a line item first");
      const trimmed = noteDraft.trim();
      if (!trimmed) throw new Error("Enter a note before saving");

      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: trimmed, noteKind }),
      });
    },
    onSuccess: async () => {
      setNoteDraft("");
      setNoteKind("internal_note");
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      toast({ title: "Note saved", description: "The update was added to the working log." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save note", description: error.message, variant: "destructive" });
    },
  });

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Select a line item first");
      const adjustedTotalMinutes = Number(adjustedMinutesDraft);
       if (!Number.isFinite(adjustedTotalMinutes)) throw new Error("Enter a valid total in minutes");
      const reason = adjustReasonDraft.trim();
      if (!reason) throw new Error("A reason is required for time corrections");

      await readJson(`/api/design/line-item/${selectedItem.lineItemId}/time-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustedTotalMinutes, reason }),
      });
    },
    onSuccess: async () => {
      setAdjustReasonDraft("");
      await invalidateDesignWorkspace(selectedItem?.lineItemId, selectedItem?.orderId);
      toast({ title: "Tracked time adjusted", description: "The correction was recorded in the working log." });
    },
    onError: (error: Error) => {
      toast({ title: "Time adjustment failed", description: error.message, variant: "destructive" });
    },
  });

  const displayedTimerMs = useMemo(() => {
    if (!workspace) return 0;
    if (workspace.session.status !== "active") return workspace.totalTrackedMs;
    return workspace.totalTrackedMs + Math.max(0, timerNow - workspaceQuery.dataUpdatedAt);
  }, [timerNow, workspace, workspaceQuery.dataUpdatedAt]);

  const sessionControl = useMemo(() => {
    if (effectiveState === "paused") {
      return {
        label: "Resume",
        action: "resume" as const,
        icon: Play,
      };
    }

    if (effectiveState === "in_design") {
      return {
        label: "Pause",
        action: "pause" as const,
        icon: Pause,
      };
    }

    return {
      label: "Start",
      action: "start" as const,
      icon: Play,
    };
  }, [effectiveState]);

  const canCompleteDesign = effectiveState === "in_design" || effectiveState === "paused";
  const canCreateProof = Boolean(selectedItem?.requiresProofApproval);
  const detailTitle =
    getReadableLabel(selectedLineItem?.product?.name) ||
    getReadableLabel(selectedItem?.productName) ||
    "Design Workspace";
  const detailSummary =
    getReadableLabel(selectedLineItem?.description) ||
    getReadableLabel(selectedItem?.productName) ||
    "No detailed design brief captured on this line item.";
  const desktopGridClass = selectedItem
    ? "xl:grid-cols-[320px_minmax(0,1fr)_320px]"
    : "xl:grid-cols-[320px_minmax(0,1fr)]";

  return (
    <div className="space-y-4 bg-[radial-gradient(circle_at_top,rgba(84,120,214,0.08),transparent_34%)] text-slate-100">
      <div className="rounded-[18px] border border-white/[0.06] bg-[#0b1220] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              <span>Production Board</span>
              <span className="text-slate-700">/</span>
              <span className="text-slate-300">Design</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-sm font-semibold text-white">Design Workspace</h1>
              {selectedItem ? (
                <span className="rounded-full border border-[#2d62f5]/30 bg-[#1337ec]/12 px-2.5 py-1 text-[11px] font-medium text-[#8ba9ff]">
                  {WORKFLOW_LABELS[effectiveState] || WORKFLOW_LABELS[selectedItem.designStatus] || selectedItem.designStatus}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            {selectedItem ? `Order #${selectedItem.jobNumber}` : `${queue.length} active queue items`}
          </div>
        </div>
      </div>

      <div className={`grid overflow-hidden rounded-[22px] border border-white/[0.06] bg-[#09111b] ${desktopGridClass}`}>
        <aside className="border-b border-white/[0.06] bg-[#0c1320] xl:border-b-0 xl:border-r">
          <div className="border-b border-white/[0.06] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[19px] font-semibold leading-tight text-white">Design Queue</h2>
                <p className="mt-1 text-[12px] text-slate-400">Live line items currently in the design workflow.</p>
              </div>
              <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-slate-400">
                {queue.length}
              </div>
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-17rem)] min-h-[520px]">
            <div className="space-y-3 px-4 py-4">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 w-full rounded-2xl bg-white/[0.04]" />
                ))
              ) : queue.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-white/[0.08] px-4 py-5 text-sm text-slate-400">
                  No line items are currently assigned to Design.
                </div>
              ) : (
                queue.map((item) => {
                  const isSelected = selectedItem?.lineItemId === item.lineItemId;
                  return (
                    <button
                      key={item.lineItemId}
                      type="button"
                      onClick={() => setSelectedLineItemId(item.lineItemId)}
                      className={`w-full rounded-[18px] border px-4 py-3 text-left transition-all ${
                        isSelected
                          ? "border-[#2d62f5] bg-[#1337ec]/14 shadow-[0_0_0_1px_rgba(45,98,245,0.15)]"
                          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold text-slate-300">#{item.jobNumber}</div>
                          <div className="truncate text-[11px] text-slate-500">{item.customerName}</div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getQueueBadgeClasses(
                            item.designStatus,
                          )}`}
                        >
                          {WORKFLOW_LABELS[item.designStatus] || item.designStatus}
                        </span>
                      </div>

                      <div className="mt-2 line-clamp-2 text-[14px] font-semibold leading-5 text-white">{item.productName}</div>

                      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <div className="flex items-center gap-3">
                          <span>Art: {item.fileCounts?.originals || 0}</span>
                          <span>Proofs: {item.fileCounts?.proofs || 0}</span>
                        </div>
                        <span>{item.dueDate ? formatRelativeTime(item.dueDate) : "No due date"}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </aside>

        {!selectedItem ? (
          <div className="flex items-center justify-center bg-[#101827] px-6 py-16">
            <div className="max-w-md rounded-[20px] border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center">
              <div className="text-lg font-semibold text-white">Select a line item</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Choose a job from the Design Queue to open the full production workspace, session controls, working log, and files.
              </p>
            </div>
          </div>
        ) : (
          <>
            <main className="border-b border-white/[0.06] bg-[#101827] xl:border-b-0 xl:border-r">
              <div className="space-y-5 px-6 py-6">
                <section className={`${SHELL_PANEL} rounded-[22px] px-6 py-6`}>
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {selectedOwnerLabel || "Design"}
                        </span>
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Routes to {getDownstreamPath(selectedItem)}
                        </span>
                        {selectedItem.requiresProofApproval ? (
                          <span className="rounded-full border border-[#2d62f5]/25 bg-[#1337ec]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8ba9ff]">
                            Proof handoff required
                          </span>
                        ) : null}
                      </div>

                      <h2 className="mt-4 text-[30px] font-semibold leading-tight text-white">{detailTitle}</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        Order #{selectedItem.jobNumber} • {selectedItem.customerName}
                      </p>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className={`${META_PANEL} px-4 py-3`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Job / Line Item</div>
                          <div className="mt-2 text-sm font-semibold text-white">#{selectedItem.jobNumber}</div>
                          <div className="mt-1 text-xs text-slate-500">{detailTitle}</div>
                        </div>
                        <div className={`${META_PANEL} px-4 py-3`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Due Date</div>
                          <div className="mt-2 text-sm font-semibold text-white">{formatDateLabel(order?.dueDate ?? selectedItem.dueDate)}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatRelativeTime(order?.dueDate ?? selectedItem.dueDate)}</div>
                        </div>
                        <div className={`${META_PANEL} px-4 py-3`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer</div>
                          <div className="mt-2 text-sm font-semibold text-white">{selectedItem.customerName}</div>
                          <div className="mt-1 text-xs text-slate-500">{displayPrintType || "Design work item"}</div>
                        </div>
                        <div className={`${META_PANEL} px-4 py-3`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Files on Item</div>
                          <div className="mt-2 text-sm font-semibold text-white">{selectedItem.fileCounts?.originals || 0} source</div>
                          <div className="mt-1 text-xs text-slate-500">{selectedItem.fileCounts?.proofs || 0} proof files attached</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[18px] border border-white/[0.08] bg-[#142031] px-4 py-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Design Session</div>
                          <div className="mt-1 text-sm text-slate-300">{WORKFLOW_LABELS[effectiveState] || "Needs Design"}</div>
                        </div>
                        <Badge className="border-white/[0.08] bg-white/[0.05] text-slate-200 hover:bg-white/[0.05]">
                          {WORKFLOW_LABELS[effectiveState] || effectiveState}
                        </Badge>
                      </div>

                      <div className="mt-4 text-[30px] font-semibold tracking-tight text-white">{formatElapsedTime(displayedTimerMs)}</div>
                      <div className="mt-1 text-[12px] text-slate-400">
                        {workspace?.session.status === "paused" && workspace?.session.pausedAt
                          ? `Paused ${formatRelativeTime(workspace.session.pausedAt)}`
                          : workspace?.session.startedAt
                            ? `Started ${formatRelativeTime(workspace.session.startedAt)}`
                            : "Start design when this line item is ready for active work."}
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          className="h-11 rounded-xl bg-[#2d62f5] text-white hover:bg-[#3a6cff]"
                          disabled={sessionMutation.isPending || workspaceQuery.isLoading}
                          onClick={() => sessionMutation.mutate(sessionControl.action)}
                        >
                          <sessionControl.icon className="mr-2 h-4 w-4" />
                          {sessionControl.label}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl border-white/[0.08] bg-white/[0.02] text-slate-200 hover:bg-white/[0.05]"
                          disabled={!canCompleteDesign || completeMutation.isPending}
                          onClick={() => completeMutation.mutate()}
                        >
                          <ArrowRight className="mr-2 h-4 w-4" />
                          Complete Design
                        </Button>
                      </div>
                    </div>
                  </div>

                  {specRows.length > 0 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {specRows.map((row) => (
                        <div key={row.label} className={`${META_PANEL} px-4 py-3`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{row.label}</div>
                          <div className="mt-2 text-sm font-semibold text-white">{row.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                  <section className={`${SECTION_PANEL} p-5`}>
                    <div>
                      <h3 className="text-[18px] font-semibold text-white">Design Brief</h3>
                      <p className="mt-1 text-[12px] text-slate-400">
                        What this job is and what the designer needs to produce.
                      </p>
                    </div>

                    <div className="mt-5 rounded-[16px] border border-white/[0.06] bg-[#121d2c] px-4 py-4 text-sm leading-6 text-slate-200">
                      {detailSummary}
                    </div>

                    <div className="mt-5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Key Instructions</div>
                      {instructionItems.length > 0 ? (
                        <ul className="mt-3 space-y-2 text-sm text-slate-200">
                          {instructionItems.map((item) => (
                            <li key={item} className="flex gap-2.5">
                              <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-[#4d79ff]" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-3 rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-sm text-slate-400">
                          No structured design instructions were captured beyond the line item description.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className={`${SECTION_PANEL} p-5`}>
                    <div>
                      <h3 className="text-[18px] font-semibold text-white">Context</h3>
                      <p className="mt-1 text-[12px] text-slate-400">
                        Sales handoff, internal order context, and latest proof feedback already on the record.
                      </p>
                    </div>

                    <div className="mt-5 space-y-4 text-sm">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Order Internal Notes</div>
                        {orderQuery.isLoading ? (
                          <Skeleton className="mt-3 h-24 w-full rounded-[14px] bg-white/[0.04]" />
                        ) : order?.notesInternal ? (
                          <div className="mt-3 rounded-[14px] border border-white/[0.06] bg-[#0f1827] px-4 py-4 leading-6 text-slate-200">
                            {order.notesInternal}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-slate-400">
                            No order-level internal notes are attached to this job yet.
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Latest Proof Feedback</div>
                        {proofingQuery.isLoading ? (
                          <Skeleton className="mt-3 h-24 w-full rounded-[14px] bg-white/[0.04]" />
                        ) : proofing?.proofDecisionHistory[0] ? (
                          <div className="mt-3 rounded-[14px] border border-white/[0.06] bg-[#0f1827] px-4 py-4">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="border-white/[0.08] bg-white/[0.03] text-slate-300">
                                {proofing.proofDecisionHistory[0].decision.replace(/_/g, " ")}
                              </Badge>
                              <span className="text-[11px] text-slate-500">
                                {formatRelativeTime(proofing.proofDecisionHistory[0].respondedAt)}
                              </span>
                            </div>
                            <p className="mt-3 leading-6 text-slate-200">
                              {proofing.proofDecisionHistory[0].responseNotes ||
                                "No written feedback was captured on the latest proof response."}
                            </p>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-slate-400">
                            No proof feedback exists on this line item yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                <section className={`${SECTION_PANEL} p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[18px] font-semibold text-white">Working Log</h3>
                      <p className="mt-1 text-[12px] text-slate-400">
                        Immutable design session history, notes, and time corrections for this line item.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className={`${META_PANEL} min-w-[140px] px-4 py-3`}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Total Tracked</div>
                        <div className="mt-2 text-sm font-semibold text-white">{formatDurationLabel(displayedTimerMs)}</div>
                      </div>
                      <div className={`${META_PANEL} min-w-[140px] px-4 py-3`}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Raw Sessions</div>
                        <div className="mt-2 text-sm font-semibold text-white">{formatDurationLabel(workspace?.rawTrackedMs ?? 0)}</div>
                      </div>
                      <div className={`${META_PANEL} min-w-[140px] px-4 py-3`}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Adjustments</div>
                        <div className="mt-2 text-sm font-semibold text-white">{formatDurationLabel(workspace?.totalAdjustmentMs ?? 0)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                    <div className="space-y-4">
                      <div className={`${MUTED_PANEL} px-4 py-4`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Add to Working Log</div>
                            <div className="mt-1 text-[12px] text-slate-400">Notes become permanent history alongside session events and corrections.</div>
                          </div>
                          <div className="flex gap-2">
                            {(["internal_note", "progress_update", "blocker_update"] as DesignNoteKind[]).map((value) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setNoteKind(value)}
                                className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                                  noteKind === value
                                    ? "border-[#2d62f5]/40 bg-[#1337ec]/18 text-[#8ba9ff]"
                                    : "border-white/[0.08] bg-white/[0.03] text-slate-400"
                                }`}
                              >
                                {NOTE_KIND_LABELS[value]}
                              </button>
                            ))}
                          </div>
                        </div>

                        <Textarea
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder="Add a design note, progress update, or blocker for this line item..."
                          className="mt-3 min-h-[110px] rounded-[14px] border-white/[0.08] bg-[#0b1420] text-sm text-slate-100 placeholder:text-slate-500"
                        />
                        <div className="mt-3 flex justify-end">
                          <Button
                            type="button"
                            className="h-10 rounded-xl bg-[#2d62f5] px-4 text-white hover:bg-[#3a6cff]"
                            disabled={noteMutation.isPending || noteDraft.trim().length === 0}
                            onClick={() => noteMutation.mutate()}
                          >
                            Save to Log
                          </Button>
                        </div>
                      </div>

                      {isAdminOrOwner ? (
                        <div className={`${MUTED_PANEL} px-4 py-4`}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Admin Time Correction</div>
                          <div className="mt-1 text-[12px] text-slate-400">Adjust total tracked minutes without rewriting raw session history. A reason is required.</div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                            <Input
                              type="number"
                              min="0"
                              step="0.25"
                              value={adjustedMinutesDraft}
                              onChange={(event) => setAdjustedMinutesDraft(event.target.value)}
                              className="h-10 rounded-xl border-white/[0.08] bg-[#0b1420] text-slate-100"
                              placeholder="Total minutes"
                            />
                            <Input
                              value={adjustReasonDraft}
                              onChange={(event) => setAdjustReasonDraft(event.target.value)}
                              className="h-10 rounded-xl border-white/[0.08] bg-[#0b1420] text-slate-100"
                              placeholder="Reason for adjustment"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 rounded-xl border-white/[0.08] bg-white/[0.02] text-slate-200 hover:bg-white/[0.05]"
                              disabled={adjustmentMutation.isPending || adjustReasonDraft.trim().length === 0 || adjustedMinutesDraft.trim().length === 0}
                              onClick={() => adjustmentMutation.mutate()}
                            >
                              Record Adjustment
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      {workspaceQuery.isLoading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                          <Skeleton key={index} className="h-24 w-full rounded-[14px] bg-white/[0.04]" />
                        ))
                      ) : (workspace?.activity.length ?? 0) === 0 ? (
                        <div className="rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-slate-400">
                          No working-log history is recorded yet for this line item.
                        </div>
                      ) : (
                        workspace?.activity.map((entry) => {
                          const adjustment = adjustmentMap.get(entry.id);
                          return (
                            <div key={entry.id} className={`${MUTED_PANEL} px-4 py-4`}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="border-white/[0.08] bg-white/[0.03] text-slate-300">
                                    {entry.type === "note"
                                      ? "Note"
                                      : entry.type === "session"
                                        ? "Session"
                                        : entry.type === "adjustment"
                                          ? "Adjustment"
                                          : "Audit"}
                                  </Badge>
                                  <div className="text-sm font-semibold text-white">{entry.label}</div>
                                </div>
                                <span className="text-[11px] text-slate-500">{formatRelativeTime(entry.at)}</span>
                              </div>

                              <div className="mt-3 text-sm leading-6 text-slate-200">{entry.detail}</div>

                              {adjustment ? (
                                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                  <div className={`${META_PANEL} px-3 py-2`}>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Before</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{formatDurationLabel(adjustment.beforeMs)}</div>
                                  </div>
                                  <div className={`${META_PANEL} px-3 py-2`}>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">After</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{formatDurationLabel(adjustment.afterMs)}</div>
                                  </div>
                                  <div className={`${META_PANEL} px-3 py-2`}>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Delta</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{adjustment.deltaMs >= 0 ? "+" : ""}{formatDurationLabel(Math.abs(adjustment.deltaMs))}</div>
                                  </div>
                                </div>
                              ) : null}

                              <div className="mt-3 text-[11px] text-slate-500">{entry.userName || "Team member"}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </section>

                <section className={`${SECTION_PANEL} p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[18px] font-semibold text-white">Files & References</h3>
                      <p className="mt-1 text-[12px] text-slate-400">
                        Use the existing line-item file manager for source art, references, and uploads.
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl border-white/[0.08] bg-white/[0.02] px-3 text-slate-200 hover:bg-white/[0.05]"
                    >
                      <Link to={ROUTES.orders.detail(selectedItem.orderId)}>
                        Open Order
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-slate-300">
                      {selectedItem.fileCounts?.originals || 0} source files
                    </span>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-slate-300">
                      {selectedItem.fileCounts?.proofs || 0} proof files
                    </span>
                    {selectedItem.requiresProofApproval ? (
                      <span className="rounded-full border border-[#2d62f5]/25 bg-[#1337ec]/10 px-2.5 py-1 text-[11px] font-medium text-[#8ba9ff]">
                        Proof handoff required
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <LineItemAttachmentsPanel
                      quoteId={null}
                      parentType="order"
                      orderId={selectedItem.orderId}
                      lineItemId={selectedItem.lineItemId}
                      lineItemKey={selectedItem.lineItemId}
                      productName={selectedItem.productName}
                      defaultExpanded={true}
                    />
                  </div>
                </section>
              </div>
            </main>

            <aside className="bg-[#0d1421] px-4 py-4">
              <div className="space-y-4">
                <section className={`${SECTION_PANEL} p-5`}>
                  <div>
                    <h3 className="text-[18px] font-semibold text-white">Workflow Rail</h3>
                    <p className="mt-1 text-[12px] text-slate-400">
                      Keep the next move obvious without repeating the working-state model already shown in the header.
                    </p>
                  </div>

                  <div className="mt-5 rounded-[16px] border border-[#2d62f5]/20 bg-[#1337ec]/10 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8ba9ff]">
                      Recommended Next Action
                    </div>
                    <div className="mt-2 text-[22px] font-semibold leading-tight text-white">
                      {recommendedAction?.title ?? "Review line item"}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {recommendedAction?.detail ?? "Use the workspace to review files, notes, and workflow state."}
                    </p>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-11 w-full justify-between rounded-xl border border-white/[0.08] bg-[#111b2c] px-4 text-slate-200 hover:bg-[#152235]"
                      disabled={!canCreateProof}
                      onClick={() => navigate(`${ROUTES.production.proofing}?lineItemId=${selectedItem.lineItemId}&slice=all`)}
                    >
                      <span>Create & Send Proof</span>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4 text-sm text-slate-400">
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
                </section>

                <section className={`${SECTION_PANEL} p-5`}>
                  <div>
                    <h3 className="text-[18px] font-semibold text-white">Versions</h3>
                    <p className="mt-1 text-[12px] text-slate-400">
                      Existing proof/version history already attached to this line item.
                    </p>
                  </div>

                  <div className="mt-4">
                    {proofingQuery.isLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <Skeleton key={index} className="h-16 w-full rounded-[14px] bg-white/[0.04]" />
                        ))}
                      </div>
                    ) : proofVersionHistory.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-sm text-slate-400">
                        No proof versions exist yet for this line item.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proofVersionHistory.map((version) => (
                          <div key={version.id} className={`${META_PANEL} px-4 py-3`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-white">Version {version.versionNumber}</div>
                              <Badge
                                variant={version.status === "approved" ? "default" : "outline"}
                                className={
                                  version.status === "approved"
                                    ? "bg-emerald-600 text-white"
                                    : "border-white/[0.08] bg-white/[0.03] text-slate-300"
                                }
                              >
                                {version.status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <div className="mt-2 text-[11px] text-slate-500">
                              Created {formatRelativeTime(version.createdAt)}
                              {version.sentAt ? ` • Sent ${formatRelativeTime(version.sentAt)}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className={`${SECTION_PANEL} p-5`}>
                  <div>
                    <h3 className="text-[18px] font-semibold text-white">Recent Activity</h3>
                    <p className="mt-1 text-[12px] text-slate-400">
                      Latest design and proofing activity already recorded on this line item.
                    </p>
                  </div>

                  <div className="mt-4">
                    {workspaceQuery.isLoading || proofingQuery.isLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <Skeleton key={index} className="h-14 w-full rounded-[14px] bg-white/[0.04]" />
                        ))}
                      </div>
                    ) : recentActivity.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed border-white/[0.08] px-4 py-4 text-sm text-slate-400">
                        No recent activity is recorded yet. Use the session control and working log as design work begins.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {recentActivity.map((activity) => (
                          <div key={activity.id} className={`${META_PANEL} px-4 py-3`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-white">{activity.label}</div>
                              <span className="text-[11px] text-slate-500">{formatRelativeTime(activity.at)}</span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{activity.detail}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
