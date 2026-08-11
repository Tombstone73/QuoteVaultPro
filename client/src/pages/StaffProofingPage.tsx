import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import pdfCMapProbeUrl from "pdfjs-dist/cmaps/78-EUC-H.bcmap?url";
import pdfStandardFontProbeUrl from "pdfjs-dist/standard_fonts/FoxitFixed.pfb?url";
import { usePageVisible } from "@/hooks/usePageVisible";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ChevronLeft,
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
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { CombinedProofSelectionBar } from "@/components/proofing/CombinedProofSelectionBar";
import { PrintTicketActions } from "@/components/production/PrintTicketActions";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import { useAuth } from "@/hooks/useAuth";
import { useOrderLineItemFiles, type OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useOrder, useUpdateOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { artworkPreviewLabel, shouldPollArtworkPreview } from "@/lib/artworkPreviewLifecycle";
import {
  getCanonicalProofWorkspaceMode,
  getDisplayedProofVersionId,
  getHistoryPreviewLabel,
  type ProofWorkspaceMode,
} from "@/lib/proofWorkspaceState";
import { getProofPdfPageCountLabel } from "@/lib/proofViewerPageCount";
import { openAuthenticatedImagePreview, openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview";
import { apiFetchBlob } from "@/lib/queryClient";
import {
  canGeneratePreviewRecovery,
  canRegenerateGeneratedProof,
  getGenerateProofDraftDisabledReason,
  getProofVersionRecoveryStatusLabel,
  getProofVersionRecoveryStatusNote,
} from "@/lib/proofingRecovery";
import { getStaffProofDownloadUrl, getStaffProofPreviewUrl, shouldFetchStaffPreviewAsBlob } from "@/lib/proofingPreviewUrls";
import { buildProofingArtworkDisplayUrl, buildProofingArtworkThumbnailUrl } from "@/lib/proofingArtworkDisplay";
import { getProofingQueueDueDate } from "@/lib/proofingQueueDueDate";
import { buildPdfViewUrl, isPdfFile } from "@/lib/pdfUrls";
import {
  combinedProofReviewIsReady,
  getCombinedProofJobLabel,
  isCombinedProofLineSelectable,
  isProofingSelectionSelectable,
  selectAllCombinedProofLinesForOrder,
  updateCombinedProofSelection,
} from "@/lib/combinedProofSelection";

const pdfCMapUrl = pdfCMapProbeUrl.replace(/78-EUC-H\.bcmap(?:\?.*)?$/, "");
const pdfStandardFontDataUrl = pdfStandardFontProbeUrl.replace(/FoxitFixed\.pfb(?:\?.*)?$/, "");
import {
  getInitialProofingFilter,
  getProofingFilterCount,
  matchesProofingFilter,
  matchesProofingSearch,
  proofingFilterValues,
  proofingSortValues,
  sortProofingQueueRows,
  type ProofingFilterValue,
  type ProofingSortValue,
} from "@/lib/proofingQueueControls";
import {
  findProofingQueueRowByLineItemId,
  isRequestedProofingLineItemMissing,
  PROOFING_MISSING_LINE_ITEM_MESSAGE,
  resolveProofingActiveRow,
} from "@/lib/proofingNavigation";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";
import type {
  ProofArtifactPreviewStatus,
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
  message?: string;
};

type ProofFileRow = OrderFileWithUser & {
  fileRecordId?: string | null;
  originalFilename?: string | null;
  authenticatedUrl?: string | null;
  downloadUrl?: string | null;
  objectPath?: string | null;
  fileUrl?: string | null;
  previewUrl?: string | null;
  originalUrl?: string | null;
  thumbUrl?: string | null;
  thumbnailUrl?: string | null;
  displayFilename?: string | null;
  computedDisplayFilename?: string | null;
  checksum?: string | null;
  fileSize?: number | null;
  sizeBytes?: number | null;
  role?: string | null;
  __source?: "attachment" | "asset";
};

type ProofAttachmentRow = ProofFileRow & {
  __source?: "attachment";
  role?: string | null;
};

type EligibleProofArtworkSource = {
  id: string;
  sourceType: "line_item_artwork" | "line_item_asset" | "line_item_file";
  sourceId: string;
  attachmentId: string | null;
  fileRecordId: string | null;
  fileName: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  displayFilename?: string | null;
  computedDisplayFilename?: string | null;
  role: string | null;
  side: "front" | "back" | "both" | "na";
  previewStatus: "ready" | "missing_preview" | "generation_failed";
  previewState: "available" | "queued" | "processing" | "failed" | "timed_out" | "unsupported" | "source_unavailable";
  previewLastStateChangeAt: string | null;
  previewRetryAllowed: boolean;
  previewFailureReason: string | null;
  previewMessage: string;
  previewRetryAfterMs: number | null;
  recoveryAction: "generate_preview" | null;
  allocatedQuantity: number | null;
  eligible: boolean;
  eligibilityReason: string | null;
};

type ProofArtworkSummary = {
  totalQuantity: number | null;
  artworkCount: number;
  allocationMode: "one_each_per_file" | "same_quantity_each" | "unspecified";
  allocationIssue: string | null;
};

type ProofRecipientOption = {
  id: string;
  name: string;
  email: string;
  isPrimary?: boolean;
  isOrderContact?: boolean;
  isBillingContact?: boolean;
};

const proofingFilterMeta: Array<{ value: ProofingFilterValue; label: string }> = [
  { value: "awaiting_proof", label: "Awaiting Proof" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const proofingSortMeta: Array<{ value: ProofingSortValue; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "customer", label: "Customer name (A–Z)" },
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
    const error = new Error(json.message || json.error || "Request failed") as Error & { status?: number };
    error.status = response.status;
    throw error;
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

function getProofFileDisplayName(file: Pick<ProofFileRow, "displayFilename" | "computedDisplayFilename" | "originalFilename" | "fileName"> | null | undefined) {
  return file?.computedDisplayFilename || file?.displayFilename || file?.originalFilename || file?.fileName || "File";
}

function getProofFileCanonicalIdentity(file: ProofFileRow | null | undefined) {
  const fileRecordId = String(file?.fileRecordId || "").trim();
  if (fileRecordId) return `file-record:${fileRecordId}`;
  const checksum = String(file?.checksum || "").trim().toLowerCase();
  if (checksum) return `checksum:${checksum}`;
  const objectPath = String(file?.objectPath || file?.fileUrl || "").trim().toLowerCase();
  if (objectPath) return `storage:${objectPath}`;
  const filename = String(file?.originalFilename || file?.fileName || "").trim().toLowerCase();
  const size = Number(file?.sizeBytes ?? file?.fileSize ?? 0);
  const mimeType = String(file?.mimeType || "").trim().toLowerCase();
  return filename || size > 0 || mimeType ? `legacy:${filename}:${Number.isFinite(size) ? size : 0}:${mimeType}` : null;
}

function getProofPreviewUrl(file: ProofFileRow | null | undefined) {
  if (!file) return null;
  const fileName = file.originalFilename || file.fileName || "Proof";
  const mimeType = file.mimeType || null;
  const isPdf = isPdfFile(mimeType, fileName);
  return getStaffProofPreviewUrl(file, isPdf) || (isPdf ? buildPdfViewUrl(file.objectPath) : null);
}

function getDownloadUrl(file: ProofFileRow | null | undefined) {
  return getStaffProofDownloadUrl(file);
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
  artifact: ProofingReadModel["currentDisplayedProofArtifact"] | null;
}): StaffFacingStatus {
  const { row, detail, displayedVersion, artifact } = args;

  if (artifact?.previewStatus === "generation_failed") {
    return {
      label: "Preview Generation Failed",
      badgeVariant: "destructive",
    };
  }

  if (artifact?.previewStatus === "missing_preview" || artifact?.previewStatus === "metadata_only") {
    return {
      label: "Missing Artwork Preview",
      badgeVariant: "destructive",
    };
  }

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

  const terminalRecoveryNote = getProofVersionRecoveryStatusNote(displayedVersion?.status);
  if (terminalRecoveryNote) {
    return terminalRecoveryNote;
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

/** Look up a value from the snapshot's selectedOptionMap by any of the supplied key variants (case-insensitive). */
function getSnapshotOption(map: Record<string, string> | undefined, ...keys: string[]): string | null {
  if (!map) return null;
  for (const key of keys) {
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase() === lower) return v;
    }
  }
  return null;
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
    case "cancelled":
      return "border-[#4a5568] bg-[#111827] text-[#d1d5db]";
    case "superseded":
      return "border-[#4a5568] bg-[#1f2937] text-[#d1d5db]";
    default:
      return "border-[#3b4660] bg-[#1a2236] text-[#d7ddea]";
  }
}

function getPrimaryActionLabel(canSendCurrentVersion: boolean, displayedVersion: ProofVersionHistoryEntry | null) {
  if (!canSendCurrentVersion) return "New Proof Draft";
  return `Send Draft v${displayedVersion?.versionNumber ?? "?"}`;
}

function getProofPreviewIssue(args: {
  artifact: ProofingReadModel["currentDisplayedProofArtifact"] | null;
  sourceFileName: string | null | undefined;
}) {
  const { artifact, sourceFileName } = args;
  if (!artifact || artifact.previewStatus === "ready") return null;

  if (artifact.previewStatus === "generation_failed") {
    return {
      title: "Preview Generation Failed",
      description: artifact.previewError || "The system could not generate a preview from the saved artwork.",
      nextAction: "Upload proof manually or check artwork attachment.",
      sourceFileName: sourceFileName || null,
    };
  }

  return {
    title: "Missing Artwork Preview",
    description: artifact.previewError || "This proof does not include an artwork preview.",
    nextAction: "Upload proof manually or check artwork attachment.",
    sourceFileName: sourceFileName || null,
  };
}

function getVersionStatusLabel(status: ProofVersionStatus | null | undefined) {
  return getProofVersionRecoveryStatusLabel(status);
}

export default function StaffProofingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isPageVisible = usePageVisible();

  const { isInternalUser, canOverride } = getRoleSummary(user?.role);
  const requestedLineItemId = searchParams.get("lineItemId");
  const requestedSlice = searchParams.get("slice");

  const [activeFilter, setActiveFilter] = useState<ProofingFilterValue>(() => getInitialProofingFilter(requestedSlice));
  const [sortOrder, setSortOrder] = useState<ProofingSortValue>("newest");
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [batchSelectedLineItemIds, setBatchSelectedLineItemIds] = useState<string[]>([]);
  const [combinedProofDialogOpen, setCombinedProofDialogOpen] = useState(false);
  const [combinedProofReview, setCombinedProofReview] = useState<Array<{
    lineItemId: string;
    sources: EligibleProofArtworkSource[];
    eligibleCount: number;
  }>>([]);
  // History inspection is intentionally independent from the server-authoritative
  // active proof. A cancelled version must never remain selected as active.
  const [selectedHistoryVersionId, setSelectedHistoryVersionId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<ProofWorkspaceMode>("preparing");
  const workspaceLineItemRef = useRef<string | null>(null);
  const workspaceActiveProofIdRef = useRef<string | null | undefined>(undefined);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [viewerZoom, setViewerZoom] = useState(85);
  const [viewerPageCount, setViewerPageCount] = useState(0);
  const [viewerPageCountError, setViewerPageCountError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const imagePanRef = useRef<HTMLDivElement | null>(null);
  const versionHistoryRef = useRef<HTMLDivElement | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const previewGenerationRequestedRef = useRef(new Set<string>());
  const [createMode, setCreateMode] = useState<"generated" | "uploaded">("generated");
  const [proofCreationIntent, setProofCreationIntent] = useState<"new_draft" | "revision">("new_draft");
  const [selectedExistingAttachmentId, setSelectedExistingAttachmentId] = useState<string>("");
  const [selectedArtworkSourceIds, setSelectedArtworkSourceIds] = useState<string[]>([]);
  const [failedArtworkPreviewIds, setFailedArtworkPreviewIds] = useState<Set<string>>(() => new Set());
  const [openingArtworkPreviewId, setOpeningArtworkPreviewId] = useState<string | null>(null);
  const artworkSelectionLineItemRef = useRef<string | null>(null);
  const [createInternalNotes, setCreateInternalNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [staffPreviewBlobUrl, setStaffPreviewBlobUrl] = useState<string | null>(null);
  const [staffPreviewError, setStaffPreviewError] = useState<string | null>(null);
  const [staffPreviewLoading, setStaffPreviewLoading] = useState(false);
  const [previewRecoveryState, setPreviewRecoveryState] = useState<{
    lineItemId: string;
    derivativeStatus: "ready" | "pending" | "failed";
  } | null>(null);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  // "send" = send a draft for the first time; "resend" = re-notify for an awaiting_response version
  const [sendDialogMode, setSendDialogMode] = useState<"send" | "resend">("send");
  // versionIdForSend allows the resend flow to target a specific version without
  // changing the inspected history selection that drives the main preview panel.
  const [versionIdForSend, setVersionIdForSend] = useState<string | null>(null);
  const [sendEmailSource, setSendEmailSource] = useState<"prefilled" | "">("");
  const [sendToName, setSendToName] = useState("");
  const [sendToEmail, setSendToEmail] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [internalNotesDirty, setInternalNotesDirty] = useState(false);

  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [bulkOverrideDialogOpen, setBulkOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [proofNotRequiredDialogOpen, setProofNotRequiredDialogOpen] = useState(false);
  const [proofNotRequiredReason, setProofNotRequiredReason] = useState("");
  const [proofNotRequiredNote, setProofNotRequiredNote] = useState("");

  const queueQuery = useQuery<JsonEnvelope<ProofingQueueResponse>>({
    queryKey: ["/api/proofing/queue", "all"],
    queryFn: () => readJson(`/api/proofing/queue?slice=all`),
    enabled: isInternalUser,
    staleTime: 30_000,
    // All local staff actions (create draft, send, override) already invalidate this query immediately.
    // The only remaining reason to poll is external events: customer proof decisions arriving via the
    // customer portal. 90s is sufficient fallback for those; hidden tabs never need to watch.
    refetchInterval: () => (isPageVisible ? 90_000 : false),
  });

  const queueData = queueQuery.data?.data;
  const queueRows = queueData?.rows ?? [];
  const baseQueueRows = useMemo(() => [...queueRows].sort(compareProofQueueRows), [queueRows]);
  const requestedRow = useMemo(
    () => findProofingQueueRowByLineItemId(baseQueueRows, requestedLineItemId),
    [baseQueueRows, requestedLineItemId],
  );
  const isLineItemOverrideActive = Boolean(requestedLineItemId && requestedRow);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (requestedLineItemId) return;
    setActiveFilter(getInitialProofingFilter(requestedSlice));
  }, [requestedLineItemId, requestedSlice]);

  const filteredSortedQueueRows = useMemo(() => {
    const filteredRows = baseQueueRows
      .filter((row) => matchesProofingFilter(row, activeFilter))
      .filter((row) => matchesProofingSearch(row, debouncedSearchQuery));

    return sortProofingQueueRows(filteredRows, sortOrder);
  }, [activeFilter, baseQueueRows, debouncedSearchQuery, sortOrder]);

  const visibleQueueRows = isLineItemOverrideActive && requestedRow
    ? [requestedRow]
    : filteredSortedQueueRows;
  const batchSelectedRows = batchSelectedLineItemIds
    .map((lineItemId) => baseQueueRows.find((row) => row.lineItemId === lineItemId))
    .filter((row): row is ProofingQueueRow => Boolean(row))
    .sort((left, right) => left.lineItemSortOrder - right.lineItemSortOrder || left.lineItemId.localeCompare(right.lineItemId));
  const batchSelectionOrderId = batchSelectedRows[0]?.orderId ?? null;
  const batchSelectionJobLabel = getCombinedProofJobLabel(batchSelectedRows);
  const matchingJobSelectableRows = batchSelectionOrderId
    ? baseQueueRows
      .filter((row) => row.orderId === batchSelectionOrderId && isProofingSelectionSelectable(row))
      .sort((left, right) => left.lineItemSortOrder - right.lineItemSortOrder || left.lineItemId.localeCompare(right.lineItemId))
    : [];
  const canCreateCombinedProof = batchSelectedRows.length >= 2 && batchSelectedRows.every(isCombinedProofLineSelectable);

  useEffect(() => {
    if (!queueQuery.data) return;
    const validIds = new Set(baseQueueRows.filter(isProofingSelectionSelectable).map((row) => row.lineItemId));
    setBatchSelectedLineItemIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [baseQueueRows, queueQuery.data]);

  const filterCounts = useMemo(() => {
    return proofingFilterValues.reduce<Record<ProofingFilterValue, number>>((acc, filter) => {
      acc[filter] = getProofingFilterCount(baseQueueRows, filter);
      return acc;
    }, {
      awaiting_proof: 0,
      sent: 0,
      approved: 0,
      rejected: 0,
    });
  }, [baseQueueRows]);

  useEffect(() => {
    if (requestedLineItemId) {
      if (selectedLineItemId !== (requestedRow?.lineItemId ?? null)) {
        setSelectedLineItemId(requestedRow?.lineItemId ?? null);
      }
      return;
    }

    if (!visibleQueueRows.length) {
      if (selectedLineItemId !== null) setSelectedLineItemId(null);
      return;
    }

    const stillPresent = selectedLineItemId ? visibleQueueRows.some((row) => row.lineItemId === selectedLineItemId) : false;
    if (!stillPresent) {
      setSelectedLineItemId(visibleQueueRows[0].lineItemId);
    }
  }, [requestedLineItemId, requestedRow, selectedLineItemId, visibleQueueRows]);

  const { activeLineItemId, activeRow } = resolveProofingActiveRow({
    requestedLineItemId,
    selectedLineItemId,
    filteredQueueRows: visibleQueueRows,
    allQueueRows: baseQueueRows,
  });
  const selectedRow = activeRow;

  const detailQuery = useQuery<JsonEnvelope<ProofingReadModel>>({
    queryKey: ["/api/proofing/line-item", activeLineItemId],
    queryFn: () => readJson(`/api/proofing/line-item/${activeLineItemId}`),
    enabled: Boolean(isInternalUser && activeLineItemId),
  });

  const detail = detailQuery.data?.data;
  const eligibleArtworkQuery = useQuery<JsonEnvelope<{
    sources: EligibleProofArtworkSource[];
    eligibleCount: number;
    disabledReason: string | null;
    disabledReasonCode: string | null;
    artworkSummary: ProofArtworkSummary;
  }>>({
    queryKey: ["/api/proofing/line-item", activeLineItemId, "eligible-artwork"],
    queryFn: () => readJson(`/api/proofing/line-item/${activeLineItemId}/eligible-artwork`),
    enabled: Boolean(isInternalUser && activeLineItemId),
    staleTime: 10_000,
    refetchInterval: (query) => {
      const sources = (query.state.data?.data?.sources ?? []) as EligibleProofArtworkSource[];
      return createDialogOpen && sources.some((source) => shouldPollArtworkPreview(source.previewState)) ? 3_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const eligibleArtworkSources = useMemo(
    () => eligibleArtworkQuery.data?.data?.sources ?? [],
    [eligibleArtworkQuery.data?.data?.sources],
  );
  const selectableGeneratedArtworkSources = useMemo(
    () => eligibleArtworkSources.filter((source) => source.eligible),
    [eligibleArtworkSources],
  );
  const activeOrderId = detail?.orderId ?? activeRow?.orderId ?? null;
  const recipientsQuery = useQuery<JsonEnvelope<{ defaultRecipient: ProofRecipientOption | null; contacts: ProofRecipientOption[] }>>({
    queryKey: ["/api/orders", activeOrderId, "proof-recipients"],
    queryFn: () => readJson(`/api/orders/${activeOrderId}/proof-recipients`),
    enabled: Boolean(isInternalUser && activeOrderId && sendDialogOpen),
    staleTime: 60_000,
  });
  const proofRecipients = recipientsQuery.data?.data?.contacts ?? [];
  const defaultProofRecipient = recipientsQuery.data?.data?.defaultRecipient ?? null;
  const orderQuery = useOrder(activeOrderId ?? undefined);
  const updateOrder = useUpdateOrder(activeOrderId ?? "");
  const selectedOrder = orderQuery.data;
  const selectedLineItem = useMemo(
    () => selectedOrder?.lineItems?.find((lineItem) => lineItem.id === activeLineItemId) ?? null,
    [activeLineItemId, selectedOrder],
  );

  const activeProofId = detail?.currentActionableProofVersionId ?? null;

  useEffect(() => {
    const lineItemChanged = workspaceLineItemRef.current !== activeLineItemId;
    if (lineItemChanged) {
      workspaceLineItemRef.current = activeLineItemId;
      workspaceActiveProofIdRef.current = activeProofId;
      setSelectedHistoryVersionId(null);
      setWorkspaceMode(getCanonicalProofWorkspaceMode(activeProofId));
      return;
    }

    if (workspaceActiveProofIdRef.current !== activeProofId) {
      workspaceActiveProofIdRef.current = activeProofId;
      setSelectedHistoryVersionId(null);
      setWorkspaceMode(getCanonicalProofWorkspaceMode(activeProofId));
      return;
    }

    const selectedHistoryStillExists = selectedHistoryVersionId
      ? detail?.proofVersionHistory.some((version) => version.id === selectedHistoryVersionId)
      : false;
    if (workspaceMode === "history_preview" && selectedHistoryStillExists) return;

    setSelectedHistoryVersionId(null);
    setWorkspaceMode(getCanonicalProofWorkspaceMode(activeProofId));
  }, [activeLineItemId, activeProofId, detail?.proofVersionHistory, selectedHistoryVersionId, workspaceMode]);

  const filesQuery = useOrderLineItemFiles(activeOrderId ?? undefined, activeLineItemId ?? undefined);
  const lineItemFiles = (filesQuery.data?.data ?? []) as ProofFileRow[];
  const artworkSummary = eligibleArtworkQuery.data?.data?.artworkSummary ?? null;
  const getArtworkSourcePreviewUrl = (source: EligibleProofArtworkSource) =>
    buildProofingArtworkDisplayUrl(activeLineItemId, source);
  const getArtworkSourceThumbnailUrl = (source: EligibleProofArtworkSource) =>
    buildProofingArtworkThumbnailUrl(activeLineItemId, source);
  const openArtworkPreview = async (source: EligibleProofArtworkSource) => {
    const url = getArtworkSourcePreviewUrl(source);
    if (!url) return;
    const sourceKey = `${source.sourceType}:${source.id}`;
    setOpeningArtworkPreviewId(sourceKey);
    try {
      const displayName = source.computedDisplayFilename || source.displayFilename || source.originalFilename || source.fileName;
      if (isPdfFile(source.mimeType, displayName)) {
        await openAuthenticatedPdfPreview(url);
      } else {
        await openAuthenticatedImagePreview(url);
      }
    } catch (error) {
      toast({
        title: "Unable to open artwork preview",
        description: error instanceof Error ? error.message : "Try again or confirm the artwork is available.",
        variant: "destructive",
      });
    } finally {
      setOpeningArtworkPreviewId((current) => current === sourceKey ? null : current);
    }
  };
  const selectableArtworkFiles = useMemo(
    () =>
      lineItemFiles.filter(
        (file): file is ProofAttachmentRow =>
          file.__source !== "asset" &&
          Boolean(file.id) &&
          ["artwork", "attachment", "reference"].includes(String(file.role || "").toLowerCase()),
      ),
    [lineItemFiles],
  );

  const selectableArtworkIdentitySet = useMemo(() => {
    const identities = new Set<string>();
    for (const file of selectableArtworkFiles) {
      const identity = getProofFileCanonicalIdentity(file);
      if (identity) identities.add(identity);
    }
    return identities;
  }, [selectableArtworkFiles]);

  const selectableProofFiles = useMemo(
    () =>
      lineItemFiles.filter(
        (file): file is ProofAttachmentRow => {
          if (file.__source === "asset" || !file.id || String(file.role || "").toLowerCase() !== "proof") return false;
          const identity = getProofFileCanonicalIdentity(file);
          return !identity || !selectableArtworkIdentitySet.has(identity);
        },
      ),
    [lineItemFiles, selectableArtworkIdentitySet],
  );

  const selectableDraftSourceFiles = useMemo(
    () => [...selectableProofFiles, ...selectableArtworkFiles],
    [selectableArtworkFiles, selectableProofFiles],
  );

  const displayedVersionId = getDisplayedProofVersionId({
    workspaceMode,
    activeProofId,
    selectedHistoryVersionId,
  });
  const displayedVersion = detail?.proofVersionHistory.find((version) => version.id === displayedVersionId) ?? null;
  const isHistoryPreview = workspaceMode === "history_preview";
  const displayedFile = displayedVersion
    ? lineItemFiles.find((file) => file.id === displayedVersion.proofFileId) ?? null
    : null;
  const currentSnapshot = detail?.currentProofInputSnapshot ?? null;
  const currentArtifact = workspaceMode === "active_proof" ? detail?.currentDisplayedProofArtifact ?? null : null;
  const rawPreviewUrl = getProofPreviewUrl(displayedFile);
  const previewUrl = staffPreviewBlobUrl || (rawPreviewUrl && !shouldFetchStaffPreviewAsBlob(rawPreviewUrl) ? rawPreviewUrl : null);
  const downloadUrl = getDownloadUrl(displayedFile);
  const previewName = displayedFile?.originalFilename || displayedFile?.fileName || "Proof";
  const previewIsPdf = Boolean(displayedFile && isPdfFile(displayedFile.mimeType || null, previewName));
  const previewIsImage = Boolean(displayedFile?.mimeType?.startsWith("image/"));
  const displayedFileForViewer = useMemo(
    () =>
      displayedFile
        ? {
            ...displayedFile,
            originalUrl: rawPreviewUrl ?? displayedFile.originalUrl ?? null,
            previewUrl: rawPreviewUrl ?? displayedFile.previewUrl ?? null,
            downloadUrl: downloadUrl ?? displayedFile.downloadUrl ?? null,
          }
        : null,
    [displayedFile, downloadUrl, rawPreviewUrl],
  );
  const staffStatus = getStaffFacingStatus({ row: activeRow ?? undefined, detail, displayedVersion, artifact: currentArtifact });
  const latestCustomerFeedback = detail?.proofDecisionHistory?.[0] ?? null;
  const statusNote = getStatusNote({ detail, displayedVersion });
  const [pdfViewerMode, setPdfViewerMode] = useState<"compact" | "default">("compact");
  const embeddedPdfUrl = useMemo(() => {
    if (!previewIsPdf || !previewUrl) return null;
    const url = getEmbeddedPdfUrl(previewUrl, pdfViewerMode === "compact");
    if (!url) return null;
    const separator = url.includes("#") ? "&" : "#";
    return `${url}${separator}zoom=${viewerZoom}`;
  }, [pdfViewerMode, previewIsPdf, previewUrl, viewerZoom]);
  const proofPdfPageCountLabel = previewIsPdf
    ? getProofPdfPageCountLabel({
        pageCount: viewerPageCount,
        isLoading: staffPreviewLoading,
        unavailable: Boolean(viewerPageCountError),
      })
    : null;
  const jobSpecificationRows = useMemo(() => getJobSpecificationRows(selectedLineItem, activeRow ?? undefined), [activeRow, selectedLineItem]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let pdfLoadingTask: any | null = null;
    let pdfDocument: any | null = null;

    setStaffPreviewBlobUrl(null);
    setStaffPreviewError(null);
    setStaffPreviewLoading(false);
    setViewerPageCount(0);
    setViewerPageCountError(null);

    if (!rawPreviewUrl || !shouldFetchStaffPreviewAsBlob(rawPreviewUrl)) {
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    setStaffPreviewLoading(true);

    void (async () => {
      try {
        const blob = await apiFetchBlob(rawPreviewUrl, { method: "GET", credentials: "include" });
        if (blob.type.includes("application/json")) {
          throw new Error("Preview route returned JSON instead of a proof file");
        }
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setStaffPreviewBlobUrl(objectUrl);

        if (previewIsPdf) {
          try {
            const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
            if (cancelled) return;
            pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
            pdfLoadingTask = pdfjs.getDocument({
              data: new Uint8Array(await blob.arrayBuffer()),
              cMapUrl: pdfCMapUrl,
              cMapPacked: true,
              standardFontDataUrl: pdfStandardFontDataUrl,
              useWorkerFetch: false,
              isEvalSupported: false,
              stopAtErrors: true,
            });
            pdfDocument = await pdfLoadingTask.promise;
            if (cancelled) {
              await pdfDocument.destroy();
              return;
            }
            const pageCount = Number(pdfDocument.numPages);
            if (!Number.isInteger(pageCount) || pageCount < 1) {
              throw new Error("The loaded proof PDF reported an invalid page count.");
            }
            setViewerPageCount(pageCount);
            console.info("[ProofViewer] pdf_page_count_loaded", {
              proofVersionId: displayedVersionId,
              proofFileId: displayedVersion?.proofFileId ?? null,
              pageCount,
            });
          } catch {
            if (cancelled) return;
            setViewerPageCountError("PDF page count unavailable");
            console.warn("[ProofViewer] pdf_page_count_unavailable", {
              proofVersionId: displayedVersionId,
              proofFileId: displayedVersion?.proofFileId ?? null,
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Preview failed to load";
        setStaffPreviewError(message);
      } finally {
        if (!cancelled) setStaffPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        pdfLoadingTask?.destroy?.();
      } catch {
        // Ignore cleanup errors from an obsolete PDF load.
      }
      if (pdfDocument) void pdfDocument.destroy().catch(() => undefined);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displayedVersion?.proofFileId, displayedVersionId, previewIsPdf, rawPreviewUrl]);

  useEffect(() => {
    if (!sendDialogOpen || !defaultProofRecipient || sendToEmail.trim()) return;
    setSendToName(defaultProofRecipient.name || "");
    setSendToEmail(defaultProofRecipient.email || "");
    setSendEmailSource("prefilled");
  }, [defaultProofRecipient, sendDialogOpen, sendToEmail]);
  const internalStaffNote = useMemo(() => {
    const candidates = [
      selectedOrder?.notesInternal,
      detail?.manualApprovalOverrideHistory?.[0]?.internalNote,
      statusNote,
    ];
    return candidates.find((value) => value && `${value}`.trim().length > 0) ?? null;
  }, [detail?.manualApprovalOverrideHistory, selectedOrder?.notesInternal, statusNote]);
  const canSendCurrentVersion = workspaceMode === "active_proof" && displayedVersion?.status === "draft";
  const currentProofIssue = getProofPreviewIssue({
    artifact: currentArtifact,
    sourceFileName: currentSnapshot?.sourceArtwork?.fileName ?? null,
  });
  const canSendDisplayedVersion = canSendCurrentVersion && currentArtifact?.previewStatus === "ready";
  const canResendDisplayedVersion = displayedVersion?.status === "awaiting_response" && currentArtifact?.previewStatus === "ready";
  const canCancelDisplayedVersion =
    displayedVersion?.id === detail?.currentActionableProofVersionId &&
    (displayedVersion?.status === "awaiting_response" || displayedVersion?.status === "draft");
  const canRecordDecision =
    displayedVersion?.id === detail?.currentActionableProofVersionId && displayedVersion?.status === "awaiting_response";
  const primaryActionLabel = getPrimaryActionLabel(canSendCurrentVersion, displayedVersion);
  const hasSourceArtwork = Boolean(currentSnapshot?.sourceArtwork);
  const selectedGeneratedArtworkCount = selectedArtworkSourceIds.filter((id) =>
    selectableGeneratedArtworkSources.some((source) => source.id === id),
  ).length;
  const hasEligibleArtwork = selectableGeneratedArtworkSources.length > 0;
  const hasBlockingSentProof = detail?.currentActionableProofVersion?.status === "awaiting_response";
  const generatedDraftDisabledReason = getGenerateProofDraftDisabledReason({
    hasEligibleArtwork: eligibleArtworkQuery.isLoading ? true : hasEligibleArtwork,
    hasBlockingSentProof,
    hasPermission: Boolean(selectedRow),
  });
  const effectiveGeneratedDraftDisabledReason =
    (eligibleArtworkQuery.isLoading ? "checking artwork files" : null) ||
    generatedDraftDisabledReason ||
    (selectableGeneratedArtworkSources.length > 0 && selectedGeneratedArtworkCount === 0 ? "select at least one artwork file" : null) ||
    (eligibleArtworkQuery.data?.data?.disabledReason ?? null);
  const uploadedDraftDisabledReason = (() => {
    if (!selectedRow) return "permission missing";
    if (hasBlockingSentProof) return "existing sent proof must be cancelled or revised first";
    if (!uploadFile && !selectedExistingAttachmentId) return "select artwork or proof file";
    return null;
  })();
  const canGeneratePreviewAction = canGeneratePreviewRecovery({
    hasSourceArtwork,
    previewStatus: currentArtifact?.previewStatus,
  });
  const previewRecoveryReady =
    previewRecoveryState?.lineItemId === selectedRow?.lineItemId &&
    previewRecoveryState?.derivativeStatus === "ready";
  const canRegenerateProofAction = canRegenerateGeneratedProof({
    artifactKind: currentArtifact?.artifactKind,
    hasSourceArtwork,
    previewStatus: currentArtifact?.previewStatus,
    previewRecoveryReady,
  });
  const requestedLineItemMissing = isRequestedProofingLineItemMissing({
    requestedLineItemId,
    errorStatus: (detailQuery.error as (Error & { status?: number }) | null)?.status ?? null,
  });
  const activityTimestamp = activeRow?.lastActivityAt ?? displayedVersion?.updatedAt ?? detail?.currentProofInputSnapshot?.snapshotBasisAt ?? null;
  const lineItemLabel = activeRow?.lineItemLabel ?? detail?.currentProofInputSnapshot?.lineItemLabel ?? "Proofing";
  const orderLabel = activeRow?.orderNumber ?? detail?.currentProofInputSnapshot?.orderNumber ?? activeOrderId;
  const packageLabel = activeRow?.packageLabel ?? null;
  const customerDisplayName = activeRow?.customerDisplayName ?? selectedOrder?.customer?.name ?? null;
  const queueBadgeClass = activeRow ? getQueueCardBadgeClass(activeRow) : "border border-slate-700 bg-slate-800 text-slate-300";

  const handleClearLineItemOverride = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lineItemId");
    nextParams.delete("slice");
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    setInternalNotesDraft(selectedOrder?.notesInternal || "");
    setInternalNotesDirty(false);
  }, [selectedOrder?.id, selectedOrder?.notesInternal]);

  useEffect(() => {
    setViewerZoom(previewIsPdf ? 85 : 100);
    setPreviewImageError(false);
  }, [previewIsPdf, rawPreviewUrl, displayedVersionId]);

  function openCreateProofDialog(mode: "generated" | "uploaded" = "generated", intent: "new_draft" | "revision" = "new_draft") {
    setSelectedHistoryVersionId(null);
    setWorkspaceMode("preparing");
    setVersionIdForSend(null);
    setCreateMode(mode);
    setProofCreationIntent(intent);
    setCreateDialogOpen(true);
  }

  useEffect(() => {
    if (!createDialogOpen) return;
    if (!selectedExistingAttachmentId && selectableDraftSourceFiles.length > 0) {
      const preferred = selectableDraftSourceFiles.find((file) => file.id === displayedFile?.id);
      setSelectedExistingAttachmentId(preferred?.id || selectableDraftSourceFiles[0]?.id || "");
    }
  }, [createDialogOpen, selectableDraftSourceFiles, selectedExistingAttachmentId, displayedFile?.id]);

  useEffect(() => {
    if (!activeLineItemId || artworkSelectionLineItemRef.current === activeLineItemId) return;
    const eligibleIds = selectableGeneratedArtworkSources.map((source) => source.id);
    if (eligibleIds.length === 0) return;
    artworkSelectionLineItemRef.current = activeLineItemId;
    setSelectedArtworkSourceIds(eligibleIds);
  }, [activeLineItemId, selectableGeneratedArtworkSources]);

  useEffect(() => {
    setPreviewRecoveryState((current) => {
      if (!selectedRow?.lineItemId) return null;
      return current?.lineItemId === selectedRow.lineItemId ? current : null;
    });
  }, [selectedRow?.lineItemId]);

  useEffect(() => {
    if (currentArtifact?.previewStatus !== "ready") return;
    setPreviewRecoveryState((current) => {
      if (!selectedRow?.lineItemId) return null;
      return current?.lineItemId === selectedRow.lineItemId ? null : current;
    });
  }, [currentArtifact?.previewStatus, selectedRow?.lineItemId]);

  async function refreshProofing(lineItemId?: string | null, orderId?: string | null) {
    await queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
    await queryClient.refetchQueries({ queryKey: ["/api/operational-summary"], type: "active" });
    if (lineItemId) {
      await queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId, "eligible-artwork"] });
      await queryClient.refetchQueries({ queryKey: ["/api/proofing/line-item", lineItemId], type: "active" });
      if (orderId) {
        await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "line-items", lineItemId, "files"] });
        await queryClient.refetchQueries({ queryKey: ["/api/orders", orderId, "line-items", lineItemId, "files"], type: "active" });
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

  function toggleBatchLineItem(row: ProofingQueueRow, checked: boolean) {
    const result = updateCombinedProofSelection({
      selectedIds: batchSelectedLineItemIds,
      selectedRows: batchSelectedRows,
      row,
      checked,
    });
    if (result.error) {
      toast({
        title: "Choose line items from one order",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    setBatchSelectedLineItemIds(result.selectedIds);
  }

  function selectAllForBatchJob() {
    const anchorRow = batchSelectedRows[0];
    if (!anchorRow) return;
    setBatchSelectedLineItemIds(selectAllCombinedProofLinesForOrder({
      selectedIds: batchSelectedLineItemIds,
      anchorRow,
      candidateRows: matchingJobSelectableRows,
    }));
  }

  const combinedReviewMutation = useMutation({
    mutationFn: () => readJson<JsonEnvelope<{ rows: Array<{ lineItemId: string; sources: EligibleProofArtworkSource[]; eligibleCount: number }> }>>(
      "/api/proofing/combined/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItemIds: batchSelectedRows.map((row) => row.lineItemId) }),
      },
    ),
    onSuccess: (result) => setCombinedProofReview(result.data.rows),
    onError: (error: Error) => {
      setCombinedProofReview([]);
      toast({ title: "Could not review proof package", description: error.message, variant: "destructive" });
    },
  });

  function openCombinedProofDialog() {
    if (!canCreateCombinedProof) return;
    setCombinedProofReview([]);
    setCreateInternalNotes("");
    setCombinedProofDialogOpen(true);
    combinedReviewMutation.mutate();
  }

  const createCombinedProofMutation = useMutation({
    mutationFn: () => readJson<JsonEnvelope<{
      proofVersion: ProofVersionHistoryEntry;
      proofing: ProofingReadModel;
      lineItems: Array<{ lineItemId: string; lineItemLabel: string; displaySizeLabel: string | null; quantity: number | null }>;
    }>>("/api/proofing/combined/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineItemIds: batchSelectedRows.map((row) => row.lineItemId),
        internalNotes: createInternalNotes.trim() || null,
      }),
    }),
    onSuccess: async (result) => {
      const primaryLineItemId = result.data.lineItems[0]?.lineItemId ?? batchSelectedRows[0]?.lineItemId;
      await Promise.all(batchSelectedRows.map(({ lineItemId }) =>
        queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId] }),
      ));
      await refreshProofing(primaryLineItemId, batchSelectionOrderId);
      setSelectedLineItemId(primaryLineItemId);
      setSelectedHistoryVersionId(null);
      setWorkspaceMode("active_proof");
      setCombinedProofDialogOpen(false);
      setCreateInternalNotes("");
      setBatchSelectedLineItemIds([]);
      setSendToEmail("");
      setSendToName("");
      setCustomerMessage("");
      setEmailSubject(`Combined Proof Ready for Review - Version ${result.data.proofVersion.versionNumber}`);
      setVersionIdForSend(result.data.proofVersion.id);
      setSendDialogMode("send");
      setSendDialogOpen(true);
      toast({ title: "Combined proof created", description: `${result.data.lineItems.length} line items are included in one proof package.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create combined proof", description: error.message, variant: "destructive" });
    },
  });

  const createDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow?.orderId || !selectedRow.lineItemId) {
        throw new Error("Select a proofing queue row first");
      }

      if (createMode === "generated") {
        // Generated mode: create draft only via the versions endpoint.
        // Staff must confirm recipient in the send dialog before the proof is dispatched.
        const result = await readJson<JsonEnvelope<{ proofVersion: ProofVersionHistoryEntry; proofing: ProofingReadModel }>>(
          `/api/proofing/line-item/${selectedRow.lineItemId}/versions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "generated",
              artworkSourceIds: selectedArtworkSourceIds,
              internalNotes: createInternalNotes.trim() || null,
            }),
          },
        );
        return { data: result.data, isDraft: true };
      }

      // Uploaded mode: create draft only, then show send dialog.
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
        throw new Error("Select or upload a proof file before creating draft");
      }

      const result = await readJson<JsonEnvelope<{ proofVersion: ProofVersionHistoryEntry; proofing: ProofingReadModel }>>(
        `/api/proofing/line-item/${selectedRow.lineItemId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: uploadFile ? "uploaded" : "existing_attachment",
            ...(uploadFile ? { proofFileId } : { attachmentId: proofFileId }),
            internalNotes: createInternalNotes.trim() || null,
          }),
        },
      );

      return { data: result.data, isDraft: true };
    },
    onSuccess: async ({ data, isDraft }) => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSelectedHistoryVersionId(null);
      setWorkspaceMode("active_proof");
      setCreateDialogOpen(false);
      setCreateMode("generated");
      setProofCreationIntent("new_draft");
      setSelectedExistingAttachmentId("");
      setSelectedArtworkSourceIds([]);
      setCreateInternalNotes("");
      setUploadFile(null);

      if (isDraft) {
        // Open send dialog — pre-fill recipient from most recent prior sent version if available.
        const prevSentVersion = data.proofing?.proofVersionHistory
          ?.slice()
          .reverse()
          .find((v) => v.id !== data.proofVersion.id && v.sentToEmail);
        const prevSentEmail = prevSentVersion?.sentToEmail ?? "";
        setSendToEmail(prevSentEmail);
        setSendToName(prevSentVersion?.sentToName ?? "");
        setSendEmailSource(prevSentEmail ? "prefilled" : "");
        setCustomerMessage("");
        setEmailSubject(`Proof Ready for Review - Version ${data.proofVersion.versionNumber}`);
        setVersionIdForSend(data.proofVersion.id);
        setSendDialogMode("send");
        setSendDialogOpen(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: createMode === "generated" ? "Failed to generate proof" : "Failed to create proof draft", description: error.message, variant: "destructive" });
    },
  });

  const generatePreviewMutation = useMutation({
    mutationFn: async (sourceId?: string) => {
      if (!selectedRow?.lineItemId) {
        throw new Error("Select a proofing queue row first");
      }

      return readJson<JsonEnvelope<{
        derivativeStatus: "ready" | "pending" | "failed";
        previewStatus: ProofArtifactPreviewStatus;
        sourceFileName: string;
        sourceType: "attachment" | "asset" | "line_item_file";
        sourceId: string;
        message: string;
      }>>(`/api/proofing/line-items/${selectedRow.lineItemId}/generate-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sourceId ? { sourceId } : {}),
      });
    },
    onSuccess: async (result) => {
      if (!selectedRow?.lineItemId) return;
      setPreviewRecoveryState({
        lineItemId: selectedRow.lineItemId,
        derivativeStatus: result.data.derivativeStatus,
      });
      await Promise.all([eligibleArtworkQuery.refetch(), filesQuery.refetch()]);
      toast({
        title: result.message || "Preview recovery updated",
        description: result.data.derivativeStatus === "ready"
          ? "A new artwork preview derivative is available for proof regeneration."
          : "Preview generation is still running. Refresh proofing in a moment to continue.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Preview generation failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!createDialogOpen || generatePreviewMutation.isPending) return;
    const queuedSource = eligibleArtworkSources.find((source) =>
      source.eligible && source.previewState === "queued" && !previewGenerationRequestedRef.current.has(source.id),
    );
    if (!queuedSource) return;

    previewGenerationRequestedRef.current.add(queuedSource.id);
    generatePreviewMutation.mutate(queuedSource.id);
  }, [createDialogOpen, eligibleArtworkSources, generatePreviewMutation]);

  const retryArtworkPreview = (sourceId: string) => {
    setFailedArtworkPreviewIds((current) => {
      const next = new Set(current);
      next.delete(sourceId);
      return next;
    });
    previewGenerationRequestedRef.current.delete(sourceId);
    generatePreviewMutation.mutate(sourceId);
  };

  const regenerateProofMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow?.lineItemId) {
        throw new Error("Select a proofing queue row first");
      }

      return readJson<JsonEnvelope<{ proofVersion: ProofVersionHistoryEntry; proofing: ProofingReadModel }>>(
        `/api/proofing/line-item/${selectedRow.lineItemId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "generated", internalNotes: null }),
        },
      );
    },
    onSuccess: async ({ data }) => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSelectedHistoryVersionId(null);
      setWorkspaceMode("active_proof");
      setPreviewRecoveryState(null);
      toast({ title: "Proof regenerated", description: "A new generated draft is ready for review and send." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to regenerate proof", description: error.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const targetId = versionIdForSend ?? displayedVersion?.id;
      if (!targetId) throw new Error("Select a draft proof version to send");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/versions/${targetId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentToName: sendToName.trim() || null,
          sentToEmail: sendToEmail.trim() || null,
          customerMessage: customerMessage.trim() || null,
          subject: emailSubject.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSendDialogOpen(false);
      setVersionIdForSend(null);
      setSendToName("");
      setSendToEmail("");
      setCustomerMessage("");
      setEmailSubject("");
      toast({ title: "Proof sent", description: "The selected proof version was sent for customer review." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send proof", description: error.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      if (!versionIdForSend) throw new Error("No proof version selected for resend");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/versions/${versionIdForSend}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentToName: sendToName.trim() || null,
          sentToEmail: sendToEmail.trim() || null,
          customerMessage: customerMessage.trim() || null,
          subject: emailSubject.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSendDialogOpen(false);
      setVersionIdForSend(null);
      setSendToName("");
      setSendToEmail("");
      setCustomerMessage("");
      setEmailSubject("");
      toast({ title: "Proof notification resent", description: "The customer will receive a fresh proof review link." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to resend proof", description: error.message, variant: "destructive" });
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
      // Manual override advances the job to its next stage (typically print production).
      // Invalidate production boards so the job appears immediately without waiting for polling.
      queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      setOverrideDialogOpen(false);
      setOverrideReason("");
      setOverrideNote("");
      toast({ title: "Manual override recorded", description: "The proof has been approved by manual override." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record manual override", description: error.message, variant: "destructive" });
    },
  });

  const bulkOverrideMutation = useMutation({
    mutationFn: async () => {
      if (batchSelectedRows.length === 0) throw new Error("Select at least one proof item to override");
      return readJson<JsonEnvelope<{ items: Array<{ lineItemId: string }> }>>("/api/proofing/line-items/manual-approval-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItemIds: batchSelectedRows.map((row) => row.lineItemId),
          overrideReason: overrideReason.trim(),
          internalNote: overrideNote.trim() || null,
        }),
      });
    },
    onSuccess: async (result) => {
      await Promise.all(result.data.items.map(({ lineItemId }) =>
        queryClient.invalidateQueries({ queryKey: ["/api/proofing/line-item", lineItemId] }),
      ));
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? batchSelectionOrderId);
      queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      setBulkOverrideDialogOpen(false);
      setOverrideReason("");
      setOverrideNote("");
      setBatchSelectedLineItemIds([]);
      toast({ title: "Selected proof items overridden", description: `${result.data.items.length} proof item${result.data.items.length === 1 ? " was" : "s were"} approved by manual override.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to override selected proof items", description: error.message, variant: "destructive" });
    },
  });

  const cancelProofMutation = useMutation({
    mutationFn: async () => {
      if (!displayedVersion?.id) throw new Error("Select an active sent proof version first");

      return readJson<JsonEnvelope<{
        proofId: string;
        versionId: string;
        status: ProofVersionStatus;
        proofing: ProofingReadModel;
      }>>(`/api/proofing/versions/${displayedVersion.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() || null }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      setSelectedHistoryVersionId(null);
      setWorkspaceMode("preparing");
      setPreviewImageError(false);
      setStaffPreviewBlobUrl(null);
      setStaffPreviewError(null);
      setPreviewRecoveryState(null);
      setVersionIdForSend(null);
      setSendDialogOpen(false);
      setCancelDialogOpen(false);
      setCancelReason("");
      toast({
        title: displayedVersion?.status === "draft" ? "Draft discarded" : "Proof cancelled",
        description: displayedVersion?.status === "draft"
          ? "The draft is no longer active. You can create a corrected proof draft now."
          : "The active customer proof link is no longer approvable. You can generate and send a corrected proof now.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel proof", description: error.message, variant: "destructive" });
    },
  });

  const proofNotRequiredMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow?.lineItemId) throw new Error("Select a queue row first");
      return readJson<JsonEnvelope<unknown>>(`/api/proofing/line-item/${selectedRow.lineItemId}/mark-proof-not-required`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: proofNotRequiredReason.trim(),
          internalNote: proofNotRequiredNote.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      await refreshProofing(selectedRow?.lineItemId, selectedRow?.orderId ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      setProofNotRequiredDialogOpen(false);
      setProofNotRequiredReason("");
      setProofNotRequiredNote("");
      toast({ title: "Proof gate removed", description: "The line item can continue without proof approval." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove proof gate", description: error.message, variant: "destructive" });
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
                  placeholder="Search by order #, customer, or product"
                  className="h-9 w-64 rounded-lg border-none bg-[#141824] pl-9 pr-4 text-sm text-white placeholder:text-slate-600 focus:ring-1 focus:ring-[#1337ec]"
                />
              </div>
              <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as ProofingSortValue)}>
                <SelectTrigger className="h-9 w-[190px] rounded-lg border-[#232948] bg-[#141824] text-sm text-white">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {proofingSortMeta.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-9 rounded-lg border-[#3b4660] bg-[#141824] px-4 text-sm font-bold text-white hover:bg-[#20263a]"
                onClick={openCombinedProofDialog}
                disabled={!canCreateCombinedProof}
              >
                Create Combined Proof{batchSelectedRows.length > 0 ? ` (${batchSelectedRows.length} lines)` : ""}
              </Button>
              {canOverride ? (
                <Button
                  variant="outline"
                  className="h-9 rounded-lg border-rose-500/60 bg-rose-500/10 px-4 text-sm font-bold text-rose-100 hover:bg-rose-500/20"
                  onClick={() => setBulkOverrideDialogOpen(true)}
                  disabled={batchSelectedRows.length === 0 || bulkOverrideMutation.isPending}
                >
                  {bulkOverrideMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                  Mark Selected Overridden{batchSelectedRows.length > 0 ? ` (${batchSelectedRows.length})` : ""}
                </Button>
              ) : null}
              <Button
                className="h-9 rounded-lg bg-[#1337ec] px-4 text-sm font-bold text-white transition-all hover:bg-[#1a43ff]"
                onClick={() => openCreateProofDialog("generated")}
                disabled={!selectedRow}
              >
                <Upload className="mr-2 h-4 w-4" />
                Create Proof Draft
              </Button>
            </div>
          </div>
        </header>

        {batchSelectionJobLabel ? (
          <CombinedProofSelectionBar
            selectedCount={batchSelectedRows.length}
            jobLabel={batchSelectionJobLabel}
            matchingCount={matchingJobSelectableRows.length}
            onSelectAll={selectAllForBatchJob}
            onClear={() => setBatchSelectedLineItemIds([])}
          />
        ) : null}

        <Tabs value={activeFilter} onValueChange={(value) => setActiveFilter(value as ProofingFilterValue)} className="shrink-0 bg-[#0B1120] px-6 border-b border-[#232948]">
          <TabsList className="h-auto w-full justify-start gap-6 rounded-none bg-transparent px-0 py-0">
            {proofingFilterMeta.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 shadow-none hover:text-white data-[state=active]:border-[#1337ec] data-[state=active]:bg-transparent data-[state=active]:text-white"
              >
                {tab.label} ({filterCounts[tab.value]})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLineItemOverrideActive ? (
          <div className="border-b border-[#232948] bg-[#1337ec]/10 px-6 py-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-[#1337ec]/30 bg-[#0B1120]/70 px-4 py-3 text-sm text-slate-100">
              <div>
                <p className="font-semibold">Showing result for selected line item</p>
                <p className="text-xs text-slate-400">Filters and search are temporarily overridden so this item stays visible.</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="border-[#3b4660] bg-transparent text-slate-100 hover:bg-[#141824]" onClick={handleClearLineItemOverride}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}

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
              ) : visibleQueueRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#232948] p-4 text-sm text-slate-500">
                  {requestedLineItemId && requestedLineItemMissing
                    ? PROOFING_MISSING_LINE_ITEM_MESSAGE
                    : "No proof items match your current filters"}
                </div>
              ) : (
                visibleQueueRows.map((row) => {
                  const isSelected = row.lineItemId === activeRow?.lineItemId;
                  const isBatchSelectable = isProofingSelectionSelectable(row);
                  const printJobId = row.activeOwnerJobId ?? row.productionJobId;
                  const dueDate = getProofingQueueDueDate(row.dueDate);
                  const dueDateClass = dueDate?.tone === "overdue"
                    ? "text-rose-300"
                    : dueDate?.tone === "today"
                      ? "text-amber-200"
                      : dueDate?.tone === "tomorrow"
                        ? "text-sky-200"
                        : "text-slate-300";
                  return (
                    <div
                      key={row.lineItemId}
                      onClick={() => setSelectedLineItemId(row.lineItemId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedLineItemId(row.lineItemId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`group w-full cursor-pointer rounded-lg p-3 text-left transition-all ${
                        isSelected
                          ? "border-2 border-[#1337ec] bg-[#1337ec]/10 shadow-[0_0_15px_rgba(19,55,236,0.15)]"
                          : "border border-[#232948] bg-[#141824]/40 hover:border-slate-600"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.lineItemLabel} for proof actions`}
                            checked={batchSelectedLineItemIds.includes(row.lineItemId)}
                            disabled={!isBatchSelectable}
                            title={isBatchSelectable ? "Select for combined proof or bulk override" : "This line is already approved"}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => toggleBatchLineItem(row, event.target.checked)}
                            className="h-4 w-4 rounded border-[#3b4660] bg-[#0B1120] text-[#1337ec]"
                          />
                          <span className={`text-[10px] font-mono ${isSelected ? "font-bold text-[#4b7bff]" : "text-slate-400"}`}>
                            {row.orderNumber ? `#${row.orderNumber}` : row.orderId}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${getQueueCardBadgeClass(row)}`}>
                            {getQueueCardBadgeLabel(row)}
                          </span>
                          <button
                            type="button"
                            className="rounded border border-slate-600 px-1.5 py-0.5 text-[9px] font-bold text-slate-200 hover:border-[#4b7bff] hover:text-white"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedLineItemId(row.lineItemId);
                            }}
                          >
                            OPEN
                          </button>
                        </div>
                      </div>
                      <h4 title={row.lineItemLabel} className="truncate text-xs font-bold text-white transition-colors group-hover:text-[#1337ec]">{row.lineItemLabel}</h4>
                      <p title={row.customerDisplayName || undefined} className="mt-1 truncate text-[10px] text-slate-400">{row.customerDisplayName || "No customer"}</p>
                      {row.jobLabel || row.poNumber ? (
                        <div className="mt-2 space-y-1 border-t border-[#232948] pt-2 text-[10px] text-slate-400">
                          {row.jobLabel ? <p title={row.jobLabel} className="truncate"><span className="text-slate-500">Job: </span>{row.jobLabel}</p> : null}
                          {row.poNumber ? <p title={row.poNumber} className="truncate"><span className="text-slate-500">PO: </span>{row.poNumber}</p> : null}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        {dueDate ? <span title={dueDate.title} className={`text-[9px] font-bold ${dueDateClass}`}>{dueDate.label}</span> : <span />}
                        <span className={`flex items-center gap-1 text-[10px] ${row.currentQueueStatus === "awaiting_approval" ? "text-amber-500/70" : row.currentQueueStatus === "revision_requested" || row.currentQueueStatus === "rejected" ? "font-bold text-rose-400" : "text-slate-500"}`}>
                          {row.currentQueueStatus === "awaiting_approval" ? <Eye className="h-3 w-3" /> : row.currentQueueStatus === "revision_requested" || row.currentQueueStatus === "rejected" ? <AlertCircle className="h-3 w-3" /> : null}
                          {formatRelativeTime(row.lastActivityAt)}
                        </span>
                      </div>
                      {printJobId ? (
                        <div
                          className="mt-2"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDownCapture={(event) => event.stopPropagation()}
                          onMouseDownCapture={(event) => event.stopPropagation()}
                        >
                          <PrintTicketActions
                            jobId={printJobId}
                            size="sm"
                            variant="outline"
                            className="flex flex-wrap"
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <section className="relative flex flex-1 flex-col overflow-hidden bg-[#0d1117]">
            {detailQuery.isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-14 w-full rounded-lg bg-[#141824]" />
                <Skeleton className="h-full min-h-[34rem] w-full rounded-lg bg-[#141824]" />
              </div>
            ) : requestedLineItemMissing ? (
              <div className="p-4">
                <div className="rounded-lg border border-dashed border-[#232948] bg-[#141824]/40 p-6 text-sm text-slate-300">
                  <p>{PROOFING_MISSING_LINE_ITEM_MESSAGE}</p>
                  <p className="mt-2 text-xs text-slate-500">Line item: {requestedLineItemId}</p>
                </div>
              </div>
            ) : detailQuery.error ? (
              <div className="p-4">
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
                  {(detailQuery.error as Error).message}
                </div>
              </div>
            ) : !activeLineItemId || !detail ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">Select a queue row to load proof detail.</div>
            ) : (
              <>
                <div className="z-10 flex items-center justify-between border-b border-[#232948] bg-[#0B1120]/60 p-3 backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="rounded-full bg-rose-500/20 px-3 py-1 text-[10px] font-bold tracking-wider text-rose-500">
                      {workspaceMode === "preparing" ? "Proof Preparation" : isHistoryPreview ? getHistoryPreviewLabel(displayedVersion?.status) : "Customer Visible Proof"}
                    </div>
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-tight text-white">{previewName}</h2>
                      {proofPdfPageCountLabel ? (
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-300">{proofPdfPageCountLabel}</p>
                      ) : null}
                      <p className="text-[9px] text-slate-500">
                        {displayedVersion?.sentAt ? `Sent ${formatTimestamp(displayedVersion.sentAt)}` : `Created ${formatTimestamp(displayedVersion?.createdAt)}`}
                        {activityTimestamp ? ` • Last activity ${formatRelativeTime(activityTimestamp)}` : ""}
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
                      {previewIsImage && (
                        <button
                          type="button"
                          className="rounded px-1.5 py-1 text-[10px] font-bold text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          onClick={() => setViewerZoom(100)}
                          disabled={!displayedFile}
                          title="Reset zoom to 100%"
                        >
                          100%
                        </button>
                      )}
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

                {currentProofIssue ? (
                  <div className="border-t border-[#232948] bg-amber-500/10 px-5 py-4 text-amber-100">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-1.5">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">{currentProofIssue.title}</p>
                        <p className="text-xs text-amber-50/90">{currentProofIssue.description}</p>
                        {currentProofIssue.sourceFileName ? (
                          <p className="text-[11px] text-amber-50/80">Source: {currentProofIssue.sourceFileName}</p>
                        ) : null}
                        <p className="text-[11px] font-medium text-amber-50">{currentProofIssue.nextAction}</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Proof render area — outer div scrolls when content overflows (zoom > fit).
                    No max-width cap here; the proof fills the available pane. */}
                <div className="flex flex-1 overflow-auto bg-[radial-gradient(circle_at_center,_#141824,_#0b0e14)]">
                  {!displayedVersion ? (
                    <div className="flex flex-1 items-start justify-center overflow-auto p-5 text-slate-200">
                      <div className="w-full max-w-5xl rounded-xl border border-[#2a3157] bg-slate-950/80 p-5 shadow-2xl">
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#232948] pb-4">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9baeff]">Artwork preparation</p>
                            <h2 className="mt-1 text-lg font-bold text-white">Select the artwork included in this proof package</h2>
                            <p className="mt-1 text-sm text-slate-400">Every checked eligible file will be embedded in the generated draft; nothing is silently omitted.</p>
                          </div>
                          <Button
                            className="bg-[#1337ec] font-bold text-white hover:bg-[#1a43ff]"
                            onClick={() => openCreateProofDialog("generated")}
                            disabled={!activeRow || Boolean(effectiveGeneratedDraftDisabledReason)}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            Create Proof Draft
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-lg border border-[#232948] bg-[#111622] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ordered quantity</p>
                            <p className="mt-1 text-lg font-bold text-white">{artworkSummary?.totalQuantity ?? "Not specified"}</p>
                          </div>
                          <div className="rounded-lg border border-[#232948] bg-[#111622] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Artwork files</p>
                            <p className="mt-1 text-lg font-bold text-white">{artworkSummary?.artworkCount ?? eligibleArtworkSources.length}</p>
                          </div>
                          <div className="rounded-lg border border-[#232948] bg-[#111622] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Allocation</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {artworkSummary?.allocationMode === "one_each_per_file"
                                ? "1 unit per artwork file"
                                : artworkSummary?.allocationMode === "same_quantity_each"
                                  ? "Full quantity on each artwork file"
                                  : "Needs staff confirmation"}
                            </p>
                          </div>
                        </div>

                        {artworkSummary?.allocationIssue ? (
                          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                            <p className="font-bold">Artwork allocation needs review</p>
                            <p className="mt-1 text-amber-100/90">{artworkSummary.allocationIssue}</p>
                          </div>
                        ) : null}

                        <div className="mt-4 space-y-3">
                          {eligibleArtworkQuery.isLoading ? (
                            <div className="rounded-lg border border-[#232948] p-5 text-sm text-slate-400">Loading attached artwork…</div>
                          ) : eligibleArtworkSources.length === 0 ? (
                            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-5 text-sm text-amber-100">
                              No artwork is available for this line item. Attach supported artwork before creating a proof draft.
                            </div>
                          ) : eligibleArtworkSources.map((source) => {
                            const displayName = source.computedDisplayFilename || source.displayFilename || source.originalFilename || source.fileName;
                            const previewUrl = getArtworkSourcePreviewUrl(source);
                            const thumbnailUrl = getArtworkSourceThumbnailUrl(source);
                            const sourceIsPdf = isPdfFile(source.mimeType, displayName);
                            const previewFailed = failedArtworkPreviewIds.has(source.id);
                            const selected = selectedArtworkSourceIds.includes(source.id);
                            const sourceKey = `${source.sourceType}:${source.id}`;
                            const openingPdfPreview = openingArtworkPreviewId === sourceKey;
                            return (
                              <div key={`${source.sourceType}:${source.id}`} className={`flex gap-3 rounded-lg border p-3 ${source.eligible ? "border-[#2a3157] bg-[#111622]" : "border-amber-400/30 bg-amber-500/5"}`}>
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-[#30385d] bg-slate-900">
                                  {sourceIsPdf && previewUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => void openArtworkPreview(source)}
                                      disabled={openingPdfPreview}
                                      title={`Open ${displayName}`}
                                      className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-slate-300 hover:bg-slate-800"
                                    >
                                      {openingPdfPreview ? <Loader2 className="h-6 w-6 animate-spin" /> : thumbnailUrl ? <img src={thumbnailUrl} alt={`Artwork preview for ${displayName}`} loading="lazy" className="h-full w-full object-cover" onError={() => setFailedArtworkPreviewIds((current) => new Set(current).add(source.id))} /> : <><FileText className="h-6 w-6" /><span>View PDF</span></>}
                                    </button>
                                  ) : previewUrl && !previewFailed ? (
                                    <button type="button" onClick={() => void openArtworkPreview(source)} title={`Open ${displayName}`} className="h-full w-full"><img src={previewUrl} alt={`Artwork preview for ${displayName}`} loading="lazy" className="h-full w-full object-cover" onError={() => setFailedArtworkPreviewIds((current) => new Set(current).add(source.id))} /></button>
                                  ) : source.previewStatus === "generation_failed" || previewFailed ? (
                                    <span className="px-2 text-center text-[10px] text-amber-200">Preview unavailable — retry below</span>
                                  ) : source.previewState === "queued" || source.previewState === "processing" ? (
                                    <span className="px-2 text-center text-[10px] text-slate-400">{artworkPreviewLabel(source.previewState, source.previewMessage)}</span>
                                  ) : (
                                    <FileImage className="h-7 w-7 text-slate-500" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="truncate font-semibold text-white">{displayName}</p>
                                      <p className="mt-0.5 text-xs text-slate-400">{source.mimeType || "Unknown file type"} · {source.side === "na" ? "Side not specified" : source.side}</p>
                                    </div>
                                    {source.eligible ? <Badge variant="outline" className="border-emerald-400/40 text-emerald-200">Eligible</Badge> : <Badge variant="outline" className="border-amber-400/40 text-amber-100">Needs attention</Badge>}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                    <label className={`inline-flex items-center gap-2 ${source.eligible ? "cursor-pointer text-slate-200" : "text-slate-500"}`}>
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        disabled={!source.eligible || createDraftMutation.isPending}
                                        onChange={(event) => setSelectedArtworkSourceIds((current) => event.target.checked ? Array.from(new Set([...current, source.id])) : current.filter((id) => id !== source.id))}
                                        className="h-4 w-4"
                                      />
                                      Include in proof package
                                    </label>
                                    <span className="text-slate-400">Allocation: {source.allocatedQuantity === null ? "Not specified" : `${source.allocatedQuantity} unit${source.allocatedQuantity === 1 ? "" : "s"}`}</span>
                                    {!source.eligible && source.eligibilityReason ? <span className="text-amber-200">{source.eligibilityReason}</span> : null}
                                    {source.previewState !== "available" ? <span className="text-amber-200">{artworkPreviewLabel(source.previewState, source.previewMessage)}</span> : null}
                                  </div>
                                  {source.previewRetryAllowed && source.recoveryAction === "generate_preview" ? (
                                    <Button type="button" variant="outline" size="sm" className="mt-2 border-amber-400/40 text-amber-100 hover:bg-amber-500/10" onClick={() => retryArtworkPreview(source.id)} disabled={generatePreviewMutation.isPending || !source.eligible}>
                                      {generatePreviewMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FileImage className="mr-2 h-3.5 w-3.5" />}
                                      Generate Preview
                                    </Button>
                                  ) : previewFailed ? (
                                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void retryArtworkPreview(source.id)}>
                                      Retry preview
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {effectiveGeneratedDraftDisabledReason ? <p className="mt-4 text-sm text-amber-200">Create Draft is disabled: {effectiveGeneratedDraftDisabledReason}.</p> : null}
                      </div>
                    </div>
                  ) : !displayedFile ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl bg-slate-900/60 py-14 text-center text-slate-500">
                        <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">Proof file not found</p>
                        <p className="mt-1 text-xs text-slate-500">The file linked to this version is not accessible.<br />Try regenerating the proof.</p>
                      </div>
                    </div>
                  ) : staffPreviewLoading ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl bg-slate-900/60 py-14 text-center text-slate-400">
                        <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin opacity-60" />
                        <p className="text-sm font-medium">Loading proof preview</p>
                        <p className="mt-1 text-xs text-slate-500">{previewName}</p>
                      </div>
                    </div>
                  ) : staffPreviewError ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl border border-rose-500/30 bg-rose-500/10 py-12 text-center text-rose-100">
                        <FileImage className="mx-auto mb-3 h-10 w-10 opacity-70" />
                        <p className="text-sm font-semibold">Preview failed to load</p>
                        <p className="mt-1 px-6 text-xs text-rose-100/80">{previewName}</p>
                        <p className="mt-1 px-6 text-[11px] text-rose-100/70">{staffPreviewError}</p>
                        {downloadUrl ? (
                          <button
                            type="button"
                            onClick={() => void downloadFileFromUrl(downloadUrl, previewName)}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-300/50 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-50 hover:bg-rose-900/60"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open / Download
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : previewIsPdf && embeddedPdfUrl ? (
                    /* PDF: fill 100% of the pane width; height driven by viewport. */
                    <div className="relative flex-1">
                      <iframe
                        title={previewName}
                        src={embeddedPdfUrl}
                        className="h-full w-full bg-white"
                        style={{ minHeight: "36rem" }}
                      />
                      {downloadUrl && (
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-md border border-slate-300 bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur-sm hover:bg-white"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open PDF
                        </a>
                      )}
                    </div>
                  ) : previewIsImage && previewUrl && !previewImageError ? (
                    /* Image: natural width is viewerZoom% of the pane; height auto.
                       At 100% the image fills the full pane width. Zoom > 100 overflows
                       horizontally so the outer div's overflow-auto allows panning. */
                    <div
                      ref={imagePanRef}
                      className="flex-1 overflow-auto p-4"
                      style={{
                        cursor: viewerZoom > 100 ? (isDragging ? "grabbing" : "grab") : "default",
                        userSelect: "none",
                      }}
                      onMouseDown={(e) => {
                        if (viewerZoom <= 100 || !imagePanRef.current) return;
                        e.preventDefault();
                        dragRef.current = {
                          startX: e.clientX,
                          startY: e.clientY,
                          scrollLeft: imagePanRef.current.scrollLeft,
                          scrollTop: imagePanRef.current.scrollTop,
                        };
                        setIsDragging(true);
                      }}
                      onMouseMove={(e) => {
                        if (!isDragging || !dragRef.current || !imagePanRef.current) return;
                        const dx = e.clientX - dragRef.current.startX;
                        const dy = e.clientY - dragRef.current.startY;
                        imagePanRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
                        imagePanRef.current.scrollTop = dragRef.current.scrollTop - dy;
                      }}
                      onMouseUp={() => { setIsDragging(false); dragRef.current = null; }}
                      onMouseLeave={() => { setIsDragging(false); dragRef.current = null; }}
                    >
                      <img
                        src={previewUrl}
                        alt={previewName}
                        className="block h-auto max-w-none shadow-2xl"
                        style={{ width: `${viewerZoom}%`, pointerEvents: isDragging ? "none" : "auto" }}
                        draggable={false}
                        onError={() => setPreviewImageError(true)}
                      />
                    </div>
                  ) : previewIsImage && previewImageError ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl border border-rose-500/30 bg-rose-500/10 py-12 text-center text-rose-100">
                        <FileImage className="mx-auto mb-3 h-10 w-10 opacity-70" />
                        <p className="text-sm font-semibold">Preview failed to load</p>
                        <p className="mt-1 px-6 text-xs text-rose-100/80">{previewName}</p>
                        {downloadUrl ? (
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-300/50 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-50 hover:bg-rose-900/60"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open file
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : previewUrl ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl bg-slate-900/60 py-14 text-center text-slate-500">
                        <FileImage className="mx-auto mb-3 h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">Preview not available inline</p>
                        <p className="mt-1 text-xs text-slate-500">This file type cannot be displayed in the browser.</p>
                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open / Download
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="w-full max-w-sm rounded-xl bg-slate-900/60 py-14 text-center text-slate-500">
                        <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">Preview not available</p>
                        <p className="mt-1 text-xs text-slate-500">No preview URL could be resolved for this proof file.</p>
                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open / Download
                          </a>
                        )}
                      </div>
                    </div>
                  )}
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
                          Order {orderLabel ? `#${orderLabel}` : activeOrderId}
                        </span>
                        <div className="flex gap-2">
                          {displayedVersion ? <span className="rounded-md border border-[#232948] bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-400">v{displayedVersion.versionNumber}</span> : null}
                          <span className={`rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight ${queueBadgeClass}`}>
                            {staffStatus.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-tight text-white">{lineItemLabel}</h2>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{packageLabel || "No package linked"}</p>
                  {customerDisplayName ? <p className="mt-2 text-sm text-slate-300">{customerDisplayName}</p> : null}
                </>
              ) : (
                <div className="text-sm text-slate-500">No line item selected.</div>
              )}
            </div>

            <div className="space-y-0">
              <div className="space-y-4 border-b border-[#232948] p-6">
                <div>
                  {isHistoryPreview ? (
                    <div className="space-y-2">
                      <Button
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1337ec] text-sm font-bold text-white shadow-lg shadow-[#1337ec]/20 transition-all hover:bg-[#1a43ff]"
                        onClick={() => {
                          setSelectedHistoryVersionId(null);
                          setWorkspaceMode(getCanonicalProofWorkspaceMode(activeProofId));
                        }}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        {activeProofId ? "Back to Active Proof" : "Back to Proof Setup"}
                      </Button>
                      {(displayedVersion?.status === "rejected" || displayedVersion?.status === "revision_requested") ? (
                        <Button
                          variant="outline"
                          className="h-10 w-full rounded-xl border-[#232948] bg-transparent text-[10px] font-bold uppercase tracking-wider text-slate-200 transition-all hover:bg-slate-800"
                          onClick={() => openCreateProofDialog("generated", "revision")}
                          disabled={Boolean(hasBlockingSentProof)}
                        >
                          Create New Revision
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                  <Button
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1337ec] text-sm font-bold text-white shadow-lg shadow-[#1337ec]/20 transition-all hover:bg-[#1a43ff]"
                    onClick={() => {
                      if (canSendCurrentVersion) {
                        const prefill = displayedVersion?.sentToEmail ?? "";
                        setSendToEmail(prefill);
                        setSendToName(displayedVersion?.sentToName ?? "");
                        setSendEmailSource(prefill ? "prefilled" : "");
                        setCustomerMessage("");
                        setEmailSubject(`Proof Ready for Review - Version ${displayedVersion?.versionNumber ?? ""}`);
                        setVersionIdForSend(displayedVersion?.id ?? null);
                        setSendDialogMode("send");
                        setSendDialogOpen(true);
                      } else {
                        openCreateProofDialog("generated");
                      }
                    }}
                    disabled={!activeRow || (canSendCurrentVersion && !canSendDisplayedVersion)}
                  >
                    {canSendCurrentVersion ? <Send className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                    {primaryActionLabel}
                  </Button>
                  )}
                  {canSendCurrentVersion && currentProofIssue ? (
                    <p className="mt-3 text-center text-[10px] text-amber-300">
                      This proof does not include an artwork preview and cannot be sent to the customer.
                    </p>
                  ) : null}
                  {!canSendCurrentVersion && generatedDraftDisabledReason ? (
                    <p className="mt-3 text-center text-[10px] text-slate-400">
                      Draft generation: {generatedDraftDisabledReason}.
                    </p>
                  ) : null}
                  {canGeneratePreviewAction || canRegenerateProofAction ? (
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      {canGeneratePreviewAction ? (
                        <Button
                          variant="outline"
                          className="h-10 rounded-xl border-amber-400/40 bg-amber-500/10 text-[10px] font-bold uppercase tracking-wider text-amber-100 transition-all hover:bg-amber-500/15"
                          onClick={() => generatePreviewMutation.mutate(undefined)}
                          disabled={generatePreviewMutation.isPending || regenerateProofMutation.isPending || !selectedRow?.lineItemId}
                        >
                          {generatePreviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileImage className="mr-2 h-4 w-4" />}
                          {generatePreviewMutation.isPending ? "Generating Preview" : "Generate Preview"}
                        </Button>
                      ) : null}
                      {canRegenerateProofAction ? (
                        <Button
                          variant="outline"
                          className="h-10 rounded-xl border-[#1337ec]/50 bg-[#1337ec]/10 text-[10px] font-bold uppercase tracking-wider text-[#b9c7ff] transition-all hover:bg-[#1337ec]/15"
                          onClick={() => regenerateProofMutation.mutate()}
                          disabled={regenerateProofMutation.isPending || generatePreviewMutation.isPending || !selectedRow?.lineItemId}
                        >
                          {regenerateProofMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          {regenerateProofMutation.isPending ? "Regenerating Proof" : "Regenerate Proof"}
                        </Button>
                      ) : null}
                      {previewRecoveryState?.lineItemId === selectedRow?.lineItemId ? (
                        <p className="text-center text-[10px] text-slate-400">
                          {previewRecoveryState?.derivativeStatus === "ready"
                            ? "Preview derivative is ready. Regenerate the proof draft to embed it."
                            : "Preview generation is still running. Refresh proofing in a moment to continue."}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {canCancelDisplayedVersion ? (
                    <Button
                      variant="outline"
                      className="mt-3 h-10 w-full rounded-xl border-rose-500/40 bg-rose-500/10 text-[10px] font-bold uppercase tracking-wider text-rose-100 transition-all hover:bg-rose-500/15"
                      onClick={() => setCancelDialogOpen(true)}
                      disabled={cancelProofMutation.isPending}
                    >
                      {displayedVersion?.status === "draft" ? "Discard Draft" : "Cancel Sent Proof"}
                    </Button>
                  ) : null}
                  {detail && workspaceMode === "active_proof" && !canSendCurrentVersion ? (
                    <Button
                      variant="outline"
                      className="mt-3 h-10 w-full rounded-xl border-[#232948] bg-transparent text-[10px] font-bold uppercase tracking-wider text-slate-200 transition-all hover:bg-slate-800"
                      onClick={() => openCreateProofDialog("generated")}
                      disabled={Boolean(hasBlockingSentProof)}
                    >
                      Create New Revision
                    </Button>
                  ) : null}
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
                <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Proof Basis</h4>
                {!currentSnapshot ? (
                  <div className="text-sm text-slate-500">No persisted proof snapshot is available yet.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Artifact</p>
                      <p className="text-xs font-bold text-slate-200">{currentArtifact ? currentArtifact.artifactKind.replace(/_/g, " ") : "Pending"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Preview Status</p>
                      <p className="text-xs font-bold text-slate-200">{currentArtifact ? currentArtifact.previewStatus.replace(/_/g, " ") : "Pending"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Preflight</p>
                      <p className="text-xs font-bold text-slate-200">{currentSnapshot.preflightStatus.replace(/_/g, " ")}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Source</p>
                      <p className="text-xs font-bold text-slate-200">{currentSnapshot.sourceArtwork?.fileName || "No saved artwork"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Finished Size</p>
                      <p className="text-xs font-bold text-slate-200">{currentSnapshot.displaySizeLabel || "Not specified"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Quantity</p>
                      <p className="text-xs font-bold text-slate-200">{currentSnapshot.quantity ?? "Not specified"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Snapshot Basis</p>
                      <p className="text-xs font-bold text-slate-200">{formatTimestamp(currentSnapshot.snapshotBasisAt)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[9px] font-bold uppercase text-slate-500">Finishing Facts</p>
                      <p className="text-xs font-bold text-slate-200">
                        {currentSnapshot.finishingSummary.length > 0
                          ? currentSnapshot.finishingSummary.join(" • ")
                          : "No finishing details are captured in persisted line-item data."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {currentSnapshot && (() => {
                const optMap = currentSnapshot.selectedOptionMap;
                const contourCut = getSnapshotOption(optMap, "Contour Cut", "Contour", "ContourCut", "Contour-Cut");
                const doubleSided = getSnapshotOption(optMap, "Double Sided", "Double-Sided", "Two Sided", "2 Sided", "Sides", "Print Sides");
                const media = getSnapshotOption(optMap, "Material", "Media", "Substrate", "Vinyl", "Material Type", "Fabric");
                const knownKeys = new Set(
                  [contourCut && "contour", doubleSided && "double", media && "material"]
                    .filter(Boolean)
                );
                // Options not already surfaced as named fields — show as overflow pills
                const otherOptions = Object.entries(optMap ?? {}).filter(([k]) => {
                  const l = k.toLowerCase();
                  return !knownKeys.has("contour") || !l.includes("contour")
                    ? !knownKeys.has("double") || !l.includes("sided")
                      ? !knownKeys.has("material") || !(l.includes("material") || l.includes("media") || l.includes("substrate") || l.includes("vinyl"))
                      : true
                    : true;
                }).filter(([k]) => {
                  const l = k.toLowerCase();
                  if (contourCut && l.includes("contour")) return false;
                  if (doubleSided && (l.includes("sided") || l.includes("sides") || l === "double sided" || l === "two sided")) return false;
                  if (media && (l.includes("material") || l.includes("media") || l.includes("substrate") || l.includes("vinyl"))) return false;
                  return true;
                });

                return (
                  <div className="border-b border-[#232948] p-6">
                    <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Proof Specs</h4>
                    <div className="space-y-3">

                      {/* Size comparison */}
                      <div className="rounded-lg border border-[#232948] bg-[#0F1524] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[9px] font-bold uppercase text-slate-500">Size Check</p>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">Artwork size not stored</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="mb-0.5 text-[9px] text-slate-500">Ordered</p>
                            <p className="text-xs font-bold text-slate-200">{currentSnapshot.displaySizeLabel || "Not specified"}</p>
                          </div>
                          <div>
                            <p className="mb-0.5 text-[9px] text-slate-500">Detected</p>
                            <p className="text-xs font-medium italic text-slate-600">Unavailable</p>
                          </div>
                        </div>
                      </div>

                      {/* Quantity + key options */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-500">Quantity</p>
                          <p className="text-xs font-bold text-slate-200">{currentSnapshot.quantity ?? "—"}</p>
                        </div>
                        {contourCut ? (
                          <div>
                            <p className="text-[9px] font-bold uppercase text-slate-500">Contour Cut</p>
                            <p className={`text-xs font-bold ${contourCut.toLowerCase() === "yes" ? "text-amber-400" : "text-slate-200"}`}>{contourCut}</p>
                          </div>
                        ) : null}
                        {doubleSided ? (
                          <div>
                            <p className="text-[9px] font-bold uppercase text-slate-500">Double Sided</p>
                            <p className="text-xs font-bold text-slate-200">{doubleSided}</p>
                          </div>
                        ) : null}
                        {media ? (
                          <div className={!contourCut && !doubleSided ? "col-span-2" : ""}>
                            <p className="text-[9px] font-bold uppercase text-slate-500">Media</p>
                            <p className="text-xs font-bold text-slate-200">{media}</p>
                          </div>
                        ) : null}
                      </div>

                      {/* Remaining options as pills */}
                      {otherOptions.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-[9px] font-bold uppercase text-slate-500">Other Options</p>
                          <div className="flex flex-wrap gap-1.5">
                            {otherOptions.map(([k, v]) => (
                              <span key={k} className="rounded border border-[#232948] bg-[#0F1524] px-2 py-0.5 text-[9px] text-slate-300">
                                {k}: {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                    </div>
                  </div>
                );
              })()}

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
                    className="h-10 w-full rounded-xl border-rose-500/60 bg-rose-500/10 text-[10px] font-bold uppercase tracking-wider text-rose-100 transition-all hover:bg-rose-500/20"
                    onClick={() => setOverrideDialogOpen(true)}
                    disabled={!detail || detail.approvedProofSource === "manual_override"}
                  >
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    Manual Override
                  </Button>
                  <Button
                    variant="outline"
                    className="mt-2 h-10 w-full rounded-xl border-rose-500/60 bg-rose-500/10 text-[10px] font-bold uppercase tracking-wider text-rose-100 transition-all hover:bg-rose-500/20"
                    onClick={() => setProofNotRequiredDialogOpen(true)}
                    disabled={!detail}
                  >
                    Remove Proof Gate
                  </Button>
                </div>
              ) : null}

              <div ref={versionHistoryRef} className="p-6">
                <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Version History</h4>
                {detail ? (
                  <ScrollArea className="max-h-[26rem] pr-3">
                    <div className="space-y-3">
                      {detail.proofVersionHistory.map((version) => {
                        const isSelected = version.id === displayedVersionId;
                        const isDraftVersion = version.status === "draft";
                        const isAwaitingResponse = version.status === "awaiting_response";
                        return (
                          <div key={version.id} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedHistoryVersionId(version.id);
                                setWorkspaceMode("history_preview");
                              }}
                              className={`w-full rounded-lg border p-3 text-left transition-all ${isSelected ? "border-[#1337ec] bg-[#1337ec]/10" : "border-[#232948] bg-[#141824]/40 hover:border-slate-600"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-white">Version {version.versionNumber}</p>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${getVersionStatusBadgeClass(version.status)}`}>
                                  {getVersionStatusLabel(version.status)}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">Created {formatTimestamp(version.createdAt)}</p>
                              {version.sentAt ? (
                                <p className="mt-0.5 text-[11px] text-slate-500">Sent {formatTimestamp(version.sentAt)}</p>
                              ) : null}
                              {version.sentToEmail ? (
                                <p className="mt-0.5 text-[11px] text-slate-400">To: {version.sentToEmail}</p>
                              ) : null}
                            </button>
                            {isDraftVersion && version.id === activeProofId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedHistoryVersionId(null);
                                  setWorkspaceMode("active_proof");
                                  const prefill = version.sentToEmail ?? "";
                                  setSendToEmail(prefill);
                                  setSendToName(version.sentToName ?? "");
                                  setSendEmailSource(prefill ? "prefilled" : "");
                                  setCustomerMessage("");
                                  setEmailSubject(`Proof Ready for Review - Version ${version.versionNumber}`);
                                  setVersionIdForSend(version.id);
                                  setSendDialogMode("send");
                                  setSendDialogOpen(true);
                                }}
                                className="w-full rounded-lg border border-[#232948] bg-[#141824]/40 px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#1337ec] transition-all hover:border-[#1337ec] hover:bg-[#1337ec]/10"
                              >
                                <Send className="mr-1.5 inline h-3 w-3" />
                                Send this draft
                              </button>
                            ) : null}
                            {isAwaitingResponse && version.id === activeProofId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedHistoryVersionId(null);
                                  setWorkspaceMode("active_proof");
                                  const prefill = version.sentToEmail ?? "";
                                  setSendToEmail(prefill);
                                  setSendToName(version.sentToName ?? "");
                                  setSendEmailSource(prefill ? "prefilled" : "");
                                  setCustomerMessage("");
                                  setEmailSubject(`Proof Ready for Review - Version ${version.versionNumber}`);
                                  setVersionIdForSend(version.id);
                                  setSendDialogMode("resend");
                                  setSendDialogOpen(true);
                                }}
                                className="w-full rounded-lg border border-[#232948] bg-[#141824]/40 px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-amber-400 transition-all hover:border-amber-500 hover:bg-amber-500/10"
                              >
                                <Send className="mr-1.5 inline h-3 w-3" />
                                Resend notification
                              </button>
                            ) : null}
                          </div>
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

      <AttachmentViewerDialog attachment={displayedFileForViewer as any} open={viewerOpen} onOpenChange={setViewerOpen} />

      <Dialog open={combinedProofDialogOpen} onOpenChange={setCombinedProofDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Combined Proof</DialogTitle>
            <DialogDescription>
              Review the selected line items and artwork. One multi-page proof package and one customer approval link will cover every listed line.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[26rem] rounded-lg border p-3">
            <div className="space-y-3">
              {batchSelectedRows.map((row, index) => {
                const review = combinedProofReview.find((item) => item.lineItemId === row.lineItemId);
                const eligibleSources = review?.sources.filter((source) => source.eligible) ?? [];
                return (
                  <div key={row.lineItemId} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{index + 1}. {row.lineItemLabel}</p>
                        <p className="text-xs text-muted-foreground">{row.packageLabel || row.orderNumber || row.orderId}</p>
                      </div>
                      <Badge variant={review && eligibleSources.length === 0 ? "destructive" : "outline"}>
                        {review ? `${eligibleSources.length} artwork file${eligibleSources.length === 1 ? "" : "s"}` : "Checking artwork"}
                      </Badge>
                    </div>
                    {eligibleSources.length > 0 ? (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {eligibleSources.map((source) => (
                          <p key={`${source.sourceType}:${source.id}`} className="truncate">
                            {source.computedDisplayFilename || source.displayFilename || source.originalFilename || source.fileName}
                          </p>
                        ))}
                      </div>
                    ) : review ? (
                      <p className="mt-2 text-xs font-medium text-destructive">Artwork is required before this line can be included.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="grid gap-2">
            <Label htmlFor="combined-proof-notes">Internal notes</Label>
            <Textarea
              id="combined-proof-notes"
              rows={3}
              value={createInternalNotes}
              onChange={(event) => setCreateInternalNotes(event.target.value)}
              placeholder="Optional notes for the proof package"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCombinedProofDialogOpen(false)} disabled={createCombinedProofMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createCombinedProofMutation.mutate()}
              disabled={createCombinedProofMutation.isPending || !combinedProofReviewIsReady({
                selectedCount: batchSelectedRows.length,
                reviewRows: combinedProofReview,
                loading: combinedReviewMutation.isPending,
              })}
            >
              {createCombinedProofMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Create Proof Package
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOverrideDialogOpen} onOpenChange={setBulkOverrideDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mark Selected Proof Items Overridden</DialogTitle>
            <DialogDescription>
              This approves {batchSelectedRows.length} selected proof item{batchSelectedRows.length === 1 ? "" : "s"} using the same manual override rules as an individual override. If any selected item is ineligible, none will be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bulk-proof-override-reason">Override reason</Label>
              <Input id="bulk-proof-override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Why are these proofs being approved manually?" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-proof-override-note">Internal note</Label>
              <Textarea id="bulk-proof-override-note" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} placeholder="Optional internal note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOverrideDialogOpen(false)} disabled={bulkOverrideMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => bulkOverrideMutation.mutate()} disabled={bulkOverrideMutation.isPending || !overrideReason.trim() || batchSelectedRows.length === 0}>
              {bulkOverrideMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
              Mark Selected Overridden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={(open) => {
        setCreateDialogOpen(open);
        if (!open) previewGenerationRequestedRef.current.clear();
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{proofCreationIntent === "revision" ? "Create New Proof Revision" : "Create Artwork Proof Draft"}</DialogTitle>
            <DialogDescription>
              {proofCreationIntent === "revision"
                ? `Create a new draft revision from the current proof setup${displayedVersion ? ` after Version ${displayedVersion.versionNumber}` : ""}. The prior version remains historical.`
                : "Review exactly which artwork is included, then create a draft. You will confirm the recipient before it is sent."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={createMode === "generated" ? "default" : "outline"}
                onClick={() => setCreateMode("generated")}
                disabled={createDraftMutation.isPending}
              >
                Artwork Proof Package
              </Button>
              <Button
                type="button"
                variant={createMode === "uploaded" ? "default" : "outline"}
                onClick={() => setCreateMode("uploaded")}
                disabled={createDraftMutation.isPending}
              >
                Manual Proof File
              </Button>
            </div>

            {createMode === "generated" ? (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">The selected artwork becomes one proof package.</p>
                <p className="mt-2">The draft uses saved line-item data and every selected eligible artwork file, then renders one proof PDF artifact. You will confirm the recipient before it is sent.</p>
                <p className="mt-2 font-medium text-foreground">
                  {selectableGeneratedArtworkSources.length > 0
                    ? `Eligible artwork: ${selectableGeneratedArtworkSources.length} file${selectableGeneratedArtworkSources.length === 1 ? "" : "s"} found`
                    : eligibleArtworkQuery.isLoading
                      ? "Checking eligible artwork files..."
                      : "No eligible artwork files found for this line item"}
                </p>
                {eligibleArtworkSources.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {eligibleArtworkSources.map((source) => {
                      const isSelected = selectedArtworkSourceIds.includes(source.id);
                      const displayName = source.computedDisplayFilename || source.displayFilename || source.originalFilename || source.fileName;
                      const previewUrl = getArtworkSourcePreviewUrl(source);
                      const thumbnailUrl = getArtworkSourceThumbnailUrl(source);
                      const sourceIsPdf = isPdfFile(source.mimeType, displayName);
                      const previewFailed = failedArtworkPreviewIds.has(source.id);
                      return (
                        <label
                          key={`${source.sourceType}:${source.id}`}
                          className={`flex items-center gap-3 rounded-md border p-3 ${source.eligible ? "cursor-pointer" : "opacity-60"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!source.eligible || createDraftMutation.isPending}
                            onChange={(event) => {
                              setSelectedArtworkSourceIds((current) =>
                                event.target.checked
                                  ? Array.from(new Set([...current, source.id]))
                                  : current.filter((id) => id !== source.id),
                              );
                            }}
                            className="h-4 w-4"
                          />
                          {sourceIsPdf && previewUrl ? (
                            <button
                              type="button"
                              title={`Open ${displayName}`}
                              onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openArtworkPreview(source); }}
                              className="flex h-10 w-10 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
                            >
                              {thumbnailUrl ? <img src={thumbnailUrl} alt={`Artwork preview for ${displayName}`} loading="lazy" className="h-full w-full rounded object-cover" onError={() => setFailedArtworkPreviewIds((current) => new Set(current).add(source.id))} /> : <FileText className="h-4 w-4" />}
                            </button>
                          ) : previewUrl && !previewFailed ? (
                            <button type="button" title={`Open ${displayName}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openArtworkPreview(source); }} className="h-10 w-10 rounded border"><img src={previewUrl} alt={`Artwork preview for ${displayName}`} loading="lazy" className="h-full w-full rounded object-cover" onError={() => setFailedArtworkPreviewIds((current) => new Set(current).add(source.id))} /></button>
                          ) : previewFailed || source.previewRetryAllowed ? (
                            <Button type="button" variant="outline" size="sm" className="h-10 px-2 text-[10px]" disabled={generatePreviewMutation.isPending} onClick={(event) => { event.preventDefault(); event.stopPropagation(); retryArtworkPreview(source.id); }}>Retry preview</Button>
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded border px-1 text-center text-[9px] text-muted-foreground">{artworkPreviewLabel(source.previewState, source.previewMessage)}</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-foreground">{displayName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {source.mimeType || "unknown type"} / {source.sourceType.replace(/_/g, " ")} / allocation: {source.allocatedQuantity ?? "not specified"}
                              {!source.eligible && source.eligibilityReason ? ` / ${source.eligibilityReason}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {effectiveGeneratedDraftDisabledReason ? (
                  <p className="mt-2 font-medium text-amber-600">Disabled: {effectiveGeneratedDraftDisabledReason}.</p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="proof-upload-file">Upload new proof file</Label>
                  <Input
                    id="proof-upload-file"
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                  />
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <p>If you upload a file here, it will be attached as the proof artifact. You will confirm the recipient before it is sent.</p>
                    {uploadFile ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setUploadFile(null)}>
                        <Trash2 className="mr-1 h-3 w-3" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  {uploadFile ? <p className="text-xs font-medium text-foreground">Selected upload: {uploadFile.name}</p> : null}
                </div>

                <div className="grid gap-2">
                  <Label>Select existing proof file or original artwork</Label>
                  <ScrollArea className="h-56 rounded-lg border p-3">
                    <div className="space-y-2">
                      {selectableDraftSourceFiles.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No eligible artwork or proof files are available yet.</div>
                      ) : (
                        selectableDraftSourceFiles.map((file, fileIndex) => {
                          const isSelected = selectedExistingAttachmentId === file.id;
                          const isFirstProofFile = fileIndex === 0 && selectableProofFiles.length > 0;
                          const isFirstArtworkFile = fileIndex === selectableProofFiles.length && selectableArtworkFiles.length > 0;
                          return (
                            <Fragment key={file.id}>
                              {isFirstProofFile ? (
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Proof Files</p>
                              ) : null}
                              {isFirstArtworkFile ? (
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Original Artwork</p>
                              ) : null}
                              <button
                              type="button"
                              disabled={Boolean(uploadFile)}
                              onClick={() => setSelectedExistingAttachmentId(file.id)}
                              className={`w-full rounded-lg border p-3 text-left ${isSelected ? "border-primary bg-primary/5" : "border-border"}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">{getProofFileDisplayName(file)}</p>
                                  <p className="text-xs text-muted-foreground">{file.role || "file"} • {formatTimestamp(file.createdAt)}</p>
                                </div>
                                <Badge variant="outline">{String(file.role || "").toLowerCase() === "proof" ? "proof" : "original"}</Badge>
                              </div>
                              </button>
                            </Fragment>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                  {uploadFile ? <p className="text-xs text-muted-foreground">Uploaded file will be used instead of an existing proof attachment.</p> : null}
                  {uploadedDraftDisabledReason ? (
                    <p className="text-xs text-amber-600">Disabled: {uploadedDraftDisabledReason}.</p>
                  ) : null}
                </div>
              </>
            )}

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
              disabled={
                createDraftMutation.isPending ||
                (createMode === "uploaded" && Boolean(uploadedDraftDisabledReason)) ||
                (createMode === "generated" && Boolean(effectiveGeneratedDraftDisabledReason))
              }
            >
              {createDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {createMode === "generated" ? "Generate Draft" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendDialogOpen} onOpenChange={(open) => {
        if (!open) { setVersionIdForSend(null); setSendDialogMode("send"); setEmailSubject(""); }
        setSendDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {sendDialogMode === "resend" ? "Resend Proof Notification" : "Send Proof for Review"}
            </DialogTitle>
            <DialogDescription>
              {sendDialogMode === "resend"
                ? "Send a fresh review link to the customer. The existing proof version stays unchanged — only the notification email is resent."
                : "Confirm the proof artifact and recipient, then send for customer approval."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {/* Proof artifact preview */}
            {displayedVersion ? (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-start gap-3">
                  {previewIsImage && previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Proof preview"
                      className="h-16 w-16 shrink-0 rounded border object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-muted">
                      <FileImage className="h-7 w-7 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">
                      Version {displayedVersion.versionNumber}
                      {displayedFile ? ` — ${displayedFile.originalFilename || displayedFile.fileName || "Proof file"}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground capitalize">{displayedVersion.status.replace(/_/g, " ")}</p>
                    {(displayedVersion.packageLineItems?.length ?? 0) > 1 ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">Combined proof · {displayedVersion.packageLineItems?.length} line items</p>
                        {displayedVersion.packageLineItems?.map((lineItem) => (
                          <p key={lineItem.lineItemId} className="truncate">{lineItem.lineItemLabel} · Qty {lineItem.quantity ?? "—"}</p>
                        ))}
                      </div>
                    ) : null}
                    {currentProofIssue ? (
                      <p className="mt-1 text-xs text-destructive">This proof does not include an artwork preview and cannot be sent to the customer.</p>
                    ) : null}
                    {downloadUrl && displayedFile ? (
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
                      >
                        Open / Download
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Recipient fields */}
            {proofRecipients.length > 0 ? (
              <div className="grid gap-2">
                <Label htmlFor="proof-recipient-select">Customer contact</Label>
                <Select
                  value=""
                  onValueChange={(value) => {
                    const selected = proofRecipients.find((recipient) => recipient.id === value);
                    if (!selected) return;
                    setSendToName(selected.name || "");
                    setSendToEmail(selected.email || "");
                    setSendEmailSource("");
                  }}
                >
                  <SelectTrigger id="proof-recipient-select">
                    <SelectValue placeholder="Choose a customer contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {proofRecipients.map((recipient) => (
                      <SelectItem key={recipient.id} value={recipient.id}>
                        {recipient.name || recipient.email} - {recipient.email}
                        {recipient.isOrderContact ? " (order contact)" : recipient.isPrimary ? " (primary)" : recipient.isBillingContact ? " (billing)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="proof-send-name">Send to name</Label>
              <Input
                id="proof-send-name"
                value={sendToName}
                onChange={(event) => { setSendToName(event.target.value); setSendEmailSource(""); }}
                placeholder="Customer name (optional)"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="proof-send-email">
                  Send to email(s) <span className="text-destructive">*</span>
                </Label>
                {sendEmailSource === "prefilled" && sendToEmail.trim() ? (
                  <span className="text-[10px] text-muted-foreground">Auto-filled from customer contact</span>
                ) : null}
              </div>
              <Input
                id="proof-send-email"
                type="email"
                value={sendToEmail}
                onChange={(event) => { setSendToEmail(event.target.value); setSendEmailSource(""); }}
                placeholder="customer@example.com, manager@example.com"
              />
              {sendDialogOpen && !sendToEmail.trim() ? (
                <p className="text-xs text-destructive">A recipient email is required.</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-email-subject">Email subject</Label>
              <Input
                id="proof-email-subject"
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="Proof Ready for Review - Version N"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-customer-message">Customer note for this proof</Label>
              <Textarea
                id="proof-customer-message"
                rows={3}
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
                placeholder="Optional message shown to the customer on the proof review page, included with this proof send only"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendDialogOpen(false)}
              disabled={sendMutation.isPending || resendMutation.isPending}
            >
              Cancel
            </Button>
            {sendDialogMode === "resend" ? (
              <Button
                onClick={() => resendMutation.mutate()}
                disabled={resendMutation.isPending || !sendToEmail.trim() || !canResendDisplayedVersion}
              >
                {resendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Resend notification
              </Button>
            ) : (
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !sendToEmail.trim() || !canSendDisplayedVersion}
              >
                {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send proof
              </Button>
            )}
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

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{displayedVersion?.status === "draft" ? "Discard Draft" : "Cancel Sent Proof"}</DialogTitle>
            <DialogDescription>
              {displayedVersion?.status === "draft"
                ? "This will discard the temporary draft. It will remain in history but cannot be sent."
                : "This will cancel the active customer proof link. The customer will no longer be able to approve this version. You can generate and send a corrected proof after cancellation."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="proof-cancel-reason">Reason</Label>
            <Textarea
              id="proof-cancel-reason"
              rows={4}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Optional internal reason for cancelling this proof"
              disabled={cancelProofMutation.isPending}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={cancelProofMutation.isPending}>
              Keep Proof Active
            </Button>
            <Button variant="destructive" onClick={() => cancelProofMutation.mutate()} disabled={cancelProofMutation.isPending || !canCancelDisplayedVersion}>
              {cancelProofMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {displayedVersion?.status === "draft" ? "Discard Draft" : "Cancel Proof"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={proofNotRequiredDialogOpen} onOpenChange={setProofNotRequiredDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Proof Gate</DialogTitle>
            <DialogDescription>
              Use this only when proof approval is not required for this line item. The reason is written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="proof-not-required-reason">Reason</Label>
              <Textarea
                id="proof-not-required-reason"
                rows={3}
                value={proofNotRequiredReason}
                onChange={(event) => setProofNotRequiredReason(event.target.value)}
                placeholder="Why is proof approval no longer required?"
                disabled={proofNotRequiredMutation.isPending}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proof-not-required-note">Internal note</Label>
              <Textarea
                id="proof-not-required-note"
                rows={3}
                value={proofNotRequiredNote}
                onChange={(event) => setProofNotRequiredNote(event.target.value)}
                placeholder="Optional operational context"
                disabled={proofNotRequiredMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProofNotRequiredDialogOpen(false)} disabled={proofNotRequiredMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => proofNotRequiredMutation.mutate()} disabled={proofNotRequiredMutation.isPending || !proofNotRequiredReason.trim()}>
              {proofNotRequiredMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
              Remove Gate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
