import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  Loader2,
  Search,
  Send,
  ShieldAlert,
  Upload,
  XCircle,
  ZoomIn,
  ZoomOut,
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
  return `${url}${separator}navpanes=0&toolbar=0`;
}

const queueSectionMeta: Array<{
  key: string;
  label: string;
  matches: (row: ProofingQueueRow) => boolean;
}> = [
  {
    key: "awaiting_send",
    label: "READY TO SEND",
    matches: (row) => row.currentQueueStatus === "awaiting_send",
  },
  {
    key: "awaiting_approval",
    label: "AWAITING APPROVAL",
    matches: (row) => row.currentQueueStatus === "awaiting_approval",
  },
  {
    key: "revision_requested",
    label: "REVISION REQUESTED",
    matches: (row) => row.currentQueueStatus === "revision_requested",
  },
  {
    key: "approved",
    label: "APPROVED",
    matches: (row) => row.currentQueueStatus === "approved" || row.currentQueueStatus === "approved_by_override",
  },
  {
    key: "other",
    label: "OTHER",
    matches: (row) => row.currentQueueStatus === "rejected" || row.currentQueueStatus === "no_active_proof",
  },
];

function formatDimensions(width: string | null | undefined, height: string | null | undefined) {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

function getJobSpecificationRows(lineItem: any, row: ProofingQueueRow | undefined) {
  const selectedOptions = Array.isArray(lineItem?.specsJson?.selectedOptions)
    ? lineItem.specsJson.selectedOptions
        .map((option: any) => {
          const label = String(option?.optionName || option?.label || option?.name || "").trim();
          const value = String(option?.displayValue ?? option?.value ?? "").trim();
          if (!label || !value) return null;
          return { label, value };
        })
        .filter(Boolean)
    : [];

  return [
    { label: "Product", value: lineItem?.product?.name ?? null },
    { label: "Quantity", value: lineItem?.quantity ?? null },
    { label: "Dimensions", value: formatDimensions(lineItem?.width, lineItem?.height) },
    { label: "Workflow", value: row?.workflowState ?? null },
    ...selectedOptions,
  ].filter((rowItem) => rowItem?.value !== null && rowItem?.value !== undefined && `${rowItem.value}`.trim() !== "");
}

function getQueueCardBadgeLabel(row: ProofingQueueRow) {
  switch (row.currentQueueStatus) {
    case "awaiting_send":
      return "Draft";
    case "awaiting_approval":
      return "Sent";
    case "revision_requested":
      return "Revision";
    case "approved":
    case "approved_by_override":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Open";
  }
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
  const [searchQuery, setSearchQuery] = useState("");
  const [viewerZoom, setViewerZoom] = useState(85);
  const [viewerPage, setViewerPage] = useState(1);
  const versionHistoryRef = useRef<HTMLDivElement | null>(null);

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
  const filteredQueueRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedQueueRows;

    return sortedQueueRows.filter((row) => {
      return [
        row.lineItemLabel,
        row.customerDisplayName,
        row.packageLabel,
        row.orderNumber,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [searchQuery, sortedQueueRows]);

  const groupedQueueSections = useMemo(
    () =>
      queueSectionMeta
        .map((section) => ({
          ...section,
          rows: filteredQueueRows.filter((row) => section.matches(row)),
        }))
        .filter((section) => section.rows.length > 0),
    [filteredQueueRows],
  );

  useEffect(() => {
    setSlice(requestedQueueSlice);
  }, [requestedQueueSlice]);

  useEffect(() => {
    if (!filteredQueueRows.length) {
      if (selectedLineItemId !== null) setSelectedLineItemId(null);
      return;
    }

    if (requestedLineItemId && filteredQueueRows.some((row) => row.lineItemId === requestedLineItemId)) {
      if (selectedLineItemId !== requestedLineItemId) {
        setSelectedLineItemId(requestedLineItemId);
      }
      return;
    }

    const stillPresent = selectedLineItemId ? filteredQueueRows.some((row) => row.lineItemId === selectedLineItemId) : false;
    if (!stillPresent) {
      setSelectedLineItemId(filteredQueueRows[0].lineItemId);
    }
  }, [filteredQueueRows, requestedLineItemId, selectedLineItemId]);

  const selectedRow = filteredQueueRows.find((row) => row.lineItemId === selectedLineItemId) ?? filteredQueueRows[0];

  const detailQuery = useQuery<JsonEnvelope<ProofingReadModel>>({
    queryKey: ["/api/proofing/line-item", selectedRow?.lineItemId],
    queryFn: () => readJson(`/api/proofing/line-item/${selectedRow?.lineItemId}`),
    enabled: Boolean(isInternalUser && selectedRow?.lineItemId),
  });

  const detail = detailQuery.data?.data;
  const orderQuery = useOrder(selectedRow?.orderId);
  const selectedOrder = orderQuery.data;
  const selectedLineItem = useMemo(
    () => selectedOrder?.lineItems?.find((lineItem) => lineItem.id === selectedRow?.lineItemId) ?? null,
    [selectedOrder, selectedRow?.lineItemId],
  );

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
  const embeddedPdfUrl = useMemo(() => {
    if (!previewIsPdf || !previewUrl) return null;
    const url = getEmbeddedPdfUrl(previewUrl, pdfViewerMode === "compact");
    if (!url) return null;
    const separator = url.includes("#") ? "&" : "#";
    return `${url}${separator}page=${viewerPage}&zoom=${viewerZoom}`;
  }, [pdfViewerMode, previewIsPdf, previewUrl, viewerPage, viewerZoom]);
  const jobSpecificationRows = useMemo(() => getJobSpecificationRows(selectedLineItem, selectedRow), [selectedLineItem, selectedRow]);
  const internalStaffNote = useMemo(() => {
    const candidates = [
      selectedOrder?.notesInternal,
      detail?.manualApprovalOverrideHistory?.[0]?.internalNote,
      statusNote,
    ];
    return candidates.find((value) => value && `${value}`.trim().length > 0) ?? null;
  }, [detail?.manualApprovalOverrideHistory, selectedOrder?.notesInternal, statusNote]);
  const canSendCurrentVersion = displayedVersion?.status === "draft";
  const canRecordDecision =
    displayedVersion?.id === detail?.currentActionableProofVersionId && displayedVersion?.status === "awaiting_response";

  useEffect(() => {
    setViewerZoom(previewIsPdf ? 85 : 100);
    setViewerPage(1);
  }, [previewIsPdf, selectedVersionId]);

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
      <div className="flex h-[calc(100vh-160px)] min-h-[46rem] flex-1 flex-col gap-3 overflow-hidden p-6 pt-4">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Proofing</h1>
          <div className="flex w-full max-w-[29rem] items-center justify-end gap-2">
            <div className="relative w-full max-w-[17rem]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search proofs..."
                className="h-9 rounded-lg pl-9"
              />
            </div>
            <Button className="h-9 rounded-lg px-4" onClick={() => setCreateDialogOpen(true)} disabled={!selectedRow}>
              <Upload className="mr-2 h-4 w-4" />
              New Proof
            </Button>
          </div>
        </div>

        <Tabs value={slice} onValueChange={(value) => setSlice(value as ProofQueueSlice)} className="shrink-0">
          <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent px-0 py-0">
            {queueSliceMeta.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 pt-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[16.5rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[17rem_minmax(0,1fr)_19rem]">
          <Card className="flex min-h-0 flex-col overflow-hidden rounded-2xl border">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active Queue</p>
              </div>
              {queueQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5 pt-2.5">
              {queueQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 w-full rounded-xl" />
                  ))}
                </div>
              ) : queueQuery.error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {(queueQuery.error as Error).message}
                </div>
              ) : filteredQueueRows.length === 0 ? (
                <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                  {searchQuery.trim() ? "No proofs match this search." : "No line items are currently in this proofing slice."}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto pr-1 [scrollbar-color:hsl(var(--muted-foreground)/0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
                  <div className="space-y-3">
                    {groupedQueueSections.map((section) => (
                      <div key={section.key} className="space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{section.label}</p>
                          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">({section.rows.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {section.rows.map((row) => {
                            const isSelected = row.lineItemId === selectedRow?.lineItemId;
                            const rowStatus = getStaffFacingStatus({ row, detail: undefined, displayedVersion: null });
                            return (
                              <button
                                key={row.lineItemId}
                                type="button"
                                onClick={() => setSelectedLineItemId(row.lineItemId)}
                                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                                  isSelected
                                    ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary))]"
                                    : "border-border bg-card hover:border-primary/40 hover:bg-accent/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-foreground">{row.lineItemLabel}</p>
                                  </div>
                                  <Badge variant={rowStatus.badgeVariant} className="shrink-0 text-[10px] uppercase tracking-[0.12em]">
                                    {getQueueCardBadgeLabel(row)}
                                  </Badge>
                                </div>
                                <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                                  <span className="shrink-0">{formatRelativeTime(row.lastActivityAt)}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden rounded-2xl border">
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              {detailQuery.isLoading ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-full min-h-[34rem] w-full rounded-xl" />
                </div>
              ) : detailQuery.error ? (
                <div className="p-4">
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {(detailQuery.error as Error).message}
                  </div>
                </div>
              ) : !selectedRow || !detail ? (
                <div className="flex h-full min-h-[34rem] items-center justify-center p-4">
                  <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                    Select a queue row to load proof detail.
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col p-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{previewName}</p>
                        {displayedVersion ? <Badge variant="outline">v{displayedVersion.versionNumber}</Badge> : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-1 rounded-lg border bg-background/80 px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewerZoom((value) => Math.max(50, value - 10))}
                        disabled={!displayedFile}
                      >
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <span className="min-w-10 text-center text-xs font-medium text-foreground">{viewerZoom}%</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewerZoom((value) => Math.min(200, value + 10))}
                        disabled={!displayedFile}
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                      <Separator orientation="vertical" className="mx-1 h-5" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewerPage((value) => Math.max(1, value - 1))}
                        disabled={!previewIsPdf || viewerPage <= 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="min-w-12 text-center text-xs font-medium text-foreground">Page {viewerPage}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewerPage((value) => value + 1)}
                        disabled={!previewIsPdf}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewerOpen(true)} disabled={!displayedFile}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => downloadUrl && downloadFileFromUrl(downloadUrl, previewName)}
                        disabled={!downloadUrl}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex min-h-0 flex-1 items-center justify-center rounded-2xl border bg-muted/10 p-2">
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
                      <iframe title={previewName} src={embeddedPdfUrl} className="h-full min-h-[33rem] w-full rounded-xl border bg-white" />
                    ) : previewIsImage && previewUrl ? (
                      <div className="flex h-full w-full items-center justify-center overflow-auto rounded-xl border bg-white p-4">
                        <img
                          src={previewUrl}
                          alt={previewName}
                          className="max-h-full max-w-full rounded-lg object-contain transition-transform duration-150"
                          style={{ transform: `scale(${viewerZoom / 100})` }}
                        />
                      </div>
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
              )}
            </CardContent>
          </Card>

          <div className="min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto pr-2 [scrollbar-color:hsl(var(--muted-foreground)/0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
              <Card className="rounded-2xl border">
                <CardContent className="space-y-3 p-4">
                  {detailQuery.isLoading ? (
                    <Skeleton className="h-28 w-full rounded-xl" />
                  ) : detail ? (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                          Order {selectedRow?.orderNumber ? `#${selectedRow.orderNumber}` : selectedRow?.orderId}
                        </p>
                        <div>
                          <p className="text-xl font-semibold leading-tight text-foreground">{selectedRow?.lineItemLabel || "Proofing"}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">{selectedRow?.packageLabel || "No package linked"}</p>
                        </div>
                        {selectedOrder?.customer?.id ? (
                          <Link to={ROUTES.customers.detail(selectedOrder.customer.id)} className="inline-flex text-sm text-primary hover:underline">
                            {selectedRow?.customerDisplayName || "View customer"}
                          </Link>
                        ) : selectedRow?.customerDisplayName ? (
                          <p className="text-sm text-muted-foreground">{selectedRow.customerDisplayName}</p>
                        ) : null}
                      </div>

                      <Button
                        className="h-10 w-full rounded-xl"
                        onClick={() => (canSendCurrentVersion ? setSendDialogOpen(true) : setCreateDialogOpen(true))}
                        disabled={!selectedRow}
                      >
                        {canSendCurrentVersion ? <Send className="mr-2 h-4 w-4" /> : <Upload className="mr-2 h-4 w-4" />}
                        {canSendCurrentVersion ? "Upload & Send Proof" : "New Proof"}
                      </Button>

                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="h-9 rounded-xl"
                          onClick={() => respondMutation.mutate("approved")}
                          disabled={respondMutation.isPending || !canRecordDecision}
                        >
                          {respondMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Record Approval
                        </Button>
                        <Button
                          variant="outline"
                          className="h-9 rounded-xl"
                          onClick={() => versionHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          disabled={!detail}
                        >
                          View History
                        </Button>
                      </div>

                      {canRecordDecision ? (
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              className="h-9 rounded-xl"
                              onClick={() => respondMutation.mutate("revision_requested")}
                              disabled={respondMutation.isPending}
                            >
                              Request Revision
                            </Button>
                            <Button
                              variant="destructive"
                              className="h-9 rounded-xl"
                              onClick={() => respondMutation.mutate("rejected")}
                              disabled={respondMutation.isPending}
                            >
                              Reject
                            </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No line item selected.</div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border">
                <CardContent className="space-y-2.5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Customer Feedback</p>
                  {!detail ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Load a queue row to inspect feedback.</div>
                  ) : !latestCustomerFeedback ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No customer feedback has been recorded yet.</div>
                  ) : (
                    <div className="rounded-xl border p-4">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[11px] text-muted-foreground">{formatRelativeTime(latestCustomerFeedback.respondedAt)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {latestCustomerFeedback.responseNotes || "No notes were recorded with this decision."}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border">
                <CardContent className="space-y-2.5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Job Specifications</p>
                  {jobSpecificationRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No job specifications are available for this line item.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                      {jobSpecificationRows.slice(0, 6).map((row) => (
                        <div key={row.label} className="rounded-xl border p-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{row.label}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{String(row.value)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border">
                <CardContent className="space-y-2.5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Internal Staff Notes</p>
                  <div className="rounded-xl border p-4 text-sm leading-6 text-muted-foreground">
                    {internalStaffNote || "No internal notes have been recorded for this proof yet."}
                  </div>
                </CardContent>
              </Card>

              {canOverride ? (
                <Card className="rounded-2xl border">
                  <CardContent className="space-y-2.5 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Manual Override</p>
                    <Button
                      variant="outline"
                      className="h-9 w-full rounded-xl"
                      onClick={() => setOverrideDialogOpen(true)}
                      disabled={!detail?.currentActionableProofVersionId || detail.approvedProofSource === "manual_override"}
                    >
                      <ShieldAlert className="mr-2 h-4 w-4" />
                      Manual Override
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              <Card ref={versionHistoryRef} className="rounded-2xl border">
                <CardContent className="space-y-3 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Version History</p>
                  {detail ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {detail.proofVersionHistory.length === 0 ? (
                          <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No proof versions yet.</div>
                        ) : (
                          detail.proofVersionHistory.map((version) => {
                            const isSelected = version.id === selectedVersionId;
                            return (
                              <button
                                key={version.id}
                                type="button"
                                onClick={() => setSelectedVersionId(version.id)}
                                className={`w-full rounded-xl border p-3 text-left transition ${isSelected ? "border-primary bg-primary/8" : "border-border"}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-foreground">Version {version.versionNumber}</p>
                                  <Badge variant={statusBadgeVariant(version.status)}>{getVersionStatusLabel(version.status)}</Badge>
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground">Created {formatTimestamp(version.createdAt)}</p>
                              </button>
                            );
                          })
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        {detail.proofDecisionHistory.length === 0 ? (
                          <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No responses recorded yet.</div>
                        ) : (
                          detail.proofDecisionHistory.map((decision) => (
                            <div key={decision.id} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant={statusBadgeVariant(decision.decision)}>{getDecisionLabel(decision.decision)}</Badge>
                                <span className="text-[11px] text-muted-foreground">{formatTimestamp(decision.respondedAt)}</span>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground">{decision.responseNotes || "No response notes"}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Load a queue row to review version history.</div>
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