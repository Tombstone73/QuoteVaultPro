import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  Loader2,
  Send,
  ShieldAlert,
  Upload,
  XCircle,
} from "lucide-react";

import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import { useAuth } from "@/hooks/useAuth";
import { useOrderLineItemFiles, type OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { buildPdfViewUrl, isPdfFile } from "@/lib/pdfUrls";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";
import { proofQueueSliceValues } from "@shared/proofing";
import type {
  ProofDecision,
  ProofQueueSlice,
  ProofQueueStatus,
  ProofVersionHistoryEntry,
  ProofVersionStatus,
  ProofingQueueResponse,
  ProofingQueueRow,
  ProofingReadModel,
} from "@shared/proofing";

type JsonEnvelope<T> = {
  success: boolean;
  data: T;
  error?: string;
};

type ProofFileRow = OrderFileWithUser & {
  fileRecordId?: string | null;
  originalFilename?: string | null;
  downloadUrl?: string | null;
  objectPath?: string | null;
  previewUrl?: string | null;
  originalUrl?: string | null;
  thumbUrl?: string | null;
  role?: string | null;
  __source?: "attachment" | "asset";
};

type ProofAttachmentRow = ProofFileRow & {
  __source?: "attachment";
  role?: string | null;
};

const queueSliceMeta: Array<{ value: ProofQueueSlice; label: string; countKey: keyof ProofingQueueResponse["counts"] }> = [
  { value: "all", label: "All", countKey: "all" },
  { value: "awaiting_send", label: "Awaiting Send", countKey: "awaitingSend" },
  { value: "awaiting_approval", label: "Awaiting Approval", countKey: "awaitingApproval" },
  { value: "revision_requested", label: "Revision Requested", countKey: "revisionRequested" },
  { value: "approved", label: "Approved", countKey: "approved" },
];

const decisionLabels: Record<ProofDecision, string> = {
  approved: "Approve",
  rejected: "Reject",
  revision_requested: "Request revision",
};

type StaffFacingStatus = {
  label: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
};

const proofQueueStatusSortOrder: Record<ProofQueueStatus, number> = {
  revision_requested: 0,
  awaiting_approval: 1,
  awaiting_send: 2,
  approved: 3,
  approved_by_override: 4,
  rejected: 5,
  no_active_proof: 6,
};

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || "Request failed");
  }

  return json as T;
}

function statusBadgeVariant(status: ProofQueueStatus | ProofVersionStatus | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
    case "approved_by_override":
      return "default";
    case "awaiting_approval":
    case "awaiting_response":
      return "secondary";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

function formatRelativeTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatVersionLabel(version: ProofVersionHistoryEntry | null | undefined) {
  if (!version) return "No proof selected";
  return `Version ${version.versionNumber}`;
}

function getProofPreviewUrl(file: ProofFileRow | null | undefined) {
  if (!file) return null;
  const fileName = file.originalFilename || file.fileName || "Proof";
  const mimeType = file.mimeType || null;
  if (isPdfFile(mimeType, fileName)) {
    return buildPdfViewUrl(file.objectPath) || file.originalUrl || file.previewUrl || file.fileUrl || null;
  }
  return file.previewUrl || file.originalUrl || file.thumbUrl || file.fileUrl || null;
}

function getDownloadUrl(file: ProofFileRow | null | undefined) {
  if (!file) return null;
  return file.downloadUrl || file.originalUrl || file.fileUrl || null;
}

function getDefaultVersionId(detail: ProofingReadModel | undefined, row: ProofingQueueRow | undefined) {
  return (
    detail?.currentActionableProofVersionId ||
    detail?.approvedProofVersionId ||
    row?.currentDisplayedProofVersionId ||
    detail?.proofVersionHistory[0]?.id ||
    null
  );
}

function getRoleSummary(userRole: string | null | undefined) {
  const normalized = (userRole || "").toLowerCase();
  return {
    isInternalUser: ["owner", "admin", "manager", "employee"].includes(normalized),
    canOverride: ["owner", "admin"].includes(normalized),
  };
}

function getStaffFacingStatus(args: {
  row: ProofingQueueRow | undefined;
  detail: ProofingReadModel | undefined;
  displayedVersion: ProofVersionHistoryEntry | null;
}): StaffFacingStatus {
  const { row, detail, displayedVersion } = args;

  if (detail?.approvedProofSource || row?.currentQueueStatus === "approved") {
    return {
      label: "Approved",
      badgeVariant: "default",
    };
  }

  if (
    row?.currentQueueStatus === "revision_requested" ||
    detail?.proofDecisionHistory[0]?.decision === "revision_requested"
  ) {
    return {
      label: "Revision Requested",
      badgeVariant: "destructive",
    };
  }

  if (
    displayedVersion?.status === "awaiting_response" ||
    row?.currentQueueStatus === "awaiting_approval"
  ) {
    return {
      label: "Awaiting Customer Approval",
      badgeVariant: "secondary",
    };
  }

  if (displayedVersion?.status === "draft" || row?.currentQueueStatus === "awaiting_send") {
    return {
      label: "Ready to Send",
      badgeVariant: "outline",
    };
  }

  if (displayedVersion?.status === "rejected" || detail?.proofDecisionHistory[0]?.decision === "rejected") {
    return {
      label: "Rejected",
      badgeVariant: "destructive",
    };
  }

  return {
    label: "No Active Proof",
    badgeVariant: "outline",
  };
}

function compareProofQueueRows(a: ProofingQueueRow, b: ProofingQueueRow) {
  const statusDiff = proofQueueStatusSortOrder[a.currentQueueStatus] - proofQueueStatusSortOrder[b.currentQueueStatus];
  if (statusDiff !== 0) return statusDiff;

  const activityDiff = new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  if (activityDiff !== 0) return activityDiff;

  const orderA = a.orderNumber || a.orderId;
  const orderB = b.orderNumber || b.orderId;
  const orderDiff = orderA.localeCompare(orderB, undefined, { numeric: true, sensitivity: "base" });
  if (orderDiff !== 0) return orderDiff;

  return a.lineItemLabel.localeCompare(b.lineItemLabel, undefined, { sensitivity: "base" });
}

function getStatusNote(args: {
  detail: ProofingReadModel | undefined;
  displayedVersion: ProofVersionHistoryEntry | null;
}) {
  const { detail, displayedVersion } = args;
  const latestDecision = detail?.proofDecisionHistory?.[0];
  const latestOverride = detail?.manualApprovalOverrideHistory?.[0];

  if (detail?.approvedByOverride) {
    return latestOverride?.overrideReason || latestOverride?.internalNote || "Approved by manual override.";
  }

  if (latestDecision?.responseNotes) {
    return latestDecision.responseNotes;
  }

  if (displayedVersion?.status === "awaiting_response") {
    return displayedVersion.sentAt ? `Sent ${formatRelativeTime(displayedVersion.sentAt)}.` : "Waiting on customer approval.";
  }

  if (displayedVersion?.status === "draft") {
    return "This version is still draft and ready to send.";
  }

  return null;
}

function getEmbeddedPdfUrl(url: string | null, compact: boolean) {
  if (!url) return null;
  if (!compact) return url;
  const separator = url.includes("#") ? "&" : "#";
  return `${url}${separator}navpanes=0`;
}

function getVersionStatusLabel(status: ProofVersionStatus | null | undefined) {
  switch (status) {
    case "awaiting_response":
      return "Awaiting Customer Approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "draft":
    default:
      return "Ready to Send";
  }
}

function getDecisionLabel(decision: ProofDecision) {
  switch (decision) {
    case "approved":
      return "Approval Recorded";
    case "revision_requested":
      return "Revision Requested";
    case "rejected":
      return "Rejection Recorded";
    default:
      return decisionLabels[decision];
  }
}

export default function StaffProofingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { isInternalUser, canOverride } = getRoleSummary(user?.role);
  const requestedLineItemId = searchParams.get("lineItemId");
  const requestedSlice = searchParams.get("slice");
  const requestedQueueSlice = requestedSlice && (proofQueueSliceValues as readonly string[]).includes(requestedSlice)
    ? (requestedSlice as ProofQueueSlice)
    : requestedLineItemId
      ? "all"
      : "awaiting_approval";

  const [slice, setSlice] = useState<ProofQueueSlice>(requestedQueueSlice);
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedExistingAttachmentId, setSelectedExistingAttachmentId] = useState<string>("");
  const [createInternalNotes, setCreateInternalNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendToName, setSendToName] = useState("");
  const [sendToEmail, setSendToEmail] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");

  const [responseNotes, setResponseNotes] = useState("");

  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const queueQuery = useQuery<JsonEnvelope<ProofingQueueResponse>>({
    queryKey: ["/api/proofing/queue", slice],
    queryFn: () => readJson(`/api/proofing/queue?slice=${slice}`),
    enabled: isInternalUser,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const queueData = queueQuery.data?.data;
  const queueRows = queueData?.rows ?? [];
  const sortedQueueRows = useMemo(() => [...queueRows].sort(compareProofQueueRows), [queueRows]);

  useEffect(() => {
    if (slice !== requestedQueueSlice) {
      setSlice(requestedQueueSlice);
    }
  }, [requestedQueueSlice, slice]);

  useEffect(() => {
    if (!sortedQueueRows.length) {
      if (selectedLineItemId !== null) setSelectedLineItemId(null);
      return;
    }

    if (requestedLineItemId && sortedQueueRows.some((row) => row.lineItemId === requestedLineItemId)) {
      if (selectedLineItemId !== requestedLineItemId) {
        setSelectedLineItemId(requestedLineItemId);
      }
      return;
    }

    const stillPresent = selectedLineItemId ? sortedQueueRows.some((row) => row.lineItemId === selectedLineItemId) : false;
    if (!stillPresent) {
      setSelectedLineItemId(sortedQueueRows[0].lineItemId);
    }
  }, [sortedQueueRows, requestedLineItemId, selectedLineItemId]);

  const selectedRow = sortedQueueRows.find((row) => row.lineItemId === selectedLineItemId) ?? sortedQueueRows[0];

  const detailQuery = useQuery<JsonEnvelope<ProofingReadModel>>({
    queryKey: ["/api/proofing/line-item", selectedRow?.lineItemId],
    queryFn: () => readJson(`/api/proofing/line-item/${selectedRow?.lineItemId}`),
    enabled: Boolean(isInternalUser && selectedRow?.lineItemId),
  });

  const detail = detailQuery.data?.data;
  const orderQuery = useOrder(selectedRow?.orderId);
  const selectedOrder = orderQuery.data;

  useEffect(() => {
    const defaultVersionId = getDefaultVersionId(detail, selectedRow);
    if (!detail) {
      if (selectedVersionId !== null) setSelectedVersionId(null);
      return;
    }

    const exists = selectedVersionId ? detail.proofVersionHistory.some((version) => version.id === selectedVersionId) : false;
    if (!exists) {
      setSelectedVersionId(defaultVersionId);
    }
  }, [detail, selectedRow, selectedVersionId]);

  const filesQuery = useOrderLineItemFiles(selectedRow?.orderId, selectedRow?.lineItemId);
  const lineItemFiles = (filesQuery.data?.data ?? []) as ProofFileRow[];

  const selectableProofFiles = useMemo(
    () =>
      lineItemFiles.filter(
        (file): file is ProofAttachmentRow =>
          file.__source !== "asset" &&
          Boolean(file.id) &&
          String(file.role || "").toLowerCase() === "proof",
      ),
    [lineItemFiles],
  );

  const displayedVersion = detail?.proofVersionHistory.find((version) => version.id === selectedVersionId) ?? null;
  const displayedFile = displayedVersion
    ? lineItemFiles.find((file) => file.id === displayedVersion.proofFileId) ?? null
    : null;
  const previewUrl = getProofPreviewUrl(displayedFile);
  const downloadUrl = getDownloadUrl(displayedFile);
  const previewName = displayedFile?.originalFilename || displayedFile?.fileName || "Proof";
  const previewIsPdf = Boolean(displayedFile && isPdfFile(displayedFile.mimeType || null, previewName));
  const previewIsImage = Boolean(displayedFile?.mimeType?.startsWith("image/"));
  const staffStatus = getStaffFacingStatus({ row: selectedRow, detail, displayedVersion });
  const latestCustomerFeedback = detail?.proofDecisionHistory?.[0] ?? null;
  const statusNote = getStatusNote({ detail, displayedVersion });
  const [pdfViewerMode, setPdfViewerMode] = useState<"compact" | "default">("compact");
  const embeddedPdfUrl = getEmbeddedPdfUrl(previewIsPdf ? previewUrl : null, pdfViewerMode === "compact");

  useEffect(() => {
    if (!createDialogOpen) return;
    if (!selectedExistingAttachmentId && selectableProofFiles.length > 0) {
      const preferred = selectableProofFiles.find((file) => file.id === displayedFile?.id);
      setSelectedExistingAttachmentId(preferred?.id || selectableProofFiles[0]?.id || "");
    }
  }, [createDialogOpen, selectableProofFiles, selectedExistingAttachmentId, displayedFile?.id]);

  async function refreshProofing(lineItemId?: string | null, orderId?: string | null) {
    await queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
    if (lineItemId) {
      await queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId] });
      if (orderId) {
        await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "line-items", lineItemId, "files"] });
      }
    }
  }

  const createDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow?.orderId || !selectedRow.lineItemId) {
        throw new Error("Select a proofing queue row first");
      }

      let proofFileId = selectedExistingAttachmentId;

      if (uploadFile) {
        const uploadResult = await uploadAttachmentViaChunked({
          file: uploadFile,
          purpose: "order-attachment",
          parentId: selectedRow.orderId,
          linkUrl: `/api/orders/${selectedRow.orderId}/files`,
          linkBody: {
            orderLineItemId: selectedRow.lineItemId,
            role: "proof",
            side: "na",
          },
        });

        proofFileId = String(uploadResult.linkResponse?.data?.id || "").trim();
      }

      if (!proofFileId) {
        throw new Error("Select or upload a proof file before creating a version");
      }

      const result = await readJson<JsonEnvelope<{ proofVersion: ProofVersionHistoryEntry; proofing: ProofingReadModel }>>(
        `/api/proofing/line-item/${selectedRow.lineItemId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proofFileId,
            internalNotes: createInternalNotes.trim() || null,
          }),
        },
      );

      return result.data;
    },
    onSuccess: async (data) => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSelectedVersionId(data.proofVersion.id);
      setCreateDialogOpen(false);
      setSelectedExistingAttachmentId("");
      setCreateInternalNotes("");
      setUploadFile(null);
      toast({
        title: "Proof version created",
        description: `Version ${data.proofVersion.versionNumber} is ready to send.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create proof version", description: error.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!displayedVersion?.id) throw new Error("Select a draft proof version to send");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/versions/${displayedVersion.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentToName: sendToName.trim() || null,
          sentToEmail: sendToEmail.trim() || null,
          customerMessage: customerMessage.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSendDialogOpen(false);
      setSendToName("");
      setSendToEmail("");
      setCustomerMessage("");
      toast({ title: "Proof sent", description: "The selected proof version was sent for customer review." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send proof", description: error.message, variant: "destructive" });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async (decision: ProofDecision) => {
      if (!displayedVersion?.id) throw new Error("Select an actionable proof version first");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/versions/${displayedVersion.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          responseNotes: responseNotes.trim() || null,
          responderSource: "staff_ui",
        }),
      });
    },
    onSuccess: async (_, decision) => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setResponseNotes("");
      toast({ title: `${decisionLabels[decision]} recorded`, description: "The proof decision has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record proof response", description: error.message, variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow?.lineItemId) throw new Error("Select a queue row first");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/line-item/${selectedRow.lineItemId}/manual-approval-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proofVersionId: detail?.currentActionableProofVersionId || displayedVersion?.id || null,
          overrideReason: overrideReason.trim(),
          internalNote: overrideNote.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setOverrideDialogOpen(false);
      setOverrideReason("");
      setOverrideNote("");
      toast({ title: "Manual override recorded", description: "The proof has been approved by manual override." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record manual override", description: error.message, variant: "destructive" });
    },
  });

  if (!isInternalUser) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p>You do not have permission to access the staff proofing queue.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-full flex-1 flex-col gap-4 overflow-hidden p-6">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Staff Proofing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review proofs, send versions to customers, and record proof decisions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => queueQuery.refetch()} disabled={queueQuery.isFetching}>
              {queueQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Refresh queue
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedRow}>
              <Upload className="mr-2 h-4 w-4" />
              New proof version
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[17rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Queue</CardTitle>
              <CardDescription>Open proofs and pending staff decisions.</CardDescription>
              <Tabs value={slice} onValueChange={(value) => setSlice(value as ProofQueueSlice)}>
                <TabsList className="grid h-auto grid-cols-2 gap-2 xl:grid-cols-1">
                  {queueSliceMeta.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className="justify-between">
                      <span>{tab.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {queueData?.counts?.[tab.countKey] ?? 0}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
              {queueQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-24 w-full" />
                  ))}
                </div>
              ) : queueQuery.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {(queueQuery.error as Error).message}
                </div>
              ) : sortedQueueRows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No line items are currently in this proofing slice.
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto pr-2 [scrollbar-color:hsl(var(--muted-foreground)/0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
                  <div className="space-y-3">
                    {sortedQueueRows.map((row) => {
                      const isSelected = row.lineItemId === selectedRow?.lineItemId;
                      const rowStatus = getStaffFacingStatus({ row, detail: undefined, displayedVersion: null });
                      return (
                        <button
                          key={row.lineItemId}
                          type="button"
                          onClick={() => setSelectedLineItemId(row.lineItemId)}
                          className={`w-full rounded-xl border p-4 text-left transition ${
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-card hover:border-primary/40 hover:bg-accent/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{row.lineItemLabel}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{row.customerDisplayName || "No customer linked"}</p>
                            </div>
                            <Badge variant={rowStatus.badgeVariant}>{rowStatus.label}</Badge>
                          </div>
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                            <p>{row.packageLabel}</p>
                            <p>Order {row.orderNumber ? `#${row.orderNumber}` : row.orderId}</p>
                            <p>Last activity {formatRelativeTime(row.lastActivityAt)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-lg">
                    {selectedOrder?.customer?.id ? (
                      <Link to={ROUTES.customers.detail(selectedOrder.customer.id)} className="hover:underline">
                        {selectedRow?.customerDisplayName || selectedRow?.lineItemLabel || "Proof Viewer"}
                      </Link>
                    ) : (
                      selectedRow?.customerDisplayName || selectedRow?.lineItemLabel || "Proof Viewer"
                    )}
                  </CardTitle>
                  <CardDescription>
                    {selectedRow ? (
                      <span>
                        {selectedRow.lineItemLabel} • {selectedRow.packageLabel} •{" "}
                        <Link to={ROUTES.orders.detail(selectedRow.orderId)} className="text-primary hover:underline">
                          Order {selectedRow.orderNumber ? `#${selectedRow.orderNumber}` : selectedRow.orderId}
                        </Link>
                      </span>
                    ) : (
                      "Select a queue row to review a proof."
                    )}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {displayedVersion ? <Badge variant="outline">{formatVersionLabel(displayedVersion)}</Badge> : null}
                  {selectedRow ? (
                    <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.orders.detail(selectedRow.orderId))}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open order
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-col gap-4">
              {detailQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-[32rem] w-full" />
                </div>
              ) : detailQuery.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {(detailQuery.error as Error).message}
                </div>
              ) : !selectedRow || !detail ? (
                <div className="flex h-full min-h-[32rem] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  Select a queue row to load proof detail.
                </div>
              ) : (
                <>
                  <div className="flex min-h-[32rem] flex-1 flex-col rounded-xl border bg-muted/20">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{previewName}</p>
                        <p className="text-xs text-muted-foreground">
                          {displayedFile?.mimeType || "Unknown file type"}
                          {displayedFile?.createdAt ? ` • uploaded ${formatRelativeTime(displayedFile.createdAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {previewIsPdf ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPdfViewerMode((value) => (value === "compact" ? "default" : "compact"))}
                          >
                            {pdfViewerMode === "compact" ? "Show Full PDF UI" : "Compact PDF View"}
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" onClick={() => setViewerOpen(true)} disabled={!displayedFile}>
                          <Eye className="mr-2 h-4 w-4" />
                          Expand
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadUrl && downloadFileFromUrl(downloadUrl, previewName)}
                          disabled={!downloadUrl}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                      {!displayedVersion ? (
                        <div className="text-center text-sm text-muted-foreground">
                          <FileText className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          No proof version is currently selected.
                        </div>
                      ) : !displayedFile ? (
                        <div className="text-center text-sm text-muted-foreground">
                          <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          This proof version has no resolved file in the current line-item file feed.
                        </div>
                      ) : previewIsPdf && embeddedPdfUrl ? (
                        <iframe title={previewName} src={embeddedPdfUrl} className="h-full min-h-[28rem] w-full rounded-lg border bg-white" />
                      ) : previewIsImage && previewUrl ? (
                        <img src={previewUrl} alt={previewName} className="max-h-full max-w-full rounded-lg object-contain" />
                      ) : previewUrl ? (
                        <div className="text-center text-sm text-muted-foreground">
                          <FileImage className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          Preview is not available inline for this file type.
                          <div className="mt-3 flex justify-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setViewerOpen(true)}>
                              Open viewer
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => downloadUrl && downloadFileFromUrl(downloadUrl, previewName)}>
                              Download file
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-sm text-muted-foreground">
                          <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          No preview URL is available for the selected proof file.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-2 [scrollbar-color:hsl(var(--muted-foreground)/0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Order & Customer</CardTitle>
                <CardDescription>Quick links for the selected proof.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {detailQuery.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : detail ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
                        {selectedOrder?.customer?.id ? (
                          <Link to={ROUTES.customers.detail(selectedOrder.customer.id)} className="mt-1 inline-flex font-medium text-primary hover:underline">
                            {selectedRow?.customerDisplayName || "View customer"}
                          </Link>
                        ) : (
                          <p className="mt-1 font-medium">{selectedRow?.customerDisplayName || "No customer linked"}</p>
                        )}
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Version</p>
                        <p className="mt-1 font-medium">{formatVersionLabel(displayedVersion)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Order</p>
                        {selectedRow ? (
                          <Link to={ROUTES.orders.detail(selectedRow.orderId)} className="mt-1 inline-flex font-medium text-primary hover:underline">
                            {selectedRow.orderNumber ? `#${selectedRow.orderNumber}` : selectedRow.orderId}
                          </Link>
                        ) : (
                          <p className="mt-1 font-medium">—</p>
                        )}
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Line Item</p>
                        <p className="mt-1 font-medium">{selectedRow?.lineItemLabel || "Not selected"}</p>
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Package</p>
                      <p className="mt-1 font-medium">{selectedRow?.packageLabel || "No package linked"}</p>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-muted-foreground">No line item selected.</div>
                )}
              </CardContent>
            </Card>

              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Current Status</CardTitle>
                <CardDescription>Current proof decision state.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <Badge variant={staffStatus.badgeVariant}>{staffStatus.label}</Badge>
                    {displayedVersion ? <span className="text-xs text-muted-foreground">{formatVersionLabel(displayedVersion)}</span> : null}
                  </div>
                  {statusNote ? <p className="mt-3 text-sm text-muted-foreground">{statusNote}</p> : null}
                </div>
              </CardContent>
            </Card>

              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Primary Actions</CardTitle>
                <CardDescription>Staff actions for sending proofs and recording decisions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Button className="w-full" onClick={() => setCreateDialogOpen(true)} disabled={!selectedRow}>
                    <Upload className="mr-2 h-4 w-4" />
                    New Proof Version
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSendDialogOpen(true)}
                    disabled={!displayedVersion || displayedVersion.status !== "draft"}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Send Current Version to Customer
                  </Button>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label htmlFor="proof-response-notes">Decision notes</Label>
                  <Textarea
                    id="proof-response-notes"
                    value={responseNotes}
                    onChange={(event) => setResponseNotes(event.target.value)}
                    rows={4}
                    placeholder="Record the customer feedback or context tied to this decision."
                    disabled={!detail?.currentActionableProofVersionId || displayedVersion?.id !== detail.currentActionableProofVersionId}
                  />
                  <div className="grid gap-2">
                    <Button
                      onClick={() => respondMutation.mutate("approved")}
                      disabled={respondMutation.isPending || displayedVersion?.id !== detail?.currentActionableProofVersionId || displayedVersion?.status !== "awaiting_response"}
                    >
                      {respondMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Record Approval
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => respondMutation.mutate("revision_requested")}
                      disabled={respondMutation.isPending || displayedVersion?.id !== detail?.currentActionableProofVersionId || displayedVersion?.status !== "awaiting_response"}
                    >
                      Record Revision Request
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => respondMutation.mutate("rejected")}
                      disabled={respondMutation.isPending || displayedVersion?.id !== detail?.currentActionableProofVersionId || displayedVersion?.status !== "awaiting_response"}
                    >
                      Record Rejection
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Advanced Admin Action</p>
                      <p className="text-xs text-muted-foreground">
                        Use manual approval override only when you need to approve without a normal customer decision.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOverrideDialogOpen(true)}
                        disabled={!canOverride || !detail?.currentActionableProofVersionId || detail.approvedProofSource === "manual_override"}
                      >
                        Record manual override
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Customer Feedback</CardTitle>
                <CardDescription>The most recent recorded response for this proof.</CardDescription>
              </CardHeader>
              <CardContent>
                {!detail ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Load a queue row to inspect feedback.</div>
                ) : !latestCustomerFeedback ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No customer feedback has been recorded yet.</div>
                ) : (
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={statusBadgeVariant(latestCustomerFeedback.decision)}>{getDecisionLabel(latestCustomerFeedback.decision)}</Badge>
                      <span className="text-xs text-muted-foreground">{formatTimestamp(latestCustomerFeedback.respondedAt)}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{latestCustomerFeedback.responseNotes || "No notes were recorded with this decision."}</p>
                    {(latestCustomerFeedback.responderName || latestCustomerFeedback.responderEmail) ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {[latestCustomerFeedback.responderName, latestCustomerFeedback.responderEmail].filter(Boolean).join(" • ")}
                      </p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Version History</CardTitle>
                <CardDescription>Select the proof version shown in the viewer, then review version and decision history.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {detail ? (
                  <div className="space-y-4">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versions</p>
                        {detail.proofVersionHistory.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No proof versions yet.</div>
                        ) : (
                          detail.proofVersionHistory.map((version) => {
                            const isSelected = version.id === selectedVersionId;
                            return (
                              <button
                                key={version.id}
                                type="button"
                                onClick={() => setSelectedVersionId(version.id)}
                                className={`w-full rounded-lg border p-3 text-left ${isSelected ? "border-primary bg-primary/5" : "border-border"}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium">Version {version.versionNumber}</p>
                                  <Badge variant={statusBadgeVariant(version.status)}>
                                    {getVersionStatusLabel(version.status)}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">Created {formatTimestamp(version.createdAt)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Sent {formatTimestamp(version.sentAt)}</p>
                              </button>
                            );
                          })
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responses</p>
                        {detail.proofDecisionHistory.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No responses recorded yet.</div>
                        ) : (
                          detail.proofDecisionHistory.map((decision) => (
                            <div key={decision.id} className="rounded-lg border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant={statusBadgeVariant(decision.decision)}>{getDecisionLabel(decision.decision)}</Badge>
                                <span className="text-xs text-muted-foreground">{formatTimestamp(decision.respondedAt)}</span>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground">{decision.responseNotes || "No response notes"}</p>
                              {(decision.responderName || decision.responderEmail || decision.responderSource) ? (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {[decision.responderName, decision.responderEmail, decision.responderSource].filter(Boolean).join(" • ")}
                                </p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advanced Admin Overrides</p>
                        {detail.manualApprovalOverrideHistory.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No manual overrides recorded.</div>
                        ) : (
                          detail.manualApprovalOverrideHistory.map((entry) => (
                            <div key={entry.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant="secondary">Manual override</Badge>
                                <span className="text-xs text-muted-foreground">{formatTimestamp(entry.overriddenAt)}</span>
                              </div>
                              <p className="mt-2 text-sm font-medium">{entry.overrideReason}</p>
                              <p className="mt-2 text-sm text-muted-foreground">{entry.internalNote || "No internal note"}</p>
                              {(entry.actorName || entry.actorEmail) ? (
                                <p className="mt-2 text-xs text-muted-foreground">{[entry.actorName, entry.actorEmail].filter(Boolean).join(" • ")}</p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Load a queue row to review version history.</div>
                )}
              </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <AttachmentViewerDialog attachment={displayedFile as any} open={viewerOpen} onOpenChange={setViewerOpen} />

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Proof Version</DialogTitle>
            <DialogDescription>
              Upload a new proof file or reuse an existing proof file to create the next draft version.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="proof-upload-file">Upload new proof file</Label>
              <Input
                id="proof-upload-file"
                type="file"
                accept=".pdf,image/*"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">If you upload a file here, it will be used for the new draft proof version.</p>
            </div>

            <div className="grid gap-2">
              <Label>Select existing line-item file</Label>
              <ScrollArea className="h-56 rounded-lg border p-3">
                <div className="space-y-2">
                  {selectableProofFiles.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No line-item files with a file record are available yet.</div>
                  ) : (
                    selectableProofFiles.map((file) => {
                      const isSelected = selectedExistingAttachmentId === file.id;
                      return (
                        <button
                          key={file.id}
                          type="button"
                          disabled={Boolean(uploadFile)}
                          onClick={() => setSelectedExistingAttachmentId(file.id)}
                          className={`w-full rounded-lg border p-3 text-left ${isSelected ? "border-primary bg-primary/5" : "border-border"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{file.originalFilename || file.fileName}</p>
                              <p className="text-xs text-muted-foreground">{file.role || "file"} • {formatTimestamp(file.createdAt)}</p>
                            </div>
                            <Badge variant="outline">{file.__source || "attachment"}</Badge>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
              {uploadFile ? <p className="text-xs text-muted-foreground">Uploaded file will be used for the draft version.</p> : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proof-internal-notes">Internal notes</Label>
              <Textarea
                id="proof-internal-notes"
                rows={4}
                value={createInternalNotes}
                onChange={(event) => setCreateInternalNotes(event.target.value)}
                placeholder="Optional notes for the team"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={createDraftMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createDraftMutation.mutate()}
              disabled={createDraftMutation.isPending || (!uploadFile && !selectedExistingAttachmentId)}
            >
              {createDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Create draft version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Proof for Review</DialogTitle>
            <DialogDescription>
              Send the selected draft version to the customer for review. These fields are optional.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="proof-send-name">Send to name</Label>
              <Input id="proof-send-name" value={sendToName} onChange={(event) => setSendToName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-send-email">Send to email</Label>
              <Input id="proof-send-email" value={sendToEmail} onChange={(event) => setSendToEmail(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-customer-message">Customer message</Label>
              <Textarea
                id="proof-customer-message"
                rows={4}
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
                placeholder="Optional message included with the proof send"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)} disabled={sendMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending || displayedVersion?.status !== "draft"}>
              {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send proof
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Approval Override</DialogTitle>
            <DialogDescription>
              This is an advanced admin action and should only be used when normal customer approval cannot be recorded.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="proof-override-reason">Override reason</Label>
              <Textarea
                id="proof-override-reason"
                rows={4}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Required reason for bypassing normal approval"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-override-note">Internal note</Label>
              <Textarea
                id="proof-override-note"
                rows={3}
                value={overrideNote}
                onChange={(event) => setOverrideNote(event.target.value)}
                placeholder="Optional internal note"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)} disabled={overrideMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending || !overrideReason.trim()}>
              {overrideMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
              Record manual override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}