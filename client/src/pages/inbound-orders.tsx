import { type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import pdfCMapProbeUrl from "pdfjs-dist/cmaps/78-EUC-H.bcmap?url";
import pdfStandardFontProbeUrl from "pdfjs-dist/standard_fonts/FoxitFixed.pfb?url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  Inbox,
  Loader2,
  Mail,
  Maximize2,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DocumentMetaCard } from "@/components/DocumentMetaCard";
import { ProductOptionsPanelV2 } from "@/features/quotes/editor/components/ProductOptionsPanelV2";
import { useInboundEmailIntakeSettings, usePullLatestInboundEmails } from "@/hooks/useInboundEmailIntakeSettings";
import { useToast } from "@/hooks/use-toast";
import { formatFileSize } from "@/lib/fileUtils";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  getManualInboundEvidence,
  type InboundOrderDetailResponse,
  type InboundOrderDraftPreviewResponse,
  type InboundOrderParsedDraft,
  type InboundOrderParseResponse,
  type InboundOrderReviewDraftDto,
  type InboundOrderArtworkLink,
  type InboundOrderReviewDraftResponse,
  type InboundOrderReviewDraftSaveRequest,
  type InboundOrdersListResponse,
  type InboundOrderStatusGroup,
  type InboundOrderQueueSummary,
  type InboundOrderRecordWithTrust,
  type InboundSenderTrustStatus,
  type InboundAttachmentDownloadPolicy,
  type InboundOrderConvertToOrderResponse,
  type InboundOrderProductOptionsResponse,
  type InboundProductSearchResponse,
  type InboundProductSearchResult,
  type InboundMatchedContactSummary,
  type InboundMatchedCustomerSummary,
  type ManualInboundOrderCreateRequest,
  type ManualInboundOrderCreateResponse,
} from "@shared/inboundOrdersApi";
import { defaultNewProductionArtworkAllocation } from "@shared/artworkAllocation";
import { inboundDimensionsMatchPdf } from "@shared/inboundOrderDimensions";
import {
  inboundAttachmentClassificationToRole,
  inboundAttachmentRoleToClassification,
  type InboundAttachmentClassification,
} from "@shared/inboundAttachmentClassification";
import {
  inboundPdfFileIdentity,
  isInboundPdfAttachment,
  readInboundPdfSizeAnalysis,
  type InboundPdfSizeAnalysis,
} from "@shared/inboundPdfSizeAnalysis";
import type { LineItemOptionSelectionsV2 } from "@shared/optionTreeV2";
import { getMissingInboundPbv2RequiredOptions } from "@shared/inboundOrderPbv2Options";
import {
  getInboundPoPriceSuggestion,
  hasUsableInboundLinePrice,
  resolveInboundLineEffectivePricing,
  type InboundPriceOverrideMode,
} from "@shared/inboundOrderPricing";
import type {
  InboundOrderRecordStatus,
  InboundOrderSourceType,
} from "@shared/schema";

type ClientInboundOrderRecord = Omit<
  InboundOrderRecordWithTrust,
  "receivedAt" | "submittedAt" | "createdAt" | "updatedAt" | "rejectedAt"
> & {
  receivedAt: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rejectedAt: string | null;
};

type ClientInboundOrdersListResponse = Omit<InboundOrdersListResponse, "data"> & {
  data: ClientInboundOrderRecord[];
};

type ClientInboundOrderDetailResponse = Omit<InboundOrderDetailResponse, "data"> & {
  data: Omit<InboundOrderDetailResponse["data"], "record"> & {
    record: ClientInboundOrderRecord;
  };
};

type ClientInboundOrderParseAttempt = NonNullable<InboundOrderDraftPreviewResponse["data"]["latestAttempt"]>;

type ClientInboundOrderDraftPreviewResponse = InboundOrderDraftPreviewResponse;
type ClientInboundOrderReviewDraftResponse = InboundOrderReviewDraftResponse;
type ReviewDraftFormState = InboundOrderReviewDraftSaveRequest;
type ClientInboundReviewLinePricingResponse = {
  success: true;
  data: {
    pricingReviewJson: NonNullable<ReviewDraftFormState["reviewedLineItemsJson"][number]["pricingReviewJson"]>;
  };
};

type DraftOrderConversionAttempt = {
  draft: ReviewDraftFormState;
  blockers: string[];
};
type ClientInboundOrderFile = ClientInboundOrderDetailResponse["data"]["files"][number];

type ClientInboundOrderParseResponse = Omit<InboundOrderParseResponse, "data"> & {
  data: Omit<InboundOrderParseResponse["data"], "record"> & {
    record: ClientInboundOrderRecord;
  };
};

type InboundOrderCombineResponse = {
  success: true;
  data: {
    detail: ClientInboundOrderDetailResponse["data"];
    combinedSourceCount: number;
    reparseRecommended: true;
  };
};

type InboundOrderAttachToOrderResponse = {
  success: true;
  data: {
    orderId: string;
    orderNumber: string | null;
    inboundRecordId: string;
    createdAttachmentIds: string[];
    skippedAttachments: Array<{ fileId: string; reason: string }>;
  };
};

type ExistingOrderSearchResult = {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  customer?: { companyName?: string | null } | null;
  contact?: { email?: string | null; firstName?: string | null; lastName?: string | null } | null;
  label?: string | null;
  poNumber?: string | null;
  status?: string | null;
};

type CleanInlineAttachmentSelection = {
  recordId: string;
  file: ClientInboundOrderFile;
} | null;

function pdfSizeAnalysisForFile(file: ClientInboundOrderFile): InboundPdfSizeAnalysis | null {
  return readInboundPdfSizeAnalysis(attachmentSafetyMetadata(file).pdfSizeAnalysis);
}

function formatPdfInches(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function pdfSizeLabel(analysis: InboundPdfSizeAnalysis): string {
  if (analysis.status === "pending") return "Size scan pending";
  if (analysis.status === "unavailable") return "PDF size unavailable";
  if (analysis.status === "failed") return analysis.errorCode === "ENCRYPTED_PDF" ? "Encrypted PDF: size unavailable" : "Unable to detect PDF size";
  if (analysis.uniformPageSize && analysis.effectiveWidthInches && analysis.effectiveHeightInches) {
    const size = `${formatPdfInches(analysis.effectiveWidthInches)} × ${formatPdfInches(analysis.effectiveHeightInches)} in`;
    return analysis.pageCount === 1 ? `Detected PDF size: ${size}` : `${analysis.pageCount} pages, all ${size}`;
  }
  return `Mixed page sizes: ${analysis.pages.map((page) => `Page ${page.pageNumber} ${formatPdfInches(page.widthInches)} × ${formatPdfInches(page.heightInches)} in`).join("; ")}`;
}

function InboundPdfSizeStatus({ recordId, file }: { recordId: string; file: ClientInboundOrderFile }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const analysis = pdfSizeAnalysisForFile(file);
  if (!isInboundPdfAttachment(file)) return null;
  const canScan = Boolean(file.fileRecordId) && file.status !== "rejected" && attachmentSafetyMetadata(file).attachmentState !== "blocked_file_type";
  const scanMutation = useMutation({
    mutationFn: (force: boolean) => postJson<{ success: boolean; data: { file: ClientInboundOrderFile | null } }>(
      `/api/inbound-orders/${encodeURIComponent(recordId)}/files/${encodeURIComponent(file.id)}/pdf-size-scan`,
      force ? { force: true } : {},
    ),
    onSuccess: async (response) => {
      if (response.data.file) {
        queryClient.setQueryData<ClientInboundOrderDetailResponse | undefined>(["/api/inbound-orders", recordId], (current) => current?.data ? ({ ...current, data: { ...current.data, files: current.data.files.map((candidate) => candidate.id === file.id ? response.data.file! : candidate) } }) : current);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] });
    },
    onError: (error: Error) => toast({ title: "PDF size scan failed", description: error.message || "Unable to scan PDF page size.", variant: "destructive" }),
  });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" data-testid={`pdf-size-status-${file.id}`}>
      <span className={analysis?.status === "failed" || analysis?.status === "unavailable" ? "text-amber-600 dark:text-amber-300" : "text-sky-700 dark:text-sky-200"} title="Detected from the PDF page. Verify when the file includes bleed, extra canvas, or multiple designs.">
        {analysis ? pdfSizeLabel(analysis) : "PDF size not scanned"}
      </span>
      {canScan && (
        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={scanMutation.isPending || analysis?.status === "pending"} onClick={() => scanMutation.mutate(analysis?.status === "succeeded" || analysis?.status === "failed") }>
          {(scanMutation.isPending || analysis?.status === "pending") && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {analysis?.status === "succeeded" || analysis?.status === "failed" ? "Re-scan size" : "Scan PDF size"}
        </Button>
      )}
    </div>
  );
}

function inboundFileDownloadUrl(recordId: string, file: ClientInboundOrderFile) {
  const metadata = attachmentSafetyMetadata(file);
  const attachmentState = String(metadata.attachmentState ?? "");
  return file.fileRecordId && file.status !== "rejected" && attachmentState !== "blocked_file_type"
    ? `/api/inbound-orders/${encodeURIComponent(recordId)}/files/${encodeURIComponent(file.id)}/download`
    : null;
}

function inboundFileUnavailableLabel(file: ClientInboundOrderFile) {
  const metadata = attachmentSafetyMetadata(file);
  const attachmentState = String(metadata.attachmentState ?? "");
  if (!file.fileRecordId && attachmentState === "pending_trust") return "Awaiting trust";
  if (!file.fileRecordId && attachmentState === "download_failed") return "Download failed";
  if (!file.fileRecordId && !(file.providerAttachmentId ?? metadata.providerAttachmentId)) return "Provider file unavailable";
  if (!file.fileRecordId) return "File content not stored yet";
  if (String(attachmentSafetyMetadata(file).attachmentState ?? "") === "blocked_file_type") return "Blocked file type";
  if (file.status === "rejected") return "Rejected";
  return "Unavailable";
}

function inboundFileUnavailableReason(file: ClientInboundOrderFile) {
  const metadata = attachmentSafetyMetadata(file);
  const providerAttachmentId = file.providerAttachmentId ?? metadata.providerAttachmentId;
  const providerMessageId = file.providerMessageId ?? metadata.providerMessageId;
  const attachmentState = String(metadata.attachmentState ?? "");
  if (!file.fileRecordId && attachmentState === "blocked_file_type") {
    return String(metadata.attachmentSafetyReason ?? metadata.failureReason ?? file.reviewNotes ?? "This attachment type is blocked by file safety policy.");
  }
  if (!file.fileRecordId && attachmentState === "download_failed") {
    return String(metadata.failureReason ?? metadata.downloadError ?? file.reviewNotes ?? "The provider download failed. Retry the download.");
  }
  if (!file.fileRecordId && attachmentState === "pending_trust") {
    return String(metadata.attachmentSafetyReason ?? file.reviewNotes ?? "The sender must be trusted before file content can be fetched.");
  }
  if (!file.fileRecordId && providerAttachmentId && providerMessageId) {
    return "File content not stored yet. Fetch file to view/download.";
  }
  return String(
    metadata.attachmentSafetyReason
      ?? metadata.failureReason
      ?? metadata.downloadError
      ?? file.reviewNotes
      ?? (!providerAttachmentId
        ? "The provider did not supply a recoverable attachment identifier."
        : "The provider file has not been fetched into private storage."),
  );
}

async function fetchInboundAttachmentBlob(recordId: string, file: ClientInboundOrderFile) {
  const downloadUrl = inboundFileDownloadUrl(recordId, file);
  if (!downloadUrl) throw new Error("This attachment has no downloadable file.");
  const response = await apiFetch(downloadUrl);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `File access failed (${response.status})`);
  }
  const blob = await response.blob();
  return {
    blob,
    mimeType: response.headers.get("content-type") || blob.type || file.mimeType || null,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(blobUrl);
}

function combinedInboundSources(record: ClientInboundOrderRecord): Array<Record<string, unknown>> {
  const payload = record.normalizedPayloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const sources = (payload as Record<string, unknown>).combinedSources;
  return Array.isArray(sources)
    ? sources.filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === "object" && !Array.isArray(source))
    : [];
}

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read attachment bytes."));
    reader.readAsArrayBuffer(blob);
  });
}

function getPdfAssetBaseUrl(assetUrl: string) {
  const normalized = (assetUrl || "").trim();
  if (!normalized) return undefined;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return undefined;
  return normalized.slice(0, index + 1);
}

const pdfCMapUrl = getPdfAssetBaseUrl(pdfCMapProbeUrl);
const pdfStandardFontDataUrl = getPdfAssetBaseUrl(pdfStandardFontProbeUrl);

function clampCleanViewerZoom(value: number) {
  return Math.min(3, Math.max(0.5, value));
}

type InboundCustomerSearchResponse = {
  success: true;
  data: InboundMatchedCustomerSummary[];
};

type AttachmentClassificationRuleMatchType =
  | "filename_contains"
  | "filename_starts_with"
  | "filename_ends_with"
  | "filename_exact"
  | "mime_type";

type AttachmentClassificationDialogState = {
  recordId: string;
  link: InboundOrderArtworkLink;
  customerId: string | null;
  senderDomain: string | null;
};

type AttachmentClassificationUpdateResponse = {
  success: true;
  data: {
    file: ClientInboundOrderFile;
    rule: Record<string, unknown> | null;
    warning: string | null;
  };
};

type AttachmentClassificationBulkUpdateResponse = {
  success: true;
  data: {
    files: ClientInboundOrderFile[];
    errors: Array<{ fileId: string; message: string }>;
    warnings: Array<{ fileId: string; message: string }>;
  };
};

type InboundContactSearchResponse = {
  success: true;
  data: Array<InboundMatchedContactSummary & {
    firstName?: string | null;
    lastName?: string | null;
    isPrimary?: boolean;
  }>;
};

type QueueStatusFilter = "all" | InboundOrderStatusGroup;
type InboundQueueCleanupAction =
  | "trust_sender"
  | "trust_domain"
  | "ignore_once"
  | "ignore_sender"
  | "ignore_domain"
  | "ignore_subject"
  | "ignore_sender_subject"
  | "delete"
  | "reject";

type InboundOrderBulkActionResponse = {
  success: true;
  data: {
    updatedIds: string[];
    errors: Array<{ id: string; message: string }>;
    rulesCreated?: number;
    rulesAlreadyExisted?: number;
    emailsProcessed?: number;
    emailsSkipped?: number;
    actualErrors?: Array<{ id: string; message: string }>;
  };
};

type InboundRuleConflictError = Error & {
  code?: string;
  conflict?: {
    conflictType?: string;
    conflictingRuleId?: string;
    conflictingRuleType?: string;
    conflictingValue?: string;
    currentRuleLocation?: string;
    recommendedResolution?: string;
  };
};
type InboundRecordTrustAction =
  | "trust_sender"
  | "trust_domain"
  | "trust_sender_and_download"
  | "trust_domain_and_download";
type InboundEmailReprocessAction =
  | "reprocess_email"
  | "backfill_attachments"
  | "rerun_trust_attachment_download";

type InboundEmailReprocessResult = {
  action: InboundEmailReprocessAction;
  inboundRecordId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  threadMessagesInspected: number;
  latestThreadActivity: string | null;
  candidatesFound: number;
  attempted: number;
  stored: number;
  metadataOnly: number;
  failed: number;
  skipped: number;
};

type QueueFilters = {
  statusGroup: QueueStatusFilter;
  sourceType: "all" | InboundOrderSourceType;
  trustFilter: "all" | "trusted" | "untrusted" | "unknown" | "pending_attachment_trust";
  hasWarnings: boolean;
  unconvertedOnly: boolean;
  search: string;
  sort: "received_desc" | "received_asc" | "customer_asc" | "customer_desc" | "subject_asc" | "subject_desc" | "due_date_asc" | "due_date_desc";
};

type InboundReviewWorkspaceMode = "operational" | "clean" | "debug";
type SourceDocumentTab = "email" | "po" | "artwork" | "history";
type CleanHighlightTarget =
  | "customer"
  | "product"
  | "quantity"
  | "dimensions"
  | "artwork"
  | "po"
  | "dueDate"
  | "pricing";
type CleanFocusOptions = { inspectSource?: boolean };
type CleanFocusTargetHandler = (target: CleanHighlightTarget, options?: CleanFocusOptions) => void;

const defaultQueueFilters: QueueFilters = {
  statusGroup: "active",
  sourceType: "all",
  trustFilter: "all",
  hasWarnings: false,
  unconvertedOnly: true,
  search: "",
  sort: "received_desc",
};

const queueSearchDebounceMs = 300;

const workspaceLayoutStorageKeys = {
  queueCollapsed: "titanos.inboundOrders.queueCollapsed",
  queueWidth: "titanos.inboundOrders.queueWidth",
  evidenceWidth: "titanos.inboundOrders.evidenceWidth",
  draftWidth: "titanos.inboundOrders.draftWidth",
  reviewMode: "titanos.inboundOrders.reviewMode",
} as const;

const workspaceLayoutDefaults = {
  queueExpandedWidth: 300,
  queueCollapsedWidth: 56,
  evidenceWidth: 440,
  draftWidth: 520,
  minQueueExpandedWidth: 260,
  maxQueueExpandedWidth: 450,
  minEvidenceWidth: 360,
  minDraftWidth: 460,
  compactEvidenceWidth: 320,
  compactDraftWidth: 360,
  desktopBreakpoint: 1024,
  wideDesktopBreakpoint: 1500,
} as const;

const statusLabels: Record<InboundOrderRecordStatus, string> = {
  received: "Received",
  processing: "Processing",
  needs_review: "Needs Review",
  waiting_on_customer: "Waiting",
  ready: "Ready",
  approved: "Approved",
  submitted: "Converted",
  failed: "Failed",
  terminal: "Rejected",
  ignored: "Ignored",
};

const sourceTypeOptions: Array<{ value: QueueFilters["sourceType"]; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "email", label: "Email" },
  { value: "customer_api", label: "API" },
  { value: "webhook", label: "Webhook" },
  { value: "csv_import", label: "CSV" },
  { value: "portal", label: "Portal" },
  { value: "n8n", label: "n8n" },
  { value: "zapier", label: "Zapier" },
  { value: "edi", label: "EDI" },
];

const trustFilterOptions: Array<{ value: QueueFilters["trustFilter"]; label: string }> = [
  { value: "all", label: "All trust statuses" },
  { value: "trusted", label: "Trusted" },
  { value: "untrusted", label: "Untrusted" },
  { value: "unknown", label: "Unknown" },
  { value: "pending_attachment_trust", label: "Pending attachment trust" },
];

const queueSortOptions: Array<{ value: QueueFilters["sort"]; label: string }> = [
  { value: "received_desc", label: "Received: newest" },
  { value: "received_asc", label: "Received: oldest" },
  { value: "customer_asc", label: "Customer: A–Z" },
  { value: "customer_desc", label: "Customer: Z–A" },
  { value: "subject_asc", label: "Subject: A–Z" },
  { value: "subject_desc", label: "Subject: Z–A" },
  { value: "due_date_asc", label: "Due date: earliest" },
  { value: "due_date_desc", label: "Due date: latest" },
];

const senderTrustLabels: Record<InboundSenderTrustStatus, string> = {
  trusted_sender: "Trusted Sender",
  trusted_domain: "Trusted Domain",
  trusted_contact: "Trusted Contact",
  trusted_customer_domain: "Trusted Customer Domain",
  ignored: "Ignored",
  untrusted: "Untrusted",
  unknown: "Unknown",
};

const attachmentPolicyLabels: Record<InboundAttachmentDownloadPolicy, string> = {
  auto_download_allowed: "Auto-download",
  pending_trust: "Pending Trust",
  blocked_file_type_only: "Blocked Type",
  no_attachments: "No Attachments",
};

const inboundIntentLabels: Record<string, string> = {
  ORDER_REQUEST: "Order Request",
  QUOTE_REQUEST: "Quote Request",
  CUSTOMER_COMMUNICATION: "Customer Communication",
  UNKNOWN: "Unknown",
  NEWSLETTER_SPAM: "Newsletter/Spam",
};

function getSenderTrustBadgeVariant(status: InboundSenderTrustStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "untrusted" || status === "ignored") return "destructive";
  if (status === "unknown") return "outline";
  return "secondary";
}

function getAttachmentPolicyBadgeVariant(policy: InboundAttachmentDownloadPolicy): "default" | "secondary" | "outline" | "destructive" {
  if (policy === "pending_trust") return "destructive";
  if (policy === "blocked_file_type_only") return "outline";
  if (policy === "no_attachments") return "outline";
  return "secondary";
}

function shouldShowInlineTrustActions(record: ClientInboundOrderRecord): boolean {
  return record.sourceType === "email"
    && (record.senderTrustStatus === "untrusted" || record.attachmentDownloadPolicy === "pending_trust");
}

function getQueueIssueChip(record: ClientInboundOrderRecord): string | null {
  if (record.attachmentDownloadPolicy === "pending_trust" || record.senderTrustStatus === "untrusted") return "Untrusted";
  const reason = record.reviewRequiredReason?.toLowerCase() ?? "";
  if (reason.includes("artwork")) return "Artwork Missing";
  if (reason.includes("price") || reason.includes("pricing")) return "PO Price";
  if (!record.parsedAt && (record.status === "received" || record.status === "processing")) return "Needs Parse";
  if (record.requiresHumanDecision) return "Issue";
  return null;
}

function isTrustedInboundRecord(record: ClientInboundOrderRecord): boolean {
  return record.senderTrustStatus === "trusted_sender"
    || record.senderTrustStatus === "trusted_domain"
    || record.senderTrustStatus === "trusted_contact"
    || record.senderTrustStatus === "trusted_customer_domain";
}

function isUntrustedInboundRecord(record: ClientInboundOrderRecord): boolean {
  return record.senderTrustStatus === "untrusted"
    || record.attachmentDownloadPolicy === "pending_trust";
}

function isLikelyPoEvidenceFile(file: ClientInboundOrderFile): boolean {
  if (file.role === "po") return true;
  const filename = String(file.sourceFilename ?? "").toLowerCase();
  const mimeType = String(file.mimeType ?? "").toLowerCase();
  const isPdf = mimeType.includes("pdf") || filename.endsWith(".pdf");
  if (!isPdf) return false;
  return /\b(po|p\.o\.|purchase\s*order|order\s*(no|number|#)|reference)\b/i.test(filename)
    || file.role === "reference";
}

function recordTrustActionLabel(action: InboundRecordTrustAction): string {
  if (action === "trust_sender") return "Trust Sender";
  if (action === "trust_domain") return "Trust Domain";
  if (action === "trust_sender_and_download") return "Trust Sender + Download Attachments";
  return "Trust Domain + Download Attachments";
}

function buildInboundOrderListUrl(filters: QueueFilters) {
  const params = new URLSearchParams();
  params.set("limit", "50");
  params.set("offset", "0");

  if (filters.statusGroup !== "all") params.set("statusGroup", filters.statusGroup);
  if (filters.sourceType !== "all") params.set("sourceType", filters.sourceType);
  if (filters.trustFilter !== "all") params.set("trustFilter", filters.trustFilter);
  if (filters.hasWarnings) params.set("hasWarnings", "true");
  if (filters.unconvertedOnly && filters.statusGroup !== "converted" && filters.statusGroup !== "ignored") params.set("converted", "false");
  if (filters.search.trim()) params.set("search", filters.search.trim());
  params.set("sort", filters.sort);

  return `/api/inbound-orders?${params.toString()}`;
}

function isInboundOrderListQuery(query: { queryKey: readonly unknown[] }) {
  const key = query.queryKey;
  return key[0] === "/api/inbound-orders"
    && key.length === 2
    && typeof key[1] === "object"
    && key[1] !== null;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "Request failed";
    const error = new Error(message) as Error & { errors?: string[] };
    const structuredErrors = Array.isArray(json?.errors) ? json.errors : Array.isArray(json?.blockers) ? json.blockers : [];
    if (Array.isArray(structuredErrors)) error.errors = structuredErrors.filter((item: unknown): item is string => typeof item === "string");
    throw error;
  }

  return json as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "Request failed";
    const error = new Error(message) as InboundRuleConflictError & { errors?: string[] };
    if (Array.isArray(json?.errors)) error.errors = json.errors.filter((item: unknown): item is string => typeof item === "string");
    if (typeof json?.code === "string") error.code = json.code;
    if (json?.conflict && typeof json.conflict === "object") error.conflict = json.conflict;
    throw error;
  }

  return json as T;
}

async function putJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : "Request failed";
    const error = new Error(message) as Error & { errors?: string[] };
    if (Array.isArray(json?.errors)) error.errors = json.errors.filter((item: unknown): item is string => typeof item === "string");
    throw error;
  }

  return json as T;
}

function parseAttemptNoDraftMessage(attempt: ClientInboundOrderParseAttempt | null | undefined): string {
  const errors = Array.isArray(attempt?.errors) ? attempt.errors : [];
  const warnings = Array.isArray(attempt?.warnings) ? attempt.warnings : [];
  const firstDetail = [...errors, ...warnings]
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        return typeof record.message === "string"
          ? record.message
          : typeof record.reason === "string"
            ? record.reason
            : typeof record.error === "string"
              ? record.error
              : null;
      }
      return null;
    })
    .find((value): value is string => Boolean(value?.trim()));
  return firstDetail
    ? `Parse completed, but no review draft was produced: ${firstDetail}`
    : "Parse completed, but no review draft was produced. Reparse this record or use Debug View to inspect the latest parse attempt.";
}

export function operatorSafeParseErrorMessage(error: Error | null | undefined): string {
  const message = error?.message?.trim();
  if (!message) return "Parse could not save the review draft. Please retry.";
  if (/review draft persistence failed|zod|validation error|must contain at most/i.test(message)) {
    return "Parse could not save the review draft. Please retry.";
  }
  return message;
}

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function textInputValueToNull(value: string) {
  return value.length ? value : null;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest([
    "[contenteditable='']",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='searchbox']",
    "[role='combobox']",
    "[role='spinbutton']",
    "[data-editable='true']",
    "[data-editor]",
  ].join(",")));
}

function shouldIgnoreShortcutKeydown(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return isEditableKeyboardTarget(event.target);
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) === "true" ? true : fallback;
}

function readStoredNumber(key: string, fallback: number, minimum: number, maximum = 900): number {
  if (typeof window === "undefined") return fallback;
  const storedValue = window.localStorage.getItem(key);
  if (storedValue == null || storedValue.trim() === "") return fallback;
  const value = Number(storedValue);
  return Number.isFinite(value) ? clampWorkspaceWidth(value, minimum, maximum) : fallback;
}

function clampWorkspaceWidth(value: number, minimum: number, maximum = 900): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function getMeasuredWorkspaceWidth(workspaceWidth: number): number {
  if (workspaceWidth > 0) return workspaceWidth;
  if (typeof window === "undefined") return 0;
  return window.innerWidth;
}

function getVisibleWorkspaceWidth(element: HTMLElement | null): number {
  if (!element || typeof window === "undefined") return 0;
  const rect = element.getBoundingClientRect();
  const measuredWidth = rect.width || element.clientWidth;
  const visibleWidth = Math.max(0, window.innerWidth - Math.max(0, rect.left));
  const boundedWidth = visibleWidth > 0 ? Math.min(measuredWidth, visibleWidth) : measuredWidth;
  return Math.max(0, Math.round(boundedWidth));
}

function getWorkspaceQueueWidth(queueCollapsed: boolean, queueExpandedWidth: number = workspaceLayoutDefaults.queueExpandedWidth): number {
  return queueCollapsed
    ? workspaceLayoutDefaults.queueCollapsedWidth
    : queueExpandedWidth;
}

function getWorkspaceAvailablePanelWidth(args: { queueCollapsed: boolean; workspaceWidth: number; queueExpandedWidth?: number }): number {
  const measuredWidth = getMeasuredWorkspaceWidth(args.workspaceWidth);
  if (measuredWidth < workspaceLayoutDefaults.desktopBreakpoint) {
    return workspaceLayoutDefaults.evidenceWidth + workspaceLayoutDefaults.draftWidth;
  }
  return Math.max(0, measuredWidth - getWorkspaceQueueWidth(args.queueCollapsed, args.queueExpandedWidth));
}

function getWorkspacePanelMinimums(args: { queueCollapsed: boolean; workspaceWidth: number; queueExpandedWidth?: number }) {
  const availableWidth = getWorkspaceAvailablePanelWidth(args);
  if (args.workspaceWidth >= workspaceLayoutDefaults.wideDesktopBreakpoint || availableWidth >= 980) {
    return {
      evidence: workspaceLayoutDefaults.minEvidenceWidth,
      draft: workspaceLayoutDefaults.minDraftWidth,
    };
  }
  return {
    evidence: Math.min(workspaceLayoutDefaults.minEvidenceWidth, workspaceLayoutDefaults.compactEvidenceWidth),
    draft: Math.min(workspaceLayoutDefaults.minDraftWidth, workspaceLayoutDefaults.compactDraftWidth),
  };
}

function reconcileWorkspacePanelWidths(args: {
  evidenceWidth: number;
  draftWidth: number;
  queueCollapsed: boolean;
  queueExpandedWidth: number;
  workspaceWidth: number;
}) {
  const availableWidth = getWorkspaceAvailablePanelWidth(args);
  const minimums = getWorkspacePanelMinimums(args);
  if (availableWidth <= 0) {
    return {
      evidenceWidth: workspaceLayoutDefaults.evidenceWidth,
      draftWidth: workspaceLayoutDefaults.draftWidth,
    };
  }
  const maxEvidenceWidth = Math.max(minimums.evidence, availableWidth - minimums.draft);
  const evidenceWidth = clampWorkspaceWidth(
    args.evidenceWidth,
    minimums.evidence,
    maxEvidenceWidth,
  );
  return {
    evidenceWidth,
    draftWidth: clampWorkspaceWidth(
      args.draftWidth,
      minimums.draft,
      Math.max(minimums.draft, availableWidth - evidenceWidth),
    ),
  };
}

function cloneReviewDraft(draft: InboundOrderReviewDraftDto): ReviewDraftFormState {
  return JSON.parse(JSON.stringify({
    status: "draft",
    reviewedCustomerJson: draft.reviewedCustomerJson,
    reviewedOrderJson: { ...draft.reviewedOrderJson, intent: draft.reviewedOrderJson.intent ?? "unknown", priority: draft.reviewedOrderJson.priority ?? "normal" },
    reviewedLineItemsJson: draft.reviewedLineItemsJson,
    reviewedArtworkJson: draft.reviewedArtworkJson,
    missingDecisionsJson: draft.missingDecisionsJson,
    warningsJson: draft.warningsJson,
    unsupportedRequestsJson: draft.unsupportedRequestsJson ?? [],
    customerIntelligenceJson: draft.customerIntelligenceJson ?? null,
    reviewNotes: draft.reviewNotes,
  })) as ReviewDraftFormState;
}

function isInboundRuleConflictError(error: Error): error is InboundRuleConflictError {
  return (error as InboundRuleConflictError).code === "INBOUND_RULE_CONFLICT" || Boolean((error as InboundRuleConflictError).conflict);
}

function formatInboundIgnoreBulkDescription(data: InboundOrderBulkActionResponse["data"]): string {
  const emailsProcessed = data.emailsProcessed ?? data.updatedIds.length;
  const rulesCreated = data.rulesCreated ?? 0;
  const rulesAlreadyExisted = data.rulesAlreadyExisted ?? 0;
  const lines = [`Processed ${emailsProcessed} email${emailsProcessed === 1 ? "" : "s"}.`];
  lines.push(`Created ${rulesCreated} new ignore rule${rulesCreated === 1 ? "" : "s"}.`);
  if (rulesAlreadyExisted > 0) {
    lines.push(`${rulesAlreadyExisted} email${rulesAlreadyExisted === 1 ? "" : "s"} matched an existing rule.`);
  }
  return lines.join("\n");
}

function formStatesEqual(left: ReviewDraftFormState | null, right: ReviewDraftFormState | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatCents(value: number | null | undefined): string {
  return value == null ? "-" : `$${(value / 100).toFixed(2)}`;
}

function inboundLinePricingDependencyKey(lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number]): string {
  return JSON.stringify({
    productId: lineItem.selectedProductId ?? null,
    quantity: lineItem.quantity ?? null,
    width: lineItem.width ?? null,
    height: lineItem.height ?? null,
    dimensionsUnit: lineItem.dimensionsUnit ?? null,
    materialText: lineItem.materialText ?? null,
    printSpecs: lineItem.printSpecs ?? [],
    optionTexts: lineItem.optionTexts ?? [],
    finishingTexts: lineItem.finishingTexts ?? [],
    optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
    pbv2TreeVersionId: lineItem.pbv2TreeVersionId ?? null,
    productionSides: isDoubleSidedReviewLineItem(lineItem) ? "double" : "single",
    priceOverrideMode: lineItem.pricingReviewJson?.priceOverrideMode ?? null,
    priceOverrideValueCents: lineItem.pricingReviewJson?.priceOverrideValueCents ?? null,
    priceOverrideSource: lineItem.pricingReviewJson?.priceOverrideSource ?? null,
  });
}

function inboundLinePricingDependenciesChanged(
  previous: ReviewDraftFormState["reviewedLineItemsJson"][number],
  next: ReviewDraftFormState["reviewedLineItemsJson"][number],
): boolean {
  const withoutOverrides = (lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number]) => JSON.stringify({
    productId: lineItem.selectedProductId ?? null,
    quantity: lineItem.quantity ?? null,
    width: lineItem.width ?? null,
    height: lineItem.height ?? null,
    dimensionsUnit: lineItem.dimensionsUnit ?? null,
    materialText: lineItem.materialText ?? null,
    printSpecs: lineItem.printSpecs ?? [],
    optionTexts: lineItem.optionTexts ?? [],
    finishingTexts: lineItem.finishingTexts ?? [],
    optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
    pbv2TreeVersionId: lineItem.pbv2TreeVersionId ?? null,
    productionSides: isDoubleSidedReviewLineItem(lineItem) ? "double" : "single",
  });
  return withoutOverrides(previous) !== withoutOverrides(next);
}

function markInboundLinePricingNeedsRecalculation(
  review: ReviewDraftFormState["reviewedLineItemsJson"][number]["pricingReviewJson"],
  quantity: number | null,
): ReviewDraftFormState["reviewedLineItemsJson"][number]["pricingReviewJson"] {
  const effective = resolveInboundLineEffectivePricing(review, quantity ?? 1);
  return {
    status: "not_available",
    message: "Pricing needs recalculation.",
    acknowledged: false,
    resolution: null,
    resolutionNote: null,
    poPriceCents: review?.poPriceCents ?? null,
    poUnitPriceCents: review?.poUnitPriceCents ?? null,
    poExtendedPriceCents: review?.poExtendedPriceCents ?? null,
    poRushFeesCents: review?.poRushFeesCents ?? null,
    poTotalPriceCents: review?.poTotalPriceCents ?? null,
    systemPriceCents: null,
    systemUnitPriceCents: null,
    differenceCents: null,
    comparisonType: null,
    sourceEvidence: review?.sourceEvidence ?? [],
    alternatePricingNotes: review?.alternatePricingNotes ?? [],
    evaluatedAt: null,
    priceOverrideMode: review?.priceOverrideMode ?? null,
    priceOverrideValueCents: review?.priceOverrideValueCents ?? null,
    priceOverrideSource: review?.priceOverrideSource ?? null,
    effectiveUnitPriceCents: effective.effectiveUnitPriceCents,
    effectiveTotalCents: effective.effectiveTotalCents,
  };
}

function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function titleCase(value: string | null | undefined) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "-";
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getPathValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function stringsFromUnknown(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return item.trim() ? [item.trim()] : [];
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return [
          stringFromUnknown(record.email),
          stringFromUnknown(record.address),
          stringFromUnknown(record.name),
        ].filter(Boolean).slice(0, 1) as string[];
      }
      return [];
    });
  }
  return [];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeEmailHtml(html: string): string {
  if (typeof DOMParser === "undefined") return escapeHtml(html);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form, input, button").forEach((node) => node.remove());
  doc.body.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on")
        || name === "style"
        || name === "src"
        || name === "srcset"
        || name === "poster"
        || name === "background"
        || value.startsWith("javascript:")
        || value.startsWith("data:")
      ) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.tagName.toLowerCase() === "a") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  });
  return doc.body.innerHTML;
}

function getInboundEmailEvidence(record: Pick<ClientInboundOrderRecord, "rawPayloadJson" | "normalizedPayloadJson" | "receivedAt" | "externalReference">) {
  const raw = record.rawPayloadJson ?? {};
  const normalized = record.normalizedPayloadJson ?? {};
  const manual = getManualInboundEvidence(record as any);
  return {
    ...manual,
    bodyHtml: stringFromUnknown(getPathValue(raw, "bodyHtml")) ?? stringFromUnknown(getPathValue(normalized, "bodyHtml")),
    receivedAt: stringFromUnknown(getPathValue(raw, "receivedAt")) ?? stringFromUnknown(getPathValue(normalized, "receivedAt")) ?? record.receivedAt,
    recipients: [
      ...stringsFromUnknown(getPathValue(raw, "to")),
      ...stringsFromUnknown(getPathValue(raw, "recipients")),
      ...stringsFromUnknown(getPathValue(raw, "headers.to")),
      ...stringsFromUnknown(getPathValue(normalized, "to")),
      ...stringsFromUnknown(getPathValue(normalized, "recipients")),
    ],
    cc: [
      ...stringsFromUnknown(getPathValue(raw, "cc")),
      ...stringsFromUnknown(getPathValue(raw, "headers.cc")),
      ...stringsFromUnknown(getPathValue(normalized, "cc")),
    ],
    thread: (typeof getPathValue(raw, "thread") === "object" && getPathValue(raw, "thread") !== null)
      ? getPathValue(raw, "thread") as Record<string, unknown>
      : (typeof getPathValue(normalized, "thread") === "object" && getPathValue(normalized, "thread") !== null)
        ? getPathValue(normalized, "thread") as Record<string, unknown>
        : null,
  };
}

function threadMessagesFromEvidence(thread: Record<string, unknown> | null | undefined): Array<Record<string, unknown>> {
  const messages = thread && Array.isArray(thread.messages) ? thread.messages : [];
  return messages.filter((message): message is Record<string, unknown> => (
    Boolean(message) && typeof message === "object" && !Array.isArray(message)
  ));
}

function threadMessagesLatestFirst(thread: Record<string, unknown> | null | undefined): Array<Record<string, unknown>> {
  return threadMessagesFromEvidence(thread).slice().sort((left, right) => (
    new Date(stringFromUnknown(right.receivedAt) ?? 0).getTime() - new Date(stringFromUnknown(left.receivedAt) ?? 0).getTime()
  ));
}

function threadMessageRecipients(message: Record<string, unknown>, key: "to" | "cc"): string[] {
  const value = message[key];
  if (!Array.isArray(value)) return [];
  return value.map(stringFromUnknown).filter((item): item is string => Boolean(item));
}

function splitQuotedMessageText(value: string | null | undefined): { current: string; quoted: string | null } {
  const text = String(value ?? "").trim();
  if (!text) return { current: "", quoted: null };
  const patterns = [
    /\n\s*On .{5,240} wrote:\s*/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}\s*/i,
    /\n\s*From:\s+.+\n\s*Sent:\s+.+\n/i,
    /\n\s*_{8,}\s*\n/,
  ];
  const indexes = patterns
    .map((pattern) => {
      const match = text.match(pattern);
      return match?.index ?? -1;
    })
    .filter((index) => index > 0);
  if (indexes.length === 0) return { current: text, quoted: null };
  const index = Math.min(...indexes);
  return {
    current: text.slice(0, index).trim(),
    quoted: text.slice(index).trim(),
  };
}

function providerMessageIdForFile(file: ClientInboundOrderFile): string | null {
  return stringFromUnknown(file.providerMessageId) ?? stringFromUnknown(getPathValue(file.metadataJson, "providerMessageId"));
}

function isLikelySignatureInlineFile(file: ClientInboundOrderFile): boolean {
  const metadata = attachmentSafetyMetadata(file);
  const filename = String(file.sourceFilename ?? "").toLowerCase();
  const mimeType = String(file.mimeType ?? "").toLowerCase();
  const disposition = String(file.contentDisposition ?? metadata.contentDisposition ?? "").toLowerCase();
  const contentId = String(metadata.contentId ?? "").toLowerCase();
  const imageType = /^image\/(?:gif|png|jpe?g)$/i.test(mimeType);
  if (!imageType) return false;
  const inlineSignal = disposition.includes("inline") || Boolean(contentId);
  const smallSignal = typeof file.sizeBytes === "number" && file.sizeBytes > 0 && file.sizeBytes <= 40_000;
  const filenameSignal = /(?:^|[-_\s])(image\d{2,}|logo|signature|sig|facebook|linkedin|instagram|twitter|x-icon|spacer|pixel)(?:[-_\s.]|$)/i.test(filename);
  return inlineSignal && (smallSignal || filenameSignal);
}

function dedupeAttachmentFiles(files: ClientInboundOrderFile[]): ClientInboundOrderFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const filename = String(file.sourceFilename ?? "").toLowerCase();
    const size = file.sizeBytes ?? null;
    const mimeType = String(file.mimeType ?? "").toLowerCase();
    const globalKey = filename && size != null && mimeType
      ? `global:${filename}:${size}:${mimeType}`
      : null;
    const providerKey = file.providerAttachmentId
      ? `provider:${providerMessageIdForFile(file) ?? ""}:${file.providerAttachmentId}`
      : null;
    const fallbackKey = `file:${providerMessageIdForFile(file) ?? ""}:${filename}:${size ?? ""}:${mimeType}`;
    const signatureKey = isLikelySignatureInlineFile(file)
      ? `signature:${String(file.sourceFilename ?? "").toLowerCase()}:${file.sizeBytes ?? ""}:${file.mimeType ?? ""}`
      : null;
    const key = signatureKey ?? globalKey ?? providerKey ?? fallbackKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachmentSeenMessageCount(file: ClientInboundOrderFile): number | null {
  const metadata = attachmentSafetyMetadata(file);
  if (typeof metadata.seenInMessageCount === "number" && metadata.seenInMessageCount > 1) return metadata.seenInMessageCount;
  if (Array.isArray(metadata.seenProviderMessageIds) && metadata.seenProviderMessageIds.length > 1) {
    return new Set(metadata.seenProviderMessageIds.filter((entry) => typeof entry === "string")).size;
  }
  return null;
}

function groupFilesByThreadMessage(files: ClientInboundOrderFile[], thread: Record<string, unknown> | null | undefined) {
  const messages = threadMessagesFromEvidence(thread);
  const uniqueFiles = dedupeAttachmentFiles(files);
  if (messages.length === 0) {
    return [{ key: "attachments", label: "Attachments", detail: null as string | null, files: uniqueFiles }];
  }
  const fileGroups = new Map<string, ClientInboundOrderFile[]>();
  for (const file of uniqueFiles) {
    const key = providerMessageIdForFile(file) ?? "unmatched";
    fileGroups.set(key, [...(fileGroups.get(key) ?? []), file]);
  }
  const groups = messages
    .map((message, index) => {
      const messageId = stringFromUnknown(message.messageId) ?? `message_${index}`;
      const sender = [stringFromUnknown(message.senderName), stringFromUnknown(message.senderEmail)]
        .filter(Boolean)
        .join(" / ");
      const receivedAt = stringFromUnknown(message.receivedAt);
      return {
        key: messageId,
        label: stringFromUnknown(message.subject) || `Thread message ${index + 1}`,
        detail: [sender || null, receivedAt ? formatTimestamp(receivedAt) : null].filter(Boolean).join(" / ") || null,
        files: fileGroups.get(messageId) ?? [],
      };
    })
    .filter((group) => group.files.length > 0);
  const matchedIds = new Set(groups.map((group) => group.key));
  const unmatched = Array.from(fileGroups.entries())
    .filter(([messageId]) => !matchedIds.has(messageId))
    .flatMap(([, groupFiles]) => groupFiles);
  if (unmatched.length > 0) {
    groups.push({ key: "unmatched", label: "Other Message Attachments", detail: null, files: unmatched });
  }
  return groups.length > 0 ? groups : [{ key: "attachments", label: "Attachments", detail: null, files: uniqueFiles }];
}

function compactRecipientLine(values: string[]) {
  if (values.length === 0) return "-";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function SourceEvidenceFileCard({
  recordId,
  file,
  onClassify,
  useInAppViewer = false,
  onOpenAttachment,
}: {
  recordId: string;
  file: ClientInboundOrderFile;
  onClassify?: () => void;
  useInAppViewer?: boolean;
  onOpenAttachment?: (recordId: string, file: ClientInboundOrderFile) => void;
}) {
  const downloadUrl = inboundFileDownloadUrl(recordId, file);
  return (
    <div
      className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 overflow-hidden rounded-md border border-border bg-background px-3 py-2"
      data-testid="source-evidence-file-card"
    >
      <div className="min-w-0 flex-1">
        <div className="min-w-0 truncate break-words text-sm font-medium text-foreground">{file.sourceFilename || "Attachment"}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={file.role === "po" ? "default" : file.role === "artwork" ? "secondary" : "outline"}>
            {inboundAttachmentRoleLabel(file.role)}
          </Badge>
          {isArchiveAttachment(file) && <Badge variant="outline">ZIP / archive</Badge>}
          {isQuarantinedAttachment(file) && <Badge variant="destructive">Quarantined</Badge>}
          <span>{titleCase(file.status)}</span>
          <span>{formatFileSize(file.sizeBytes)}</span>
          {!file.fileRecordId && <Badge variant="outline">Metadata only</Badge>}
        </div>
        {!file.fileRecordId && (
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            File unavailable: {inboundFileUnavailableReason(file)}
          </div>
        )}
        <InboundPdfSizeStatus recordId={recordId} file={file} />
      </div>
      {useInAppViewer ? (
        <CleanAttachmentFileActions recordId={recordId} file={file} onClassify={onClassify} onOpenAttachment={onOpenAttachment} />
      ) : downloadUrl ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <a href={downloadUrl} download>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CleanAttachmentFileActions({
  recordId,
  file,
  onClassify,
  className,
  onOpenAttachment,
}: {
  recordId: string;
  file: ClientInboundOrderFile;
  onClassify?: () => void;
  className?: string;
  onOpenAttachment?: (recordId: string, file: ClientInboundOrderFile) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const downloadUrl = inboundFileDownloadUrl(recordId, file);
  const filename = file.sourceFilename || "attachment";
  const metadata = attachmentSafetyMetadata(file);
  const recoverableProviderAttachmentId = file.providerAttachmentId ?? metadata.providerAttachmentId;
  const recoverableProviderMessageId = file.providerMessageId ?? metadata.providerMessageId;
  const retrySupported = Boolean(
    !file.fileRecordId
      && recoverableProviderAttachmentId
      && recoverableProviderMessageId
      && String(metadata.attachmentState ?? "") !== "blocked_file_type",
  );
  const retryLabel = String(metadata.attachmentState ?? "") === "download_failed" ? "Retry download" : "Fetch file";
  const retryMutation = useMutation({
    mutationFn: () => postJson<{ success: boolean; data: ClientInboundOrderFile }>(
      `/api/inbound-orders/${encodeURIComponent(recordId)}/files/${encodeURIComponent(file.id)}/trust-action`,
      { action: "download_once" },
    ),
    onSuccess: async (response) => {
      queryClient.setQueryData<ClientInboundOrderDetailResponse | undefined>(["/api/inbound-orders", recordId], (current) => {
        if (!current?.data) return current;
        return {
          ...current,
          data: {
            ...current.data,
            files: current.data.files.map((candidate) => candidate.id === file.id ? response.data : candidate),
          },
        };
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] });
      toast({ title: "Attachment fetched", description: `${filename} is now available to open or download.` });
    },
    onError: (error: Error) => {
      toast({ title: "Attachment fetch failed", description: error.message, variant: "destructive" });
    },
  });

  const handleOpen = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!downloadUrl) return;
    onOpenAttachment?.(recordId, file);
  };

  const handleDownload = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!downloadUrl) return;
    try {
      const { blob } = await fetchInboundAttachmentBlob(recordId, file);
      downloadBlob(blob, filename);
    } catch (error) {
      toast({
        title: "Attachment download failed",
        description: error instanceof Error ? error.message : "The file could not be downloaded.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-1", className)} data-testid="clean-attachment-actions">
      {downloadUrl ? (
        <>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={handleOpen} aria-label={`Open ${filename}`}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={handleDownload} aria-label={`Download ${filename}`}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
        </>
      ) : (
        <>
          <span className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground" title={inboundFileUnavailableReason(file)}>
            {inboundFileUnavailableLabel(file)}
          </span>
          {retrySupported && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              disabled={retryMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                retryMutation.mutate();
              }}
            >
              {retryMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {retryLabel}
            </Button>
          )}
        </>
      )}
      {onClassify && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onClassify();
          }}
        >
          Classify
        </Button>
      )}
    </div>
  );
}

function CleanInlineAttachmentViewer({
  selection,
  onClose,
}: {
  selection: CleanInlineAttachmentSelection;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<any | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfFitMode, setPdfFitMode] = useState<"width" | "custom">("width");
  const [pdfZoomLevel, setPdfZoomLevel] = useState(1);
  const [pdfRenderedScale, setPdfRenderedScale] = useState(1);
  const [pdfStageWidth, setPdfStageWidth] = useState(0);
  const [pdfCanvasElement, setPdfCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [pdfRenderStatus, setPdfRenderStatus] = useState<"idle" | "loading" | "rendered" | "error">("idle");
  const pdfStageRef = useRef<HTMLDivElement | null>(null);
  const pdfRenderTaskRef = useRef<any | null>(null);
  const file = selection?.file ?? null;
  const recordId = selection?.recordId ?? null;
  const filename = file?.sourceFilename || "attachment";
  const isPdfPreview = Boolean(file && (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")));
  const isImagePreview = Boolean(mimeType?.startsWith("image/"));
  const displayedPdfScale = pdfFitMode === "custom" ? pdfZoomLevel : pdfRenderedScale;

  useEffect(() => {
    if (!selection) {
      setObjectUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      setMimeType(null);
      setError(null);
      setLoading(false);
      setModalOpen(false);
      setPdfDocument(null);
      setPdfPageCount(0);
      setPdfPageNumber(1);
      setPdfFitMode("width");
      setPdfZoomLevel(1);
      setPdfRenderedScale(1);
      setPdfCanvasElement(null);
      setPdfRenderStatus("idle");
      return;
    }
    let cancelled = false;
    let nextObjectUrl: string | null = null;
    let loadedPdfDocument: any | null = null;
    setLoading(true);
    setError(null);
    setMimeType(null);
    setPdfDocument(null);
    setPdfPageCount(0);
    setPdfPageNumber(1);
    setPdfFitMode("width");
    setPdfZoomLevel(1);
    setPdfRenderedScale(1);
    setPdfCanvasElement(null);
    setPdfRenderStatus("idle");
    setObjectUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    fetchInboundAttachmentBlob(selection.recordId, selection.file)
      .then(async ({ blob, mimeType: nextMimeType }) => {
        if (cancelled) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
        setMimeType(nextMimeType);
        const shouldRenderPdf = nextMimeType === "application/pdf" || selection.file.sourceFilename?.toLowerCase().endsWith(".pdf");
        if (shouldRenderPdf) {
          const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
          if (cancelled) return;
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          const pdfBytes = await readBlobArrayBuffer(blob);
          if (cancelled) return;
          const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(pdfBytes),
            cMapUrl: pdfCMapUrl,
            cMapPacked: true,
            standardFontDataUrl: pdfStandardFontDataUrl,
            useWorkerFetch: false,
            isEvalSupported: false,
            stopAtErrors: true,
          });
          loadedPdfDocument = await loadingTask.promise;
          if (cancelled) {
            await loadedPdfDocument.destroy().catch(() => undefined);
            return;
          }
          setPdfDocument(loadedPdfDocument);
          setPdfPageCount(loadedPdfDocument.numPages ?? 0);
          setPdfPageNumber(1);
        }
      })
      .catch((fetchError) => {
        if (cancelled) return;
        const message = fetchError instanceof Error ? fetchError.message : "The file could not be opened.";
        setError(message);
        toast({ title: "Attachment open failed", description: message, variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore render cancellation
        }
        pdfRenderTaskRef.current = null;
      }
      if (loadedPdfDocument) void loadedPdfDocument.destroy().catch(() => undefined);
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [selection?.recordId, selection?.file.id]);

  useEffect(() => {
    if (!isPdfPreview || !pdfStageRef.current) return;
    const element = pdfStageRef.current;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setPdfStageWidth(Math.max(240, Math.round(rect.width || element.clientWidth || 640)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isPdfPreview, objectUrl]);

  useEffect(() => {
    if (!isPdfPreview || !pdfDocument || !pdfCanvasElement) return;
    let cancelled = false;
    setPdfRenderStatus("loading");
    void (async () => {
      try {
        const page = await pdfDocument.getPage(pdfPageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const measuredStageWidth = pdfStageWidth || pdfStageRef.current?.clientWidth || 640;
        const fitWidthScale = Math.max(0.1, (measuredStageWidth - 24) / Math.max(baseViewport.width, 1));
        const targetScale = pdfFitMode === "width" ? fitWidthScale : pdfZoomLevel;
        const clampedScale = clampCleanViewerZoom(targetScale);
        const viewport = page.getViewport({ scale: clampedScale });
        const canvas = pdfCanvasElement;
        const context = canvas.getContext("2d");
        if (!context) {
          setError("Canvas preview unavailable.");
          setPdfRenderStatus("error");
          return;
        }
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (pdfRenderTaskRef.current) {
          try {
            pdfRenderTaskRef.current.cancel();
          } catch {
            // ignore render cancellation
          }
        }
        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: devicePixelRatio === 1 ? undefined : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });
        pdfRenderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) {
          setPdfRenderedScale(clampedScale);
          setPdfRenderStatus("rendered");
          setError(null);
        }
      } catch (renderError: any) {
        if (cancelled || renderError?.name === "RenderingCancelledException") return;
        setPdfRenderStatus("error");
        setError(renderError instanceof Error ? renderError.message : "Unable to render PDF page.");
      }
    })();
    return () => {
      cancelled = true;
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore render cancellation
        }
        pdfRenderTaskRef.current = null;
      }
    };
  }, [isPdfPreview, pdfCanvasElement, pdfDocument, pdfFitMode, pdfPageNumber, pdfStageWidth, pdfZoomLevel]);

  const handleDownload = async (event?: ReactMouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    if (!selection) return;
    try {
      const { blob } = await fetchInboundAttachmentBlob(selection.recordId, selection.file);
      downloadBlob(blob, filename);
    } catch (downloadError) {
      toast({
        title: "Attachment download failed",
        description: downloadError instanceof Error ? downloadError.message : "The file could not be downloaded.",
        variant: "destructive",
      });
    }
  };

  const previewContent = (large = false) => {
    const frameHeight = large ? "h-[70vh]" : "h-[440px]";
    if (loading) {
      return (
        <div className={cn("flex items-center justify-center text-sm text-slate-400", frameHeight)}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading attachment...
        </div>
      );
    }
    if (objectUrl && isPdfPreview) {
      return (
        <div className="overflow-hidden rounded border border-slate-800 bg-slate-950" data-testid="clean-attachment-pdf-viewer">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-2 py-2 text-xs text-slate-200" data-testid="clean-pdf-controls">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setPdfPageNumber((page) => Math.max(1, page - 1))}
                disabled={pdfPageNumber <= 1 || pdfPageCount <= 1}
                aria-label="Previous PDF page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-20 text-center font-semibold">
                {pdfPageCount > 0 ? `${pdfPageNumber} / ${pdfPageCount}` : "Page -"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setPdfPageNumber((page) => Math.min(pdfPageCount || page, page + 1))}
                disabled={pdfPageCount <= 1 || pdfPageNumber >= pdfPageCount}
                aria-label="Next PDF page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setPdfFitMode("custom");
                  setPdfZoomLevel((zoom) => clampCleanViewerZoom(zoom - 0.15));
                }}
                aria-label="Zoom out PDF"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-14 text-center font-semibold" data-testid="clean-pdf-zoom-label">{Math.round(displayedPdfScale * 100)}%</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setPdfFitMode("custom");
                  setPdfZoomLevel((zoom) => clampCleanViewerZoom(zoom + 0.15));
                }}
                aria-label="Zoom in PDF"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant={pdfFitMode === "width" ? "outline" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setPdfFitMode("width")}
                data-testid="clean-pdf-fit-width"
              >
                Fit width
              </Button>
            </div>
          </div>
          <div
            ref={pdfStageRef}
            className={cn("relative min-w-0 overflow-auto bg-slate-800 p-3", frameHeight)}
            data-fit-mode={pdfFitMode}
            data-testid="clean-pdf-canvas-stage"
          >
            {error ? (
              <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
            ) : pdfDocument ? (
              <div className="flex min-w-max justify-center">
                <canvas
                  ref={setPdfCanvasElement}
                  className={cn("rounded bg-white shadow-lg", pdfRenderStatus !== "rendered" && "opacity-30")}
                  data-testid="clean-pdf-page-canvas"
                />
                {pdfRenderStatus !== "rendered" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-sm text-slate-100" data-testid="clean-pdf-render-loading">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rendering PDF page...
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing PDF preview...
              </div>
            )}
          </div>
        </div>
      );
    }
    if (error) {
      return <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>;
    }
    if (objectUrl && isImagePreview) {
      return <img src={objectUrl} alt={filename} className={cn("w-full rounded object-contain", frameHeight)} data-testid="clean-attachment-image-viewer" />;
    }
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 rounded bg-slate-950 text-center text-sm text-slate-400", frameHeight)}>
        <FileText className="h-8 w-8" />
        <div className="font-semibold text-slate-100">Preview unavailable</div>
        <div>{file?.mimeType || mimeType || "Unknown file type"}</div>
        <div>Use Download to inspect this attachment.</div>
      </div>
    );
  };

  if (!selection || !file || !recordId) return null;

  return (
    <section className="mb-4 overflow-hidden rounded border border-blue-400/40 bg-slate-900 shadow-xl" data-testid="clean-inline-attachment-viewer">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-200">Document Viewer</div>
          <div className="break-words text-sm font-semibold text-slate-100">{filename}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setModalOpen(true)} disabled={!objectUrl && !error}>
            <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
            Expand
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={handleDownload} disabled={!inboundFileDownloadUrl(recordId, file)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onClose}>Close viewer</Button>
        </div>
      </div>
      <div className="min-w-0 overflow-hidden p-3">
        {previewContent(false)}
      </div>
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Attachment Viewer</DialogTitle>
            <DialogDescription>{filename}</DialogDescription>
          </DialogHeader>
          <div className="min-h-[420px] rounded-md border border-border bg-muted/20 p-3" data-testid="clean-attachment-viewer">
            {previewContent(true)}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Close</Button>
            <Button type="button" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EmailDocumentBodySurface({
  html,
  text,
}: {
  html: string | null;
  text: string | null;
}) {
  if (html) {
    return (
      <div
        className="prose prose-sm max-w-none rounded-md bg-white p-6 text-slate-950 shadow-sm [&_*]:max-w-full"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (text) {
    const split = splitQuotedMessageText(text);
    return (
      <div className="rounded-md border border-border bg-background p-5 text-sm leading-6 text-foreground shadow-sm">
        <div className="whitespace-pre-wrap">{split.current || text}</div>
        {split.quoted && (
          <details className="mt-4 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Quoted content in this message</summary>
            <div className="mt-2 whitespace-pre-wrap leading-5">{split.quoted}</div>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
      No email body was captured.
    </div>
  );
}

function SourceEmailDocumentViewer({
  record,
  evidence,
  files,
}: {
  record: ClientInboundOrderRecord;
  evidence: ReturnType<typeof getInboundEmailEvidence>;
  files: ClientInboundOrderFile[];
}) {
  const messages = threadMessagesLatestFirst(evidence.thread);
  const latest = messages[0] ?? null;
  const subject = latest
    ? stringFromUnknown(latest.displaySubject) ?? stringFromUnknown(latest.subject) ?? evidence.subject
    : evidence.subject;
  const sender = latest
    ? [stringFromUnknown(latest.senderName), stringFromUnknown(latest.senderEmail)].filter(Boolean).join(" / ")
    : getSenderLabel(record);
  const receivedAt = latest ? stringFromUnknown(latest.receivedAt) ?? evidence.receivedAt : evidence.receivedAt;
  const to = latest ? threadMessageRecipients(latest, "to") : evidence.recipients;
  const cc = latest ? threadMessageRecipients(latest, "cc") : evidence.cc;
  const html = latest ? stringFromUnknown(latest.bodyHtml) : evidence.bodyHtml;
  const text = latest ? stringFromUnknown(latest.bodyText) : evidence.bodyText;
  const threadMessageCount = typeof evidence.thread?.messageCount === "number"
    ? evidence.thread.messageCount
    : messages.length || null;

  return (
    <section
      className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-start px-3 py-4"
      data-testid="source-document-viewer"
    >
      <div className="rounded-lg border border-border bg-muted/20 p-3 shadow-sm">
        <div className="rounded-md border border-border bg-background px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">Email Source Document</h3>
              <div className="mt-1 truncate text-sm font-medium text-foreground">{subject || "No subject"}</div>
            </div>
            <Badge variant="outline">{html ? "HTML" : "Text"}</Badge>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div><span className="font-medium text-foreground">From:</span> {sender || "-"}</div>
            <div><span className="font-medium text-foreground">Received:</span> {formatTimestamp(receivedAt)}</div>
            <div><span className="font-medium text-foreground">To:</span> {compactRecipientLine(to)}</div>
            <div><span className="font-medium text-foreground">Thread:</span> {threadMessageCount ? `${threadMessageCount} message${threadMessageCount === 1 ? "" : "s"}` : "Single message"}</div>
            {cc.length > 0 && <div className="sm:col-span-2"><span className="font-medium text-foreground">Cc:</span> {compactRecipientLine(cc)}</div>}
          </div>
        </div>

        <div className="mt-3">
          <EmailDocumentBodySurface html={html ? sanitizeEmailHtml(html) : null} text={text} />
        </div>

        <div className="mt-3 rounded-md border border-border bg-background px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Integrated Evidence</h3>
            <Badge variant="outline">{files.length}</Badge>
          </div>
          <div className="mt-2 space-y-1.5">
            {files.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                No attachments linked to this inbound record.
              </div>
            ) : files.map((file) => (
              <SourceEvidenceFileCard key={file.id} recordId={record.id} file={file} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceHistoryPanel({
  thread,
}: {
  thread: Record<string, unknown> | null | undefined;
}) {
  const messages = threadMessagesFromEvidence(thread);
  if (messages.length === 0) {
    return (
      <div className="p-3">
        <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          No thread history captured.
        </div>
      </div>
    );
  }
  return (
    <section className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Thread Timeline</h3>
        <Badge variant="outline">{messages.length} messages</Badge>
      </div>
      {messages.map((message, index) => {
        const key = stringFromUnknown(message.messageId) ?? `history_${index}`;
        const isLatest = index === messages.length - 1;
        return (
          <details key={key} className="rounded-md border border-border bg-card p-2" open={isLatest}>
            <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Message {index + 1}</div>
                  <div className="truncate text-sm font-semibold text-foreground">
                    {stringFromUnknown(message.displaySubject) ?? stringFromUnknown(message.subject) ?? `Message ${index + 1}`}
                  </div>
                </div>
                <Badge variant="outline">{stringFromUnknown(message.receivedAt) ? formatTimestamp(stringFromUnknown(message.receivedAt)) : "No date"}</Badge>
              </div>
            </summary>
            <div className="mt-2">
              <ThreadMessageBlock message={message} index={index + 1} />
            </div>
          </details>
        );
      })}
    </section>
  );
}

function cleanHighlightClass(target: CleanHighlightTarget, activeTarget: CleanHighlightTarget | null) {
  return activeTarget === target
    ? "ring-2 ring-blue-300 ring-offset-2 ring-offset-slate-950 border-blue-300 shadow-[0_0_0_1px_rgba(147,197,253,0.35)]"
    : "";
}

function cleanEvidenceHighlightClass(target: CleanHighlightTarget, activeTarget: CleanHighlightTarget | null) {
  return activeTarget === target
    ? "bg-blue-100 text-blue-950 shadow-[0_0_0_2px_rgba(59,130,246,0.28)]"
    : "";
}

function cleanSourceLabel(source: string | null | undefined) {
  if (!source) return "Source: AI parse";
  if (source === "attachment") return "Source: Attachment";
  if (source === "staff_selected") return "Source: Staff";
  if (source.includes("email") || source.includes("source") || source.includes("deterministic")) return "Source: Email body";
  if (source.includes("pdf") || source.includes("po")) return "Source: PO";
  return `Source: ${selectionSourceLabel(source, null)}`;
}

function cleanShortSourceLabel(source: string | null | undefined, target?: CleanHighlightTarget) {
  if (target === "artwork") return "Attachment";
  if (source === "attachment") return "Attachment";
  if (source?.includes("pdf") || source?.includes("po")) return "PO document";
  if (source?.includes("email") || source?.includes("source") || source?.includes("deterministic")) return "Email";
  if (source === "staff_selected") return "Staff";
  if (!source) return "AI";
  return selectionSourceLabel(source, null).replace(/^Source /, "");
}

function cleanConfidenceLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Confidence pending";
  const normalized = value > 0 && value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${Math.max(0, Math.min(100, normalized))}%`;
}

function numberWord(value: number | null | undefined): string | null {
  if (value === 1) return "one";
  if (value === 2) return "two";
  if (value === 3) return "three";
  if (value === 4) return "four";
  if (value === 5) return "five";
  return value == null ? null : String(value);
}

function cleanCompletionChecklist(
  form: ReviewDraftFormState,
  reviewDraft: InboundOrderReviewDraftDto,
) {
  const firstLine = form.reviewedLineItemsJson[0] ?? null;
  const hasCustomer = Boolean(form.reviewedCustomerJson.selectedCustomerId || form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.sourceName || form.reviewedCustomerJson.unresolvedCustomer);
  const hasProduct = Boolean(firstLine?.selectedProductId || (firstLine?.productName && !firstLine.productUnresolved));
  const hasQuantity = Boolean(firstLine?.quantity);
  const artworkLinked = form.reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  const dueDate = Boolean(form.reviewedOrderJson.dueDate);
  const pricingReviewed = form.reviewedLineItemsJson.every((lineItem) => (
    !lineItem.pricingReviewJson
    || lineItem.pricingReviewJson.status === "matched"
    || lineItem.pricingReviewJson.status === "not_available"
    || Boolean(lineItem.pricingReviewJson.acknowledged && lineItem.pricingReviewJson.resolution)
  ));
  return [
    { label: "Customer matched", complete: hasCustomer, target: "customer" as const },
    { label: "Product resolved", complete: hasProduct, target: "product" as const },
    { label: "Quantity confirmed", complete: hasQuantity, target: "quantity" as const },
    { label: "Artwork linked", complete: artworkLinked, target: "artwork" as const },
    { label: "Due date identified", complete: dueDate, target: "dueDate" as const },
    { label: "Pricing reviewed", complete: pricingReviewed && reviewDraft.validationErrors.every((error) => !error.toLowerCase().includes("price")), target: "pricing" as const },
  ];
}

function cleanEvidenceComparison(
  target: CleanHighlightTarget | null,
  form: ReviewDraftFormState,
  draft: InboundOrderParsedDraft,
) {
  if (!target) return null;
  const firstLine = form.reviewedLineItemsJson[0] ?? null;
  const parsedLine = draft.lineItems[0] ?? null;
  const targetLabel: Record<CleanHighlightTarget, string> = {
    customer: "Customer",
    product: "Product",
    quantity: "Quantity",
    dimensions: "Size",
    artwork: "Artwork",
    po: "PO number",
    dueDate: "Due date",
    pricing: "Pricing",
  };
  const primarySource = target === "customer"
    ? form.reviewedCustomerJson.selectedCustomerSource
    : target === "product"
      ? firstLine?.selectedProductSource
      : target === "quantity"
        ? firstLine?.quantitySource
        : target === "dimensions"
          ? firstLine?.dimensionsSource
          : target === "artwork"
            ? "attachment"
            : "po_pdf";
  const confidence = target === "customer"
    ? form.reviewedCustomerJson.selectedCustomerConfidence
    : target === "product"
      ? firstLine?.interpretedProductConfidence
      : target === "artwork"
        ? draft.artwork[0]?.confidence
        : parsedLine?.confidence ?? draft.order.confidence;
  const warningText = [
    ...form.warningsJson.map((warning) => warning.message),
    ...form.missingDecisionsJson.map((decision) => `${decision.label} ${decision.reason}`),
  ].join(" ").toLowerCase();
  const conflict = warningText.includes(targetLabel[target].toLowerCase())
    || (target === "dimensions" && warningText.includes("size"))
    || (target === "po" && warningText.includes("po"))
    || (target === "artwork" && warningText.includes("artwork"));
  return {
    label: targetLabel[target],
    primary: cleanShortSourceLabel(primarySource, target),
    secondary: target === "artwork" ? "Email" : target === "po" || target === "dueDate" ? "Email" : "PO document",
    confidence: cleanConfidenceLabel(confidence),
    conflict,
  };
}

function CleanInlineSourceButton({
  children,
  target,
  onFocusTarget,
  activeTarget,
}: {
  children: ReactNode;
  target: CleanHighlightTarget;
  onFocusTarget: CleanFocusTargetHandler;
  activeTarget: CleanHighlightTarget | null;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded px-1 font-semibold text-blue-800 underline decoration-blue-300 decoration-2 underline-offset-2 transition-colors hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        activeTarget === target ? "bg-blue-200" : "bg-blue-100",
      )}
      onClick={() => onFocusTarget(target)}
      onMouseEnter={() => onFocusTarget(target)}
      onFocus={() => onFocusTarget(target)}
      data-clean-source-target={target}
      data-highlighted={activeTarget === target ? "true" : "false"}
    >
      {children}
    </button>
  );
}

function CleanSourceChip({
  target,
  source,
  confidence,
  onFocusTarget,
}: {
  target: CleanHighlightTarget;
  source: string | null | undefined;
  confidence?: number | null;
  onFocusTarget: CleanFocusTargetHandler;
}) {
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200 hover:border-blue-300 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      onClick={(event) => {
        event.stopPropagation();
        onFocusTarget(target, { inspectSource: true });
      }}
      onFocus={() => onFocusTarget(target)}
      data-testid={`clean-source-chip-${target}`}
      title={`${cleanSourceLabel(source)} / ${cleanConfidenceLabel(confidence)}`}
    >
      <span>{cleanShortSourceLabel(source, target)}</span>
      {confidence != null && <span className="text-slate-500">{cleanConfidenceLabel(confidence)}</span>}
    </button>
  );
}

function CleanInteractiveEmailText({
  text,
  lineItem,
  poNumber,
  dueDate,
  onFocusTarget,
  activeTarget,
}: {
  text: string | null;
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number] | null;
  poNumber: string | null | undefined;
  dueDate: string | null | undefined;
  onFocusTarget: CleanFocusTargetHandler;
  activeTarget: CleanHighlightTarget | null;
}) {
  if (!text) {
    return <EmailDocumentBodySurface html={null} text={text} />;
  }
  const product = lineItem?.productName ?? null;
  const size = lineItem?.width && lineItem?.height ? `${lineItem.width} x ${lineItem.height}` : null;
  const quantity = numberWord(lineItem?.quantity ?? null);
  const escaped = [poNumber, dueDate, product, size, quantity]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return <EmailDocumentBodySurface html={null} text={text} />;
  }
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-950 shadow-sm">
      <div className="whitespace-pre-wrap">
        {parts.map((part, index) => {
          const normalized = part.toLowerCase();
          if (poNumber && normalized === poNumber.toLowerCase()) {
            return <CleanInlineSourceButton key={`${part}-${index}`} target="po" onFocusTarget={onFocusTarget} activeTarget={activeTarget}>{part}</CleanInlineSourceButton>;
          }
          if (dueDate && normalized === dueDate.toLowerCase()) {
            return <CleanInlineSourceButton key={`${part}-${index}`} target="dueDate" onFocusTarget={onFocusTarget} activeTarget={activeTarget}>{part}</CleanInlineSourceButton>;
          }
          if (product && normalized === product.toLowerCase()) {
            return <CleanInlineSourceButton key={`${part}-${index}`} target="product" onFocusTarget={onFocusTarget} activeTarget={activeTarget}>{part}</CleanInlineSourceButton>;
          }
          if (size && normalized === size.toLowerCase()) {
            return <CleanInlineSourceButton key={`${part}-${index}`} target="dimensions" onFocusTarget={onFocusTarget} activeTarget={activeTarget}>{part}</CleanInlineSourceButton>;
          }
          if (quantity && normalized === quantity.toLowerCase()) {
            return <CleanInlineSourceButton key={`${part}-${index}`} target="quantity" onFocusTarget={onFocusTarget} activeTarget={activeTarget}>{part}</CleanInlineSourceButton>;
          }
          return <span key={`${part}-${index}`}>{part}</span>;
        })}
      </div>
    </div>
  );
}

function ThreadTimeline({ thread, compact = false }: { thread: Record<string, unknown> | null | undefined; compact?: boolean }) {
  const messages = threadMessagesFromEvidence(thread);
  if (messages.length === 0) return null;
  const attachmentCount = messages.reduce((total, message) => (
    total + (typeof message.attachmentCount === "number" ? message.attachmentCount : 0)
  ), 0);
  const latestActivity = messages
    .map((message) => stringFromUnknown(message.receivedAt))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const timelineBody = (
    <div className="space-y-1.5">
      {messages.map((message, index) => {
        const messageId = stringFromUnknown(message.messageId) ?? `message_${index + 1}`;
        const subject = stringFromUnknown(message.subject) || `Message ${index + 1}`;
        const sender = [stringFromUnknown(message.senderName), stringFromUnknown(message.senderEmail)]
          .filter(Boolean)
          .join(" / ");
        const receivedAt = stringFromUnknown(message.receivedAt);
        const messageAttachmentCount = typeof message.attachmentCount === "number" ? message.attachmentCount : 0;
        return (
          <div key={messageId} className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm font-medium text-foreground">
                <span className="mr-1 text-xs text-muted-foreground">Message {index + 1}</span>
                <span className="break-words">{subject}</span>
              </div>
              <Badge variant="outline">{messageAttachmentCount} attachments</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {sender && <span>{sender}</span>}
              {receivedAt && <span>{formatTimestamp(receivedAt)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      <details className={cn(
        "group rounded-md border border-border bg-card p-2 shadow-sm min-[1024px]:hidden",
        !compact && "bg-background",
      )}>
        <summary className="cursor-pointer list-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Thread Timeline</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{messages.length} messages</Badge>
              <Badge variant="outline">{attachmentCount} attachments</Badge>
              {latestActivity && <span>Latest {formatTimestamp(latestActivity)}</span>}
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </div>
          </div>
        </summary>
        <div className="mt-2">{timelineBody}</div>
      </details>
      <section className={cn(
        compact ? "rounded-md border border-border bg-card p-2" : "rounded-md border border-border p-3",
        "max-[1023px]:hidden",
      )}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Thread Timeline</h3>
          <Badge variant="outline">{messages.length}</Badge>
        </div>
        {timelineBody}
      </section>
    </>
  );
}

function EmailMessageBody({ message }: { message: Record<string, unknown> }) {
  const bodyText = stringFromUnknown(message.bodyText);
  const bodyHtml = stringFromUnknown(message.bodyHtml);
  const split = splitQuotedMessageText(bodyText);
  if (split.current) {
    return (
      <div className="space-y-2">
        <div className="whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-sm leading-5 text-foreground">
          {split.current}
        </div>
        {split.quoted && (
          <details className="rounded-md border border-dashed border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Quoted content in this message</summary>
            <div className="mt-2 whitespace-pre-wrap leading-5">{split.quoted}</div>
          </details>
        )}
      </div>
    );
  }
  if (bodyHtml) {
    return (
      <div
        className="prose prose-sm max-w-none rounded-md border border-border bg-background p-2 text-foreground [&_*]:max-w-full"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(bodyHtml) }}
      />
    );
  }
  return <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No body text captured for this message.</div>;
}

function ThreadMessageBlock({ message, index }: { message: Record<string, unknown>; index: number }) {
  const subject = stringFromUnknown(message.displaySubject) ?? stringFromUnknown(message.subject) ?? `Message ${index + 1}`;
  const sender = [stringFromUnknown(message.senderName), stringFromUnknown(message.senderEmail)].filter(Boolean).join(" / ");
  const receivedAt = stringFromUnknown(message.receivedAt);
  const to = threadMessageRecipients(message, "to");
  const cc = threadMessageRecipients(message, "cc");
  return (
    <article className="rounded-md border border-border bg-muted/10 p-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Message {index + 1}</div>
          <h4 className="mt-0.5 break-words text-sm font-semibold text-foreground">{subject}</h4>
        </div>
        {receivedAt && <Badge variant="outline">{formatTimestamp(receivedAt)}</Badge>}
      </div>
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
        {sender && <div><span className="font-medium text-foreground">From:</span> {sender}</div>}
        {to.length > 0 && <div><span className="font-medium text-foreground">To:</span> {to.join(", ")}</div>}
        {cc.length > 0 && <div><span className="font-medium text-foreground">Cc:</span> {cc.join(", ")}</div>}
      </div>
      <div className="mt-2">
        <EmailMessageBody message={message} />
      </div>
    </article>
  );
}

function ThreadMessageBlocks({
  thread,
  fallbackHtml,
  fallbackText,
}: {
  thread: Record<string, unknown> | null | undefined;
  fallbackHtml: string | null;
  fallbackText: string | null;
}) {
  const [previousExpanded, setPreviousExpanded] = useState(false);
  const messages = threadMessagesLatestFirst(thread);
  if (messages.length > 0) {
    const latest = messages[0];
    const previous = messages.slice(1);
    return (
      <div className="space-y-2">
        <ThreadMessageBlock message={latest} index={1} />
        {previous.length > 0 && (
          <div className="rounded-md border border-border bg-muted/20 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPreviousExpanded((current) => !current)}
            >
              {previousExpanded ? "Collapse previous messages" : `Expand previous messages (${previous.length})`}
            </Button>
            {previousExpanded && (
              <div className="mt-2 space-y-2">
                {previous.map((message, index) => (
                  <ThreadMessageBlock
                    key={stringFromUnknown(message.messageId) ?? `previous_${index}`}
                    message={message}
                    index={index + 2}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  return fallbackHtml ? (
    <div
      className="prose prose-sm max-w-none rounded-md border border-border bg-background p-2 text-foreground [&_*]:max-w-full"
      dangerouslySetInnerHTML={{ __html: fallbackHtml }}
    />
  ) : fallbackText ? (
    <div className="whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-sm leading-5 text-foreground">
      {fallbackText}
    </div>
  ) : (
    <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      No email body was captured.
    </div>
  );
}

function artworkLinkKey(link: Pick<InboundOrderArtworkLink, "fileId" | "fileRecordId">): string {
  return link.fileRecordId ? `record:${link.fileRecordId}` : `file:${link.fileId}`;
}

function attachmentLinkDedupeKey(link: InboundOrderArtworkLink): string {
  const filename = String(link.filename ?? "").toLowerCase();
  const size = link.sizeBytes ?? null;
  const mimeType = String(link.mimeType ?? "").toLowerCase();
  return filename && size != null && mimeType
    ? `global:${filename}:${size}:${mimeType}`
    : artworkLinkKey(link);
}

function dedupeAttachmentLinks(links: InboundOrderArtworkLink[]): InboundOrderArtworkLink[] {
  const byKey = new Map<string, InboundOrderArtworkLink>();
  for (const link of links) {
    const key = attachmentLinkDedupeKey(link);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, link);
      continue;
    }
    if (link.manualOverride && !existing.manualOverride) {
      byKey.set(key, link);
    }
  }
  return Array.from(byKey.values());
}

function attachmentClassificationLabel(classification: InboundAttachmentClassification | string | null | undefined): string {
  if (classification === "PO") return "Purchase Order";
  if (classification === "ARTWORK") return "Artwork";
  if (classification === "REFERENCE") return "Reference";
  if (classification === "IGNORE_INLINE") return "Junk / Signature";
  if (classification === "OTHER") return "Ignore";
  return "Other";
}

function suggestAttachmentClassificationMatcher(link: InboundOrderArtworkLink): {
  matchType: AttachmentClassificationRuleMatchType;
  matchValue: string;
} {
  const filename = String(link.filename ?? "").trim();
  const mimeType = String(link.mimeType ?? "").trim();
  if (/purchase\s+order/i.test(filename)) {
    return { matchType: "filename_contains", matchValue: "Purchase Order" };
  }
  if (/\b(?:po|p\.o\.)\s*(?:no|number|#)?\b/i.test(filename)) {
    return { matchType: "filename_contains", matchValue: "PO" };
  }
  const imagePrefix = filename.match(/^(image\d{2,}|logo|signature|sig)/i)?.[1];
  if (imagePrefix) {
    return { matchType: "filename_starts_with", matchValue: imagePrefix };
  }
  const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]\d{4,}$/i, "").trim();
  if (base) return { matchType: "filename_contains", matchValue: base.slice(0, 120) };
  return { matchType: "mime_type", matchValue: mimeType || "application/pdf" };
}

function AttachmentClassificationDialog({
  state,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  state: AttachmentClassificationDialogState | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    classification: InboundAttachmentClassification;
    rememberForCustomer: boolean;
    matchType: AttachmentClassificationRuleMatchType;
    matchValue: string;
  }) => void;
}) {
  const suggested = state ? suggestAttachmentClassificationMatcher(state.link) : { matchType: "filename_contains" as const, matchValue: "" };
  const [classification, setClassification] = useState<InboundAttachmentClassification>("REFERENCE");
  const [rememberForCustomer, setRememberForCustomer] = useState(false);
  const [matchType, setMatchType] = useState<AttachmentClassificationRuleMatchType>(suggested.matchType);
  const [matchValue, setMatchValue] = useState(suggested.matchValue);

  useEffect(() => {
    if (!state) return;
    const next = suggestAttachmentClassificationMatcher(state.link);
    setClassification(classificationForLink(state.link));
    setRememberForCustomer(false);
    setMatchType(next.matchType);
    setMatchValue(next.matchValue);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Classify attachment</DialogTitle>
          <DialogDescription>
            Update the current attachment now. Optionally remember this filename pattern for the matched customer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <div className="font-medium text-foreground">{state?.link.filename || state?.link.fileId || "Attachment"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{state?.link.mimeType || "Unknown type"}</div>
          </div>
          <Label className="space-y-1 text-xs text-muted-foreground">
            Classification
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={classification}
              onChange={(event) => setClassification(event.target.value as InboundAttachmentClassification)}
            >
              <option value="ARTWORK">Artwork</option>
              <option value="PO">Purchase Order</option>
              <option value="REFERENCE">Reference</option>
              <option value="IGNORE_INLINE">Junk / Signature</option>
              <option value="OTHER">Ignore</option>
            </select>
          </Label>
          <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Checkbox
              checked={rememberForCustomer}
              disabled={!state?.customerId}
              onCheckedChange={(checked) => setRememberForCustomer(checked === true)}
            />
            <span>
              <span className="block font-medium text-foreground">Remember for this customer</span>
              <span className="block text-xs text-muted-foreground">
                {state?.customerId ? "Future attachments matching this pattern will use this classification." : "Select or match a customer before creating customer-specific rules."}
              </span>
            </span>
          </label>
          {rememberForCustomer && (
            <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[160px_1fr]">
              <Label className="space-y-1 text-xs text-muted-foreground">
                Matcher
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={matchType}
                  onChange={(event) => setMatchType(event.target.value as AttachmentClassificationRuleMatchType)}
                >
                  <option value="filename_contains">Filename contains</option>
                  <option value="filename_starts_with">Filename starts with</option>
                  <option value="filename_ends_with">Filename ends with</option>
                  <option value="filename_exact">Filename exact</option>
                  <option value="mime_type">MIME type</option>
                </select>
              </Label>
              <Label className="space-y-1 text-xs text-muted-foreground">
                Match value
                <Input value={matchValue} onChange={(event) => setMatchValue(event.target.value)} />
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button
            type="button"
            onClick={() => onSubmit({ classification, rememberForCustomer, matchType, matchValue })}
            disabled={isSubmitting || (rememberForCustomer && !matchValue.trim())}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save classification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function attachmentRoleForClassification(classification: InboundAttachmentClassification): InboundOrderArtworkLink["role"] {
  if (classification === "IGNORE_INLINE") return "ignore_inline";
  return inboundAttachmentClassificationToRole(classification);
}

function safeClassificationBreakdown(value: unknown): InboundOrderArtworkLink["classificationBreakdown"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const strings = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
  return {
    filename: strings(record.filename),
    content: strings(record.content),
    metadata: strings(record.metadata),
    manual: strings(record.manual),
    scores: record.scores && typeof record.scores === "object" && !Array.isArray(record.scores)
      ? Object.fromEntries(Object.entries(record.scores as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
      : {},
  };
}

function attachmentClassificationFromMetadata(
  metadata: Record<string, any>,
  fallbackRole: string | null | undefined,
): Pick<
  InboundOrderArtworkLink,
  | "classification"
  | "classificationConfidence"
  | "classificationReasons"
  | "classificationSource"
  | "automaticClassification"
  | "automaticClassificationConfidence"
  | "automaticClassificationReasons"
  | "classificationBreakdown"
  | "manualOverride"
> {
  const stored = metadata.attachmentClassification && typeof metadata.attachmentClassification === "object" && !Array.isArray(metadata.attachmentClassification)
    ? metadata.attachmentClassification as Record<string, any>
    : null;
  const storedClassification = stored?.classification;
  const classification = (
    storedClassification === "PO"
    || storedClassification === "ARTWORK"
    || storedClassification === "REFERENCE"
    || storedClassification === "IGNORE_INLINE"
    || storedClassification === "OTHER"
  ) ? storedClassification : inboundAttachmentRoleToClassification(fallbackRole);
  return {
    classification,
    classificationConfidence: typeof stored?.confidence === "number" ? stored.confidence : null,
    classificationReasons: Array.isArray(stored?.reasons) ? stored.reasons.filter((item: unknown): item is string => typeof item === "string") : [],
    classificationSource: stored?.source === "manual_override" ? "manual_override" : "automatic",
    automaticClassification: classification,
    automaticClassificationConfidence: typeof stored?.confidence === "number" ? stored.confidence : null,
    automaticClassificationReasons: Array.isArray(stored?.reasons) ? stored.reasons.filter((item: unknown): item is string => typeof item === "string") : [],
    classificationBreakdown: safeClassificationBreakdown(stored?.breakdown),
    manualOverride: stored?.source === "manual_override",
  };
}

function artworkLinkFromInboundFile(file: ClientInboundOrderFile, source: InboundOrderArtworkLink["source"]): InboundOrderArtworkLink {
  const metadata = attachmentSafetyMetadata(file);
  const classification = attachmentClassificationFromMetadata(metadata, file.role);
  return {
    fileId: file.id,
    fileRecordId: file.fileRecordId ?? null,
    filename: file.sourceFilename ?? null,
    mimeType: file.mimeType ?? null,
    sizeBytes: file.sizeBytes ?? null,
    role: attachmentRoleForClassification(classification.classification ?? inboundAttachmentRoleToClassification(file.role)),
    assignmentSide: "unassigned",
    productionQuantity: attachmentRoleForClassification(classification.classification ?? inboundAttachmentRoleToClassification(file.role)) === "artwork"
      ? defaultNewProductionArtworkAllocation("artwork")
      : null,
    productionGroupId: null,
    source,
    confidence: source === "staff_selected" ? 100 : null,
    reason: source === "staff_selected" ? "Staff selected artwork attachment for this line item." : null,
    ...classification,
  };
}

function describeArtworkLink(link: InboundOrderArtworkLink): string {
  const details = [
    attachmentClassificationLabel(link.classification ?? inboundAttachmentRoleToClassification(link.role)),
    link.mimeType,
    link.sizeBytes != null ? formatFileSize(link.sizeBytes) : null,
  ].filter(Boolean);
  return details.join(" / ") || "Attachment";
}

function classificationForLink(link: InboundOrderArtworkLink): InboundAttachmentClassification {
  return link.classification ?? inboundAttachmentRoleToClassification(link.role);
}

function isActiveClassifiedArtworkLink(link: InboundOrderArtworkLink): boolean {
  return link.source !== "staff_removed" && classificationForLink(link) === "ARTWORK";
}

function isDoubleSidedReviewLineItem(lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number]): boolean {
  return Object.entries(ensurePbv2Selections(lineItem.optionSelectionsJson).selected ?? {}).some(([key, entry]) => (
    /side|sides|print[_\s-]*side/i.test(key)
    && /double|two|2[_\s-]*sided|\bds\b/i.test(String(entry?.value ?? ""))
  ));
}

function artworkAssignmentSideLabel(link: InboundOrderArtworkLink): string {
  if (link.assignmentSide === "both") return "Front & back";
  if (link.assignmentSide === "front") return "Front";
  if (link.assignmentSide === "back") return "Back";
  return "Unassigned side";
}

function isArtworkDecision(decision: ReviewDraftFormState["missingDecisionsJson"][number]): boolean {
  return /artwork/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

function isQuantityDecision(decision: ReviewDraftFormState["missingDecisionsJson"][number]): boolean {
  return /quantity/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

function isDimensionsDecision(decision: ReviewDraftFormState["missingDecisionsJson"][number]): boolean {
  const field = String(decision.field ?? "");
  if (/lineitems\.\d+\.(?:dimensions?|size|width|height)/i.test(field)) return true;

  const text = `${decision.label} ${decision.reason}`;
  return /what\s+(?:size|dimensions?)\b.*\bneeded\b|\b(?:size|dimensions?)\b.*\b(?:missing|required|unclear)\b/i.test(text)
    && !/\bpole\s+pocket\b/i.test(text);
}

function artworkLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.artwork/i);
  return match ? Number(match[1]) : null;
}

function quantityLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.quantity/i);
  return match ? Number(match[1]) : null;
}

function dimensionsLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)\.(?:dimensions?|size|width|height)/i);
  return match ? Number(match[1]) : null;
}

function reviewedLineIndex(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/lineitems\.(\d+)(?:\.|$)/i);
  return match ? Number(match[1]) : null;
}

function reindexReviewedLinePath(value: string, removedLineIndex: number): string {
  const lineIndex = reviewedLineIndex(value);
  if (lineIndex == null || lineIndex <= removedLineIndex) return value;
  return value.replace(/(lineitems\.)(\d+)/i, (_match, prefix) => `${prefix}${lineIndex - 1}`);
}

function reindexReviewedLineText(value: string, previousLineIndex: number): string {
  const previousDisplayNumber = previousLineIndex + 1;
  const nextDisplayNumber = previousLineIndex;
  return value.replace(
    new RegExp(`\\b(line(?:\\s+item)?)\\s+${previousDisplayNumber}\\b`, "gi"),
    (_match, prefix) => `${prefix} ${nextDisplayNumber}`,
  );
}

function isObsoleteRemovedLineDecision(decision: ReviewDraftFormState["missingDecisionsJson"][number]): boolean {
  return decision.resolutionNote?.startsWith("Obsolete: reviewed line item was removed.") ?? false;
}

function removeReviewedLineItem(
  form: ReviewDraftFormState,
  removedLineIndex: number,
): Partial<ReviewDraftFormState> {
  const reviewedLineItemsJson = form.reviewedLineItemsJson.filter((_, index) => index !== removedLineIndex);
  return {
    reviewedLineItemsJson,
    missingDecisionsJson: form.missingDecisionsJson.map((decision) => {
      const lineIndex = reviewedLineIndex(decision.field);
      if (lineIndex === removedLineIndex) {
        return {
          ...decision,
          status: "resolved" as const,
          resolutionNote: "Obsolete: reviewed line item was removed.",
        };
      }
      return lineIndex != null && lineIndex > removedLineIndex
        ? {
          ...decision,
          field: reindexReviewedLinePath(decision.field, removedLineIndex),
          label: reindexReviewedLineText(decision.label, lineIndex),
          reason: reindexReviewedLineText(decision.reason, lineIndex),
        }
        : decision;
    }),
    warningsJson: form.warningsJson.map((warning) => {
      const lineIndex = reviewedLineIndex(warning.fieldPath);
      return lineIndex != null && lineIndex > removedLineIndex
        ? { ...warning, fieldPath: reindexReviewedLinePath(warning.fieldPath ?? "", removedLineIndex) }
        : warning;
    }),
  };
}

function validationErrorReferencesRemovedLine(error: string, activeLineCount: number): boolean {
  const lineMatch = error.match(/line\s+(\d+)/i);
  return Boolean(lineMatch && Number(lineMatch[1]) > activeLineCount);
}

function hasValidLineItemQuantity(
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.quantity === "number"
    && Number.isFinite(lineItem.quantity)
    && lineItem.quantity > 0;
}

function hasValidLineItemDimensions(
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.width === "number"
    && Number.isFinite(lineItem.width)
    && lineItem.width > 0
    && typeof lineItem.height === "number"
    && Number.isFinite(lineItem.height)
    && lineItem.height > 0;
}

function pricingValidationErrorIsStillBlocking(
  error: string,
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
): boolean | null {
  if (!/system pricing is unavailable|valid unit or total price override|price(?: is)? needed/i.test(error)) return null;
  const lineMatch = error.match(/line\s+(\d+)/i);
  if (lineMatch) {
    const lineItem = reviewedLineItemsJson[Number(lineMatch[1]) - 1];
    return !lineItem || !hasUsableInboundLinePrice(lineItem.pricingReviewJson, lineItem.quantity);
  }
  const matchingLineItem = reviewedLineItemsJson.find((lineItem) => {
    const label = lineItem.productName || lineItem.sourceText;
    return Boolean(label && error.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  });
  if (matchingLineItem) {
    return !hasUsableInboundLinePrice(matchingLineItem.pricingReviewJson, matchingLineItem.quantity);
  }
  return !reviewedLineItemsJson.every((lineItem) => (
    hasUsableInboundLinePrice(lineItem.pricingReviewJson, lineItem.quantity)
  ));
}

function artworkDecisionIsResolvedByAssignment(
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
  decision: ReviewDraftFormState["missingDecisionsJson"][number],
): boolean {
  const lineIndex = artworkLineIndex(decision.field);
  if (lineIndex == null) return reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  return reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

function quantityDecisionIsResolvedByLineItem(
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
  decision: ReviewDraftFormState["missingDecisionsJson"][number],
): boolean {
  const lineIndex = quantityLineIndex(decision.field);
  return lineIndex != null && hasValidLineItemQuantity(reviewedLineItemsJson[lineIndex]);
}

function dimensionsDecisionIsResolvedByLineItem(
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
  decision: ReviewDraftFormState["missingDecisionsJson"][number],
): boolean {
  const lineIndex = dimensionsLineIndex(decision.field);
  if (lineIndex != null) return hasValidLineItemDimensions(reviewedLineItemsJson[lineIndex]);
  return reviewedLineItemsJson.length > 0 && reviewedLineItemsJson.every(hasValidLineItemDimensions);
}

function isStaleMissingArtworkWarning(
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
  warning: ReviewDraftFormState["warningsJson"][number],
): boolean {
  const text = `${warning.code ?? ""} ${warning.message ?? ""} ${warning.fieldPath ?? ""}`.toLowerCase();
  if (!text.includes("artwork") || !/(missing|not linked|not attached|unassigned)/.test(text)) return false;
  const lineIndex = artworkLineIndex(warning.fieldPath);
  if (lineIndex == null) return reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  return reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

function artworkValidationErrorIsResolvedByAssignment(
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
  error: string,
): boolean {
  if (!/artwork/i.test(error)) return false;
  const lineMatch = error.match(/line\s+(\d+)/i);
  if (!lineMatch) return reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  const lineIndex = Number(lineMatch[1]) - 1;
  return reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

function reconcileResolvedLineItemDecisions(
  form: ReviewDraftFormState,
  reviewedLineItemsJson: ReviewDraftFormState["reviewedLineItemsJson"],
): Partial<ReviewDraftFormState> {
  const artworkAssigned = reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  return {
    reviewedLineItemsJson,
    reviewedArtworkJson: artworkAssigned ? { ...form.reviewedArtworkJson, status: "supplied" } : form.reviewedArtworkJson,
    missingDecisionsJson: form.missingDecisionsJson.map((decision) => (
      isArtworkDecision(decision) && decision.status === "still_blocking" && artworkDecisionIsResolvedByAssignment(reviewedLineItemsJson, decision)
        ? {
          ...decision,
          status: "resolved",
          resolutionNote: decision.resolutionNote ?? "Resolved by artwork assigned to a reviewed line item.",
        }
        : isQuantityDecision(decision) && decision.status === "still_blocking" && quantityDecisionIsResolvedByLineItem(reviewedLineItemsJson, decision)
          ? {
            ...decision,
            status: "resolved",
            resolutionNote: decision.resolutionNote ?? "Resolved by staff-confirmed line item quantity.",
          }
          : isDimensionsDecision(decision) && decision.status === "still_blocking" && dimensionsDecisionIsResolvedByLineItem(reviewedLineItemsJson, decision)
            ? {
              ...decision,
              status: "resolved",
              resolutionNote: decision.resolutionNote ?? "Resolved by staff-confirmed line item size.",
            }
            : decision
    )),
    warningsJson: artworkAssigned
      ? form.warningsJson.filter((warning) => !isStaleMissingArtworkWarning(reviewedLineItemsJson, warning))
      : form.warningsJson,
  };
}

function classificationConfidenceForLink(link: InboundOrderArtworkLink): number | null {
  if (typeof link.classificationConfidence === "number") return Math.round(link.classificationConfidence);
  if (typeof link.confidence === "number") return Math.round(link.confidence);
  return null;
}

function classificationReasonText(link: InboundOrderArtworkLink): string {
  const reasons = link.classificationReasons?.filter(Boolean) ?? [];
  if (reasons.length > 0) return reasons.join(", ");
  return link.reason ?? "No classification evidence captured.";
}

function attachmentDebugText(link: InboundOrderArtworkLink): string {
  const breakdown = link.classificationBreakdown;
  if (!breakdown) return "No detailed classification breakdown captured.";
  const parts = [
    `Filename: ${breakdown.filename.length > 0 ? breakdown.filename.join("; ") : "none"}`,
    `Content: ${breakdown.content.length > 0 ? breakdown.content.join("; ") : "none"}`,
    `Metadata: ${breakdown.metadata.length > 0 ? breakdown.metadata.join("; ") : "none"}`,
    `Manual: ${breakdown.manual.length > 0 ? breakdown.manual.join("; ") : "none"}`,
    `Scores: ${Object.entries(breakdown.scores ?? {}).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}`,
  ];
  return parts.join(" | ");
}

function fileExtension(filename: string | null | undefined): string | null {
  const match = String(filename ?? "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function senderDomainFromEmail(email: string | null | undefined): string | null {
  const domain = String(email ?? "").split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function automaticClassificationForLink(link: InboundOrderArtworkLink): InboundAttachmentClassification {
  return link.automaticClassification ?? (
    link.classificationSource === "automatic"
      ? classificationForLink(link)
      : inboundAttachmentRoleToClassification(link.role)
  );
}

function evidenceSourceLabel(value: string | null | undefined) {
  if (value === "PDF_ATTACHMENT") return "PDF Attachment";
  if (value === "EMAIL_BODY") return "Email Body";
  if (value === "EMAIL_SUBJECT") return "Email Subject";
  if (value === "THREAD_MESSAGE") return "Thread Message";
  if (value === "TEXT_ATTACHMENT") return "Text Attachment";
  if (value === "MANUAL_NOTES") return "Manual Notes";
  if (value === "ARTWORK_LINK") return "Artwork Link";
  if (value === "ATTACHMENT_METADATA") return "Attachment Metadata";
  return titleCase(value);
}

function inboundAttachmentRoleLabel(role: string | null | undefined) {
  if (role === "po") return "PO candidate";
  if (role === "artwork") return "Artwork candidate";
  if (role === "reference") return "Reference";
  if (role === "ignore_inline") return "Ignored inline";
  return "Other attachment";
}

function attachmentSafetyMetadata(file: ClientInboundOrderFile): Record<string, any> {
  return file.metadataJson && typeof file.metadataJson === "object" && !Array.isArray(file.metadataJson)
    ? file.metadataJson as Record<string, any>
    : {};
}

function isArchiveAttachment(file: ClientInboundOrderFile): boolean {
  return /\.zip$/i.test(file.sourceFilename ?? "") || /(?:application\/zip|application\/x-zip-compressed|zip)/i.test(file.mimeType ?? "");
}

function isQuarantinedAttachment(file: ClientInboundOrderFile): boolean {
  const metadata = attachmentSafetyMetadata(file);
  return file.status === "quarantined" || String(metadata.attachmentState ?? "") === "scan_pending" || String(metadata.attachmentState ?? "") === "quarantined";
}

function AttachmentSafetyDetails({
  recordId,
  file,
}: {
  recordId: string;
  file: ClientInboundOrderFile;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const metadata = attachmentSafetyMetadata(file);
  const attachmentState = metadata.attachmentState ?? (file.fileRecordId ? "downloaded" : "metadata_only");
  const trustStatus = metadata.senderTrustStatus ?? "unknown";
  const reason = metadata.attachmentSafetyReason ?? metadata.failureReason ?? file.reviewNotes ?? null;
  const canAct = !file.fileRecordId && String(attachmentState) !== "blocked_file_type";
  const actionMutation = useMutation({
    mutationFn: (action: "trust_sender_and_download" | "trust_domain_and_download" | "download_once" | "keep_blocked") => (
      postJson<{ success: boolean; data: ClientInboundOrderFile }>(
        `/api/inbound-orders/${encodeURIComponent(recordId)}/files/${encodeURIComponent(file.id)}/trust-action`,
        { action },
      )
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/trust-rules"] }),
      ]);
      toast({ title: "Attachment action applied", description: "The inbound attachment safety state was updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Attachment action failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">State: {titleCase(String(attachmentState))}</Badge>
        <Badge variant={trustStatus === "trusted" ? "secondary" : "outline"}>Sender: {titleCase(String(trustStatus))}</Badge>
        {metadata.attachmentExtension ? <Badge variant="outline">.{String(metadata.attachmentExtension)}</Badge> : null}
        {metadata.blockedFileType ? <Badge variant="destructive">Blocked type</Badge> : null}
      </div>
      {reason ? <div className="text-xs text-muted-foreground">{String(reason)}</div> : null}
      {canAct ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("trust_sender_and_download")}>
            Trust sender and download
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("trust_domain_and_download")}>
            Trust domain and download
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("download_once")}>
            Download once
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("keep_blocked")}>
            Keep blocked
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function getRecordTitle(record: ClientInboundOrderRecord) {
  const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
  return evidence.reference || evidence.subject || record.externalReference || `Inbound ${record.id.slice(0, 8)}`;
}

function getSenderLabel(record: ClientInboundOrderRecord) {
  const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
  return [evidence.senderName, evidence.senderEmail].filter(Boolean).join(" / ") || "No sender captured";
}

function getInboundIntent(record: ClientInboundOrderRecord): string | null {
  return stringFromUnknown(getPathValue(record.normalizedPayloadJson, "inboundIntent"))
    ?? stringFromUnknown(getPathValue(record.extractedOrderJson, "inboundIntent"))
    ?? stringFromUnknown(getPathValue(record.rawPayloadJson, "intent"));
}

function getInboundIntentLabel(record: ClientInboundOrderRecord): string | null {
  const intent = getInboundIntent(record);
  if (!intent) return null;
  return inboundIntentLabels[intent] ?? titleCase(intent);
}

function getInboundIntentReasons(record: ClientInboundOrderRecord): string[] {
  const reasons = [
    ...stringsFromUnknown(getPathValue(record.normalizedPayloadJson, "inboundIntentReasons")),
    ...stringsFromUnknown(getPathValue(record.extractedOrderJson, "inboundIntentReasons")),
    ...stringsFromUnknown(getPathValue(record.rawPayloadJson, "intentReasons")),
  ];
  if (reasons.length > 0) return Array.from(new Set(reasons));
  const reason = stringFromUnknown(getPathValue(record.normalizedPayloadJson, "inboundIntentReason"))
    ?? stringFromUnknown(getPathValue(record.extractedOrderJson, "inboundIntentReason"))
    ?? stringFromUnknown(getPathValue(record.rawPayloadJson, "intentReason"));
  return reason ? [reason] : [];
}

function getErrorTone(error: Error | null) {
  if (!error) return null;
  const message = error.message.toLowerCase();
  if (
    message.includes("inbound order tables are not available")
    || message.includes("does not exist")
    || message.includes("relation")
    || message.includes("inbound_order")
  ) {
    return "Inbound order tables are not available yet. The page is ready, but the inbound migration must run before staff can use the queue.";
  }
  return error.message;
}

function StatusBadge({ status }: { status: InboundOrderRecordStatus }) {
  const variant = status === "terminal" || status === "failed"
    ? "destructive"
    : status === "needs_review"
      ? "default"
      : "secondary";

  return <Badge variant={variant}>{statusLabels[status] ?? status}</Badge>;
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mt-4 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border bg-card p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-3 h-3 w-1/2" />
          <Skeleton className="mt-4 h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium text-foreground">{value || "-"}</div>
    </div>
  );
}

function InlineField({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-foreground">{display ?? "-"}</div>
    </div>
  );
}

function WarningList({ warnings }: { warnings: InboundOrderParsedDraft["globalWarnings"] }) {
  if (warnings.length === 0) {
    return <div className="text-sm text-muted-foreground">No parse warnings.</div>;
  }

  return (
    <div className="space-y-2">
      {warnings.map((warning, index) => (
        <div key={`${warning.code}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">{warning.code}</div>
            <Badge variant={warning.severity === "blocking" ? "destructive" : "outline"}>
              {titleCase(warning.severity)}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{warning.message}</div>
        </div>
      ))}
    </div>
  );
}

function CandidateList({
  title,
  candidates,
}: {
  title: string;
  candidates: InboundOrderParsedDraft["customer"]["customerCandidates"];
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
        <Badge variant="outline">{candidates.length}</Badge>
      </div>
      {candidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">No candidates found.</div>
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-md bg-muted/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{candidate.label}</div>
                  {candidate.reason && <div className="mt-1 text-xs text-muted-foreground">{candidate.reason}</div>}
                </div>
                <Badge variant="secondary">{candidate.confidence}%</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerIntelligencePanel({ intelligence }: { intelligence: InboundOrderReviewDraftDto["customerIntelligenceJson"] }) {
  if (!intelligence) {
    return (
      <section className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Customer Intelligence</h3>
          <Badge variant="outline">No customer</Badge>
        </div>
        <div className="mt-2 text-sm text-muted-foreground">Select or resolve a customer to show historical context.</div>
      </section>
    );
  }

  const renderList = (
    title: string,
    items: Array<{ label?: string; reference?: string; productSummary?: string | null; count?: number }>,
    empty: string,
  ) => (
    <div className="min-w-0 rounded-md bg-muted/20 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">{empty}</div>
      ) : (
        <div className="mt-2 space-y-1">
          {items.slice(0, 4).map((item, index) => (
            <div key={`${title}-${index}`} className="min-w-0 text-sm text-foreground">
              <span className="truncate">{item.label ?? item.reference}</span>
              {item.count != null && <span className="ml-1 text-xs text-muted-foreground">x{item.count}</span>}
              {item.productSummary && <div className="truncate text-xs text-muted-foreground">{item.productSummary}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Customer Intelligence</h3>
          <div className="text-xs text-muted-foreground">
            {intelligence.customer.companyName} history, last {intelligence.scopeMonths} months
          </div>
        </div>
        <Badge variant="outline">{intelligence.recordCount} records</Badge>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
        {renderList("Recent Products", intelligence.recentProducts, "No recent products found.")}
        {renderList("Frequent Products", intelligence.frequentProducts, "No frequent products found.")}
        {renderList("Frequent Materials", intelligence.frequentMaterials, "No frequent materials found.")}
        {renderList("Recent Orders", intelligence.recentOrderReferences, "No recent orders or quotes found.")}
      </div>
    </section>
  );
}

function getStringArrayMetadata(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number], key: string): string[] {
  const value = candidate.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function getBreakdownMetadata(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number]) {
  const value = candidate.metadata?.matchBreakdown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ProductMatchReasoning({ candidates }: { candidates: InboundOrderParsedDraft["lineItems"][number]["productCandidates"] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Product Match Reasoning</h4>
        <Badge variant="outline">{candidates.length}</Badge>
      </div>
      {candidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">No product match reasoning available.</div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const reasons = getStringArrayMetadata(candidate, "matchReasons");
            const breakdown = getBreakdownMetadata(candidate);
            return (
              <div key={candidate.id} className="rounded-md bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{candidate.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{candidate.reason || "Candidate returned by product matcher."}</div>
                  </div>
                  <Badge variant="secondary">{candidate.confidence}%</Badge>
                </div>
                {reasons.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {reasons.slice(0, 5).map((reason, index) => (
                      <li key={`${candidate.id}-reason-${index}`}>{reason}</li>
                    ))}
                  </ul>
                )}
                {breakdown && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Final Score {String(breakdown.combinedConfidence ?? candidate.confidence)}</span>
                    <span>Material Score {String(breakdown.materialScore ?? 0)}</span>
                    <span>Category Score {String(breakdown.categoryScore ?? 0)}</span>
                    <span>Description Score {String(breakdown.descriptionScore ?? 0)}</span>
                    <span>Keyword Score {String(breakdown.keywordScore ?? breakdown.nameScore ?? 0)}</span>
                    <span>Metadata Score {String(breakdown.metadataScore ?? 0)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ReviewLineItemState = ReviewDraftFormState["reviewedLineItemsJson"][number];

type PoResolvedProductDisplay = {
  status: "resolved" | "ambiguous";
  productNames: string[];
  evidenceText: string | null;
};

function normalizePoSummaryText(value: string | number | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function poSummaryDimensionMatchesLineItem(
  summary: NonNullable<InboundOrderParsedDraft["evidence"]["items"][number]["poSummary"]>,
  lineItem: ReviewLineItemState,
) {
  const dimensions = normalizePoSummaryText(summary.dimensions);
  if (!dimensions || lineItem.width == null || lineItem.height == null) return false;
  const width = normalizePoSummaryText(lineItem.width);
  const height = normalizePoSummaryText(lineItem.height);
  return dimensions.includes(`${width}x${height}`)
    || dimensions.includes(`${width} x ${height}`)
    || dimensions.includes(`${width} ${height}`)
    || dimensions.includes(`${height}x${width}`)
    || dimensions.includes(`${height} x ${width}`);
}

function resolveProductForPoSummary(
  summary: NonNullable<InboundOrderParsedDraft["evidence"]["items"][number]["poSummary"]>,
  lineItems: ReviewLineItemState[] | null | undefined,
): PoResolvedProductDisplay | null {
  if (summary.productDescription || !lineItems?.length) return null;
  const material = normalizePoSummaryText(summary.material);
  const resolvedLineItems = lineItems
    .filter((lineItem) => lineItem.selectedProductId && lineItem.productName && !lineItem.productUnresolved)
    .map((lineItem, index) => {
      const sourceText = normalizePoSummaryText(lineItem.sourceText);
      const materialText = normalizePoSummaryText(lineItem.materialText);
      const productName = normalizePoSummaryText(lineItem.productName);
      const score = [
        material && (sourceText.includes(material) || materialText.includes(material)) ? 4 : 0,
        materialText && material.includes(materialText) ? 3 : 0,
        poSummaryDimensionMatchesLineItem(summary, lineItem) ? 2 : 0,
        summary.quantity != null && lineItem.quantity === Number(summary.quantity) ? 1 : 0,
        productName && sourceText.includes(productName) ? 1 : 0,
      ].reduce((total, value) => total + value, 0);
      return { lineItem, index, score };
    });

  if (resolvedLineItems.length === 0) return null;
  const ranked = [...resolvedLineItems].sort((left, right) => right.score - left.score || left.index - right.index);
  const top = ranked[0];
  const productNames = Array.from(new Set(ranked.map((item) => item.lineItem.productName).filter((value): value is string => Boolean(value))));
  const evidenceText = summary.material ?? top.lineItem.materialText ?? top.lineItem.sourceText ?? null;

  if (resolvedLineItems.length === 1 || (top.score > 0 && top.score > (ranked[1]?.score ?? -1))) {
    return {
      status: "resolved",
      productNames: [top.lineItem.productName!],
      evidenceText,
    };
  }

  return {
    status: "ambiguous",
    productNames,
    evidenceText,
  };
}

function PoResolvedProductField({ resolvedProduct }: { resolvedProduct: PoResolvedProductDisplay }) {
  if (resolvedProduct.status === "ambiguous") {
    return (
      <div className="min-w-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 sm:col-span-3">
        <div className="text-xs text-amber-200">Resolved product candidates</div>
        <div className="mt-1 break-words text-sm font-medium text-amber-50">{resolvedProduct.productNames.join(", ")}</div>
        <div className="mt-1 text-xs text-amber-200/80">Multiple line items may match this PO evidence. Review line items before treating this as the printed PO product.</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">Product</div>
      <div className="mt-1 break-words text-sm font-medium text-foreground">{resolvedProduct.productNames[0]}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Evidence: Resolved from {resolvedProduct.evidenceText || "PO material/stock text"}
      </div>
    </div>
  );
}

function PoSummaryGrid({
  summary,
  lineItems,
}: {
  summary: NonNullable<InboundOrderParsedDraft["evidence"]["items"][number]["poSummary"]>;
  lineItems?: ReviewLineItemState[] | null;
}) {
  const resolvedProduct = resolveProductForPoSummary(summary, lineItems);
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <InlineField label="PO Number" value={summary.poNumber} />
      <InlineField label="Due Date" value={summary.dueDate} />
      <InlineField label="Quantity" value={summary.quantity} />
      {summary.productDescription || !resolvedProduct || resolvedProduct.status === "ambiguous" ? (
        <InlineField label="Product" value={summary.productDescription} />
      ) : (
        <PoResolvedProductField resolvedProduct={resolvedProduct} />
      )}
      <InlineField label="Material" value={summary.material} />
      <InlineField label="Size" value={summary.dimensions} />
      {!summary.productDescription && resolvedProduct?.status === "ambiguous" && (
        <PoResolvedProductField resolvedProduct={resolvedProduct} />
      )}
    </div>
  );
}

type ParsedEvidenceItem = InboundOrderParsedDraft["evidence"]["items"][number];

function formatOptionalCents(value: number | null | undefined) {
  if (value == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function poSummaryPrice(summary: NonNullable<ParsedEvidenceItem["poSummary"]>) {
  return summary.price
    ?? formatOptionalCents(summary.pricing?.totalPriceCents)
    ?? formatOptionalCents(summary.pricing?.extendedPriceCents)
    ?? formatOptionalCents(summary.pricing?.approvedPriceCents);
}

function SourceDocumentPoPanel({
  recordId,
  poFiles,
  poEvidenceItems,
}: {
  recordId: string;
  poFiles: ClientInboundOrderFile[];
  poEvidenceItems: ParsedEvidenceItem[];
}) {
  const extractedPoItems = poEvidenceItems.filter((item) => item.poSummary);
  return (
    <div className="space-y-2">
      <section className="rounded-md border border-border bg-card p-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">PO Documents</h3>
          <Badge variant="outline">{poFiles.length}</Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {poFiles.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              No purchase order documents are linked to this inbound record.
            </div>
          ) : poFiles.map((file) => (
            <InboundAttachmentCard key={file.id} recordId={recordId} file={file} minimal />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">PO Extraction Summary</h3>
          <Badge variant="outline">{extractedPoItems.length}</Badge>
        </div>
        <div className="mt-2 space-y-2">
          {extractedPoItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              {poFiles.length > 0
                ? "PO document downloaded, text not extracted yet. Run Parse to use this document as evidence."
                : "No PO extraction summary is available."}
            </div>
          ) : extractedPoItems.map((item) => {
            const summary = item.poSummary!;
            return (
              <div key={`${item.sourceId ?? item.label}-po-summary`} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{item.fileName || item.label}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Extraction: {titleCase(item.extractionStatus)}</span>
                      <span>Confidence: {item.documentConfidence}%</span>
                      {item.pageCount ? <span>Pages: {item.pageCount}</span> : null}
                    </div>
                  </div>
                  <Badge variant={item.extractionStatus === "successful" ? "secondary" : item.extractionStatus === "failed" ? "destructive" : "outline"}>
                    {item.documentType === "purchase_order" ? "PO candidate" : titleCase(item.documentType)}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <InlineField label="PO Number" value={summary.poNumber} />
                  <InlineField label="Due Date" value={summary.dueDate} />
                  <InlineField label="Quantity" value={summary.quantity} />
                  <InlineField label="Total Price" value={poSummaryPrice(summary)} />
                  <InlineField label="Rush Fee" value={formatOptionalCents(summary.pricing?.rushFeesCents)} />
                  <InlineField label="Status" value={titleCase(item.extractionStatus)} />
                </div>
                {(summary.productDescription || summary.material || summary.dimensions) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <InlineField label="Product" value={summary.productDescription} />
                    <InlineField label="Material" value={summary.material} />
                    <InlineField label="Dimensions" value={summary.dimensions} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SourceDocumentArtworkPanel({
  recordId,
  artworkFiles,
  referenceFiles,
  signatureFiles,
}: {
  recordId: string;
  artworkFiles: ClientInboundOrderFile[];
  referenceFiles: ClientInboundOrderFile[];
  signatureFiles: ClientInboundOrderFile[];
}) {
  const renderGroup = (title: string, items: ClientInboundOrderFile[], emptyText: string) => (
    <section className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <div className="mt-2 space-y-1.5">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{emptyText}</div>
        ) : items.map((file) => (
          <InboundAttachmentCard key={file.id} recordId={recordId} file={file} minimal />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-2">
      {renderGroup("Artwork Files", artworkFiles, "No artwork files are linked to this inbound record.")}
      {renderGroup("References", referenceFiles, "No reference attachments are linked to this inbound record.")}
      <details className="rounded-md border border-border bg-card p-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
          <span>Junk / Signature Images</span>
          <Badge variant="outline">{signatureFiles.length}</Badge>
        </summary>
        <div className="mt-2 space-y-1.5">
          {signatureFiles.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No inline signature images were detected.
            </div>
          ) : signatureFiles.map((file) => (
            <InboundAttachmentCard key={file.id} recordId={recordId} file={file} compact minimal />
          ))}
        </div>
      </details>
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Manual reclassification controls are preserved in Order Workstation &gt; Attachments so staff changes save with the review draft.
      </div>
    </div>
  );
}

const fieldSourceLabels: Record<string, string> = {
  poNumber: "PO Number",
  dueDate: "Due Date",
  quantity: "Quantity",
  dimensions: "Dimensions",
  material: "Material",
  productDescription: "Product",
};

function FieldSourceSection({ draft }: { draft: InboundOrderParsedDraft }) {
  const sourceEntries = draft.evidence.items
    .filter((item) => item.poSummary?.fieldSources)
    .flatMap((item) => Object.entries(item.poSummary?.fieldSources ?? {}).map(([field, source]) => ({ field, source })))
    .filter((entry) => fieldSourceLabels[entry.field]);

  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Field Sources</h3>
        <Badge variant="outline">{sourceEntries.length}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        {sourceEntries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No field source details available.</div>
        ) : (
          sourceEntries.map(({ field, source }) => (
            <div key={field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{fieldSourceLabels[field]}</div>
                  <div className="mt-1 break-words text-sm text-foreground">{String(source.value ?? "-")}</div>
                </div>
                <Badge variant="secondary">{source.confidence}%</Badge>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                <div>Value: {String(source.value ?? "-")}</div>
                <div>Source: {evidenceSourceLabel(source.sourceType)}</div>
                {source.sourceDocument && <div>Document: {source.sourceDocument}</div>}
                {source.sourceText && <div>Source Text: {source.sourceText}</div>}
                <div>Confidence: {source.confidence}%</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

const reconciliationLabels: Array<{ key: keyof NonNullable<InboundOrderParsedDraft["evidence"]["reconciliation"]>; label: string }> = [
  { key: "product", label: "Product" },
  { key: "quantity", label: "Quantity" },
  { key: "dimensions", label: "Dimensions" },
  { key: "material", label: "Material" },
  { key: "dueDate", label: "Due date" },
  { key: "rushStatus", label: "Rush status" },
  { key: "artworkStatus", label: "Artwork status" },
  { key: "pricingStatus", label: "Pricing status" },
];

function EvidenceReconciliationSection({ draft }: { draft: InboundOrderParsedDraft }) {
  const reconciliation = draft.evidence.reconciliation;
  if (!reconciliation) return null;
  const rows = reconciliationLabels.map(({ key, label }) => ({ key, label, field: reconciliation[key] }))
    .filter(({ field }) => field.value != null || field.sources.length > 0 || field.conflicts.length > 0);
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence Reconciliation</h4>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {rows.map(({ key, label, field }) => {
          const primarySource = field.sources[0] ?? null;
          return (
            <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{label}</div>
                <Badge variant={field.status === "conflict" ? "destructive" : field.status === "confirmed" ? "secondary" : "outline"}>
                  {titleCase(field.status)}
                </Badge>
              </div>
              <div className="mt-1 break-words text-sm text-foreground">{String(field.value ?? "-")}</div>
              {primarySource && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>Source: {evidenceSourceLabel(primarySource.sourceType)}{primarySource.sourceDocument ? ` / ${primarySource.sourceDocument}` : ""}</div>
                  {primarySource.sourceText && <div className="break-words">Evidence: {primarySource.sourceText}</div>}
                </div>
              )}
              {field.conflicts.length > 0 && (
                <div className="mt-2 text-xs text-destructive">{field.conflicts[0]?.message}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceUsedSection({
  draft,
  detail,
}: {
  draft: InboundOrderParsedDraft;
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
}) {
  const record = detail?.record ?? null;
  const evidence = record?.sourceType === "email" ? getInboundEmailEvidence(record) : record ? getManualInboundEvidence(record) : null;
  const files = dedupeAttachmentFiles(detail?.files ?? []);
  const poItems = draft.evidence.items.filter((item) => (
    item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT"
  ) && item.documentType === "purchase_order");
  const documentFailures = draft.evidence.items.filter((item) => (
    item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT"
  ) && item.extractionStatus === "failed");
  const artworkFiles = files.filter((file) => file.role === "artwork");
  const threadCount = typeof (evidence as ReturnType<typeof getInboundEmailEvidence> | null)?.thread?.messageCount === "number"
    ? Number((evidence as ReturnType<typeof getInboundEmailEvidence>).thread?.messageCount)
    : 0;
  const rows = [
    {
      label: "Email body",
      status: draft.evidence.items.some((item) => item.type === "EMAIL_BODY") ? "parsed" : evidence?.bodyText ? "skipped" : "not available",
      detail: evidence?.bodyText ? "Body text captured" : "No email body text captured",
    },
    {
      label: "Thread messages",
      status: threadCount > 1 ? "parsed" : threadCount === 1 ? "single message" : "not available",
      detail: threadCount > 0 ? `${threadCount} message${threadCount === 1 ? "" : "s"} available` : "No thread timeline captured",
    },
    {
      label: "PO documents",
      status: poItems.some((item) => item.extractionStatus === "successful")
        ? "parsed"
        : documentFailures.length > 0
          ? "failed"
          : files.some((file) => file.role === "po")
            ? "skipped"
            : "not available",
      detail: poItems.length > 0
        ? `${poItems.length} purchase order document${poItems.length === 1 ? "" : "s"} used`
        : documentFailures.length > 0
          ? "PO document downloaded, text not extracted"
          : files.some((file) => file.role === "po")
            ? "PO document available for manual review"
            : "No PO document detected",
    },
    {
      label: "Artwork files",
      status: artworkFiles.length > 0 ? "available" : "not available",
      detail: artworkFiles.length > 0
        ? `${artworkFiles.length} artwork file${artworkFiles.length === 1 ? "" : "s"} at thread level`
        : "No artwork files detected",
    },
  ];

  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Evidence Used</h3>
        <Badge variant="outline">{rows.filter((row) => row.status !== "not available").length}</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md border border-border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{row.label}</div>
              <Badge variant={row.status === "failed" ? "destructive" : row.status === "parsed" || row.status === "available" ? "secondary" : "outline"}>
                {titleCase(row.status)}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{row.detail}</div>
          </div>
        ))}
      </div>
      <EvidenceReconciliationSection draft={draft} />
    </section>
  );
}

function QueueTriageControls({
  filters,
  searchValue,
  summary,
  isLoading,
  onChange,
  onSearchChange,
}: {
  filters: QueueFilters;
  searchValue: string;
  summary: InboundOrderQueueSummary | null;
  isLoading: boolean;
  onChange: (filters: QueueFilters) => void;
  onSearchChange: (value: string) => void;
}) {
  const setFilter = (patch: Partial<QueueFilters>) => onChange({ ...filters, ...patch });
  const statusButtons: Array<{ value: QueueStatusFilter; label: string; count: number | null }> = [
    {
      value: "active",
      label: "Active",
      count: summary
        ? summary.needsReview + summary.waitingOnCustomer + summary.readyReviewed
        : null,
    },
    { value: "needs_review", label: "Needs Review", count: summary?.needsReview ?? 0 },
    { value: "waiting", label: "Waiting", count: summary?.waitingOnCustomer ?? 0 },
    { value: "ready", label: "Ready", count: summary?.readyReviewed ?? 0 },
    { value: "converted", label: "Converted", count: summary?.convertedSubmitted ?? 0 },
    { value: "rejected", label: "Rejected", count: summary?.rejectedTerminal ?? 0 },
    { value: "ignored", label: "Ignored", count: summary?.ignored ?? 0 },
  ];

  const activeStatus = statusButtons.find((button) => button.value === filters.statusGroup);
  const activeFilterCount = [
    filters.sourceType !== "all",
    filters.trustFilter !== "all",
    filters.hasWarnings,
    !filters.unconvertedOnly,
    filters.statusGroup !== "active",
  ].filter(Boolean).length;

  return (
    <div className="box-border min-w-0 max-w-full overflow-visible border-b border-border bg-background p-2">
      <div className="flex min-w-0 items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 w-full max-w-full pl-7 text-xs"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search queue"
          />
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="group flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Open queue filters">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={4}
            className="w-[min(310px,calc(100vw-1rem))] p-2"
            data-testid="inbound-queue-filters-popover"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Queue Filters</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {statusButtons.map((button) => (
                <Button
                  key={button.value}
                  type="button"
                  size="sm"
                  className="h-8 justify-between px-2 text-xs"
                  variant={filters.statusGroup === button.value ? "default" : "outline"}
                  onClick={() => setFilter({
                    statusGroup: button.value,
                    unconvertedOnly: button.value === "converted" || button.value === "ignored" ? false : filters.unconvertedOnly,
                  })}
                >
                  <span className="truncate">{button.label}</span>
                  {button.count !== null && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{button.count}</Badge>}
                </Button>
              ))}
            </div>
            <div className="mt-2 grid gap-2">
              <select
                className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={filters.sourceType}
                onChange={(event) => setFilter({ sourceType: event.target.value as QueueFilters["sourceType"] })}
                disabled={isLoading}
                aria-label="Source type filter"
              >
                {sourceTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={filters.trustFilter}
                onChange={(event) => setFilter({ trustFilter: event.target.value as QueueFilters["trustFilter"] })}
                disabled={isLoading}
                aria-label="Sender trust filter"
              >
                {trustFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={filters.sort}
                onChange={(event) => setFilter({ sort: event.target.value as QueueFilters["sort"] })}
                disabled={isLoading}
                aria-label="Queue sort"
              >
                {queueSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <label className="flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-input px-2 py-1 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={filters.hasWarnings}
                    onChange={(event) => setFilter({ hasWarnings: event.target.checked })}
                    disabled={isLoading}
                  />
                  Warnings
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{summary?.withWarnings ?? 0}</Badge>
                </label>
                <label className="flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-input px-2 py-1 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={filters.unconvertedOnly}
                    onChange={(event) => setFilter({ unconvertedOnly: event.target.checked })}
                    disabled={isLoading}
                  />
                  Unconverted
                </label>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{activeStatus?.label ?? "Active"} queue</span>
        <span className="shrink-0">{summary ? `${summary.needsReview} review / ${summary.readyReviewed} ready` : "Loading"}</span>
      </div>
    </div>
  );
}

function ManualIntakeDialog({
  open,
  isCreating,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  isCreating: boolean;
  error: Error | null;
  onClose: () => void;
  onCreate: (payload: ManualInboundOrderCreateRequest) => Promise<void>;
}) {
  const [form, setForm] = useState({
    reference: "",
    senderName: "",
    senderEmail: "",
    subject: "",
    bodyText: "",
    notes: "",
  });
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const setField = (field: keyof typeof form, value: string) => {
    setLocalError(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const bodyText = form.bodyText.trim();
    if (!bodyText) {
      setLocalError("Body text is required.");
      return;
    }

    try {
      await onCreate({
        reference: trimToNull(form.reference),
        senderName: trimToNull(form.senderName),
        senderEmail: trimToNull(form.senderEmail),
        subject: trimToNull(form.subject),
        bodyText,
        notes: trimToNull(form.notes),
      });
      setForm({ reference: "", senderName: "", senderEmail: "", subject: "", bodyText: "", notes: "" });
      onClose();
    } catch (createError) {
      setLocalError(createError instanceof Error ? createError.message : "Failed to create manual intake record.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-xl rounded-md border border-border bg-background p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Manual Intake</h2>
            <p className="mt-1 text-sm text-muted-foreground">Create a TEMP_INBOUND record for staff review.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isCreating}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reference</span>
            <Input value={form.reference} onChange={(event) => setField("reference", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sender email</span>
            <Input value={form.senderEmail} onChange={(event) => setField("senderEmail", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sender name</span>
            <Input value={form.senderName} onChange={(event) => setField("senderName", event.target.value)} maxLength={255} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Subject</span>
            <Input value={form.subject} onChange={(event) => setField("subject", event.target.value)} maxLength={500} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Body text</span>
            <Textarea
              value={form.bodyText}
              onChange={(event) => setField("bodyText", event.target.value)}
              rows={6}
              required
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <Textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} />
          </label>
        </div>

        {(localError || error) && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {localError || error?.message}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button type="submit" disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create TEMP Record
          </Button>
        </div>
      </form>
    </div>
  );
}

function InboundQueuePanel({
  records,
  selectedId,
  selectedRecordIds,
  onSelect,
  onToggleSelected,
  onTrustAction,
}: {
  records: ClientInboundOrderRecord[];
  selectedId: string | null;
  selectedRecordIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleSelected: (id: string, selected: boolean) => void;
  onTrustAction: (record: ClientInboundOrderRecord, action: InboundRecordTrustAction) => void;
}) {
  const [expandedActionsRecordId, setExpandedActionsRecordId] = useState<string | null>(null);
  if (records.length === 0) {
    return (
      <EmptyPanel
        title="No inbound records"
        detail="Create a manual TEMP_INBOUND record, adjust the filters, or run the inbound migration if this environment is not migrated yet."
      />
    );
  }

  return (
    <div className="h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden">
      <div className="box-border w-full min-w-0 max-w-full divide-y divide-border overflow-x-hidden">
        {records.map((record) => {
          const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
          const intentLabel = record.sourceType === "email" ? getInboundIntentLabel(record) : null;
          const recordAge = formatRelative(record.createdAt);
          const queueCustomer = getSenderLabel(record);
          const queueRequest = evidence.reference || getRecordTitle(record);
          const issueChip = getQueueIssueChip(record);
          const isSelected = selectedId === record.id;
          const actionsExpanded = isSelected && expandedActionsRecordId === record.id;
          return (
            <div
              key={record.id}
              onClick={() => onSelect(record.id)}
              onKeyDown={(event) => {
                if (shouldIgnoreShortcutKeydown(event)) return;
                if (event.key === "Enter" || event.key === " ") onSelect(record.id);
              }}
              role="button"
              tabIndex={0}
              className={cn(
                "block box-border w-full min-w-0 max-w-full cursor-pointer overflow-x-hidden border-l-2 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isSelected
                  ? "border-l-primary bg-primary/10"
                  : "bg-card hover:bg-muted/50",
                !isSelected && "border-l-transparent",
              )}
            >
              <div className="flex min-w-0 max-w-full items-start justify-between gap-2 overflow-hidden">
                <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                  <input
                    type="checkbox"
                    className="mt-1 h-3.5 w-3.5 shrink-0"
                    checked={selectedRecordIds.has(record.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onToggleSelected(record.id, event.target.checked)}
                    aria-label={`Select inbound record ${getRecordTitle(record)}`}
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="block max-w-full truncate text-sm font-semibold leading-5 text-foreground">{queueCustomer}</div>
                        <div className="block max-w-full truncate text-xs font-medium text-muted-foreground">{queueRequest}</div>
                      </div>
                    </div>
                    <div className="mt-1 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
                      {intentLabel ? (
                        <Badge variant="outline" className="h-5 max-w-full truncate border-0 px-0 text-[11px] font-medium text-muted-foreground shadow-none">
                          {intentLabel}
                        </Badge>
                      ) : null}
                      {intentLabel ? <span className="text-[11px] text-muted-foreground">/</span> : null}
                      <span className="text-[11px] font-medium text-muted-foreground">{statusLabels[record.status]}</span>
                      {issueChip && (
                        <Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-800">
                          {issueChip}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 sm:hidden">
                  <StatusBadge status={record.status} />
                </div>
              </div>
              <div className="mt-1 flex max-w-full items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
                <span className="truncate">{recordAge}</span>
                {issueChip && (
                  <>
                    <span className="shrink-0">/</span>
                    <span className="truncate text-amber-700">{issueChip}</span>
                  </>
                )}
              </div>
              {isSelected && shouldShowInlineTrustActions(record) && (
                <div className="mt-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px]"
                    aria-expanded={actionsExpanded}
                    aria-label={`Queue actions for ${getRecordTitle(record)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedActionsRecordId((current) => current === record.id ? null : record.id);
                    }}
                  >
                    Actions
                    <ChevronDown className={cn("ml-1 h-3 w-3 transition-transform", actionsExpanded && "rotate-180")} />
                  </Button>
                </div>
              )}
              {actionsExpanded && (
                <div className="mt-1.5 grid max-w-full grid-cols-1 gap-1">
                  {(["trust_sender", "trust_domain", "trust_sender_and_download", "trust_domain_and_download"] as InboundRecordTrustAction[]).map((action) => (
                    <Button
                      key={action}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 justify-start px-1.5 text-[10px]"
                      aria-label={`${recordTrustActionLabel(action)} for ${getRecordTitle(record)}`}
                      data-testid={`queue-trust-action-${record.id}-${action}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTrustAction(record, action);
                      }}
                    >
                      {recordTrustActionLabel(action)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InboundAttachmentCard({
  recordId,
  file,
  compact = false,
  minimal = false,
  onClassify,
  useInAppViewer = false,
  onOpenAttachment,
}: {
  recordId: string;
  file: ClientInboundOrderFile;
  compact?: boolean;
  minimal?: boolean;
  onClassify?: () => void;
  useInAppViewer?: boolean;
  onOpenAttachment?: (recordId: string, file: ClientInboundOrderFile) => void;
}) {
  const downloadUrl = inboundFileDownloadUrl(recordId, file);
  return (
    <div className={cn(
      "flex w-full min-w-0 flex-wrap items-center justify-between gap-3 overflow-hidden rounded-md border border-border bg-background px-3 py-2",
      compact && "px-2 py-1.5",
    )}>
      <div className="min-w-0 flex-1">
        <div className="min-w-0 truncate break-words text-sm font-medium text-foreground">{file.sourceFilename || "Attachment"}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{file.mimeType || "unknown type"}</span>
          <span>{formatFileSize(file.sizeBytes)}</span>
          {!minimal && <span>Status: {titleCase(file.status)}</span>}
          <Badge variant={file.role === "po" ? "default" : file.role === "artwork" ? "secondary" : "outline"}>
            {inboundAttachmentRoleLabel(file.role)}
          </Badge>
          {isArchiveAttachment(file) && <Badge variant="outline">ZIP / archive</Badge>}
          {isQuarantinedAttachment(file) && <Badge variant="destructive">Quarantined</Badge>}
          {!file.fileRecordId && <Badge variant="outline">Metadata only</Badge>}
        </div>
        {!minimal && file.reviewNotes && (
          <div className="mt-1 text-xs text-muted-foreground">{file.reviewNotes}</div>
        )}
        {!file.fileRecordId && (
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">
            File unavailable: {inboundFileUnavailableReason(file)}
          </div>
        )}
        {!minimal && <AttachmentSafetyDetails recordId={recordId} file={file} />}
      </div>
      {useInAppViewer ? (
        <CleanAttachmentFileActions recordId={recordId} file={file} onClassify={onClassify} onOpenAttachment={onOpenAttachment} />
      ) : downloadUrl ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={downloadUrl} download>
              <Download className="mr-2 h-4 w-4" />
              Download
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SourceEvidencePanel({
  detail,
  selectedRecord,
  isLoading,
  latestAttempt,
  draftPreview,
  parseError,
  isParsing,
  parseDisabled,
  isRejecting,
  isCleaningUp,
  rejectDisabled,
  onParse,
  onReject,
  onQueueAction,
  onTrustAction,
  onEmailReprocess,
  isEmailReprocessing,
}: {
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  latestAttempt: ClientInboundOrderParseAttempt | null;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  parseError: Error | null;
  isParsing: boolean;
  parseDisabled: boolean;
  isRejecting: boolean;
  isCleaningUp: boolean;
  rejectDisabled: boolean;
  onParse: () => void;
  onReject: () => void;
  onQueueAction: (action: InboundQueueCleanupAction) => void;
  onTrustAction: (record: ClientInboundOrderRecord, action: InboundRecordTrustAction) => void;
  onEmailReprocess: (record: ClientInboundOrderRecord, action: InboundEmailReprocessAction) => void;
  isEmailReprocessing: boolean;
}) {
  if (!selectedRecord) {
    return <EmptyPanel title="Select a record" detail="Source evidence will appear once an inbound item is selected." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const record = detail?.record ?? selectedRecord;
  const combinedSources = combinedInboundSources(record);
  const reparseRecommended = Boolean(
    record.normalizedPayloadJson
      && typeof record.normalizedPayloadJson === "object"
      && !Array.isArray(record.normalizedPayloadJson)
      && (record.normalizedPayloadJson as Record<string, unknown>).reparseRecommended,
  );
  const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
  const warnings = detail?.warnings ?? [];
  const evidenceItems = draftPreview?.draft?.evidence?.items ?? [];
  const attachmentEvidence = evidenceItems.filter((item) => (
    item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT"
  ));
  const evidenceConflicts = draftPreview?.draft?.evidence?.conflicts ?? [];
  const emailFiles = dedupeAttachmentFiles(detail?.files ?? []);
  const threadEvidence = record.sourceType === "email" ? (evidence as ReturnType<typeof getInboundEmailEvidence>).thread : null;
  const threadMessageCount = typeof threadEvidence?.messageCount === "number" ? threadEvidence.messageCount : null;
  const latestThreadActivity = stringFromUnknown(threadEvidence?.latestActivityAt);
  const intentLabel = record.sourceType === "email" ? getInboundIntentLabel(record) : null;
  const intentReasons = record.sourceType === "email" ? getInboundIntentReasons(record) : [];
  const showPendingTrustNotice = record.sourceType === "email"
    && record.attachmentDownloadPolicy === "pending_trust"
    && emailFiles.length > 0;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{getRecordTitle(record)}</h2>
              <div className="mt-1 text-xs text-muted-foreground">TEMP_INBOUND / review-first intake</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge variant="secondary">{titleCase(record.sourceType)}</Badge>
              {intentLabel ? <Badge variant="outline">{intentLabel}</Badge> : null}
              <StatusBadge status={record.status} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEmailReprocess(record, "backfill_attachments")}
                disabled={rejectDisabled || isEmailReprocessing}
                aria-label="Backfill inbound email attachments"
              >
                {isEmailReprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2 h-4 w-4" />}
                Backfill Attachments
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEmailReprocess(record, "reprocess_email")}
                disabled={rejectDisabled || isEmailReprocessing}
                aria-label="Reprocess inbound email"
              >
                {isEmailReprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                Reprocess
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onQueueAction("ignore_once")}
                disabled={rejectDisabled || isCleaningUp}
                aria-label="Ignore inbound record once"
              >
                {isCleaningUp ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Ignore Once
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onQueueAction("ignore_sender")}
                disabled={rejectDisabled || isCleaningUp}
                aria-label="Ignore inbound sender"
              >
                Ignore Sender
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onQueueAction("ignore_domain")}
                disabled={rejectDisabled || isCleaningUp}
                aria-label="Ignore inbound sender domain"
              >
                Ignore Domain
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onQueueAction("ignore_subject")}
                disabled={rejectDisabled || isCleaningUp}
                aria-label="Ignore inbound subject"
              >
                Ignore Subject
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={rejectDisabled}
                aria-label="Reject inbound record"
              >
                {isRejecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                )}
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onQueueAction("delete")}
                disabled={rejectDisabled || isCleaningUp}
                aria-label="Delete inbound queue record"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
              <Button type="button" size="sm" onClick={onParse} disabled={parseDisabled}>
                {isParsing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {isParsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </div>
          </div>
          {record.sourceType === "email" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
              <button type="button" onClick={() => shouldShowInlineTrustActions(record) && onTrustAction(record, "trust_sender")}>
                <Badge variant={getSenderTrustBadgeVariant(record.senderTrustStatus)}>
                  {senderTrustLabels[record.senderTrustStatus]}
                </Badge>
              </button>
              <button type="button" onClick={() => shouldShowInlineTrustActions(record) && onTrustAction(record, "trust_sender_and_download")}>
                <Badge variant={getAttachmentPolicyBadgeVariant(record.attachmentDownloadPolicy)}>
                  {attachmentPolicyLabels[record.attachmentDownloadPolicy]}
                </Badge>
              </button>
              {record.trustReason && <span className="min-w-0 flex-1 text-muted-foreground">{record.trustReason}</span>}
              {shouldShowInlineTrustActions(record) && (
                <div className="flex flex-wrap gap-1.5">
                  {(["trust_sender", "trust_domain", "trust_sender_and_download", "trust_domain_and_download"] as InboundRecordTrustAction[]).map((action) => (
                    <Button
                      key={action}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={isCleaningUp}
                      aria-label={`${recordTrustActionLabel(action)} for ${getRecordTitle(record)}`}
                      data-testid={`review-trust-action-${record.id}-${action}`}
                      onClick={() => onTrustAction(record, action)}
                    >
                      {recordTrustActionLabel(action)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showPendingTrustNotice && (
            <Alert className="mt-3 border-amber-200 bg-amber-50 text-amber-950">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Attachments are waiting for trust approval.</AlertTitle>
              <AlertDescription>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Use the attachment actions below to download once, or trust the sender first.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => onTrustAction(record, "trust_sender")} disabled={isCleaningUp}>
                    Trust Sender
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onTrustAction(record, "trust_domain")} disabled={isCleaningUp}>
                    Trust Domain
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onTrustAction(record, "trust_sender_and_download")} disabled={isCleaningUp}>
                    Trust Sender + Download Attachments
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onTrustAction(record, "trust_domain_and_download")} disabled={isCleaningUp}>
                    Trust Domain + Download Attachments
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <DetailField label="Reference" value={evidence.reference} />
            <DetailField label="Sender" value={getSenderLabel(record)} />
            <DetailField label="Subject" value={evidence.subject} />
            <DetailField label="Source type" value={titleCase(record.sourceType)} />
            <DetailField label="Created" value={formatTimestamp(record.createdAt)} />
            <DetailField label="Updated" value={formatTimestamp(record.updatedAt)} />
            {record.sourceType === "email" && (
              <>
                <DetailField label="Thread messages" value={threadMessageCount == null ? null : String(threadMessageCount)} />
                <DetailField label="Latest thread activity" value={latestThreadActivity ? formatTimestamp(latestThreadActivity) : null} />
              </>
            )}
          </div>
          {record.sourceType === "email" && intentReasons.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Intent evidence</div>
                {intentLabel ? <Badge variant="outline">{intentLabel}</Badge> : null}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {intentReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 rounded-md border border-border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">AI Parse Attempt</div>
              {latestAttempt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={latestAttempt.status === "failed" ? "destructive" : "secondary"}>
                    {titleCase(latestAttempt.status)}
                  </Badge>
                  <Badge variant="outline">{latestAttempt.confidence ?? 0}% confidence</Badge>
                  <Badge variant="outline">{Array.isArray(latestAttempt.warnings) ? latestAttempt.warnings.length : 0} warnings</Badge>
                </div>
              ) : (
                <Badge variant="outline">Not parsed</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {latestAttempt ? `Last attempt ${formatRelative(latestAttempt.createdAt)}` : "No AI parse has been run for this record."}
            </div>
            {isParsing && (
              <div className="mt-2 flex items-center gap-2 text-xs font-medium text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Parsing source evidence...
              </div>
            )}
          </div>
          {!isParsing && (parseError || latestAttempt?.status === "failed") && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Parse unavailable</AlertTitle>
              <AlertDescription>
                {parseError
                  ? operatorSafeParseErrorMessage(parseError)
                  : (Array.isArray(latestAttempt?.errors) && latestAttempt.errors.length > 0
                    ? latestAttempt.errors.map((error: any) => error?.message).filter(Boolean).join(" ")
                    : "AI parsing failed. Source evidence remains available for retry.")}
              </AlertDescription>
            </Alert>
          )}
        </section>

        {record.sourceType === "email" && <ThreadTimeline thread={threadEvidence} />}

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Body Text</h3>
          </div>
          {evidence.bodyText ? (
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
              {evidence.bodyText}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No body text was captured.</div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Notes</h3>
          <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{evidence.notes || "No notes."}</div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Attachments</h3>
            <Badge variant="outline">{dedupeAttachmentFiles(detail?.files ?? []).length}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {dedupeAttachmentFiles(detail?.files ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No attachments linked to this inbound record.</div>
            ) : (
              dedupeAttachmentFiles(detail?.files ?? []).map((file) => {
                const extracted = attachmentEvidence.find((item) => item.sourceId === file.id);
                const seenCount = attachmentSeenMessageCount(file);
                const downloadUrl = file.fileRecordId && file.status !== "quarantined" && file.status !== "rejected"
                  ? `/api/inbound-orders/${encodeURIComponent(record.id)}/files/${encodeURIComponent(file.id)}/download`
                  : null;
                return (
                  <div key={file.id} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{file.sourceFilename || "Attachment"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{file.mimeType || "unknown type"}</span>
                          <span>{formatFileSize(file.sizeBytes)}</span>
                          <span>Source: Gmail attachment</span>
                          <span>Status: {titleCase(file.status)}</span>
                          {seenCount ? <span>Seen in {seenCount} messages</span> : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant={file.role === "po" ? "default" : file.role === "artwork" ? "secondary" : "outline"}>
                            {inboundAttachmentRoleLabel(file.role)}
                          </Badge>
                          {file.providerAttachmentId && <Badge variant="outline">Provider ID captured</Badge>}
                          {!file.fileRecordId && <Badge variant="outline">Metadata only</Badge>}
                        </div>
                        {extracted && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Pages: {extracted.pageCount ?? "-"} / Extraction: {titleCase(extracted.extractionStatus)}
                          </div>
                        )}
                        {file.reviewNotes && (
                          <div className="mt-1 text-xs text-muted-foreground">{file.reviewNotes}</div>
                        )}
                        <AttachmentSafetyDetails recordId={record.id} file={file} />
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {extracted ? (
                          <>
                            <Badge variant={extracted.documentType === "purchase_order" ? "default" : "outline"}>
                              {titleCase(extracted.documentType)}
                            </Badge>
                            <Badge variant="secondary">{extracted.documentConfidence}%</Badge>
                          </>
                        ) : (
                          <Badge variant="outline">Not extracted</Badge>
                        )}
                        {downloadUrl && (
                          <Button asChild size="sm" variant="outline">
                            <a href={downloadUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                    {extracted?.poSummary && (
                      <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">PO Extraction Summary</div>
                        <PoSummaryGrid summary={extracted.poSummary} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {evidenceConflicts.length > 0 && (
            <div className="mt-3 space-y-2">
              {evidenceConflicts.map((conflict, index) => (
                <div key={`${conflict.code}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <div className="font-medium">{conflict.code}</div>
                  <div className="text-xs">{conflict.message}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Warnings</h3>
            <Badge variant="outline">{warnings.length}</Badge>
          </div>
          <div className="mt-2 space-y-2">
            {warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings.</div>
            ) : (
              warnings.map((warning) => (
                <div key={warning.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="font-medium text-foreground">{warning.code}</div>
                  <div className="text-xs text-muted-foreground">{warning.message}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Audit Trail</h3>
          </div>
          <div className="space-y-3">
            {(detail?.events ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No events recorded.</div>
            ) : (
              detail?.events.map((event) => (
                <div key={event.id} className="border-l border-border pl-3">
                  <div className="text-sm font-medium text-foreground">{event.eventType}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.message || event.actorType} / {formatRelative(event.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function OperationalEmailPanel({
  detail,
  selectedRecord,
  isLoading,
  latestAttempt,
  draftPreview,
  parseError,
  isParsing,
  activeTab = "email",
  onEmailReprocess,
  isEmailReprocessing,
}: {
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  selectedRecord: ClientInboundOrderRecord | null;
  isLoading: boolean;
  latestAttempt: ClientInboundOrderParseAttempt | null;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  parseError: Error | null;
  isParsing: boolean;
  activeTab?: SourceDocumentTab;
  onEmailReprocess: (record: ClientInboundOrderRecord, action: InboundEmailReprocessAction) => void;
  isEmailReprocessing: boolean;
}) {
  if (!selectedRecord) {
    return <EmptyPanel title="Select a record" detail="The original email and attachments will appear once an inbound item is selected." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const record = detail?.record ?? selectedRecord;
  const combinedSources = combinedInboundSources(record);
  const evidence = getInboundEmailEvidence(record);
  const files = dedupeAttachmentFiles(detail?.files ?? []);
  const threadMessageCount = typeof evidence.thread?.messageCount === "number" ? evidence.thread.messageCount : null;
  const latestThreadActivity = stringFromUnknown(evidence.thread?.latestActivityAt);
  const poFiles = files.filter((file) => file.role === "po");
  const artworkFiles = files.filter((file) => file.role === "artwork");
  const signatureFiles = files.filter(isLikelySignatureInlineFile);
  const referenceFiles = files.filter((file) => file.role === "reference");
  const poEvidenceItems = (draftPreview?.draft?.evidence?.items ?? [])
    .filter((item) => (item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT") && (item.documentType === "purchase_order" || item.poSummary));

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-2 max-[1023px]:space-y-1.5 max-[1023px]:p-1.5" data-testid="inbound-operational-email-panel">
        <section className="rounded-md border border-border bg-card px-3 py-2 max-[1023px]:px-2 max-[1023px]:py-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h2 className="truncate text-base font-semibold text-foreground">{evidence.subject || "No subject"}</h2>
              </div>
              <div className="mt-1 grid gap-1 text-xs text-muted-foreground max-[1023px]:flex max-[1023px]:flex-wrap max-[1023px]:gap-x-3 max-[1023px]:gap-y-1">
                <div><span className="font-medium text-foreground">From:</span> {getSenderLabel(record)}</div>
                {evidence.recipients.length > 0 && (
                  <div><span className="font-medium text-foreground">To:</span> {evidence.recipients.join(", ")}</div>
                )}
                {evidence.cc.length > 0 && (
                  <div><span className="font-medium text-foreground">Cc:</span> {evidence.cc.join(", ")}</div>
                )}
                <div><span className="font-medium text-foreground">Received:</span> {formatTimestamp(evidence.receivedAt)}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="hidden h-7 px-2 text-xs min-[1024px]:inline-flex"
                disabled={isEmailReprocessing}
                onClick={() => onEmailReprocess(record, "backfill_attachments")}
              >
                {isEmailReprocessing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
                Backfill Attachments
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="hidden h-7 px-2 text-xs min-[1024px]:inline-flex"
                disabled={isEmailReprocessing}
                onClick={() => onEmailReprocess(record, "reprocess_email")}
              >
                {isEmailReprocessing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Reprocess
              </Button>
              {latestAttempt ? (
                <Badge variant={latestAttempt.status === "failed" ? "destructive" : "secondary"}>
                  {titleCase(latestAttempt.status)}
                </Badge>
              ) : (
                <Badge variant="outline">Not parsed</Badge>
              )}
              <Badge variant="outline">{titleCase(record.sourceType)}</Badge>
              <details className="group relative min-[1024px]:hidden">
                <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  Actions
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 top-8 z-20 grid w-56 gap-1 rounded-md border border-border bg-popover p-1.5 shadow-xl">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 justify-start px-2 text-xs"
                    disabled={isEmailReprocessing}
                    onClick={() => onEmailReprocess(record, "backfill_attachments")}
                  >
                    {isEmailReprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2 h-4 w-4" />}
                    Backfill Attachments
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 justify-start px-2 text-xs"
                    disabled={isEmailReprocessing}
                    onClick={() => onEmailReprocess(record, "reprocess_email")}
                  >
                    {isEmailReprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    Reprocess
                  </Button>
                </div>
              </details>
            </div>
          </div>
          {threadMessageCount != null && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Thread messages: {threadMessageCount}</span>
              {latestThreadActivity && <span>Latest activity: {formatTimestamp(latestThreadActivity)}</span>}
            </div>
          )}
          {isParsing && (
            <div className="mt-2 flex items-center gap-2 text-xs font-medium text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Parsing source evidence...
            </div>
          )}
          {!isParsing && (parseError || latestAttempt?.status === "failed") && (
            <Alert variant="destructive" className="mt-2 py-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Parse unavailable</AlertTitle>
              <AlertDescription>
                {parseError
                  ? operatorSafeParseErrorMessage(parseError)
                  : (Array.isArray(latestAttempt?.errors) && latestAttempt.errors.length > 0
                    ? latestAttempt.errors.map((error: any) => error?.message).filter(Boolean).join(" ")
                    : "AI parsing failed. Original email evidence remains available.")}
              </AlertDescription>
            </Alert>
          )}
        </section>

        {activeTab === "email" && (
          <SourceEmailDocumentViewer
            record={record}
            evidence={evidence}
            files={files.filter((file) => !isLikelySignatureInlineFile(file))}
          />
        )}

        {activeTab === "po" && (
          <SourceDocumentPoPanel
            recordId={record.id}
            poFiles={poFiles}
            poEvidenceItems={poEvidenceItems}
          />
        )}
        {activeTab === "artwork" && (
          <SourceDocumentArtworkPanel
            recordId={record.id}
            artworkFiles={artworkFiles}
            referenceFiles={referenceFiles}
            signatureFiles={signatureFiles}
          />
        )}
        {activeTab === "history" && (
          <div className="space-y-3 p-3">
            {combinedSources.length > 1 && (
              <section className="rounded-md border border-slate-700 bg-slate-900/70 p-3" data-testid="combined-inbound-sources">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-200">Combined Sources</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">Combined from {combinedSources.length} emails</div>
                <div className="mt-2 space-y-2">
                  {combinedSources.map((source, index) => {
                    const sourceEvidence = source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
                      ? source.evidence as Record<string, unknown>
                      : {};
                    const sender = typeof sourceEvidence.senderEmail === "string" ? sourceEvidence.senderEmail : "Unknown sender";
                    const subject = typeof sourceEvidence.subject === "string" ? sourceEvidence.subject : "No subject";
                    const bodyText = typeof sourceEvidence.bodyText === "string" ? sourceEvidence.bodyText : null;
                    const receivedAt = typeof source.receivedAt === "string" ? source.receivedAt : null;
                    return (
                      <div key={typeof source.recordId === "string" ? source.recordId : index} className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300">
                        <div className="truncate font-medium text-slate-100">{subject}</div>
                        <div className="truncate text-slate-400">{sender}{receivedAt ? ` · ${new Date(receivedAt).toLocaleString()}` : ""}</div>
                        {bodyText && (
                          <details className="mt-1 text-slate-400">
                            <summary className="cursor-pointer text-slate-300">View message</summary>
                            <p className="mt-1 whitespace-pre-wrap break-words">{bodyText}</p>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <SourceHistoryPanel thread={evidence.thread} />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function CleanInboundQueue({
  records,
  selectedId,
  filters,
  searchValue,
  summary,
  isLoading,
  selectedRecordIds,
  isBulkActionPending,
  onSelect,
  onChange,
  onSearchChange,
  onToggleSelected,
  onToggleVisibleSelected,
  onBulkAction,
  onCombineSelected,
  onAttachToExistingOrder,
}: {
  records: ClientInboundOrderRecord[];
  selectedId: string | null;
  filters: QueueFilters;
  searchValue: string;
  summary: InboundOrderQueueSummary | null;
  isLoading: boolean;
  selectedRecordIds: Set<string>;
  isBulkActionPending: boolean;
  onSelect: (id: string) => void;
  onChange: (filters: QueueFilters) => void;
  onSearchChange: (value: string) => void;
  onToggleSelected: (id: string, selected: boolean) => void;
  onToggleVisibleSelected: (ids: string[], selected: boolean) => void;
  onBulkAction: (action: InboundQueueCleanupAction) => void;
  onCombineSelected: () => void;
  onAttachToExistingOrder: (recordId: string) => void;
}) {
  const [quickFilters, setQuickFilters] = useState({
    trusted: false,
    untrusted: false,
    issue: false,
  });
  const quickFilterActive = quickFilters.trusted || quickFilters.untrusted || quickFilters.issue;
  const visibleRecords = quickFilterActive
    ? records.filter((record) => (
      (quickFilters.trusted && isTrustedInboundRecord(record))
      || (quickFilters.untrusted && isUntrustedInboundRecord(record))
      || (quickFilters.issue && Boolean(getQueueIssueChip(record)))
    ))
    : records;
  const toggleQuickFilter = (key: keyof typeof quickFilters, checked: boolean) => {
    setQuickFilters((current) => ({ ...current, [key]: checked }));
  };
  const visibleRecordIds = visibleRecords.map((record) => record.id);
  const selectedVisibleCount = visibleRecordIds.filter((id) => selectedRecordIds.has(id)).length;
  const allVisibleSelected = visibleRecordIds.length > 0 && selectedVisibleCount === visibleRecordIds.length;
  return (
    <aside className="flex h-full min-h-0 w-full flex-1 flex-col border-r border-slate-700 bg-slate-950 text-slate-100" data-testid="clean-inbound-queue">
      <div className="border-b border-slate-700 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Queue</div>
            <div className="text-[11px] text-slate-500">{visibleRecords.length} visible</div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 text-[11px] font-semibold text-slate-200"
                aria-label="Open Clean View queue filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              className="grid w-[min(16rem,calc(100vw-1rem))] gap-2 border-slate-700 bg-slate-950 p-3 text-slate-100 shadow-xl"
              data-testid="clean-queue-filters-popover"
            >
              <Input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search queue"
                className="h-8 border-slate-700 bg-slate-900 text-xs text-slate-100"
              />
              <select
                aria-label="Clean queue status filter"
                className="h-8 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100"
                value={filters.statusGroup}
                onChange={(event) => onChange({ ...filters, statusGroup: event.target.value as QueueStatusFilter })}
              >
                <option value="active">Active queue</option>
                <option value="needs_review">Needs Review</option>
                <option value="ready">Ready</option>
                <option value="all">All statuses</option>
              </select>
              <select
                aria-label="Clean queue sort"
                className="h-8 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100"
                value={filters.sort}
                onChange={(event) => onChange({ ...filters, sort: event.target.value as QueueFilters["sort"] })}
              >
                {queueSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={filters.hasWarnings}
                  onChange={(event) => onChange({ ...filters, hasWarnings: event.target.checked })}
                />
                Warnings only
              </label>
            </PopoverContent>
          </Popover>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300" data-testid="clean-queue-quick-filters">
          {([
            ["trusted", "Trusted"],
            ["untrusted", "Untrusted"],
            ["issue", "Issue"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-1">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={quickFilters[key]}
                onChange={(event) => toggleQuickFilter(key, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
        {visibleRecords.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[11px] text-slate-300">
            <label className="flex min-w-0 items-center gap-1.5">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={allVisibleSelected}
                onChange={(event) => onToggleVisibleSelected(visibleRecordIds, event.target.checked)}
                aria-label="Select all visible Clean View queue records"
              />
              <span className="truncate">Select visible</span>
            </label>
            <span className="shrink-0 text-slate-500">{selectedVisibleCount}/{visibleRecords.length}</span>
          </div>
        )}
        {selectedRecordIds.size > 0 && (
          <details className="mt-2 rounded border border-slate-800 bg-slate-900/80" data-testid="clean-queue-bulk-actions">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-semibold text-slate-200">
              <span>{selectedRecordIds.size} selected</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </summary>
            <div className="grid grid-cols-2 gap-1 border-t border-slate-800 p-1.5">
              {selectedRecordIds.size === 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="col-span-2 h-7 justify-start px-2 text-[10px]"
                  disabled={isBulkActionPending}
                  onClick={() => onAttachToExistingOrder(Array.from(selectedRecordIds)[0])}
                >
                  Attach to Existing Order
                </Button>
              )}
              {selectedRecordIds.size >= 2 && (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="col-span-2 h-7 justify-start px-2 text-[10px]"
                  disabled={isBulkActionPending}
                  onClick={onCombineSelected}
                >
                  Combine Emails
                </Button>
              )}
              {([
                ["trust_sender", "Trust Sender"],
                ["trust_domain", "Trust Domain"],
                ["ignore_once", "Ignore Once"],
                ["ignore_sender", "Ignore Sender"],
                ["ignore_domain", "Ignore Domain"],
                ["reject", "Reject"],
                ["delete", "Delete"],
              ] as const).map(([action, label]) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant={action === "delete" ? "ghost" : "outline"}
                  className="h-7 justify-start px-2 text-[10px]"
                  disabled={isBulkActionPending}
                  onClick={() => onBulkAction(action)}
                >
                  {action === "delete" && <Trash2 className="mr-1 h-3 w-3" />}
                  {label}
                </Button>
              ))}
            </div>
          </details>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 bg-slate-800" />
            <Skeleton className="h-16 bg-slate-800" />
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No inbound records.</div>
        ) : visibleRecords.map((record) => {
          const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
          const selected = selectedId === record.id;
          const issue = getQueueIssueChip(record);
          const intent = getInboundIntentLabel(record);
          const combinedSourceCount = combinedInboundSources(record).length;
          return (
            <button
              key={record.id}
              type="button"
              className={cn(
                "block w-full border-b border-slate-800 px-3 py-2 text-left transition-colors",
                selected ? "bg-slate-800 shadow-[inset_2px_0_0_#93c5fd]" : "hover:bg-slate-900",
              )}
              onClick={() => onSelect(record.id)}
            >
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  checked={selectedRecordIds.has(record.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onToggleSelected(record.id, event.target.checked)}
                  aria-label={`Select Clean View inbound record ${getRecordTitle(record)}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-100">{getSenderLabel(record)}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-slate-300">{evidence.reference || evidence.subject || getRecordTitle(record)}</div>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                <span>{intent ?? "Unknown"}</span>
                <span>/</span>
                <span>{statusLabels[record.status]}</span>
                {combinedSourceCount > 1 && (
                  <span className="rounded border border-blue-400/50 bg-blue-400/10 px-1.5 py-0.5 font-semibold text-blue-100">
                    Combined from {combinedSourceCount} emails
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px]">
                <span className="text-slate-500">{formatRelative(record.createdAt)}</span>
                {issue && (
                  <>
                    <span className="text-slate-600">/</span>
                    <span className="rounded border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-200">{issue}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CleanAttachmentBulkActions({
  visibleFiles,
  selectedFileIds,
  isPending,
  onToggleFile,
  onToggleVisible,
  onClassify,
}: {
  visibleFiles: ClientInboundOrderFile[];
  selectedFileIds: Set<string>;
  isPending: boolean;
  onToggleFile: (fileId: string, selected: boolean) => void;
  onToggleVisible: (fileIds: string[], selected: boolean) => void;
  onClassify: (classification: InboundAttachmentClassification | "reset_to_ai") => void;
}) {
  const visibleFileIds = visibleFiles.map((file) => file.id);
  const selectedVisibleCount = visibleFileIds.filter((fileId) => selectedFileIds.has(fileId)).length;
  const allVisibleSelected = visibleFileIds.length > 0 && selectedVisibleCount === visibleFileIds.length;
  const selectedFiles = visibleFiles.filter((file) => selectedFileIds.has(file.id));
  const unsafeArtworkCount = selectedFiles.filter((file) => isQuarantinedAttachment(file) || file.status === "rejected" || String(attachmentSafetyMetadata(file).attachmentState ?? "") === "blocked_file_type").length;
  const metadataOnlyCount = selectedFiles.filter((file) => !file.fileRecordId).length;

  if (visibleFiles.length === 0) return null;
  return (
    <div className="mb-3 rounded border border-slate-700 bg-slate-900 p-2" data-testid="clean-bulk-attachment-actions">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          checked={allVisibleSelected}
          aria-label="Select all visible attachments"
          onCheckedChange={(checked) => onToggleVisible(visibleFileIds, checked === true)}
        />
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onToggleVisible(visibleFileIds, !allVisibleSelected)}>
          {allVisibleSelected ? "Clear visible" : "Select all visible"}
        </Button>
        <span className="text-xs text-slate-300">{selectedVisibleCount} file{selectedVisibleCount === 1 ? "" : "s"} selected</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {([
            ["ARTWORK", "Classify as Artwork"],
            ["PO", "Classify as PO"],
            ["REFERENCE", "Classify as Reference"],
            ["IGNORE_INLINE", "Classify as Junk / Signature"],
            ["reset_to_ai", "Reset to AI"],
          ] as const).map(([classification, label]) => (
            <Button
              key={classification}
              type="button"
              size="sm"
              variant={classification === "ARTWORK" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              disabled={selectedVisibleCount === 0 || isPending}
              onClick={() => onClassify(classification)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {unsafeArtworkCount > 0 && <div className="mt-2 text-xs text-amber-200">{unsafeArtworkCount} selected unsafe or quarantined file{unsafeArtworkCount === 1 ? "" : "s"} will be skipped when classifying as Artwork.</div>}
      {metadataOnlyCount > 0 && <div className="mt-1 text-xs text-slate-400">{metadataOnlyCount} metadata-only attachment{metadataOnlyCount === 1 ? "" : "s"} can be classified, but cannot be used as artwork until file content is available.</div>}
    </div>
  );
}

function CleanSelectableAttachment({
  file,
  selected,
  onToggle,
  children,
}: {
  file: ClientInboundOrderFile;
  selected: boolean;
  onToggle: (selected: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2", selected && "rounded ring-1 ring-blue-300")} data-testid="clean-selectable-attachment">
      <Checkbox
        className="mt-2"
        checked={selected}
        aria-label={`Select ${file.sourceFilename || "attachment"}`}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function CleanSourceDocuments({
  selectedRecord,
  detail,
  draftPreview,
  reviewDraft,
  activeTab,
  isLoading,
  isParsing,
  isRescanning,
  parseDisabled,
  rescanDisabled,
  parseError,
  parseCompletedWithoutDraft,
  parseCompletedWithoutDraftMessage,
  sourceChanged,
  onTabChange,
  onParse,
  onRescan,
  attachmentLinks,
  onClassifyAttachment,
  onBulkClassifyAttachments,
  isBulkClassifying,
  form,
  activeTarget,
  onFocusTarget,
  inlineAttachmentSelection,
  onOpenAttachment,
  onCloseInlineAttachment,
  onAttachToExistingOrder,
}: {
  selectedRecord: ClientInboundOrderRecord | null;
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  reviewDraft: InboundOrderReviewDraftDto | undefined;
  activeTab: SourceDocumentTab;
  isLoading: boolean;
  isParsing: boolean;
  isRescanning: boolean;
  parseDisabled: boolean;
  rescanDisabled: boolean;
  parseError: Error | null;
  parseCompletedWithoutDraft: boolean;
  parseCompletedWithoutDraftMessage: string | null;
  sourceChanged: boolean;
  onTabChange: (tab: SourceDocumentTab) => void;
  onParse: () => void;
  onRescan: () => void;
  attachmentLinks: InboundOrderArtworkLink[];
  onClassifyAttachment: (link: InboundOrderArtworkLink) => void;
  onBulkClassifyAttachments: (fileIds: string[], classification: InboundAttachmentClassification | "reset_to_ai") => void;
  isBulkClassifying: boolean;
  form: ReviewDraftFormState | null;
  activeTarget: CleanHighlightTarget | null;
  onFocusTarget: CleanFocusTargetHandler;
  inlineAttachmentSelection: CleanInlineAttachmentSelection;
  onOpenAttachment: (recordId: string, file: ClientInboundOrderFile) => void;
  onCloseInlineAttachment: () => void;
  onAttachToExistingOrder: (recordId: string) => void;
}) {
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(() => new Set());
  const [showAllEmailAttachments, setShowAllEmailAttachments] = useState(false);
  useEffect(() => {
    setSelectedAttachmentIds(new Set());
    setShowAllEmailAttachments(false);
  }, [selectedRecord?.id, activeTab]);
  if (!selectedRecord) {
    return <section className="flex h-full min-h-0 flex-1 items-center justify-center bg-slate-950 text-slate-500">Select an inbound item.</section>;
  }
  const record = detail?.record ?? selectedRecord;
  const combinedSources = combinedInboundSources(record);
  const reparseRecommended = Boolean(
    record.normalizedPayloadJson
      && typeof record.normalizedPayloadJson === "object"
      && !Array.isArray(record.normalizedPayloadJson)
      && (record.normalizedPayloadJson as Record<string, unknown>).reparseRecommended,
  );
  const evidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : getManualInboundEvidence(record);
  const emailEvidence = record.sourceType === "email" ? getInboundEmailEvidence(record) : null;
  const files = dedupeAttachmentFiles(detail?.files ?? []);
  const emailAttachmentFiles = files.filter((file) => !isLikelySignatureInlineFile(file));
  const visibleEmailAttachmentFiles = showAllEmailAttachments
    ? emailAttachmentFiles
    : emailAttachmentFiles.slice(0, 5);
  const poFiles = files.filter(isLikelyPoEvidenceFile);
  const needsInitialParse = !reviewDraft;
  const parseLabel = needsInitialParse ? "Parse" : "Reparse";
  const artworkLinks = attachmentLinks.filter((link) => classificationForLink(link) === "ARTWORK");
  const referenceLinks = attachmentLinks.filter((link) => classificationForLink(link) === "REFERENCE" || classificationForLink(link) === "OTHER");
  const signatureLinks = attachmentLinks.filter((link) => classificationForLink(link) === "IGNORE_INLINE");
  const poEvidenceItems = (draftPreview?.draft?.evidence?.items ?? [])
    .filter((item) => (item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT") && (item.documentType === "purchase_order" || item.poSummary));
  const firstLine = form?.reviewedLineItemsJson[0] ?? null;
  const linkByFileId = new Map(attachmentLinks.map((link) => [link.fileId, link]));
  const linkForFile = (file: ClientInboundOrderFile) => linkByFileId.get(file.id) ?? artworkLinkFromInboundFile(file, "unresolved");
  const fileForLink = (link: InboundOrderArtworkLink) => files.find((file) => (
    file.id === link.fileId
      || (link.fileRecordId && file.fileRecordId === link.fileRecordId)
      || (link.filename && file.sourceFilename === link.filename)
  )) ?? null;
  const visibleInlineSelection = inlineAttachmentSelection?.recordId === record.id
    ? inlineAttachmentSelection
    : null;
  const classifiedFiles = {
    artwork: files.filter((file) => classificationForLink(linkForFile(file)) === "ARTWORK"),
    reference: files.filter((file) => {
      const classification = classificationForLink(linkForFile(file));
      return classification === "REFERENCE" || classification === "OTHER";
    }),
    junk: files.filter((file) => classificationForLink(linkForFile(file)) === "IGNORE_INLINE"),
  };
  const visibleAttachmentFiles = activeTab === "email"
    ? visibleEmailAttachmentFiles
    : activeTab === "po"
    ? poFiles
    : activeTab === "artwork"
      ? [...classifiedFiles.artwork, ...classifiedFiles.reference, ...classifiedFiles.junk]
      : [];
  const toggleAttachmentSelected = (fileId: string, selected: boolean) => {
    setSelectedAttachmentIds((current) => {
      const next = new Set(current);
      if (selected) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  };
  const toggleVisibleAttachmentsSelected = (fileIds: string[], selected: boolean) => {
    setSelectedAttachmentIds((current) => {
      const next = new Set(current);
      for (const fileId of fileIds) {
        if (selected) next.add(fileId);
        else next.delete(fileId);
      }
      return next;
    });
  };
  const runBulkClassification = (classification: InboundAttachmentClassification | "reset_to_ai") => {
    const fileIds = visibleAttachmentFiles.map((file) => file.id).filter((fileId) => selectedAttachmentIds.has(fileId));
    if (fileIds.length === 0) return;
    onBulkClassifyAttachments(fileIds, classification);
    setSelectedAttachmentIds(new Set());
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-700 bg-slate-950 text-slate-100" data-testid="clean-source-documents">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Source Documents</div>
          {reparseRecommended && (
            <div className="mt-0.5 text-[11px] font-semibold text-amber-200">Combined sources changed. Reparse recommended before conversion.</div>
          )}
          {sourceChanged && (
            <div className="mt-0.5 text-[11px] font-semibold text-amber-200">Classification changed. Reparse to update draft.</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs font-bold" onClick={() => onAttachToExistingOrder(record.id)}>
            Attach to Order
          </Button>
          <Button type="button" size="sm" className="h-8 bg-blue-300 px-3 text-xs font-bold text-slate-950 hover:bg-blue-200" onClick={onParse} disabled={parseDisabled}>
            {isParsing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {parseLabel}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs font-bold" onClick={onRescan} disabled={rescanDisabled}>
            {isRescanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Re-scan
          </Button>
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-slate-800 px-3">
        {(["email", "po", "artwork", "history"] as SourceDocumentTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "h-8 min-w-20 border-b-2 px-3 text-xs font-bold uppercase tracking-wide",
              activeTab === tab ? "border-blue-300 bg-slate-800 text-blue-100" : "border-transparent text-slate-400 hover:text-slate-200",
            )}
            onClick={() => onTabChange(tab)}
          >
            {tab === "po" ? "PO" : titleCase(tab)}
          </button>
        ))}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-5">
        {isLoading ? (
          <Skeleton className="mx-auto h-[520px] max-w-[760px] bg-slate-800" />
        ) : activeTab === "email" ? (
          <div className="mx-auto w-full max-w-[760px] min-w-0">
            <CleanInlineAttachmentViewer selection={visibleInlineSelection} onClose={onCloseInlineAttachment} />
            <div className="mb-2 flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <span>Previous interaction</span>
              <span>{emailEvidence?.thread?.messageCount ? `${emailEvidence.thread.messageCount} messages` : "Single message"}</span>
            </div>
            <article className="min-w-0 overflow-hidden bg-white text-slate-950 shadow-xl">
              <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                  {(evidence.senderName || evidence.senderEmail || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{evidence.subject || "No subject"}</div>
                  <div className="truncate text-xs text-slate-500">{getSenderLabel(record)} / {formatTimestamp(emailEvidence?.receivedAt ?? record.createdAt)}</div>
                </div>
                <Badge variant="outline">{emailEvidence?.bodyHtml ? "HTML" : "Text"}</Badge>
              </div>
              <div className="px-5 py-5">
                {emailEvidence?.bodyHtml ? (
                  <EmailDocumentBodySurface html={sanitizeEmailHtml(emailEvidence.bodyHtml)} text={evidence.bodyText} />
                ) : (
                    <CleanInteractiveEmailText
                      text={evidence.bodyText}
                      lineItem={firstLine}
                      poNumber={form?.reviewedOrderJson.poNumber}
                      dueDate={form?.reviewedOrderJson.dueDate}
                      onFocusTarget={onFocusTarget}
                      activeTarget={activeTarget}
                    />
                  )}
              </div>
              <div className="border-t border-slate-200 px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <span>Attachments / Evidence ({files.length}) · Showing {visibleEmailAttachmentFiles.length}</span>
                  {emailAttachmentFiles.length > visibleEmailAttachmentFiles.length && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setShowAllEmailAttachments(true)}>
                      Show all {emailAttachmentFiles.length}
                    </Button>
                  )}
                </div>
                <CleanAttachmentBulkActions
                  visibleFiles={visibleAttachmentFiles}
                  selectedFileIds={selectedAttachmentIds}
                  isPending={isBulkClassifying}
                  onToggleFile={toggleAttachmentSelected}
                  onToggleVisible={toggleVisibleAttachmentsSelected}
                  onClassify={runBulkClassification}
                />
                <div className="grid min-w-0 gap-2">
                  {files.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">No attachments linked.</div>
                  ) : visibleEmailAttachmentFiles.map((file) => (
                    <CleanSelectableAttachment
                      key={file.id}
                      file={file}
                      selected={selectedAttachmentIds.has(file.id)}
                      onToggle={(selected) => toggleAttachmentSelected(file.id, selected)}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "block w-full min-w-0 overflow-hidden rounded text-left transition-shadow",
                          file.role === "artwork" && cleanHighlightClass("artwork", activeTarget),
                          file.role === "po" && cleanHighlightClass("po", activeTarget),
                          file.role !== "po" && file.role !== "artwork" && activeTarget === "artwork" && "ring-1 ring-blue-300",
                        )}
                        onClick={() => onFocusTarget(file.role === "po" ? "po" : "artwork")}
                        onMouseEnter={() => onFocusTarget(file.role === "po" ? "po" : "artwork")}
                        onKeyDown={(event) => {
                          if (shouldIgnoreShortcutKeydown(event)) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onFocusTarget(file.role === "po" ? "po" : "artwork");
                          }
                        }}
                        data-clean-source-target={file.role === "po" ? "po" : "artwork"}
                      >
                        <SourceEvidenceFileCard recordId={record.id} file={file} onClassify={() => onClassifyAttachment(linkForFile(file))} useInAppViewer onOpenAttachment={onOpenAttachment} />
                      </div>
                    </CleanSelectableAttachment>
                  ))}
                </div>
              </div>
            </article>
            {parseError && <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{operatorSafeParseErrorMessage(parseError)}</div>}
            {parseCompletedWithoutDraft && (
              <div className="mt-3 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                {parseCompletedWithoutDraftMessage ?? "Parse completed, but no review draft was produced. Reparse this record or use Debug View to inspect the latest parse attempt."}
              </div>
            )}
          </div>
        ) : activeTab === "po" ? (
          <div className="mx-auto w-full max-w-[760px] min-w-0 rounded border border-slate-800 bg-slate-900 p-4">
            <CleanInlineAttachmentViewer selection={visibleInlineSelection} onClose={onCloseInlineAttachment} />
            <div className="mb-3 text-sm font-bold text-slate-100">PO Documents</div>
            <CleanAttachmentBulkActions
              visibleFiles={visibleAttachmentFiles}
              selectedFileIds={selectedAttachmentIds}
              isPending={isBulkClassifying}
              onToggleFile={toggleAttachmentSelected}
              onToggleVisible={toggleVisibleAttachmentsSelected}
              onClassify={runBulkClassification}
            />
            {poFiles.length === 0 ? (
              <div className="rounded border border-dashed border-slate-700 px-3 py-10 text-center text-sm text-slate-500">No PO detected.</div>
            ) : poFiles.map((file) => (
              <CleanSelectableAttachment key={file.id} file={file} selected={selectedAttachmentIds.has(file.id)} onToggle={(selected) => toggleAttachmentSelected(file.id, selected)}>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn("mb-2 block w-full rounded text-left", cleanHighlightClass("po", activeTarget))}
                  onClick={() => onFocusTarget("po")}
                  onMouseEnter={() => onFocusTarget("po")}
                  onKeyDown={(event) => {
                    if (shouldIgnoreShortcutKeydown(event)) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onFocusTarget("po");
                    }
                  }}
                  data-clean-source-target="po"
                >
                  <InboundAttachmentCard recordId={record.id} file={file} compact minimal onClassify={() => onClassifyAttachment(linkForFile(file))} useInAppViewer onOpenAttachment={onOpenAttachment} />
                  {file.role !== "po" && (
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">Likely PO / Reference PDF</div>
                  )}
                </div>
              </CleanSelectableAttachment>
            ))}
            {poEvidenceItems.length > 0 && (
              <div className="mt-4 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">PO Extraction Summary</div>
                {poEvidenceItems[0]?.poSummary && <PoSummaryGrid summary={poEvidenceItems[0].poSummary} lineItems={form?.reviewedLineItemsJson} />}
              </div>
            )}
          </div>
        ) : activeTab === "artwork" ? (
          <div className="mx-auto grid max-w-[760px] gap-3">
            <CleanInlineAttachmentViewer selection={visibleInlineSelection} onClose={onCloseInlineAttachment} />
            <div className="rounded border border-slate-800 bg-slate-900 p-3">
              <div className="mb-2 text-sm font-bold text-slate-100">Artwork Files</div>
              <CleanAttachmentBulkActions
                visibleFiles={visibleAttachmentFiles}
                selectedFileIds={selectedAttachmentIds}
                isPending={isBulkClassifying}
                onToggleFile={toggleAttachmentSelected}
                onToggleVisible={toggleVisibleAttachmentsSelected}
                onClassify={runBulkClassification}
              />
              {artworkLinks.length === 0 ? <div className="text-sm text-slate-500">No artwork detected.</div> : artworkLinks.map((link) => (
                <div
                  key={artworkLinkKey(link)}
                  className={cn("mb-2 rounded border border-slate-800 bg-slate-950 px-3 py-2", cleanHighlightClass("artwork", activeTarget))}
                >
                  {(() => {
                    const file = fileForLink(link);
                    return file ? (
                      <CleanSelectableAttachment file={file} selected={selectedAttachmentIds.has(file.id)} onToggle={(selected) => toggleAttachmentSelected(file.id, selected)}>
                        <InboundAttachmentCard recordId={record.id} file={file} compact minimal onClassify={() => onClassifyAttachment(link)} useInAppViewer onOpenAttachment={onOpenAttachment} />
                      </CleanSelectableAttachment>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => onFocusTarget("artwork")}
                          onMouseEnter={() => onFocusTarget("artwork")}
                          onFocus={() => onFocusTarget("artwork")}
                          data-clean-source-target="artwork"
                        >
                          <div className="truncate text-sm font-semibold text-slate-100">{link.filename || link.fileId}</div>
                          <div className="mt-1 text-xs text-slate-500">{describeArtworkLink(link)}</div>
                        </button>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="rounded border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-500">Metadata only</span>
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onClassifyAttachment(link)}>
                            Classify
                          </Button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-slate-800 bg-slate-900 p-3">
                <div className="mb-2 text-sm font-bold text-slate-100">Reference</div>
                {referenceLinks.length === 0 ? <div className="text-sm text-slate-500">None</div> : referenceLinks.map((link) => {
                  const file = fileForLink(link);
                  return (
                    <div key={artworkLinkKey(link)} className="mb-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
                      {file ? (
                        <CleanSelectableAttachment file={file} selected={selectedAttachmentIds.has(file.id)} onToggle={(selected) => toggleAttachmentSelected(file.id, selected)}>
                          <InboundAttachmentCard recordId={record.id} file={file} compact minimal onClassify={() => onClassifyAttachment(link)} useInAppViewer onOpenAttachment={onOpenAttachment} />
                        </CleanSelectableAttachment>
                      ) : (
                        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-slate-300">
                          <span className="min-w-0 truncate">{link.filename || link.fileId}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-500">Metadata only</span>
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onClassifyAttachment(link)}>Classify</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="rounded border border-slate-800 bg-slate-900 p-3">
                <div className="mb-2 text-sm font-bold text-slate-100">Junk / Signature</div>
                {signatureLinks.length === 0 ? <div className="text-sm text-slate-500">None</div> : signatureLinks.map((link) => {
                  const file = fileForLink(link);
                  return (
                    <div key={artworkLinkKey(link)} className="mb-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
                      {file ? (
                        <CleanSelectableAttachment file={file} selected={selectedAttachmentIds.has(file.id)} onToggle={(selected) => toggleAttachmentSelected(file.id, selected)}>
                          <InboundAttachmentCard recordId={record.id} file={file} compact minimal onClassify={() => onClassifyAttachment(link)} useInAppViewer onOpenAttachment={onOpenAttachment} />
                        </CleanSelectableAttachment>
                      ) : (
                        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="min-w-0 truncate">{link.filename || link.fileId}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded border border-slate-700 px-2 py-1 text-[11px]">Metadata only</span>
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onClassifyAttachment(link)}>Classify</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {combinedSources.length > 1 && (
              <section className="rounded border border-slate-800 bg-slate-900 p-3" data-testid="clean-combined-inbound-sources">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Combined Sources</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">Combined from {combinedSources.length} emails</div>
                <div className="mt-2 space-y-2">
                  {combinedSources.map((source, index) => {
                    const sourceEvidence = source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
                      ? source.evidence as Record<string, unknown>
                      : {};
                    const subject = typeof sourceEvidence.subject === "string" ? sourceEvidence.subject : "No subject";
                    const sender = typeof sourceEvidence.senderEmail === "string" ? sourceEvidence.senderEmail : "Unknown sender";
                    const bodyText = typeof sourceEvidence.bodyText === "string" ? sourceEvidence.bodyText : null;
                    return (
                      <details key={typeof source.recordId === "string" ? source.recordId : index} className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300">
                        <summary className="cursor-pointer">
                          <span className="font-medium text-slate-100">{subject}</span><span className="text-slate-500"> · {sender}</span>
                        </summary>
                        {bodyText && <p className="mt-1 whitespace-pre-wrap break-words text-slate-400">{bodyText}</p>}
                      </details>
                    );
                  })}
                </div>
              </section>
            )}
            <SourceHistoryPanel thread={emailEvidence?.thread} />
          </div>
        )}
      </div>
    </section>
  );
}

function CleanLineItemCard({
  lineItem,
  index,
  productOptions,
  productSearch,
  isProductSearchFetching,
  attachmentLinkOptions,
  pdfSizeAnalysesByFileId,
  onChange,
  onProductSearchChange,
  onDuplicate,
  onRemove,
  onSplit,
  segmentationReason,
  activeTarget,
  onFocusTarget,
}: {
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number];
  index: number;
  productOptions: ReviewSelectOption[];
  productSearch: string;
  isProductSearchFetching: boolean;
  attachmentLinkOptions: InboundOrderArtworkLink[];
  pdfSizeAnalysesByFileId: Map<string, InboundPdfSizeAnalysis>;
  onChange: (patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => void;
  onProductSearchChange: (value: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSplit: () => void;
  segmentationReason?: string | null;
  activeTarget: CleanHighlightTarget | null;
  onFocusTarget: CleanFocusTargetHandler;
}) {
  const hasQuantity = hasValidLineItemQuantity(lineItem);
  const hasDimensions = hasValidLineItemDimensions(lineItem);
  const requiredComplete = Boolean(lineItem.selectedProductId && hasQuantity && hasDimensions);
  const needsProductSelection = !lineItem.selectedProductId || lineItem.productUnresolved;
  const [productSelectorOpen, setProductSelectorOpen] = useState(needsProductSelection);
  useEffect(() => {
    if (needsProductSelection) setProductSelectorOpen(true);
  }, [needsProductSelection]);
  const activeArtworkLinks = lineItem.artworkLinks.filter(isActiveClassifiedArtworkLink);
  const isDoubleSided = isDoubleSidedReviewLineItem(lineItem);
  const frontArtwork = activeArtworkLinks.find((link) => link.assignmentSide === "both" || link.assignmentSide === "front") ?? null;
  const backArtwork = activeArtworkLinks.find((link) => link.assignmentSide === "both" || link.assignmentSide === "back") ?? null;
  const usesSameArtworkBothSides = activeArtworkLinks.some((link) => link.assignmentSide === "both");
  const doubleSidedArtworkComplete = !isDoubleSided || Boolean(frontArtwork && backArtwork);
  const [selectedArtworkKeys, setSelectedArtworkKeys] = useState<Set<string>>(() => new Set());
  const [sameArtworkModeRequested, setSameArtworkModeRequested] = useState(usesSameArtworkBothSides);
  useEffect(() => {
    setSameArtworkModeRequested(usesSameArtworkBothSides);
  }, [usesSameArtworkBothSides]);
  const useSameArtworkBothSides = usesSameArtworkBothSides || sameArtworkModeRequested;
  const sizeDisplay = hasDimensions
    ? `${lineItem.width} x ${lineItem.height} ${lineItem.dimensionsUnit === "ft" ? "feet" : "inches"}`
    : "Size needed";
  const hasSelectedProduct = Boolean(lineItem.selectedProductId);
  const parsedProductContext = [lineItem.sourceText, lineItem.productName]
    .map((value) => value?.trim())
    .filter(Boolean)[0] ?? null;
  const selectedOptions = Object.entries(ensurePbv2Selections(lineItem.optionSelectionsJson).selected ?? {})
    .map(([key, entry]) => `${key}: ${String(entry?.value ?? "")}`)
    .filter((value) => !value.endsWith(": "))
    .slice(0, 3);
  const keyOptionSummary = selectedOptions.length > 0
    ? selectedOptions.join(", ")
    : hasSelectedProduct ? "Review product options" : "Select product first";
  const productOptionsComplete = Boolean(lineItem.optionSelectionsJson && Object.keys(ensurePbv2Selections(lineItem.optionSelectionsJson).selected ?? {}).length > 0);
  const workflowComplete = Boolean(requiredComplete && activeArtworkLinks.length > 0 && doubleSidedArtworkComplete && productOptionsComplete);
  const allocatedArtworkTotal = activeArtworkLinks.reduce((total, link) => total + (link.productionQuantity ?? 0), 0);
  const artworkAllocationIssue = activeArtworkLinks.length > 1 && lineItem.quantity != null && allocatedArtworkTotal !== lineItem.quantity;
  const effectivePricing = resolveInboundLineEffectivePricing(lineItem.pricingReviewJson, lineItem.quantity);
  const pricingSummary = effectivePricing.effectiveTotalCents > 0
    ? `${formatCents(effectivePricing.effectiveTotalCents)} · ${effectivePricing.hasPriceOverride
      ? lineItem.pricingReviewJson?.priceOverrideSource === "po" ? "PO override" : "Staff override"
      : "System price"}`
    : "Price needed";
  const lineItemSummaryParts = workflowComplete
    ? [
      lineItem.productName || "Product",
      `Qty ${lineItem.quantity ?? "-"}`,
      sizeDisplay,
      pricingSummary,
      activeArtworkLinks.length ? `Artwork linked · ${activeArtworkLinks.length} file${activeArtworkLinks.length === 1 ? "" : "s"}` : "Artwork pending",
    ]
    : [
      hasSelectedProduct && !lineItem.productUnresolved ? lineItem.productName || "Product selected" : "Product unresolved",
      hasQuantity ? `Qty ${lineItem.quantity}` : "Quantity needed",
      hasDimensions ? sizeDisplay : "Size needed",
      pricingSummary,
      activeArtworkLinks.length ? `Artwork linked · ${activeArtworkLinks.length} file${activeArtworkLinks.length === 1 ? "" : "s"}` : "Artwork needed",
    ];
  const [workflowOpen, setWorkflowOpen] = useState(!workflowComplete);
  useEffect(() => {
    if (!workflowComplete) setWorkflowOpen(true);
  }, [workflowComplete]);
  const decisionSteps = [
    { label: "Product", complete: Boolean(hasSelectedProduct && !lineItem.productUnresolved) },
    { label: "Quantity", complete: hasQuantity },
    { label: "Size", complete: hasDimensions },
    { label: "Artwork", complete: activeArtworkLinks.length > 0 && doubleSidedArtworkComplete },
    { label: "Product Options", complete: productOptionsComplete },
  ];
  const availableArtworkOptions = attachmentLinkOptions.filter((link) => (
    !activeArtworkLinks.some((activeLink) => artworkLinkKey(activeLink) === artworkLinkKey(link))
  ));
  const assignedPdfSizes = activeArtworkLinks
    .map((link) => ({ link, analysis: pdfSizeAnalysesByFileId.get(link.fileId) }))
    .filter((entry): entry is { link: InboundOrderArtworkLink; analysis: InboundPdfSizeAnalysis } => Boolean(entry.analysis?.status === "succeeded"));
  const uniformAssignedSizes = assignedPdfSizes.filter((entry) => entry.analysis.uniformPageSize && entry.analysis.effectiveWidthInches && entry.analysis.effectiveHeightInches);
  const sharedAssignedSize = uniformAssignedSizes.length > 0 && uniformAssignedSizes.length === assignedPdfSizes.length
    && uniformAssignedSizes.every((entry) => entry.analysis.effectiveWidthInches === uniformAssignedSizes[0].analysis.effectiveWidthInches && entry.analysis.effectiveHeightInches === uniformAssignedSizes[0].analysis.effectiveHeightInches)
    ? uniformAssignedSizes[0].analysis
    : null;
  const applyDetectedSize = (analysis: InboundPdfSizeAnalysis) => {
    if (!analysis.effectiveWidthInches || !analysis.effectiveHeightInches || hasDimensions) return;
    onChange({ width: analysis.effectiveWidthInches, height: analysis.effectiveHeightInches, dimensionsUnit: "in", dimensionsSource: "source_evidence" });
  };
  const assignArtworkLinks = (links: InboundOrderArtworkLink[]) => {
    if (links.length === 0) return;
    const nextArtworkLinks = [
      ...lineItem.artworkLinks,
      ...links.map((link) => ({
        ...link,
        productionQuantity: link.productionQuantity ?? defaultNewProductionArtworkAllocation(link.role),
        source: "staff_selected" as const,
        confidence: 100,
        reason: "Staff assigned artwork attachment to this line item.",
      })),
    ];
    const nextCount = nextArtworkLinks.filter(isActiveClassifiedArtworkLink).length;
    onChange({
      artworkLinks: nextArtworkLinks,
      // This legacy quick action remains explicit: staff intentionally chose
      // one finished piece per file, so it may update the line quantity.
      quantity: lineItem.artworkQuantityMode === "one_each_per_file" ? nextCount : lineItem.quantity,
      quantitySource: lineItem.artworkQuantityMode === "one_each_per_file" ? "staff_selected" : lineItem.quantitySource,
    });
    setSelectedArtworkKeys(new Set());
  };
  const updateArtworkAllocation = (link: InboundOrderArtworkLink, productionQuantity: number | null) => {
    const key = artworkLinkKey(link);
    onChange({ artworkLinks: lineItem.artworkLinks.map((candidate) => artworkLinkKey(candidate) === key
      ? { ...candidate, productionQuantity, source: "staff_selected" as const, confidence: 100, reason: "Staff set the production quantity allocation." }
      : candidate) });
  };
  const assignArtworkSide = (link: InboundOrderArtworkLink, assignmentSide: "front" | "back" | "both") => {
    const key = artworkLinkKey(link);
    const exists = activeArtworkLinks.some((candidate) => artworkLinkKey(candidate) === key);
    const artworkLinks = exists
      ? lineItem.artworkLinks.map((candidate) => artworkLinkKey(candidate) === key
        ? { ...candidate, assignmentSide, productionQuantity: candidate.productionQuantity ?? defaultNewProductionArtworkAllocation(candidate.role), source: "staff_selected" as const, confidence: 100, reason: `Staff assigned artwork to ${assignmentSide === "both" ? "front and back" : assignmentSide}.` }
        : candidate)
      : [...lineItem.artworkLinks, {
        ...link,
        assignmentSide,
        productionQuantity: link.productionQuantity ?? defaultNewProductionArtworkAllocation(link.role),
        source: "staff_selected" as const,
        confidence: 100,
        reason: `Staff assigned artwork to ${assignmentSide === "both" ? "front and back" : assignmentSide}.`,
      }];
    onChange({ artworkLinks });
  };
  const setUseSameArtworkBothSides = (checked: boolean) => {
    setSameArtworkModeRequested(checked);
    if (checked) {
      if (frontArtwork) assignArtworkSide(frontArtwork, "both");
      return;
    }
    if (frontArtwork?.assignmentSide === "both") assignArtworkSide(frontArtwork, "front");
  };
  const removeArtworkLink = (link: InboundOrderArtworkLink) => {
    const key = artworkLinkKey(link);
    const nextArtworkLinks = [
      ...lineItem.artworkLinks.filter((candidate) => artworkLinkKey(candidate) !== key),
      { ...link, source: "staff_removed" as const, confidence: 100, reason: "Staff removed artwork attachment from this line item." },
    ];
    onChange({
      artworkLinks: nextArtworkLinks,
    });
  };
  const selectedArtworkKey = activeArtworkLinks[0] ? artworkLinkKey(activeArtworkLinks[0]) : "";
  const handleProductSelection = (value: string) => {
    const productId = trimToNull(value);
    const selectedOption = productOptions.find((option) => option.id === productId);
    onChange({
      productName: productId ? selectedOption?.label ?? lineItem.productName : null,
      selectedProductId: productId,
      selectedProductSource: productId ? "staff_selected" : null,
      interpretedProductId: null,
      interpretedProductReason: productId ? "Staff selected product from active catalog. AI candidate ranking is advisory." : null,
      interpretedProductConfidence: null,
      productUnresolved: !productId,
      optionSelectionsJson: null,
      pbv2TreeVersionId: null,
      pbv2OptionSuggestions: [],
    });
    if (productId) setProductSelectorOpen(false);
  };
  const productSelector = (
    <div
      className={cn("rounded border border-blue-400/40 bg-blue-400/10 p-3", cleanHighlightClass("product", activeTarget))}
      data-testid="clean-product-catalog-selector"
      data-clean-destination-target="product"
      data-clean-resolution-target="product"
      data-clean-resolution-primary="true"
      data-highlighted={activeTarget === "product" ? "true" : "false"}
      onMouseEnter={() => onFocusTarget("product")}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-blue-100">Select product from catalog</div>
          <div className="text-[11px] text-slate-400">Search active catalog products to resolve this line item.</div>
        </div>
        {needsProductSelection ? <Badge variant="destructive">Product unresolved</Badge> : <Badge variant="secondary">Product resolved</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <OrderEntryField label="Search active catalog">
          <Input value={productSearch} onChange={(event) => onProductSearchChange(event.target.value)} placeholder="Search active products..." data-testid="clean-product-catalog-search" />
        </OrderEntryField>
        <OrderEntryField label="Select product">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={lineItem.selectedProductId ?? ""}
            onChange={(event) => handleProductSelection(event.target.value)}
            data-testid="clean-product-catalog-select"
          >
            <option value="">Unselected</option>
            {isProductSearchFetching && <option value="" disabled>Searching catalog...</option>}
            {productOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </OrderEntryField>
      </div>
    </div>
  );
  return (
    <div className="border border-slate-700 bg-slate-900 p-3" data-testid="clean-line-item-card" data-workflow-complete={workflowComplete ? "true" : "false"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Line Item {index + 1}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100" data-testid="clean-line-item-header-summary">
            {lineItemSummaryParts.map((part) => (
              <span key={part} className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs">{part}</span>
            ))}
          </div>
          {!workflowComplete && parsedProductContext && (
            <div className="mt-2 text-[11px] text-slate-400">
              AI detected: <span className="font-semibold text-blue-100">{parsedProductContext}</span>
            </div>
          )}
          {lineItem.sourceText && (
            <div className="mt-2 line-clamp-2 text-[11px] text-slate-400" data-testid="clean-line-item-source-excerpt">
              Source: {lineItem.sourceText}
            </div>
          )}
          {segmentationReason && (
            <div className="mt-1 text-[11px] text-blue-200" data-testid="clean-line-item-segmentation-reason">
              Parser split: {segmentationReason}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={workflowComplete ? "secondary" : "destructive"}>{workflowComplete ? "Complete" : "Needs decisions"}</Badge>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-200" onClick={onSplit}>
            Split
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-200" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-red-200" onClick={onRemove}>
            Remove
          </Button>
          {workflowComplete && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-200" onClick={() => setWorkflowOpen((current) => !current)}>
              {workflowOpen ? "Collapse" : "Edit line item"}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-1.5 sm:grid-cols-5" data-testid="clean-line-item-decision-strip">
        {decisionSteps.map((step) => (
          <div key={step.label} className={cn("flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-semibold", step.complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-slate-700 bg-slate-950 text-slate-400")}>
            <span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px]", step.complete ? "border-emerald-300 text-emerald-200" : "border-slate-600 text-slate-500")}>{step.complete ? "x" : ""}</span>
            <span className="truncate">{step.label}</span>
          </div>
        ))}
      </div>
      {workflowOpen && (
        <div className="mt-3 grid gap-3" data-testid="clean-line-item-task-list">
          <section className="rounded border border-slate-800 bg-slate-950 p-3" data-testid="clean-line-item-task-product">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Step 1</div>
                <div className="text-sm font-bold text-slate-100">Product</div>
              </div>
              <Badge variant={hasSelectedProduct && !lineItem.productUnresolved ? "secondary" : "destructive"}>{hasSelectedProduct && !lineItem.productUnresolved ? "Done" : "Needs decision"}</Badge>
            </div>
            {(needsProductSelection || productSelectorOpen) ? (
              productSelector
            ) : (
              <div
                className={cn("rounded border border-slate-800 bg-slate-900 px-3 py-2", cleanHighlightClass("product", activeTarget))}
                data-clean-destination-target="product"
                data-clean-resolution-target="product"
                data-highlighted={activeTarget === "product" ? "true" : "false"}
                onMouseEnter={() => onFocusTarget("product")}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100">{lineItem.productName || "Selected product"}</div>
                    <div className="text-[11px] text-slate-500">Product determines the available option controls.</div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-200" onClick={() => setProductSelectorOpen(true)}>
                    Change product
                  </Button>
                </div>
              </div>
            )}
          </section>
          <section className="rounded border border-slate-800 bg-slate-950 p-3" data-testid="clean-quantity-workflow">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Step 2</div>
                <div className="text-sm font-bold text-slate-100">Quantity</div>
              </div>
              <Badge variant={lineItem.quantity ? "secondary" : "destructive"}>{lineItem.quantity ? "Done" : "Needs decision"}</Badge>
            </div>
            <div
              className={cn(cleanHighlightClass("quantity", activeTarget))}
              data-clean-destination-target="quantity"
              data-clean-resolution-target="quantity"
              data-clean-resolution-primary="true"
              data-highlighted={activeTarget === "quantity" ? "true" : "false"}
              onMouseEnter={() => onFocusTarget("quantity")}
            >
              <OrderEntryField label="How many?">
                <Input
                  value={lineItem.quantity ?? ""}
                  onChange={(event) => onChange({ quantity: optionalNumber(event.target.value), quantitySource: "staff_selected" })}
                  data-testid="clean-inline-quantity-input"
                  placeholder="Qty"
                />
              </OrderEntryField>
            </div>
          </section>
          <section className="rounded border border-slate-800 bg-slate-950 p-3" data-testid="clean-size-workflow">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Step 3</div>
                <div className="text-sm font-bold text-slate-100">Size</div>
              </div>
              <Badge variant={hasDimensions ? "secondary" : "destructive"}>{hasDimensions ? "Done" : "Needs decision"}</Badge>
            </div>
            <div
              className={cn("rounded transition-shadow", cleanHighlightClass("dimensions", activeTarget))}
              data-clean-destination-target="dimensions"
              data-clean-resolution-target="dimensions"
              data-highlighted={activeTarget === "dimensions" ? "true" : "false"}
              onMouseEnter={() => onFocusTarget("dimensions")}
            >
              <div className="grid grid-cols-[1fr_auto_1fr_72px] items-center gap-2">
                <Input aria-label="Width" value={lineItem.width ?? ""} onChange={(event) => onChange({ width: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} placeholder="Width" />
                <span className="text-slate-500">x</span>
                <Input aria-label="Height" value={lineItem.height ?? ""} onChange={(event) => onChange({ height: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} placeholder="Height" />
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={lineItem.dimensionsUnit ?? "in"}
                  onChange={(event) => onChange({ dimensionsUnit: trimToNull(event.target.value), dimensionsSource: "staff_selected" })}
                  aria-label="Dimension Unit"
                >
                  <option value="in">In</option>
                  <option value="ft">Ft</option>
                </select>
              </div>
              {assignedPdfSizes.length > 0 && (
                <div className="mt-2 rounded border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100" data-testid="detected-pdf-line-item-size">
                  <div className="font-semibold">PDF page size</div>
                  <div className="mt-0.5 text-sky-200">Detected from the PDF page. Verify when the file includes bleed, extra canvas, or multiple designs.</div>
                  <div className="mt-1 space-y-1">
                    {assignedPdfSizes.map(({ link, analysis }) => <div key={link.fileId}>{link.filename || "Artwork"}: {pdfSizeLabel(analysis)}</div>)}
                  </div>
                  {sharedAssignedSize ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span>{assignedPdfSizes.length > 1 ? "Shared detected size" : "Detected size"}: {formatPdfInches(sharedAssignedSize.effectiveWidthInches!)} × {formatPdfInches(sharedAssignedSize.effectiveHeightInches!)} in</span>
                      {!hasDimensions && <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => applyDetectedSize(sharedAssignedSize)}>Use for line item</Button>}
                      {hasDimensions && !inboundDimensionsMatchPdf({
                        enteredWidth: lineItem.width,
                        enteredHeight: lineItem.height,
                        enteredUnit: lineItem.dimensionsUnit,
                        pdfWidthIn: sharedAssignedSize.effectiveWidthInches,
                        pdfHeightIn: sharedAssignedSize.effectiveHeightInches,
                      }) && <span className="text-amber-200">Entered size differs; not changed.</span>}
                    </div>
                  ) : <div className="mt-2 text-amber-200">Assigned PDFs have different or mixed page sizes. Choose a size deliberately.</div>}
                </div>
              )}
            </div>
          </section>
          <section
            className={cn("rounded border border-slate-800 bg-slate-950 p-3", cleanHighlightClass("artwork", activeTarget))}
            data-testid="clean-line-item-task-artwork"
            data-clean-destination-target="artwork"
            data-clean-resolution-target="artwork"
            data-clean-resolution-primary="true"
            data-highlighted={activeTarget === "artwork" ? "true" : "false"}
            onMouseEnter={() => onFocusTarget("artwork")}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Step 4</div>
                <div className="text-sm font-bold text-slate-100">Artwork</div>
              </div>
              <Badge variant={activeArtworkLinks.length ? "secondary" : "destructive"}>{activeArtworkLinks.length ? "Attached" : "Needs assignment"}</Badge>
            </div>
            <button
              type="button"
              className="mb-3 flex w-full items-center gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left"
              onClick={() => onFocusTarget("artwork")}
              data-testid="clean-artwork-target"
              data-highlighted={activeTarget === "artwork" ? "true" : "false"}
            >
              <div className="flex h-8 w-10 items-center justify-center rounded bg-slate-800">
                <Paperclip className="h-4 w-4 text-slate-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-200">{activeArtworkLinks[0]?.filename || "No artwork linked"}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Preflight {activeArtworkLinks.length ? `${activeArtworkLinks.length} file${activeArtworkLinks.length === 1 ? "" : "s"} attached` : "pending"}</div>
              </div>
            </button>
            <OrderEntryField label="Artwork assignment">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={selectedArtworkKey}
                onChange={(event) => {
                  const key = trimToNull(event.target.value);
                  const selectedLink = attachmentLinkOptions.find((link) => artworkLinkKey(link) === key);
                  if (!selectedLink) return;
                  assignArtworkLinks([selectedLink]);
                }}
                data-testid="clean-inline-artwork-select"
              >
                <option value="">{availableArtworkOptions.length > 0 ? `Assign ${availableArtworkOptions[0].filename || "classified artwork"} to Line Item ${index + 1}` : "No classified artwork files available"}</option>
                {activeArtworkLinks.map((link) => (
                  <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>{`${link.filename || link.fileId} — assigned`}</option>
                ))}
                {availableArtworkOptions.map((link) => (
                  <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>{link.filename || link.fileId}</option>
                ))}
              </select>
            </OrderEntryField>
            {isDoubleSided && (
              <div className="mt-3 rounded border border-violet-400/30 bg-violet-400/10 p-2" data-testid="clean-double-sided-artwork-assignment">
                <label className="flex items-center gap-2 text-xs font-semibold text-violet-100">
                  <input
                    type="checkbox"
                    checked={useSameArtworkBothSides}
                    onChange={(event) => setUseSameArtworkBothSides(event.target.checked)}
                    data-testid="clean-use-same-artwork-both-sides"
                  />
                  Use same artwork on both sides
                </label>
                {!frontArtwork && (
                  <p className="mt-1 text-[11px] text-amber-100">Assign Front artwork, then choose whether it is also used on the back.</p>
                )}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <OrderEntryField label="Front artwork">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      value={frontArtwork ? artworkLinkKey(frontArtwork) : ""}
                      onChange={(event) => {
                        const link = attachmentLinkOptions.find((candidate) => artworkLinkKey(candidate) === event.target.value);
                        if (link) assignArtworkSide(link, useSameArtworkBothSides ? "both" : "front");
                      }}
                      data-testid="clean-front-artwork-select"
                    >
                      <option value="">Front artwork not assigned</option>
                      {attachmentLinkOptions.map((link) => <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>{link.filename || link.fileId}</option>)}
                    </select>
                  </OrderEntryField>
                  {!useSameArtworkBothSides && (
                    <OrderEntryField label="Back artwork">
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={backArtwork ? artworkLinkKey(backArtwork) : ""}
                        onChange={(event) => {
                          const link = attachmentLinkOptions.find((candidate) => artworkLinkKey(candidate) === event.target.value);
                          if (link) assignArtworkSide(link, "back");
                        }}
                        data-testid="clean-back-artwork-select"
                      >
                        <option value="">Back artwork not assigned</option>
                        {attachmentLinkOptions.map((link) => <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>{link.filename || link.fileId}</option>)}
                      </select>
                    </OrderEntryField>
                  )}
                </div>
                {!doubleSidedArtworkComplete && (
                  <p className="mt-2 text-xs text-amber-100">{frontArtwork ? "Back artwork not assigned. Choose same artwork for both sides or assign a Back file." : "Front artwork not assigned."}</p>
                )}
                {useSameArtworkBothSides && frontArtwork && <p className="mt-2 text-[11px] text-violet-100">Back resolves from the same file as Front.</p>}
              </div>
            )}
            {activeArtworkLinks.length > 0 && (
              <div className="mt-2 rounded border border-slate-700 bg-slate-900 p-2" data-testid="inbound-artwork-allocation">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-200">
                  <span>Production allocation</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                    const links = lineItem.artworkLinks.map((candidate) => isActiveClassifiedArtworkLink(candidate)
                      ? { ...candidate, productionQuantity: 1, source: "staff_selected" as const, confidence: 100, reason: "Staff applied 1 each production allocation." }
                      : candidate);
                    onChange({ artworkLinks: links });
                  }}>1 each</Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Assign finished pieces per production artwork. This does not change the billable line quantity.</p>
                <div className="mt-2 space-y-1">
                  {activeArtworkLinks.map((link) => (
                    <label key={artworkLinkKey(link)} className="flex items-center justify-between gap-2 text-xs text-slate-200">
                      <span className="min-w-0 truncate">{link.filename || link.fileId}</span>
                      <input
                        className="h-7 w-16 rounded border border-slate-600 bg-slate-950 px-1 text-right text-xs"
                        aria-label={`Production quantity for ${link.filename || link.fileId}`}
                        type="number" min="1" step="1" value={link.productionQuantity ?? ""}
                        onChange={(event) => updateArtworkAllocation(link, event.target.value ? Number(event.target.value) : null)}
                      />
                    </label>
                  ))}
                </div>
                {lineItem.quantity != null && <p className={cn("mt-2 text-[11px]", artworkAllocationIssue ? "text-amber-200" : "text-emerald-200")}>
                  Allocated {allocatedArtworkTotal} of {lineItem.quantity}{artworkAllocationIssue ? ". Resolve before Prepress." : "."}
                </p>}
              </div>
            )}
            <div className="mt-2">
              <OrderEntryField label="Quick allocation">
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={lineItem.artworkQuantityMode}
                  onChange={(event) => {
                    const artworkQuantityMode = event.target.value as "one_each_per_file" | "same_quantity_each";
                    onChange({
                      artworkQuantityMode,
                      quantity: artworkQuantityMode === "one_each_per_file" && activeArtworkLinks.length > 0 ? activeArtworkLinks.length : lineItem.quantity,
                      quantitySource: artworkQuantityMode === "one_each_per_file" && activeArtworkLinks.length > 0 ? "staff_selected" : lineItem.quantitySource,
                    });
                  }}
                  aria-label={`Artwork quantity mode for line item ${index + 1}`}
                >
                  <option value="same_quantity_each">Keep line quantity; assign quantities manually</option>
                  <option value="one_each_per_file">1 each per file and set line quantity</option>
                </select>
              </OrderEntryField>
            </div>
            {availableArtworkOptions.length > 1 && (
              <details className="mt-2 rounded border border-slate-700 bg-slate-900 p-2" data-testid="clean-multi-artwork-assignment">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Assign multiple artwork files ({availableArtworkOptions.length} available)</summary>
                <p className="mt-1 text-[11px] text-slate-400">Assign files only when they share this line&apos;s product, size, material, and options. Split different specifications into separate line items.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedArtworkKeys(new Set(availableArtworkOptions.map(artworkLinkKey)))}>
                    Select all available
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedArtworkKeys(new Set())}>
                    Clear
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={selectedArtworkKeys.size === 0} onClick={() => assignArtworkLinks(availableArtworkOptions.filter((link) => selectedArtworkKeys.has(artworkLinkKey(link))))}>
                    Assign selected ({selectedArtworkKeys.size})
                  </Button>
                </div>
                <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto">
                  {availableArtworkOptions.map((link) => {
                    const key = artworkLinkKey(link);
                    return (
                      <label key={key} className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs text-slate-300 hover:bg-slate-800">
                        <input
                          type="checkbox"
                          checked={selectedArtworkKeys.has(key)}
                          onChange={(event) => setSelectedArtworkKeys((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          })}
                        />
                        <span className="truncate">{link.filename || link.fileId}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
            {!activeArtworkLinks.length && availableArtworkOptions.length > 0 && (
              <div className="mt-2 text-xs text-amber-200">
                Assign {availableArtworkOptions[0].filename || "the classified artwork"} to Line Item {index + 1} before marking this draft ready.
              </div>
            )}
            {activeArtworkLinks.length > 0 && (
              <div className="mt-2 grid gap-1 text-xs text-slate-300">
                {activeArtworkLinks.map((link) => (
                  <div key={artworkLinkKey(link)} className="flex min-w-0 items-center justify-between gap-2 rounded border border-slate-700 px-2 py-1">
                    <span className="truncate">{link.filename || link.fileId}{isDoubleSided ? ` · ${artworkAssignmentSideLabel(link)}` : ""}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-red-200" onClick={() => removeArtworkLink(link)}>Remove</Button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="rounded border border-slate-800 bg-slate-950 p-3" data-testid="clean-line-item-task-options" data-clean-resolution-target="product-options">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Step 5</div>
                <div className="text-sm font-bold text-slate-100">PBV2 Product Options</div>
              </div>
              <Badge variant={productOptionsComplete ? "secondary" : "outline"}>{productOptionsComplete ? "Done" : hasSelectedProduct ? "Review" : "Waiting"}</Badge>
            </div>
            {hasSelectedProduct ? (
              <div data-testid="clean-dynamic-product-options">
                <ReviewLineItemProductOptions lineItem={lineItem} index={index} showDiagnostics={false} onChange={onChange} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                Select a product to load product-specific options.
              </div>
            )}
          </section>
          <div data-clean-resolution-target="pricing">
            <InboundLinePricingControl lineItem={lineItem} onChange={onChange} />
          </div>
        </div>
      )}
    </div>
  );
}

function CleanAiSummaryRow({
  label,
  value,
  source,
  confidence,
  target,
  activeTarget,
  onFocusTarget,
}: {
  label: string;
  value: ReactNode;
  source: string | null | undefined;
  confidence?: number | null;
  target: CleanHighlightTarget;
  activeTarget: CleanHighlightTarget | null;
  onFocusTarget: CleanFocusTargetHandler;
}) {
  const confidenceValue = typeof confidence === "number" ? confidence : null;
  const lowConfidence = confidenceValue != null && confidenceValue < 70;
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "grid grid-cols-[88px_1fr] items-start gap-2 rounded px-2 py-1.5 text-left transition-shadow hover:bg-slate-800",
        cleanHighlightClass(target, activeTarget),
      )}
      onClick={() => onFocusTarget(target)}
      onMouseEnter={() => onFocusTarget(target)}
      onFocus={() => onFocusTarget(target)}
      onKeyDown={(event) => {
        if (shouldIgnoreShortcutKeydown(event)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocusTarget(target, { inspectSource: true });
        }
      }}
      data-clean-summary-target={target}
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-100">{value || "-"}</span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
          <CleanSourceChip target={target} source={source} confidence={confidenceValue} onFocusTarget={onFocusTarget} />
          {lowConfidence && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">Low</span>}
        </span>
      </span>
    </div>
  );
}

function cleanOperatorIssueLabel(issue: string): string {
  const lower = issue.toLowerCase();
  if (lower.includes("customer")) return "Customer not matched";
  if (lower.includes("contact")) return "Contact not selected";
  if (lower.includes("product")) return "Product not selected";
  if (lower.includes("quantity") || lower.includes("enter quantity")) return cleanOperatorText(issue) || "Quantity missing";
  if (lower.includes("artwork")) return cleanOperatorText(issue) || "Line item needs artwork assignment";
  if (lower.includes("pole pocket")) return "Confirm pole pocket size and location";
  if (lower.includes("duedate") || lower.includes("due date") || lower.includes("requesteddue")) return "Due date missing";
  if (lower.includes("price") || lower.includes("pricing")) return "Pricing needs review";
  if (lower.includes("material")) return "Product options need review";
  return cleanOperatorText(issue)
    || "Review the inbound request.";
}

function cleanOperatorText(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .replace(/reviewed[A-Za-z]+Json\./g, "")
    .replace(/lineItems\.\d+\.productName/g, "product description")
    .replace(/lineItems\.\d+\./g, "line item ")
    .replace(/\blineItems\b/g, "line items")
    .replace(/\bproductName\b/g, "product description")
    .replace(/requestedDueDate/g, "due date")
    .replace(/\bmaterial\b/gi, "product options")
    .replace(/\bPBV2\b/g, "product")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEvidenceConflictLabel(warning: { code?: string | null; message?: string | null; fieldPath?: string | null }): string {
  const text = `${warning.code ?? ""} ${warning.message ?? ""} ${warning.fieldPath ?? ""}`.toLowerCase();
  if (text.includes("quantity")) return "The quantity in the purchase order differs from the email.";
  if (text.includes("duedate") || text.includes("due date") || text.includes("requesteddue")) return "The requested due date differs between documents.";
  if (text.includes("product")) return "The product description differs between documents.";
  if (text.includes("dimension") || text.includes("size") || text.includes("width") || text.includes("height")) return "The size differs between documents.";
  if (text.includes("material")) return "The product options differ between documents.";
  if (text.includes("artwork")) return "Artwork evidence differs between documents.";
  if (text.includes("price") || text.includes("pricing")) return "Pricing differs between documents.";
  return cleanOperatorText(warning.message) || "Source documents disagree.";
}

function isEvidenceConflictWarning(warning: { code?: string | null; message?: string | null; fieldPath?: string | null }): boolean {
  const text = `${warning.code ?? ""} ${warning.message ?? ""} ${warning.fieldPath ?? ""}`.toLowerCase();
  return text.includes("conflict") || text.includes("differs") || text.includes("disagree");
}

function cleanAiSuggestionText(value: string | null | undefined): string {
  const text = cleanOperatorText(value);
  if (!text) return "";
  return text
    .replace(/No compatible product option found\./i, "No configured product option supports this request.")
    .replace(/Add manually/i, "Review manually")
    .trim();
}

function cleanUniqueItems(items: string[]): string[] {
  return Array.from(new Set(items.map(cleanOperatorText).filter(Boolean)));
}

function CleanSupportDetails({
  title,
  summary,
  children,
  testId,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details className="mb-2 rounded border border-slate-800 bg-slate-900" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-slate-300 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
        <span className="font-bold uppercase tracking-wide text-slate-400">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </span>
      </summary>
      <div className="border-t border-slate-800 p-3">
        {children}
      </div>
    </details>
  );
}

function CleanReviewTaskCategory({
  title,
  items,
  emptyLabel,
  testId,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
  testId: string;
}) {
  return (
    <section className="rounded border border-slate-800 bg-slate-950 p-3" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</div>
        <Badge variant={items.length > 0 ? "outline" : "secondary"}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-emerald-200">{emptyLabel}</div>
      ) : (
        <ul className="space-y-1 text-xs text-slate-200">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </section>
  );
}

function CleanEvidenceConflictGroup({ conflicts }: { conflicts: string[] }) {
  return (
    <details className="rounded border border-slate-800 bg-slate-950" data-testid="clean-evidence-conflict-group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
        <span className="font-bold uppercase tracking-wide text-slate-400">Evidence Conflicts</span>
        <span className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </summary>
      <div className="border-t border-slate-800 p-3">
        {conflicts.length === 0 ? (
          <div className="text-xs text-emerald-200">No document conflicts found.</div>
        ) : (
          <ul className="space-y-1 text-xs text-amber-200">
            {conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}

function CleanCompactAttachments({
  selectedRecord,
  files,
  onOpenAttachment,
}: {
  selectedRecord: ClientInboundOrderRecord;
  files: ClientInboundOrderFile[];
  onOpenAttachment: (recordId: string, file: ClientInboundOrderFile) => void;
}) {
  const filesWithClassification = files.map((file) => ({
    file,
    classification: classificationForLink(artworkLinkFromInboundFile(file, "staff_selected")),
  }));
  const attachmentCategories = [
    { key: "artwork", label: "Artwork", files: filesWithClassification.filter((item) => item.classification === "ARTWORK").map((item) => item.file) },
    { key: "po", label: "Purchase Orders", files: filesWithClassification.filter((item) => item.classification === "PO").map((item) => item.file) },
    { key: "other", label: "Reference / Other", files: filesWithClassification.filter((item) => item.classification === "REFERENCE" || item.classification === "OTHER").map((item) => item.file) },
    { key: "inline", label: "Ignored / Inline Images", files: filesWithClassification.filter((item) => item.classification === "IGNORE_INLINE").map((item) => item.file) },
  ];
  const artworkCount = attachmentCategories.find((category) => category.key === "artwork")?.files.length ?? 0;
  const poCount = attachmentCategories.find((category) => category.key === "po")?.files.length ?? 0;
  return (
    <CleanSupportDetails
      title="Attachments"
      summary={`${files.length} attachment${files.length === 1 ? "" : "s"} / ${artworkCount} artwork / ${poCount} purchase orders`}
      testId="clean-attachments-summary"
    >
      <div className="grid gap-2">
        {attachmentCategories.map((category) => (
          <section key={category.key} className="rounded border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-300">{category.label}</span>
              <Badge variant="outline">{category.files.length} item{category.files.length === 1 ? "" : "s"}</Badge>
            </div>
            {category.files.length > 0 && (
              <div className="grid gap-1 border-t border-slate-800 p-2">
                {category.files.map((file) => (
                  <div key={file.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-semibold text-slate-200">{file.sourceFilename || "Attachment"}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                        <span>{inboundAttachmentRoleLabel(file.role)}</span>
                        <span>{formatFileSize(file.sizeBytes)}</span>
                        {isArchiveAttachment(file) && <span>ZIP / archive</span>}
                        {isQuarantinedAttachment(file) && <span className="text-amber-200">Quarantined</span>}
                        {!file.fileRecordId && <span>Metadata only</span>}
                      </div>
                      <InboundPdfSizeStatus recordId={selectedRecord.id} file={file} />
                    </div>
                    <CleanAttachmentFileActions recordId={selectedRecord.id} file={file} className="text-slate-300" onOpenAttachment={onOpenAttachment} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </CleanSupportDetails>
  );
}

function CleanOrderWorkstation({
  selectedRecord,
  draftPreview,
  reviewDraft,
  detail,
  isLoading,
  isSaving,
  isMarkingReady,
  isReopening,
  isConverting,
  markReadyError,
  convertError,
  quoteError,
  isRejecting,
  isCleaningUp,
  rejectDisabled,
  onSave,
  onMarkReady,
  onReopen,
  onConvert,
  onConvertQuote,
  onReject,
  onQueueAction,
  onDirtyChange,
  form,
  updateForm,
  activeTarget,
  onFocusTarget,
  onOpenAttachment,
}: {
  selectedRecord: ClientInboundOrderRecord | null;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  reviewDraft: InboundOrderReviewDraftDto | undefined;
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  isLoading: boolean;
  isSaving: boolean;
  isMarkingReady: boolean;
  isReopening: boolean;
  isConverting: boolean;
  markReadyError: (Error & { errors?: string[] }) | null;
  convertError: (Error & { errors?: string[] }) | null;
  quoteError: (Error & { errors?: string[] }) | null;
  isRejecting: boolean;
  isCleaningUp: boolean;
  rejectDisabled: boolean;
  onSave: (draft: ReviewDraftFormState) => Promise<void>;
  onMarkReady: (draft: ReviewDraftFormState, dirty: boolean) => Promise<void>;
  onReopen: () => Promise<void>;
  onConvert: (attempt: DraftOrderConversionAttempt) => Promise<void>;
  onConvertQuote: () => Promise<void>;
  onReject: () => void;
  onQueueAction: (action: InboundQueueCleanupAction) => void;
  onDirtyChange: (recordId: string | null, dirty: boolean) => void;
  form: ReviewDraftFormState | null;
  updateForm: (patch: Partial<ReviewDraftFormState>) => void;
  activeTarget: CleanHighlightTarget | null;
  onFocusTarget: CleanFocusTargetHandler;
  onOpenAttachment: (recordId: string, file: ClientInboundOrderFile) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [baseForm, setBaseForm] = useState<ReviewDraftFormState | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const lastReportedDirtyRef = useRef<{ recordId: string | null; dirty: boolean } | null>(null);
  const autoScannedPdfKeysRef = useRef(new Set<string>());
  useEffect(() => {
    if (reviewDraft) setBaseForm(cloneReviewDraft(reviewDraft));
  }, [reviewDraft?.snapshotId, reviewDraft?.updatedAt, reviewDraft?.status]);
  useEffect(() => {
    setProductSearch("");
    setCustomerSearch("");
    setContactSearch("");
    setCustomerDialogOpen(false);
  }, [selectedRecord?.id]);
  useEffect(() => {
    if (!form) return;
    setNewCompanyName(form.reviewedCustomerJson.companyName ?? "");
    setNewContactName(form.reviewedCustomerJson.sourceName ?? "");
    setNewContactEmail(form.reviewedCustomerJson.sourceEmail ?? "");
  }, [selectedRecord?.id, form?.reviewedCustomerJson.companyName, form?.reviewedCustomerJson.sourceName, form?.reviewedCustomerJson.sourceEmail]);
  useEffect(() => {
    if (process.env.NODE_ENV === "test") return;
    if (!selectedRecord || !detail) return;
    const candidates = detail.files.filter((file) => {
      const analysis = pdfSizeAnalysisForFile(file);
      return isInboundPdfAttachment(file)
        && Boolean(file.fileRecordId)
        && file.status === "available"
        && attachmentClassificationFromMetadata(attachmentSafetyMetadata(file), file.role).classification !== "IGNORE_INLINE"
        && analysis?.status !== "failed"
        && analysis?.status !== "unavailable"
        && analysis?.fileIdentity !== inboundPdfFileIdentity(file);
    }).slice(0, 8);
    if (candidates.length === 0) return;
    const requested = candidates.filter((file) => {
      const key = `${selectedRecord.id}:${file.id}:${inboundPdfFileIdentity(file) ?? "unknown"}`;
      if (autoScannedPdfKeysRef.current.has(key)) return false;
      autoScannedPdfKeysRef.current.add(key);
      return true;
    });
    if (requested.length === 0) return;
    void Promise.all(requested.map((file) => postJson(`/api/inbound-orders/${encodeURIComponent(selectedRecord.id)}/files/${encodeURIComponent(file.id)}/pdf-size-scan`, {})))
      .finally(() => queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", selectedRecord.id] }));
  }, [detail?.files, queryClient, selectedRecord?.id]);
  const productSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/product-search", "clean", productSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (productSearch.trim()) params.set("search", productSearch.trim());
      return readJson<InboundProductSearchResponse>(`/api/inbound-orders/product-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftPreview?.draft && reviewDraft),
  });
  const selectedCustomerId = form?.reviewedCustomerJson.selectedCustomerId ?? null;
  const customerSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/customer-search", "clean", customerSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (customerSearch.trim()) params.set("search", customerSearch.trim());
      return readJson<InboundCustomerSearchResponse>(`/api/inbound-orders/customer-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftPreview?.draft && reviewDraft && customerDialogOpen),
  });
  const contactSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/contact-search", "clean", selectedCustomerId, contactSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      if (contactSearch.trim()) params.set("search", contactSearch.trim());
      return readJson<InboundContactSearchResponse>(`/api/inbound-orders/contact-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftPreview?.draft && reviewDraft && customerDialogOpen),
  });
  const createInboundCustomerMutation = useMutation({
    mutationFn: async ({ recordId, payload }: { recordId: string; payload: Record<string, unknown> }) => (
      postJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${recordId}/create-customer`, payload)
    ),
    onSuccess: async (response, variables) => {
      const record = response.data.record;
      updateCustomer({
        selectedCustomerId: record.matchedCustomerId,
        selectedCustomerSource: "staff_selected",
        selectedCustomerReason: "Staff created customer from reviewed inbound candidate.",
        selectedCustomerConfidence: null,
        selectedContactId: record.matchedContactId,
        selectedContactSource: record.matchedContactId ? "staff_selected" : null,
        selectedContactReason: record.matchedContactId ? "Staff created primary contact from reviewed inbound sender." : null,
        selectedContactConfidence: null,
        unresolvedCustomer: false,
        unresolvedContact: false,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId] });
      setCustomerDialogOpen(false);
      toast({ title: "Customer assigned", description: "New customer was created and assigned to this inbound record." });
    },
    onError: (error: Error) => {
      toast({ title: "Customer creation failed", description: error.message, variant: "destructive" });
    },
  });
  const dirty = Boolean(form && baseForm && !formStatesEqual(form, baseForm));
  useEffect(() => {
    const recordId = selectedRecord?.id ?? null;
    const previous = lastReportedDirtyRef.current;
    if (previous?.recordId === recordId && previous.dirty === dirty) return;
    lastReportedDirtyRef.current = { recordId, dirty };
    onDirtyChange(recordId, dirty);
  }, [dirty, onDirtyChange, selectedRecord?.id]);

  if (!selectedRecord) return <section className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-slate-950 text-slate-500">Order Workstation</section>;
  if (isLoading || !form || !reviewDraft || !draftPreview?.draft) {
    return <section className="flex h-full min-h-0 w-full flex-1 flex-col border-l border-slate-700 bg-slate-950 p-4"><Skeleton className="h-40 bg-slate-800" /></section>;
  }

  const updateOrder = (patch: Partial<ReviewDraftFormState["reviewedOrderJson"]>) => {
    updateForm({ reviewedOrderJson: { ...form.reviewedOrderJson, ...patch } });
  };
  const updateCustomer = (patch: Partial<ReviewDraftFormState["reviewedCustomerJson"]>) => {
    updateForm({ reviewedCustomerJson: { ...form.reviewedCustomerJson, ...patch } });
  };
  const updateLineItem = (index: number, patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => {
    const reviewedLineItemsJson = form.reviewedLineItemsJson.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      if (!Object.prototype.hasOwnProperty.call(patch, "pricingReviewJson") && inboundLinePricingDependenciesChanged(item, next)) {
        next.pricingReviewJson = markInboundLinePricingNeedsRecalculation(item.pricingReviewJson, next.quantity);
      }
      return next;
    });
    updateForm(reconcileResolvedLineItemDecisions(form, reviewedLineItemsJson));
  };
  const addLineItem = () => {
    updateForm({
      reviewedLineItemsJson: [
        ...form.reviewedLineItemsJson,
        createBlankReviewLineItem(form.reviewedLineItemsJson.length),
      ],
    });
  };
  const duplicateLineItem = (index: number) => {
    const source = form.reviewedLineItemsJson[index];
    if (!source) return;
    const copy = cloneManualReviewLineItem(source, index + 1);
    updateForm({
      reviewedLineItemsJson: [
        ...form.reviewedLineItemsJson.slice(0, index + 1),
        copy,
        ...form.reviewedLineItemsJson.slice(index + 1),
      ],
    });
  };
  const splitLineItem = (index: number) => {
    const source = form.reviewedLineItemsJson[index];
    if (!source) return;
    const first = cloneManualReviewLineItem(source, index);
    const second = cloneManualReviewLineItem(source, index + 1);
    const splitQuantity = source.quantity === 2 ? 1 : source.quantity;
    first.quantity = splitQuantity;
    first.quantitySource = splitQuantity ? "staff_selected" : source.quantitySource;
    first.sourceText = source.sourceText ? `${source.sourceText} (split 1)` : `Split line item ${index + 1}.1`;
    second.quantity = splitQuantity;
    second.quantitySource = splitQuantity ? "staff_selected" : source.quantitySource;
    second.sourceText = source.sourceText ? `${source.sourceText} (split 2)` : `Split line item ${index + 1}.2`;
    updateForm({
      reviewedLineItemsJson: [
        ...form.reviewedLineItemsJson.slice(0, index),
        first,
        second,
        ...form.reviewedLineItemsJson.slice(index + 1),
      ],
    });
  };
  const removeLineItem = (index: number) => {
    updateForm(removeReviewedLineItem(form, index));
  };
  const productCatalogOptions = (productSearchQuery.data?.data ?? []).map(productToReviewOption);
  const customerOptions = mergeReviewOptions(
    (draftPreview.draft.customer.customerCandidates ?? []).map(candidateToReviewOption),
    (customerSearchQuery.data?.data ?? []).map(customerToReviewOption),
  );
  const contactOptions = mergeReviewOptions(
    (draftPreview.draft.customer.contactCandidates ?? []).map(candidateToReviewOption),
    (contactSearchQuery.data?.data ?? []).map(contactToReviewOption),
  );
  const inboundFiles = dedupeAttachmentFiles(detail?.files ?? []);
  const pdfSizeAnalysesByFileId = new Map(inboundFiles.flatMap((file) => {
    const analysis = pdfSizeAnalysisForFile(file);
    return analysis ? [[file.id, analysis] as const] : [];
  }));
  const storedAttachmentLinks = dedupeAttachmentFiles(detail?.files ?? [])
    .map((file) => artworkLinkFromInboundFile(file, "staff_selected"))
    .filter((link) => classificationForLink(link) === "ARTWORK");
  const attachmentLinkOptions = dedupeAttachmentLinks([
    ...storedAttachmentLinks,
    ...form.reviewedArtworkJson.unassignedAttachments,
    ...form.reviewedLineItemsJson.flatMap((lineItem) => lineItem.artworkLinks),
  ]).filter((link) => link.source !== "staff_removed" && classificationForLink(link) === "ARTWORK");
  const anyArtworkAssigned = form.reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
  const artworkBypassSelected = !anyArtworkAssigned && form.reviewedArtworkJson.status === "to_follow";
  const artworkBlocksDraftOrder = !anyArtworkAssigned
    && form.reviewedArtworkJson.status !== "not_required"
    && !artworkBypassSelected;
  const rawValidationErrors = markReadyError?.errors ?? reviewDraft.validationErrors ?? [];
  const validationErrors = rawValidationErrors.filter((error) => {
    if (validationErrorReferencesRemovedLine(error, form.reviewedLineItemsJson.length)) return false;
    if (anyArtworkAssigned && artworkValidationErrorIsResolvedByAssignment(form.reviewedLineItemsJson, error)) return false;
    if (/\b(?:size|dimensions?|width|height)\b/i.test(error)) {
      const lineMatch = error.match(/line\s+(\d+)/i);
      if (lineMatch) return !hasValidLineItemDimensions(form.reviewedLineItemsJson[Number(lineMatch[1]) - 1]);
      return !form.reviewedLineItemsJson.every(hasValidLineItemDimensions);
    }
    const pricingStillBlocking = pricingValidationErrorIsStillBlocking(error, form.reviewedLineItemsJson);
    if (pricingStillBlocking !== null) return pricingStillBlocking;
    if (!/quantity/i.test(error)) return true;
    const lineMatch = error.match(/line\s+(\d+)/i);
    if (lineMatch) return !hasValidLineItemQuantity(form.reviewedLineItemsJson[Number(lineMatch[1]) - 1]);
    return !form.reviewedLineItemsJson.every(hasValidLineItemQuantity);
  });
  const artworkNeedsAssignment = !anyArtworkAssigned && (
    attachmentLinkOptions.length > 0
    || form.reviewedArtworkJson.status === "supplied"
    || form.reviewedArtworkJson.refs.some((reference) => reference.purpose === "artwork")
  );
  const conversionErrors = convertError?.errors ?? [];
  const quoteErrors = quoteError?.errors ?? [];
  const unresolvedPricingIssues = form.reviewedLineItemsJson.flatMap((lineItem, index) => (
    lineItem.pricingReviewJson?.status === "mismatch" && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution)
      ? [`Line ${index + 1}: PO price differs from system price.`]
      : []
  ));
  const minimumConversionIssues = [
    !form.reviewedCustomerJson.selectedCustomerId && !form.reviewedCustomerJson.unresolvedCustomer ? "Select a customer or mark customer unresolved." : null,
    form.reviewedLineItemsJson.length === 0 ? "Add at least one line item." : null,
    artworkNeedsAssignment ? "Line 1 needs artwork assignment." : artworkBlocksDraftOrder ? "Artwork is missing. Assign it or select Bypass artwork for order conversion." : null,
    ...form.reviewedLineItemsJson.flatMap((lineItem, index) => [
      !lineItem.quantity ? `Line ${index + 1}: enter quantity.` : null,
      !lineItem.selectedProductId && !lineItem.productUnresolved ? `Line ${index + 1}: select a product or mark unresolved.` : null,
    ]),
    ...unresolvedPricingIssues,
    ...validationErrors,
  ].filter(Boolean) as string[];
  const draftOrderBlockers = cleanUniqueItems([
    ...minimumConversionIssues,
  ]);
  const canCreateDraftOrder = draftOrderBlockers.length === 0;
  const quoteBlockers = [
    !form.reviewedCustomerJson.selectedCustomerId ? "Assign a permanent customer before creating a draft quote." : null,
    form.reviewedLineItemsJson.length === 0 ? "Add at least one line item." : null,
    ...form.reviewedLineItemsJson.flatMap((lineItem, index) => [
      !lineItem.quantity ? `Line ${index + 1}: enter quantity.` : null,
      !lineItem.selectedProductId ? `Line ${index + 1}: select a product.` : null,
      !lineItem.width || !lineItem.height ? `Line ${index + 1}: enter size.` : null,
    ]),
  ].filter(Boolean) as string[];
  const quoteWarnings = [
    !anyArtworkAssigned && form.reviewedArtworkJson.status === "missing" ? "Artwork missing: this will be carried as a quote warning." : null,
    !anyArtworkAssigned && form.reviewedArtworkJson.status === "to_follow" ? "Artwork to follow: this will be carried as a quote warning." : null,
  ].filter(Boolean) as string[];
  const canCreateDraftQuote = quoteBlockers.length === 0 && !isConverting;
  const actionPending = isSaving || isMarkingReady || isReopening || isConverting;
  const cleanDraft = draftPreview.draft;
  const evidenceConflictItems = cleanUniqueItems([
    ...(cleanDraft.evidence?.conflicts ?? []).map(cleanEvidenceConflictLabel),
    ...form.warningsJson.filter(isEvidenceConflictWarning).map(cleanEvidenceConflictLabel),
  ]);
  const blockingDecisionItems = cleanUniqueItems([
    ...form.missingDecisionsJson
      .filter((decision) => (
        decision.status === "still_blocking"
        && !isObsoleteRemovedLineDecision(decision)
        && !(anyArtworkAssigned && isArtworkDecision(decision) && artworkDecisionIsResolvedByAssignment(form.reviewedLineItemsJson, decision))
        && !(isQuantityDecision(decision) && quantityDecisionIsResolvedByLineItem(form.reviewedLineItemsJson, decision))
        && !(isDimensionsDecision(decision) && dimensionsDecisionIsResolvedByLineItem(form.reviewedLineItemsJson, decision))
      ))
      .map((decision) => cleanOperatorIssueLabel([decision.label, decision.reason].filter(Boolean).join(": "))),
  ]);
  const aiSuggestionItems = cleanUniqueItems([
    ...(form.unsupportedRequestsJson ?? []).map((finding) => (
      cleanAiSuggestionText(finding.suggestedAction)
      || cleanAiSuggestionText(finding.reason)
      || cleanAiSuggestionText(finding.requestedText)
    )),
    ...form.reviewedLineItemsJson.flatMap((lineItem) => (
      (lineItem.pbv2OptionSuggestions ?? [])
        .filter((suggestion) => suggestion.origin !== "DEFAULT")
        .map((suggestion) => cleanAiSuggestionText(`AI recommends ${suggestion.label}: ${suggestion.choiceLabel}. ${suggestion.reason}`))
    )),
  ]);
  const informationItems = cleanUniqueItems([
    ...form.warningsJson.filter((warning) => !isEvidenceConflictWarning(warning)).map((warning) => cleanOperatorText(warning.message)),
    ...form.missingDecisionsJson
      .filter((decision) => decision.status !== "still_blocking" && decision.severity !== "blocking" && !isObsoleteRemovedLineDecision(decision))
      .map((decision) => cleanOperatorText([decision.label, decision.reason].filter(Boolean).join(": "))),
  ]);
  const firstLine = form.reviewedLineItemsJson[0] ?? null;
  const firstLineSize = firstLine?.width && firstLine?.height ? `${firstLine.width} x ${firstLine.height}${firstLine.dimensionsUnit ? ` ${firstLine.dimensionsUnit}` : ""}` : null;
  const firstLineArtworkLinked = firstLine?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
  const assignedCustomer = Boolean(form.reviewedCustomerJson.selectedCustomerId);
  const suggestedCustomer = form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.sourceName || null;
  const assignedCustomerLabel = assignedCustomer
    ? (form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.selectedCustomerId)
    : "Customer not assigned";
  const splitContactName = (newContactName || "").trim().split(/\s+/).filter(Boolean);
  const completionChecklist = cleanCompletionChecklist(form, reviewDraft);
  const remainingChecklistItems = completionChecklist.filter((item) => !item.complete).length;
  const blockingDecisionCount = remainingChecklistItems + blockingDecisionItems.length;
  const internalNoteCount = form.reviewedOrderJson.internalNotes ? 1 : 0;
  const productionNoteCount = form.reviewedOrderJson.customerNotes ? 1 : 0;
  const conversionBlockerCount = minimumConversionIssues.length + conversionErrors.length;
  const activeEvidenceComparison = cleanEvidenceComparison(activeTarget, form, cleanDraft);
  const focusResolutionTarget = (target: CleanHighlightTarget) => {
    onFocusTarget(target, { inspectSource: false });
    window.setTimeout(() => {
      const selector = `[data-clean-resolution-target="${target}"][data-clean-resolution-primary="true"], [data-clean-resolution-target="${target}"]`;
      const targetElement = document.querySelector(selector) as HTMLElement | null;
      targetElement?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      const focusable = targetElement?.matches("input, select, textarea, button, [tabindex]")
        ? targetElement
        : targetElement?.querySelector("input, select, textarea, button, [tabindex]") as HTMLElement | null;
      focusable?.focus();
    }, 0);
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-1 flex-col bg-slate-950 text-slate-100" data-testid="clean-order-workstation">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-700 px-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Order Workstation</div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-400">Reset</Button>
          <Badge variant="outline">Draft</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div
          className={cn("mb-3 block w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-left transition-shadow", cleanHighlightClass("customer", activeTarget))}
          onMouseEnter={() => onFocusTarget("customer")}
          data-clean-destination-target="customer"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {assignedCustomer ? <CheckCircle2 className="h-4 w-4 text-emerald-200" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-amber-200" aria-hidden="true" />}
                <div className="truncate text-sm font-bold">{assignedCustomerLabel}</div>
              </div>
              <div className="truncate text-xs text-slate-400">
                {assignedCustomer ? "Assigned customer" : suggestedCustomer ? `Suggested: ${suggestedCustomer}` : "No parsed customer candidate"}
              </div>
              <div className="truncate text-xs text-slate-500">{form.reviewedCustomerJson.sourceEmail || "No sender email"}</div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-blue-200" onClick={() => setCustomerDialogOpen(true)}>
              {assignedCustomer ? "Reassign customer" : "Assign customer"}
            </Button>
          </div>
        </div>
        <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{assignedCustomer ? "Reassign customer" : "Assign customer"}</DialogTitle>
              <DialogDescription>
                Parsed customer text is only a suggestion. Select an existing customer or explicitly create a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parsed customer candidate</div>
                <div className="mt-1 text-sm font-medium text-foreground">{suggestedCustomer || "No company parsed"}</div>
                <div className="text-xs text-muted-foreground">{form.reviewedCustomerJson.sourceName || "No parsed contact"} / {form.reviewedCustomerJson.sourceEmail || "No sender email"}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SearchableReviewSelector
                  label="Assigned customer"
                  searchLabel="Search existing customers"
                  searchPlaceholder="Search companies, emails, contacts"
                  value={form.reviewedCustomerJson.selectedCustomerId}
                  searchValue={customerSearch}
                  options={customerOptions}
                  isLoading={customerSearchQuery.isFetching}
                  onSearchChange={setCustomerSearch}
                  onChange={(customerId) => updateCustomer({
                    selectedCustomerId: customerId,
                    selectedCustomerSource: customerId ? "staff_selected" : null,
                    selectedCustomerReason: customerId ? "Staff selected customer in Clean View." : null,
                    selectedCustomerConfidence: null,
                    selectedContactId: null,
                    selectedContactSource: null,
                    selectedContactReason: null,
                    selectedContactConfidence: null,
                    unresolvedCustomer: false,
                    unresolvedContact: false,
                  })}
                />
                <SearchableReviewSelector
                  label="Assigned contact"
                  searchLabel="Search contacts"
                  searchPlaceholder={form.reviewedCustomerJson.selectedCustomerId ? "Search selected customer contacts" : "Search contacts"}
                  value={form.reviewedCustomerJson.selectedContactId}
                  searchValue={contactSearch}
                  options={contactOptions}
                  isLoading={contactSearchQuery.isFetching}
                  onSearchChange={setContactSearch}
                  onChange={(contactId) => updateCustomer({
                    selectedContactId: contactId,
                    selectedContactSource: contactId ? "staff_selected" : null,
                    selectedContactReason: contactId ? "Staff selected contact in Clean View." : null,
                    selectedContactConfidence: null,
                    unresolvedContact: false,
                  })}
                />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Create new company</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <OrderEntryField label="Company name">
                    <Input value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} />
                  </OrderEntryField>
                  <OrderEntryField label="Contact name">
                    <Input value={newContactName} onChange={(event) => setNewContactName(event.target.value)} />
                  </OrderEntryField>
                  <OrderEntryField label="Contact email">
                    <Input value={newContactEmail} onChange={(event) => setNewContactEmail(event.target.value)} />
                  </OrderEntryField>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={!newCompanyName.trim() || createInboundCustomerMutation.isPending}
                  onClick={() => {
                    if (!selectedRecord) return;
                    createInboundCustomerMutation.mutate({
                      recordId: selectedRecord.id,
                      payload: {
                        companyName: newCompanyName.trim(),
                        contactFirstName: splitContactName.slice(0, -1).join(" ") || splitContactName[0] || null,
                        contactLastName: splitContactName.length > 1 ? splitContactName[splitContactName.length - 1] : null,
                        contactEmail: trimToNull(newContactEmail),
                        customerEmail: trimToNull(newContactEmail),
                        staffNote: "Created from Inbound Orders Clean View customer resolution.",
                      },
                    });
                  }}
                >
                  {createInboundCustomerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create and assign
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCustomerDialogOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="mb-3 rounded border border-blue-400/30 bg-blue-400/10 p-3" data-testid="clean-ai-summary">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-100">Order Summary</div>
          <div className="grid gap-1">
            <CleanAiSummaryRow label="Customer" value={form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.sourceName} source={form.reviewedCustomerJson.selectedCustomerSource} confidence={form.reviewedCustomerJson.selectedCustomerConfidence} target="customer" activeTarget={activeTarget} onFocusTarget={onFocusTarget} />
            <CleanAiSummaryRow label="Product" value={firstLine?.productName} source={firstLine?.selectedProductSource} confidence={firstLine?.interpretedProductConfidence} target="product" activeTarget={activeTarget} onFocusTarget={onFocusTarget} />
            <CleanAiSummaryRow label="Quantity" value={firstLine?.quantity ?? null} source={firstLine?.quantitySource} confidence={cleanDraft.lineItems[0]?.confidence} target="quantity" activeTarget={activeTarget} onFocusTarget={onFocusTarget} />
            <CleanAiSummaryRow label="Size" value={firstLineSize} source={firstLine?.dimensionsSource} confidence={cleanDraft.lineItems[0]?.confidence} target="dimensions" activeTarget={activeTarget} onFocusTarget={onFocusTarget} />
            <CleanAiSummaryRow label="Artwork" value={firstLineArtworkLinked ? "Attached" : "Missing"} source={firstLineArtworkLinked ? "attachment" : null} confidence={cleanDraft.artwork[0]?.confidence} target="artwork" activeTarget={activeTarget} onFocusTarget={onFocusTarget} />
          </div>
          {activeEvidenceComparison && (
            <div className="mt-3 rounded border border-blue-300/30 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-200" data-testid="clean-evidence-comparison">
              <div className="font-bold uppercase tracking-wide text-blue-100">{activeEvidenceComparison.label} evidence</div>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <span>Primary: {activeEvidenceComparison.primary}</span>
                <span>Secondary: {activeEvidenceComparison.secondary}</span>
                <span>Confidence: {activeEvidenceComparison.confidence}</span>
              </div>
              {activeEvidenceComparison.conflict && <div className="mt-1 font-semibold text-amber-200">Conflict detected</div>}
            </div>
          )}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div
            className={cn("rounded transition-shadow", cleanHighlightClass("po", activeTarget))}
          onMouseEnter={() => onFocusTarget("po")}
          onFocus={() => onFocusTarget("po")}
          data-clean-destination-target="po"
          data-clean-resolution-target="po"
          data-highlighted={activeTarget === "po" ? "true" : "false"}
          >
            <OrderEntryField label="PO Ref">
              <Input data-testid="clean-po-field" data-highlighted={activeTarget === "po" ? "true" : "false"} value={form.reviewedOrderJson.poNumber ?? ""} onChange={(event) => updateOrder({ poNumber: textInputValueToNull(event.target.value) })} />
            </OrderEntryField>
            <div className="mt-1">
              <CleanSourceChip target="po" source="po_pdf" confidence={cleanDraft.order.confidence} onFocusTarget={onFocusTarget} />
            </div>
          </div>
          <div
            className={cn("rounded transition-shadow", cleanHighlightClass("dueDate", activeTarget))}
          onMouseEnter={() => onFocusTarget("dueDate")}
          onFocus={() => onFocusTarget("dueDate")}
          data-clean-destination-target="dueDate"
          data-clean-resolution-target="dueDate"
          data-highlighted={activeTarget === "dueDate" ? "true" : "false"}
          >
            <OrderEntryField label="Due date">
              <Input type="date" value={form.reviewedOrderJson.dueDate ?? ""} onChange={(event) => updateOrder({ dueDate: trimToNull(event.target.value) })} />
            </OrderEntryField>
            <div className="mt-1">
              <CleanSourceChip target="dueDate" source="po_pdf" confidence={cleanDraft.order.confidence} onFocusTarget={onFocusTarget} />
            </div>
          </div>
          <OrderEntryField label="Priority">
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedOrderJson.priority ?? "normal"} onChange={(event) => updateOrder({ priority: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["priority"] })}>
              <option value="rush">Rush</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </OrderEntryField>
          <OrderEntryField label="Carrier"><Input value={form.reviewedOrderJson.shipMethod ?? ""} onChange={(event) => updateOrder({ shipMethod: textInputValueToNull(event.target.value) })} /></OrderEntryField>
        </div>
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-slate-100">Line Items</div>
              <Badge variant="outline">{form.reviewedLineItemsJson.length}</Badge>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addLineItem} disabled={actionPending}>
              Add line item
            </Button>
          </div>
          <div className="grid gap-3">
            {form.reviewedLineItemsJson.length === 0 ? (
              <div className="rounded border border-dashed border-slate-700 px-3 py-8 text-center text-sm text-slate-500">No line items.</div>
            ) : form.reviewedLineItemsJson.map((lineItem, index) => (
              <CleanLineItemCard
                key={index}
                lineItem={lineItem}
                index={index}
                productOptions={mergeReviewOptions(
                  (cleanDraft.lineItems[index]?.productCandidates ?? []).map(candidateToReviewOption),
                  productCatalogOptions,
                  lineItem.selectedProductId && !(cleanDraft.lineItems[index]?.productCandidates ?? []).some((candidate) => candidate.id === lineItem.selectedProductId)
                    ? [{ id: lineItem.selectedProductId, label: lineItem.productName || lineItem.selectedProductId, description: null }]
                    : [],
                )}
                productSearch={productSearch}
                isProductSearchFetching={productSearchQuery.isFetching}
                attachmentLinkOptions={attachmentLinkOptions}
                pdfSizeAnalysesByFileId={pdfSizeAnalysesByFileId}
                onChange={(patch) => updateLineItem(index, patch)}
                onProductSearchChange={setProductSearch}
                onDuplicate={() => duplicateLineItem(index)}
                onRemove={() => removeLineItem(index)}
                onSplit={() => splitLineItem(index)}
                segmentationReason={(cleanDraft.lineItems[index]?.warnings ?? []).find((item) => item.code === "line_item_segmented_from_source")?.message ?? null}
                activeTarget={activeTarget}
                onFocusTarget={onFocusTarget}
              />
            ))}
          </div>
        </div>
        <CleanSupportDetails
          title="Notes"
          summary={`Internal: ${internalNoteCount} / Production: ${productionNoteCount}`}
          testId="clean-notes-section"
        >
          <div className="grid gap-2">
            <OrderEntryField label="Production Notes"><Textarea value={form.reviewedOrderJson.customerNotes ?? ""} onChange={(event) => updateOrder({ customerNotes: textInputValueToNull(event.target.value) })} /></OrderEntryField>
            <OrderEntryField label="Internal Notes"><Textarea value={form.reviewedOrderJson.internalNotes ?? ""} onChange={(event) => updateOrder({ internalNotes: textInputValueToNull(event.target.value) })} /></OrderEntryField>
          </div>
        </CleanSupportDetails>
        <CleanCompactAttachments selectedRecord={selectedRecord} files={inboundFiles} onOpenAttachment={onOpenAttachment} />
        <CleanSupportDetails
          title="Review Tasks"
          summary={`${blockingDecisionCount} blocking / ${evidenceConflictItems.length} conflicts / ${aiSuggestionItems.length} suggestions`}
          testId="clean-review-tasks"
        >
          <div className="grid gap-3">
            <div className="rounded border border-slate-800 bg-slate-950 p-3" data-testid="clean-completion-checklist">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Blocking Decisions</div>
                <Badge variant={blockingDecisionCount > 0 ? "destructive" : "secondary"}>{blockingDecisionCount}</Badge>
              </div>
              <div className="grid gap-1.5">
                {completionChecklist.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                    data-clean-checklist-item={item.label}
                    data-complete={item.complete ? "true" : "false"}
                    onClick={() => focusResolutionTarget(item.target)}
                  >
                    <span className={cn("flex h-4 w-4 items-center justify-center rounded border text-[10px]", item.complete ? "border-emerald-400 bg-emerald-400/20 text-emerald-200" : "border-amber-400/70 bg-amber-400/10 text-amber-100")}>
                      {item.complete ? <CheckCircle2 className="h-3 w-3" aria-label="Complete" /> : <AlertTriangle className="h-3 w-3" aria-label="Warning" />}
                    </span>
                    <span>{item.label}: {item.complete ? "Complete" : "Needs review"}</span>
                  </button>
                ))}
              </div>
              {blockingDecisionItems.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs text-amber-200">
                  {blockingDecisionItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
            <CleanEvidenceConflictGroup conflicts={evidenceConflictItems} />
            <CleanReviewTaskCategory
              title="AI Suggestions"
              items={aiSuggestionItems}
              emptyLabel="No AI suggestions need review."
              testId="clean-ai-suggestions"
            />
            <CleanReviewTaskCategory
              title="Information"
              items={informationItems}
              emptyLabel="No extra information."
              testId="clean-review-information"
            />
          </div>
        </CleanSupportDetails>
        {reviewDraft.customerIntelligenceJson && (
          <CleanSupportDetails
            title="Customer Intelligence"
            summary="Available"
            testId="clean-customer-intelligence"
          >
            <CustomerIntelligencePanel intelligence={reviewDraft.customerIntelligenceJson} />
          </CleanSupportDetails>
        )}
        <CleanSupportDetails
          title="Ready Validation"
          summary={`${conversionBlockerCount} blocking issue${conversionBlockerCount === 1 ? "" : "s"}`}
          testId="clean-readiness-validation"
        >
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            {conversionBlockerCount === 0 ? (
              <div className="text-xs text-emerald-200">Ready validation has no blocking issues.</div>
            ) : (
              <div className="text-xs text-amber-200">Resolve required review items before conversion.</div>
            )}
          </div>
        </CleanSupportDetails>
        <CleanSupportDetails
          title="Missing Before Conversion"
          summary={`${conversionBlockerCount} item${conversionBlockerCount === 1 ? "" : "s"}`}
          testId="clean-missing-before-conversion"
        >
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            {conversionBlockerCount === 0 ? (
              <div className="text-xs text-emerald-200">Nothing missing before conversion.</div>
            ) : (
              <ul className="space-y-1 text-xs text-amber-200">
                {[...minimumConversionIssues, ...conversionErrors].map((issue) => <li key={issue}>{cleanOperatorIssueLabel(issue)}</li>)}
              </ul>
            )}
          </div>
        </CleanSupportDetails>
      </div>
      <div className="shrink-0 border-t border-slate-700 bg-slate-900 px-3 py-2">
        {quoteWarnings.length > 0 && <div className="mb-2 text-xs text-amber-200">{quoteWarnings.join(" ")}</div>}
        {quoteErrors.length > 0 && <div className="mb-2 text-xs text-red-300">{quoteErrors.join(" ")}</div>}
        {conversionErrors.length > 0 && <div className="mb-2 text-xs text-red-300">{conversionErrors.join(" ")}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onReject} disabled={rejectDisabled || isCleaningUp}>{isRejecting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Reject</Button>
          <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={() => { void onSave(form).catch(() => undefined); }} disabled={!dirty || isSaving}>{isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save Draft</Button>
          <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { void onConvertQuote().catch(() => undefined); }} disabled={!canCreateDraftQuote || isConverting} title={quoteBlockers[0] ?? quoteWarnings[0] ?? "Create draft quote"}>
            {isConverting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Convert to Draft Quote
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => { void onConvert({ draft: form, blockers: draftOrderBlockers }).catch(() => undefined); }}
            disabled={actionPending}
            title={canCreateDraftOrder ? "Create an order from the current reviewed inbound draft." : draftOrderBlockers[0]}
          >
            {isConverting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create Order
          </Button>
        </div>
        {quoteBlockers.length > 0 && <div className="mt-2 truncate text-[11px] text-amber-200">{quoteBlockers[0]}</div>}
        {quoteBlockers.length === 0 && minimumConversionIssues.length > 0 && <div className="mt-2 truncate text-[11px] text-amber-200">{minimumConversionIssues[0]}</div>}
      </div>
    </section>
  );
}

type ReviewSelectOption = {
  id: string;
  label: string;
  description?: string | null;
};

function candidateToReviewOption(candidate: InboundOrderParsedDraft["customer"]["customerCandidates"][number]): ReviewSelectOption {
  return {
    id: candidate.id,
    label: candidate.label,
    description: candidate.reason,
  };
}

function customerToReviewOption(customer: InboundMatchedCustomerSummary): ReviewSelectOption {
  return {
    id: customer.id,
    label: customer.companyName || customer.email || customer.id,
    description: [customer.email, customer.phone, customer.status].filter(Boolean).join(" / ") || null,
  };
}

function contactToReviewOption(contact: InboundContactSearchResponse["data"][number]): ReviewSelectOption {
  return {
    id: contact.id,
    label: contact.name || contact.email || contact.id,
    description: [
      contact.email,
      contact.phone ?? contact.mobile,
      contact.isPrimary ? "Primary" : null,
    ].filter(Boolean).join(" / ") || null,
  };
}

function productToReviewOption(product: InboundProductSearchResult): ReviewSelectOption {
  return {
    id: product.id,
    label: product.name || product.id,
    description: [product.category, product.pricingMode, product.pbv2ActiveTreeVersionId ? "PBV2" : null].filter(Boolean).join(" / ") || product.description,
  };
}

function mergeReviewOptions(...groups: ReviewSelectOption[][]): ReviewSelectOption[] {
  const seen = new Set<string>();
  const merged: ReviewSelectOption[] = [];
  groups.flat().forEach((option) => {
    if (!option.id || seen.has(option.id)) return;
    seen.add(option.id);
    merged.push(option);
  });
  return merged;
}

function SearchableReviewSelector({
  label,
  searchLabel,
  searchPlaceholder,
  value,
  searchValue,
  options,
  isLoading,
  disabled,
  onSearchChange,
  onChange,
}: {
  label: string;
  searchLabel: string;
  searchPlaceholder: string;
  value: string | null;
  searchValue: string;
  options: ReviewSelectOption[];
  isLoading: boolean;
  disabled?: boolean;
  onSearchChange: (value: string) => void;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">
        {searchLabel}
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        {label}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={value ?? ""}
          onChange={(event) => onChange(trimToNull(event.target.value))}
          disabled={disabled}
        >
          <option value="">{isLoading ? "Searching..." : "Unselected"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.description ? `${option.label} - ${option.description}` : option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ensurePbv2Selections(value: unknown): LineItemOptionSelectionsV2 {
  if (value && typeof value === "object" && (value as any).schemaVersion === 2 && (value as any).selected) {
    return value as LineItemOptionSelectionsV2;
  }
  return { schemaVersion: 2, selected: {} };
}

function selectionSourceLabel(source: string | null | undefined, note: string | null | undefined, origin?: string | null): string {
  if (origin === "DEFAULT") return "Default";
  if (origin === "SOURCE_EVIDENCE") return "Source evidence";
  if (origin === "AI_INFERRED") return "AI inferred";
  if (origin === "USER_SELECTED") return "Staff selected";
  if (source === "ai_inferred") return "AI inferred";
  if (source === "crm_match") return "CRM match";
  if (source === "catalog_match") return "Catalog match";
  if (source === "product_default" || note === "Default") return "Default";
  if (source === "deterministic_print_spec_rule" || note === "Deterministic print spec rule") return "Print rule";
  if (source === "source_evidence" || note === "Suggested from PO" || note === "Suggested from inbound source evidence.") return "Suggested from PO";
  if (source === "customer_history") return "Customer history";
  if (source === "staff_selected" || note === "Staff selected") return "Staff selected";
  return "Suggested";
}

function customerSelectionIntro(source: string | null | undefined): string {
  if (source === "interpreted_customer_match" || source === "interpreted_contact_match" || source === "ai_inferred") return "AI inferred";
  if (source === "crm_match") return "CRM matched";
  if (source === "staff_selected") return "Staff selected";
  return "Selection";
}

function ValueSourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  return <Badge variant="outline">{selectionSourceLabel(source, null)}</Badge>;
}

function OrderEntryField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("space-y-1 text-xs text-muted-foreground", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function OrderEntrySectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {typeof count === "number" && <Badge variant="outline">{count}</Badge>}
    </div>
  );
}

function createBlankReviewLineItem(index: number): ReviewDraftFormState["reviewedLineItemsJson"][number] {
  return {
    sourceLineItemId: null,
    sourceText: `Manual line item ${index + 1}`,
    productName: null,
    selectedProductId: null,
    selectedProductSource: null,
    interpretedProductId: null,
    interpretedProductReason: null,
    interpretedProductConfidence: null,
    productUnresolved: true,
    quantity: null,
    quantitySource: null,
    width: null,
    height: null,
    dimensionsUnit: "in",
    dimensionsSource: null,
    materialText: null,
    materialSource: null,
    printSpecs: [],
    printSpecsSource: null,
    optionTexts: [],
    optionTextsSource: null,
    finishingTexts: [],
    finishingTextsSource: null,
    optionSelectionsJson: null,
    pbv2TreeVersionId: null,
    pbv2OptionSuggestions: [],
    pricingReviewJson: null,
    artworkLinks: [],
    artworkQuantityMode: "same_quantity_each",
    notes: null,
  };
}

function cloneManualReviewLineItem(
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number],
  index: number,
): ReviewDraftFormState["reviewedLineItemsJson"][number] {
  return {
    ...JSON.parse(JSON.stringify(lineItem)),
    sourceLineItemId: null,
    sourceText: lineItem.sourceText ? `${lineItem.sourceText} (copy)` : `Manual line item ${index + 1}`,
    selectedProductSource: lineItem.selectedProductId ? "staff_selected" : null,
    materialSource: lineItem.materialText ? "staff_selected" : null,
    quantitySource: lineItem.quantity ? "staff_selected" : null,
    dimensionsSource: lineItem.width || lineItem.height || lineItem.dimensionsUnit ? "staff_selected" : null,
    printSpecsSource: lineItem.printSpecs.length > 0 ? "staff_selected" : null,
    optionTextsSource: lineItem.optionTexts.length > 0 ? "staff_selected" : null,
    finishingTextsSource: lineItem.finishingTexts.length > 0 ? "staff_selected" : null,
  };
}

function markChangedPbv2SelectionsAsStaffSelected(
  next: LineItemOptionSelectionsV2,
  previous: LineItemOptionSelectionsV2,
): LineItemOptionSelectionsV2 {
  return {
    ...next,
    selected: Object.fromEntries(Object.entries(next.selected ?? {}).map(([key, entry]) => {
      const previousValue = previous.selected?.[key]?.value;
      const changed = JSON.stringify(previousValue ?? null) !== JSON.stringify(entry?.value ?? null);
      return [key, changed ? { ...entry, note: "Staff selected", origin: "USER_SELECTED", evidence: null } : entry];
    })),
  };
}

function ReviewLineItemProductOptions({
  lineItem,
  index,
  showDiagnostics = true,
  onChange,
}: {
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number];
  index: number;
  showDiagnostics?: boolean;
  onChange: (patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => void;
}) {
  const productId = lineItem.selectedProductId;
  const query = useQuery({
    queryKey: ["/api/inbound-orders/product-options", productId, index, lineItem.sourceText, lineItem.materialText, lineItem.optionTexts, lineItem.finishingTexts],
    queryFn: () => postJson<InboundOrderProductOptionsResponse>(`/api/inbound-orders/product-options/${productId}`, { lineItem }),
    enabled: Boolean(productId),
  });
  const config = query.data?.data ?? null;
  const selections = ensurePbv2Selections(lineItem.optionSelectionsJson);
  const userEditedPbv2Ref = useRef(false);

  useEffect(() => {
    if (!config || lineItem.optionSelectionsJson) return;
    if (Object.keys(config.suggestedSelections.selected ?? {}).length === 0) return;
    onChange({
      optionSelectionsJson: config.suggestedSelections,
      pbv2TreeVersionId: config.activeTreeVersionId,
      pbv2OptionSuggestions: config.suggestions,
    });
  }, [config, lineItem.optionSelectionsJson, onChange]);

  if (!productId) return null;
  if (query.isLoading) {
    return <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Loading product options...</div>;
  }
  if (query.isError) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Product options could not be loaded.</div>;
  }
  if (!config?.treeJson) {
    return <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">No active PBV2 options found for selected product.</div>;
  }

  const missing = getMissingInboundPbv2RequiredOptions(config.treeJson, selections);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Product options</div>
        {showDiagnostics && config.suggestions.length > 0 && <Badge variant="outline">{config.suggestions.length} suggested</Badge>}
      </div>
      {showDiagnostics && config.suggestions.length > 0 && (
        <div className="space-y-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
          <div className="font-semibold text-blue-100">Latest Parse Suggestions</div>
          {config.suggestions.map((suggestion) => (
            <div key={`${suggestion.selectionKey}-${String(suggestion.value)}`} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{selectionSourceLabel(suggestion.source, null, suggestion.origin)}</Badge>
              <span>{suggestion.label}: {suggestion.choiceLabel}</span>
              {suggestion.evidence && <span className="text-blue-100/80">Evidence: "{suggestion.evidence}"</span>}
              {suggestion.conflictsWithDefault && suggestion.defaultChoiceLabel && (
                <span className="text-amber-200">Default was {suggestion.defaultChoiceLabel}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Missing required options: {missing.map((option) => option.label).join(", ")}
        </div>
      )}
      <ProductOptionsPanelV2
        tree={config.treeJson}
        selections={selections}
        persistAutomaticSelections={false}
        onUserEdit={() => {
          userEditedPbv2Ref.current = true;
        }}
        onSelectionsChange={(next) => {
          const marked = userEditedPbv2Ref.current
            ? markChangedPbv2SelectionsAsStaffSelected(next, selections)
            : next;
          userEditedPbv2Ref.current = false;
          onChange({
            optionSelectionsJson: marked,
            pbv2TreeVersionId: config.activeTreeVersionId,
            pbv2OptionSuggestions: config.suggestions,
          });
        }}
      />
      {showDiagnostics && Object.entries(selections.selected ?? {}).length > 0 && (
        <div className="space-y-1 text-xs">
          <div className="font-semibold text-muted-foreground">Current Draft Selections</div>
          <div className="flex flex-wrap gap-2">
          {Object.entries(selections.selected).map(([key, entry]) => (
            <Badge key={key} variant="secondary">
              {key}: {selectionSourceLabel(null, entry?.note, entry?.origin)}
              {entry?.evidence ? ` - "${entry.evidence}"` : ""}
            </Badge>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InboundLinePricingControl({
  lineItem,
  onChange,
}: {
  lineItem: ReviewDraftFormState["reviewedLineItemsJson"][number];
  onChange: (patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => void;
}) {
  const pricingDependencyKey = useMemo(() => inboundLinePricingDependencyKey(lineItem), [lineItem]);
  const latestPricingKeyRef = useRef(pricingDependencyKey);
  const lastAutoPricingKeyRef = useRef<string | null>(null);
  latestPricingKeyRef.current = pricingDependencyKey;
  const pricingCalculationReady = Boolean(lineItem.selectedProductId && lineItem.quantity);
  const pricingNeedsCalculation = pricingCalculationReady && (
    !lineItem.pricingReviewJson
    || lineItem.pricingReviewJson.message === "Pricing needs recalculation."
    || (
      lineItem.pricingReviewJson.systemPriceCents == null
      && lineItem.pricingReviewJson.priceOverrideMode == null
      && lineItem.pricingReviewJson.message == null
    )
  );
  const priceLineMutation = useMutation({
    mutationFn: ({ requestLineItem }: {
      requestKey: string;
      requestLineItem: ReviewDraftFormState["reviewedLineItemsJson"][number];
    }) => postJson<ClientInboundReviewLinePricingResponse>("/api/inbound-orders/review-line-pricing", { lineItem: requestLineItem }),
    onSuccess: (response, variables) => {
      if (variables.requestKey !== latestPricingKeyRef.current) return;
      onChange({ pricingReviewJson: response.data.pricingReviewJson });
    },
    onError: (error: Error, variables) => {
      if (variables.requestKey !== latestPricingKeyRef.current) return;
      onChange({
        pricingReviewJson: {
          ...markInboundLinePricingNeedsRecalculation(lineItem.pricingReviewJson, lineItem.quantity),
          message: error.message || "Pricing calculation failed. Retry after checking product requirements.",
          evaluatedAt: new Date().toISOString(),
        },
      });
    },
  });
  const requestPriceRecalculation = useCallback((mode: "auto" | "manual" = "manual") => {
    if (!pricingCalculationReady) return;
    if (mode === "auto" && lastAutoPricingKeyRef.current === pricingDependencyKey) return;
    if (mode === "auto") lastAutoPricingKeyRef.current = pricingDependencyKey;
    priceLineMutation.mutate({ requestKey: pricingDependencyKey, requestLineItem: lineItem });
  }, [lineItem, priceLineMutation, pricingCalculationReady, pricingDependencyKey]);
  useEffect(() => {
    if (!pricingNeedsCalculation) return;
    const handle = window.setTimeout(() => requestPriceRecalculation("auto"), 350);
    return () => window.clearTimeout(handle);
  }, [pricingNeedsCalculation, requestPriceRecalculation]);

  return (
    <PricingReviewCard
      review={lineItem.pricingReviewJson}
      quantity={lineItem.quantity}
      isCalculating={priceLineMutation.isPending}
      canRecalculate={pricingCalculationReady}
      missingRequirement={!lineItem.selectedProductId
        ? "Select a catalog product before calculating price."
        : !lineItem.quantity
          ? "Enter a valid quantity before calculating price."
          : null}
      onRecalculate={() => requestPriceRecalculation("manual")}
      onChange={(pricingReviewJson) => onChange({ pricingReviewJson })}
    />
  );
}

function PricingReviewCard({
  review,
  quantity: quantityValue,
  isCalculating = false,
  canRecalculate = false,
  missingRequirement = null,
  onRecalculate,
  onChange,
}: {
  review: ReviewDraftFormState["reviewedLineItemsJson"][number]["pricingReviewJson"];
  quantity: number | null;
  isCalculating?: boolean;
  canRecalculate?: boolean;
  missingRequirement?: string | null;
  onRecalculate?: () => void;
  onChange: (review: NonNullable<ReviewDraftFormState["reviewedLineItemsJson"][number]["pricingReviewJson"]>) => void;
}) {
  if (!review) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-foreground">Pricing review</div>
            <div className="mt-1">{missingRequirement ?? (isCalculating ? "Calculating product price..." : "Product pricing has not been calculated.")}</div>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={!canRecalculate || isCalculating} onClick={onRecalculate}>
            {isCalculating ? "Calculating..." : "Calculate price"}
          </Button>
        </div>
      </div>
    );
  }
  const initialOverrideCents = review?.priceOverrideValueCents ?? null;
  const overrideInputRef = useRef<HTMLInputElement>(null);
  const overrideCentsRef = useRef<number | null>(initialOverrideCents);
  const [overrideMode, setOverrideMode] = useState<InboundPriceOverrideMode | null>(review?.priceOverrideMode ?? null);
  const [overrideAmountText, setOverrideAmountText] = useState(() => (
    initialOverrideCents != null && initialOverrideCents > 0
      ? (initialOverrideCents / 100).toFixed(2)
      : ""
  ));
  useEffect(() => {
    const nextCents = review?.priceOverrideValueCents ?? null;
    if (overrideCentsRef.current === nextCents) return;
    overrideCentsRef.current = nextCents;
    if (document.activeElement !== overrideInputRef.current) {
      setOverrideAmountText(nextCents != null && nextCents > 0 ? (nextCents / 100).toFixed(2) : "");
    }
  }, [review?.priceOverrideValueCents]);
  useEffect(() => {
    setOverrideMode(review?.priceOverrideMode ?? null);
  }, [review?.priceOverrideMode]);
  if (!review) return null;
  const quantity = Math.max(1, quantityValue ?? 1);
  const effective = resolveInboundLineEffectivePricing(review, quantity);
  const poSuggestion = getInboundPoPriceSuggestion(review);
  const detectedPoTotalCents = review.poExtendedPriceCents
    ?? review.poTotalPriceCents
    ?? (review.comparisonType !== "unit" ? review.poPriceCents : null);
  const hasMismatch = review.status === "mismatch" || review.status === "resolved";
  const difference = review.differenceCents;
  const overrideLabel = effective.hasPriceOverride
    ? review.priceOverrideSource === "po"
      ? "PO override"
      : "Staff override"
    : "System price";
  const applyChange = (next: typeof review) => {
    const nextEffective = resolveInboundLineEffectivePricing(next, quantity);
    onChange({
      ...next,
      effectiveUnitPriceCents: nextEffective.effectiveUnitPriceCents,
      effectiveTotalCents: nextEffective.effectiveTotalCents,
    });
  };
  const clearOverride = () => applyChange({
    ...review,
    status: hasMismatch ? "resolved" : review.status,
    acknowledged: hasMismatch,
    resolution: hasMismatch ? "accept_system_price" : null,
    priceOverrideMode: null,
    priceOverrideValueCents: null,
    priceOverrideSource: null,
  });
  const applyPoSuggestion = () => {
    if (!poSuggestion) return;
    setOverrideMode(poSuggestion.mode);
    overrideCentsRef.current = poSuggestion.valueCents;
    setOverrideAmountText((poSuggestion.valueCents / 100).toFixed(2));
    applyChange({
      ...review,
      status: hasMismatch ? "resolved" : review.status,
      acknowledged: true,
      resolution: "honor_po_price",
      priceOverrideMode: poSuggestion.mode,
      priceOverrideValueCents: poSuggestion.valueCents,
      priceOverrideSource: "po",
    });
  };
  return (
    <div className={cn(
      "rounded-md border px-3 py-2 text-xs",
      hasMismatch
        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
        : review.status === "matched"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : "border-border bg-muted/20 text-foreground",
    )}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-foreground">
          Pricing review
        </div>
        <div className="flex items-center gap-2">
          {isCalculating ? <Badge variant="outline">Calculating</Badge> : null}
          <Badge variant={effective.hasPriceOverride ? "default" : "outline"}>{overrideLabel}</Badge>
          {review.acknowledged ? <Badge variant="outline">Acknowledged</Badge> : null}
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">Calculated</span>
          <div className="font-mono text-foreground">
            {formatCents(review.systemUnitPriceCents)} / ea · {formatCents(review.systemPriceCents)} total
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Detected PO</span>
          <div className="font-mono text-foreground">
            {review.poUnitPriceCents != null ? `${formatCents(review.poUnitPriceCents)} / ea` : "—"}
            {detectedPoTotalCents != null
              ? ` · ${formatCents(detectedPoTotalCents)} total`
              : ""}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Effective</span>
          <div className="font-mono font-semibold text-foreground" data-testid="inbound-effective-price">
            {formatCents(effective.effectiveUnitPriceCents)} / ea · {formatCents(effective.effectiveTotalCents)} total
          </div>
        </div>
      </div>
      {review.status === "not_available" && effective.effectiveTotalCents <= 0 ? (
        <div className="mt-2 text-amber-600 dark:text-amber-300">
          {review.message ? `System pricing error: ${review.message} ` : "System pricing is unavailable. "}
          Enter a unit or total override before conversion.
        </div>
      ) : null}
      {missingRequirement ? (
        <div className="mt-2 text-amber-600 dark:text-amber-300">{missingRequirement}</div>
      ) : null}
      {hasMismatch ? (
        <div className="mt-2 text-amber-700 dark:text-amber-200">
          PO price differs from system price{difference == null ? "." : ` by ${formatCents(Math.abs(difference))}.`}
        </div>
      ) : review.status === "matched" ? (
        <div className="mt-2 text-emerald-700 dark:text-emerald-200">PO price matches system price.</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground">
        {review.comparisonType ? <span>Compared {review.comparisonType} price</span> : null}
        {review.poRushFeesCents != null ? <span>Rush fee {formatCents(review.poRushFeesCents)}</span> : null}
      </div>
      {review.sourceEvidence.length > 0 && (
        <div className="mt-2 text-muted-foreground">
          Source evidence: {review.sourceEvidence.slice(0, 3).join("; ")}
        </div>
      )}
      {review.alternatePricingNotes.length > 0 && (
        <div className="mt-1 text-muted-foreground">Notes: {review.alternatePricingNotes.join("; ")}</div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[190px_180px_1fr]">
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          aria-label="Inbound price override mode"
          value={overrideMode ?? ""}
          onChange={(event) => {
            const mode = (trimToNull(event.target.value) as InboundPriceOverrideMode | null);
            if (!mode) {
              setOverrideMode(null);
              overrideCentsRef.current = null;
              setOverrideAmountText("");
              clearOverride();
              return;
            }
            setOverrideMode(mode);
            const suggestedValue = poSuggestion?.mode === mode ? poSuggestion.valueCents : null;
            const nextValueCents = overrideMode === mode
              ? review.priceOverrideValueCents
              : suggestedValue;
            overrideCentsRef.current = nextValueCents;
            setOverrideAmountText(nextValueCents != null && nextValueCents > 0 ? (nextValueCents / 100).toFixed(2) : "");
            applyChange({
              ...review,
              priceOverrideMode: mode,
              priceOverrideValueCents: nextValueCents,
              priceOverrideSource: "staff",
              resolution: "pricing_exception",
              acknowledged: Boolean(suggestedValue && suggestedValue > 0),
              status: hasMismatch && suggestedValue ? "resolved" : review.status,
            });
          }}
        >
          <option value="">No override · use system price</option>
          <option value="override_unit_after_margin">Unit price override</option>
          <option value="override_total_after_margin">Total price override</option>
        </select>
        <Input
          ref={overrideInputRef}
          aria-label="Inbound price override amount"
          type="number"
          min="0"
          step="0.01"
          disabled={!overrideMode}
          value={overrideAmountText}
          onChange={(event) => {
            const nextText = event.target.value;
            setOverrideAmountText(nextText);
            const value = trimToNull(nextText);
            const parsedValue = value == null ? null : Number(value);
            const valueCents = parsedValue == null || !Number.isFinite(parsedValue)
              ? null
              : Math.max(0, Math.round(parsedValue * 100));
            overrideCentsRef.current = valueCents;
            applyChange({
              ...review,
              priceOverrideValueCents: valueCents,
              priceOverrideSource: "staff",
              resolution: "pricing_exception",
              acknowledged: valueCents !== null && valueCents > 0,
              status: hasMismatch && valueCents !== null && valueCents > 0 ? "resolved" : review.status,
            });
          }}
          onBlur={() => {
            const valueCents = overrideCentsRef.current;
            setOverrideAmountText(valueCents != null && valueCents > 0 ? (valueCents / 100).toFixed(2) : "");
          }}
          placeholder="0.00"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!canRecalculate || isCalculating} onClick={onRecalculate}>
            {isCalculating ? "Calculating..." : "Recalculate"}
          </Button>
          {poSuggestion ? (
            <Button type="button" size="sm" variant="outline" onClick={applyPoSuggestion}>
              Apply detected PO price
            </Button>
          ) : null}
        </div>
      </div>
      {hasMismatch && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[190px_1fr]">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            aria-label="Resolve PO price mismatch"
            value={review.resolution ?? ""}
            onChange={(event) => {
              const resolution = trimToNull(event.target.value) as NonNullable<typeof review>["resolution"];
              if (resolution === "honor_po_price") {
                applyPoSuggestion();
                return;
              }
              const next = {
                ...review,
                status: resolution ? "resolved" as const : "mismatch" as const,
                acknowledged: Boolean(resolution),
                resolution,
              };
              if (resolution === "accept_system_price") {
                applyChange({
                  ...next,
                  priceOverrideMode: null,
                  priceOverrideValueCents: null,
                  priceOverrideSource: null,
                });
                return;
              }
              applyChange(next);
            }}
          >
            <option value="">Resolve pricing...</option>
            <option value="accept_system_price">Accept system price</option>
            <option value="honor_po_price">Honor PO price</option>
            <option value="pricing_exception">Pricing exception</option>
          </select>
          <Input
            aria-label="Pricing resolution note"
            value={review.resolutionNote ?? ""}
            onChange={(event) => onChange({ ...review, resolutionNote: trimToNull(event.target.value) })}
            placeholder="Pricing note"
          />
        </div>
      )}
    </div>
  );
}

function DraftBuilderPanel({
  mode = "debug",
  selectedRecord,
  detail,
  isLoading,
  draftPreview,
  reviewDraft,
  previewError,
  reviewDraftError,
  isSaving,
  isMarkingReady,
  isReopening,
  isRefreshingFromLatestParse,
  isConverting,
  saveError,
  markReadyError,
  convertError,
  parseDisabled = false,
  isParsing = false,
  onSave,
  onMarkReady,
  onReopen,
  onRefreshFromLatestParse,
  onConvert,
  onParse,
  isRejecting = false,
  isCleaningUp = false,
  rejectDisabled = false,
  onReject,
  onQueueAction,
  onDirtyChange,
}: {
  mode?: InboundReviewWorkspaceMode;
  selectedRecord: ClientInboundOrderRecord | null;
  detail: ClientInboundOrderDetailResponse["data"] | undefined;
  isLoading: boolean;
  draftPreview: ClientInboundOrderDraftPreviewResponse["data"] | undefined;
  reviewDraft: InboundOrderReviewDraftDto | undefined;
  previewError: Error | null;
  reviewDraftError: Error | null;
  isSaving: boolean;
  isMarkingReady: boolean;
  isReopening: boolean;
  isRefreshingFromLatestParse: boolean;
  isConverting: boolean;
  saveError: Error | null;
  markReadyError: (Error & { errors?: string[] }) | null;
  convertError: (Error & { errors?: string[] }) | null;
  parseDisabled?: boolean;
  isParsing?: boolean;
  onSave: (draft: ReviewDraftFormState) => Promise<void>;
  onMarkReady: (draft: ReviewDraftFormState, dirty: boolean) => Promise<void>;
  onReopen: () => Promise<void>;
  onRefreshFromLatestParse: () => Promise<void>;
  onConvert: (attempt: DraftOrderConversionAttempt) => Promise<void>;
  onParse?: () => void;
  isRejecting?: boolean;
  isCleaningUp?: boolean;
  rejectDisabled?: boolean;
  onReject?: () => void;
  onQueueAction?: (action: InboundQueueCleanupAction) => void;
  onDirtyChange: (recordId: string | null, dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ReviewDraftFormState | null>(null);
  const [baseForm, setBaseForm] = useState<ReviewDraftFormState | null>(null);
  const [reviewNotesExpanded, setReviewNotesExpanded] = useState(false);
  const [customerIntelligenceExpanded, setCustomerIntelligenceExpanded] = useState(false);
  const [customerEditorExpanded, setCustomerEditorExpanded] = useState(false);
  const [orderNotesExpanded, setOrderNotesExpanded] = useState(false);
  const [expandedOperationalLineItems, setExpandedOperationalLineItems] = useState<Set<number>>(() => new Set());
  const lastReportedDirtyRef = useRef<{ recordId: string | null; dirty: boolean } | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    if (!reviewDraft) {
      setForm(null);
      setBaseForm(null);
      return;
    }
    const next = cloneReviewDraft(reviewDraft);
    setForm(next);
    setBaseForm(next);
  }, [reviewDraft?.snapshotId, reviewDraft?.updatedAt, reviewDraft?.status]);

  useEffect(() => {
    setCustomerSearch("");
    setContactSearch("");
    setProductSearch("");
    setExpandedOperationalLineItems(new Set());
    setCustomerEditorExpanded(false);
    setOrderNotesExpanded(false);
  }, [selectedRecord?.id]);

  const draftForSelectors = draftPreview?.draft ?? null;
  const selectedCustomerId = form?.reviewedCustomerJson.selectedCustomerId ?? null;
  const customerSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/customer-search", customerSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (customerSearch.trim()) params.set("search", customerSearch.trim());
      return readJson<InboundCustomerSearchResponse>(`/api/inbound-orders/customer-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftForSelectors && reviewDraft),
  });
  const contactSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/contact-search", selectedCustomerId, contactSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      if (contactSearch.trim()) params.set("search", contactSearch.trim());
      return readJson<InboundContactSearchResponse>(`/api/inbound-orders/contact-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftForSelectors && reviewDraft && productSearch.trim()),
  });
  const productSearchQuery = useQuery({
    queryKey: ["/api/inbound-orders/product-search", productSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (productSearch.trim()) params.set("search", productSearch.trim());
      return readJson<InboundProductSearchResponse>(`/api/inbound-orders/product-search?${params.toString()}`);
    },
    enabled: Boolean(selectedRecord && draftForSelectors && reviewDraft),
  });
  const dirty = Boolean(form && baseForm && !formStatesEqual(form, baseForm));

  useEffect(() => {
    const recordId = selectedRecord?.id ?? null;
    const previous = lastReportedDirtyRef.current;
    if (previous?.recordId === recordId && previous.dirty === dirty) return;
    lastReportedDirtyRef.current = { recordId, dirty };
    onDirtyChange(recordId, dirty);
  }, [dirty, onDirtyChange, selectedRecord?.id]);

  if (!selectedRecord) {
    return <EmptyPanel title="Order Workstation" detail="Line items and reviewed order details will appear after parsing." />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (previewError || reviewDraftError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Draft review unavailable</AlertTitle>
          <AlertDescription>{previewError?.message ?? reviewDraftError?.message}</AlertDescription>
        </Alert>
        <div className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
          Order creation starts in Phase 4.
        </div>
      </div>
    );
  }

  const draft = draftPreview?.draft ?? null;
  const latestAttempt = draftPreview?.latestAttempt ?? null;

  if (!draft) {
    const evidence = selectedRecord.sourceType === "email" ? getInboundEmailEvidence(selectedRecord) : getManualInboundEvidence(selectedRecord);
    const files = dedupeAttachmentFiles(detail?.files ?? []);
    return (
      <div className="flex h-full min-h-[260px] flex-col justify-center px-5">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-foreground">Parse this email to build an order draft.</div>
              <div className="mt-1 text-sm text-muted-foreground">Order Workstation will appear after parsing.</div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <div><span className="font-medium text-foreground">Sender:</span> {getSenderLabel(selectedRecord)}</div>
                <div><span className="font-medium text-foreground">Subject:</span> {evidence.subject || evidence.reference || "No subject"}</div>
                <div><span className="font-medium text-foreground">Attachments:</span> {files.length}</div>
              </div>
            </div>
          </div>
          {latestAttempt?.status === "failed" && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Last parse failed. Source evidence remains available for retry.
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={onParse} disabled={parseDisabled || !onParse}>
              {isParsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Parse
            </Button>
            <Button type="button" variant="outline" disabled title="Create Order is available after parsing and completing the review.">
              Create Order
            </Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Create Order becomes available after a successful parse and completed review.</div>
        </div>
      </div>
    );
  }

  if (!reviewDraft || !form) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const allWarnings = [
    ...draft.globalWarnings,
    ...draft.customer.warnings,
    ...draft.order.warnings,
    ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
    ...draft.artwork.flatMap((artwork) => artwork.warnings),
  ];
  const customerOptions = mergeReviewOptions(
    draft.customer.customerCandidates.map(candidateToReviewOption),
    (customerSearchQuery.data?.data ?? []).map(customerToReviewOption),
  );
  const contactOptions = mergeReviewOptions(
    draft.customer.contactCandidates.map(candidateToReviewOption),
    (contactSearchQuery.data?.data ?? []).map(contactToReviewOption),
  );
  const productCatalogOptions = (productSearchQuery.data?.data ?? []).map(productToReviewOption);
  const actionPending = isSaving || isMarkingReady || isReopening || isRefreshingFromLatestParse || isConverting;
  const validationErrors = (markReadyError?.errors ?? reviewDraft.validationErrors ?? []).filter((error) => (
    pricingValidationErrorIsStillBlocking(error, form.reviewedLineItemsJson) ?? true
  ));
  const conversionErrors = convertError?.errors ?? [];
  const unsupportedRequests = form.unsupportedRequestsJson ?? [];
  const convertedOrderId = selectedRecord.createdOrderId ?? null;
  const hasConvertedOrder = Boolean(convertedOrderId);
  const draftOrderBlockers = cleanUniqueItems([
    ...validationErrors,
    selectedRecord.status !== "ready" ? "Mark this inbound record ready before creating a draft order." : "",
    reviewDraft.status !== "ready_to_convert" ? "Mark the review draft ready before creating a draft order." : "",
  ]);
  const canCreateDraftOrder = !dirty && draftOrderBlockers.length === 0;
  const updateForm = (patch: Partial<ReviewDraftFormState>) => {
    setForm((current) => current ? { ...current, ...patch } : current);
  };
  const updateCustomer = (patch: Partial<ReviewDraftFormState["reviewedCustomerJson"]>) => {
    updateForm({ reviewedCustomerJson: { ...form.reviewedCustomerJson, ...patch } });
  };
  const updateOrder = (patch: Partial<ReviewDraftFormState["reviewedOrderJson"]>) => {
    updateForm({ reviewedOrderJson: { ...form.reviewedOrderJson, ...patch } });
  };
  const updateLineItem = (index: number, patch: Partial<ReviewDraftFormState["reviewedLineItemsJson"][number]>) => {
    updateForm({
      reviewedLineItemsJson: form.reviewedLineItemsJson.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if (!Object.prototype.hasOwnProperty.call(patch, "pricingReviewJson") && inboundLinePricingDependenciesChanged(item, next)) {
          next.pricingReviewJson = markInboundLinePricingNeedsRecalculation(item.pricingReviewJson, next.quantity);
        }
        return next;
      }),
    });
  };
  const storedAttachmentLinks = dedupeAttachmentFiles(detail?.files ?? []).map((file) => artworkLinkFromInboundFile(file, "staff_selected"));
  const allAttachmentLinks = dedupeAttachmentLinks(Array.from(new Map([
    ...storedAttachmentLinks,
    ...form.reviewedArtworkJson.unassignedAttachments,
    ...form.reviewedLineItemsJson.flatMap((lineItem) => lineItem.artworkLinks),
  ].map((link) => [artworkLinkKey(link), link])).values()));
  const visibleLinkedArtworkKeys = new Set(
    form.reviewedLineItemsJson
      .flatMap((lineItem) => lineItem.artworkLinks)
      .filter((link) => link.source !== "staff_removed")
      .map((link) => artworkLinkKey(link)),
  );
  const unassignedAttachmentLinks = dedupeAttachmentLinks(Array.from(new Map([
    ...form.reviewedArtworkJson.unassignedAttachments,
    ...allAttachmentLinks.filter((link) => !visibleLinkedArtworkKeys.has(artworkLinkKey(link)) && link.source !== "staff_removed"),
  ].map((link) => [artworkLinkKey(link), link])).values()));
  const unassignedArtworkLinks = unassignedAttachmentLinks.filter((link) => classificationForLink(link) === "ARTWORK");
  const attachmentLinkOptions = allAttachmentLinks.filter((link) => (
    link.source !== "staff_removed" && classificationForLink(link) === "ARTWORK"
  ));
  const addArtworkLinkToLineItem = (lineItemIndex: number, link: InboundOrderArtworkLink) => {
    const key = artworkLinkKey(link);
    updateForm({
      reviewedLineItemsJson: form.reviewedLineItemsJson.map((item, index) => {
        if (index !== lineItemIndex) return item;
        return {
          ...item,
          artworkLinks: [
            ...item.artworkLinks.filter((candidate) => artworkLinkKey(candidate) !== key),
            {
              ...link,
              source: "staff_selected",
              confidence: 100,
              reason: "Staff selected artwork attachment for this line item.",
            },
          ],
        };
      }),
      reviewedArtworkJson: {
        ...form.reviewedArtworkJson,
        unassignedAttachments: form.reviewedArtworkJson.unassignedAttachments.filter((candidate) => artworkLinkKey(candidate) !== key),
      },
    });
  };
  const removeArtworkLinkFromLineItem = (lineItemIndex: number, link: InboundOrderArtworkLink) => {
    const key = artworkLinkKey(link);
    updateLineItem(lineItemIndex, {
      artworkLinks: [
        ...form.reviewedLineItemsJson[lineItemIndex].artworkLinks.filter((candidate) => artworkLinkKey(candidate) !== key),
        {
          ...link,
          source: "staff_removed",
          confidence: 100,
          reason: "Staff removed artwork link from this line item.",
        },
      ],
    });
  };
  const overrideAttachmentClassification = (link: InboundOrderArtworkLink, classification: InboundAttachmentClassification) => {
    const key = artworkLinkKey(link);
    const sourceEvidence = getManualInboundEvidence(selectedRecord as any);
    const automaticClassification = automaticClassificationForLink(link);
    const automaticConfidence = link.automaticClassificationConfidence ?? link.classificationConfidence ?? link.confidence ?? null;
    const automaticReasons = link.automaticClassificationReasons?.length
      ? link.automaticClassificationReasons
      : link.classificationReasons ?? [];
    const learningEvidence = {
      inboundRecordId: selectedRecord.id,
      attachmentKey: key,
      attachmentId: link.fileId,
      fileRecordId: link.fileRecordId ?? null,
      senderEmail: sourceEvidence.senderEmail ?? null,
      senderDomain: senderDomainFromEmail(sourceEvidence.senderEmail),
      subject: sourceEvidence.subject ?? null,
      filename: link.filename ?? null,
      extension: fileExtension(link.filename),
      originalAutomaticClassification: automaticClassification,
      correctedManualClassification: classification,
      automaticConfidence,
      automaticReasons,
      capturedAt: new Date().toISOString(),
      userId: null,
      note: "Manual correction captured for future classification learning.",
    };
    const nextLink = (candidate: InboundOrderArtworkLink): InboundOrderArtworkLink => (
      artworkLinkKey(candidate) !== key ? candidate : {
        ...candidate,
        role: attachmentRoleForClassification(classification),
        classification,
        classificationConfidence: 100,
        classificationReasons: [`Staff manually classified as ${attachmentClassificationLabel(classification)}.`],
        classificationSource: "manual_override",
        automaticClassification,
        automaticClassificationConfidence: automaticConfidence,
        automaticClassificationReasons: automaticReasons,
        classificationBreakdown: {
          filename: candidate.classificationBreakdown?.filename ?? [],
          content: candidate.classificationBreakdown?.content ?? [],
          metadata: candidate.classificationBreakdown?.metadata ?? [],
          manual: [
            `Staff manually classified as ${attachmentClassificationLabel(classification)}.`,
            "Manual correction captured for future classification learning.",
          ],
          scores: candidate.classificationBreakdown?.scores ?? {},
        },
        manualOverride: true,
        learningEvidence,
        confidence: 100,
        reason: `Staff manually classified as ${attachmentClassificationLabel(classification)}.`,
      }
    );
    updateForm({
      reviewedLineItemsJson: form.reviewedLineItemsJson.map((item) => ({
        ...item,
        artworkLinks: item.artworkLinks.map(nextLink),
      })),
      reviewedArtworkJson: {
        ...form.reviewedArtworkJson,
        unassignedAttachments: form.reviewedArtworkJson.unassignedAttachments.map(nextLink),
      },
    });
  };
  const moveArtworkLink = (fromLineItemIndex: number, toLineItemIndex: number, link: InboundOrderArtworkLink) => {
    const key = artworkLinkKey(link);
    updateForm({
      reviewedLineItemsJson: form.reviewedLineItemsJson.map((item, index) => {
        if (index === fromLineItemIndex) {
          return {
            ...item,
            artworkLinks: [
              ...item.artworkLinks.filter((candidate) => artworkLinkKey(candidate) !== key),
              {
                ...link,
                source: "staff_removed",
                confidence: 100,
                reason: "Staff moved artwork attachment to another line item.",
              },
            ],
          };
        }
        if (index === toLineItemIndex) {
          return {
            ...item,
            artworkLinks: [
              ...item.artworkLinks.filter((candidate) => artworkLinkKey(candidate) !== key),
              {
                ...link,
                source: "staff_selected",
                confidence: 100,
                reason: "Staff moved artwork attachment to this line item.",
              },
            ],
          };
        }
        return item;
      }),
      reviewedArtworkJson: {
        ...form.reviewedArtworkJson,
        unassignedAttachments: form.reviewedArtworkJson.unassignedAttachments.filter((candidate) => artworkLinkKey(candidate) !== key),
      },
    });
  };
  const addLineItem = () => {
    updateForm({
      reviewedLineItemsJson: [
        ...form.reviewedLineItemsJson,
        createBlankReviewLineItem(form.reviewedLineItemsJson.length),
      ],
    });
  };
  const duplicateLineItem = (index: number) => {
    const copy = cloneManualReviewLineItem(form.reviewedLineItemsJson[index], index + 1);
    updateForm({
      reviewedLineItemsJson: [
        ...form.reviewedLineItemsJson.slice(0, index + 1),
        copy,
        ...form.reviewedLineItemsJson.slice(index + 1),
      ],
    });
  };
  const removeLineItem = (index: number) => {
    updateForm(removeReviewedLineItem(form, index));
  };
  const clearLineItemProduct = (index: number) => {
    updateLineItem(index, {
      productName: null,
      selectedProductId: null,
      selectedProductSource: null,
      interpretedProductId: null,
      interpretedProductReason: null,
      interpretedProductConfidence: null,
      productUnresolved: true,
      materialText: null,
      materialSource: null,
      optionSelectionsJson: null,
      pbv2TreeVersionId: null,
      pbv2OptionSuggestions: [],
    });
  };
  const updateDecision = (index: number, patch: Partial<ReviewDraftFormState["missingDecisionsJson"][number]>) => {
    updateForm({
      missingDecisionsJson: form.missingDecisionsJson.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    });
  };
  const updateWarning = (index: number, patch: Partial<ReviewDraftFormState["warningsJson"][number]>) => {
    updateForm({
      warningsJson: form.warningsJson.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    });
  };
  const isOperationalMode = mode === "operational";
  const reviewIntent = form.reviewedOrderJson.intent ?? "unknown";
  const reviewPriority = form.reviewedOrderJson.priority ?? "normal";
  const unresolvedPricingIssues = form.reviewedLineItemsJson.flatMap((lineItem, index) => (
    lineItem.pricingReviewJson?.status === "mismatch" && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution)
      ? [`Line ${index + 1}: PO price differs from system price.`]
      : []
  ));
  const minimumConversionIssues = [
    !form.reviewedCustomerJson.selectedCustomerId && !form.reviewedCustomerJson.unresolvedCustomer
      ? "Select a customer or mark customer unresolved."
      : null,
    form.reviewedLineItemsJson.length === 0 ? "Add at least one line item." : null,
    ...form.reviewedLineItemsJson.flatMap((lineItem, index) => [
      !lineItem.quantity ? `Line ${index + 1}: enter quantity.` : null,
      !lineItem.selectedProductId && !lineItem.productUnresolved ? `Line ${index + 1}: select a product or mark unresolved.` : null,
    ]),
    ...unresolvedPricingIssues,
    ...validationErrors,
  ].filter(Boolean) as string[];
  const reviewNotesPreview = form.reviewNotes?.trim() ?? "";
  const inboundFiles = dedupeAttachmentFiles(detail?.files ?? []);
  const inboundFileByAttachmentKey = new Map(inboundFiles.map((file) => [artworkLinkKey({ fileId: file.id, fileRecordId: file.fileRecordId ?? null }), file]));
  const attachmentReviewGroups = [
    {
      title: "Artwork",
      links: allAttachmentLinks.filter((link) => classificationForLink(link) === "ARTWORK"),
    },
    {
      title: "Purchase Orders",
      links: allAttachmentLinks.filter((link) => classificationForLink(link) === "PO"),
    },
    {
      title: "Reference / Other",
      links: allAttachmentLinks.filter((link) => {
        const classification = classificationForLink(link);
        return classification === "REFERENCE" || classification === "OTHER";
      }),
    },
    {
      title: "Ignored / Inline Images",
      links: allAttachmentLinks.filter((link) => classificationForLink(link) === "IGNORE_INLINE"),
    },
  ];
  const customerSummaryName = form.reviewedCustomerJson.companyName
    || form.reviewedCustomerJson.sourceName
    || (form.reviewedCustomerJson.unresolvedCustomer ? "Customer unresolved" : "Select customer");
  const contactSummary = form.reviewedCustomerJson.sourceEmail
    || form.reviewedCustomerJson.selectedContactId
    || form.reviewedCustomerJson.selectedCustomerId
    || (form.reviewedCustomerJson.unresolvedContact ? "Contact unresolved" : "No contact selected");
  const customerMatchConfidence = form.reviewedCustomerJson.selectedContactConfidence
    ?? form.reviewedCustomerJson.selectedCustomerConfidence
    ?? null;
  const customerMatchSource = form.reviewedCustomerJson.selectedContactSource
    ?? form.reviewedCustomerJson.selectedCustomerSource
    ?? null;
  const customerNeedsAttention = form.reviewedCustomerJson.unresolvedCustomer || form.reviewedCustomerJson.unresolvedContact;
  const hasOrderNotes = Boolean(form.reviewedOrderJson.customerNotes || form.reviewedOrderJson.internalNotes);

  return (
    <ScrollArea className="h-full">
      <div className={isOperationalMode ? "space-y-2 p-2" : "space-y-4 p-4"}>
        {isOperationalMode ? (
          <span className="sr-only">Phase 4: Create draft order from reviewed inbound record.</span>
        ) : (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Phase 4: Create draft order from reviewed inbound record.</AlertTitle>
            <AlertDescription>
              This creates a real draft order only. It does not release production, create proofs, invoices, fulfillment, or payments.
            </AlertDescription>
          </Alert>
        )}
        {reviewDraft.hasNewerParse && (
          <Alert>
            <RefreshCw className="h-4 w-4" />
            <AlertTitle>Current draft is older than the latest parse.</AlertTitle>
            <AlertDescription>
              Latest Parse Suggestions may differ from Current Draft Selections below. Existing staff edits are preserved until you refresh from the latest parse.
            </AlertDescription>
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { void onRefreshFromLatestParse().catch(() => undefined); }}
                disabled={actionPending}
              >
                {isRefreshingFromLatestParse && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh from Latest Parse
              </Button>
            </div>
          </Alert>
        )}
        {(saveError || markReadyError) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Review draft action failed</AlertTitle>
            <AlertDescription>{(markReadyError ?? saveError)?.message}</AlertDescription>
          </Alert>
        )}
        {convertError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Draft order creation failed</AlertTitle>
            <AlertDescription>{convertError.message}</AlertDescription>
            {conversionErrors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {conversionErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
          </Alert>
        )}

        {isOperationalMode ? (
          <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
            <span className="sr-only">Review Summary</span>
            <span><span className="font-medium text-foreground">Status:</span> {latestAttempt ? titleCase(latestAttempt.status) : "Parsed"}</span>
            <span><span className="font-medium text-foreground">Intent:</span> {titleCase(reviewIntent)}</span>
            <span><span className="font-medium text-foreground">Warnings:</span> {allWarnings.length}</span>
            <span><span className="font-medium text-foreground">Missing:</span> {draft.missingDecisions.length}</span>
            <Badge variant={reviewDraft.status === "ready_to_convert" ? "default" : "outline"} className="h-5 px-1.5 text-[11px]">{titleCase(reviewDraft.status)}</Badge>
            {dirty && <Badge variant="outline" className="h-5 px-1.5 text-[11px]">Unsaved changes</Badge>}
          </section>
        ) : (
          <section className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Parse Summary</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{latestAttempt?.confidence ?? 0}% confidence</Badge>
                <Badge variant={reviewDraft.status === "ready_to_convert" ? "default" : "outline"}>{titleCase(reviewDraft.status)}</Badge>
                {dirty && <Badge variant="outline">Unsaved changes</Badge>}
                <Badge variant="outline">{allWarnings.length} warnings</Badge>
                <Badge variant="outline">{draft.missingDecisions.length} missing decisions</Badge>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <InlineField label="Status" value={latestAttempt ? titleCase(latestAttempt.status) : "Parsed"} />
              <InlineField label="Parsed" value={latestAttempt ? formatTimestamp(latestAttempt.createdAt) : null} />
            </div>
          </section>
        )}

        {!isOperationalMode && (
          <>
            <EvidenceUsedSection draft={draft} detail={detail} />

            <section className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Review Readiness</h3>
                <Badge variant="secondary">{reviewDraft.interpretationConfidence.overall}% overall confidence</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>Customer {reviewDraft.readinessScore.customer}%</span>
                <span>Contact {reviewDraft.readinessScore.contact}%</span>
                <span>Product Confidence {reviewDraft.interpretationConfidence.product}%</span>
                <span>Option Confidence {reviewDraft.interpretationConfidence.options}%</span>
                <span>Artwork {reviewDraft.readinessScore.artwork.label}</span>
              </div>
            </section>

            <CustomerIntelligencePanel intelligence={reviewDraft.customerIntelligenceJson ?? null} />

            <FieldSourceSection draft={draft} />
          </>
        )}

        {isOperationalMode ? (
          <>
            <DocumentMetaCard contentClassName="p-2">
              <div className="space-y-3">
                <details
                  className={cn(
                    "group rounded-md border p-2",
                    customerNeedsAttention ? "border-amber-500/50 bg-amber-500/10" : "border-border/60 bg-muted/20",
                  )}
                  open={customerEditorExpanded || customerNeedsAttention || !(form.reviewedCustomerJson.selectedCustomerId || form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.sourceName)}
                >
                  <summary
                    className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={(event) => {
                      event.preventDefault();
                      if (customerNeedsAttention || !(form.reviewedCustomerJson.selectedCustomerId || form.reviewedCustomerJson.companyName || form.reviewedCustomerJson.sourceName)) return;
                      setCustomerEditorExpanded((current) => !current);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                        customerNeedsAttention ? "border-amber-400/60 bg-amber-500/20 text-amber-100" : "border-emerald-500/40 bg-emerald-500/15 text-emerald-100",
                      )}>
                        {customerNeedsAttention ? "!" : "OK"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Confirmed customer</div>
                        <div className="truncate text-sm font-semibold text-foreground">{customerSummaryName}</div>
                        <div className="truncate text-xs text-muted-foreground">{contactSummary}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {customerMatchSource && (
                        <Badge variant="outline" className="hidden h-6 px-1.5 text-[11px] sm:inline-flex">
                          {customerSelectionIntro(customerMatchSource)}
                          {customerMatchConfidence != null ? ` ${customerMatchConfidence}%` : ""}
                        </Badge>
                      )}
                      <span className="pointer-events-none inline-flex h-7 items-center rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground">
                        Change
                        <ChevronDown className="ml-1 h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                      </span>
                    </div>
                  </summary>
                  <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                  <SearchableReviewSelector
                    label="Selected customer"
                    searchLabel="Customer search"
                    searchPlaceholder="Search all customers"
                    value={form.reviewedCustomerJson.selectedCustomerId}
                    searchValue={customerSearch}
                    options={customerOptions}
                    isLoading={customerSearchQuery.isFetching}
                    onSearchChange={setCustomerSearch}
                    onChange={(customerId) => updateCustomer({
                      selectedCustomerId: customerId,
                      selectedCustomerSource: customerId ? "staff_selected" : null,
                      selectedCustomerReason: customerId ? "Staff selected customer." : null,
                      selectedCustomerConfidence: null,
                      selectedContactId: null,
                      selectedContactSource: null,
                      selectedContactReason: null,
                      selectedContactConfidence: null,
                      unresolvedCustomer: false,
                    })}
                  />
                  <SearchableReviewSelector
                    label="Selected contact"
                    searchLabel="Contact search"
                    searchPlaceholder={form.reviewedCustomerJson.selectedCustomerId ? "Search contacts for selected customer" : "Search all contacts"}
                    value={form.reviewedCustomerJson.selectedContactId}
                    searchValue={contactSearch}
                    options={contactOptions}
                    isLoading={contactSearchQuery.isFetching}
                    onSearchChange={setContactSearch}
                    onChange={(contactId) => updateCustomer({
                      selectedContactId: contactId,
                      selectedContactSource: contactId ? "staff_selected" : null,
                      selectedContactReason: contactId ? "Staff selected contact." : null,
                      selectedContactConfidence: null,
                      unresolvedContact: false,
                    })}
                  />
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-2 text-foreground">
                      <input
                        type="checkbox"
                        checked={form.reviewedCustomerJson.unresolvedCustomer}
                        onChange={(event) => updateCustomer({
                          unresolvedCustomer: event.target.checked,
                          selectedCustomerId: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerId,
                          selectedCustomerSource: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerSource,
                          selectedCustomerReason: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerReason,
                          selectedCustomerConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerConfidence,
                          selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                          selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                          selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                          selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                        })}
                      />
                      Customer unresolved
                    </label>
                    <label className="flex items-center gap-2 text-foreground">
                      <input
                        type="checkbox"
                        checked={form.reviewedCustomerJson.unresolvedContact ?? false}
                        onChange={(event) => updateCustomer({
                          unresolvedContact: event.target.checked,
                          selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                          selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                          selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                          selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                        })}
                      />
                      Contact unresolved
                    </label>
                  </div>
                  </div>
                </details>

                <div className="space-y-2">
                  <OrderEntrySectionTitle title="Order Details" />
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-6">
                    <OrderEntryField label="PO Ref">
                      <Input value={form.reviewedOrderJson.poNumber ?? ""} onChange={(event) => updateOrder({ poNumber: textInputValueToNull(event.target.value) })} />
                    </OrderEntryField>
                    <OrderEntryField label="Due date">
                      <div className="relative">
                        <Input
                          type="date"
                          value={form.reviewedOrderJson.dueDate ?? ""}
                          onChange={(event) => updateOrder({ dueDate: trimToNull(event.target.value) })}
                          className="pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                        />
                        <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </OrderEntryField>
                    <OrderEntryField label="Intent">
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={reviewIntent}
                        onChange={(event) => updateOrder({ intent: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["intent"] })}
                      >
                        <option value="quote">Quote</option>
                        <option value="order">Order</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </OrderEntryField>
                    <OrderEntryField label="Priority">
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={reviewPriority}
                        onChange={(event) => updateOrder({ priority: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["priority"] })}
                      >
                        <option value="rush">Rush</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </OrderEntryField>
                    <OrderEntryField label="Fulfillment">
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedOrderJson.fulfillmentType} onChange={(event) => updateOrder({ fulfillmentType: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["fulfillmentType"] })}>
                        <option value="unknown">Unknown</option>
                        <option value="pickup">Pickup</option>
                        <option value="shipping">Shipping</option>
                      </select>
                    </OrderEntryField>
                    <OrderEntryField label="Carrier">
                      <Input value={form.reviewedOrderJson.shipMethod ?? ""} onChange={(event) => updateOrder({ shipMethod: textInputValueToNull(event.target.value) })} />
                    </OrderEntryField>
                  </div>
                </div>
              </div>
            </DocumentMetaCard>

            <section className="rounded-xl border border-border/60 bg-card/80 shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
                <OrderEntrySectionTitle title="Line Items / Products" count={form.reviewedLineItemsJson.length} />
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={addLineItem} disabled={actionPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add line item
                </Button>
              </div>
              <div className="space-y-2 p-3">
                {form.reviewedLineItemsJson.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No line items in the current review draft. Add a line item to continue manual review.
                  </div>
                ) : (
                  form.reviewedLineItemsJson.map((lineItem, index) => {
                    const parsedLine = draft.lineItems[index];
                    const productOptions = mergeReviewOptions(
                      (parsedLine?.productCandidates ?? []).map(candidateToReviewOption),
                      productCatalogOptions,
                      lineItem.selectedProductId && !(parsedLine?.productCandidates ?? []).some((candidate) => candidate.id === lineItem.selectedProductId)
                        ? [{ id: lineItem.selectedProductId, label: lineItem.productName || lineItem.selectedProductId, description: null }]
                        : [],
                    );
                    const activeArtworkLinks = lineItem.artworkLinks.filter((link) => link.source !== "staff_removed");
                    const dimensionsLabel = lineItem.width && lineItem.height
                      ? `${lineItem.width}x${lineItem.height} ${lineItem.dimensionsUnit ?? ""}`.trim()
                      : null;
                    const optionSummary = [
                      ...lineItem.printSpecs,
                      ...lineItem.optionTexts,
                      ...lineItem.finishingTexts,
                    ].filter(Boolean).slice(0, 3);
                    const pricingNeedsAttention = lineItem.pricingReviewJson?.status === "mismatch"
                      && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution);
                    const requiredFieldsOpen = lineItem.productUnresolved || !lineItem.selectedProductId || !lineItem.quantity || !lineItem.width || !lineItem.height || pricingNeedsAttention;
                    const detailsOpen = requiredFieldsOpen || expandedOperationalLineItems.has(index);
                    return (
                      <div key={index} className="group flex gap-3 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:bg-muted/30">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Production ticket {index + 1}</div>
                              <div className="truncate text-sm font-semibold text-foreground">{lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {lineItem.materialText && <Badge variant="outline" className="py-0 text-[11px]">{lineItem.materialText}</Badge>}
                                {optionSummary.map((spec) => <Badge key={spec} variant="outline" className="py-0 text-[11px]">{spec}</Badge>)}
                                {lineItem.productUnresolved && <Badge variant="destructive" className="py-0 text-[11px]">Product unresolved</Badge>}
                                {pricingNeedsAttention && <Badge variant="outline" className="border-amber-500/60 py-0 text-[11px] text-amber-200">Pricing warning</Badge>}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-1">
                              <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => duplicateLineItem(index)} disabled={actionPending}>
                                <Copy className="mr-1.5 h-4 w-4" />
                                Duplicate
                              </Button>
                              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => removeLineItem(index)} disabled={actionPending}>
                                <Trash2 className="mr-1.5 h-4 w-4" />
                                Remove
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs xl:grid-cols-5">
                            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Product</span>
                              <span className="truncate font-medium text-foreground">{lineItem.selectedProductId ? (lineItem.productName || lineItem.selectedProductId) : "Unselected"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Material</span>
                              <span className="truncate font-medium text-foreground">{lineItem.materialText || "-"}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Size</span>
                              <span className="font-mono">{dimensionsLabel || "-"}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Qty</span>
                              <span className="font-mono">{lineItem.quantity ?? "-"}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">Artwork</span>
                              <span className="font-mono">{activeArtworkLinks.length || "-"}</span>
                            </div>
                          </div>

                          <details
                            className="group/details rounded-md border border-border/60 bg-muted/10"
                            open={detailsOpen}
                          >
                            <summary
                              className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              onClick={(event) => {
                                event.preventDefault();
                                if (requiredFieldsOpen) return;
                                setExpandedOperationalLineItems((current) => {
                                  const next = new Set(current);
                                  if (next.has(index)) {
                                    next.delete(index);
                                  } else {
                                    next.add(index);
                                  }
                                  return next;
                                });
                              }}
                            >
                              <span>{requiredFieldsOpen ? "Edit required details" : "Edit details"}</span>
                              <ChevronDown className="h-4 w-4 transition-transform group-open/details:rotate-180" />
                            </summary>
                            <div className="space-y-3 border-t border-border/60 p-3">
                          <div className="grid gap-2 lg:grid-cols-2">
                            <OrderEntryField label="Product">
                              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={lineItem.selectedProductId ?? ""} onChange={(event) => {
                                const productId = trimToNull(event.target.value);
                                const selectedOption = productOptions.find((option) => option.id === productId);
                                updateLineItem(index, {
                                  productName: productId ? selectedOption?.label ?? lineItem.productName : null,
                                  selectedProductId: productId,
                                  selectedProductSource: productId ? "staff_selected" : null,
                                  interpretedProductId: null,
                                  interpretedProductReason: productId ? "Staff selected product from active catalog. AI candidate ranking is advisory." : null,
                                  interpretedProductConfidence: null,
                                  productUnresolved: !productId,
                                  optionSelectionsJson: null,
                                  pbv2TreeVersionId: null,
                                  pbv2OptionSuggestions: [],
                                });
                              }}>
                                <option value="">Unselected</option>
                                {productSearchQuery.isFetching && <option value="" disabled>Searching catalog...</option>}
                                {productOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                              </select>
                            </OrderEntryField>
                            <OrderEntryField label="Search active catalog products">
                              <Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search product catalog" />
                            </OrderEntryField>
                            <OrderEntryField label="Material">
                              <Input value={lineItem.materialText ?? ""} onChange={(event) => updateLineItem(index, { materialText: trimToNull(event.target.value), materialSource: "staff_selected" })} />
                            </OrderEntryField>
                            <OrderEntryField label="Quantity">
                              <Input value={lineItem.quantity ?? ""} onChange={(event) => updateLineItem(index, { quantity: optionalNumber(event.target.value), quantitySource: "staff_selected" })} />
                            </OrderEntryField>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={lineItem.productUnresolved} onChange={(event) => updateLineItem(index, { productUnresolved: event.target.checked })} />
                            Product unresolved
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            <OrderEntryField label="Width">
                              <Input value={lineItem.width ?? ""} onChange={(event) => updateLineItem(index, { width: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} />
                            </OrderEntryField>
                            <OrderEntryField label="Height">
                              <Input value={lineItem.height ?? ""} onChange={(event) => updateLineItem(index, { height: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} />
                            </OrderEntryField>
                            <OrderEntryField label="Unit">
                              <Input value={lineItem.dimensionsUnit ?? ""} onChange={(event) => updateLineItem(index, { dimensionsUnit: trimToNull(event.target.value), dimensionsSource: "staff_selected" })} />
                            </OrderEntryField>
                          </div>
                          <ReviewLineItemProductOptions lineItem={lineItem} index={index} showDiagnostics={false} onChange={(patch) => updateLineItem(index, patch)} />
                          <InboundLinePricingControl
                            lineItem={lineItem}
                            onChange={(patch) => updateLineItem(index, patch)}
                          />
                          <div className="grid gap-2 lg:grid-cols-3">
                            <OrderEntryField label="Print specs">
                              <Input value={lineItem.printSpecs.join(", ")} onChange={(event) => updateLineItem(index, { printSpecs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), printSpecsSource: "staff_selected" })} />
                            </OrderEntryField>
                            <OrderEntryField label="Options">
                              <Input value={lineItem.optionTexts.join(", ")} onChange={(event) => updateLineItem(index, { optionTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), optionTextsSource: "staff_selected" })} />
                            </OrderEntryField>
                            <OrderEntryField label="Finishing">
                              <Input value={lineItem.finishingTexts.join(", ")} onChange={(event) => updateLineItem(index, { finishingTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), finishingTextsSource: "staff_selected" })} />
                            </OrderEntryField>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <Paperclip className="h-4 w-4" />
                                Artwork links
                              </div>
                              <select
                                className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                aria-label={`Attach artwork to line item ${index + 1}`}
                                value=""
                                onChange={(event) => {
                                  const selected = attachmentLinkOptions.find((link) => artworkLinkKey(link) === event.target.value);
                                  if (selected) addArtworkLinkToLineItem(index, selected);
                                }}
                                disabled={actionPending || attachmentLinkOptions.length === 0}
                              >
                                <option value="">Attach stored file...</option>
                                {attachmentLinkOptions.map((link) => (
                                  <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>{link.filename || link.fileId}</option>
                                ))}
                              </select>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {activeArtworkLinks.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No artwork linked.</span>
                              ) : activeArtworkLinks.map((link) => (
                                <Badge key={artworkLinkKey(link)} variant="secondary" className="gap-1">
                                  {link.filename || link.fileId}
                                  <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => removeArtworkLinkFromLineItem(index, link)} aria-label={`Remove ${link.filename || link.fileId}`}>
                                    <XCircle className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <OrderEntryField label="Line item notes">
                            <Textarea className="min-h-[60px]" value={lineItem.notes ?? ""} onChange={(event) => updateLineItem(index, { notes: textInputValueToNull(event.target.value) })} />
                          </OrderEntryField>
                            </div>
                          </details>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <DocumentMetaCard contentClassName="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <OrderEntrySectionTitle title="Notes" />
                {!hasOrderNotes && <Badge variant="outline">Empty</Badge>}
              </div>
              <details className="mt-3 rounded-md border border-border/60 bg-muted/20" open={orderNotesExpanded || hasOrderNotes}>
                <summary
                  className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    if (hasOrderNotes) return;
                    setOrderNotesExpanded((current) => !current);
                  }}
                >
                  {hasOrderNotes ? "Review production and internal notes" : "Add production or internal notes"}
                </summary>
                <div className="grid gap-2 border-t border-border/60 p-3 sm:grid-cols-2">
                  <OrderEntryField label="Production Notes">
                    <Textarea className="min-h-[76px]" value={form.reviewedOrderJson.customerNotes ?? ""} onChange={(event) => updateOrder({ customerNotes: textInputValueToNull(event.target.value) })} />
                  </OrderEntryField>
                  <OrderEntryField label="Internal Notes">
                    <Textarea className="min-h-[76px]" value={form.reviewedOrderJson.internalNotes ?? ""} onChange={(event) => updateOrder({ internalNotes: textInputValueToNull(event.target.value) })} />
                  </OrderEntryField>
                </div>
              </details>
            </DocumentMetaCard>

            <DocumentMetaCard contentClassName="p-3">
              <OrderEntrySectionTitle title="Attachments" count={inboundFiles.length} />
              <div className="mt-3 grid gap-3 xl:grid-cols-4">
                {attachmentReviewGroups.map((group) => (
                  <div key={group.title} className="rounded-md border border-border/60 bg-background/40 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</div>
                      <Badge variant="outline">{group.links.length}</Badge>
                    </div>
                    <div className="space-y-1.5">
                      {group.links.length === 0 ? (
                        <div className="text-xs text-muted-foreground">None</div>
                      ) : group.links.map((link) => {
                        const key = artworkLinkKey(link);
                        const file = inboundFileByAttachmentKey.get(key);
                        const downloadUrl = file && selectedRecord ? inboundFileDownloadUrl(selectedRecord.id, file) : null;
                        const confidence = classificationConfidenceForLink(link);
                        return (
                          <div key={key} className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
                            <div className="truncate text-xs font-medium text-foreground">{link.filename || "Attachment"}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {attachmentClassificationLabel(classificationForLink(link))}
                              {confidence != null ? ` · ${confidence}%` : ""}
                              {link.manualOverride ? " · Manual" : ""}
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">Reasons: {classificationReasonText(link)}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{formatFileSize(link.sizeBytes)}</span>
                              <span>{link.mimeType || "unknown"}</span>
                              {downloadUrl && (
                                <a className="text-primary underline" href={downloadUrl} target="_blank" rel="noreferrer">Open</a>
                              )}
                            </div>
                            <select
                              className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                              aria-label={`Classify ${link.filename || link.fileId}`}
                              value={classificationForLink(link)}
                              onChange={(event) => overrideAttachmentClassification(link, event.target.value as InboundAttachmentClassification)}
                              disabled={actionPending}
                            >
                              <option value="ARTWORK">Artwork</option>
                              <option value="PO">Purchase Order</option>
                              <option value="REFERENCE">Reference</option>
                              <option value="IGNORE_INLINE">Junk / Signature</option>
                              <option value="OTHER">Ignore</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unassigned Attachments</div>
                  <Badge variant="outline">{unassignedArtworkLinks.length}</Badge>
                </div>
                <div className="mt-2 space-y-2">
                  {unassignedArtworkLinks.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No unassigned artwork candidates.</div>
                  ) : unassignedArtworkLinks.map((link) => (
                    <div key={artworkLinkKey(link)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{link.filename || link.fileId}</div>
                        <div className="text-xs text-muted-foreground">{describeArtworkLink(link)}</div>
                      </div>
                      <select
                        className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                        aria-label={`Assign ${link.filename || link.fileId} to line item`}
                        value=""
                        onChange={(event) => {
                          const targetIndex = Number(event.target.value);
                          if (Number.isInteger(targetIndex) && targetIndex >= 0) addArtworkLinkToLineItem(targetIndex, link);
                        }}
                        disabled={actionPending || form.reviewedLineItemsJson.length === 0}
                      >
                        <option value="">Assign to line...</option>
                        {form.reviewedLineItemsJson.map((lineItem, lineItemIndex) => (
                          <option key={lineItemIndex} value={lineItemIndex}>Line {lineItemIndex + 1}: {lineItem.productName || lineItem.sourceText || "Untitled"}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr]">
                  <OrderEntryField label="Artwork status">
                    <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedArtworkJson.status} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, status: event.target.value as ReviewDraftFormState["reviewedArtworkJson"]["status"] } })}>
                      <option value="supplied">Supplied</option>
                      <option value="to_follow">Bypass artwork for order (artwork to follow)</option>
                      <option value="missing">Missing</option>
                      <option value="not_required">Not required</option>
                    </select>
                  </OrderEntryField>
                  <OrderEntryField label="Artwork notes">
                    <Input value={form.reviewedArtworkJson.notes ?? ""} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, notes: trimToNull(event.target.value) } })} />
                  </OrderEntryField>
                </div>
              </div>
              <span className="sr-only">Artwork / References</span>
            </DocumentMetaCard>

            {(unsupportedRequests.length > 0 || form.missingDecisionsJson.length > 0 || form.warningsJson.length > 0) && (
              <DocumentMetaCard contentClassName="p-3">
                <OrderEntrySectionTitle title="Review Tasks" count={unsupportedRequests.length + form.missingDecisionsJson.length + form.warningsJson.length} />
                <div className="mt-3 grid gap-2">
                  <div className={cn("space-y-2", unsupportedRequests.length === 0 && "hidden")}>
                      {unsupportedRequests.length === 0 ? (
                        <div className="text-xs text-muted-foreground">None</div>
                      ) : unsupportedRequests.map((finding, index) => (
                        <div key={`${finding.category}-${index}`} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-foreground">{finding.requestedText || "Unsupported request"}</div>
                            <Badge variant="outline">Review Required</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{finding.reason}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{finding.suggestedAction}</div>
                        </div>
                      ))}
                  </div>
                  <div className={cn("space-y-2", form.missingDecisionsJson.length === 0 && "hidden")}>
                      {form.missingDecisionsJson.length === 0 ? (
                        <div className="text-xs text-muted-foreground">None</div>
                      ) : form.missingDecisionsJson.map((decision, index) => (
                        <div key={decision.field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-foreground">
                              {`${decision.field} ${decision.label}`.toLowerCase().includes("artwork") ? "Artwork Missing" : decision.label}
                            </div>
                            <Badge variant={decision.severity === "blocking" ? "destructive" : "outline"}>{titleCase(decision.severity)}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{decision.reason}</div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[160px_1fr]">
                            <select className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={decision.status} onChange={(event) => updateDecision(index, { status: event.target.value as ReviewDraftFormState["missingDecisionsJson"][number]["status"] })}>
                              <option value="resolved">Resolved</option>
                              <option value="acknowledged">Acknowledged</option>
                              <option value="still_blocking">Still blocking</option>
                            </select>
                            <Input value={decision.resolutionNote ?? ""} onChange={(event) => updateDecision(index, { resolutionNote: trimToNull(event.target.value) })} placeholder="Resolution note" />
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className={cn("space-y-2", form.warningsJson.length === 0 && "hidden")}>
                      {form.warningsJson.length === 0 ? (
                        <div className="text-xs text-muted-foreground">None</div>
                      ) : form.warningsJson.map((warning, index) => (
                        <div key={`${warning.code}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                          <div className="text-sm font-semibold text-foreground">{titleCase(warning.code.replaceAll("_", " "))}</div>
                          <div className="text-xs text-muted-foreground">{warning.message}</div>
                          <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={warning.acknowledged} onChange={(event) => updateWarning(index, { acknowledged: event.target.checked })} />
                            Acknowledged
                          </label>
                        </div>
                      ))}
                  </div>
                </div>
              </DocumentMetaCard>
            )}

            {reviewDraft.customerIntelligenceJson && (
              <DocumentMetaCard contentClassName="p-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground"
                  onClick={() => setCustomerIntelligenceExpanded((current) => !current)}
                  aria-expanded={customerIntelligenceExpanded}
                >
                  Customer Intelligence
                  <ChevronDown className={cn("h-4 w-4 transition-transform", customerIntelligenceExpanded && "rotate-180")} />
                </button>
                {customerIntelligenceExpanded && (
                  <div className="border-t border-border/60 p-3">
                    <CustomerIntelligencePanel intelligence={reviewDraft.customerIntelligenceJson} />
                  </div>
                )}
              </DocumentMetaCard>
            )}
          </>
        ) : (
          <>
        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Customer</h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Source name
              <Input value={form.reviewedCustomerJson.sourceName ?? ""} onChange={(event) => updateCustomer({ sourceName: trimToNull(event.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Source email
              <Input value={form.reviewedCustomerJson.sourceEmail ?? ""} onChange={(event) => updateCustomer({ sourceEmail: trimToNull(event.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Company
              <Input value={form.reviewedCustomerJson.companyName ?? ""} onChange={(event) => updateCustomer({ companyName: trimToNull(event.target.value) })} />
            </label>
            <SearchableReviewSelector
              label="Selected customer"
              searchLabel="Customer search"
              searchPlaceholder="Search all customers"
              value={form.reviewedCustomerJson.selectedCustomerId}
              searchValue={customerSearch}
              options={customerOptions}
              isLoading={customerSearchQuery.isFetching}
              onSearchChange={setCustomerSearch}
              onChange={(customerId) => updateCustomer({
                selectedCustomerId: customerId,
                selectedCustomerSource: customerId ? "staff_selected" : null,
                selectedCustomerReason: customerId ? "Staff selected customer." : null,
                selectedCustomerConfidence: null,
                selectedContactId: null,
                selectedContactSource: null,
                selectedContactReason: null,
                selectedContactConfidence: null,
                unresolvedCustomer: false,
              })}
            />
            {form.reviewedCustomerJson.selectedCustomerId && form.reviewedCustomerJson.selectedCustomerReason && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{customerSelectionIntro(form.reviewedCustomerJson.selectedCustomerSource)} customer</div>
                <div>
                  {form.reviewedCustomerJson.selectedCustomerReason}
                  {form.reviewedCustomerJson.selectedCustomerConfidence != null ? ` Confidence ${form.reviewedCustomerJson.selectedCustomerConfidence}%.` : ""}
                </div>
              </div>
            )}
            <SearchableReviewSelector
              label="Selected contact"
              searchLabel="Contact search"
              searchPlaceholder={form.reviewedCustomerJson.selectedCustomerId ? "Search contacts for selected customer" : "Search all contacts"}
              value={form.reviewedCustomerJson.selectedContactId}
              searchValue={contactSearch}
              options={contactOptions}
              isLoading={contactSearchQuery.isFetching}
              onSearchChange={setContactSearch}
              onChange={(contactId) => updateCustomer({
                selectedContactId: contactId,
                selectedContactSource: contactId ? "staff_selected" : null,
                selectedContactReason: contactId ? "Staff selected contact." : null,
                selectedContactConfidence: null,
                unresolvedContact: false,
              })}
            />
            {form.reviewedCustomerJson.selectedContactId && form.reviewedCustomerJson.selectedContactReason && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{customerSelectionIntro(form.reviewedCustomerJson.selectedContactSource)} contact</div>
                <div>
                  {form.reviewedCustomerJson.selectedContactReason}
                  {form.reviewedCustomerJson.selectedContactConfidence != null ? ` Confidence ${form.reviewedCustomerJson.selectedContactConfidence}%.` : ""}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.reviewedCustomerJson.unresolvedCustomer}
                onChange={(event) => updateCustomer({
                  unresolvedCustomer: event.target.checked,
                  selectedCustomerId: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerId,
                  selectedCustomerSource: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerSource,
                  selectedCustomerReason: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerReason,
                  selectedCustomerConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedCustomerConfidence,
                  selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                  selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                  selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                  selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                })}
              />
              Customer unresolved
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.reviewedCustomerJson.unresolvedContact ?? false}
                onChange={(event) => updateCustomer({
                  unresolvedContact: event.target.checked,
                  selectedContactId: event.target.checked ? null : form.reviewedCustomerJson.selectedContactId,
                  selectedContactSource: event.target.checked ? null : form.reviewedCustomerJson.selectedContactSource,
                  selectedContactReason: event.target.checked ? null : form.reviewedCustomerJson.selectedContactReason,
                  selectedContactConfidence: event.target.checked ? null : form.reviewedCustomerJson.selectedContactConfidence,
                })}
              />
              Contact unresolved
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Customer review notes
              <Textarea value={form.reviewedCustomerJson.notes ?? ""} onChange={(event) => updateCustomer({ notes: trimToNull(event.target.value) })} />
            </label>
          </div>
          {!isOperationalMode && (
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <CandidateList title="Customers" candidates={draft.customer.customerCandidates} />
              <CandidateList title="Contacts" candidates={draft.customer.contactCandidates} />
            </div>
          )}
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Order Details</h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Quote / order intent
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={reviewIntent}
                onChange={(event) => updateOrder({ intent: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["intent"] })}
              >
                <option value="quote">Quote</option>
                <option value="order">Order</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">PO number<Input value={form.reviewedOrderJson.poNumber ?? ""} onChange={(event) => updateOrder({ poNumber: textInputValueToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Due date<Input type="date" value={form.reviewedOrderJson.dueDate ?? ""} onChange={(event) => updateOrder({ dueDate: trimToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Ship method<Input value={form.reviewedOrderJson.shipMethod ?? ""} onChange={(event) => updateOrder({ shipMethod: textInputValueToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Pickup / shipping
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedOrderJson.fulfillmentType} onChange={(event) => updateOrder({ fulfillmentType: event.target.value as ReviewDraftFormState["reviewedOrderJson"]["fulfillmentType"] })}>
                <option value="unknown">Unknown</option>
                <option value="pickup">Pickup</option>
                <option value="shipping">Shipping</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">Internal notes<Textarea value={form.reviewedOrderJson.internalNotes ?? ""} onChange={(event) => updateOrder({ internalNotes: textInputValueToNull(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Customer notes<Textarea value={form.reviewedOrderJson.customerNotes ?? ""} onChange={(event) => updateOrder({ customerNotes: textInputValueToNull(event.target.value) })} /></label>
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{form.reviewedLineItemsJson.length}</Badge>
              <Button type="button" variant="outline" size="sm" onClick={addLineItem} disabled={actionPending}>
                <Plus className="mr-2 h-4 w-4" />
                Add line item
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {form.reviewedLineItemsJson.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No line items in the current review draft. Add a line item to continue manual review.
              </div>
            ) : (
              form.reviewedLineItemsJson.map((lineItem, index) => {
                const parsedLine = draft.lineItems[index];
                const primaryInterpretedProductId = lineItem.interpretedProductId ?? lineItem.selectedProductId;
                const primaryInterpretedProductLabel = lineItem.productName || primaryInterpretedProductId;
                const productOptions = mergeReviewOptions(
                  (parsedLine?.productCandidates ?? []).map(candidateToReviewOption),
                  productCatalogOptions,
                  lineItem.selectedProductId && !(parsedLine?.productCandidates ?? []).some((candidate) => candidate.id === lineItem.selectedProductId)
                    ? [{
                        id: lineItem.selectedProductId,
                        label: lineItem.productName || lineItem.selectedProductId,
                        description: lineItem.interpretedProductReason,
                      }]
                    : [],
                );
                return (
                <div key={index} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-foreground">
                        {lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`}
                      </h4>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ValueSourceBadge source={lineItem.selectedProductSource} />
                        {parsedLine && <Badge variant="secondary">{parsedLine.confidence}% AI confidence</Badge>}
                        {lineItem.productUnresolved && <Badge variant="outline">Product unresolved</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => duplicateLineItem(index)} disabled={actionPending}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => clearLineItemProduct(index)} disabled={actionPending}>
                        <XCircle className="mr-2 h-4 w-4" />
                        Clear product
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => removeLineItem(index)} disabled={actionPending}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Search active catalog products
                      <Input
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                        placeholder="Search product catalog"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Product
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={lineItem.selectedProductId ?? ""} onChange={(event) => {
                        const productId = trimToNull(event.target.value);
                        const selectedOption = productOptions.find((option) => option.id === productId);
                        updateLineItem(index, {
                          productName: productId ? selectedOption?.label ?? lineItem.productName : null,
                          selectedProductId: productId,
                          selectedProductSource: productId ? "staff_selected" : null,
                          interpretedProductId: null,
                          interpretedProductReason: productId ? "Staff selected product from active catalog. AI candidate ranking is advisory." : null,
                          interpretedProductConfidence: null,
                          productUnresolved: !productId,
                          optionSelectionsJson: null,
                          pbv2TreeVersionId: null,
                          pbv2OptionSuggestions: [],
                        });
                      }}>
                        <option value="">Unselected</option>
                        {productSearchQuery.isFetching && <option value="" disabled>Searching catalog...</option>}
                        {productOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.description ? `${option.label} - ${option.description}` : option.label}</option>
                        ))}
                      </select>
                    </label>
                    {primaryInterpretedProductId && lineItem.interpretedProductReason && (
                      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        <div className="mb-1 font-semibold text-foreground">Primary Interpreted Product</div>
                        <div>{primaryInterpretedProductLabel}</div>
                        {lineItem.interpretedProductReason}
                        {lineItem.interpretedProductConfidence != null ? ` (${lineItem.interpretedProductConfidence}% confidence)` : ""}
                      </div>
                    )}
                    <ReviewLineItemProductOptions
                      lineItem={lineItem}
                      index={index}
                      onChange={(patch) => updateLineItem(index, patch)}
                    />
                    <InboundLinePricingControl
                      lineItem={lineItem}
                      onChange={(patch) => updateLineItem(index, patch)}
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={lineItem.productUnresolved} onChange={(event) => updateLineItem(index, { productUnresolved: event.target.checked })} />
                      Product unresolved
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">Quantity<ValueSourceBadge source={lineItem.quantitySource} /></span>
                      <Input value={lineItem.quantity ?? ""} onChange={(event) => updateLineItem(index, { quantity: optionalNumber(event.target.value), quantitySource: "staff_selected" })} />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center justify-between gap-2">Width<ValueSourceBadge source={lineItem.dimensionsSource} /></span>
                        <Input value={lineItem.width ?? ""} onChange={(event) => updateLineItem(index, { width: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">Height<Input value={lineItem.height ?? ""} onChange={(event) => updateLineItem(index, { height: optionalNumber(event.target.value), dimensionsSource: "staff_selected" })} /></label>
                      <label className="space-y-1 text-xs text-muted-foreground">Unit<Input value={lineItem.dimensionsUnit ?? ""} onChange={(event) => updateLineItem(index, { dimensionsUnit: trimToNull(event.target.value), dimensionsSource: "staff_selected" })} /></label>
                    </div>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">Material<ValueSourceBadge source={lineItem.materialSource} /></span>
                      <Input value={lineItem.materialText ?? ""} onChange={(event) => updateLineItem(index, { materialText: trimToNull(event.target.value), materialSource: "staff_selected" })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">Print specs<ValueSourceBadge source={lineItem.printSpecsSource} /></span>
                      <Input value={lineItem.printSpecs.join(", ")} onChange={(event) => updateLineItem(index, { printSpecs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), printSpecsSource: "staff_selected" })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">Options<ValueSourceBadge source={lineItem.optionTextsSource} /></span>
                      <Input value={lineItem.optionTexts.join(", ")} onChange={(event) => updateLineItem(index, { optionTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), optionTextsSource: "staff_selected" })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">Finishing<ValueSourceBadge source={lineItem.finishingTextsSource} /></span>
                      <Input value={lineItem.finishingTexts.join(", ")} onChange={(event) => updateLineItem(index, { finishingTexts: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), finishingTextsSource: "staff_selected" })} />
                    </label>
                    <div className="rounded-md border border-border bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artwork</div>
                        <select
                          className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                          aria-label={`Attach artwork to line item ${index + 1}`}
                          value=""
                          onChange={(event) => {
                            const selected = attachmentLinkOptions.find((link) => artworkLinkKey(link) === event.target.value);
                            if (selected) addArtworkLinkToLineItem(index, selected);
                          }}
                          disabled={actionPending || attachmentLinkOptions.length === 0}
                        >
                          <option value="">Attach stored file...</option>
                          {attachmentLinkOptions.map((link) => (
                            <option key={artworkLinkKey(link)} value={artworkLinkKey(link)}>
                              {link.filename || link.fileId}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 space-y-2">
                        {lineItem.artworkLinks.filter((link) => link.source !== "staff_removed").length === 0 ? (
                          <div className="text-xs text-muted-foreground">No artwork linked to this line item.</div>
                        ) : (
                          lineItem.artworkLinks.filter((link) => link.source !== "staff_removed").map((link) => (
                            <div key={artworkLinkKey(link)} className="rounded-md border border-border bg-background px-3 py-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{link.filename || link.fileId}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {describeArtworkLink(link)} / {titleCase(link.source)}
                                    {link.confidence != null ? ` / ${link.confidence}%` : ""}
                                  </div>
                                  {link.reason && <div className="mt-1 text-xs text-muted-foreground">{link.reason}</div>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {form.reviewedLineItemsJson.length > 1 && (
                                    <select
                                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                      aria-label={`Move ${link.filename || link.fileId} to another line item`}
                                      value=""
                                      onChange={(event) => {
                                        const targetIndex = Number(event.target.value);
                                        if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex !== index) {
                                          moveArtworkLink(index, targetIndex, link);
                                        }
                                      }}
                                      disabled={actionPending}
                                    >
                                      <option value="">Move to...</option>
                                      {form.reviewedLineItemsJson.map((targetLineItem, targetIndex) => (
                                        targetIndex === index ? null : (
                                          <option key={targetIndex} value={targetIndex}>
                                            Line {targetIndex + 1}: {targetLineItem.productName || targetLineItem.sourceText || "Untitled"}
                                          </option>
                                        )
                                      ))}
                                    </select>
                                  )}
                                  <Button type="button" variant="outline" size="sm" onClick={() => removeArtworkLinkFromLineItem(index, link)} disabled={actionPending}>
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <label className="space-y-1 text-xs text-muted-foreground">Line item notes<Textarea value={lineItem.notes ?? ""} onChange={(event) => updateLineItem(index, { notes: textInputValueToNull(event.target.value) })} /></label>
                  </div>
                  {!isOperationalMode && parsedLine && <div className="mt-3"><ProductMatchReasoning candidates={parsedLine.productCandidates} /></div>}
                </div>
              );})
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Artwork / References</h3>
            <Badge variant="outline">{draft.artwork.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {form.reviewedArtworkJson.refs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No artwork references detected.</div>
            ) : (
              form.reviewedArtworkJson.refs.map((artwork, index) => (
                <div key={index} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{artwork.filename || artwork.sourceReference || `Artwork ${index + 1}`}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {titleCase(artwork.purpose)} / line {artwork.likelyLineItemIndex !== null ? artwork.likelyLineItemIndex + 1 : "-"}
                  </div>
                </div>
              ))
            )}
            <div className="mt-3 rounded-md border border-border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unassigned Attachments</div>
                <Badge variant="outline">{unassignedArtworkLinks.length}</Badge>
              </div>
              <div className="mt-2 space-y-2">
                {unassignedArtworkLinks.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No unassigned artwork candidates.</div>
                ) : (
                  unassignedArtworkLinks.map((link) => (
                    <div key={artworkLinkKey(link)} className="rounded-md border border-border bg-background px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{link.filename || link.fileId}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {describeArtworkLink(link)} / {titleCase(link.source)}
                            {link.confidence != null ? ` / ${link.confidence}%` : ""}
                          </div>
                          {link.reason && <div className="mt-1 text-xs text-muted-foreground">{link.reason}</div>}
                        </div>
                        <select
                          className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                          aria-label={`Assign ${link.filename || link.fileId} to line item`}
                          value=""
                          onChange={(event) => {
                            const targetIndex = Number(event.target.value);
                            if (Number.isInteger(targetIndex) && targetIndex >= 0) {
                              addArtworkLinkToLineItem(targetIndex, link);
                            }
                          }}
                          disabled={actionPending || form.reviewedLineItemsJson.length === 0}
                        >
                          <option value="">Assign to line...</option>
                          {form.reviewedLineItemsJson.map((lineItem, lineItemIndex) => (
                            <option key={lineItemIndex} value={lineItemIndex}>
                              Line {lineItemIndex + 1}: {lineItem.productName || lineItem.sourceText || "Untitled"}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
              Artwork status
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={form.reviewedArtworkJson.status} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, status: event.target.value as ReviewDraftFormState["reviewedArtworkJson"]["status"] } })}>
                <option value="supplied">Supplied</option>
                <option value="to_follow">Bypass artwork for order (artwork to follow)</option>
                <option value="missing">Missing</option>
                <option value="not_required">Not required</option>
              </select>
            </label>
            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">Artwork notes<Textarea value={form.reviewedArtworkJson.notes ?? ""} onChange={(event) => updateForm({ reviewedArtworkJson: { ...form.reviewedArtworkJson, notes: trimToNull(event.target.value) } })} /></label>
          </div>
        </section>

        {!isOperationalMode && (
          <section className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Attachment Classification Debug</h3>
              <Badge variant="outline">{allAttachmentLinks.length}</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {allAttachmentLinks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No attachments captured.</div>
              ) : allAttachmentLinks.map((link) => (
                <div key={artworkLinkKey(link)} className="rounded-md border border-border bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{link.filename || link.fileId}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {attachmentClassificationLabel(classificationForLink(link))}
                        {classificationConfidenceForLink(link) != null ? ` · ${classificationConfidenceForLink(link)}%` : ""}
                        {link.classificationSource === "manual_override" ? " · Manual" : ""}
                      </div>
                    </div>
                    <select
                      className="h-8 min-w-[180px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      aria-label={`Classify ${link.filename || link.fileId}`}
                      value={classificationForLink(link)}
                      onChange={(event) => overrideAttachmentClassification(link, event.target.value as InboundAttachmentClassification)}
                      disabled={actionPending}
                    >
                      <option value="ARTWORK">Artwork</option>
                      <option value="PO">Purchase Order</option>
                      <option value="REFERENCE">Reference</option>
                      <option value="IGNORE_INLINE">Junk / Signature</option>
                      <option value="OTHER">Ignore</option>
                    </select>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>Automatic: {attachmentClassificationLabel(automaticClassificationForLink(link))}{link.automaticClassificationConfidence != null ? ` · ${Math.round(link.automaticClassificationConfidence)}%` : ""}</div>
                    <div>Manual: {link.manualOverride ? attachmentClassificationLabel(classificationForLink(link)) : "none"}</div>
                    <div>Final: {attachmentClassificationLabel(classificationForLink(link))}</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">Reasons: {classificationReasonText(link)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{attachmentDebugText(link)}</div>
                  {link.learningEvidence && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Learning evidence: {link.learningEvidence.note} Original {attachmentClassificationLabel(link.learningEvidence.originalAutomaticClassification)} -&gt; corrected {attachmentClassificationLabel(link.learningEvidence.correctedManualClassification)}.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Unsupported Requests</h3>
            <Badge variant="outline">{unsupportedRequests.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {unsupportedRequests.length === 0 ? (
              <div className="text-sm text-muted-foreground">No unsupported requests detected.</div>
            ) : (
              unsupportedRequests.map((finding, index) => (
                <div key={`${finding.category}-${index}`} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{finding.requestedText}</div>
                    <Badge variant="outline">Review Required</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {titleCase(finding.category)} / {finding.matchedProduct || "Selected product"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{finding.reason}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{finding.suggestedAction}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Missing Decisions</h3>
            <Badge variant="outline">{draft.missingDecisions.length}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {form.missingDecisionsJson.length === 0 ? (
              <div className="text-sm text-muted-foreground">No missing decisions detected.</div>
            ) : (
              form.missingDecisionsJson.map((decision, index) => (
                <div key={decision.field} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{decision.label}</div>
                    <Badge variant={decision.severity === "blocking" ? "destructive" : "outline"}>
                      {titleCase(decision.severity)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{decision.reason}</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={decision.status} onChange={(event) => updateDecision(index, { status: event.target.value as ReviewDraftFormState["missingDecisionsJson"][number]["status"] })}>
                      <option value="resolved">Resolved</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="still_blocking">Still blocking</option>
                    </select>
                    <Textarea value={decision.resolutionNote ?? ""} onChange={(event) => updateDecision(index, { resolutionNote: trimToNull(event.target.value) })} placeholder="Resolution note" />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Warnings</h3>
            <Badge variant="outline">{allWarnings.length}</Badge>
          </div>
          <div className="space-y-2">
            {form.warningsJson.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings.</div>
            ) : (
              form.warningsJson.map((warning, index) => (
                <div key={`${warning.code}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{warning.code}</div>
                  <div className="text-xs text-muted-foreground">{warning.message}</div>
                  <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={warning.acknowledged} onChange={(event) => updateWarning(index, { acknowledged: event.target.checked })} />
                    Acknowledged
                  </label>
                </div>
              ))
            )}
          </div>
        </section>
          </>
        )}

        {validationErrors.length > 0 && (
          <section className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <h3 className="text-sm font-semibold text-destructive">Ready validation</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-destructive">
              {validationErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </section>
        )}

        {isOperationalMode && minimumConversionIssues.length > 0 && (
          <section className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <h3 className="text-sm font-semibold">Missing before conversion</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
              {minimumConversionIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </section>
        )}

        <section className="sticky bottom-0 z-10 rounded-md border border-border bg-background px-2 py-2 shadow-[0_-8px_20px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {(reviewNotesExpanded || reviewNotesPreview) && (
              <div className="mr-auto min-w-[180px] max-w-[360px] truncate text-xs text-muted-foreground">
                {reviewNotesExpanded ? "Review notes" : reviewNotesPreview}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setReviewNotesExpanded((current) => !current)}
              aria-expanded={reviewNotesExpanded}
            >
              {reviewNotesExpanded ? "Hide Notes" : reviewNotesPreview ? "Edit Notes" : "Add Notes"}
            </Button>
            <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={() => { void onSave(form).catch(() => undefined); }} disabled={!dirty || actionPending}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isOperationalMode ? (
                <>
                  Save Draft
                  <span className="sr-only"> Save Review Draft</span>
                </>
              ) : "Save Review Draft"}
            </Button>
            {isOperationalMode && (
              <Button type="button" size="sm" className="h-8 px-2 text-xs" variant="outline" disabled title="Draft quote conversion is not enabled in Phase 4.0.">
                Convert to Draft Quote
              </Button>
            )}
            {hasConvertedOrder ? (
              <>
                <Button type="button" asChild size="sm" className="h-8 px-2 text-xs">
                <a href={`/orders/${convertedOrderId}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Draft Order
                </a>
              </Button>
                <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" disabled>
                  Draft Order Created
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => { void onConvert({ draft: form, blockers: draftOrderBlockers }).catch(() => undefined); }}
                disabled={actionPending}
                title={canCreateDraftOrder ? "Create an order from the current reviewed inbound draft." : draftOrderBlockers[0]}
              >
                {isConverting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isConverting ? "Creating..." : "Create Order"}
              </Button>
            )}
            {isOperationalMode && (
              <>
                <Button type="button" size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={onReject} disabled={!onReject || rejectDisabled || isCleaningUp} aria-label="Reject inbound record from draft toolbar">
                  {isRejecting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Reject
                </Button>
                <Button type="button" size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={() => onQueueAction?.("ignore_once")} disabled={!onQueueAction || rejectDisabled || isCleaningUp}>
                  Ignore
                </Button>
              </>
            )}
          </div>
          {reviewNotesExpanded && (
            <label className="mt-2 block space-y-1 text-xs text-muted-foreground">
              <span>Review notes</span>
              <Textarea
                className="min-h-[72px]"
                value={form.reviewNotes ?? ""}
                onChange={(event) => updateForm({ reviewNotes: trimToNull(event.target.value) })}
              />
            </label>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

export default function InboundOrdersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inboundEmailSettingsQuery = useInboundEmailIntakeSettings();
  const pullLatestEmailsMutation = usePullLatestInboundEmails();
  const linkedRecordId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("recordId");
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(linkedRecordId);
  const [selectedQueueRecordIds, setSelectedQueueRecordIds] = useState<Set<string>>(() => new Set());
  const [combineDialogOpen, setCombineDialogOpen] = useState(false);
  const [combinePrimaryRecordId, setCombinePrimaryRecordId] = useState<string | null>(null);
  const [combineCustomerMismatchConfirmed, setCombineCustomerMismatchConfirmed] = useState(false);
  const [combineMultipleDraftsConfirmed, setCombineMultipleDraftsConfirmed] = useState(false);
  const [attachInboundRecordId, setAttachInboundRecordId] = useState<string | null>(null);
  const [attachOrderSearch, setAttachOrderSearch] = useState("");
  const [attachOrderId, setAttachOrderId] = useState<string | null>(null);
  const [attachIncludeMessageHistory, setAttachIncludeMessageHistory] = useState(true);
  const [attachIncludeAttachments, setAttachIncludeAttachments] = useState(true);
  const [attachIncludeParsedNotes, setAttachIncludeParsedNotes] = useState(true);
  const [attachIncludeJunkAttachments, setAttachIncludeJunkAttachments] = useState(false);
  const [attachCustomerMismatchConfirmed, setAttachCustomerMismatchConfirmed] = useState(false);
  const [attachArtworkAssignments, setAttachArtworkAssignments] = useState<Record<string, { orderLineItemId: string | null; side: "front" | "back" | "na" }>>({});
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(() => linkedRecordId
    ? { ...defaultQueueFilters, statusGroup: "converted", unconvertedOnly: false, search: linkedRecordId }
    : defaultQueueFilters);
  const [queueSearchText, setQueueSearchText] = useState(linkedRecordId ?? defaultQueueFilters.search);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [parsingRecordId, setParsingRecordId] = useState<string | null>(null);
  const [parseCompletedWithoutDraftRecordId, setParseCompletedWithoutDraftRecordId] = useState<string | null>(null);
  const [parseCompletedWithoutDraftMessage, setParseCompletedWithoutDraftMessage] = useState<string | null>(null);
  const [lastConvertedOrderId, setLastConvertedOrderId] = useState<string | null>(null);
  const [lastConvertedOrderNumber, setLastConvertedOrderNumber] = useState<string | null>(null);
  const [reviewDraftDirtyByRecordId, setReviewDraftDirtyByRecordId] = useState<Record<string, boolean>>({});
  const [sourceChangedByRecordId, setSourceChangedByRecordId] = useState<Record<string, boolean>>({});
  const [cleanForm, setCleanForm] = useState<ReviewDraftFormState | null>(null);
  const [cleanActiveTarget, setCleanActiveTarget] = useState<CleanHighlightTarget | null>(null);
  const [cleanInlineAttachmentSelection, setCleanInlineAttachmentSelection] = useState<CleanInlineAttachmentSelection>(null);
  const [classificationDialog, setClassificationDialog] = useState<AttachmentClassificationDialogState | null>(null);
  const [reviewMode, setReviewMode] = useState<InboundReviewWorkspaceMode>(() => {
    if (typeof window === "undefined") return "operational";
    const storedMode = window.localStorage.getItem(workspaceLayoutStorageKeys.reviewMode);
    return storedMode === "debug" || storedMode === "clean" ? storedMode : "operational";
  });
  const [responsivePanel, setResponsivePanel] = useState<"email" | "review">("email");
  const [sourceDocumentTab, setSourceDocumentTab] = useState<SourceDocumentTab>("email");
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(() => (
    readStoredBoolean(workspaceLayoutStorageKeys.queueCollapsed, false)
  ));
  const [queueExpandedWidth, setQueueExpandedWidth] = useState(() => (
    readStoredNumber(
      workspaceLayoutStorageKeys.queueWidth,
      workspaceLayoutDefaults.queueExpandedWidth,
      workspaceLayoutDefaults.minQueueExpandedWidth,
      workspaceLayoutDefaults.maxQueueExpandedWidth,
    )
  ));
  const [evidenceWidth, setEvidenceWidth] = useState(() => (
    readStoredNumber(
      workspaceLayoutStorageKeys.evidenceWidth,
      workspaceLayoutDefaults.evidenceWidth,
      workspaceLayoutDefaults.compactEvidenceWidth,
    )
  ));
  const [draftWidth, setDraftWidth] = useState(() => (
    readStoredNumber(
      workspaceLayoutStorageKeys.draftWidth,
      workspaceLayoutDefaults.draftWidth,
      workspaceLayoutDefaults.compactDraftWidth,
    )
  ));
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const parseInFlightRef = useRef(false);
  const keepCurrentDraftAfterParseRef = useRef(false);
  const listUrl = useMemo(() => buildInboundOrderListUrl(queueFilters), [queueFilters]);
  const inboundEmailFeatureDisabled = inboundEmailSettingsQuery.isSuccess
    && inboundEmailSettingsQuery.data?.inboundEmailIntakeEnabled === false;
  const inboundEmailSettingsReady = inboundEmailSettingsQuery.isSuccess || inboundEmailSettingsQuery.isError;
  const inboundEmailPullPaused = inboundEmailSettingsQuery.data?.inboundEmailPullPaused === true;

  const listQuery = useQuery({
    queryKey: ["/api/inbound-orders", queueFilters],
    queryFn: () => readJson<ClientInboundOrdersListResponse>(listUrl),
    enabled: inboundEmailSettingsReady && !inboundEmailFeatureDisabled,
    placeholderData: (previousData) => previousData,
  });

  const records = listQuery.data?.data ?? [];
  const queueSummary = listQuery.data?.summary ?? null;

  useEffect(() => {
    const appliedSearch = queueSearchText.trim();
    if (appliedSearch === queueFilters.search) return;

    const debounceId = window.setTimeout(() => {
      setQueueFilters((current) => (
        current.search === appliedSearch ? current : { ...current, search: appliedSearch }
      ));
    }, queueSearchDebounceMs);

    return () => window.clearTimeout(debounceId);
  }, [queueSearchText, queueFilters.search]);

  useEffect(() => {
    if (!selectedId && records.length > 0) {
      setSelectedId(records[0].id);
    }
  }, [records, selectedId]);

  useEffect(() => {
    setCleanInlineAttachmentSelection(null);
  }, [selectedId]);

  const applyQueueFilters = (nextFilters: QueueFilters) => {
    setQueueFilters(nextFilters);
  };

  const updateQueueSearchText = (value: string) => {
    setQueueSearchText(value);
  };

  useEffect(() => {
    const recordIds = new Set(records.map((record) => record.id));
    setSelectedQueueRecordIds((current) => {
      const next = new Set(Array.from(current).filter((id) => recordIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [records]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.queueCollapsed, String(queueCollapsed));
  }, [queueCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.queueWidth, String(queueExpandedWidth));
  }, [queueExpandedWidth]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.evidenceWidth, String(evidenceWidth));
  }, [evidenceWidth]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.draftWidth, String(draftWidth));
  }, [draftWidth]);

  useEffect(() => {
    window.localStorage.setItem(workspaceLayoutStorageKeys.reviewMode, reviewMode);
  }, [reviewMode]);

  useEffect(() => {
    const measureWorkspace = () => {
      const measuredWidth = getVisibleWorkspaceWidth(workspaceRef.current);
      setWorkspaceWidth(measuredWidth > 0 ? measuredWidth : window.innerWidth);
    };

    measureWorkspace();
    const observer = typeof ResizeObserver !== "undefined" && workspaceRef.current
      ? new ResizeObserver(measureWorkspace)
      : null;
    if (workspaceRef.current) observer?.observe(workspaceRef.current);
    window.addEventListener("resize", measureWorkspace);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureWorkspace);
    };
  }, []);

  const effectivePanelWidths = useMemo(() => {
    const measuredWidth = getMeasuredWorkspaceWidth(workspaceWidth);
    if (measuredWidth < workspaceLayoutDefaults.desktopBreakpoint) {
      return { evidenceWidth, draftWidth };
    }
    return reconcileWorkspacePanelWidths({
      evidenceWidth,
      draftWidth,
      queueCollapsed,
      queueExpandedWidth,
      workspaceWidth: measuredWidth,
    });
  }, [draftWidth, evidenceWidth, queueCollapsed, queueExpandedWidth, workspaceWidth]);

  const cleanPanelWidths = useMemo(() => {
    const measuredWidth = getMeasuredWorkspaceWidth(workspaceWidth);
    if (measuredWidth < workspaceLayoutDefaults.desktopBreakpoint) {
      return { evidenceWidth, draftWidth };
    }
    return reconcileWorkspacePanelWidths({
      evidenceWidth,
      draftWidth,
      queueCollapsed: false,
      queueExpandedWidth,
      workspaceWidth: measuredWidth,
    });
  }, [draftWidth, evidenceWidth, queueExpandedWidth, workspaceWidth]);

  const selectedListRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const detailQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId],
    queryFn: () => readJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const selectedRecord = selectedListRecord ?? detailQuery.data?.data.record ?? null;

  const attachOrderSearchQuery = useQuery<{ success: true; data: ExistingOrderSearchResult[] }>({
    queryKey: ["/api/inbound-orders", "order-search", attachOrderSearch],
    queryFn: () => readJson<{ success: true; data: ExistingOrderSearchResult[] }>(`/api/inbound-orders/order-search?search=${encodeURIComponent(attachOrderSearch.trim())}`),
    enabled: Boolean(attachInboundRecordId),
    staleTime: 15_000,
  });
  const attachSelectedOrderQuery = useQuery<any>({
    queryKey: ["/api/orders", "inbound-attach-order", attachOrderId],
    queryFn: () => readJson<any>(`/api/orders/${encodeURIComponent(attachOrderId ?? "")}`),
    enabled: Boolean(attachOrderId && attachInboundRecordId),
  });

  const draftPreviewQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId, "draft-preview"],
    queryFn: () => readJson<ClientInboundOrderDraftPreviewResponse>(`/api/inbound-orders/${selectedId}/draft-preview`),
    enabled: Boolean(selectedId),
  });

  const reviewDraftQuery = useQuery({
    queryKey: ["/api/inbound-orders", selectedId, "review-draft"],
    queryFn: () => readJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${selectedId}/review-draft`),
    enabled: Boolean(selectedId && draftPreviewQuery.data?.data.draft),
  });

  const reviewDraftData = reviewDraftQuery.data?.data ?? null;

  useEffect(() => {
    if (!reviewDraftData) {
      setCleanForm(null);
      setCleanActiveTarget(null);
      return;
    }
    setCleanForm(cloneReviewDraft(reviewDraftData));
    setCleanActiveTarget(null);
  }, [reviewDraftData?.snapshotId, reviewDraftData?.updatedAt, reviewDraftData?.status, selectedId]);

  const createManualMutation = useMutation({
    mutationFn: (payload: ManualInboundOrderCreateRequest) => (
      postJson<ManualInboundOrderCreateResponse>("/api/inbound-orders/manual", payload)
    ),
    onSuccess: async (response) => {
      const createdRecordId = response.data.record.id;
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await listQuery.refetch();
      setSelectedId(createdRecordId);
    },
  });

  const refreshReviewDraftFromLatestParseMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft/refresh-from-latest-parse`, {}),
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(["/api/inbound-orders", recordId, "review-draft"], response);
      await Promise.all([
        queryClient.invalidateQueries({ predicate: isInboundOrderListQuery }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId], exact: true }),
      ]);
    },
  });

  const hydrateParsedRecord = async (response: ClientInboundOrderParseResponse) => {
    const parsedRecordId = response.data.record.id;
    setParseCompletedWithoutDraftRecordId(null);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: isInboundOrderListQuery }),
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId], exact: true }),
    ]);
    queryClient.setQueryData(["/api/inbound-orders", parsedRecordId, "draft-preview"], {
      success: true,
      data: {
        draft: response.data.draft,
        latestAttempt: response.data.latestAttempt,
      },
    } satisfies ClientInboundOrderDraftPreviewResponse);
    if (!response.data.draft) {
      setParseCompletedWithoutDraftRecordId(parsedRecordId);
      setParseCompletedWithoutDraftMessage(parseAttemptNoDraftMessage(response.data.latestAttempt));
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId, "review-draft"] });
      setSelectedId(parsedRecordId);
      return;
    }
    setSourceChangedByRecordId((current) => (
      current[parsedRecordId] ? { ...current, [parsedRecordId]: false } : current
    ));
    if (keepCurrentDraftAfterParseRef.current) {
      queryClient.setQueryData<ClientInboundOrderReviewDraftResponse | undefined>(["/api/inbound-orders", parsedRecordId, "review-draft"], (current) => (
        current?.data
          ? { ...current, data: { ...current.data, hasNewerParse: true } }
          : current
      ));
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId, "review-draft"], refetchType: "none" });
    } else if (response.data.reviewDraft) {
      queryClient.setQueryData(["/api/inbound-orders", parsedRecordId, "review-draft"], {
        success: true,
        data: response.data.reviewDraft,
      } satisfies ClientInboundOrderReviewDraftResponse);
    } else {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", parsedRecordId, "review-draft"] });
      const refreshedDraft = await queryClient.fetchQuery({
        queryKey: ["/api/inbound-orders", parsedRecordId, "review-draft"],
        queryFn: () => readJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${parsedRecordId}/review-draft`),
      });
      if (!refreshedDraft?.data) {
        setParseCompletedWithoutDraftRecordId(parsedRecordId);
        setParseCompletedWithoutDraftMessage(parseAttemptNoDraftMessage(response.data.latestAttempt));
      }
    }
    setSelectedId(parsedRecordId);
  };

  const handleParseFailure = (error: Error) => {
    toast({ title: "Parse failed", description: operatorSafeParseErrorMessage(error), variant: "destructive" });
  };

  const parseMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderParseResponse>(`/api/inbound-orders/${recordId}/parse`, {}),
    onSuccess: hydrateParsedRecord,
    onError: handleParseFailure,
    onSettled: () => {
      parseInFlightRef.current = false;
      keepCurrentDraftAfterParseRef.current = false;
      setParsingRecordId(null);
    },
  });

  const saveReviewDraftMutation = useMutation({
    mutationFn: ({ recordId, draft }: { recordId: string; draft: ReviewDraftFormState }) => (
      putJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft`, draft)
    ),
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId, "review-draft"], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId] });
    },
  });

  const markReviewDraftReadyMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft/mark-ready`, {}),
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(["/api/inbound-orders", recordId, "review-draft"], response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
      ]);
    },
  });

  const reopenReviewDraftMutation = useMutation({
    mutationFn: (recordId: string) => postJson<ClientInboundOrderReviewDraftResponse>(`/api/inbound-orders/${recordId}/review-draft/reopen`, {}),
    onSuccess: async (response, recordId) => {
      queryClient.setQueryData(["/api/inbound-orders", recordId, "review-draft"], response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
      ]);
    },
  });

  const rejectInboundOrderMutation = useMutation({
    mutationFn: ({ recordId, reason }: { recordId: string; reason: string | null }) => (
      postJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${recordId}/reject`, { reason })
    ),
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      if (queueFilters.statusGroup === "rejected") {
        setSelectedId(variables.recordId);
      } else {
        setSelectedId(null);
      }
    },
  });

  const ignoreInboundOrderMutation = useMutation({
    mutationFn: ({ recordId, action, note, resolveConflict }: { recordId: string; action: Exclude<InboundQueueCleanupAction, "trust_sender" | "trust_domain" | "delete" | "reject">; note: string | null; resolveConflict?: "disable_conflicting_rule" }) => (
      postJson<ClientInboundOrderDetailResponse>(`/api/inbound-orders/${recordId}/ignore`, { action, note, resolveConflict })
    ),
    onSuccess: async (response, variables) => {
      queryClient.setQueryData(["/api/inbound-orders", variables.recordId], response);
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/ignore-rules"] });
      if (queueFilters.statusGroup === "ignored") {
        setSelectedId(variables.recordId);
      } else {
        setSelectedId(null);
      }
      setSelectedQueueRecordIds((current) => {
        const next = new Set(current);
        next.delete(variables.recordId);
        return next;
      });
    },
    onError: (error: Error, variables) => {
      if (isInboundRuleConflictError(error) && window.confirm("This sender/domain is currently trusted. Ignoring it will disable the trust rule.")) {
        ignoreInboundOrderMutation.mutate({ ...variables, resolveConflict: "disable_conflicting_rule" });
        return;
      }
      toast({ title: "Ignore action failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteInboundQueueRecordMutation = useMutation({
    mutationFn: ({ recordId, note }: { recordId: string; note: string | null }) => (
      apiFetch(`/api/inbound-orders/${recordId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      }).then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof json?.message === "string" ? json.message : "Failed to delete inbound record");
        }
        return json as ClientInboundOrderDetailResponse;
      })
    ),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      setSelectedId(null);
      setSelectedQueueRecordIds((current) => {
        const next = new Set(current);
        next.delete(variables.recordId);
        return next;
      });
    },
  });

  const bulkQueueActionMutation = useMutation({
    mutationFn: ({ recordIds, action, note, resolveConflict }: { recordIds: string[]; action: InboundQueueCleanupAction; note: string | null; resolveConflict?: "disable_conflicting_rule" }) => (
      postJson<InboundOrderBulkActionResponse>(
        "/api/inbound-orders/bulk-action",
        { recordIds, action, note, resolveConflict },
      )
    ),
    onSuccess: async (response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/ignore-rules"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/trust-rules"] });
      const actualErrors = response.data.actualErrors ?? response.data.errors;
      const conflictErrors = actualErrors.filter((error) => (
        error.message.includes("currently ignored") || error.message.includes("currently trusted")
      ));
      if (conflictErrors.length > 0 && !variables.resolveConflict) {
        const trustAction = variables.action === "trust_sender" || variables.action === "trust_domain";
        const confirmed = window.confirm(trustAction
          ? `${conflictErrors.length} selected sender/domain value(s) are currently ignored. Trusting them will disable matching ignore rule(s).`
          : `${conflictErrors.length} selected sender/domain value(s) are currently trusted. Ignoring them will disable matching trust rule(s).`);
        if (confirmed) {
          bulkQueueActionMutation.mutate({ ...variables, resolveConflict: "disable_conflicting_rule" });
          return;
        }
      }
      setSelectedQueueRecordIds(new Set());
      if (actualErrors.length > 0) {
        toast({
          title: "Some records were not updated",
          description: actualErrors.map((error) => error.message).slice(0, 2).join(" "),
          variant: "destructive",
        });
        return;
      }
      const isIgnoreAction = variables.action === "ignore_once"
        || variables.action === "ignore_sender"
        || variables.action === "ignore_domain"
        || variables.action === "ignore_subject"
        || variables.action === "ignore_sender_subject";
      if (isIgnoreAction && ((response.data.rulesCreated ?? 0) > 0 || (response.data.rulesAlreadyExisted ?? 0) > 0)) {
        toast({
          title: "Ignore action complete",
          description: formatInboundIgnoreBulkDescription(response.data),
        });
      }
    },
  });

  const combineInboundRecordsMutation = useMutation({
    mutationFn: (input: {
      recordIds: string[];
      primaryRecordId: string;
      confirmCustomerMismatch: boolean;
      confirmMultipleDrafts: boolean;
    }) => postJson<InboundOrderCombineResponse>("/api/inbound-orders/combine", input),
    onSuccess: async (response) => {
      const parentId = response.data.detail.record.id;
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      queryClient.setQueryData<ClientInboundOrderDetailResponse>(
        ["/api/inbound-orders", parentId],
        { success: true, data: response.data.detail },
      );
      setSelectedId(parentId);
      setSelectedQueueRecordIds(new Set());
      setCombineDialogOpen(false);
      toast({
        title: "Inbound emails combined",
        description: `Combined from ${response.data.combinedSourceCount} emails. Reparse recommended before conversion.`,
      });
    },
  });

  const attachInboundToOrderMutation = useMutation({
    mutationFn: (input: {
      inboundRecordId: string;
      orderId: string;
      includeMessageHistory: boolean;
      includeAttachments: boolean;
      includeParsedNotes: boolean;
      includeJunkAttachments: boolean;
      confirmCustomerMismatch: boolean;
      artworkAssignments: Array<{ fileId: string; orderLineItemId: string | null; side: "front" | "back" | "na" }>;
    }) => postJson<InboundOrderAttachToOrderResponse>(`/api/inbound-orders/${encodeURIComponent(input.inboundRecordId)}/attach-to-order`, {
      orderId: input.orderId,
      includeMessageHistory: input.includeMessageHistory,
      includeAttachments: input.includeAttachments,
      includeParsedNotes: input.includeParsedNotes,
      includeJunkAttachments: input.includeJunkAttachments,
      confirmCustomerMismatch: input.confirmCustomerMismatch,
      artworkAssignments: input.artworkAssignments,
    }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", response.data.orderId] });
      setSelectedQueueRecordIds(new Set());
      setAttachInboundRecordId(null);
      toast({
        title: "Inbound record attached to order",
        description: `Attached to ${response.data.orderNumber ?? response.data.orderId}.`,
      });
      window.location.assign(`/orders/${response.data.orderId}`);
    },
  });

  const recordTrustActionMutation = useMutation({
    mutationFn: ({ recordId, action, resolveConflict }: { recordId: string; action: InboundRecordTrustAction; resolveConflict?: "disable_conflicting_rule" }) => (
      postJson<{
        success: true;
        data: {
          result: {
            trustRuleType: "sender_email_exact" | "sender_domain";
            trustRuleValue: string;
            attempted: number;
            downloaded: number;
            metadataOnly: number;
            blocked: number;
            failed: Array<{ fileId: string; message: string }>;
          };
          inbound: ClientInboundOrderDetailResponse["data"] | null;
        };
      }>(`/api/inbound-orders/${encodeURIComponent(recordId)}/trust-action`, { action, resolveConflict })
    ),
    onSuccess: async (response, variables) => {
      if (response.data.inbound) {
        queryClient.setQueryData(["/api/inbound-orders", variables.recordId], {
          success: true,
          data: response.data.inbound,
        } satisfies ClientInboundOrderDetailResponse);
        queryClient.setQueriesData({ predicate: isInboundOrderListQuery }, (current: any) => {
          if (!current?.data || !Array.isArray(current.data)) return current;
          return {
            ...current,
            data: current.data.map((record: ClientInboundOrderRecord) => (
              record.id === variables.recordId ? response.data.inbound!.record : record
            )),
          };
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/trust-rules"] }),
      ]);
      const result = response.data.result;
      toast({
        title: "Sender trust updated",
        description: result.attempted > 0
          ? `${result.trustRuleValue} trusted. Downloaded ${result.downloaded}, kept ${result.metadataOnly} metadata-only, blocked/quarantined ${result.blocked}.`
          : `${result.trustRuleValue} trusted. Existing pending attachments were not downloaded.`,
      });
    },
    onError: (error: Error, variables) => {
      if (isInboundRuleConflictError(error) && window.confirm("This sender/domain is currently ignored. Trusting it will disable the ignore rule.")) {
        recordTrustActionMutation.mutate({ ...variables, resolveConflict: "disable_conflicting_rule" });
        return;
      }
      toast({ title: "Sender trust action failed", description: error.message, variant: "destructive" });
    },
  });

  const emailReprocessMutation = useMutation({
    mutationFn: ({ recordId, action }: { recordId: string; action: InboundEmailReprocessAction }) => (
      postJson<{
        success: true;
        data: {
          result: InboundEmailReprocessResult;
          inbound: ClientInboundOrderDetailResponse["data"] | null;
        };
      }>(`/api/inbound-orders/${encodeURIComponent(recordId)}/email-reprocess`, { action })
    ),
    onSuccess: async (response, variables) => {
      if (response.data.inbound) {
        queryClient.setQueryData(["/api/inbound-orders", variables.recordId], {
          success: true,
          data: response.data.inbound,
        } satisfies ClientInboundOrderDetailResponse);
      }
      await Promise.all([
        queryClient.invalidateQueries({ predicate: isInboundOrderListQuery }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "draft-preview"] }),
      ]);
      const result = response.data.result;
      toast({
        title: variables.action === "reprocess_email" ? "Email reprocessed" : "Attachments backfilled",
        description: `Candidates ${result.candidatesFound}, attempted ${result.attempted}, stored ${result.stored}, metadata-only ${result.metadataOnly}, failed ${result.failed}, skipped ${result.skipped}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Email reprocess failed", description: error.message, variant: "destructive" });
    },
  });

  const classifyAttachmentMutation = useMutation({
    mutationFn: ({ recordId, fileId, payload }: {
      recordId: string;
      fileId: string;
      payload: {
        classification: InboundAttachmentClassification;
        rememberForCustomer: boolean;
        rule: {
          customerId: string | null;
          senderDomain: string | null;
          matchType: AttachmentClassificationRuleMatchType;
          matchValue: string;
        } | null;
      };
    }) => postJson<AttachmentClassificationUpdateResponse>(
      `/api/inbound-orders/${encodeURIComponent(recordId)}/files/${encodeURIComponent(fileId)}/classification`,
      payload,
    ),
    onSuccess: (response, variables) => {
      queryClient.setQueryData<ClientInboundOrderDetailResponse | undefined>(["/api/inbound-orders", variables.recordId], (current) => {
        if (!current?.data) return current;
        return {
          ...current,
          data: {
            ...current.data,
            files: current.data.files.map((file) => file.id === response.data.file.id ? response.data.file : file),
          },
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "draft-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "review-draft"] });
      queryClient.invalidateQueries({ predicate: isInboundOrderListQuery });
      setSourceChangedByRecordId((current) => ({ ...current, [variables.recordId]: true }));
      toast({
        title: "Attachment classified",
        description: response.data.warning ?? "The attachment classification was updated.",
        variant: response.data.warning ? "default" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Classification failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkClassifyAttachmentsMutation = useMutation({
    mutationFn: ({ recordId, fileIds, classification }: {
      recordId: string;
      fileIds: string[];
      classification: InboundAttachmentClassification | "reset_to_ai";
    }) => postJson<AttachmentClassificationBulkUpdateResponse>(
      `/api/inbound-orders/${encodeURIComponent(recordId)}/files/classification/bulk`,
      { fileIds, classification },
    ),
    onSuccess: (response, variables) => {
      queryClient.setQueryData<ClientInboundOrderDetailResponse | undefined>(["/api/inbound-orders", variables.recordId], (current) => {
        if (!current?.data) return current;
        const updatedById = new Map(response.data.files.map((file) => [file.id, file]));
        return {
          ...current,
          data: {
            ...current.data,
            files: current.data.files.map((file) => updatedById.get(file.id) ?? file),
          },
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "draft-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", variables.recordId, "review-draft"] });
      queryClient.invalidateQueries({ predicate: isInboundOrderListQuery });
      setCleanForm((current) => {
        if (!current) return current;
        const updatedById = new Map(response.data.files.map((file) => [file.id, file]));
        const synchronizeLink = (link: InboundOrderArtworkLink) => {
          const updatedFile = updatedById.get(link.fileId);
          return updatedFile ? { ...link, ...artworkLinkFromInboundFile(updatedFile, link.source) } : link;
        };
        return {
          ...current,
          reviewedLineItemsJson: current.reviewedLineItemsJson.map((lineItem) => ({
            ...lineItem,
            artworkLinks: lineItem.artworkLinks.map(synchronizeLink),
          })),
          reviewedArtworkJson: {
            ...current.reviewedArtworkJson,
            unassignedAttachments: current.reviewedArtworkJson.unassignedAttachments.map(synchronizeLink),
          },
        };
      });
      setSourceChangedByRecordId((current) => ({ ...current, [variables.recordId]: true }));
      const updatedCount = response.data.files.length;
      const actionLabel = variables.classification === "reset_to_ai"
        ? "Reset"
        : `Classified ${updatedCount} file${updatedCount === 1 ? "" : "s"} as ${attachmentClassificationLabel(variables.classification)}`;
      toast({
        title: updatedCount > 0 ? actionLabel : "No attachments were classified",
        description: [
          response.data.errors.length > 0 ? `${response.data.errors.length} skipped.` : null,
          response.data.warnings.length > 0 ? `${response.data.warnings.length} need attachment availability review.` : null,
          updatedCount > 0 ? "Reparse required to refresh draft evidence and readiness validation." : null,
        ].filter(Boolean).join(" ") || "No attachment classifications changed.",
        variant: response.data.errors.length > 0 ? "default" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk classification failed", description: error.message, variant: "destructive" });
    },
  });

  const convertToOrderMutation = useMutation({
    mutationFn: async ({ recordId, draft }: { recordId: string; draft: ReviewDraftFormState }) => {
      const response = await postJson<InboundOrderConvertToOrderResponse>(`/api/inbound-orders/${recordId}/create-order`, draft);
      const orderId = response?.data?.orderId;
      const orderNumber = response?.data?.orderNumber;
      const returnedOrderId = response?.data?.order && typeof response.data.order === "object"
        ? String((response.data.order as { id?: unknown }).id ?? "")
        : "";
      const returnedOrderNumber = response?.data?.order && typeof response.data.order === "object"
        ? String((response.data.order as { orderNumber?: unknown }).orderNumber ?? "")
        : "";
      if (
        response.success !== true
        || typeof orderId !== "string"
        || orderId.trim().length === 0
        || typeof orderNumber !== "string"
        || orderNumber.trim().length === 0
        || returnedOrderId !== orderId
        || returnedOrderNumber !== orderNumber
      ) {
        throw new Error("Draft order creation did not return a valid persisted order. Please retry or contact support.");
      }
      return response;
    },
    onSuccess: async (response, variables) => {
      const recordId = variables.recordId;
      const orderId = response.data.orderId;
      const orderNumber = response.data.orderNumber;
      setLastConvertedOrderId(orderId);
      setLastConvertedOrderNumber(orderNumber);
      if (response.data.order && typeof response.data.order === "object") {
        queryClient.setQueryData(["orders", "detail", orderId], response.data.order);
      }
      if (response.data.inbound) {
        queryClient.setQueryData(["/api/inbound-orders", recordId], {
          success: true,
          data: response.data.inbound as any,
        } satisfies ClientInboundOrderDetailResponse);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] }),
        queryClient.invalidateQueries({ queryKey: ["orders", "list"] }),
      ]);
      toast({
        title: response.data.alreadyConverted ? "Draft order already exists" : "Draft order created",
        description: `Order ${orderNumber} is ready to open. Proofs, production, invoices, and fulfillment were not started.`,
      });
      if (queueFilters.statusGroup === "converted") {
        setSelectedId(recordId);
      } else {
        setSelectedId(null);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Draft order was not created",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const convertToQuoteMutation = useMutation({
    mutationFn: (recordId: string) => (
      postJson<{ success: true; data: { quote: { id: string; quoteNumber: number | null; reference: string }; inbound: ClientInboundOrderDetailResponse["data"] } }>(
        `/api/inbound-orders/${recordId}/create-quote-draft`,
        {},
      )
    ),
    onSuccess: async (response, recordId) => {
      if (response.data.inbound) {
        queryClient.setQueryData(["/api/inbound-orders", recordId], {
          success: true,
          data: response.data.inbound as any,
        } satisfies ClientInboundOrderDetailResponse);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders", recordId] });
      toast({
        title: "Draft quote created",
        description: `Quote ${response.data.quote.reference} was created from the inbound review.`,
      });
      if (queueFilters.statusGroup === "converted") {
        setSelectedId(recordId);
      } else {
        setSelectedId(null);
      }
    },
  });

  const isParseInFlight = Boolean(parsingRecordId) || parseMutation.isPending;
  const isSelectedRecordParsing = Boolean(selectedId && parsingRecordId === selectedId);
  const isSelectedRecordRescanning = Boolean(
    selectedId
      && emailReprocessMutation.isPending
      && emailReprocessMutation.variables?.recordId === selectedId
      && emailReprocessMutation.variables?.action === "reprocess_email",
  );
  const selectedRecordIsTerminal = Boolean(
    selectedRecord
      && (
        selectedRecord.status === "terminal"
        || selectedRecord.status === "ignored"
        || selectedRecord.status === "submitted"
        || selectedRecord.status === "approved"
        || selectedRecord.createdQuoteId
        || selectedRecord.createdOrderId
      ),
  );
  const selectedReviewDraftHasUnsavedEdits = Boolean(selectedId && reviewDraftDirtyByRecordId[selectedId]);
  const handleReviewDraftDirtyChange = useCallback((recordId: string | null, dirty: boolean) => {
    if (!recordId) return;
    setReviewDraftDirtyByRecordId((current) => (
      current[recordId] === dirty ? current : { ...current, [recordId]: dirty }
    ));
  }, []);
  const focusCleanTarget = useCallback<CleanFocusTargetHandler>((target, options) => {
    setCleanActiveTarget(target);
    if (!options?.inspectSource || typeof window === "undefined") return;
    if (target === "po" || target === "dueDate") setSourceDocumentTab("po");
    if (target === "artwork") setSourceDocumentTab("artwork");
    if (target === "customer" || target === "product" || target === "quantity" || target === "dimensions") setSourceDocumentTab("email");
    window.setTimeout(() => {
      const source = document.querySelector(`[data-clean-source-target="${target}"]`) as HTMLElement | null;
      source?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      source?.focus?.({ preventScroll: true });
    }, 80);
  }, []);
  const runParseForSelectedRecord = () => {
    if (!selectedId || parseInFlightRef.current) return;
    if (selectedReviewDraftHasUnsavedEdits) {
      const applyLatestParse = window.confirm("Applying the latest parse will overwrite your draft changes.");
      keepCurrentDraftAfterParseRef.current = !applyLatestParse;
    } else {
      keepCurrentDraftAfterParseRef.current = false;
    }
    parseInFlightRef.current = true;
    setParseCompletedWithoutDraftRecordId(null);
    setParseCompletedWithoutDraftMessage(null);
    setParsingRecordId(selectedId);
    parseMutation.mutate(selectedId);
  };
  const runSourceRescanForSelectedRecord = () => {
    if (!selectedRecord || emailReprocessMutation.isPending || selectedRecordIsTerminal) return;
    if (selectedRecord.sourceType !== "email") {
      toast({ title: "Re-scan unavailable", description: "Only email-source inbound records can refresh source documents.", variant: "destructive" });
      return;
    }
    emailReprocessMutation.mutate({ recordId: selectedRecord.id, action: "reprocess_email" });
  };
  const rejectSelectedRecord = () => {
    if (!selectedId || rejectInboundOrderMutation.isPending || selectedRecordIsTerminal) return;
    const reason = window.prompt("Optional reason for removing this inbound record from the active queue:");
    if (reason === null) return;
    rejectInboundOrderMutation.mutate({ recordId: selectedId, reason: trimToNull(reason) });
  };

  const runQueueCleanupAction = (action: InboundQueueCleanupAction) => {
    if (!selectedId || selectedRecordIsTerminal) return;
    if (action === "trust_sender" || action === "trust_domain") {
      const selected = selectedRecord;
      const evidence = selected ? getManualInboundEvidence(selected) : null;
      const email = evidence?.senderEmail?.trim().toLowerCase() ?? "";
      const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
      const value = action === "trust_sender" ? email : domain;
      if (!value) {
        toast({
          title: "No sender value",
          description: action === "trust_sender" ? "This record has no sender email to trust." : "This record has no sender domain to trust.",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(`Trust ${value}? Future emails from this ${action === "trust_sender" ? "sender" : "domain"} may auto-download allowed attachments. No attachments will download immediately.`);
      if (!confirmed) return;
      bulkQueueActionMutation.mutate({ recordIds: [selectedId], action, note: null });
      return;
    }
    const note = window.prompt("Optional note for this queue cleanup action:");
    if (note === null) return;
    const cleanNote = trimToNull(note);

    if (action === "delete") {
      const confirmed = window.confirm("Remove this TEMP_INBOUND review record from the operational queue? Source email, audit logs, and converted orders will not be deleted.");
      if (!confirmed) return;
      deleteInboundQueueRecordMutation.mutate({ recordId: selectedId, note: cleanNote });
      return;
    }

    if (action === "reject") {
      rejectInboundOrderMutation.mutate({ recordId: selectedId, reason: cleanNote });
      return;
    }

    ignoreInboundOrderMutation.mutate({ recordId: selectedId, action, note: cleanNote });
  };

  const runRecordTrustAction = (record: ClientInboundOrderRecord, action: InboundRecordTrustAction) => {
    if (recordTrustActionMutation.isPending || selectedRecordIsTerminal) return;
    const evidence = getManualInboundEvidence(record);
    const email = evidence.senderEmail?.trim().toLowerCase() ?? "";
    const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
    if ((action === "trust_sender" || action === "trust_sender_and_download") && !email) {
      toast({ title: "No sender email", description: "This inbound record has no sender email to trust.", variant: "destructive" });
      return;
    }
    if ((action === "trust_domain" || action === "trust_domain_and_download") && !domain) {
      toast({ title: "No sender domain", description: "This inbound record has no sender domain to trust.", variant: "destructive" });
      return;
    }
    if (action === "trust_domain" || action === "trust_domain_and_download") {
      const confirmed = window.confirm(`Trust the sender domain ${domain}? Future emails from this domain may auto-download allowed attachments. Blocked file types will remain blocked.`);
      if (!confirmed) return;
    }
    recordTrustActionMutation.mutate({ recordId: record.id, action });
  };

  const runEmailReprocessAction = (record: ClientInboundOrderRecord, action: InboundEmailReprocessAction) => {
    if (emailReprocessMutation.isPending || selectedRecordIsTerminal) return;
    if (record.sourceType !== "email") {
      toast({ title: "Email reprocess unavailable", description: "Only email-source inbound records can be reprocessed.", variant: "destructive" });
      return;
    }
    if (action === "reprocess_email") {
      const confirmed = window.confirm("Re-fetch this Gmail message/thread and refresh source evidence? Staff review draft edits will be preserved.");
      if (!confirmed) return;
    }
    emailReprocessMutation.mutate({ recordId: record.id, action });
  };

  const updateCleanForm = (patch: Partial<ReviewDraftFormState>) => {
    setCleanForm((current) => current ? { ...current, ...patch } : current);
  };
  const cleanStoredAttachmentLinks = dedupeAttachmentFiles(detailQuery.data?.data.files ?? [])
    .map((file) => artworkLinkFromInboundFile(file, "unresolved"));
  const cleanAttachmentLinks = cleanForm
    ? dedupeAttachmentLinks(Array.from(new Map([
      ...cleanStoredAttachmentLinks,
      ...cleanForm.reviewedArtworkJson.unassignedAttachments,
      ...cleanForm.reviewedLineItemsJson.flatMap((lineItem) => lineItem.artworkLinks),
    ].map((link) => [artworkLinkKey(link), link])).values()))
    : cleanStoredAttachmentLinks;
  const overrideCleanAttachmentClassification = (link: InboundOrderArtworkLink, classification: InboundAttachmentClassification) => {
    if (!cleanForm || !selectedRecord) return;
    const key = artworkLinkKey(link);
    const nextLink: InboundOrderArtworkLink = {
      ...link,
      role: attachmentRoleForClassification(classification),
      classification,
      classificationConfidence: 100,
      classificationReasons: [`Staff manually classified as ${attachmentClassificationLabel(classification)}.`],
      classificationSource: "manual_override",
      automaticClassification: automaticClassificationForLink(link),
      automaticClassificationConfidence: link.automaticClassificationConfidence ?? link.classificationConfidence ?? link.confidence ?? null,
      automaticClassificationReasons: link.automaticClassificationReasons ?? link.classificationReasons ?? [],
      classificationBreakdown: {
        filename: link.classificationBreakdown?.filename ?? [],
        content: link.classificationBreakdown?.content ?? [],
        metadata: link.classificationBreakdown?.metadata ?? [],
        manual: [`Staff manually classified as ${attachmentClassificationLabel(classification)}.`],
        scores: link.classificationBreakdown?.scores ?? {},
      },
      manualOverride: true,
      confidence: 100,
      reason: `Staff manually classified as ${attachmentClassificationLabel(classification)}.`,
      learningEvidence: {
        inboundRecordId: selectedRecord.id,
        attachmentKey: key,
        attachmentId: link.fileId,
        fileRecordId: link.fileRecordId ?? null,
        senderEmail: getManualInboundEvidence(selectedRecord).senderEmail ?? null,
        senderDomain: senderDomainFromEmail(getManualInboundEvidence(selectedRecord).senderEmail),
        subject: getManualInboundEvidence(selectedRecord).subject ?? null,
        filename: link.filename ?? null,
        extension: fileExtension(link.filename),
        originalAutomaticClassification: automaticClassificationForLink(link),
        correctedManualClassification: classification,
        automaticConfidence: link.automaticClassificationConfidence ?? link.classificationConfidence ?? link.confidence ?? null,
        automaticReasons: link.automaticClassificationReasons ?? link.classificationReasons ?? [],
        capturedAt: new Date().toISOString(),
        userId: null,
        note: "Manual correction captured for future classification learning.",
      },
    };
    const upsertLink = (items: InboundOrderArtworkLink[]) => {
      const found = items.some((item) => artworkLinkKey(item) === key);
      return found ? items.map((item) => artworkLinkKey(item) === key ? nextLink : item) : [...items, nextLink];
    };
    updateCleanForm({
      reviewedLineItemsJson: cleanForm.reviewedLineItemsJson.map((lineItem) => ({
        ...lineItem,
        artworkLinks: lineItem.artworkLinks.map((item) => artworkLinkKey(item) === key ? nextLink : item),
      })),
      reviewedArtworkJson: {
        ...cleanForm.reviewedArtworkJson,
        unassignedAttachments: upsertLink(cleanForm.reviewedArtworkJson.unassignedAttachments),
      },
    });
  };

  const openCleanAttachmentClassificationDialog = (link: InboundOrderArtworkLink) => {
    if (!selectedRecord) return;
    const evidence = getManualInboundEvidence(selectedRecord);
    setClassificationDialog({
      recordId: selectedRecord.id,
      link,
      customerId: cleanForm?.reviewedCustomerJson.selectedCustomerId ?? selectedRecord.matchedCustomerId ?? null,
      senderDomain: senderDomainFromEmail(evidence.senderEmail),
    });
  };

  const submitCleanAttachmentClassification = (payload: {
    classification: InboundAttachmentClassification;
    rememberForCustomer: boolean;
    matchType: AttachmentClassificationRuleMatchType;
    matchValue: string;
  }) => {
    if (!classificationDialog) return;
    const dialog = classificationDialog;
    classifyAttachmentMutation.mutate({
      recordId: dialog.recordId,
      fileId: dialog.link.fileId,
      payload: {
        classification: payload.classification,
        rememberForCustomer: payload.rememberForCustomer,
        rule: payload.rememberForCustomer
          ? {
              customerId: dialog.customerId,
              senderDomain: dialog.senderDomain,
              matchType: payload.matchType,
              matchValue: payload.matchValue,
            }
          : null,
      },
    }, {
      onSuccess: () => {
        overrideCleanAttachmentClassification(dialog.link, payload.classification);
        setClassificationDialog(null);
      },
    });
  };

  const toggleQueueRecordSelected = (recordId: string, selected: boolean) => {
    setSelectedQueueRecordIds((current) => {
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };
  const toggleQueueRecordIdsSelected = (recordIds: string[], selected: boolean) => {
    setSelectedQueueRecordIds((current) => {
      const next = new Set(current);
      for (const recordId of recordIds) {
        if (selected) next.add(recordId);
        else next.delete(recordId);
      }
      return next;
    });
  };

  const allVisibleQueueRecordsSelected = records.length > 0 && records.every((record) => selectedQueueRecordIds.has(record.id));
  const toggleAllVisibleQueueRecordsSelected = (selected: boolean) => {
    toggleQueueRecordIdsSelected(records.map((record) => record.id), selected);
  };

  const runBulkQueueAction = (action: InboundQueueCleanupAction) => {
    const recordIds = Array.from(selectedQueueRecordIds);
    if (recordIds.length === 0 || bulkQueueActionMutation.isPending) return;
    if (action === "trust_sender" || action === "trust_domain") {
      const selectedRecords = records.filter((record) => selectedQueueRecordIds.has(record.id));
      const values = new Set<string>();
      for (const record of selectedRecords) {
        const evidence = getManualInboundEvidence(record);
        const email = evidence.senderEmail?.trim().toLowerCase() ?? "";
        const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
        const value = action === "trust_sender" ? email : domain;
        if (value) values.add(value);
      }
      const label = action === "trust_sender" ? "sender email" : "sender domain";
      const summary = Array.from(values).slice(0, 8).join(", ");
      const confirmed = window.confirm(
        `Trust ${values.size} ${label}${values.size === 1 ? "" : "s"} from ${recordIds.length} selected record(s)? Future emails from these ${label}${values.size === 1 ? "" : "s"} may auto-download allowed attachments. No attachments will download immediately.\n\n${summary}${values.size > 8 ? ", ..." : ""}`,
      );
      if (!confirmed) return;
    }
    const note = window.prompt(`Optional note for ${recordIds.length} selected inbound record(s):`);
    if (note === null) return;
    const cleanNote = trimToNull(note);
    if (action === "delete") {
      const confirmed = window.confirm("Remove selected TEMP_INBOUND review records from the operational queue? Source emails, audit logs, and converted orders will not be deleted.");
      if (!confirmed) return;
    }
    bulkQueueActionMutation.mutate({ recordIds, action, note: cleanNote });
  };
  const openCombineDialog = () => {
    const selectedRecords = records.filter((record) => selectedQueueRecordIds.has(record.id));
    if (selectedRecords.length < 2) return;
    const suggestedPrimary = [...selectedRecords].sort((left, right) => {
      const leftEvidence = getManualInboundEvidence(left);
      const rightEvidence = getManualInboundEvidence(right);
      const leftHasOrderText = Number(Boolean(leftEvidence.bodyText?.trim() || leftEvidence.subject?.trim()));
      const rightHasOrderText = Number(Boolean(rightEvidence.bodyText?.trim() || rightEvidence.subject?.trim()));
      if (leftHasOrderText !== rightHasOrderText) return rightHasOrderText - leftHasOrderText;
      return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
    })[0];
    setCombinePrimaryRecordId(suggestedPrimary?.id ?? null);
    setCombineCustomerMismatchConfirmed(false);
    setCombineMultipleDraftsConfirmed(false);
    setCombineDialogOpen(true);
  };
  const submitCombineRecords = () => {
    const recordIds = Array.from(selectedQueueRecordIds);
    if (recordIds.length < 2 || !combinePrimaryRecordId) return;
    combineInboundRecordsMutation.mutate({
      recordIds,
      primaryRecordId: combinePrimaryRecordId,
      confirmCustomerMismatch: combineCustomerMismatchConfirmed,
      confirmMultipleDrafts: combineMultipleDraftsConfirmed,
    });
  };
  const openAttachToExistingOrder = (recordId: string) => {
    setSelectedId(recordId);
    setAttachInboundRecordId(recordId);
    setAttachOrderSearch("");
    setAttachOrderId(null);
    setAttachIncludeMessageHistory(true);
    setAttachIncludeAttachments(true);
    setAttachIncludeParsedNotes(true);
    setAttachIncludeJunkAttachments(false);
    setAttachCustomerMismatchConfirmed(false);
    setAttachArtworkAssignments({});
  };
  const submitAttachToExistingOrder = () => {
    if (!attachInboundRecordId || !attachOrderId) return;
    attachInboundToOrderMutation.mutate({
      inboundRecordId: attachInboundRecordId,
      orderId: attachOrderId,
      includeMessageHistory: attachIncludeMessageHistory,
      includeAttachments: attachIncludeAttachments,
      includeParsedNotes: attachIncludeParsedNotes,
      includeJunkAttachments: attachIncludeJunkAttachments,
      confirmCustomerMismatch: attachCustomerMismatchConfirmed,
      artworkAssignments: Object.entries(attachArtworkAssignments).map(([fileId, assignment]) => ({ fileId, ...assignment })),
    });
  };
  const convertSelectedRecordToOrder = async ({ draft, blockers }: DraftOrderConversionAttempt) => {
    if (!selectedId) {
      toast({
        title: "Draft order was not created",
        description: "Select an inbound record before creating a draft order.",
        variant: "destructive",
      });
      return;
    }
    if (convertToOrderMutation.isPending) return;
    if (blockers.length > 0) {
      toast({
        title: "Draft order is not ready",
        description: blockers.slice(0, 3).join(" "),
        variant: "destructive",
      });
      return;
    }
    const artworkBypassed = draft.reviewedArtworkJson.status === "to_follow"
      && !draft.reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
    if (artworkBypassed) {
      const confirmed = window.confirm("Create this order without artwork? Artwork is still required, and the order will remain flagged for prepress/artwork follow-up.");
      if (!confirmed) return;
    }
    await convertToOrderMutation.mutateAsync({ recordId: selectedId, draft });
  };
  const convertSelectedRecordToQuote = async () => {
    if (!selectedId || convertToQuoteMutation.isPending) return;
    await convertToQuoteMutation.mutateAsync(selectedId);
  };

  const startResize = (
    panel: "queue" | "evidence" | "draft",
    event: ReactMouseEvent<HTMLButtonElement>,
    options?: { queueCollapsedOverride?: boolean },
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startingQueueWidth = queueExpandedWidth;
    const startingEvidenceWidth = evidenceWidth;
    const startingDraftWidth = draftWidth;
    const measuredWidth = getMeasuredWorkspaceWidth(workspaceWidth);
    const layoutQueueCollapsed = options?.queueCollapsedOverride ?? queueCollapsed;
    const availablePanelWidth = getWorkspaceAvailablePanelWidth({ queueCollapsed: layoutQueueCollapsed, queueExpandedWidth, workspaceWidth: measuredWidth });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (panel === "queue") {
        setQueueExpandedWidth(clampWorkspaceWidth(
          startingQueueWidth + delta,
          workspaceLayoutDefaults.minQueueExpandedWidth,
          workspaceLayoutDefaults.maxQueueExpandedWidth,
        ));
        return;
      }
      const minimums = getWorkspacePanelMinimums({ queueCollapsed: layoutQueueCollapsed, queueExpandedWidth, workspaceWidth: measuredWidth });
      if (panel === "evidence") {
        const nextEvidenceWidth = clampWorkspaceWidth(
          startingEvidenceWidth + delta,
          minimums.evidence,
          Math.max(minimums.evidence, availablePanelWidth - minimums.draft),
        );
        setEvidenceWidth(nextEvidenceWidth);
        setDraftWidth(Math.max(minimums.draft, Math.round(availablePanelWidth - nextEvidenceWidth)));
        return;
      }
      const nextDraftWidth = clampWorkspaceWidth(
        startingDraftWidth - delta,
        minimums.draft,
        Math.max(minimums.draft, availablePanelWidth - minimums.evidence),
      );
      setDraftWidth(nextDraftWidth);
      setEvidenceWidth(Math.max(minimums.evidence, Math.round(availablePanelWidth - nextDraftWidth)));
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const restoreLayout = () => {
    setQueueCollapsed(false);
    setQueueExpandedWidth(workspaceLayoutDefaults.queueExpandedWidth);
    setEvidenceWidth(workspaceLayoutDefaults.evidenceWidth);
    setDraftWidth(workspaceLayoutDefaults.draftWidth);
  };

  const expandEvidence = () => {
    setQueueCollapsed(true);
    setEvidenceWidth(720);
    setDraftWidth(workspaceLayoutDefaults.minDraftWidth);
  };

  const expandDraftBuilder = () => {
    setQueueCollapsed(true);
    setEvidenceWidth(workspaceLayoutDefaults.minEvidenceWidth);
    setDraftWidth(720);
  };

  const pageError = getErrorTone(
    (listQuery.error as Error | null)
      || (detailQuery.error as Error | null)
      || (draftPreviewQuery.error as Error | null),
  );
  const listError = getErrorTone(listQuery.error as Error | null);
  const queueWidth = getWorkspaceQueueWidth(queueCollapsed, queueExpandedWidth);
  const pullLatestEmails = async () => {
    if (inboundEmailFeatureDisabled || inboundEmailPullPaused || pullLatestEmailsMutation.isPending) return;
    try {
      const result = await pullLatestEmailsMutation.mutateAsync();
      toast({
        title: "Email pull complete",
        description: `${result.summary.created} created, ${result.summary.skippedDuplicates} duplicate(s) skipped, ${result.summary.ignored} ignored, ${result.summary.failed} failed.`,
      });
    } catch (error) {
      toast({
        title: "Email pull unavailable",
        description: error instanceof Error ? error.message : "Failed to pull latest inbound emails.",
        variant: "destructive",
      });
    }
  };
  const attachInboundRecord = attachInboundRecordId === selectedRecord?.id ? selectedRecord : null;
  const attachInboundFiles = dedupeAttachmentFiles(
    attachInboundRecordId === selectedRecord?.id ? detailQuery.data?.data.files ?? [] : [],
  );
  const attachArtworkFiles = attachInboundFiles.filter((file) => (
    classificationForLink(artworkLinkFromInboundFile(file, "unresolved")) === "ARTWORK"
  ));
  const attachAttachmentCounts = attachInboundFiles.reduce<Record<string, number>>((counts, file) => {
    const classification = classificationForLink(artworkLinkFromInboundFile(file, "unresolved"));
    counts[classification] = (counts[classification] ?? 0) + 1;
    return counts;
  }, {});
  const attachSelectedOrder = attachSelectedOrderQuery.data;
  const attachCustomerMismatch = Boolean(
    attachInboundRecord?.matchedCustomerId
      && attachSelectedOrder?.customerId
      && attachInboundRecord.matchedCustomerId !== attachSelectedOrder.customerId,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold tracking-normal text-foreground">Inbound Orders</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {inboundEmailPullPaused && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Email Pull Paused</Badge>
            )}
            <div className="flex rounded-md border border-border bg-muted/30 p-1" aria-label="Inbound review view mode">
              <Button
                type="button"
                size="sm"
                variant={reviewMode === "operational" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setReviewMode("operational")}
              >
                Operational View
              </Button>
              <Button
                type="button"
                size="sm"
                variant={reviewMode === "clean" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setReviewMode("clean")}
              >
                Clean View
              </Button>
              <Button
                type="button"
                size="sm"
                variant={reviewMode === "debug" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setReviewMode("debug")}
              >
                Debug View
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void pullLatestEmails(); }}
              disabled={inboundEmailFeatureDisabled || inboundEmailPullPaused || pullLatestEmailsMutation.isPending}
              title={
                inboundEmailFeatureDisabled
                  ? "Inbound email intake is disabled for this organization."
                  : inboundEmailPullPaused
                    ? "Inbound email pulling is paused."
                    : "Pull latest inbound emails."
              }
            >
              {pullLatestEmailsMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {inboundEmailPullPaused ? "Email Pull Paused" : "Pull Latest Emails"}
            </Button>
            <Button type="button" size="sm" onClick={() => setManualDialogOpen(true)} disabled={inboundEmailFeatureDisabled || Boolean(listError)}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                listQuery.refetch();
                if (selectedId) detailQuery.refetch();
                if (selectedId) draftPreviewQuery.refetch();
                if (selectedId) reviewDraftQuery.refetch();
              }}
              disabled={inboundEmailFeatureDisabled || listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching || reviewDraftQuery.isFetching}
            >
              {listQuery.isFetching || detailQuery.isFetching || draftPreviewQuery.isFetching || reviewDraftQuery.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
        {pageError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Inbound queue unavailable</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        )}
        {inboundEmailFeatureDisabled && (
          <Alert className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Inbound email intake disabled</AlertTitle>
            <AlertDescription>
              Inbound email intake is disabled for this organization. Email pulls are stopped and the review workspace is unavailable until an admin enables the feature.
            </AlertDescription>
          </Alert>
        )}
        {!inboundEmailFeatureDisabled && inboundEmailPullPaused && (
          <Alert className="mt-3 border-amber-200 bg-amber-50 text-amber-900">
            <Clock className="h-4 w-4" />
            <AlertTitle>Email Pull Paused</AlertTitle>
            <AlertDescription>
              New email pulling is paused for testing or maintenance. Existing inbound records remain available for review, parsing, and conversion.
            </AlertDescription>
          </Alert>
        )}
        {lastConvertedOrderId && (
          <Alert className="mt-3">
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Draft order created</AlertTitle>
            <AlertDescription>
              <a className="font-medium text-primary underline" href={`/orders/${lastConvertedOrderId}`}>
                Open order {lastConvertedOrderNumber ?? lastConvertedOrderId}
              </a>
            </AlertDescription>
          </Alert>
        )}
      </header>

      {inboundEmailFeatureDisabled ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
          <div className="max-w-lg rounded-md border border-border bg-muted/20 p-6 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-4 text-base font-semibold text-foreground">Inbound intake is disabled</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No scheduled or manual email pulls will run. Existing TEMP_INBOUND records are retained and can be accessed again after the feature is enabled.
            </p>
          </div>
        </div>
      ) : reviewMode === "clean" ? (
        <div
          ref={workspaceRef}
          className="relative flex min-h-0 w-full max-w-none flex-1 overflow-hidden bg-slate-950 min-[1024px]:flex-row"
          data-testid="clean-inbound-workspace"
          style={{
            "--workspace-queue-width": `${queueExpandedWidth}px`,
            "--workspace-evidence-width": `${cleanPanelWidths.evidenceWidth}px`,
            "--workspace-draft-width": `${cleanPanelWidths.draftWidth}px`,
          } as CSSProperties}
        >
          <section
            className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden min-[1024px]:h-full"
            data-testid="clean-queue-panel"
            style={{
              width: `${queueExpandedWidth}px`,
              flex: `0 0 ${queueExpandedWidth}px`,
            } as CSSProperties}
          >
            <CleanInboundQueue
              records={records}
              selectedId={selectedId}
              filters={queueFilters}
              searchValue={queueSearchText}
              summary={queueSummary}
              isLoading={listQuery.isLoading || listQuery.isFetching}
              selectedRecordIds={selectedQueueRecordIds}
              isBulkActionPending={bulkQueueActionMutation.isPending}
              onSelect={setSelectedId}
              onChange={applyQueueFilters}
              onSearchChange={updateQueueSearchText}
              onToggleSelected={toggleQueueRecordSelected}
              onToggleVisibleSelected={toggleQueueRecordIdsSelected}
              onBulkAction={runBulkQueueAction}
              onCombineSelected={openCombineDialog}
              onAttachToExistingOrder={openAttachToExistingOrder}
            />
            <button
              type="button"
              className="absolute right-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-slate-500 hover:bg-slate-800/80 min-[1024px]:flex"
              onMouseDown={(event) => startResize("queue", event)}
              aria-label="Resize queue panel"
              title="Drag to resize queue"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </section>
          <section
            className="relative flex min-h-0 min-w-0 flex-col overflow-hidden min-[1024px]:h-full"
            data-testid="clean-source-panel"
            style={{ flex: `1 1 ${cleanPanelWidths.evidenceWidth}px` } as CSSProperties}
          >
            <CleanSourceDocuments
              selectedRecord={selectedRecord}
              detail={detailQuery.data?.data}
              draftPreview={draftPreviewQuery.data?.data}
              reviewDraft={reviewDraftQuery.data?.data}
              activeTab={sourceDocumentTab}
              isLoading={detailQuery.isLoading}
              isParsing={isSelectedRecordParsing}
              isRescanning={isSelectedRecordRescanning}
              parseDisabled={isParseInFlight || selectedRecordIsTerminal}
              rescanDisabled={emailReprocessMutation.isPending || selectedRecordIsTerminal || selectedRecord?.sourceType !== "email"}
              parseError={parseMutation.error as Error | null}
              parseCompletedWithoutDraft={selectedId === parseCompletedWithoutDraftRecordId}
              parseCompletedWithoutDraftMessage={selectedId === parseCompletedWithoutDraftRecordId ? parseCompletedWithoutDraftMessage : null}
              sourceChanged={Boolean(selectedId && sourceChangedByRecordId[selectedId])}
              onTabChange={setSourceDocumentTab}
              onParse={runParseForSelectedRecord}
              onRescan={runSourceRescanForSelectedRecord}
              attachmentLinks={cleanAttachmentLinks}
              onClassifyAttachment={openCleanAttachmentClassificationDialog}
              onBulkClassifyAttachments={(fileIds, classification) => {
                if (!selectedRecord) return;
                bulkClassifyAttachmentsMutation.mutate({ recordId: selectedRecord.id, fileIds, classification });
              }}
              isBulkClassifying={bulkClassifyAttachmentsMutation.isPending}
              form={cleanForm}
              activeTarget={cleanActiveTarget}
              onFocusTarget={focusCleanTarget}
              inlineAttachmentSelection={cleanInlineAttachmentSelection}
              onOpenAttachment={(recordId, file) => {
                setCleanInlineAttachmentSelection({ recordId, file });
              }}
              onCloseInlineAttachment={() => setCleanInlineAttachmentSelection(null)}
              onAttachToExistingOrder={openAttachToExistingOrder}
            />
            <button
              type="button"
              className="absolute right-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-slate-500 hover:bg-slate-800/80 min-[1024px]:flex"
              onMouseDown={(event) => startResize("evidence", event, { queueCollapsedOverride: false })}
              aria-label="Resize evidence panel"
              title="Drag to resize source documents"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </section>
          <section
            className="relative flex min-h-0 min-w-0 flex-col overflow-hidden min-[1024px]:h-full"
            data-testid="clean-workstation-panel"
            style={{ flex: `1.1 1 ${cleanPanelWidths.draftWidth}px` } as CSSProperties}
          >
            <button
              type="button"
              className="absolute left-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-slate-500 hover:bg-slate-800/80 min-[1024px]:flex"
              onMouseDown={(event) => startResize("draft", event, { queueCollapsedOverride: false })}
              aria-label="Resize draft builder panel"
              title="Drag to resize order workstation"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <CleanOrderWorkstation
              selectedRecord={selectedRecord}
              draftPreview={draftPreviewQuery.data?.data}
              reviewDraft={reviewDraftQuery.data?.data}
              detail={detailQuery.data?.data}
              isLoading={detailQuery.isLoading || draftPreviewQuery.isLoading || reviewDraftQuery.isLoading}
              isSaving={saveReviewDraftMutation.isPending}
              isMarkingReady={markReviewDraftReadyMutation.isPending}
              isReopening={reopenReviewDraftMutation.isPending}
              isConverting={convertToOrderMutation.isPending || convertToQuoteMutation.isPending}
              markReadyError={markReviewDraftReadyMutation.error as (Error & { errors?: string[] }) | null}
              convertError={convertToOrderMutation.error as (Error & { errors?: string[] }) | null}
              quoteError={convertToQuoteMutation.error as (Error & { errors?: string[] }) | null}
              isRejecting={rejectInboundOrderMutation.isPending}
              isCleaningUp={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending}
              rejectDisabled={rejectInboundOrderMutation.isPending || ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}
              onSave={async (draft) => {
                if (!selectedId) return;
                await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
              }}
              onMarkReady={async (draft, dirty) => {
                if (!selectedId) return;
                if (dirty) await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
                await markReviewDraftReadyMutation.mutateAsync(selectedId);
              }}
              onReopen={async () => {
                if (!selectedId) return;
                await reopenReviewDraftMutation.mutateAsync(selectedId);
              }}
              onConvert={convertSelectedRecordToOrder}
              onConvertQuote={async () => {
                if (!selectedId) return;
                if (cleanForm && selectedReviewDraftHasUnsavedEdits) {
                  await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft: cleanForm });
                }
                await convertSelectedRecordToQuote();
              }}
              onReject={rejectSelectedRecord}
              onQueueAction={runQueueCleanupAction}
              onDirtyChange={handleReviewDraftDirtyChange}
              form={cleanForm}
              updateForm={updateCleanForm}
              activeTarget={cleanActiveTarget}
              onFocusTarget={focusCleanTarget}
              onOpenAttachment={(recordId, file) => {
                setSourceDocumentTab(file.role === "po" || isLikelyPoEvidenceFile(file) ? "po" : "artwork");
                setCleanInlineAttachmentSelection({ recordId, file });
              }}
            />
          </section>
          <AttachmentClassificationDialog
            state={classificationDialog}
            isSubmitting={classifyAttachmentMutation.isPending}
            onOpenChange={(open) => {
              if (!open && !classifyAttachmentMutation.isPending) setClassificationDialog(null);
            }}
            onSubmit={submitCleanAttachmentClassification}
          />
        </div>
      ) : (
        <>
      <div
        ref={workspaceRef}
        className="relative flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden min-[1024px]:flex-row"
        data-testid="inbound-review-workspace"
        style={{
          "--workspace-queue-width": `${queueWidth}px`,
          "--workspace-evidence-width": `${effectivePanelWidths.evidenceWidth}px`,
          "--workspace-draft-width": `${effectivePanelWidths.draftWidth}px`,
        } as CSSProperties}
      >
        {queueDrawerOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/30 min-[1024px]:hidden"
            aria-label="Close inbound queue drawer"
            onClick={() => setQueueDrawerOpen(false)}
          />
        )}
        <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-2.5 shadow-sm backdrop-blur min-[1024px]:hidden">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2"
            onClick={() => {
              setQueueCollapsed(false);
              setQueueDrawerOpen(true);
            }}
            aria-label="Open inbound queue"
          >
            <Inbox className="mr-2 h-4 w-4" />
            Queue
            <Badge variant="outline" className="ml-2">{records.length}</Badge>
          </Button>
          <div className="grid min-w-[12rem] grid-cols-2 rounded-md border border-border bg-muted/40 p-1 shadow-inner" aria-label="Responsive inbound workspace panel">
            <Button
              type="button"
              size="sm"
              variant={responsivePanel === "email" ? "default" : "ghost"}
              className="h-7 justify-center px-3 text-xs font-semibold"
              onClick={() => setResponsivePanel("email")}
            >
              {reviewMode === "operational" ? "Docs" : "Evidence"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={responsivePanel === "review" ? "default" : "ghost"}
              className="h-7 justify-center px-3 text-xs font-semibold"
              onClick={() => setResponsivePanel("review")}
            >
              Workstation
            </Button>
          </div>
        </div>
        <section
          className={cn(
            queueDrawerOpen
              ? "fixed inset-y-0 left-0 z-50 flex w-[min(360px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] bg-background shadow-2xl"
              : "hidden",
            "min-w-0 shrink-0 flex-col overflow-hidden border-b border-border min-[1024px]:relative min-[1024px]:inset-auto min-[1024px]:z-auto min-[1024px]:flex min-[1024px]:h-full min-[1024px]:w-[var(--workspace-queue-width)] min-[1024px]:min-w-[var(--workspace-queue-width)] min-[1024px]:max-w-[var(--workspace-queue-width)] min-[1024px]:shadow-none min-[1024px]:border-b-0 min-[1024px]:border-r",
            queueCollapsed ? "h-14 min-[1024px]:h-full" : "min-h-[300px] flex-1 min-[1024px]:min-h-0 min-[1024px]:flex-none",
          )}
          data-testid="inbound-queue-panel"
          style={{
            width: queueDrawerOpen ? "min(360px, calc(100vw - 1rem))" : `${queueWidth}px`,
            flex: queueDrawerOpen ? "0 0 min(360px, calc(100vw - 1rem))" : `0 0 ${queueWidth}px`,
          } as CSSProperties}
        >
          {queueCollapsed ? (
            <div className="flex h-14 items-center gap-3 px-3 py-2 min-[1024px]:h-full min-[1024px]:flex-col min-[1024px]:px-2 min-[1024px]:py-3" aria-label="Collapsed inbound queue">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setQueueCollapsed(false)}
                aria-label="Expand inbound queue"
                title="Expand queue"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted">
                <Inbox className="h-4 w-4 text-muted-foreground" />
              </div>
              <Badge variant="outline">{records.length}</Badge>
            </div>
          ) : (
            <>
              <div className="flex h-12 items-center justify-between border-b border-border px-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Queue</div>
                  <div className="text-[11px] text-muted-foreground">{records.length} active</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{records.length}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden h-8 w-8 p-0 min-[1024px]:inline-flex"
                    onClick={() => setQueueCollapsed(true)}
                    aria-label="Collapse inbound queue"
                    title="Collapse queue"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1024px]:hidden"
                    onClick={() => setQueueDrawerOpen(false)}
                    aria-label="Close inbound queue"
                    title="Close queue"
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <QueueTriageControls
                  filters={queueFilters}
                  searchValue={queueSearchText}
                  summary={queueSummary}
                  isLoading={listQuery.isFetching}
                  onChange={applyQueueFilters}
                  onSearchChange={updateQueueSearchText}
                />
                {records.length > 0 && (
                  <div className="border-b border-border bg-background px-3 py-2">
                    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={allVisibleQueueRecordsSelected}
                        onChange={(event) => toggleAllVisibleQueueRecordsSelected(event.target.checked)}
                        aria-label="Select all filtered inbound records"
                      />
                      Select all filtered records
                      <Badge variant="outline">{records.length}</Badge>
                    </label>
                  </div>
                )}
                {selectedQueueRecordIds.size > 0 && (
                  <div className="border-b border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{selectedQueueRecordIds.size} selected</Badge>
                      {selectedQueueRecordIds.size === 1 && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={attachInboundToOrderMutation.isPending}
                          onClick={() => openAttachToExistingOrder(Array.from(selectedQueueRecordIds)[0])}
                        >
                          Attach to Existing Order
                        </Button>
                      )}
                      {selectedQueueRecordIds.size >= 2 && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={combineInboundRecordsMutation.isPending}
                          onClick={openCombineDialog}
                        >
                          Combine Emails
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("trust_sender")}
                      >
                        Trust Sender
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("trust_domain")}
                      >
                        Trust Domain
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("ignore_once")}
                      >
                        Ignore Once
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("ignore_sender")}
                      >
                        Ignore Sender
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("ignore_domain")}
                      >
                        Ignore Domain
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("reject")}
                      >
                        Reject
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={bulkQueueActionMutation.isPending}
                        onClick={() => runBulkQueueAction("delete")}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  {listQuery.isLoading ? (
                    <QueueSkeleton />
                  ) : (
                    <InboundQueuePanel
                      records={records}
                      selectedId={selectedId}
                      selectedRecordIds={selectedQueueRecordIds}
                      onSelect={setSelectedId}
                      onToggleSelected={toggleQueueRecordSelected}
                      onTrustAction={runRecordTrustAction}
                    />
                  )}
                </div>
              </div>
            </>
          )}
          {!queueCollapsed && (
            <button
              type="button"
              className="absolute right-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 min-[1024px]:flex"
              onMouseDown={(event) => startResize("queue", event)}
              aria-label="Resize queue panel"
              title="Drag to resize queue"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
        </section>

        <section
          className={cn(
            "relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-border min-[1024px]:flex min-[1024px]:h-full min-[1024px]:basis-[var(--workspace-evidence-width)] min-[1024px]:border-b-0 min-[1024px]:border-r min-[1500px]:min-w-[420px]",
            responsivePanel === "email" ? "flex" : "hidden",
          )}
          data-testid="inbound-evidence-panel"
          style={{ flex: `1 1 ${effectivePanelWidths.evidenceWidth}px` } as CSSProperties}
        >
          <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 px-2.5 py-1.5 backdrop-blur min-[1024px]:static min-[1024px]:px-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 truncate text-sm font-semibold text-foreground">
              {reviewMode === "operational" ? (
                <>
                  Source Documents
                  <span className="sr-only"> Source Evidence</span>
                </>
              ) : "Source Evidence"}
              </div>
              <div className="flex shrink-0 items-center gap-1">
              {reviewMode === "operational" && selectedRecord && (
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" className="h-8 px-3 text-xs font-semibold shadow-sm min-[1024px]:h-7 min-[1024px]:px-2" onClick={() => runParseForSelectedRecord()} disabled={isParseInFlight || selectedRecordIsTerminal}>
                    {isSelectedRecordParsing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    Parse<span className="sr-only"> with AI</span>
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="hidden h-7 px-2 text-xs min-[1500px]:inline-flex" onClick={() => runQueueCleanupAction("ignore_once")} disabled={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}>
                    Ignore
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="hidden h-7 px-2 text-xs min-[1500px]:inline-flex" onClick={rejectSelectedRecord} disabled={rejectInboundOrderMutation.isPending || ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal} aria-label="Reject inbound record">
                    {rejectInboundOrderMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Reject
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="hidden h-7 px-2 text-xs min-[1500px]:inline-flex" onClick={() => runQueueCleanupAction("delete")} disabled={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <details className="group relative min-[1500px]:hidden">
                    <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      Actions
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute right-0 top-9 z-30 grid w-56 gap-1 rounded-md border border-border bg-popover p-1.5 shadow-xl">
                      <Button type="button" size="sm" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={() => runEmailReprocessAction(selectedRecord, "backfill_attachments")} disabled={emailReprocessMutation.isPending || selectedRecordIsTerminal}>
                        Backfill Attachments
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={() => runEmailReprocessAction(selectedRecord, "reprocess_email")} disabled={emailReprocessMutation.isPending || selectedRecordIsTerminal}>
                        Reprocess
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={() => runQueueCleanupAction("ignore_once")} disabled={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}>
                        Ignore Once
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={rejectSelectedRecord} disabled={rejectInboundOrderMutation.isPending || ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}>
                        Reject
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={() => runQueueCleanupAction("delete")} disabled={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}>
                        Delete
                      </Button>
                    </div>
                  </details>
                </div>
              )}
              {selectedRecord && <Badge variant="secondary" className="hidden min-[1500px]:inline-flex">{titleCase(selectedRecord.sourceType)}</Badge>}
              <Button type="button" variant="ghost" size="sm" className="hidden h-8 w-8 p-0 min-[1500px]:inline-flex" onClick={expandEvidence} aria-label="Expand evidence panel" title={reviewMode === "operational" ? "Expand email" : "Expand evidence"}>
                <Maximize2 className="h-4 w-4" />
              </Button>
              </div>
            </div>
            {reviewMode === "operational" && (
              <div className="mt-1 flex min-w-0 rounded-md border border-border bg-muted/30 p-0.5" aria-label="Source document tabs">
                {([
                  ["email", "Email"],
                  ["po", "PO"],
                  ["artwork", "Artwork"],
                  ["history", "History"],
                ] as Array<[SourceDocumentTab, string]>).map(([tab, label]) => (
                  <Button
                    key={tab}
                    type="button"
                    size="sm"
                    variant={sourceDocumentTab === tab ? "default" : "ghost"}
                    className="h-7 flex-1 px-2 text-[11px] font-semibold"
                    onClick={() => setSourceDocumentTab(tab)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
            </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {reviewMode === "operational" ? (
              <OperationalEmailPanel
                detail={detailQuery.data?.data}
                selectedRecord={selectedRecord}
                isLoading={detailQuery.isLoading}
                latestAttempt={draftPreviewQuery.data?.data.latestAttempt ?? null}
                draftPreview={draftPreviewQuery.data?.data}
                parseError={parseMutation.error as Error | null}
                isParsing={isSelectedRecordParsing}
                activeTab={sourceDocumentTab}
                onEmailReprocess={runEmailReprocessAction}
                isEmailReprocessing={emailReprocessMutation.isPending}
              />
            ) : (
              <SourceEvidencePanel
                detail={detailQuery.data?.data}
                selectedRecord={selectedRecord}
                isLoading={detailQuery.isLoading}
                latestAttempt={draftPreviewQuery.data?.data.latestAttempt ?? null}
                draftPreview={draftPreviewQuery.data?.data}
                parseError={parseMutation.error as Error | null}
                isParsing={isSelectedRecordParsing}
                parseDisabled={isParseInFlight || selectedRecordIsTerminal}
                isRejecting={rejectInboundOrderMutation.isPending}
                isCleaningUp={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending}
                rejectDisabled={rejectInboundOrderMutation.isPending || ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}
                onParse={runParseForSelectedRecord}
                onReject={rejectSelectedRecord}
                onQueueAction={runQueueCleanupAction}
                onTrustAction={runRecordTrustAction}
                onEmailReprocess={runEmailReprocessAction}
                isEmailReprocessing={emailReprocessMutation.isPending}
              />
            )}
          </div>
          <button
            type="button"
            className="absolute right-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 min-[1024px]:flex"
            onMouseDown={(event) => startResize("evidence", event)}
            aria-label="Resize evidence panel"
            title="Drag to resize evidence"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </section>

        <section
          className={cn(
            "relative min-h-0 min-w-0 flex-[1.1_1_0] flex-col overflow-hidden min-[1024px]:flex min-[1024px]:h-full min-[1024px]:basis-[var(--workspace-draft-width)] min-[1500px]:min-w-[480px]",
            responsivePanel === "review" ? "flex" : "hidden",
          )}
          data-testid="inbound-draft-panel"
          style={{ flex: `1.1 1 ${effectivePanelWidths.draftWidth}px` } as CSSProperties}
        >
          <button
            type="button"
            className="absolute left-[-7px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 min-[1024px]:flex"
            onMouseDown={(event) => startResize("draft", event)}
            aria-label="Resize draft builder panel"
            title="Drag to resize draft builder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="sticky top-0 z-20 flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-2.5 backdrop-blur min-[1024px]:static min-[1024px]:h-9 min-[1024px]:px-3">
            <div className="text-sm font-semibold text-foreground">
              {reviewMode === "operational" ? (
                <>
                  Order Workstation
                  <span className="sr-only"> Draft Builder</span>
                </>
              ) : "Draft Builder"}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={expandDraftBuilder} aria-label="Expand draft builder panel" title="Expand draft builder">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={restoreLayout} aria-label="Restore inbound workspace layout" title="Restore layout">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Badge variant="outline">Phase 4</Badge>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <DraftBuilderPanel
              mode={reviewMode}
              selectedRecord={selectedRecord}
              detail={detailQuery.data?.data}
              isLoading={detailQuery.isLoading || draftPreviewQuery.isLoading || reviewDraftQuery.isLoading}
              draftPreview={draftPreviewQuery.data?.data}
              reviewDraft={reviewDraftQuery.data?.data}
              previewError={draftPreviewQuery.error as Error | null}
              reviewDraftError={reviewDraftQuery.error as Error | null}
              isSaving={saveReviewDraftMutation.isPending}
              isMarkingReady={markReviewDraftReadyMutation.isPending}
              isReopening={reopenReviewDraftMutation.isPending}
              isRefreshingFromLatestParse={refreshReviewDraftFromLatestParseMutation.isPending}
              isConverting={convertToOrderMutation.isPending}
              saveError={(saveReviewDraftMutation.error ?? refreshReviewDraftFromLatestParseMutation.error) as Error | null}
              markReadyError={markReviewDraftReadyMutation.error as (Error & { errors?: string[] }) | null}
              convertError={convertToOrderMutation.error as (Error & { errors?: string[] }) | null}
              parseDisabled={isParseInFlight || selectedRecordIsTerminal}
              isParsing={isSelectedRecordParsing}
              onSave={async (draft) => {
                if (!selectedId) return;
                await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
              }}
              onMarkReady={async (draft, dirty) => {
                if (!selectedId) return;
                if (dirty) {
                  await saveReviewDraftMutation.mutateAsync({ recordId: selectedId, draft });
                }
                await markReviewDraftReadyMutation.mutateAsync(selectedId);
              }}
              onReopen={async () => {
                if (!selectedId) return;
                await reopenReviewDraftMutation.mutateAsync(selectedId);
              }}
              onRefreshFromLatestParse={async () => {
                if (!selectedId) return;
                await refreshReviewDraftFromLatestParseMutation.mutateAsync(selectedId);
              }}
              onConvert={convertSelectedRecordToOrder}
              onParse={runParseForSelectedRecord}
              isRejecting={rejectInboundOrderMutation.isPending}
              isCleaningUp={ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending}
              rejectDisabled={rejectInboundOrderMutation.isPending || ignoreInboundOrderMutation.isPending || deleteInboundQueueRecordMutation.isPending || selectedRecordIsTerminal}
              onReject={rejectSelectedRecord}
              onQueueAction={runQueueCleanupAction}
              onDirtyChange={handleReviewDraftDirtyChange}
            />
          </div>
        </section>
      </div>

      <ManualIntakeDialog
        open={manualDialogOpen}
        isCreating={createManualMutation.isPending}
        error={createManualMutation.error as Error | null}
        onClose={() => setManualDialogOpen(false)}
        onCreate={(payload) => createManualMutation.mutateAsync(payload).then(() => undefined)}
      />
      <Dialog open={Boolean(attachInboundRecordId)} onOpenChange={(open) => { if (!open) setAttachInboundRecordId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attach inbound job to existing order</DialogTitle>
            <DialogDescription>
              This links the source record and selected files to an existing order. It does not create a quote or a new order.
            </DialogDescription>
          </DialogHeader>
          {!attachInboundRecord ? (
            <div className="py-6 text-sm text-muted-foreground">Loading inbound record details…</div>
          ) : (
            <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-1">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{getManualInboundEvidence(attachInboundRecord).subject || getRecordTitle(attachInboundRecord)}</div>
                <div className="mt-1 text-muted-foreground">{getManualInboundEvidence(attachInboundRecord).senderEmail || "Unknown sender"} · {formatRelative(attachInboundRecord.receivedAt)}</div>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                Search active order
                <Input value={attachOrderSearch} onChange={(event) => setAttachOrderSearch(event.target.value)} placeholder="Order number, customer, contact, job label, or PO number" />
              </label>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                {attachOrderSearchQuery.isLoading ? <div className="p-2 text-sm text-muted-foreground">Searching orders…</div> : (attachOrderSearchQuery.data?.data ?? [])
                  .filter((order) => order.status !== "cancelled")
                  .map((order) => (
                    <label key={order.id} className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted">
                      <input type="radio" name="attach-order" checked={attachOrderId === order.id} onChange={() => setAttachOrderId(order.id)} />
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{order.orderNumber || order.id}</span>
                        <span className="ml-2 text-muted-foreground">{order.customer?.companyName || "No customer"}{order.label ? ` · ${order.label}` : ""}{order.poNumber ? ` · PO ${order.poNumber}` : ""}</span>
                      </span>
                    </label>
                  ))}
                {!attachOrderSearchQuery.isLoading && (attachOrderSearchQuery.data?.data ?? []).length === 0 && <div className="p-2 text-sm text-muted-foreground">No matching active orders.</div>}
              </div>
              {attachCustomerMismatch && (
                <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <Checkbox checked={attachCustomerMismatchConfirmed} onCheckedChange={(checked) => setAttachCustomerMismatchConfirmed(checked === true)} />
                  <span>The inbound record customer differs from the selected order customer. I confirmed this is the intended order.</span>
                </label>
              )}
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">Include</div>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <label className="flex items-center gap-2"><Checkbox checked={attachIncludeMessageHistory} onCheckedChange={(checked) => setAttachIncludeMessageHistory(checked === true)} />Email/message history</label>
                  <label className="flex items-center gap-2"><Checkbox checked={attachIncludeAttachments} onCheckedChange={(checked) => setAttachIncludeAttachments(checked === true)} />Attachments ({attachInboundFiles.length})</label>
                  <label className="flex items-center gap-2"><Checkbox checked={attachIncludeParsedNotes} onCheckedChange={(checked) => setAttachIncludeParsedNotes(checked === true)} />Parsed notes</label>
                  <label className="flex items-center gap-2"><Checkbox checked={attachIncludeJunkAttachments} onCheckedChange={(checked) => setAttachIncludeJunkAttachments(checked === true)} />Include junk/signature files</label>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Artwork {attachAttachmentCounts.ARTWORK ?? 0} · PO {attachAttachmentCounts.PO ?? 0} · Reference {attachAttachmentCounts.REFERENCE ?? 0} · Other {(attachAttachmentCounts.OTHER ?? 0) + (attachAttachmentCounts.IGNORE_INLINE ?? 0)}
                </div>
              </div>
              {attachIncludeAttachments && attachArtworkFiles.length > 0 && (
                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium">Artwork line item assignment</div>
                  <div className="mt-1 text-xs text-muted-foreground">Optional. Unassigned artwork remains attached to the order without replacing any existing artwork.</div>
                  <div className="mt-3 space-y-2">
                    {attachArtworkFiles.map((file) => {
                      const assignment = attachArtworkAssignments[file.id] ?? { orderLineItemId: null, side: "na" as const };
                      return (
                        <div key={file.id} className="grid gap-2 rounded border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.8fr)_100px]">
                          <div className="truncate text-sm font-medium">{file.sourceFilename || "Artwork file"}</div>
                          <select className="h-8 rounded-md border bg-background px-2 text-xs" value={assignment.orderLineItemId ?? ""} onChange={(event) => setAttachArtworkAssignments((current) => ({ ...current, [file.id]: { ...assignment, orderLineItemId: event.target.value || null } }))}>
                            <option value="">Leave unassigned</option>
                            {(attachSelectedOrder?.lineItems ?? []).map((lineItem: any) => <option key={lineItem.id} value={lineItem.id}>{lineItem.description || lineItem.product?.name || `Line item ${lineItem.id}`}</option>)}
                          </select>
                          <select className="h-8 rounded-md border bg-background px-2 text-xs" value={assignment.side} onChange={(event) => setAttachArtworkAssignments((current) => ({ ...current, [file.id]: { ...assignment, side: event.target.value as "front" | "back" | "na" } }))}>
                            <option value="na">Unassigned side</option><option value="front">Front</option><option value="back">Back</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {attachInboundToOrderMutation.error && <Alert variant="destructive"><AlertDescription>{(attachInboundToOrderMutation.error as Error).message}</AlertDescription></Alert>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAttachInboundRecordId(null)} disabled={attachInboundToOrderMutation.isPending}>Cancel</Button>
            <Button type="button" onClick={submitAttachToExistingOrder} disabled={!attachInboundRecord || !attachOrderId || attachInboundToOrderMutation.isPending || (attachCustomerMismatch && !attachCustomerMismatchConfirmed)}>
              {attachInboundToOrderMutation.isPending ? "Attaching…" : "Attach to selected order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={combineDialogOpen} onOpenChange={setCombineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Combine selected emails into one job</DialogTitle>
            <DialogDescription>
              Keep one inbound record as the parent. The other records will be retained as merged sources, removed from the active queue, and their attachments will appear on the parent job.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              {selectedQueueRecordIds.size} selected emails. The combined job will be marked <strong>Reparse recommended</strong> before it can be converted.
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Primary job and draft to keep
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={combinePrimaryRecordId ?? ""}
                onChange={(event) => setCombinePrimaryRecordId(event.target.value || null)}
              >
                {records.filter((record) => selectedQueueRecordIds.has(record.id)).map((record) => {
                  const evidence = getManualInboundEvidence(record);
                  const label = evidence.subject || evidence.senderEmail || record.sourceLabel || record.id;
                  return <option key={record.id} value={record.id}>{label} · {new Date(record.receivedAt).toLocaleString()}</option>;
                })}
              </select>
            </label>
            {new Set(records.filter((record) => selectedQueueRecordIds.has(record.id)).map((record) => record.matchedCustomerId).filter(Boolean)).size > 1 && (
              <label className="flex items-start gap-2 text-sm text-amber-700">
                <Checkbox checked={combineCustomerMismatchConfirmed} onCheckedChange={(checked) => setCombineCustomerMismatchConfirmed(checked === true)} />
                <span>I confirmed these emails have different matched customers and should still be combined.</span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox checked={combineMultipleDraftsConfirmed} onCheckedChange={(checked) => setCombineMultipleDraftsConfirmed(checked === true)} />
              <span>I understand the selected primary record is the draft to continue reviewing. Other source drafts remain preserved on their source records.</span>
            </label>
            {combineInboundRecordsMutation.error && (
              <Alert variant="destructive">
                <AlertDescription>{(combineInboundRecordsMutation.error as Error).message}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCombineDialogOpen(false)} disabled={combineInboundRecordsMutation.isPending}>Cancel</Button>
            <Button
              type="button"
              onClick={submitCombineRecords}
              disabled={!combinePrimaryRecordId || combineInboundRecordsMutation.isPending}
            >
              {combineInboundRecordsMutation.isPending ? "Combining…" : "Combine into one job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
