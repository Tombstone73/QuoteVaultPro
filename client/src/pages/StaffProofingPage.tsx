import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  Lock,
  Loader2,
  Search,
  Send,
  ShieldAlert,
  Upload,
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
import { useOrder, useUpdateOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { buildPdfViewUrl, isPdfFile } from "@/lib/pdfUrls";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";
import { proofQueueSliceValues } from "@shared/proofing";
import type {
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

function getQueueCardBadgeClass(row: ProofingQueueRow) {
  switch (row.currentQueueStatus) {
    case "awaiting_send":
      return "border-[#3b4660] bg-[#1a2236] text-[#d7ddea]";
    case "awaiting_approval":
      return "border-[#6a5318] bg-[#2f2610] text-[#f2c663]";
    case "revision_requested":
      return "border-[#74324d] bg-[#3a1725] text-[#ff7f9f]";
    case "approved":
    case "approved_by_override":
      return "border-[#244f45] bg-[#102b24] text-[#72d4b8]";
    case "rejected":
      return "border-[#74324d] bg-[#3a1725] text-[#ff7f9f]";
    default:
      return "border-[#3b4660] bg-[#1a2236] text-[#d7ddea]";
  }
}

function getSectionHeadingClass(sectionKey: string) {
  switch (sectionKey) {
    case "awaiting_approval":
      return "text-amber-500/80";
    case "revision_requested":
      return "text-rose-500";
    default:
      return "text-slate-600";
  }
}

function getPersonInitials(value: string | null | undefined) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "NA";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function getAvatarClass(sectionKey: string) {
  switch (sectionKey) {
    case "awaiting_send":
      return "bg-blue-500";
    case "awaiting_approval":
      return "bg-indigo-500";
    case "revision_requested":
      return "bg-emerald-500";
    default:
      return "bg-slate-700";
  }
}

function getResponseSummary(latestCustomerFeedback: ReturnType<typeof Object> | any) {
  if (!latestCustomerFeedback) return null;
  switch (latestCustomerFeedback.decision) {
    case "revision_requested":
      return "Changes Requested";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return null;
  }
}

function getVersionStatusBadgeClass(status: ProofVersionStatus) {
  switch (status) {
    case "draft":
      return "border-[#3b4660] bg-[#1a2236] text-[#d7ddea]";
    case "awaiting_response":
      return "border-[#6a5318] bg-[#2f2610] text-[#f2c663]";
    case "revision_requested":
      return "border-[#74324d] bg-[#3a1725] text-[#ff7f9f]";
    case "approved":
      return "border-[#244f45] bg-[#102b24] text-[#72d4b8]";
    case "rejected":
      return "border-[#74324d] bg-[#3a1725] text-[#ff7f9f]";
    default:
      return "border-[#3b4660] bg-[#1a2236] text-[#d7ddea]";
  }
}

function getPrimaryActionLabel(canSendCurrentVersion: boolean, displayedVersion: ProofVersionHistoryEntry | null) {
  if (!canSendCurrentVersion) return "New Proof";
  return `Upload & Send v${displayedVersion?.versionNumber ?? "?"} Proof`;
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
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [internalNotesDirty, setInternalNotesDirty] = useState(false);

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
      return [row.lineItemLabel, row.customerDisplayName, row.packageLabel, row.orderNumber]
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
  const updateOrder = useUpdateOrder(selectedRow?.orderId ?? "");
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
  const primaryActionLabel = getPrimaryActionLabel(canSendCurrentVersion, displayedVersion);

  useEffect(() => {
    setInternalNotesDraft(selectedOrder?.notesInternal || "");
    setInternalNotesDirty(false);
  }, [selectedOrder?.id, selectedOrder?.notesInternal]);

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

  async function handleSaveInternalNotes() {
    if (!selectedRow?.orderId) return;

    const currentValue = (selectedOrder?.notesInternal || "").trim();
    const nextValue = internalNotesDraft.trim();

    if (currentValue === nextValue) {
      setInternalNotesDirty(false);
      return;
    }

    await updateOrder.mutateAsync({
      notesInternal: nextValue || null,
    });
    setInternalNotesDirty(false);
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
      <div className="flex h-[calc(100vh-150px)] min-h-[48rem] flex-1 flex-col overflow-hidden bg-[#0B1120] text-slate-100">
        <header className="shrink-0 border-b border-[#232948] bg-[#0B1120] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Proofing</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search proofs..."
                  className="h-9 w-64 rounded-lg border-none bg-[#141824] pl-9 pr-4 text-sm text-white placeholder:text-slate-600 focus:ring-1 focus:ring-[#1337ec]"
                />
              </div>
              <Button
                className="h-9 rounded-lg bg-[#1337ec] px-4 text-sm font-bold text-white transition-all hover:bg-[#1a43ff]"
                onClick={() => setCreateDialogOpen(true)}
                disabled={!selectedRow}
              >
                <Upload className="mr-2 h-4 w-4" />
                New Proof
              </Button>
            </div>
          </div>
        </header>

        <Tabs value={slice} onValueChange={(value) => setSlice(value as ProofQueueSlice)} className="shrink-0 bg-[#0B1120] px-6 border-b border-[#232948]">
          <TabsList className="h-auto w-full justify-start gap-6 rounded-none bg-transparent px-0 py-0">
            {queueSliceMeta.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 shadow-none hover:text-white data-[state=active]:border-[#1337ec] data-[state=active]:bg-transparent data-[state=active]:text-white"
              >
                {tab.label === "All" ? "All Proofs" : tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <main className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-80 shrink-0 flex-col border-r border-[#232948] bg-[#0B1120]">
            <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
              {queueQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-24 w-full rounded-lg bg-[#141824]" />
                  ))}
                </div>
              ) : queueQuery.error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
                  {(queueQuery.error as Error).message}
                </div>
              ) : filteredQueueRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#232948] p-4 text-sm text-slate-500">
                  {searchQuery.trim() ? "No proofs match this search." : "No line items are currently in this proofing slice."}
                </div>
              ) : (
                groupedQueueSections.map((section) => (
                  <div key={section.key} className="space-y-2">
                    <p className={`px-2 text-[10px] font-bold uppercase ${getSectionHeadingClass(section.key)}`}>
                      {section.label} ({section.rows.length})
                    </p>
                    {section.rows.map((row) => {
                      const isSelected = row.lineItemId === selectedRow?.lineItemId;
                      return (
                        <button
                          key={row.lineItemId}
                          type="button"
                          onClick={() => setSelectedLineItemId(row.lineItemId)}
                          className={`group w-full cursor-pointer rounded-lg p-3 text-left transition-all ${
                            isSelected
                              ? "border-2 border-[#1337ec] bg-[#1337ec]/10 shadow-[0_0_15px_rgba(19,55,236,0.15)]"
                              : "border border-[#232948] bg-[#141824]/40 hover:border-slate-600"
                          }`}
                        >
                          <div className="mb-2 flex items-start justify-between">
                            <span className={`text-[10px] font-mono ${isSelected ? "font-bold text-[#4b7bff]" : "text-slate-400"}`}>
                              {row.orderNumber ? `#${row.orderNumber}` : row.orderId}
                            </span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${getQueueCardBadgeClass(row)}`}>
                              {getQueueCardBadgeLabel(row)}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-white transition-colors group-hover:text-[#1337ec]">{row.lineItemLabel}</h4>
                          <div className="mt-3 flex items-center justify-between">
                            <div className={`flex size-5 items-center justify-center rounded-full text-[8px] text-white ${getAvatarClass(section.key)}`}>
                              {getPersonInitials(row.customerDisplayName)}
                            </div>
                            <span className={`flex items-center gap-1 text-[10px] ${section.key === "awaiting_approval" ? "text-amber-500/70" : section.key === "revision_requested" ? "font-bold text-rose-400" : "text-slate-500"}`}>
                              {section.key === "awaiting_approval" ? <Eye className="h-3 w-3" /> : section.key === "revision_requested" ? <AlertCircle className="h-3 w-3" /> : null}
                              {section.key === "awaiting_approval" ? "Viewed" : formatRelativeTime(row.lastActivityAt)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="relative flex flex-1 flex-col overflow-hidden bg-[#0d1117]">
            {detailQuery.isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-14 w-full rounded-lg bg-[#141824]" />
                <Skeleton className="h-full min-h-[34rem] w-full rounded-lg bg-[#141824]" />
              </div>
            ) : detailQuery.error ? (
              <div className="p-4">
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
                  {(detailQuery.error as Error).message}
                </div>
              </div>
            ) : !selectedRow || !detail ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">Select a queue row to load proof detail.</div>
            ) : (
              <>
                <div className="z-10 flex items-center justify-between border-b border-[#232948] bg-[#0B1120]/60 p-3 backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="rounded-full bg-rose-500/20 px-3 py-1 text-[10px] font-bold tracking-wider text-rose-500">
                      Customer Visible Proof
                    </div>
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-tight text-white">{previewName}</h2>
                      <p className="text-[9px] text-slate-500">
                        {displayedVersion?.sentAt ? `Sent ${formatTimestamp(displayedVersion.sentAt)}` : `Created ${formatTimestamp(displayedVersion?.createdAt)}`} • Last viewed {formatRelativeTime(selectedRow.lastActivityAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-lg border border-[#232948] bg-[#141824] p-1">
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700"
                        onClick={() => setViewerZoom((value) => Math.max(50, value - 10))}
                        disabled={!displayedFile}
                      >
                        <ZoomOut className="h-[18px] w-[18px]" />
                      </button>
                      <span className="border-x border-[#232948] px-2 text-[10px] font-bold text-slate-300">{viewerZoom}%</span>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700"
                        onClick={() => setViewerZoom((value) => Math.min(200, value + 10))}
                        disabled={!displayedFile}
                      >
                        <ZoomIn className="h-[18px] w-[18px]" />
                      </button>
                      <div className="mx-1 h-3 w-px bg-[#232948]" />
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700"
                        onClick={() => setViewerPage((value) => Math.max(1, value - 1))}
                        disabled={!previewIsPdf || viewerPage <= 1}
                      >
                        <ChevronLeft className="h-[18px] w-[18px]" />
                      </button>
                      <span className="px-2 text-[10px] font-bold text-slate-300">{previewIsPdf ? `${viewerPage} / 4` : `${viewerPage}`}</span>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700"
                        onClick={() => setViewerPage((value) => value + 1)}
                        disabled={!previewIsPdf}
                      >
                        <ChevronRight className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-slate-400 transition-all hover:bg-[#141824] hover:text-white"
                      onClick={() => downloadUrl && downloadFileFromUrl(downloadUrl, previewName)}
                      disabled={!downloadUrl}
                    >
                      <Download className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-slate-400 transition-all hover:bg-[#141824] hover:text-white"
                      onClick={() => setViewerOpen(true)}
                      disabled={!displayedFile}
                    >
                      <ExternalLink className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 items-start justify-center overflow-auto bg-[radial-gradient(circle_at_center,_#141824,_#0b0e14)] p-8">
                  <div className="relative w-full max-w-3xl bg-white shadow-2xl">
                    {!displayedVersion ? (
                      <div className="flex aspect-[1/1.414] items-center justify-center bg-slate-100 text-slate-500">No proof version selected.</div>
                    ) : !displayedFile ? (
                      <div className="flex aspect-[1/1.414] items-center justify-center bg-slate-100 text-slate-500">This proof version has no resolved file.</div>
                    ) : previewIsPdf && embeddedPdfUrl ? (
                      <iframe title={previewName} src={embeddedPdfUrl} className="aspect-[1/1.414] w-full bg-white" />
                    ) : previewIsImage && previewUrl ? (
                      <div className="aspect-[1/1.414] w-full overflow-hidden bg-slate-200">
                        <img
                          src={previewUrl}
                          alt={previewName}
                          className="h-full w-full object-cover"
                          style={{ transform: `scale(${Math.max(viewerZoom, 85) / 100})` }}
                        />
                      </div>
                    ) : previewUrl ? (
                      <div className="flex aspect-[1/1.414] items-center justify-center bg-slate-100 text-slate-500">
                        <div className="text-center">
                          <FileImage className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          Preview is not available inline for this file type.
                        </div>
                      </div>
                    ) : (
                      <div className="flex aspect-[1/1.414] items-center justify-center bg-slate-100 text-slate-500">
                        <div className="text-center">
                          <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" />
                          No preview URL is available for the selected proof file.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="custom-scrollbar w-96 shrink-0 overflow-y-auto border-l border-[#232948] bg-[#0B1120]">
            <div className="border-b border-[#232948] bg-[#141824]/20 p-6">
              {detailQuery.isLoading ? (
                <Skeleton className="h-24 w-full rounded-lg bg-[#141824]" />
              ) : detail ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex w-full flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-black uppercase tracking-[0.2em] text-[#1337ec]">
                          Order {selectedRow?.orderNumber ? `#${selectedRow.orderNumber}` : selectedRow?.orderId}
                        </span>
                        <div className="flex gap-2">
                          {displayedVersion ? <span className="rounded-md border border-[#232948] bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-400">v{displayedVersion.versionNumber}</span> : null}
                          <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight ${getQueueCardBadgeClass(selectedRow)}`}>
                            {staffStatus.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-tight text-white">{selectedRow?.lineItemLabel || "Proofing"}</h2>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{selectedRow?.packageLabel || "No package linked"}</p>
                  {selectedRow?.customerDisplayName ? <p className="mt-2 text-sm text-slate-300">{selectedRow.customerDisplayName}</p> : null}
                </>
              ) : (
                <div className="text-sm text-slate-500">No line item selected.</div>
              )}
            </div>

            <div className="space-y-0">
              <div className="space-y-4 border-b border-[#232948] p-6">
                <div>
                  <Button
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1337ec] text-sm font-bold text-white shadow-lg shadow-[#1337ec]/20 transition-all hover:bg-[#1a43ff]"
                    onClick={() => (canSendCurrentVersion ? setSendDialogOpen(true) : setCreateDialogOpen(true))}
                    disabled={!selectedRow}
                  >
                    <Upload className="h-4 w-4" />
                    {primaryActionLabel}
                  </Button>
                  {latestCustomerFeedback ? (
                    <p className="mt-3 text-center text-[10px] text-slate-500">
                      {displayedVersion?.sentAt ? `v${displayedVersion.versionNumber} sent ${formatTimestamp(displayedVersion.sentAt)}` : "Awaiting response"} • Last response: <span className="font-semibold text-rose-400">{getResponseSummary(latestCustomerFeedback)}</span>
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-[#232948] bg-transparent text-[10px] font-bold uppercase tracking-wider text-slate-200 transition-all hover:bg-slate-800"
                    onClick={() => versionHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    disabled={!detail}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View History
                  </Button>
                </div>
              </div>

              <div className="border-b border-[#232948] bg-rose-500/[0.02] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Customer Feedback</h4>
                  {latestCustomerFeedback ? <span className="rounded bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">1 NEW</span> : null}
                </div>
                {!detail ? (
                  <div className="text-sm text-slate-500">Load a queue row to inspect feedback.</div>
                ) : !latestCustomerFeedback ? (
                  <div className="text-sm text-slate-500">No customer feedback has been recorded yet.</div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-r-lg border-l-2 border-rose-500 bg-rose-500/5 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-white">{latestCustomerFeedback.responderName || latestCustomerFeedback.responderEmail || "Customer"}</span>
                        <span className="text-[9px] text-slate-500">{formatRelativeTime(latestCustomerFeedback.respondedAt)}</span>
                      </div>
                      <p className="text-xs italic leading-relaxed text-slate-300">&quot;{latestCustomerFeedback.responseNotes || "No notes were recorded with this decision."}&quot;</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-b border-[#232948] p-6">
                <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Job Specifications</h4>
                {jobSpecificationRows.length === 0 ? (
                  <div className="text-sm text-slate-500">No job specifications are available for this line item.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-4">
                    {jobSpecificationRows.slice(0, 4).map((row) => (
                      <div key={row.label}>
                        <p className="text-[9px] font-bold uppercase text-slate-500">{row.label}</p>
                        <p className="text-xs font-bold text-slate-200">{String(row.value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-b border-[#232948] bg-[#141824]/20 p-6">
                <h4 className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <Lock className="h-4 w-4" />
                  Internal Staff Notes
                </h4>
                <div className="space-y-3">
                  <Textarea
                    value={internalNotesDraft}
                    onChange={(event) => {
                      setInternalNotesDraft(event.target.value);
                      setInternalNotesDirty(true);
                    }}
                    placeholder="Add internal staff notes for this order"
                    className="min-h-[112px] resize-none rounded-xl border-[#232948] bg-[#0F1524] text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#1337ec]"
                    disabled={!selectedRow?.orderId || updateOrder.isPending}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-500">
                      {internalStaffNote ? "Saved to the order's internal notes." : "No internal notes have been recorded for this order yet."}
                    </p>
                    <Button
                      variant="outline"
                      className="h-9 rounded-xl border-[#232948] bg-transparent px-4 text-[10px] font-bold uppercase tracking-wider text-slate-200 transition-all hover:bg-slate-800"
                      onClick={() => void handleSaveInternalNotes()}
                      disabled={!selectedRow?.orderId || !internalNotesDirty || updateOrder.isPending}
                    >
                      {updateOrder.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Notes
                    </Button>
                  </div>
                </div>
              </div>

              {canOverride ? (
                <div className="border-b border-[#232948] p-6">
                  <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Manual Override</h4>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-[#232948] bg-[#141824] text-[10px] font-bold uppercase tracking-wider text-slate-100 transition-all hover:border-[#1337ec] hover:bg-[#1337ec]/10"
                    onClick={() => setOverrideDialogOpen(true)}
                    disabled={!detail?.currentActionableProofVersionId || detail.approvedProofSource === "manual_override"}
                  >
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    Manual Override
                  </Button>
                </div>
              ) : null}

              <div ref={versionHistoryRef} className="p-6">
                <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Version History</h4>
                {detail ? (
                  <ScrollArea className="max-h-[26rem] pr-3">
                    <div className="space-y-3">
                      {detail.proofVersionHistory.map((version) => {
                        const isSelected = version.id === selectedVersionId;
                        return (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => setSelectedVersionId(version.id)}
                            className={`w-full rounded-lg border p-3 text-left transition-all ${isSelected ? "border-[#1337ec] bg-[#1337ec]/10" : "border-[#232948] bg-[#141824]/40 hover:border-slate-600"}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-white">Version {version.versionNumber}</p>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${getVersionStatusBadgeClass(version.status)}`}>
                                {getVersionStatusLabel(version.status)}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">Created {formatTimestamp(version.createdAt)}</p>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-sm text-slate-500">Load a queue row to review version history.</div>
                )}
              </div>
            </div>
          </aside>
        </main>
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