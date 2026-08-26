import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, History, FileText, Download, ZoomIn, Upload, Image as ImageIcon, Info, Paperclip, CheckCircle, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  canCompleteAndReleasePrepress,
  completeAndReleasePrepress,
  markPrepressItemsPrintReady,
  PrepressCompleteAndReleaseError,
  requestCompletePrepressSession,
  requestReleasePrepressLineItem,
} from "@/lib/prepressActions";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { PrepressFileThumbnail as FileThumbnail } from "@/components/prepress/PrepressFileThumbnail";
import { AttachmentViewerDialog, type AttachmentData } from "@/components/AttachmentViewerDialog";
import { PrintTicketActions } from "@/components/production/PrintTicketActions";
import { PrepressArtworkSideBadge } from "@/components/prepress/PrepressArtworkSideBadge";
import { PrepressArtworkSideSelect } from "@/components/prepress/PrepressArtworkSideSelect";
import { ProductionAlertsPanel } from "@/components/production/ProductionAlertsPanel";
import {
  type ProductionAlertSeverity,
  type ProductionAlertStation,
  type ProductionAlertType,
  useCreateProductionAlert,
  useCreatePrepressProductionRun,
  useProductionAlertPresets,
  useProductionAlerts,
  useProductionRuns,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import type { PrepressQueueItem, PrepressQueueWorkflowState } from "@/hooks/useOrders";
import { usePageVisible } from "@/hooks/usePageVisible";
import {
  DEFAULT_PREPRESS_LIST_PREFERENCES,
  persistPrepressListPreferences,
  readPersistedPrepressListPreferences,
  type PrepressDestinationFilter,
  type PrepressListPreferences,
  type PrepressListSortBy,
  type PrepressStatusFilter,
} from "@/lib/prepressListPreferences";
import {
  buildFileUploadDisplayFilename,
  numericJobNumberFromFull,
  type FileUploadNamingPolicy,
  type PrepressFileLabel,
} from "@shared/fileUploadNaming";
import { resolveProductionArtworkSideReadiness } from "@shared/productionHydration";
import { buildArtworkAllocationStatus } from "@shared/artworkAllocation";
import { getMediaFitWarning } from "@shared/mediaFit";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";
import { canSelectPrepressCombinedRunItem, getPrepressCombinedRunItemBlocker, validatePrepressCombinedRunSelection } from "@/lib/prepressCombinedRuns";
import { buildPrepressSheetPlanDisplay, formatPrepressSheetPlanUnavailableReason } from "@/lib/prepressSheetPlan";
import {
  buildCombinedRunSheetPlanRecommendation,
  snapshotCombinedRunSheetPlan,
  type CombinedRunSheetPlanInputs,
} from "@/lib/combinedRunSheetPlan";
import { ProductionRunPanel } from "@/features/production/ProductionRunPanel";

function promotionTagToPrepressLabel(tag: string): PrepressFileLabel {
  if (tag === "final_print" || tag === "print") return "print";
  if (tag === "cut_file" || tag === "cut") return "cut_file";
  if (tag === "proof_only" || tag === "proof") return "proof";
  return "none";
}

type LineItemFile = {
  id: string;
  role: "original" | "final" | "reference";
  originalFilename: string;
  sizeBytes: number;
  tag: string | null;
  createdAt: string;
  uploadedBy: string;
  computedDisplayFilename?: string;
  originalUrl?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbnailAvailabilityStatus?: "available" | "pending" | "missing" | "failed";
  previewAvailabilityStatus?: "available" | "pending" | "missing";
  mimeType?: string;
  artworkSide?: "front" | "back" | "both" | "na";
  productionQuantity?: number | null;
  productionGroupId?: string | null;
};

type BridgedOriginalFile = {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  role: string;
  side: "front" | "back" | "both" | "na";
  productionQuantity?: number | null;
  productionGroupId?: string | null;
  createdAt: string;
  source: "order_attachment";
  prepressCategory: "original_customer" | "proof" | "final_production" | "reference";
  systemGenerated: boolean;
  tagLabel: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  uploadedBy: string | null;
  displayFilename?: string | null;
  computedDisplayFilename?: string | null;
};

type LineItemFilesPayload = {
  originals: LineItemFile[];
  finals: LineItemFile[];
  references: LineItemFile[];
  bridgedOriginals: BridgedOriginalFile[];
  proofs: BridgedOriginalFile[];
};

type VisibleFileCategory = "original_customer" | "bridged_original" | "proof" | "final_production";

type VisibleFileRecord = AttachmentData & {
  category: VisibleFileCategory;
  displayName: string;
  uploadedByLabel: string;
  tagLabel: string;
  downloadUrl: string;
  sizeBytesValue: number | null;
  sideLabel: "front" | "back" | "both" | "na";
  artworkAssignmentFileId: string;
  artworkAssignable: boolean;
  thumbnailAvailabilityStatus?: "available" | "pending" | "missing" | "failed";
  productionQuantity?: number | null;
  productionGroupId?: string | null;
};

type CombinedRunArtworkCandidate = {
  id: string;
  sourceKind: "line_item_original" | "order_attachment";
  sourceId: string;
  label: string;
  uploadedByLabel: string;
  sideLabel: "front" | "back" | "both" | "na";
  sizeBytesValue: number | null;
};

function normalizeCombinedRunArtworkSide(value: unknown): CombinedRunArtworkCandidate["sideLabel"] {
  return value === "front" || value === "back" || value === "both" ? value : "na";
}

function buildCombinedRunArtworkCandidates(payload: LineItemFilesPayload | null | undefined): CombinedRunArtworkCandidate[] {
  if (!payload) return [];
  const originals = (payload.originals ?? []).map((file) => ({
    id: `line_item_original:${file.id}`,
    sourceKind: "line_item_original" as const,
    sourceId: file.id,
    label: file.computedDisplayFilename || file.originalFilename || "Customer artwork",
    uploadedByLabel: file.uploadedBy || "Staff upload",
    sideLabel: normalizeCombinedRunArtworkSide(file.artworkSide),
    sizeBytesValue: Number.isFinite(Number(file.sizeBytes)) ? Number(file.sizeBytes) : null,
  }));
  const bridged = (payload.bridgedOriginals ?? [])
    .filter((file) => file.prepressCategory === "original_customer" && file.role === "artwork")
    .map((file) => ({
      id: `order_attachment:${file.id}`,
      sourceKind: "order_attachment" as const,
      sourceId: file.id,
      label: file.computedDisplayFilename || file.displayFilename || file.originalFilename || "Customer artwork",
      uploadedByLabel: file.uploadedBy || "Customer upload",
      sideLabel: normalizeCombinedRunArtworkSide(file.side),
      sizeBytesValue: file.sizeBytes != null ? Number(file.sizeBytes) : null,
    }));
  return [...originals, ...bridged];
}

type PendingViewerRequest = {
  lineItemId: string;
  preferredFileId?: string | null;
};

type PrepressQueueResponse = {
  items: PrepressQueueItem[];
  totalCount: number;
  filteredCount: number;
};

const PREPRESS_SORT_LABELS: Record<PrepressListSortBy, string> = {
  due_date: "Due Date",
  job_number: "Job #",
  client: "Client",
  type: "Type",
  material: "Material",
};

const PREPRESS_DESTINATION_LABELS: Record<PrepressDestinationFilter, string> = {
  all: "All",
  roll: "Roll",
  flatbed: "Flatbed",
};

const PREPRESS_STATUS_LABELS: Record<PrepressStatusFilter, string> = {
  all: "All",
  ready_for_prepress: "Ready for Prepress",
  in_prepress: "In Prepress",
};

function formatOwnerLabel(item: Pick<PrepressQueueItem, "activeOwnerStepKey" | "activeOwnerStationKey"> | null | undefined) {
  const rawValue = item?.activeOwnerStepKey || item?.activeOwnerStationKey;
  return rawValue ? rawValue.replace(/_/g, " ") : null;
}

function normalizeArtworkSideLabel(side: unknown) {
  if (side === "front") return "Front";
  if (side === "back") return "Back";
  if (side === "both") return "Both sides";
  return "Side not assigned";
}

function ArtworkProductionBreakdownList({
  item,
  compact = false,
  showHeader = false,
  onUpdateQuantity,
  updating = false,
}: {
  item: PrepressQueueItem | null | undefined;
  compact?: boolean;
  showHeader?: boolean;
  onUpdateQuantity?: (fileId: string, productionQuantity: number | null) => void;
  updating?: boolean;
}) {
  const breakdown = item?.artworkProductionBreakdown;
  const designs = breakdown?.designs ?? [];
  if (!item || designs.length === 0) {
    if (!showHeader) return null;
    return (
      <div className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs text-slate-400">
        <div className="font-bold uppercase tracking-widest text-slate-400">Artwork Production Breakdown</div>
        <div className="mt-1">No artwork allocation is available yet.</div>
      </div>
    );
  }
  return (
    <div className={cn(showHeader ? "rounded border border-[#2d3748] bg-[#0f172a] p-3" : "", "text-xs")}>
      {showHeader ? (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-bold uppercase tracking-widest text-slate-400">Artwork Production Breakdown</div>
            <div className="mt-1 text-slate-500">
              Assigned {breakdown?.allocatedTotal ?? 0} of {breakdown?.requiredQuantity ?? item.quantity} ordered pieces.
            </div>
          </div>
          <span className={cn(
            "rounded border px-2 py-1 text-[11px] font-semibold",
            breakdown?.valid ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-100",
          )}>
            {breakdown?.valid ? "Production art ready" : breakdown?.productionArtStatus || "Needs input"}
          </span>
        </div>
      ) : null}
      {breakdown?.issue ? (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
          {breakdown.issue}
        </div>
      ) : null}
      <div className={cn("grid gap-2", compact ? "" : "md:grid-cols-2")}>
        {designs.map((design) => (
          <div key={design.id} className={cn("flex min-w-0 items-center gap-2", showHeader ? "rounded border border-[#2d3748] bg-[#111921] p-2" : "")}>
            {!compact ? (
              <FileThumbnail
                fileId={design.source === "final_production" ? design.id : undefined}
                filename={design.filename || "Artwork design"}
                mimeType={design.mimeType || undefined}
                thumbnailUrl={design.thumbnailUrl || undefined}
                compact
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-slate-100">{design.filename || "Artwork design"}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                <span>{design.productionArtStatus}</span>
                <span>{normalizeArtworkSideLabel(design.side)}</span>
              </div>
            </div>
            {onUpdateQuantity && breakdown?.source === "final_production" ? (
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                <span>Qty</span>
                <Input
                  key={`${design.id}:${design.productionQuantity ?? "unresolved"}`}
                  aria-label={`Production quantity for ${design.filename || "artwork design"}`}
                  defaultValue={design.productionQuantity ?? ""}
                  inputMode="numeric"
                  disabled={updating}
                  className="h-7 w-16 border-[#2d3748] bg-[#111921] px-2 text-xs text-slate-100"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  onBlur={(event) => {
                    const raw = event.currentTarget.value.trim();
                    const nextQuantity = raw ? Number(raw) : null;
                    if (nextQuantity !== (design.productionQuantity ?? null)) onUpdateQuantity(design.id, nextQuantity);
                  }}
                />
              </label>
            ) : (
              <div className="shrink-0 rounded border border-[#2d3748] px-2 py-1 font-mono text-[11px] font-semibold text-slate-100">
                QTY {formatArtworkQuantity(design.productionQuantity)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getPrepressWorkflowDisplay(item: Pick<PrepressQueueItem, "workflowState" | "hasCompletedSession" | "productionReleaseBlockedReason"> | null | undefined) {
  if (item?.productionReleaseBlockedReason) {
    return {
      label: "Awaiting Proof Approval",
      bgClass: "bg-amber-500/15",
      textClass: "text-amber-300",
      borderClass: "border-amber-500/40",
      note: "Completion and release blocked",
    };
  }
  const workflowState = String(item?.workflowState || "ready_for_prepress").toLowerCase() as PrepressQueueWorkflowState;

  if (workflowState === "in_prepress") {
    return {
      label: "In Prepress",
      bgClass: "bg-[#1773cf]/20",
      textClass: "text-[#1773cf]",
      borderClass: "border-[#1773cf]/30",
      note: item?.hasCompletedSession ? "Session complete" : null,
    };
  }

  return {
    label: "Ready for Prepress",
    bgClass: "bg-slate-700",
    textClass: "text-slate-300",
    borderClass: "border-[#2d3748]",
    note: null,
  };
}

type HistoryEntry = {
  at: string;
  source: string;
  type: string;
  description: string;
};

type SpecSheetData = {
  lineItemId: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  quantity: number;
  width: number | null;
  height: number | null;
  sqFootage: number | null;
  media: string | null;
  printType: string | null;
  productionDestination?: string | null;
  suggestedProductionDestination?: string | null;
  bleed: string | null;
  finishingBullets: string[];
  optionsRows?: Array<{
    groupLabel?: string | null;
    optionLabel: string;
    selectedLabel: string;
    isDefault?: boolean;
  }>;
  lineItemNotes?: string | null;
  priorityLabel?: string | null;
  originals: LineItemFile[];
  finals: LineItemFile[];
  references: LineItemFile[];
  proofs?: BridgedOriginalFile[];
  printSides?: "Single-sided" | "Double-sided" | "Unknown";
  useSameArtworkBothSides?: boolean;
  sameArtworkFileId?: string | null;
};

type UploadProgress = {
  id: string;
  filename: string;
  progress: number;
};

type PlannedMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  basis: string;
  sources: Array<{ optionLabel: string; choiceLabel: string }>;
};

type EffectiveMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  isOverridden?: boolean;
};

type MaterialOverrideOp =
  | {
      op: "replace";
      fromMaterialId: string;
      toMaterialId: string;
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    }
  | {
      op: "add" | "adjust_qty";
      materialId: string;
      qty: number;
      uom: "sqft" | "ft" | "each";
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    }
  | {
      op: "remove";
      materialId: string;
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    };

type MaterialsEffectivePayload = {
  plannedMaterials: PlannedMaterial[];
  effectiveMaterials: EffectiveMaterial[];
  effectiveFingerprint: string;
  overrides: MaterialOverrideOp[];
  pricingReviewRequired: boolean;
  overrideMode: "prepress_only" | "prepress_and_production";
  overrideAllowed: boolean;
  overrideBlockedReason?: string | null;
};

type MaterialsAvailabilityPayload = {
  effectiveFingerprint: string;
  allAvailable: boolean;
  items: Array<{
    materialId: string;
    materialName?: string;
    uom: "sqft" | "ft" | "each";
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    isAvailable: boolean;
  }>;
};

// Utility to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatElapsedDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatPrepressTagLabel(tag: string | null | undefined, defaultTag: string): string {
  const normalized = String(tag || "").trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return defaultTag === "final" ? "No label" : defaultTag;
  }
  if (normalized === "final_print" || normalized === "print") return "Print";
  if (normalized === "proof_only" || normalized === "proof") return "Proof";
  if (normalized === "cut_file" || normalized === "cut") return "Cut File";
  return tag || defaultTag;
}

function formatArtworkQuantity(value: number | null | undefined): string {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? `${quantity}` : "Unresolved";
}

function formatSheetPlanNumber(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "Not calculated";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.?0+$/, "");
}

function positiveSheetNumber(value: string): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeSheetNumber(value: string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}
const PREPRESS_QUEUE_QUERY_KEY = ["/api/prepress/queue"] as const;
const EMPTY_PREPRESS_QUEUE: PrepressQueueItem[] = [];
type PrepressCombinedRunStatusFilter = "attention" | "active" | "draft" | "ready_for_production" | "in_production" | "completed" | "canceled" | "all";
type PrepressWorkspaceTab = "queue" | "runs";
type CombinedRunWizardStep = 1 | 2 | 3 | 4;

const PREPRESS_PANE_WIDTH_STORAGE_KEY = "prepress.workspace.leftPanePercent.v1";
const PREPRESS_LEFT_PANE_DEFAULT_PERCENT = 36;
const PREPRESS_LEFT_PANE_MIN_PERCENT = 24;
const PREPRESS_LEFT_PANE_MAX_PERCENT = 55;

function getPrepressLineItemQueryKey(lineItemId: string | null) {
  return ["/api/prepress/line-item", lineItemId] as const;
}

function clampPrepressPanePercent(value: number) {
  if (!Number.isFinite(value)) return PREPRESS_LEFT_PANE_DEFAULT_PERCENT;
  return Math.min(PREPRESS_LEFT_PANE_MAX_PERCENT, Math.max(PREPRESS_LEFT_PANE_MIN_PERCENT, value));
}

function readPersistedPrepressPanePercent() {
  if (typeof window === "undefined") return PREPRESS_LEFT_PANE_DEFAULT_PERCENT;
  const raw = window.localStorage.getItem(PREPRESS_PANE_WIDTH_STORAGE_KEY);
  return clampPrepressPanePercent(raw == null ? PREPRESS_LEFT_PANE_DEFAULT_PERCENT : Number(raw));
}

function productionRunNeedsPrepressAttention(run: ProductionRunListItem): boolean {
  if (run.runStatus === "completed" || run.runStatus === "canceled") return false;
  if (run.runStatus === "draft") return true;
  if (run.replacementRequired || (run.fileCount ?? 0) === 0) return true;
  const plannedPlacements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  if (plannedPlacements > 0 && plannedPlacements !== run.totalAllocatedQuantity) return true;
  if (run.files?.some((file) => file.localBridge?.status === "failed" || file.localBridge?.unsafeToRetire)) return true;
  return false;
}

function filterPrepressCombinedRuns(
  runs: ProductionRunListItem[],
  input: { search: string; status: PrepressCombinedRunStatusFilter; includeHistory: boolean },
): ProductionRunListItem[] {
  const search = input.search.trim().toLowerCase();
  return runs.filter((run) => {
    if (!input.includeHistory && (run.runStatus === "completed" || run.runStatus === "canceled")) return false;
    if (input.status === "attention" && !productionRunNeedsPrepressAttention(run)) return false;
    if (input.status === "active" && (run.runStatus === "completed" || run.runStatus === "canceled")) return false;
    if (!["attention", "active", "all"].includes(input.status) && run.runStatus !== input.status) return false;
    if (!search) return true;
    const haystack = [
      run.displayNumber,
      run.orderNumber,
      run.customerName,
      run.stationKey,
      run.runStatus,
      ...run.members.flatMap((member) => [member.description, member.lineNumber ? `line ${member.lineNumber}` : ""]),
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });
}

export default function PrepressProductionPageV2() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisible();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSelectedTagManuallyRef = useRef(false);
  const userId = user?.id ?? null;
  const normalizedUserRole = String((user as any)?.orgRole || user?.role || "").toLowerCase();
  const canRemoveProductionFiles = ["owner", "admin", "manager"].includes(normalizedUserRole) || (user as any)?.isAdmin === true;
  const canRepairArtworkRelationships = ["owner", "admin"].includes(normalizedUserRole) || (user as any)?.isAdmin === true;
  
  // UI State
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [selectedQueueLineItemIds, setSelectedQueueLineItemIds] = useState<Set<string>>(() => new Set());
  const [workspaceTab, setWorkspaceTab] = useState<PrepressWorkspaceTab>("queue");
  const [leftPanePercent, setLeftPanePercent] = useState(() => readPersistedPrepressPanePercent());
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const [combinedRunOpen, setCombinedRunOpen] = useState(false);
  const [combinedRunWizardStep, setCombinedRunWizardStep] = useState<CombinedRunWizardStep>(1);
  const [combinedRunAllocations, setCombinedRunAllocations] = useState<Record<string, string>>({});
  const [combinedRunProductionQuantityDrafts, setCombinedRunProductionQuantityDrafts] = useState<Record<string, string>>({});
  const [combinedRunProductionQuantityErrors, setCombinedRunProductionQuantityErrors] = useState<Record<string, string>>({});
  const [combinedRunPlannedSheetCount, setCombinedRunPlannedSheetCount] = useState("");
  const [combinedRunPiecesPerSheet, setCombinedRunPiecesPerSheet] = useState("");
  const [combinedRunSheetWidth, setCombinedRunSheetWidth] = useState("");
  const [combinedRunSheetHeight, setCombinedRunSheetHeight] = useState("");
  const [combinedRunAllowRotation, setCombinedRunAllowRotation] = useState(false);
  const [combinedRunBleed, setCombinedRunBleed] = useState("0");
  const [combinedRunSpacing, setCombinedRunSpacing] = useState("0");
  const [combinedRunMarginTop, setCombinedRunMarginTop] = useState("0");
  const [combinedRunMarginRight, setCombinedRunMarginRight] = useState("0");
  const [combinedRunMarginBottom, setCombinedRunMarginBottom] = useState("0");
  const [combinedRunMarginLeft, setCombinedRunMarginLeft] = useState("0");
  const [combinedRunManualSheetOverride, setCombinedRunManualSheetOverride] = useState(false);
  const [combinedRunSheetPlanOverrideReason, setCombinedRunSheetPlanOverrideReason] = useState("");
  const [combinedRunSheetPlanOverrideInputKey, setCombinedRunSheetPlanOverrideInputKey] = useState<string | null>(null);
  const [combinedRunNotes, setCombinedRunNotes] = useState("");
  const [combinedRunOverrideReason, setCombinedRunOverrideReason] = useState("");
  const [combinedRunMismatchAcknowledged, setCombinedRunMismatchAcknowledged] = useState(false);
  const [combinedRunSheetPlanStaleMessage, setCombinedRunSheetPlanStaleMessage] = useState<string | null>(null);
  const [combinedRunFileStrategy, setCombinedRunFileStrategy] = useState<"rip_managed" | "manual_upload_after_create">("rip_managed");
  const [combinedRunSearchQuery, setCombinedRunSearchQuery] = useState("");
  const [combinedRunStatusFilter, setCombinedRunStatusFilter] = useState<PrepressCombinedRunStatusFilter>("attention");
  const [combinedRunIncludeHistory, setCombinedRunIncludeHistory] = useState(false);
  const [combinedRunArtworkByLineItem, setCombinedRunArtworkByLineItem] = useState<Record<string, CombinedRunArtworkCandidate[]>>({});
  const [combinedRunArtworkSelections, setCombinedRunArtworkSelections] = useState<Record<string, string>>({});
  const [combinedRunArtworkErrors, setCombinedRunArtworkErrors] = useState<Record<string, string>>({});
  const [combinedRunArtworkLoading, setCombinedRunArtworkLoading] = useState(false);
  const [combinedRunArtworkAssigning, setCombinedRunArtworkAssigning] = useState(false);
  const [combinedRunArtworkResolverLineItemId, setCombinedRunArtworkResolverLineItemId] = useState<string | null>(null);
  const [selectedCombinedRunId, setSelectedCombinedRunId] = useState<string | null>(null);
  const [combinedRunDetailOpen, setCombinedRunDetailOpen] = useState(false);
  const [focusNestedFileUpload, setFocusNestedFileUpload] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [destinationFilter, setDestinationFilter] = useState<PrepressDestinationFilter>(DEFAULT_PREPRESS_LIST_PREFERENCES.destination);
  const [statusFilter, setStatusFilter] = useState<PrepressStatusFilter>(DEFAULT_PREPRESS_LIST_PREFERENCES.status);
  const [rushFilter, setRushFilter] = useState(DEFAULT_PREPRESS_LIST_PREFERENCES.rush);
  const [sortBy, setSortBy] = useState<PrepressListSortBy>(DEFAULT_PREPRESS_LIST_PREFERENCES.sortBy);
  const [sortAsc, setSortAsc] = useState(DEFAULT_PREPRESS_LIST_PREFERENCES.sortDirection === "asc");
  const [preferencesHydratedForUserId, setPreferencesHydratedForUserId] = useState<string | null>(null);
  const [prepressNotes, setPrepressNotes] = useState("");
  const [flagForQc, setFlagForQc] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [productionAlertOpen, setProductionAlertOpen] = useState(false);
  const [productionAlertTitle, setProductionAlertTitle] = useState("");
  const [productionAlertPresetId, setProductionAlertPresetId] = useState("manual");
  const [productionAlertType, setProductionAlertType] = useState<ProductionAlertType>("general_warning");
  const [productionAlertSeverity, setProductionAlertSeverity] = useState<ProductionAlertSeverity>("warning");
  const [productionAlertStations, setProductionAlertStations] = useState<ProductionAlertStation[]>(["all"]);
  const [productionAlertMessage, setProductionAlertMessage] = useState("");
  const [uploadRole, setUploadRole] = useState<"original" | "final">("final");
  const [filePendingRemoval, setFilePendingRemoval] = useState<VisibleFileRecord | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [selectedTag, setSelectedTag] = useState("none");
  const [promotionSourceFile, setPromotionSourceFile] = useState<VisibleFileRecord | null>(null);
  const [promotionTag, setPromotionTag] = useState("final_print");
  const [uploadingFiles, setUploadingFiles] = useState<UploadProgress[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [specSheetOpen, setSpecSheetOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [pendingViewerRequest, setPendingViewerRequest] = useState<PendingViewerRequest | null>(null);
  const [materialOverrideOpen, setMaterialOverrideOpen] = useState(false);
  const [materialOverrideMode, setMaterialOverrideMode] = useState<"replace" | "add" | "remove" | "adjust_qty">("replace");
  const [overrideFromMaterialId, setOverrideFromMaterialId] = useState("");
  const [overrideToMaterialId, setOverrideToMaterialId] = useState("");
  const [overrideMaterialId, setOverrideMaterialId] = useState("");
  const [overrideQty, setOverrideQty] = useState("");
  const [overrideUom, setOverrideUom] = useState<"sqft" | "ft" | "each">("sqft");
  const [overrideReasonNote, setOverrideReasonNote] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const normalizedSearchQuery = searchQuery.trim();
  const preferencesReady = !!userId && preferencesHydratedForUserId === userId;
  const currentListPreferences = useMemo<PrepressListPreferences>(
    () => ({
      destination: destinationFilter,
      status: statusFilter,
      rush: rushFilter,
      sortBy,
      sortDirection: sortAsc ? "asc" : "desc",
    }),
    [destinationFilter, rushFilter, sortAsc, sortBy, statusFilter],
  );

  useEffect(() => {
    if (!userId) {
      setPreferencesHydratedForUserId(null);
      return;
    }

    const persistedPreferences = readPersistedPrepressListPreferences(userId);
    setDestinationFilter(persistedPreferences.destination);
    setStatusFilter(persistedPreferences.status);
    setRushFilter(persistedPreferences.rush);
    setSortBy(persistedPreferences.sortBy);
    setSortAsc(persistedPreferences.sortDirection === "asc");
    persistPrepressListPreferences(userId, persistedPreferences);
    setPreferencesHydratedForUserId(userId);
  }, [userId]);

  useEffect(() => {
    if (!preferencesReady || !userId) return;
    persistPrepressListPreferences(userId, currentListPreferences);
  }, [currentListPreferences, preferencesReady, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREPRESS_PANE_WIDTH_STORAGE_KEY, String(leftPanePercent));
  }, [leftPanePercent]);

  const updateLeftPanePercentFromClientX = React.useCallback((clientX: number) => {
    const frame = workspaceFrameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minPxPercent = Math.min(PREPRESS_LEFT_PANE_MAX_PERCENT, (320 / rect.width) * 100);
    const nextPercent = (clientX - rect.left) / rect.width * 100;
    setLeftPanePercent(Math.min(PREPRESS_LEFT_PANE_MAX_PERCENT, Math.max(minPxPercent, clampPrepressPanePercent(nextPercent))));
  }, []);

  const handlePaneDividerPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    updateLeftPanePercentFromClientX(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => updateLeftPanePercentFromClientX(moveEvent.clientX);
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handlePaneDividerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") {
      setLeftPanePercent(PREPRESS_LEFT_PANE_MIN_PERCENT);
      return;
    }
    if (event.key === "End") {
      setLeftPanePercent(PREPRESS_LEFT_PANE_MAX_PERCENT);
      return;
    }
    setLeftPanePercent((current) => clampPrepressPanePercent(current + (event.key === "ArrowRight" ? 2 : -2)));
  };

  const queueFilters = useMemo(
    () => ({
      destination: destinationFilter,
      status: statusFilter,
      rush: rushFilter,
      sortBy,
      sortAsc,
      search: normalizedSearchQuery,
    }),
    [destinationFilter, normalizedSearchQuery, rushFilter, sortAsc, sortBy, statusFilter],
  );

  const refreshPrepressQueue = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: PREPRESS_QUEUE_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: PREPRESS_QUEUE_QUERY_KEY, type: "active" });
  }, [queryClient]);

  const refreshPrepressNavigationCount = React.useCallback(async () => {
    const queryKey = ["/api/operational-summary"] as const;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.refetchQueries({ queryKey, type: "active" });
  }, [queryClient]);

  const refreshLineItemQueries = React.useCallback(async (lineItemId: string | null) => {
    if (!lineItemId) return;
    const queryKey = getPrepressLineItemQueryKey(lineItemId);
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.refetchQueries({ queryKey, type: "active" });
  }, [queryClient]);

  const repairArtworkRelationshipsMutation = useMutation({
    mutationFn: async ({ orderId, lineItemId }: { orderId: string; lineItemId: string }) => {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/repair-artwork-relationships`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to repair artwork relationships.");
      return payload?.data ?? {};
    },
    onSuccess: async (result, variables) => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(variables.lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/orders", variables.orderId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] }),
      ]);
      toast({
        title: "Artwork relationships repaired",
        description: `${result?.retiredRelationshipIds?.length ?? 0} duplicate mirror${(result?.retiredRelationshipIds?.length ?? 0) === 1 ? "" : "s"} retired.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Artwork relationship repair failed", description: error.message, variant: "destructive" });
    },
  });

  const refreshCombinedRunArtworkForLineItem = React.useCallback(async (lineItemId: string | null) => {
    if (!lineItemId) return;
    const res = await fetch(`/api/prepress/line-item/${lineItemId}/files`, { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      const message = body?.error || body?.message || "Unable to refresh available artwork.";
      setCombinedRunArtworkErrors((current) => ({ ...current, [lineItemId]: message }));
      return;
    }

    const candidates = buildCombinedRunArtworkCandidates(body?.data);
    setCombinedRunArtworkByLineItem((current) => ({ ...current, [lineItemId]: candidates }));
    setCombinedRunArtworkSelections((current) => {
      const currentSelection = current[lineItemId];
      const next = { ...current };
      if (currentSelection && candidates.some((candidate) => candidate.id === currentSelection)) {
        return next;
      }
      if (candidates.length === 1) {
        next[lineItemId] = candidates[0].id;
      } else {
        delete next[lineItemId];
      }
      return next;
    });
    setCombinedRunArtworkErrors((current) => {
      if (!current[lineItemId]) return current;
      const next = { ...current };
      delete next[lineItemId];
      return next;
    });
  }, []);

  // Queue Query
  const { data: queueData, isLoading: queueLoading, isFetching: queueFetching, refetch: refetchQueue } = useQuery({
    queryKey: [...PREPRESS_QUEUE_QUERY_KEY, queueFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (queueFilters.destination !== "all") params.set("destination", queueFilters.destination);
      if (queueFilters.status !== "all") params.set("status", queueFilters.status);
      if (queueFilters.rush) params.set("rush", "true");
      if (queueFilters.search) params.set("search", queueFilters.search);
      params.set("sortBy", queueFilters.sortBy);
      params.set("sortOrder", queueFilters.sortAsc ? "asc" : "desc");
      
      const res = await fetch(`/api/prepress/queue?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const data = await res.json();
      if (import.meta.env.DEV) {
        console.log("[Prepress Queue]", data.data?.length || 0, "items");
      }
      const items = (Array.isArray(data.data) ? data.data : []) as PrepressQueueItem[];
      const totalCount = Number.isFinite(Number(data.meta?.totalCount)) ? Number(data.meta.totalCount) : items.length;
      const filteredCount = Number.isFinite(Number(data.meta?.filteredCount)) ? Number(data.meta.filteredCount) : items.length;
      return { items, totalCount, filteredCount } satisfies PrepressQueueResponse;
    },
    enabled: preferencesReady,
    staleTime: 0,
    refetchInterval: (query) => {
      // Never poll in hidden tabs — no one is watching.
      if (!isPageVisible) return false;
      // Stop polling when the queue is empty; rely on manual refresh (refreshPrepressQueue) for new arrivals.
      const items = ((query.state.data as PrepressQueueResponse | undefined)?.items) ?? [];
      return items.length > 0 ? 10_000 : false;
    },
    refetchOnWindowFocus: false,
  });

  // Line Item Files Query
  const { data: filesData } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "files"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/files`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      return data.data as LineItemFilesPayload;
    },
    enabled: !!selectedLineItemId,
  });

  const { data: fileNamingPolicy } = useQuery<FileUploadNamingPolicy>({
    queryKey: ["/api/prepress/file-naming-policy"],
    queryFn: async () => {
      const res = await fetch("/api/prepress/file-naming-policy", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch file naming policy");
      const data = await res.json();
      return data.data as FileUploadNamingPolicy;
    },
  });

  const prepressFileLabelMode = fileNamingPolicy?.prepressFileLabelMode ?? "required";

  useEffect(() => {
    if (!fileNamingPolicy) return;
    if (fileNamingPolicy.prepressFileLabelMode === "required" && selectedTag === "none") {
      setSelectedTag("final_print");
      return;
    }
    if (
      fileNamingPolicy.prepressFileLabelMode === "optional" &&
      !hasSelectedTagManuallyRef.current &&
      selectedTag === "final_print"
    ) {
      setSelectedTag("none");
    }
  }, [fileNamingPolicy, selectedTag]);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "history"],
    queryFn: async () => {
      if (!selectedLineItemId) return [] as HistoryEntry[];
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      return (data.data || []) as HistoryEntry[];
    },
    enabled: !!selectedLineItemId && historyOpen,
  });

  const { data: specSheetData, isLoading: specSheetLoading } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "spec-sheet"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/spec-sheet`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch spec sheet");
      const data = await res.json();
      return data.data as SpecSheetData;
    },
    enabled: !!selectedLineItemId && specSheetOpen,
  });

  const { data: materialsEffectiveData, isLoading: materialsEffectiveLoading } = useQuery({
    queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-effective"],
    queryFn: async () => {
      if (!selectedLineItemId) {
        return {
          data: {
            plannedMaterials: [] as PlannedMaterial[],
            effectiveMaterials: [] as EffectiveMaterial[],
            effectiveFingerprint: "",
            overrides: [] as MaterialOverrideOp[],
            pricingReviewRequired: false,
            overrideMode: "prepress_and_production" as const,
            overrideAllowed: true,
            overrideBlockedReason: null,
          } as MaterialsEffectivePayload,
          message: undefined as string | undefined,
        };
      }

      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/materials-effective`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to fetch effective materials");
      }
      return {
        data: (data?.data || {
          plannedMaterials: [],
          effectiveMaterials: [],
          effectiveFingerprint: "",
          overrides: [],
          pricingReviewRequired: false,
          overrideMode: "prepress_and_production",
          overrideAllowed: true,
        }) as MaterialsEffectivePayload,
        message: typeof data?.message === "string" ? data.message : undefined,
      };
    },
    enabled: !!selectedLineItemId,
  });

  const { data: materialsAvailabilityData, isLoading: materialsAvailabilityLoading } = useQuery({
    queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-availability"],
    queryFn: async () => {
      if (!selectedLineItemId) {
        return { effectiveFingerprint: "", allAvailable: true, items: [] } as MaterialsAvailabilityPayload;
      }

      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/materials-availability`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to fetch materials availability");
      }
      return (data?.data || { effectiveFingerprint: "", allAvailable: true, items: [] }) as MaterialsAvailabilityPayload;
    },
    enabled: !!selectedLineItemId,
  });

  // Mutations
  const downloadFinalFileMutation = useMutation({
    mutationFn: ({ url, filename }: { url: string; filename: string }) => downloadAuthenticatedFile(url, filename),
    onError: (error: Error) => {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
    },
  });
  const removeFinalFileMutation = useMutation({
    mutationFn: async ({ fileId, reason }: { fileId: string; reason: string }) => {
      const res = await fetch(`/api/prepress/files/${fileId}/remove`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Unable to remove production file");
      return body.data as { replacementRequired?: boolean; alreadyRemoved?: boolean };
    },
    onSuccess: async (result) => {
      if (selectedLineItemId) {
        await Promise.all([
          refreshLineItemQueries(selectedLineItemId),
          refreshCombinedRunArtworkForLineItem(selectedLineItemId),
        ]);
      }
      await queryClient.invalidateQueries({ queryKey: PREPRESS_QUEUE_QUERY_KEY });
      setFilePendingRemoval(null);
      setRemovalReason("");
      toast({ title: result.alreadyRemoved ? "Production file already removed" : "Production file removed", description: result.replacementRequired ? "Replacement production file required before this line can be production-ready." : "The original artwork and history were preserved." });
    },
    onError: (error: Error) => toast({ title: "Production file not removed", description: error.message, variant: "destructive" }),
  });

  const startSessionMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await fetch("/api/prepress/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lineItemId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to start session");
      }
      return res.json();
    },
    onSuccess: async (response, lineItemId) => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(lineItemId),
      ]);
      toast({
        title: response?.data?.resumed ? "Prepress resumed" : "Prepress started",
        description: response?.data?.resumed ? "Existing session restored" : "Session created successfully",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ sessionId, note, flaggedForQc, issueType }: { sessionId: string; note: string; flaggedForQc: boolean; issueType: string }) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note, flaggedForQc, issueType }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to save note");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(selectedLineItemId),
      ]);
      toast({ title: "Notes saved", description: "Prepress notes updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => requestCompletePrepressSession(sessionId),
    onSuccess: async (response) => {
      const lineItemId = response?.data?.lineItemId ?? selectedLineItemId;
      await Promise.all([
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
        refreshLineItemQueries(lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
      ]);
      toast({
        title: "Prepress complete",
        description: response?.data?.stationKey
          ? `Production file finalized and routed to ${response.data.stationKey}.`
          : "Production artwork finalized and routed to the next production station.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ lineItemId, file, role, tag, sessionId }: { lineItemId: string; file: File; role: string; tag: string; sessionId?: string | null }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lineItemId", lineItemId);
      formData.append("role", role);
      if (tag) formData.append("tag", tag);
      if (sessionId) formData.append("sessionId", sessionId);

      const uploadId = Math.random().toString();
      setUploadingFiles(prev => [...prev, { id: uploadId, filename: file.name, progress: 0 }]);

      const res = await fetch("/api/prepress/files/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      setUploadingFiles(prev => prev.filter(u => u.id !== uploadId));

      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        refreshLineItemQueries(variables.lineItemId),
        refreshPrepressQueue(),
        refreshCombinedRunArtworkForLineItem(variables.lineItemId),
      ]);
      toast({ title: "Upload complete", description: "File uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const promoteCustomerArtworkMutation = useMutation({
    mutationFn: async ({ lineItemId, file, tag }: { lineItemId: string; file: VisibleFileRecord; tag: string }) => {
      const sourceKind = file.category === "bridged_original" ? "order_attachment" : "line_item_original";
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/promote-customer-artwork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind,
          sourceId: file.artworkAssignmentFileId || file.id,
          tag,
          artworkSide: file.sideLabel || "na",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || "Unable to create production artwork copy.");
      return body;
    },
    onSuccess: async (body, variables) => {
      await Promise.all([
        refreshLineItemQueries(variables.lineItemId),
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
        refreshCombinedRunArtworkForLineItem(variables.lineItemId),
      ]);
      setPromotionSourceFile(null);
      setPromotionTag("final_print");
      toast({
        title: body?.data?.created === false ? "Production artwork already exists" : "Production artwork copy created",
        description: body?.data?.file?.computedDisplayFilename || "The customer original was preserved.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Production artwork copy failed", description: error.message, variant: "destructive" });
    },
  });

  const assignCustomerArtworkMutation = useMutation({
    mutationFn: async ({ lineItemId, file, tag }: { lineItemId: string; file: VisibleFileRecord; tag: string }) => {
      const sourceKind = file.category === "bridged_original" ? "order_attachment" : "line_item_original";
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/assign-customer-artwork`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind,
          sourceId: file.artworkAssignmentFileId || file.id,
          tag,
          artworkSide: file.sideLabel || "na",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || "Unable to assign production artwork.");
      return body;
    },
    onSuccess: async (body, variables) => {
      await Promise.all([
        refreshLineItemQueries(variables.lineItemId),
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
        refreshCombinedRunArtworkForLineItem(variables.lineItemId),
      ]);
      toast({
        title: body?.data?.created === false ? "Production artwork already assigned" : "Production artwork assigned",
        description: body?.data?.file?.computedDisplayFilename || "The customer artwork now has a production role. The stored file was not copied.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Production artwork assignment failed", description: error.message, variant: "destructive" });
    },
  });

  const updateFinalArtworkAllocationMutation = useMutation({
    mutationFn: async ({ lineItemId, fileId, productionQuantity }: { lineItemId: string; fileId: string; productionQuantity: number | null }) => {
      const res = await fetch(`/api/prepress/files/${fileId}/artwork-allocation`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionQuantity }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || "Unable to update production artwork quantity.");
      }
      return { body, lineItemId };
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        refreshLineItemQueries(variables.lineItemId),
        refreshPrepressQueue(),
        refreshCombinedRunArtworkForLineItem(variables.lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] }),
      ]);
      toast({ title: "Production quantity updated", description: "Artwork allocation has been recalculated for this line." });
    },
    onError: (error: Error) => {
      toast({ title: "Production quantity update failed", description: error.message, variant: "destructive" });
    },
  });

  const saveCombinedRunProductionQuantity = async (lineItemId: string, fileId: string) => {
    const raw = (combinedRunProductionQuantityDrafts[fileId] ?? "").trim();
    const productionQuantity = raw === "" ? null : Number(raw);
    if (productionQuantity !== null && (!Number.isInteger(productionQuantity) || productionQuantity <= 0)) {
      setCombinedRunProductionQuantityErrors((current) => ({ ...current, [fileId]: "Enter a positive whole number, or leave it blank to mark the allocation unresolved." }));
      return;
    }
    setCombinedRunProductionQuantityErrors((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
    try {
      await updateFinalArtworkAllocationMutation.mutateAsync({ lineItemId, fileId, productionQuantity });
    } catch (error) {
      setCombinedRunProductionQuantityErrors((current) => ({
        ...current,
        [fileId]: error instanceof Error ? error.message : "Unable to save this production-art allocation.",
      }));
    }
  };

  // PROMPT B: Send to Print Queue mutation
  const sendToPrintMutation = useMutation({
    mutationFn: (lineItemId: string) => requestReleasePrepressLineItem(lineItemId),
    onSuccess: async (_response, lineItemId) => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
        refreshPrepressNavigationCount(),
        queryClient.invalidateQueries({ predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/orders";
        } }),
      ]);
      // Clear selection since item will move to production boards
      setSelectedLineItemId(null);
      toast({ 
        title: "Sent to print queue", 
        description: "Job is now ready for production boards" 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const assignArtworkSideMutation = useMutation({
    mutationFn: async ({ orderId, lineItemId, fileId, side }: {
      orderId: string;
      lineItemId: string;
      fileId: string;
      side: "front" | "back" | "both";
    }) => {
      const res = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/files/${fileId}/artwork-side`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ side }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to assign artwork side");
      return data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-item", variables.lineItemId, "files"] }),
        refreshPrepressQueue(),
        refreshCombinedRunArtworkForLineItem(variables.lineItemId),
      ]);
      toast({
        title: "Artwork side assigned",
        description: variables.side === "both"
          ? "The file will be used for Front and Back."
          : `Artwork assigned to ${variables.side}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Artwork assignment failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkPrintReadyMutation = useMutation({
    mutationFn: async ({ items, releaseToProduction }: { items: PrepressQueueItem[]; releaseToProduction: boolean }) =>
      markPrepressItemsPrintReady(
        items.map((item) => ({
          lineItemId: item.lineItemId,
          workflowState: item.workflowState,
          sessionId: item.sessionId,
          hasCompletedSession: item.hasCompletedSession,
          blockedReason: item.productionReleaseBlockedReason,
        })),
        { releaseToProduction },
      ),
    onSuccess: async (results) => {
      const successes = results.filter((result) => result.status !== "failed");
      const failures = results.filter((result) => result.status === "failed");
      setSelectedQueueLineItemIds((current) => {
        const next = new Set(current);
        successes.forEach((result) => next.delete(result.lineItemId));
        return next;
      });
      await Promise.all([
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
        queryClient.invalidateQueries({ predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/orders";
        } }),
      ]);
      toast({
        title: failures.length > 0 ? "Print-ready action partially completed" : "Selected lines are print-ready",
        description: failures.length > 0
          ? `${successes.length} completed; ${failures.length} blocked. ${failures.slice(0, 2).map((result) => result.message).join(" ")}`
          : `${successes.length} ${successes.length === 1 ? "line" : "lines"} completed successfully.`,
        variant: failures.length > 0 ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Print-ready action failed", description: error.message, variant: "destructive" });
    },
  });

  const completeAndReleaseMutation = useMutation({
    mutationFn: (input: Parameters<typeof completeAndReleasePrepress>[0]) => completeAndReleasePrepress(input),
    onSuccess: async (_response, variables) => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(variables.lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
        refreshPrepressNavigationCount(),
        queryClient.invalidateQueries({ predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/orders";
        } }),
      ]);
      setSelectedLineItemId(null);
      toast({
        title: "Prepress complete and released",
        description: "Job is now ready for the production board.",
      });
    },
    onError: async (error: Error, variables) => {
      const completed = error instanceof PrepressCompleteAndReleaseError && error.prepressCompleted;
      if (completed) {
        await Promise.all([
          refreshPrepressQueue(),
          refreshPrepressNavigationCount(),
          refreshLineItemQueries(variables.lineItemId),
        ]);
      }
      toast({
        title: completed ? "Prepress complete; release failed" : "Complete and release failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProductionDestinationMutation = useMutation({
    mutationFn: async ({ lineItemId, destination }: { lineItemId: string; destination: string }) => {
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/production-destination`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ destination }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update production destination");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        refreshPrepressQueue(),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
      ]);
      toast({ title: "Production destination updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyMaterialOverrideMutation = useMutation({
    mutationFn: async (op: any) => {
      if (!selectedLineItemId) throw new Error("No line item selected");
      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/material-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ op }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to apply material override");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-effective"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-availability"] });
      toast({ title: "Material override applied" });
      setMaterialOverrideOpen(false);
      setOverrideReasonNote("");
      setOverrideQty("");
      setOverrideToMaterialId("");
      setOverrideMaterialId("");
    },
    onError: (error: Error) => {
      toast({ title: "Material override failed", description: error.message, variant: "destructive" });
    },
  });

  const createCombinedRunMutation = useCreatePrepressProductionRun();
  const productionRunsQuery = useProductionRuns(undefined, { enabled: preferencesReady });

  // Derived state
  const queue = queueData?.items || EMPTY_PREPRESS_QUEUE;
  const totalQueueCount = queueData?.totalCount ?? queue.length;
  const filteredQueueCount = queueData?.filteredCount ?? queue.length;
  const filteredQueue = queue;
  const activeNestedRunByLineItemId = useMemo(() => {
    const map = new Map<string, ProductionRunListItem>();
    for (const run of productionRunsQuery.data ?? []) {
      if (run.runStatus === "completed" || run.runStatus === "completed_with_exceptions" || run.runStatus === "canceled") continue;
      for (const member of run.members) {
        map.set(member.orderLineItemId, run);
      }
    }
    return map;
  }, [productionRunsQuery.data]);
  const selectableQueueItems = useMemo(
    () => filteredQueue.filter((item) => canSelectPrepressCombinedRunItem(item) && !activeNestedRunByLineItemId.has(item.lineItemId)),
    [activeNestedRunByLineItemId, filteredQueue],
  );
  const selectedQueueItems = useMemo(
    () => filteredQueue.filter((item) => selectedQueueLineItemIds.has(item.lineItemId)),
    [filteredQueue, selectedQueueLineItemIds],
  );
  const selectedQueueItemsNeedingArtwork = useMemo(
    () => selectedQueueItems.filter((item) => getPrepressCombinedRunItemBlocker(item)?.resolvable === true),
    [selectedQueueItems],
  );
  const selectedQueueItemsMissingProductionArtwork = useMemo(
    () => selectedQueueItemsNeedingArtwork.filter((item) => getPrepressCombinedRunItemBlocker(item)?.code === "resolvable_missing_production_artwork"),
    [selectedQueueItemsNeedingArtwork],
  );
  const selectedQueueItemsWithAllocationIssues = useMemo(
    () => selectedQueueItemsNeedingArtwork.filter((item) => getPrepressCombinedRunItemBlocker(item)?.code === "resolvable_production_artwork_allocation"),
    [selectedQueueItemsNeedingArtwork],
  );
  const selectedQueueHardBlockedItems = useMemo(
    () => selectedQueueItems.filter((item) => {
      if (activeNestedRunByLineItemId.has(item.lineItemId)) return true;
      const blocker = getPrepressCombinedRunItemBlocker(item);
      return Boolean(blocker && !blocker.resolvable);
    }),
    [activeNestedRunByLineItemId, selectedQueueItems],
  );
  const combinedRunValidation = validatePrepressCombinedRunSelection(
    selectedQueueItems,
    combinedRunAllocations,
    combinedRunOverrideReason,
  );
  const combinedRunDialogValidation = validatePrepressCombinedRunSelection(
    selectedQueueItems,
    combinedRunAllocations,
    combinedRunOverrideReason || "__override_pending__",
  );
  const combinedRunSheetPlanItems = useMemo(() => selectedQueueItems.map((item) => ({
    lineItemId: item.lineItemId,
    quantity: Number(combinedRunAllocations[item.lineItemId] ?? item.quantity) || 0,
    width: item.width ?? null,
    height: item.height ?? null,
    productionLayout: item.productionLayout ?? null,
    productionLayoutUnavailableReason: item.productionLayoutUnavailableReason ?? null,
  })), [combinedRunAllocations, selectedQueueItems]);
  const combinedRunSheetPlanInputs = useMemo<CombinedRunSheetPlanInputs>(() => ({
    sheetWidth: positiveSheetNumber(combinedRunSheetWidth),
    sheetHeight: positiveSheetNumber(combinedRunSheetHeight),
    allowRotation: combinedRunAllowRotation,
    bleed: nonNegativeSheetNumber(combinedRunBleed),
    spacing: nonNegativeSheetNumber(combinedRunSpacing),
    marginTop: nonNegativeSheetNumber(combinedRunMarginTop),
    marginRight: nonNegativeSheetNumber(combinedRunMarginRight),
    marginBottom: nonNegativeSheetNumber(combinedRunMarginBottom),
    marginLeft: nonNegativeSheetNumber(combinedRunMarginLeft),
  }), [
    combinedRunAllowRotation,
    combinedRunBleed,
    combinedRunMarginBottom,
    combinedRunMarginLeft,
    combinedRunMarginRight,
    combinedRunMarginTop,
    combinedRunSheetHeight,
    combinedRunSheetWidth,
    combinedRunSpacing,
  ]);
  const combinedRunSheetPlan = useMemo(
    () => buildCombinedRunSheetPlanRecommendation(combinedRunSheetPlanItems, combinedRunSheetPlanInputs),
    [combinedRunSheetPlanInputs, combinedRunSheetPlanItems],
  );
  const combinedRunActionReason = combinedRunValidation.canCreate
    ? "Selected lines will become one downstream run; original line items stay separate."
    : selectedQueueItemsNeedingArtwork.length > 0 && selectedQueueHardBlockedItems.length === 0
      ? "Next step: resolve production artwork or quantity allocation for selected jobs, then create the run."
    : combinedRunDialogValidation.canCreate
      ? "Compatibility override required; open to provide the reason."
      : combinedRunValidation.reason;
  const effectiveCombinedRunPlannedSheetCount = combinedRunManualSheetOverride
    ? positiveSheetNumber(combinedRunPlannedSheetCount)
    : combinedRunSheetPlan.plannedSheetCount;
  const effectiveCombinedRunPiecesPerSheet = combinedRunManualSheetOverride
    ? positiveSheetNumber(combinedRunPiecesPerSheet)
    : combinedRunSheetPlan.nominalPiecesPerSheet;
  const combinedRunManualSheetOverrideIsStale = combinedRunManualSheetOverride
    && combinedRunSheetPlanOverrideInputKey !== combinedRunSheetPlan.inputKey;
  const combinedRunExpectedPlacements = (effectiveCombinedRunPlannedSheetCount || 0) * (effectiveCombinedRunPiecesPerSheet || 0);
  const combinedRunHasPlacementMismatch = combinedRunExpectedPlacements > 0
    && combinedRunValidation.totalAllocatedQuantity > 0
    && combinedRunExpectedPlacements !== combinedRunValidation.totalAllocatedQuantity;
  const combinedRunNeedsManualSheetPlan = !combinedRunSheetPlan.canAutoPlan
    && combinedRunSheetPlan.reasonCode !== "item_too_large"
    && (!positiveSheetNumber(combinedRunPlannedSheetCount) || !positiveSheetNumber(combinedRunPiecesPerSheet) || !combinedRunSheetPlanOverrideReason.trim() || combinedRunManualSheetOverrideIsStale);
  const combinedRunSheetPlanImpossible = combinedRunSheetPlan.reasonCode === "item_too_large";
  const canSubmitCombinedRun = combinedRunValidation.canCreate
    && !combinedRunSheetPlanImpossible
    && (!combinedRunNeedsManualSheetPlan)
    && (!combinedRunManualSheetOverride || (!combinedRunManualSheetOverrideIsStale && !!combinedRunSheetPlanOverrideReason.trim()))
    && (!combinedRunHasPlacementMismatch || combinedRunMismatchAcknowledged);
  const canOpenCombinedRunDialog = selectedQueueItems.length >= 2 && selectedQueueHardBlockedItems.length === 0 && !createCombinedRunMutation.isPending;
  const queueNestSelectedReason = canOpenCombinedRunDialog
    ? "Open the combined-run wizard for the selected jobs."
    : selectedQueueItems.length < 2
      ? "Select two or more compatible jobs to create a combined run."
      : combinedRunActionReason || "Selection needs review before nesting.";
  const allQueueItemsSelected = selectableQueueItems.length > 0 && selectableQueueItems.every((item) => selectedQueueLineItemIds.has(item.lineItemId));
  const someQueueItemsSelected = selectedQueueItems.length > 0 && !allQueueItemsSelected;
  const selectedQueueTotalQuantity = selectedQueueItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const selectedQueueOrderNumbers = Array.from(new Set(selectedQueueItems.map((item) => item.jobNumber).filter(Boolean)));
  const selectedQueueDestinationLabels = Array.from(new Set(selectedQueueItems.map((item) => item.productionDestinationLabel || item.selectedProductionDestination || item.suggestedProductionDestination || "No destination")));
  const selectedQueueValidationLabel = combinedRunValidation.canCreate
    ? "Ready to nest"
    : selectedQueueItemsNeedingArtwork.length > 0
      ? `${selectedQueueItemsNeedingArtwork.length} need artwork review`
      : (combinedRunActionReason || "Selection needs review");
  const queueSelectionHelperText = selectedQueueItems.length === 0
    ? "Select compatible jobs from the queue to create a combined run."
    : selectedQueueHardBlockedItems.length > 0
      ? `${selectedQueueHardBlockedItems.length} hard blocked`
      : selectedQueueItemsNeedingArtwork.length > 0
        ? `${selectedQueueItemsNeedingArtwork.length} need artwork review`
        : selectedQueueValidationLabel;
  const combinedRunArtworkReadyCount = selectedQueueItemsMissingProductionArtwork.filter((item) => {
    const candidates = combinedRunArtworkByLineItem[item.lineItemId] ?? [];
    return candidates.some((candidate) => candidate.id === combinedRunArtworkSelections[item.lineItemId]);
  }).length;
  const combinedRunArtworkCanAssign = selectedQueueItemsMissingProductionArtwork.length > 0
    && combinedRunArtworkReadyCount === selectedQueueItemsMissingProductionArtwork.length
    && !combinedRunArtworkLoading
    && !combinedRunArtworkAssigning;
  const combinedRunStep1Blocker = selectedQueueItems.length < 2
    ? "Select at least two compatible Prepress jobs from the queue."
    : selectedQueueHardBlockedItems.length > 0
      ? `${selectedQueueHardBlockedItems.length} selected job${selectedQueueHardBlockedItems.length === 1 ? " is" : "s are"} hard blocked. Remove blocked jobs before continuing.`
      : null;
  const combinedRunStep2Blocker = selectedQueueItemsNeedingArtwork.length === 0
    ? null
    : selectedQueueItemsWithAllocationIssues.length > 0
      ? "Save a valid Qty to Produce for every final production-art file before planning the run."
    : combinedRunArtworkLoading
      ? "Loading available customer artwork."
      : combinedRunArtworkErrors.__load
        ? combinedRunArtworkErrors.__load
        : selectedQueueItemsMissingProductionArtwork.length > 0 && combinedRunArtworkReadyCount < selectedQueueItemsMissingProductionArtwork.length
          ? "Choose customer artwork for each unresolved job."
          : selectedQueueItemsMissingProductionArtwork.length > 0
            ? "Assign selected artwork before planning the run."
            : selectedQueueItemsWithAllocationIssues.length > 0
              ? "Open the artwork resolver and save valid production quantities."
              : "Resolve production artwork before planning the run.";
  const combinedRunStep3Blocker = combinedRunSheetPlanImpossible
    ? combinedRunSheetPlan.reason || "The selected artwork does not fit the sheet inputs."
    : combinedRunNeedsManualSheetPlan
    ? "Enter a manual sheet plan because automatic layout is unavailable."
    : combinedRunManualSheetOverrideIsStale
    ? "Reconfirm the authorized manual sheet plan because layout inputs changed."
    : combinedRunManualSheetOverride && !combinedRunSheetPlanOverrideReason.trim()
    ? "Enter an authorized manual sheet-plan override reason."
    : combinedRunHasPlacementMismatch && !combinedRunMismatchAcknowledged
    ? "Acknowledge the placement mismatch before final review."
    : combinedRunValidation.canCreate
      ? null
      : combinedRunValidation.reason || "Resolve allocation, compatibility, or override requirements before final review.";
  const combinedRunStep4Blocker = canSubmitCombinedRun
    ? null
    : combinedRunSheetPlanImpossible
      ? combinedRunSheetPlan.reason || "The selected artwork does not fit the sheet inputs."
      : combinedRunNeedsManualSheetPlan
        ? "Enter and authorize a manual sheet plan because automatic layout is unavailable."
        : combinedRunManualSheetOverrideIsStale
          ? "Reconfirm the authorized manual sheet plan because layout inputs changed."
          : combinedRunManualSheetOverride && !combinedRunSheetPlanOverrideReason.trim()
            ? "Enter an authorized manual sheet-plan override reason."
            : combinedRunHasPlacementMismatch && !combinedRunMismatchAcknowledged
              ? "Acknowledge the placement mismatch before creating the run."
              : combinedRunValidation.reason || "Resolve all required validation before creating the run.";
  const currentCombinedRunStepBlocker =
    combinedRunWizardStep === 1 ? combinedRunStep1Blocker
      : combinedRunWizardStep === 2 ? combinedRunStep2Blocker
        : combinedRunWizardStep === 3 ? combinedRunStep3Blocker
          : combinedRunStep4Blocker;
  const combinedRunNextLabel =
    combinedRunWizardStep === 1 ? "Next: Resolve Artwork"
      : combinedRunWizardStep === 2 ? "Next: Plan Run"
        : combinedRunWizardStep === 3 ? "Next: Final Review"
          : "Create Combined Run";
  const canNavigateToCombinedRunStep = (targetStep: CombinedRunWizardStep) => {
    if (targetStep <= combinedRunWizardStep) return true;
    if (targetStep >= 2 && combinedRunStep1Blocker) return false;
    if (targetStep >= 3 && combinedRunStep2Blocker) return false;
    if (targetStep >= 4 && combinedRunStep3Blocker) return false;
    return true;
  };
  const selectedItem = queue.find(q => q.lineItemId === selectedLineItemId) ?? null;
  const selectedMediaFitWarning = getMediaFitWarning(selectedItem?.mediaFit);
  const selectedAlertStation = useMemo<ProductionAlertStation>(() => {
    const station = selectedItem?.selectedProductionDestination || selectedItem?.suggestedProductionDestination;
    return station === "roll" || station === "flatbed" ? station : "all";
  }, [selectedItem?.selectedProductionDestination, selectedItem?.suggestedProductionDestination]);
  const productionAlertsQuery = useProductionAlerts(
    { lineItemId: selectedLineItemId ?? undefined },
    { enabled: !!selectedLineItemId },
  );
  const productionAlertPresetsQuery = useProductionAlertPresets();
  const createProductionAlert = useCreateProductionAlert();
  const prepressCombinedRuns = useMemo(
    () => filterPrepressCombinedRuns(productionRunsQuery.data ?? [], {
      search: combinedRunSearchQuery,
      status: combinedRunStatusFilter,
      includeHistory: combinedRunIncludeHistory,
    }),
    [combinedRunIncludeHistory, combinedRunSearchQuery, combinedRunStatusFilter, productionRunsQuery.data],
  );
  const selectedCombinedRun = useMemo(
    () => (productionRunsQuery.data ?? []).find((run) => run.id === selectedCombinedRunId) ?? null,
    [productionRunsQuery.data, selectedCombinedRunId],
  );
  const selectedOwnerLabel = formatOwnerLabel(selectedItem);
  const promotionFilenamePreview = useMemo(() => {
    if (!promotionSourceFile || !selectedItem) return "";
    return buildFileUploadDisplayFilename({
      originalFilename: promotionSourceFile.originalFilename || promotionSourceFile.fileName || "artwork",
      fullJobNumber: selectedItem.jobNumber || "",
      numericJobNumber: numericJobNumberFromFull(selectedItem.jobNumber || ""),
      fileUploadJobPrefixMode: fileNamingPolicy?.fileUploadJobPrefixMode ?? "full_job_number",
      prepressLabel: promotionTagToPrepressLabel(promotionTag),
      labelPlacement: "after_job_prefix",
    });
  }, [fileNamingPolicy?.fileUploadJobPrefixMode, promotionSourceFile, promotionTag, selectedItem]);
  const originalFiles = filesData?.originals || [];
  const finalFiles = filesData?.finals || [];
  const bridgedOriginalFiles = filesData?.bridgedOriginals || [];
  const proofFiles = filesData?.proofs || [];
  const toVisiblePrepressFile = (file: LineItemFile, category: VisibleFileCategory, defaultTag: string): VisibleFileRecord => ({
    id: file.id,
    category,
    fileName: file.computedDisplayFilename || file.originalFilename,
    originalFilename: file.originalFilename,
    fileSize: file.sizeBytes,
    mimeType: file.mimeType || null,
    createdAt: file.createdAt,
    originalUrl: file.originalUrl ?? `/api/prepress/files/${file.id}/download`,
    previewUrl: file.previewUrl ?? null,
    thumbUrl: file.thumbnailUrl || null,
    thumbnailAvailabilityStatus: file.thumbnailAvailabilityStatus,
    displayName: file.computedDisplayFilename || file.originalFilename,
    uploadedByLabel: file.uploadedBy,
    tagLabel: formatPrepressTagLabel(file.tag, defaultTag),
    downloadUrl: file.downloadUrl ?? `/api/prepress/files/${file.id}/download`,
    sizeBytesValue: file.sizeBytes,
    sideLabel: file.artworkSide ?? "na",
    artworkAssignmentFileId: file.id,
    artworkAssignable: category === "original_customer" && file.role === "original",
    productionQuantity: file.productionQuantity ?? null,
    productionGroupId: file.productionGroupId ?? null,
  });
  const toVisibleBridgedFile = (file: BridgedOriginalFile, category: "bridged_original" | "proof"): VisibleFileRecord => {
    // Respect the server classification even if an older/mixed response places
    // a proof in the bridged-original collection during a rolling deployment.
    const resolvedCategory = file.prepressCategory === "proof" ? "proof" : category;
    return {
      id: file.id,
      category: resolvedCategory,
      fileName: file.originalFilename,
      originalFilename: file.originalFilename,
      fileSize: file.sizeBytes,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      originalUrl: file.downloadUrl,
      previewUrl: file.downloadUrl,
      thumbUrl: file.thumbnailUrl,
      displayName: file.computedDisplayFilename || file.displayFilename || file.originalFilename,
      uploadedByLabel: file.uploadedBy || (file.systemGenerated ? "System generated" : "—"),
      tagLabel: file.tagLabel || (resolvedCategory === "proof" ? "Proof" : "Order"),
      sideLabel: file.side === "front" || file.side === "back" || file.side === "both" ? file.side : "na",
      artworkAssignmentFileId: file.id,
      artworkAssignable: file.prepressCategory === "original_customer" && file.role === "artwork",
      productionQuantity: file.productionQuantity ?? null,
      productionGroupId: file.productionGroupId ?? null,
      downloadUrl: file.downloadUrl,
      sizeBytesValue: file.sizeBytes,
    };
  };
  const normalizedVisibleFiles = useMemo<VisibleFileRecord[]>(() => {
    return [
      ...originalFiles.map((file) => toVisiblePrepressFile(file, "original_customer", "original")),
      ...bridgedOriginalFiles.map((file) => toVisibleBridgedFile(file, "bridged_original")),
      ...proofFiles.map((file) => toVisibleBridgedFile(file, "proof")),
      ...finalFiles.map((file) => toVisiblePrepressFile(file, "final_production", "final")),
    ];
  }, [originalFiles, bridgedOriginalFiles, proofFiles, finalFiles]);
  const visibleOriginalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "original_customer"),
    [normalizedVisibleFiles]
  );
  const visibleBridgedOriginalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "bridged_original"),
    [normalizedVisibleFiles]
  );
  const visibleProofFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "proof"),
    [normalizedVisibleFiles]
  );
  const visibleFinalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "final_production"),
    [normalizedVisibleFiles]
  );
  const finalArtworkAllocation = useMemo(() => buildArtworkAllocationStatus({
    lineQuantity: selectedItem?.quantity ?? null,
    members: visibleFinalFiles.map((file) => ({
      id: file.id,
      role: "final",
      side: file.sideLabel,
      productionQuantity: file.productionQuantity ?? null,
      productionGroupId: file.productionGroupId ?? null,
      active: true,
    })),
  }), [selectedItem?.quantity, visibleFinalFiles]);
  const finalArtworkBreakdownRows = useMemo(() => visibleFinalFiles.map((file) => ({
    file,
    group: finalArtworkAllocation.groups.find((group) => group.memberIds.includes(file.id)) ?? null,
  })), [finalArtworkAllocation.groups, visibleFinalFiles]);
  const sourceArtworkStatus = visibleFinalFiles.length > 0
    ? "Source artwork"
    : "Not assigned to production";
  useEffect(() => {
    setCombinedRunAllocations((current) => {
      const next: Record<string, string> = {};
      for (const item of selectedQueueItems) {
        next[item.lineItemId] = current[item.lineItemId] ?? String(Number(item.quantity) || 1);
      }
      return next;
    });
  }, [selectedQueueItems]);
  useEffect(() => {
    if (!combinedRunOpen) return;
    setCombinedRunProductionQuantityDrafts((current) => {
      const next = { ...current };
      for (const item of selectedQueueItems) {
        for (const design of item.artworkProductionBreakdown?.designs ?? []) {
          if (design.source !== "final_production" || next[design.id] !== undefined) continue;
          next[design.id] = design.productionQuantity == null ? "" : String(design.productionQuantity);
        }
      }
      return next;
    });
  }, [combinedRunOpen, selectedQueueItems]);
  useEffect(() => {
    if (!combinedRunOpen) return;
    if (!combinedRunSheetWidth && combinedRunSheetPlan.sheetWidth) setCombinedRunSheetWidth(String(combinedRunSheetPlan.sheetWidth));
    if (!combinedRunSheetHeight && combinedRunSheetPlan.sheetHeight) setCombinedRunSheetHeight(String(combinedRunSheetPlan.sheetHeight));
    if (!combinedRunManualSheetOverride && combinedRunSheetPlan.canAutoPlan) {
      setCombinedRunPlannedSheetCount(combinedRunSheetPlan.plannedSheetCount ? String(combinedRunSheetPlan.plannedSheetCount) : "");
      setCombinedRunPiecesPerSheet(combinedRunSheetPlan.nominalPiecesPerSheet ? String(combinedRunSheetPlan.nominalPiecesPerSheet) : "");
      setCombinedRunSheetPlanOverrideInputKey(null);
    }
  }, [combinedRunManualSheetOverride, combinedRunOpen, combinedRunSheetHeight, combinedRunSheetPlan, combinedRunSheetWidth]);
  useEffect(() => {
    if (!combinedRunOpen || selectedQueueItemsMissingProductionArtwork.length === 0) {
      if (!combinedRunOpen) {
        setCombinedRunArtworkErrors({});
      }
      return;
    }

    let cancelled = false;
    const lineItemIds = selectedQueueItemsMissingProductionArtwork.map((item) => item.lineItemId);
    setCombinedRunArtworkLoading(true);
    setCombinedRunArtworkErrors({});

    Promise.all(lineItemIds.map(async (lineItemId) => {
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/files`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || "Unable to load available artwork.");
      }
      return [lineItemId, buildCombinedRunArtworkCandidates(body?.data)] as const;
    }))
      .then((entries) => {
        if (cancelled) return;
        const nextArtwork = Object.fromEntries(entries);
        setCombinedRunArtworkByLineItem(nextArtwork);
        setCombinedRunArtworkSelections((current) => {
          const next: Record<string, string> = {};
          for (const lineItemId of lineItemIds) {
            const candidates = nextArtwork[lineItemId] ?? [];
            if (current[lineItemId] && candidates.some((candidate) => candidate.id === current[lineItemId])) {
              next[lineItemId] = current[lineItemId];
            } else if (candidates.length === 1) {
              next[lineItemId] = candidates[0].id;
            }
          }
          return next;
        });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setCombinedRunArtworkErrors({ __load: error.message });
      })
      .finally(() => {
        if (!cancelled) setCombinedRunArtworkLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [combinedRunOpen, selectedQueueItemsNeedingArtwork]);
  useEffect(() => {
    if (!combinedRunOpen || !isPageVisible) return;
    void refreshPrepressQueue();
    void Promise.all(Array.from(selectedQueueLineItemIds).map((lineItemId) => refreshCombinedRunArtworkForLineItem(lineItemId)));
  }, [combinedRunOpen, isPageVisible, refreshCombinedRunArtworkForLineItem, refreshPrepressQueue, selectedQueueLineItemIds]);
  const resolveViewerIndex = React.useCallback((preferredFileId?: string | null) => {
    if (normalizedVisibleFiles.length === 0) return -1;
    if (!preferredFileId) return 0;
    const nextIndex = normalizedVisibleFiles.findIndex((file) => file.id === preferredFileId);
    return nextIndex >= 0 ? nextIndex : 0;
  }, [normalizedVisibleFiles]);
  const hasFinalFiles = finalFiles.length > 0;
  const hasUsableExistingArtwork =
    originalFiles.length > 0 ||
    bridgedOriginalFiles.some((file) => file.role === "artwork");
  const canCompleteWithExistingArtwork = !hasFinalFiles && hasUsableExistingArtwork;
  const artworkSideReadiness = resolveProductionArtworkSideReadiness({
    sides: selectedItem?.printSides ?? "Unknown",
    artwork: [
      ...originalFiles.map((file) => ({ ...file, side: file.artworkSide ?? "na" })),
      ...bridgedOriginalFiles,
    ],
    useSameArtworkBothSides: selectedItem?.useSameArtworkBothSides === true,
    sameArtworkFileId: selectedItem?.sameArtworkFileId ?? null,
  });
  const artworkFilename = (file: any): string =>
    file?.computedDisplayFilename || file?.displayFilename || file?.originalFilename || "Not assigned";
  const materialsPayload = materialsEffectiveData?.data;
  const plannedMaterials = materialsPayload?.plannedMaterials || [];
  const effectiveMaterials = materialsPayload?.effectiveMaterials || [];
  const effectiveFingerprint = materialsPayload?.effectiveFingerprint || "";
  const materialOverrides = materialsPayload?.overrides || [];
  const pricingReviewRequired = materialsPayload?.pricingReviewRequired || false;
  const overrideMode = materialsPayload?.overrideMode || "prepress_and_production";
  const overrideAllowed = materialsPayload?.overrideAllowed ?? true;
  const overrideBlockedReason = materialsPayload?.overrideBlockedReason || null;
  const plannedMaterialsMessage = materialsEffectiveData?.message;
  const materialsAvailability = materialsAvailabilityData?.items || [];
  const materialsAllAvailable = materialsAvailabilityData?.allAvailable ?? true;
  const selectedSheetPlanDisplay = React.useMemo(
    () => buildPrepressSheetPlanDisplay({
      layout: selectedItem?.productionLayout,
      quantity: selectedItem?.quantity ?? null,
    }),
    [selectedItem?.productionLayout, selectedItem?.quantity],
  );
  const selectedSheetPlanUnavailableMessage = formatPrepressSheetPlanUnavailableReason(
    selectedItem?.productionLayoutUnavailableReason,
  );
  const showSheetPlanFallback =
    !selectedSheetPlanDisplay &&
    selectedItem?.selectedProductionDestination === "flatbed" &&
    Boolean(selectedSheetPlanUnavailableMessage);
  const isOwnedByPrepress = selectedItem?.isActivelyOwnedByPrepress === true;
  const selectedWorkflowState = String(selectedItem?.workflowState || "").toLowerCase();
  const selectedWorkflowDisplay = getPrepressWorkflowDisplay(selectedItem);
  const canStartPrepress =
    !!selectedItem &&
    isOwnedByPrepress &&
    selectedWorkflowState === "ready_for_prepress" &&
    !selectedItem.sessionId;
  const canComplete =
    isOwnedByPrepress &&
    selectedWorkflowState === "in_prepress" &&
    (hasFinalFiles || hasUsableExistingArtwork) &&
    artworkSideReadiness.complete &&
    !selectedItem?.productionReleaseBlockedReason &&
    !!selectedItem?.sessionId;
  const canSendToPrint =
    isOwnedByPrepress &&
    selectedWorkflowState === "in_prepress" &&
    !!selectedItem?.hasCompletedSession &&
    !selectedItem?.sessionId &&
    !selectedItem?.hasDownstreamActiveJob &&
    hasFinalFiles &&
    artworkSideReadiness.complete &&
    !selectedItem?.productionReleaseBlockedReason;
  const canCompleteAndRelease = canCompleteAndReleasePrepress({
    canCompleteNow: canComplete,
    canReleaseNow: canSendToPrint,
    releaseAllowedAfterCompletion:
      !selectedItem?.hasDownstreamActiveJob &&
      artworkSideReadiness.complete &&
      !selectedItem?.productionReleaseBlockedReason,
  });
  const hasProofReleaseBlock = Boolean(selectedItem?.productionReleaseBlockedReason);
  const activeSessionStartedAt = selectedItem?.sessionStartedAt ? new Date(selectedItem.sessionStartedAt) : null;
  const activeSessionElapsedSeconds =
    selectedWorkflowState === "in_prepress" && activeSessionStartedAt && Number.isFinite(activeSessionStartedAt.getTime())
      ? Math.max(0, Math.floor((nowMs - activeSessionStartedAt.getTime()) / 1000))
      : 0;
  const activePrepressViewLabels = useMemo(() => {
    const labels: string[] = [];
    if (currentListPreferences.destination !== DEFAULT_PREPRESS_LIST_PREFERENCES.destination) {
      labels.push(`Destination=${PREPRESS_DESTINATION_LABELS[currentListPreferences.destination]}`);
    }
    if (currentListPreferences.status !== DEFAULT_PREPRESS_LIST_PREFERENCES.status) {
      labels.push(`Status=${PREPRESS_STATUS_LABELS[currentListPreferences.status]}`);
    }
    if (currentListPreferences.rush !== DEFAULT_PREPRESS_LIST_PREFERENCES.rush) {
      labels.push("Rush=Yes");
    }
    if (
      currentListPreferences.sortBy !== DEFAULT_PREPRESS_LIST_PREFERENCES.sortBy ||
      currentListPreferences.sortDirection !== DEFAULT_PREPRESS_LIST_PREFERENCES.sortDirection
    ) {
      labels.push(`Sort=${PREPRESS_SORT_LABELS[currentListPreferences.sortBy]} ${currentListPreferences.sortDirection === "asc" ? "A-Z" : "Z-A"}`);
    }
    if (normalizedSearchQuery) {
      labels.push(`Search="${normalizedSearchQuery}"`);
    }
    return labels;
  }, [currentListPreferences, normalizedSearchQuery]);
  const hasActivePrepressView =
    activePrepressViewLabels.length > 0 || filteredQueueCount < totalQueueCount;
  const queueIsLoading = !preferencesReady || queueLoading;

  // Clear selection if selected item is not in queue
  React.useEffect(() => {
    if (selectedLineItemId && !selectedItem) {
      setSelectedLineItemId(null);
    }
  }, [selectedLineItemId, selectedItem]);

  React.useEffect(() => {
    const queueIds = new Set(queue.map((item) => item.lineItemId));
    setSelectedQueueLineItemIds((current) => {
      const next = new Set(Array.from(current).filter((id) => queueIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [queue]);

  React.useEffect(() => {
    setSelectedQueueLineItemIds(new Set());
  }, [destinationFilter]);

  React.useEffect(() => {
    if (!combinedRunOpen) {
      setCombinedRunArtworkResolverLineItemId(null);
      return;
    }
    if (combinedRunArtworkResolverLineItemId && !selectedQueueLineItemIds.has(combinedRunArtworkResolverLineItemId)) {
      setCombinedRunArtworkResolverLineItemId(null);
    }
  }, [combinedRunArtworkResolverLineItemId, combinedRunOpen, selectedQueueLineItemIds]);

  useEffect(() => {
    if (selectedWorkflowState !== "in_prepress" || !selectedItem?.sessionStartedAt) {
      setNowMs(Date.now());
      return;
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedItem?.sessionStartedAt, selectedWorkflowState]);

  React.useEffect(() => {
    setViewerOpen(false);
    setViewerIndex(0);
  }, [selectedLineItemId]);

  React.useEffect(() => {
    if (!pendingViewerRequest) return;
    if (pendingViewerRequest.lineItemId !== selectedLineItemId) return;
    if (!filesData) return;

    const nextIndex = resolveViewerIndex(pendingViewerRequest.preferredFileId);
    if (nextIndex < 0) {
      setPendingViewerRequest(null);
      return;
    }

    setViewerIndex(nextIndex);
    setViewerOpen(true);
    setPendingViewerRequest(null);
  }, [filesData, pendingViewerRequest, resolveViewerIndex, selectedLineItemId]);

  React.useEffect(() => {
    setPrepressNotes(selectedItem?.prepressNotes || "");
    setFlagForQc(!!selectedItem?.issueFlag);
    setIssueType(selectedItem?.issueType || "");
  }, [selectedItem?.lineItemId, selectedItem?.prepressNotes, selectedItem?.issueFlag, selectedItem?.issueType]);

  React.useEffect(() => {
    setProductionAlertOpen(false);
    setProductionAlertTitle("");
    setProductionAlertPresetId("manual");
    setProductionAlertType("general_warning");
    setProductionAlertSeverity("warning");
    setProductionAlertStations([selectedAlertStation]);
    setProductionAlertMessage("");
  }, [selectedItem?.lineItemId, selectedAlertStation]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || !selectedItem) return;
    console.log("[Prepress Options]", {
      lineItemId: selectedItem.lineItemId,
      optionsRows: selectedItem.optionsRows?.length ?? 0,
    });
  }, [selectedItem?.lineItemId, selectedItem?.optionsRows]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || !selectedItem) return;
    console.log("[Prepress Materials Needed]", {
      lineItemId: selectedItem.lineItemId,
      plannedMaterials: plannedMaterials.length,
      effectiveMaterials: effectiveMaterials.length,
      overrideCount: materialOverrides.length,
      overrideMode,
      overrideAllowed,
      message: plannedMaterialsMessage || null,
    });
  }, [
    selectedItem?.lineItemId,
    plannedMaterials.length,
    effectiveMaterials.length,
    materialOverrides.length,
    overrideMode,
    overrideAllowed,
    plannedMaterialsMessage,
  ]);

  // Handlers
  const handleRefresh = () => {
    void refetchQueue();
  };

  const handleClearPrepressViewFilters = () => {
    setSearchQuery("");
    setDestinationFilter(DEFAULT_PREPRESS_LIST_PREFERENCES.destination);
    setStatusFilter(DEFAULT_PREPRESS_LIST_PREFERENCES.status);
    setRushFilter(DEFAULT_PREPRESS_LIST_PREFERENCES.rush);
    setSortBy(DEFAULT_PREPRESS_LIST_PREFERENCES.sortBy);
    setSortAsc(DEFAULT_PREPRESS_LIST_PREFERENCES.sortDirection === "asc");
  };

  const handleOpenHistory = () => {
    if (!selectedItem) return;
    setHistoryOpen(true);
  };

  const handleOpenSpecSheet = () => {
    if (!selectedItem) return;
    setSpecSheetOpen(true);
  };

  const handleProductionDestinationChange = (value: string) => {
    if (!selectedItem || !selectedLineItemId) return;
    updateProductionDestinationMutation.mutate({ lineItemId: selectedLineItemId, destination: value });
  };

  const handleOpenProductionAlert = () => {
    setProductionAlertPresetId("manual");
    setProductionAlertStations([selectedAlertStation]);
    setProductionAlertOpen(true);
  };

  const handleProductionAlertPresetChange = (presetId: string) => {
    setProductionAlertPresetId(presetId);
    if (presetId === "manual") return;
    const preset = productionAlertPresetsQuery.data?.find((entry) => entry.id === presetId);
    if (!preset) return;
    setProductionAlertTitle(preset.title);
    setProductionAlertType(preset.alertType);
    setProductionAlertSeverity(preset.severity);
    setProductionAlertStations(preset.visibleStations.length ? preset.visibleStations : ["all"]);
    setProductionAlertMessage(preset.message ?? "");
  };

  const handleToggleProductionAlertStation = (station: ProductionAlertStation, checked: boolean) => {
    setProductionAlertStations((current) => {
      if (station === "all") return checked ? ["all"] : [];
      const withoutAll = current.filter((entry) => entry !== "all");
      const next = checked
        ? Array.from(new Set([...withoutAll, station]))
        : withoutAll.filter((entry) => entry !== station);
      return next.length ? next : ["all"];
    });
  };

  const handleCreateProductionAlert = () => {
    if (!selectedItem || !selectedLineItemId) return;
    createProductionAlert.mutate(
      {
        orderId: selectedItem.orderId,
        orderLineItemId: selectedLineItemId,
        title: productionAlertTitle,
        alertType: productionAlertType,
        severity: productionAlertSeverity,
        visibleStations: productionAlertStations.length ? productionAlertStations : ["all"],
        message: productionAlertMessage,
        presetId: productionAlertPresetId === "manual" ? null : productionAlertPresetId,
      },
      {
        onSuccess: () => {
          setProductionAlertOpen(false);
          setProductionAlertTitle("");
          setProductionAlertPresetId("manual");
          setProductionAlertType("general_warning");
          setProductionAlertSeverity("warning");
          setProductionAlertStations([selectedAlertStation]);
          setProductionAlertMessage("");
        },
      },
    );
  };

  const handleStartPrepress = () => {
    if (selectedItem) {
      startSessionMutation.mutate(selectedItem.lineItemId);
    }
  };

  const handleSaveNotes = () => {
    if (selectedItem?.sessionId) {
      saveNoteMutation.mutate({
        sessionId: selectedItem.sessionId,
        note: prepressNotes,
        flaggedForQc: flagForQc,
        issueType: flagForQc ? issueType : "",
      });
    }
  };

  const handleComplete = () => {
    if (selectedItem?.sessionId && canComplete) {
      completeSessionMutation.mutate(selectedItem.sessionId);
    }
  };

  // PROMPT B: Send to Print Queue handler
  const handleSendToPrint = () => {
    if (selectedLineItemId) {
      sendToPrintMutation.mutate(selectedLineItemId);
    }
  };

  const handleCompleteAndRelease = () => {
    if (!selectedItem || !selectedLineItemId || !canCompleteAndRelease) return;
    completeAndReleaseMutation.mutate({
      lineItemId: selectedLineItemId,
      sessionId: selectedItem.sessionId,
      hasCompletedSession: selectedItem.hasCompletedSession === true,
    });
  };

  const handleToggleSelectAllQueueItems = (checked: boolean) => {
    setSelectedQueueLineItemIds(checked ? new Set(selectableQueueItems.map((item) => item.lineItemId)) : new Set());
  };

  const handleToggleQueueItem = (lineItemId: string, checked: boolean) => {
    const item = filteredQueue.find((entry) => entry.lineItemId === lineItemId);
    if (checked && item && (!canSelectPrepressCombinedRunItem(item) || activeNestedRunByLineItemId.has(item.lineItemId))) return;
    setSelectedQueueLineItemIds((current) => {
      const next = new Set(current);
      if (checked) next.add(lineItemId);
      else next.delete(lineItemId);
      return next;
    });
  };

  const handleBulkPrintReady = (releaseToProduction: boolean) => {
    if (selectedQueueItems.length === 0 || bulkPrintReadyMutation.isPending) return;
    bulkPrintReadyMutation.mutate({ items: selectedQueueItems, releaseToProduction });
  };

  const resetCombinedRunDraft = () => {
    setCombinedRunSheetPlanStaleMessage(null);
    setCombinedRunPlannedSheetCount("");
    setCombinedRunPiecesPerSheet("");
    setCombinedRunSheetWidth("");
    setCombinedRunSheetHeight("");
    setCombinedRunAllowRotation(false);
    setCombinedRunBleed("0");
    setCombinedRunSpacing("0");
    setCombinedRunMarginTop("0");
    setCombinedRunMarginRight("0");
    setCombinedRunMarginBottom("0");
    setCombinedRunMarginLeft("0");
    setCombinedRunManualSheetOverride(false);
    setCombinedRunSheetPlanOverrideReason("");
    setCombinedRunSheetPlanOverrideInputKey(null);
    setCombinedRunNotes("");
    setCombinedRunOverrideReason("");
    setCombinedRunMismatchAcknowledged(false);
    setCombinedRunFileStrategy("rip_managed");
    setCombinedRunAllocations({});
  };

  const openCombinedRunWizard = () => {
    setWorkspaceTab("queue");
    setCombinedRunWizardStep(1);
    setCombinedRunSheetPlanStaleMessage(null);
    setCombinedRunOpen(true);
  };

  const cancelCombinedRunWizard = () => {
    setCombinedRunOpen(false);
    setCombinedRunWizardStep(1);
    setCombinedRunArtworkResolverLineItemId(null);
  };

  const openCombinedRunArtworkResolver = (lineItemId: string) => {
    setWorkspaceTab("queue");
    setCombinedRunWizardStep(2);
    setSelectedLineItemId(lineItemId);
    setCombinedRunArtworkResolverLineItemId(lineItemId);
    void refreshCombinedRunArtworkForLineItem(lineItemId);
  };

  const closeCombinedRunArtworkResolver = () => {
    setCombinedRunArtworkResolverLineItemId(null);
  };

  const assignCombinedRunArtworkCandidate = async (
    lineItemId: string,
    candidate: CombinedRunArtworkCandidate,
  ): Promise<string | null> => {
    const res = await fetch(`/api/prepress/line-item/${lineItemId}/assign-customer-artwork`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceKind: candidate.sourceKind,
        sourceId: candidate.sourceId,
        tag: "final_print",
        artworkSide: candidate.sideLabel || "na",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      return body?.error || body?.message || "Unable to assign this artwork.";
    }
    await Promise.all([
      refreshLineItemQueries(lineItemId),
      refreshPrepressQueue(),
      refreshCombinedRunArtworkForLineItem(lineItemId),
    ]);
    return null;
  };

  const handleAssignSingleCombinedRunArtwork = async (lineItemId: string) => {
    if (combinedRunArtworkAssigning) return;
    const candidates = combinedRunArtworkByLineItem[lineItemId] ?? [];
    const selectedCandidateId = combinedRunArtworkSelections[lineItemId] ?? (candidates.length === 1 ? candidates[0].id : null);
    const candidate = candidates.find((entry) => entry.id === selectedCandidateId);
    if (!candidate) {
      setCombinedRunArtworkErrors((current) => ({
        ...current,
        [lineItemId]: candidates.length === 0 ? "No customer artwork is available. Upload production artwork or remove this job." : "Choose the customer artwork to use.",
      }));
      return;
    }

    setCombinedRunArtworkAssigning(true);
    setCombinedRunArtworkErrors((current) => {
      const next = { ...current };
      delete next[lineItemId];
      return next;
    });
    try {
      const error = await assignCombinedRunArtworkCandidate(lineItemId, candidate);
      if (error) {
        setCombinedRunArtworkErrors((current) => ({ ...current, [lineItemId]: error }));
        toast({ title: "Artwork assignment failed", description: error, variant: "destructive" });
        return;
      }
      toast({
        title: "Production artwork assigned",
        description: "The wizard stayed open and refreshed this line's artwork status.",
      });
    } finally {
      setCombinedRunArtworkAssigning(false);
    }
  };

  const handleAssignCombinedRunArtwork = async () => {
    if (combinedRunArtworkAssigning || selectedQueueItemsMissingProductionArtwork.length === 0) return;
    const errors: Record<string, string> = {};
    setCombinedRunArtworkAssigning(true);
    setCombinedRunArtworkErrors({});
    try {
    for (const item of selectedQueueItemsMissingProductionArtwork) {
        const candidates = combinedRunArtworkByLineItem[item.lineItemId] ?? [];
        const selectedCandidateId = combinedRunArtworkSelections[item.lineItemId];
        const candidate = candidates.find((entry) => entry.id === selectedCandidateId);
        if (!candidate) {
          errors[item.lineItemId] = candidates.length === 0 ? "No customer artwork is available. Upload production artwork or remove this job." : "Choose the customer artwork to use.";
          continue;
        }

        const error = await assignCombinedRunArtworkCandidate(item.lineItemId, candidate);
        if (error) errors[item.lineItemId] = error;
      }

      if (Object.keys(errors).length > 0) {
        setCombinedRunArtworkErrors(errors);
        toast({
          title: "Artwork resolution needs attention",
          description: "Some selected jobs still need a valid artwork choice before the run can be created.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Production artwork assigned",
        description: "Selected customer artwork was assigned without copying the stored files.",
      });
      await Promise.all([
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
      ]);
    } finally {
      setCombinedRunArtworkAssigning(false);
    }
  };

  const handleCreateCombinedRun = async () => {
    if (!canSubmitCombinedRun || !combinedRunValidation.stationKey) return;
    try {
      const result = await createCombinedRunMutation.mutateAsync({
        orderId: combinedRunValidation.orderId ?? null,
        stationKey: combinedRunValidation.stationKey,
        members: selectedQueueItems.map((item) => ({
          lineItemId: item.lineItemId,
          allocatedQuantity: Number(combinedRunAllocations[item.lineItemId] ?? item.quantity),
        })),
        plannedSheetCount: combinedRunPlannedSheetCount ? Number(combinedRunPlannedSheetCount) : null,
        nominalPiecesPerSheet: combinedRunPiecesPerSheet ? Number(combinedRunPiecesPerSheet) : null,
        sheetWidth: combinedRunSheetWidth ? Number(combinedRunSheetWidth) : null,
        sheetHeight: combinedRunSheetHeight ? Number(combinedRunSheetHeight) : null,
        sheetPlan: {
          inputs: combinedRunSheetPlan.inputs,
          calculated: snapshotCombinedRunSheetPlan(combinedRunSheetPlan),
          manualOverride: combinedRunManualSheetOverride
            ? {
                enabled: true,
                plannedSheetCount: positiveSheetNumber(combinedRunPlannedSheetCount),
                nominalPiecesPerSheet: positiveSheetNumber(combinedRunPiecesPerSheet),
                reason: combinedRunSheetPlanOverrideReason.trim(),
                inputKey: combinedRunSheetPlanOverrideInputKey,
              }
            : { enabled: false },
        },
        notes: combinedRunNotes.trim() || null,
        compatibilityOverrideReason: combinedRunOverrideReason.trim() || null,
        productionFileStrategy: combinedRunFileStrategy === "manual_upload_after_create" ? "staff_prepared" : "rip_managed",
      });
      setSelectedQueueLineItemIds(new Set());
      setCombinedRunOpen(false);
      setCombinedRunWizardStep(1);
      resetCombinedRunDraft();
      const createdRunId = (result as any)?.run?.id ?? (result as any)?.id ?? null;
      const createdRunNumber = (result as any)?.run?.runNumber ?? (result as any)?.runNumber ?? null;
      setWorkspaceTab("runs");
      if (createdRunId) {
        setSelectedCombinedRunId(createdRunId);
        setFocusNestedFileUpload(combinedRunFileStrategy === "manual_upload_after_create");
        setCombinedRunDetailOpen(true);
      }
      toast({
        title: "Combined production run created",
        description: combinedRunFileStrategy === "manual_upload_after_create"
          ? (createdRunNumber ? `Run PR-${String(createdRunNumber).padStart(4, "0")} is open for nested-file upload. Release remains blocked until upload completes.` : "The draft run is open for nested-file upload.")
          : "The draft run is ready for RIP-managed nesting from its member artwork.",
      });
      await Promise.all([
        refreshPrepressQueue(),
        refreshPrepressNavigationCount(),
        queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] }),
      ]);
      await productionRunsQuery.refetch();
    } catch (error) {
      const staleError = error as Error & { code?: string; details?: { reasonCode?: string; affectedMemberIds?: string[]; currentInputs?: Partial<CombinedRunSheetPlanInputs> } | null };
      const message = staleError instanceof Error ? staleError.message : "";
      if (staleError.code === "PRODUCTION_RUN_SHEET_PLAN_STALE" || staleError.code === "PRODUCTION_RUN_SHEET_PLAN_OVERRIDE_STALE") {
        const details = staleError.details;
        const changed = details?.affectedMemberIds?.length
          ? `Member quantities changed for ${details.affectedMemberIds.join(", ")}.`
          : details?.reasonCode === "calculator_version_changed"
            ? "The sheet-plan calculator version changed."
            : "Layout inputs changed.";
        const currentInputs = details?.currentInputs;
        if (currentInputs) {
          setCombinedRunSheetWidth(currentInputs.sheetWidth == null ? "" : String(currentInputs.sheetWidth));
          setCombinedRunSheetHeight(currentInputs.sheetHeight == null ? "" : String(currentInputs.sheetHeight));
          setCombinedRunAllowRotation(Boolean(currentInputs.allowRotation));
          setCombinedRunBleed(String(currentInputs.bleed ?? 0));
          setCombinedRunSpacing(String(currentInputs.spacing ?? 0));
          setCombinedRunMarginTop(String(currentInputs.marginTop ?? 0));
          setCombinedRunMarginRight(String(currentInputs.marginRight ?? 0));
          setCombinedRunMarginBottom(String(currentInputs.marginBottom ?? 0));
          setCombinedRunMarginLeft(String(currentInputs.marginLeft ?? 0));
        }
        setCombinedRunMismatchAcknowledged(false);
        setCombinedRunSheetPlanStaleMessage(`${changed} Review the refreshed server-calculated plan before continuing.`);
        setCombinedRunWizardStep(3);
        await refreshPrepressQueue();
        await Promise.all(selectedQueueItems.map((item) => refreshCombinedRunArtworkForLineItem(item.lineItemId)));
        return;
      }
      if (/artwork|production file|final file/i.test(message)) {
        setCombinedRunWizardStep(2);
        await refreshPrepressQueue();
        await Promise.all(selectedQueueItems.map((item) => refreshCombinedRunArtworkForLineItem(item.lineItemId)));
      }
      // The mutation hook owns the retryable, server-provided error message.
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || !selectedLineItemId) return;

    Array.from(files).forEach(file => {
      uploadFileMutation.mutate({
        lineItemId: selectedLineItemId,
        file,
        role: uploadRole,
        tag: uploadRole === "final" ? selectedTag : "",
        sessionId: selectedItem?.sessionId ?? null,
      });
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownloadFile = (fileId: string) => {
    window.open(`/api/prepress/files/${fileId}/download`, "_blank");
  };

  const openSharedViewer = React.useCallback((lineItemId: string, preferredFileId?: string | null) => {
    if (!lineItemId) return;

    if (lineItemId === selectedLineItemId) {
      const nextIndex = resolveViewerIndex(preferredFileId);
      if (nextIndex < 0) return;
      setViewerIndex(nextIndex);
      setViewerOpen(true);
      setPendingViewerRequest(null);
      return;
    }

    setPendingViewerRequest({ lineItemId, preferredFileId: preferredFileId ?? null });
    setSelectedLineItemId(lineItemId);
  }, [resolveViewerIndex, selectedLineItemId]);

  const handleOpenViewer = (fileId: string) => {
    if (!selectedLineItemId) return;
    openSharedViewer(selectedLineItemId, fileId);
  };

  const handleOpenQueuePreview = (item: PrepressQueueItem) => {
    openSharedViewer(item.lineItemId, item.thumbFileId || null);
  };

  const handleDownloadAllOriginals = () => {
    if (selectedLineItemId) {
      window.open(`/api/prepress/line-item/${selectedLineItemId}/download-originals-zip`, "_blank");
    }
  };

  const openMaterialOverrideModal = (args: {
    mode: "replace" | "add" | "remove" | "adjust_qty";
    materialId?: string;
    uom?: "sqft" | "ft" | "each";
    qty?: number;
  }) => {
    setMaterialOverrideMode(args.mode);
    setOverrideReasonNote("");

    if (args.mode === "replace") {
      setOverrideFromMaterialId(args.materialId || "");
      setOverrideToMaterialId("");
      setOverrideMaterialId("");
      setOverrideQty("");
    }

    if (args.mode === "add") {
      setOverrideMaterialId("");
      setOverrideQty("");
      setOverrideUom(args.uom || "sqft");
    }

    if (args.mode === "remove") {
      setOverrideMaterialId(args.materialId || "");
      setOverrideQty("");
    }

    if (args.mode === "adjust_qty") {
      setOverrideMaterialId(args.materialId || "");
      setOverrideQty(args.qty != null ? String(args.qty) : "");
      setOverrideUom(args.uom || "sqft");
    }

    setMaterialOverrideOpen(true);
  };

  const handleSubmitMaterialOverride = () => {
    const reasonNote = overrideReasonNote.trim();
    if (!reasonNote) {
      toast({ title: "Reason is required", description: "Provide a reason note for this material override", variant: "destructive" });
      return;
    }

    if (materialOverrideMode === "replace") {
      if (!overrideFromMaterialId.trim() || !overrideToMaterialId.trim()) {
        toast({ title: "Material IDs required", description: "Both source and target material IDs are required", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "replace",
        fromMaterialId: overrideFromMaterialId.trim(),
        toMaterialId: overrideToMaterialId.trim(),
        reasonNote,
        priceImpact: "potential",
      });
      return;
    }

    if (materialOverrideMode === "add") {
      const qty = Number(overrideQty);
      if (!overrideMaterialId.trim() || !Number.isFinite(qty) || qty <= 0) {
        toast({ title: "Invalid material input", description: "Material ID and positive quantity are required", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "add",
        materialId: overrideMaterialId.trim(),
        qty,
        uom: overrideUom,
        reasonNote,
      });
      return;
    }

    if (materialOverrideMode === "remove") {
      if (!overrideMaterialId.trim()) {
        toast({ title: "Material ID required", description: "Select a material to remove", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "remove",
        materialId: overrideMaterialId.trim(),
        reasonNote,
      });
      return;
    }

    const qty = Number(overrideQty);
    if (!overrideMaterialId.trim() || !Number.isFinite(qty) || qty <= 0) {
      toast({ title: "Invalid quantity", description: "Material ID and positive quantity are required", variant: "destructive" });
      return;
    }
    applyMaterialOverrideMutation.mutate({
      op: "adjust_qty",
      materialId: overrideMaterialId.trim(),
      qty,
      uom: overrideUom,
      reasonNote,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111921] text-slate-100 font-sans overflow-hidden">
      <div
        ref={workspaceFrameRef}
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: `minmax(320px, ${leftPanePercent}%) 8px minmax(0, 1fr)` }}
        data-testid="prepress-resizable-workspace"
      >
        {/* LEFT COLUMN: Prepress Queue and Combined Runs */}
        <aside className="min-h-0 min-w-[320px] flex flex-col h-full bg-[#1a232e]/50">
        <div className="border-b border-[#2d3748]">
          <div className="space-y-3 p-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Prepress Workspace</h1>
              <p className="text-[11px] text-slate-500">Production board and nested runs</p>
            </div>
            <button
              onClick={workspaceTab === "queue" ? handleRefresh : () => productionRunsQuery.refetch()}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              disabled={workspaceTab === "queue" ? queueFetching : productionRunsQuery.isFetching}
              aria-label={workspaceTab === "queue" ? "Refresh prepress queue" : "Refresh combined runs"}
            >
              <RefreshCw className={cn("w-4 h-4", (workspaceTab === "queue" ? queueFetching : productionRunsQuery.isFetching) && "animate-spin")} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#2d3748] bg-[#111921] p-1" role="tablist" aria-label="Prepress workspace tabs">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === "queue"}
              onClick={() => setWorkspaceTab("queue")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-bold transition-colors",
                workspaceTab === "queue" ? "bg-[#1773cf] text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
              )}
            >
              Prepress Queue
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">{filteredQueueCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === "runs"}
              onClick={() => setWorkspaceTab("runs")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-bold transition-colors",
                workspaceTab === "runs" ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
              )}
            >
              Combined Runs
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">{prepressCombinedRuns.length}</span>
            </button>
          </div>
          </div>

          {/* Filters */}
          {workspaceTab === "queue" ? (
          <>
          <div className="space-y-3 border-t border-[#2d3748]/60 p-4 pt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111921] border-[#2d3748] rounded-lg pl-10 text-sm focus:ring-[#1773cf] focus:border-[#1773cf] h-9"
                placeholder="Search Job #, Customer, Product..."
              />
            </div>

            <div className="flex gap-2">
              <Select value={destinationFilter} onValueChange={(value) => setDestinationFilter(value as PrepressDestinationFilter)}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Destination: All</SelectItem>
                  <SelectItem value="roll">Roll</SelectItem>
                  <SelectItem value="flatbed">Flatbed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as PrepressStatusFilter)}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status: All</SelectItem>
                  <SelectItem value="ready_for_prepress">Ready for Prepress</SelectItem>
                  <SelectItem value="in_prepress">In Prepress</SelectItem>
                </SelectContent>
              </Select>

              <button
                onClick={() => setRushFilter(!rushFilter)}
                className={cn(
                  "px-2 py-1 bg-[#111921] border rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 h-8",
                  rushFilter ? "border-[#e53e3e] text-[#e53e3e]" : "border-[#2d3748] text-slate-400 hover:border-[#e53e3e] hover:text-[#e53e3e]"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", rushFilter ? "bg-[#e53e3e]" : "bg-slate-600")}></span>
                RUSH
              </button>
            </div>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-[#2d3748]/30">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-tighter">Sort By:</span>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as PrepressListSortBy)}>
                <SelectTrigger className="bg-transparent border-none text-[11px] font-medium text-slate-300 p-0 focus:ring-0 h-auto w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_date">Due Date</SelectItem>
                  <SelectItem value="job_number">Job #</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="material">Material</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center justify-center p-1 text-slate-500 hover:text-[#1773cf] transition-colors hover:bg-white/5 rounded"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          <div className="space-y-2 border-t border-[#2d3748]/30 pt-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
                <Checkbox
                  checked={allQueueItemsSelected ? true : someQueueItemsSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => handleToggleSelectAllQueueItems(checked === true)}
                  aria-label="Select all prepress line items"
                />
                <span>{selectedQueueItems.length > 0 ? `${selectedQueueItems.length} selected` : "Select all"}</span>
              </label>
              {selectedQueueItems.length > 0 ? (
                <span className="text-[10px] font-medium text-slate-400">
                  {selectedQueueItems.length} selected
                  {selectedQueueItemsNeedingArtwork.length > 0 ? ` · ${selectedQueueItemsNeedingArtwork.length} need production artwork` : ""}
                  {selectedQueueHardBlockedItems.length > 0 ? ` · ${selectedQueueHardBlockedItems.length} hard blocked` : ""}
                </span>
              ) : null}
            </div>
          </div>
          </>
          ) : (
            <div className="space-y-2 border-t border-[#2d3748]/60 p-4 pt-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-violet-100">Combined Runs</p>
                  <p className="text-[10px] leading-snug text-slate-400">Manage shared nested production files without leaving Prepress.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => productionRunsQuery.refetch()}
                  disabled={productionRunsQuery.isFetching}
                  className="h-7 px-2 text-[11px] text-violet-200 hover:bg-violet-500/10"
                >
                  <RefreshCw className={cn("mr-1 h-3 w-3", productionRunsQuery.isFetching && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <Input
                  value={combinedRunSearchQuery}
                  onChange={(event) => setCombinedRunSearchQuery(event.target.value)}
                  placeholder="Run, order, customer, line, status..."
                  className="h-8 bg-[#111921] border-[#2d3748] pl-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select value={combinedRunStatusFilter} onValueChange={(value) => setCombinedRunStatusFilter(value as PrepressCombinedRunStatusFilter)}>
                  <SelectTrigger className="h-8 bg-[#111921] border-[#2d3748] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attention">Needs Prepress attention</SelectItem>
                    <SelectItem value="active">Active runs</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="ready_for_production">Ready for Production</SelectItem>
                    <SelectItem value="in_production">In Production</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                    <SelectItem value="all">All statuses</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 rounded-md border border-[#2d3748] px-2 text-[11px] text-slate-300">
                  <Checkbox checked={combinedRunIncludeHistory} onCheckedChange={(checked) => setCombinedRunIncludeHistory(checked === true)} aria-label="Include completed and canceled combined runs" />
                  History
                </label>
              </div>
              {productionRunsQuery.isError ? (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">Unable to load combined runs.</div>
              ) : productionRunsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading combined runs...</div>
              ) : prepressCombinedRuns.length === 0 ? (
                <div className="rounded-lg border border-violet-400/30 bg-violet-500/5 px-3 py-5 text-center text-xs text-slate-300">
                  <p className="font-semibold text-violet-100">No combined runs yet.</p>
                  <p className="mx-auto mt-2 max-w-[28rem] text-slate-400">
                    Select two or more compatible jobs from the Prepress Queue and choose Nest Selected to create one.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setWorkspaceTab("queue")} className="h-8 px-3 text-[11px]">
                      Go to Prepress Queue
                    </Button>
                    {canOpenCombinedRunDialog ? (
                      <Button type="button" size="sm" onClick={openCombinedRunWizard} className="h-8 bg-violet-600 px-3 text-[11px] text-white hover:bg-violet-700">
                        Create Combined Run
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {prepressCombinedRuns.slice(0, 12).map((run) => {
                    const needsAttention = productionRunNeedsPrepressAttention(run);
                    return (
                      <div key={run.id} className="rounded-md border border-[#2d3748] bg-[#111921]/80 p-2 text-[11px]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-violet-100">{run.displayNumber}</span>
                              <span className="rounded border border-[#2d3748] px-1.5 py-0.5 uppercase text-[9px] text-slate-300">{run.runStatus.replace(/_/g, " ")}</span>
                              {needsAttention ? <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200">Needs file/review</span> : null}
                            </div>
                            <div className="mt-1 truncate text-slate-300">Order {run.orderNumber} - {run.customerName}</div>
                            <div className="truncate text-slate-500">{run.stationKey} - {run.memberCount} lines - {run.fileCount} active files</div>
                            <div className="truncate text-slate-600">Created {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "date unknown"}</div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 px-2 text-[11px]"
                            onClick={() => {
                              setSelectedCombinedRunId(run.id);
                              setCombinedRunDetailOpen(true);
                            }}
                          >
                            Open
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Job List */}
        {workspaceTab === "queue" ? (
        <>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-2 pb-4" data-testid="prepress-queue-scroll-area">
          {!queueIsLoading && hasActivePrepressView && (
            <div className="rounded-lg border border-[#1773cf]/40 bg-[#1773cf]/10 px-3 py-2 text-xs text-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-[#8ec5ff]">
                    {filteredQueueCount === totalQueueCount
                      ? `Showing ${filteredQueueCount} ${filteredQueueCount === 1 ? "job" : "jobs"}`
                      : `Showing ${filteredQueueCount} of ${totalQueueCount} jobs`}
                  </p>
                  <p className="truncate text-slate-300">
                    {activePrepressViewLabels.length > 0
                      ? `View active: ${activePrepressViewLabels.join(", ")}`
                      : "Results are filtered"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearPrepressViewFilters}
                  className="h-7 shrink-0 px-2 text-[11px] text-[#8ec5ff] hover:bg-[#1773cf]/20 hover:text-white"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          )}
          {queueIsLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {!queueIsLoading && filteredQueue.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-400">No jobs in prepress queue</p>
              <p className="text-xs text-slate-600 mt-1">Adjust filters or clear search to see more jobs</p>
            </div>
          )}
          {!queueIsLoading && filteredQueue.map((item) => {
            const selectionBlocker = activeNestedRunByLineItemId.has(item.lineItemId)
              ? { code: "hard_already_allocated", message: "Already nested in an active production run.", resolvable: false }
              : getPrepressCombinedRunItemBlocker(item);
            return (
              <JobCard
                key={item.lineItemId}
                item={item}
                isSelected={selectedLineItemId === item.lineItemId}
                isChecked={selectedQueueLineItemIds.has(item.lineItemId)}
                selectionBlocker={selectionBlocker}
                nestedRunLabel={activeNestedRunByLineItemId.get(item.lineItemId)?.displayNumber ?? null}
                onCheckedChange={(checked) => handleToggleQueueItem(item.lineItemId, checked)}
                onClick={() => setSelectedLineItemId(item.lineItemId)}
                onPreviewClick={() => handleOpenQueuePreview(item)}
              />
            );
          })}
        </div>
        <div className="shrink-0 border-t border-[#2d3748] bg-[#111921]/95 p-3" data-testid="prepress-queue-selection-footer">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-xs">
              <div className="font-bold text-white">{selectedQueueItems.length} selected</div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">{queueSelectionHelperText}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedQueueLineItemIds(new Set())}
                disabled={selectedQueueItems.length === 0}
                className="h-8 border-[#2d3748] px-3 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                data-testid="prepress-queue-clear-selection"
              >
                Clear Selection
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={openCombinedRunWizard}
                disabled={!canOpenCombinedRunDialog}
                title={queueNestSelectedReason}
                className="h-8 bg-violet-600 px-3 text-[11px] text-white hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-400"
                data-testid="prepress-queue-nest-selected"
              >
                {createCombinedRunMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Nest Selected
              </Button>
            </div>
          </div>
        </div>
        </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2 pb-24" aria-label="Combined runs tab spacer" />
        )}
      </aside>

      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Prepress queue pane"
        aria-valuemin={PREPRESS_LEFT_PANE_MIN_PERCENT}
        aria-valuemax={PREPRESS_LEFT_PANE_MAX_PERCENT}
        aria-valuenow={Math.round(leftPanePercent)}
        onPointerDown={handlePaneDividerPointerDown}
        onKeyDown={handlePaneDividerKeyDown}
        className="group flex h-full cursor-col-resize items-center justify-center border-x border-[#2d3748] bg-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#1773cf]"
        data-testid="prepress-pane-divider"
      >
        <span className="h-12 w-1 rounded-full bg-slate-600 group-hover:bg-[#1773cf]" />
      </button>

      {/* RIGHT COLUMN: Main Workspace */}
      <main className="flex-1 min-h-0 flex flex-col h-full overflow-hidden bg-[#111921]">
        {combinedRunOpen ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" data-testid="prepress-combined-run-wizard">
            <header className="shrink-0 border-b border-[#2d3748] bg-[#1a232e]/40 px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Combined Run Wizard</p>
                  <h2 className="mt-1 text-2xl font-black text-white">Nest Selected</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {selectedQueueItems.length} selected line items across {selectedQueueOrderNumbers.length || 0} order{selectedQueueOrderNumbers.length === 1 ? "" : "s"}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {([1, 2, 3, 4] as CombinedRunWizardStep[]).map((step) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() => {
                        if (canNavigateToCombinedRunStep(step)) setCombinedRunWizardStep(step);
                      }}
                      disabled={!canNavigateToCombinedRunStep(step)}
                      title={!canNavigateToCombinedRunStep(step) ? "Complete the earlier wizard step first." : undefined}
                      className={cn(
                        "rounded border px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50",
                        combinedRunWizardStep === step
                          ? "border-violet-300 bg-violet-500/20 text-violet-50"
                          : "border-[#2d3748] text-slate-400 hover:bg-white/5 hover:text-slate-100",
                      )}
                    >
                      Step {step}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-28">
              {combinedRunWizardStep === 1 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Step 1: Selected Jobs</h3>
                        <p className="mt-1 text-xs text-slate-400">Review compatibility, ordered quantity, available quantity, and allocation before planning the run.</p>
                      </div>
                      <span className={cn("rounded border px-2 py-1 text-xs font-semibold", combinedRunValidation.canCreate ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-100")}>
                        {selectedQueueValidationLabel}
                      </span>
                    </div>
                    {!combinedRunValidation.canCreate && combinedRunValidation.reason ? (
                      <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        {combinedRunValidation.reason}
                      </div>
                    ) : null}
                  </div>

                  <div className="divide-y divide-[#2d3748] overflow-hidden rounded-lg border border-[#2d3748] bg-[#111921]">
                    {selectedQueueItems.map((item) => {
                      const maxQuantity = Number(item.quantity) || 0;
                      const blocker = activeNestedRunByLineItemId.has(item.lineItemId)
                        ? { code: "hard_already_allocated", message: "Already nested in an active production run.", resolvable: false }
                        : getPrepressCombinedRunItemBlocker(item);
                      return (
                        <div key={item.lineItemId} className="grid gap-3 p-3 text-xs xl:grid-cols-[minmax(0,1fr)_140px_auto]">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                              Order {item.jobNumber || item.orderId}{item.lineNumber ? ` - Line ${item.lineNumber}` : ""}: {item.productName}
                            </div>
                            <div className="mt-1 truncate text-slate-400">{item.customerName || "Customer/contact not resolved"}</div>
                            <div className="mt-1 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-3 xl:grid-cols-5">
                              <span>{item.productionDestinationLabel || item.selectedProductionDestination || "No destination"}</span>
                              <span>{item.materialName || item.media || "No material"}</span>
                              <span>{item.width && item.height ? `${item.width}" x ${item.height}"` : "No dimensions"}</span>
                              <span>Ordered: {item.quantity}</span>
                              <span>Available: {maxQuantity}</span>
                            </div>
                            {blocker ? (
                              <p className={cn("mt-2 text-[11px]", blocker.resolvable ? "text-amber-200" : "text-red-100")}>{blocker.message}</p>
                            ) : (
                              <p className="mt-2 text-[11px] text-emerald-300">Production artwork ready</p>
                            )}
                            <div className="mt-2">
                              <ArtworkProductionBreakdownList item={item} />
                            </div>
                            {item.artworkProductionBreakdown?.source === "final_production" ? (
                              <div className="mt-3 rounded border border-[#2d3748] bg-[#0f172a] p-2">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                  <span className="font-semibold text-slate-200">Final production-art allocation</span>
                                  <span className={item.artworkProductionBreakdown.valid ? "text-emerald-300" : "text-amber-200"}>
                                    Assigned {item.artworkProductionBreakdown.allocatedTotal} of {item.artworkProductionBreakdown.requiredQuantity ?? item.quantity}
                                    {item.artworkProductionBreakdown.requiredQuantity != null ? ` · ${Math.max(0, item.artworkProductionBreakdown.requiredQuantity - item.artworkProductionBreakdown.allocatedTotal)} remaining` : ""}
                                  </span>
                                </div>
                                <div className="mt-2 space-y-2">
                                  {(item.artworkProductionBreakdown.designs ?? []).filter((design) => design.source === "final_production").map((design) => (
                                    <div key={`combined-run-allocation-${design.id}`} className="grid gap-2 rounded border border-[#2d3748] bg-[#111921] p-2 md:grid-cols-[40px_minmax(0,1fr)_130px_auto] md:items-center">
                                      <FileThumbnail fileId={design.id} filename={design.filename || "Production artwork"} mimeType={design.mimeType || undefined} thumbnailUrl={design.thumbnailUrl || undefined} compact />
                                      <div className="min-w-0">
                                        <div className="truncate font-semibold text-slate-100">{design.filename || "Production artwork"}</div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                                          <span>{normalizeArtworkSideLabel(design.side)}</span>
                                          <span>Output group: {design.productionGroupId || "Individual"}</span>
                                        </div>
                                      </div>
                                      <label className="flex items-center gap-1 text-[11px] text-slate-300">
                                        <span>Qty to Produce</span>
                                        <Input
                                          aria-label={`Qty to Produce for ${design.filename || "production artwork"}`}
                                          value={combinedRunProductionQuantityDrafts[design.id] ?? (design.productionQuantity == null ? "" : String(design.productionQuantity))}
                                          onChange={(event) => setCombinedRunProductionQuantityDrafts((current) => ({ ...current, [design.id]: event.target.value }))}
                                          inputMode="numeric"
                                          disabled={updateFinalArtworkAllocationMutation.isPending}
                                          className="h-8 w-16 border-[#2d3748] bg-[#0f172a] px-2 text-xs"
                                        />
                                      </label>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void saveCombinedRunProductionQuantity(item.lineItemId, design.id)}
                                        disabled={updateFinalArtworkAllocationMutation.isPending}
                                        className="h-8 text-[11px]"
                                      >
                                        {updateFinalArtworkAllocationMutation.isPending ? "Saving..." : "Save Allocation"}
                                      </Button>
                                      {combinedRunProductionQuantityErrors[design.id] ? (
                                        <div className="md:col-span-4 text-[11px] text-red-200">{combinedRunProductionQuantityErrors[design.id]}</div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void refreshPrepressQueue()} className="mt-2 h-7 px-1 text-[11px] text-slate-300">
                                  <RefreshCw className="mr-1 h-3 w-3" /> Refresh Artwork
                                </Button>
                              </div>
                            ) : null}
                          </div>
                          <label className="space-y-1">
                            <span className="text-[11px] font-medium text-slate-400">Allocated quantity</span>
                            <Input
                              aria-label={`Allocated quantity for ${item.productName}`}
                              value={combinedRunAllocations[item.lineItemId] ?? String(maxQuantity || 1)}
                              onChange={(event) => setCombinedRunAllocations((current) => ({ ...current, [item.lineItemId]: event.target.value }))}
                              inputMode="numeric"
                              className="h-8 bg-[#0f172a] border-[#2d3748]"
                            />
                          </label>
                          <Button type="button" size="sm" variant="outline" onClick={() => handleToggleQueueItem(item.lineItemId, false)} className="h-8 border-red-400/40 text-red-100 hover:bg-red-500/10">
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {combinedRunWizardStep === 2 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Step 2: Resolve Production Artwork</h3>
                        <p className="mt-1 text-xs text-slate-400">Selected jobs missing production artwork or valid print quantities appear here.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void refreshPrepressQueue();
                            void Promise.all(selectedQueueItems.map((item) => refreshCombinedRunArtworkForLineItem(item.lineItemId)));
                          }}
                          disabled={combinedRunArtworkLoading || updateFinalArtworkAllocationMutation.isPending}
                          className="h-8 border-[#2d3748] text-slate-200 hover:bg-white/5"
                          data-testid="prepress-combined-run-refresh-artwork"
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> Refresh Artwork
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={combinedRunArtworkLoading || combinedRunArtworkAssigning || selectedQueueItemsMissingProductionArtwork.length === 0}
                          onClick={() => {
                            setCombinedRunArtworkSelections((current) => {
                              const next = { ...current };
                              for (const item of selectedQueueItemsMissingProductionArtwork) {
                                const candidates = combinedRunArtworkByLineItem[item.lineItemId] ?? [];
                                if (candidates.length === 1) next[item.lineItemId] = candidates[0].id;
                              }
                              return next;
                            });
                          }}
                          className="h-8 border-amber-400/50 text-amber-100 hover:bg-amber-500/10"
                        >
                          Use sole artwork
                        </Button>
                        <Button type="button" size="sm" onClick={handleAssignCombinedRunArtwork} disabled={!combinedRunArtworkCanAssign} className="h-8 bg-emerald-600 text-white hover:bg-emerald-700">
                          {combinedRunArtworkAssigning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          Assign selected artwork
                        </Button>
                      </div>
                    </div>
                  </div>

                  {combinedRunArtworkLoading ? (
                    <div className="flex items-center gap-2 rounded border border-[#2d3748] bg-[#0f172a] px-3 py-2 text-xs text-slate-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading available customer artwork...
                    </div>
                  ) : null}
                  {combinedRunArtworkErrors.__load ? (
                    <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                      {combinedRunArtworkErrors.__load}
                    </div>
                  ) : null}
                  {selectedQueueItemsNeedingArtwork.length === 0 ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">All selected jobs have production artwork ready.</div>
                  ) : selectedQueueItemsMissingProductionArtwork.length === 0 ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                      Final production artwork is present, but {selectedQueueItemsWithAllocationIssues.length} selected {selectedQueueItemsWithAllocationIssues.length === 1 ? "line has" : "lines have"} an incomplete allocation. Update Qty to Produce in Step 1 and save; this wizard will retain its current selection and planning state.
                    </div>
                  ) : (
                    <div className={cn("grid gap-4", combinedRunArtworkResolverLineItemId ? "xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]" : "")}>
                    <div className="space-y-3">
                      {selectedQueueItemsNeedingArtwork.map((item) => {
                        const blocker = getPrepressCombinedRunItemBlocker(item);
                        const missingProductionArtwork = blocker?.code === "resolvable_missing_production_artwork";
                        const candidates = combinedRunArtworkByLineItem[item.lineItemId] ?? [];
                        const selectedCandidateId = combinedRunArtworkSelections[item.lineItemId];
                        const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId);
                        const rowError = combinedRunArtworkErrors[item.lineItemId] ?? null;
                        const statusLabel = !missingProductionArtwork
                          ? "Quantity review"
                          : candidates.length === 0
                          ? "Needs artwork"
                          : selectedCandidateId
                            ? "Ready"
                            : candidates.length === 1
                              ? "Ready"
                              : "Ambiguous";
                        return (
                          <div key={item.lineItemId} className="rounded-lg border border-[#2d3748] bg-[#0f172a] p-4 text-xs">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white">
                                  Order {item.jobNumber || item.orderId}{item.lineNumber ? ` - Line ${item.lineNumber}` : ""}: {item.productName}
                                </div>
                                <p className="mt-1 text-slate-400">{item.customerName || "Customer/contact not resolved"}</p>
                                {missingProductionArtwork ? (
                                  <p className="mt-1 text-slate-500">Current selected file: {selectedCandidate?.label || (candidates.length === 1 ? candidates[0].label : "None selected")}</p>
                                ) : null}
                                <p className="mt-1 text-slate-500">Blocker: {blocker?.message || "Backend readiness still needs confirmation."}</p>
                                <div className="mt-2">
                                  <ArtworkProductionBreakdownList
                                    item={item}
                                    compact
                                    updating={updateFinalArtworkAllocationMutation.isPending}
                                    onUpdateQuantity={(fileId, productionQuantity) => updateFinalArtworkAllocationMutation.mutate({
                                      lineItemId: item.lineItemId,
                                      fileId,
                                      productionQuantity,
                                    })}
                                  />
                                </div>
                              </div>
                              <span className={cn(
                                "rounded border px-2 py-0.5 text-[10px] font-semibold",
                                statusLabel === "Ready" ? "border-emerald-400/40 text-emerald-200" : rowError ? "border-red-400/40 text-red-100" : "border-amber-400/40 text-amber-100",
                              )}>
                                {rowError ? "Error" : statusLabel}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
                              {missingProductionArtwork && candidates.length > 0 ? (
                                <Select
                                  value={selectedCandidateId ?? (candidates.length === 1 ? candidates[0].id : undefined)}
                                  onValueChange={(value) => setCombinedRunArtworkSelections((current) => ({ ...current, [item.lineItemId]: value }))}
                                >
                                  <SelectTrigger className="h-9 bg-[#111921] border-[#2d3748] text-xs">
                                    <SelectValue placeholder="Choose customer artwork" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {candidates.map((candidate) => (
                                      <SelectItem key={candidate.id} value={candidate.id}>
                                        {candidate.label} - {candidate.sideLabel.toUpperCase()} - {candidate.sizeBytesValue != null ? formatBytes(candidate.sizeBytesValue) : "size unknown"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : missingProductionArtwork ? (
                                <div className="rounded border border-[#2d3748] px-2 py-2 text-slate-300">
                                  No customer artwork is available for this line item. Upload production artwork or resolve the file assignment here.
                                </div>
                              ) : (
                                <div className="rounded border border-amber-400/30 bg-amber-500/10 px-2 py-2 text-amber-100">
                                  Production artwork exists, but the assigned print quantities are not valid yet. Open the resolver and update the Qty fields.
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {missingProductionArtwork && candidates.length > 0 ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAssignSingleCombinedRunArtwork(item.lineItemId)}
                                    disabled={combinedRunArtworkAssigning}
                                    className="h-9 border-emerald-400/40 px-2 text-[11px] text-emerald-100 hover:bg-emerald-500/10"
                                  >
                                    Assign Existing Artwork
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openCombinedRunArtworkResolver(item.lineItemId)}
                                  className={cn(
                                    "h-9 px-2 text-[11px]",
                                    combinedRunArtworkResolverLineItemId === item.lineItemId
                                      ? "border-violet-300 bg-violet-500/20 text-violet-50"
                                      : "border-violet-400/40 text-violet-100 hover:bg-violet-500/10",
                                  )}
                                  data-testid="prepress-combined-run-resolve-artwork"
                                >
                                  Resolve Artwork
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => handleToggleQueueItem(item.lineItemId, false)} className="h-9 border-red-400/40 px-2 text-[11px] text-red-100 hover:bg-red-500/10">
                                  Remove
                                </Button>
                              </div>
                            </div>
                            {rowError ? <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-100">{rowError}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                    {combinedRunArtworkResolverLineItemId ? (
                      <aside className="min-w-0 rounded-lg border border-violet-400/30 bg-[#111921] shadow-2xl" data-testid="prepress-combined-run-artwork-resolver">
                        {selectedItem && selectedItem.lineItemId === combinedRunArtworkResolverLineItemId ? (
                          <div className="grid max-h-[calc(100vh-18rem)] min-h-[520px] grid-rows-[auto_minmax(0,1fr)_auto]">
                            <header className="border-b border-[#2d3748] bg-[#1a232e] p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Artwork Resolver</p>
                                  <h3 className="mt-1 truncate text-lg font-black text-white">
                                    Order {selectedItem.jobNumber || selectedItem.orderId}{selectedItem.lineNumber ? ` - Line ${selectedItem.lineNumber}` : ""}
                                  </h3>
                                  <p className="mt-1 truncate text-xs text-slate-400">{selectedItem.productName}</p>
                                </div>
                                <Button type="button" size="sm" variant="outline" onClick={closeCombinedRunArtworkResolver} className="h-8">
                                  Close resolver
                                </Button>
                              </div>
                              <div className="mt-3 rounded border border-[#2d3748] bg-[#0f172a] px-3 py-2 text-xs text-slate-300">
                                <div><span className="text-slate-500">Current status:</span> {getPrepressCombinedRunItemBlocker(selectedItem)?.message || "Ready pending queue refresh."}</div>
                                <div><span className="text-slate-500">Production candidate:</span> {visibleFinalFiles[0]?.displayName || "None assigned"}</div>
                                {selectedItem.printSides === "Double-sided" ? (
                                  <div><span className="text-slate-500">Double-sided readiness:</span> {artworkSideReadiness.complete ? "Ready" : artworkSideReadiness.warning || "Needs front/back assignment"}</div>
                                ) : null}
                              </div>
                              <div className="mt-3">
                                <ArtworkProductionBreakdownList
                                  item={selectedItem}
                                  showHeader
                                  updating={updateFinalArtworkAllocationMutation.isPending}
                                  onUpdateQuantity={(fileId, productionQuantity) => updateFinalArtworkAllocationMutation.mutate({
                                    lineItemId: selectedItem.lineItemId,
                                    fileId,
                                    productionQuantity,
                                  })}
                                />
                              </div>
                            </header>

                            <div className="min-h-0 space-y-5 overflow-y-auto p-4">
                              <section>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                                    <Paperclip className="h-4 w-4" /> Customer Artwork
                                  </h4>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setUploadRole("original");
                                        fileInputRef.current?.click();
                                      }}
                                      className="h-8 text-[11px]"
                                    >
                                      Upload Replacement Artwork
                                    </Button>
                                    {(visibleOriginalFiles.length > 0 || visibleBridgedOriginalFiles.length > 0) ? (
                                      <Button type="button" size="sm" variant="outline" onClick={handleDownloadAllOriginals} className="h-8 text-[11px]">
                                        Download All
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  multiple
                                  className="hidden"
                                  onChange={handleFileSelect}
                                  disabled={!selectedLineItemId}
                                  data-testid="prepress-combined-run-resolver-file-input"
                                />
                                {visibleOriginalFiles.length === 0 && visibleBridgedOriginalFiles.length === 0 ? (
                                  <div className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs text-slate-400">
                                    No customer artwork is available. Upload replacement customer artwork or upload production artwork below.
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {[...visibleOriginalFiles, ...visibleBridgedOriginalFiles].map((file) => (
                                      <div key={`${file.category}-${file.id}`} className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs">
                                        <div className="flex gap-3">
                                          <FileThumbnail
                                            fileId={file.category === "original_customer" ? file.id : undefined}
                                            filename={file.originalFilename || file.fileName}
                                            mimeType={file.mimeType || undefined}
                                            thumbnailUrl={file.thumbUrl || undefined}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate font-semibold text-slate-100">{file.displayName}</div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                              <span>{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "size unknown"}</span>
                                              <span className="font-semibold text-slate-300">{sourceArtworkStatus}</span>
                                              <span>{file.uploadedByLabel}</span>
                                              <span>{file.tagLabel}</span>
                                              <PrepressArtworkSideBadge side={file.sideLabel} />
                                            </div>
                                          </div>
                                        </div>
                                        {selectedItem.printSides === "Double-sided" && file.artworkAssignable ? (
                                          <div className="mt-3">
                                            <PrepressArtworkSideSelect
                                              filename={file.displayName}
                                              side={file.sideLabel}
                                              disabled={assignArtworkSideMutation.isPending}
                                              onAssign={(side) => assignArtworkSideMutation.mutate({
                                                orderId: selectedItem.orderId,
                                                lineItemId: selectedItem.lineItemId,
                                                fileId: file.artworkAssignmentFileId,
                                                side,
                                              })}
                                            />
                                          </div>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <Button type="button" size="sm" variant="outline" onClick={() => window.open(file.downloadUrl, "_blank")} className="h-8 text-[11px]">
                                            Download
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => assignCustomerArtworkMutation.mutate({
                                              lineItemId: selectedItem.lineItemId,
                                              file,
                                              tag: selectedTag !== "none" ? selectedTag : "final_print",
                                            })}
                                            disabled={assignCustomerArtworkMutation.isPending}
                                            className="h-8 bg-emerald-600 text-[11px] text-white hover:bg-emerald-700"
                                          >
                                            Use as Production Artwork
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setPromotionSourceFile(file);
                                              setPromotionTag(selectedTag !== "none" ? selectedTag : "final_print");
                                            }}
                                            className="h-8 border-violet-400/50 text-[11px] text-violet-100 hover:bg-violet-500/10"
                                          >
                                            Create Modified Copy
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>

                              <section>
                                <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                                  <FileText className="h-4 w-4" /> Proof Files
                                </h4>
                                {visibleProofFiles.length === 0 ? (
                                  <div className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs text-slate-400">
                                    No proof files are available for this line.
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {visibleProofFiles.map((file) => (
                                      <div key={`resolver-proof-${file.id}`} className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs">
                                        <div className="flex items-center gap-3">
                                          <FileThumbnail filename={file.originalFilename || file.fileName} mimeType={file.mimeType || undefined} thumbnailUrl={file.thumbUrl || undefined} />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate font-semibold text-slate-100">{file.displayName}</div>
                                            <div className="mt-1 text-[11px] text-slate-500">{file.tagLabel} - {file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "size unknown"}</div>
                                          </div>
                                          <Button type="button" size="sm" variant="outline" onClick={() => window.open(file.downloadUrl, "_blank")} className="h-8 text-[11px]">
                                            Download
                                          </Button>
                                        </div>
                                        <p className="mt-2 text-[11px] text-slate-500">Proof files remain read-only here unless the canonical Prepress promotion flow marks them eligible.</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>

                              <section>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                                    <CheckCircle className="h-4 w-4" /> Production Art Candidate
                                  </h4>
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                      setUploadRole("final");
                                      fileInputRef.current?.click();
                                    }}
                                    className="h-8 bg-[#1773cf] text-[11px] text-white hover:bg-[#1773cf]/90"
                                  >
                                    Upload Production Artwork
                                  </Button>
                                </div>
                                {visibleFinalFiles.length > 0 ? (
                                  <div className="mb-3 rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div>
                                        <div className="font-bold uppercase tracking-widest text-slate-400">Artwork Production Breakdown</div>
                                        <div className="mt-1 text-slate-500">
                                          Assigned {finalArtworkAllocation.allocatedTotal} of {finalArtworkAllocation.requiredQuantity ?? selectedItem.quantity} ordered pieces.
                                        </div>
                                      </div>
                                      <span className={cn(
                                        "rounded border px-2 py-1 text-[11px] font-semibold",
                                        finalArtworkAllocation.valid ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-100",
                                      )}>
                                        {finalArtworkAllocation.valid ? "Ready" : "Needs input"}
                                      </span>
                                    </div>
                                    {finalArtworkAllocation.issue ? (
                                      <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                                        {finalArtworkAllocation.issue}
                                      </div>
                                    ) : null}
                                    <div className="mt-2 space-y-1">
                                      {finalArtworkBreakdownRows.map(({ file, group }) => (
                                        <div key={`resolver-breakdown-${file.id}`} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                                          <span className="min-w-0 truncate">{file.displayName}</span>
                                          <label className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                            <span>Qty</span>
                                            <Input
                                              key={`resolver-${file.id}:${file.productionQuantity ?? "unresolved"}`}
                                              aria-label={`Production quantity for ${file.displayName}`}
                                              defaultValue={group?.quantity || file.productionQuantity || ""}
                                              inputMode="numeric"
                                              disabled={updateFinalArtworkAllocationMutation.isPending}
                                              className="h-7 w-20 border-[#2d3748] bg-[#111921] px-2 text-xs"
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter") event.currentTarget.blur();
                                              }}
                                              onBlur={(event) => {
                                                const raw = event.currentTarget.value.trim();
                                                const nextQuantity = raw ? Number(raw) : null;
                                                if ((file.productionQuantity ?? null) === nextQuantity) return;
                                                updateFinalArtworkAllocationMutation.mutate({
                                                  lineItemId: selectedItem.lineItemId,
                                                  fileId: file.id,
                                                  productionQuantity: nextQuantity,
                                                });
                                              }}
                                            />
                                          </label>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                <RadioGroup
                                  value={selectedTag}
                                  onValueChange={(value) => {
                                    hasSelectedTagManuallyRef.current = true;
                                    setSelectedTag(value);
                                  }}
                                  className="mb-3 flex flex-wrap items-center gap-4"
                                >
                                  {prepressFileLabelMode === "optional" ? (
                                    <label className="flex items-center gap-2 text-xs text-slate-300">
                                      <RadioGroupItem value="none" id="combined-run-tag-none" />
                                      No label
                                    </label>
                                  ) : null}
                                  <label className="flex items-center gap-2 text-xs text-slate-300">
                                    <RadioGroupItem value="final_print" id="combined-run-tag-print" />
                                    Print
                                  </label>
                                  <label className="flex items-center gap-2 text-xs text-slate-300">
                                    <RadioGroupItem value="proof_only" id="combined-run-tag-proof" />
                                    Proof
                                  </label>
                                  <label className="flex items-center gap-2 text-xs text-slate-300">
                                    <RadioGroupItem value="cut_file" id="combined-run-tag-cut" />
                                    Cut File
                                  </label>
                                </RadioGroup>
                                {visibleFinalFiles.length === 0 ? (
                                  <div className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs text-slate-400">
                                    No production-art candidate is currently assigned.
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {visibleFinalFiles.map((file) => (
                                      <div key={`resolver-final-${file.id}`} className="rounded border border-[#2d3748] bg-[#0f172a] p-3 text-xs">
                                        <div className="flex gap-3">
                                          <FileThumbnail
                                            fileId={file.id}
                                            filename={file.originalFilename || file.fileName}
                                            mimeType={file.mimeType || undefined}
                                            thumbnailUrl={file.thumbUrl || undefined}
                                            thumbnailAvailabilityStatus={file.thumbnailAvailabilityStatus}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate font-semibold text-slate-100">{file.displayName}</div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                              <span>{file.tagLabel}</span>
                                              <span>Qty {formatArtworkQuantity(file.productionQuantity)}</span>
                                              <span>{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "size unknown"}</span>
                                              <span>Uploaded by {file.uploadedByLabel}</span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => downloadFinalFileMutation.mutate({
                                              url: file.downloadUrl,
                                              filename: file.displayName || file.originalFilename || "production-file",
                                            })}
                                            disabled={downloadFinalFileMutation.isPending}
                                            className="h-8 text-[11px]"
                                          >
                                            Download
                                          </Button>
                                          {canRemoveProductionFiles ? (
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              onClick={() => { setFilePendingRemoval(file); setRemovalReason(""); }}
                                              disabled={removeFinalFileMutation.isPending}
                                              className="h-8 border-rose-400/40 text-[11px] text-rose-100 hover:bg-rose-500/10"
                                            >
                                              Remove Candidate
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {uploadingFiles.length > 0 ? (
                                  <div className="mt-3 rounded border border-[#1773cf]/40 bg-[#1773cf]/10 p-3 text-xs text-slate-200">
                                    <div className="font-semibold">Recently Uploaded / In Progress</div>
                                    <div className="mt-2 flex flex-wrap gap-3">
                                      {uploadingFiles.map((upload) => (
                                        <div key={upload.id} className="max-w-[10rem]">
                                          <div className="h-1 rounded bg-slate-800">
                                            <div className="h-full rounded bg-[#1773cf]" style={{ width: `${upload.progress}%` }} />
                                          </div>
                                          <div className="mt-1 truncate text-[11px] text-slate-400">{upload.filename}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </section>
                            </div>

                            <footer className="border-t border-[#2d3748] bg-[#1a232e] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                                <span>{getPrepressCombinedRunItemBlocker(selectedItem) ? "Resolve artwork, then use Next when the line is Ready." : "Ready. Close the resolver and continue when you choose."}</span>
                                <Button type="button" size="sm" onClick={closeCombinedRunArtworkResolver} className="h-8 bg-violet-600 text-white hover:bg-violet-700">
                                  Done
                                </Button>
                              </div>
                            </footer>
                          </div>
                        ) : (
                          <div className="p-4 text-sm text-slate-300">
                            Loading selected line artwork tools...
                          </div>
                        )}
                      </aside>
                    ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {combinedRunWizardStep === 3 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Step 3: Plan Run</h3>
                    <p className="mt-1 text-xs text-slate-400">Use the canonical sheet-layout recommendation for matching artwork. Enter an override only when production intentionally differs.</p>
                  </div>
                  {combinedRunSheetPlanStaleMessage ? (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100" role="alert">
                      {combinedRunSheetPlanStaleMessage}
                    </div>
                  ) : null}
                  <section className="overflow-hidden rounded-lg border border-[#2d3748] bg-[#111921]" data-testid="combined-run-final-members">
                    <div className="border-b border-[#2d3748] px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-400">Selected run members and artwork quantities</div>
                  <div className="divide-y divide-[#2d3748]">
                    {selectedQueueItems.map((item) => (
                      <div key={item.lineItemId} className="grid gap-3 p-3 text-xs xl:grid-cols-[minmax(0,1fr)_120px]">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{item.lineNumber ? `Line ${item.lineNumber}: ` : ""}{item.productName}</div>
                          <div className="mt-1 text-slate-400">
                            {item.productionDestinationLabel || item.selectedProductionDestination || "No destination"} - {item.materialName || item.media || "No material"}
                          </div>
                          <div className="mt-2">
                            <ArtworkProductionBreakdownList item={item} compact />
                          </div>
                        </div>
                        <div className="font-mono text-slate-200">Qty {combinedRunAllocations[item.lineItemId] ?? item.quantity}</div>
                      </div>
                    ))}
                  </div>
                  </section>
                  <div className="rounded-lg border border-[#2d3748] bg-[#0f172a] p-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300">Sheet and Layout Inputs</h4>
                    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Sheet width</span><Input value={combinedRunSheetWidth} onChange={(event) => setCombinedRunSheetWidth(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Sheet height</span><Input value={combinedRunSheetHeight} onChange={(event) => setCombinedRunSheetHeight(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Bleed</span><Input value={combinedRunBleed} onChange={(event) => setCombinedRunBleed(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Spacing / gutter</span><Input value={combinedRunSpacing} onChange={(event) => setCombinedRunSpacing(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <Checkbox checked={combinedRunAllowRotation} onCheckedChange={(checked) => setCombinedRunAllowRotation(checked === true)} aria-label="Allow sheet rotation" />
                        Rotation allowed
                      </label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Top margin</span><Input value={combinedRunMarginTop} onChange={(event) => setCombinedRunMarginTop(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Right margin</span><Input value={combinedRunMarginRight} onChange={(event) => setCombinedRunMarginRight(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Bottom margin</span><Input value={combinedRunMarginBottom} onChange={(event) => setCombinedRunMarginBottom(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                      <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Left margin</span><Input value={combinedRunMarginLeft} onChange={(event) => setCombinedRunMarginLeft(event.target.value)} inputMode="decimal" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">Changing these inputs recalculates the recommendation automatically.</p>
                  </div>
                  <div className={cn(
                    "rounded-lg border p-4",
                    combinedRunSheetPlan.canAutoPlan ? "border-emerald-400/30 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10",
                  )}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300">Calculated Result</h4>
                        <p className="mt-1 text-xs text-slate-400">
                          {combinedRunSheetPlan.canAutoPlan
                            ? `${combinedRunSheetPlan.totalQuantity} pieces at ${formatSheetPlanNumber(combinedRunSheetPlan.nominalPiecesPerSheet)} up on ${formatSheetPlanNumber(combinedRunSheetPlan.sheetWidth)} x ${formatSheetPlanNumber(combinedRunSheetPlan.sheetHeight)} sheets.`
                            : combinedRunSheetPlan.reason}
                        </p>
                      </div>
                      <span className={cn("rounded border px-2 py-1 text-[11px] font-semibold", combinedRunSheetPlan.canAutoPlan ? "border-emerald-400/40 text-emerald-100" : "border-amber-400/40 text-amber-100")}>
                        {combinedRunSheetPlan.canAutoPlan ? "Recalculated" : "Needs plan"}
                      </span>
                    </div>
                    {combinedRunSheetPlan.canAutoPlan ? (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-lg border border-violet-300/60 bg-violet-500/15 px-4 py-3" data-testid="combined-run-sheets-required">
                          <div className="text-3xl font-black leading-none text-white">{combinedRunSheetPlan.plannedSheetCount}</div>
                          <div className="mt-1 text-xs font-bold uppercase tracking-widest text-violet-100">Sheets required</div>
                          <div className="mt-1 text-[11px] text-slate-300">{combinedRunSheetPlan.fullSheets} full sheets{combinedRunSheetPlan.partialSheetPieces ? ` + 1 partial sheet with ${combinedRunSheetPlan.partialSheetPieces} pieces` : " · No partial sheet"}</div>
                        </div>
                        <div className="grid gap-2 text-xs md:grid-cols-4">
                        <div><span className="text-slate-500">Pieces/sheet:</span> {combinedRunSheetPlan.nominalPiecesPerSheet}</div>
                        <div><span className="text-slate-500">Full sheets:</span> {combinedRunSheetPlan.fullSheets}</div>
                        <div><span className="text-slate-500">Partial:</span> {combinedRunSheetPlan.partialSheetPieces ? `${combinedRunSheetPlan.partialSheetPieces} pieces` : "none"}</div>
                        <div><span className="text-slate-500">Impressions:</span> {combinedRunSheetPlan.printPasses}</div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {combinedRunPlannedSheetCount && combinedRunPiecesPerSheet ? (
                    <div className={cn("rounded-lg border px-3 py-2 text-xs", combinedRunExpectedPlacements > 0 && combinedRunExpectedPlacements !== combinedRunValidation.totalAllocatedQuantity ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-[#2d3748] bg-[#0f172a] text-slate-300")}>
                      Effective nest: {combinedRunExpectedPlacements} placements from {effectiveCombinedRunPlannedSheetCount ?? "unresolved"} sheets x {effectiveCombinedRunPiecesPerSheet ?? "unresolved"} pieces per sheet. Allocated quantity: {combinedRunValidation.totalAllocatedQuantity}.
                    </div>
                  ) : null}
                  {combinedRunHasPlacementMismatch ? (
                    <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                      <Checkbox checked={combinedRunMismatchAcknowledged} onCheckedChange={(checked) => setCombinedRunMismatchAcknowledged(checked === true)} aria-label="Acknowledge nested placement mismatch" />
                      <span>I reviewed the placement mismatch and still want to create this nested run.</span>
                    </label>
                  ) : null}
                  <details className="rounded-lg border border-[#2d3748] bg-[#0f172a] p-3" open={combinedRunManualSheetOverride || !combinedRunSheetPlan.canAutoPlan}>
                    <summary className="cursor-pointer text-xs font-semibold text-slate-300">Advanced / Authorized Override</summary>
                    <div className="mt-3 space-y-3">
                      <label className="flex items-start gap-2 rounded border border-[#2d3748] bg-[#111921] px-3 py-2 text-xs text-slate-300">
                        <Checkbox
                          checked={combinedRunManualSheetOverride}
                          onCheckedChange={(checked) => {
                            const enabled = checked === true;
                            setCombinedRunManualSheetOverride(enabled);
                            setCombinedRunSheetPlanOverrideInputKey(enabled ? combinedRunSheetPlan.inputKey : null);
                            if (!enabled) {
                              setCombinedRunSheetPlanOverrideReason("");
                              setCombinedRunPlannedSheetCount(combinedRunSheetPlan.plannedSheetCount ? String(combinedRunSheetPlan.plannedSheetCount) : "");
                              setCombinedRunPiecesPerSheet(combinedRunSheetPlan.nominalPiecesPerSheet ? String(combinedRunSheetPlan.nominalPiecesPerSheet) : "");
                            }
                          }}
                          aria-label="Use authorized manual sheet-plan override"
                        />
                        <span>Use an authorized manual output override for planned sheets and pieces per sheet.</span>
                      </label>
                      {combinedRunManualSheetOverride ? (
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Manual planned sheets</span><Input value={combinedRunPlannedSheetCount} onChange={(event) => setCombinedRunPlannedSheetCount(event.target.value)} inputMode="numeric" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                          <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Manual pieces per sheet</span><Input value={combinedRunPiecesPerSheet} onChange={(event) => setCombinedRunPiecesPerSheet(event.target.value)} inputMode="numeric" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                          <label className="space-y-1"><span className="text-xs font-medium text-slate-400">Override reason</span><Input value={combinedRunSheetPlanOverrideReason} onChange={(event) => setCombinedRunSheetPlanOverrideReason(event.target.value)} placeholder="Who authorized this plan and why" className="h-9 bg-[#111921] border-[#2d3748]" /></label>
                        </div>
                      ) : null}
                      {combinedRunManualSheetOverrideIsStale ? (
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          Layout inputs changed after this override was enabled. Review the calculated result and reconfirm the manual override before continuing.
                          <Button type="button" size="sm" variant="outline" className="ml-2 h-7 border-amber-400/40 text-[11px] text-amber-100 hover:bg-amber-500/10" onClick={() => setCombinedRunSheetPlanOverrideInputKey(combinedRunSheetPlan.inputKey)}>
                            Reconfirm override
                          </Button>
                        </div>
                      ) : null}
                      {combinedRunManualSheetOverride && combinedRunSheetPlan.canAutoPlan ? (
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          Manual output override active. Calculated recommendation remains {combinedRunSheetPlan.plannedSheetCount} sheets x {combinedRunSheetPlan.nominalPiecesPerSheet} pieces per sheet.
                        </div>
                      ) : null}
                      {(combinedRunValidation.hasStationConflict || combinedRunValidation.hasMaterialConflict) ? (
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-400">Authorized compatibility override reason</span>
                          <Input value={combinedRunOverrideReason} onChange={(event) => setCombinedRunOverrideReason(event.target.value)} placeholder="Explain why these lines can share one physical run" className="bg-[#111921] border-[#2d3748]" />
                        </label>
                      ) : <p className="text-xs text-slate-500">No compatibility override is currently required.</p>}
                    </div>
                  </details>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-400">Nesting notes</span>
                    <Textarea value={combinedRunNotes} onChange={(event) => setCombinedRunNotes(event.target.value)} placeholder="Sheet layout, orientation, grouping, or operator notes" className="min-h-20 bg-[#0f172a] border-[#2d3748]" />
                  </label>
                </div>
              ) : null}

              {combinedRunWizardStep === 4 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Step 4: Final Review</h3>
                    <section className="mt-3 rounded-lg border border-violet-400/40 bg-violet-500/10 p-4" data-testid="combined-run-final-production-plan">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest text-violet-100">Production Plan</h4>
                          <p className="mt-1 text-[11px] text-slate-300">{combinedRunManualSheetOverride ? "Effective plan is manually overridden." : "Canonical calculated production plan."}</p>
                        </div>
                        <div className="rounded border border-violet-200/60 bg-[#111921] px-4 py-3 text-right">
                          <div className="text-3xl font-black leading-none text-white">{effectiveCombinedRunPlannedSheetCount ?? "Unable to calculate"}</div>
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-violet-100">Sheets required</div>
                        </div>
                      </div>
                      {combinedRunSheetPlan.canAutoPlan ? (
                        <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                          <div><span className="text-slate-400">Sheet size:</span> {formatSheetPlanNumber(combinedRunSheetPlan.sheetWidth)} x {formatSheetPlanNumber(combinedRunSheetPlan.sheetHeight)}</div>
                          <div><span className="text-slate-400">Pieces/sheet:</span> {effectiveCombinedRunPiecesPerSheet ?? combinedRunSheetPlan.nominalPiecesPerSheet}</div>
                          <div><span className="text-slate-400">Total pieces:</span> {combinedRunValidation.totalAllocatedQuantity}</div>
                          <div><span className="text-slate-400">Impressions:</span> {combinedRunSheetPlan.printPasses}</div>
                          <div><span className="text-slate-400">Partial sheet:</span> {combinedRunSheetPlan.partialSheetPieces ? `${combinedRunSheetPlan.partialSheetPieces} pieces` : "No partial sheet"}</div>
                          <div><span className="text-slate-400">Plan status:</span> {combinedRunManualSheetOverride ? "Manually overridden" : "Calculated"}</div>
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-amber-100">Unable to calculate — {combinedRunSheetPlan.reason || "Missing layout input. Manual plan required."}</div>
                      )}
                      {combinedRunManualSheetOverride && combinedRunSheetPlan.canAutoPlan ? <div className="mt-3 text-[11px] text-amber-100">Calculated recommendation: {combinedRunSheetPlan.plannedSheetCount} sheets. Effective run plan: {effectiveCombinedRunPlannedSheetCount} sheets. Reason: {combinedRunSheetPlanOverrideReason || "Not provided"}.</div> : null}
                    </section>
                    <section className="mt-4 rounded-lg border border-[#2d3748] bg-[#0f172a] p-4" data-testid="combined-run-production-file-strategy">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300">Production File Strategy</h4>
                      <RadioGroup value={combinedRunFileStrategy} onValueChange={(value) => setCombinedRunFileStrategy(value === "manual_upload_after_create" ? "manual_upload_after_create" : "rip_managed")} className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className={cn("flex cursor-pointer gap-3 rounded border p-3 text-xs", combinedRunFileStrategy === "rip_managed" ? "border-emerald-300 bg-emerald-500/15 text-emerald-50 ring-1 ring-emerald-300/40" : "border-[#2d3748] bg-[#111921] text-slate-300")}>
                          <RadioGroupItem value="rip_managed" id="combined-run-file-strategy-rip" />
                          <span><span className="block font-semibold">RIP will nest member artwork</span><span className="mt-1 block text-slate-400">Use the individual member production files as the active production inputs.</span></span>
                        </label>
                        <label className={cn("flex cursor-pointer gap-3 rounded border p-3 text-xs", combinedRunFileStrategy === "manual_upload_after_create" ? "border-violet-300 bg-violet-500/15 text-violet-50 ring-1 ring-violet-300/40" : "border-[#2d3748] bg-[#111921] text-slate-300")}>
                          <RadioGroupItem value="manual_upload_after_create" id="combined-run-file-strategy-manual" />
                          <span><span className="block font-semibold">Staff-prepared nested file</span><span className="mt-1 block text-slate-400">Create the draft run, then upload the prepared nested PDF, TIFF, or supported production file on the next screen.</span></span>
                        </label>
                      </RadioGroup>
                      <p className={cn("mt-3 rounded border px-3 py-2 text-xs", combinedRunFileStrategy === "manual_upload_after_create" ? "border-violet-400/40 bg-violet-500/10 text-violet-100" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100")}>
                        {combinedRunFileStrategy === "manual_upload_after_create" ? "The run will be created as a draft. You will upload the nested production file on the next screen. The run cannot be released until that file is uploaded." : "RIP-managed nesting uses the individual member production files. A shared run file is not required before release."}
                      </p>
                    </section>
                    <div className="mt-3 grid gap-3 text-xs md:grid-cols-4">
                      <div><span className="text-slate-500">Target station:</span> {combinedRunValidation.stationKey || "Not resolved"}</div>
                      <div><span className="text-slate-500">Material:</span> {selectedQueueDestinationLabels.length === 1 ? selectedQueueDestinationLabels[0] : "Mixed / override required"}</div>
                      <div><span className="text-slate-500">Allocated:</span> {combinedRunValidation.totalAllocatedQuantity}</div>
                      <div><span className="text-slate-500">Sheet planning:</span> {combinedRunExpectedPlacements > 0 ? `${combinedRunExpectedPlacements} placements (${combinedRunManualSheetOverride ? "manual override" : "calculated"})` : "Not entered"}</div>
                    </div>
                    {!canSubmitCombinedRun && combinedRunValidation.reason ? (
                      <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{combinedRunValidation.reason}</div>
                    ) : null}
                  </div>
                  <div className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">Selected run members and artwork quantities</div>
                  <div className="divide-y divide-[#2d3748] overflow-hidden rounded-lg border border-[#2d3748] bg-[#111921]">
                    {selectedQueueItems.map((item) => {
                      const blocker = getPrepressCombinedRunItemBlocker(item);
                      const needsArtwork = Boolean(blocker);
                      return (
                        <div key={item.lineItemId} className="p-3 text-xs">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="truncate font-semibold text-white">Order {item.jobNumber || item.orderId}{item.lineNumber ? ` - Line ${item.lineNumber}` : ""}: {item.productName}</div>
                              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", needsArtwork ? "border-amber-400/40 text-amber-100" : "border-emerald-400/40 text-emerald-200")}>
                                {needsArtwork ? blocker?.message || "Artwork review required" : "Ready"}
                              </span>
                            </div>
                            <div className="mt-1 text-slate-400">{item.customerName || "Customer/contact not resolved"}</div>
                            <div className="mt-1 text-slate-500">Total member quantity: {combinedRunAllocations[item.lineItemId] ?? item.quantity} of {item.quantity} ordered · Qty to Produce shown per artwork below</div>
                            <div className="mt-2">
                              <ArtworkProductionBreakdownList item={item} showHeader />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="hidden rounded-lg border border-[#2d3748] bg-[#1a232e] p-4" aria-hidden="true">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Production File Strategy</h3>
                    <RadioGroup
                      value={combinedRunFileStrategy}
                      onValueChange={(value) => setCombinedRunFileStrategy(value === "manual_upload_after_create" ? "manual_upload_after_create" : "rip_managed")}
                      className="mt-3 grid gap-3 md:grid-cols-2"
                    >
                      <label className={cn(
                        "flex cursor-pointer gap-3 rounded border p-3 text-xs",
                        combinedRunFileStrategy === "rip_managed" ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100" : "border-[#2d3748] bg-[#0f172a] text-slate-300",
                      )}>
                        <RadioGroupItem value="rip_managed" id="combined-run-file-strategy-rip" />
                        <span>
                          <span className="block font-semibold">RIP will nest member artwork</span>
                          <span className="mt-1 block text-slate-400">Create the run with the source member files shown above. The downstream operator or RIP creates the final nesting.</span>
                        </span>
                      </label>
                      <label className={cn(
                        "flex cursor-pointer gap-3 rounded border p-3 text-xs",
                        combinedRunFileStrategy === "manual_upload_after_create" ? "border-violet-400/50 bg-violet-500/10 text-violet-100" : "border-[#2d3748] bg-[#0f172a] text-slate-300",
                      )}>
                        <RadioGroupItem value="manual_upload_after_create" id="combined-run-file-strategy-manual" />
                        <span>
                          <span className="block font-semibold">Upload prepared nested file after run creation</span>
                          <span className="mt-1 block text-slate-400">Create a draft run, open its detail panel, and upload the shared production file there. Release remains blocked until an active run-owned file exists.</span>
                        </span>
                      </label>
                    </RadioGroup>
                    {combinedRunFileStrategy === "manual_upload_after_create" ? (
                      <div className="mt-3 rounded border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-100">
                        After Create Combined Run, use the Shared Production Files upload in the opened run detail. Source member artwork remains unchanged.
                      </div>
                    ) : (
                      <div className="mt-3 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                        No run-owned upload is required before creation for RIP-managed nesting.
                      </div>
                    )}
                  </div>
                  {combinedRunOverrideReason.trim() ? (
                    <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3 text-xs text-violet-100">
                      Authorized override reason: {combinedRunOverrideReason}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="z-30 shrink-0 border-t border-[#2d3748] bg-[#1a232e] p-4 shadow-2xl" data-testid="prepress-combined-run-wizard-footer">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-slate-300">
                  <span className="font-bold text-violet-100">{selectedQueueItems.length} selected</span>
                  <span className="ml-2">Step {combinedRunWizardStep} of 4</span>
                  {currentCombinedRunStepBlocker ? (
                    <span className="ml-2 text-amber-300" role="status">{currentCombinedRunStepBlocker}</span>
                  ) : (
                    <span className="ml-2 text-slate-500">{combinedRunWizardStep === 4 ? "Ready for final validation." : "Ready to continue."}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={cancelCombinedRunWizard} disabled={createCombinedRunMutation.isPending}>
                    Cancel
                  </Button>
                  {combinedRunWizardStep > 1 ? (
                    <Button type="button" variant="outline" onClick={() => setCombinedRunWizardStep((step) => Math.max(1, step - 1) as CombinedRunWizardStep)} disabled={createCombinedRunMutation.isPending}>
                      Back
                    </Button>
                  ) : null}
                  {combinedRunWizardStep < 4 ? (
                    <Button
                      type="button"
                      onClick={() => setCombinedRunWizardStep((step) => Math.min(4, step + 1) as CombinedRunWizardStep)}
                      disabled={Boolean(currentCombinedRunStepBlocker) || createCombinedRunMutation.isPending}
                      title={currentCombinedRunStepBlocker || undefined}
                    >
                      {combinedRunNextLabel}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleCreateCombinedRun}
                      disabled={Boolean(currentCombinedRunStepBlocker) || createCombinedRunMutation.isPending}
                      title={currentCombinedRunStepBlocker || undefined}
                      className="bg-violet-600 text-white hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500"
                    >
                      {createCombinedRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {combinedRunFileStrategy === "manual_upload_after_create" ? "Create Run & Upload Nested File" : "Create Combined Run"}
                    </Button>
                  )}
                </div>
              </div>
            </footer>
          </div>
        ) : selectedQueueItems.length > 1 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="border-b border-[#2d3748] bg-[#1a232e]/30 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Multi-selection</p>
              <h2 className="mt-1 text-2xl font-black text-white">{selectedQueueItems.length} selected jobs</h2>
              <p className="mt-1 text-xs text-slate-400">Review the batch before completing or nesting from the bottom action bar.</p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-28">
              <div className="grid gap-3 text-xs md:grid-cols-4">
                <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Orders</p><p className="mt-1 text-lg font-bold text-white">{selectedQueueOrderNumbers.length || 0}</p></div>
                <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Total quantity</p><p className="mt-1 text-lg font-bold text-white">{selectedQueueTotalQuantity}</p></div>
                <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Destination</p><p className="mt-1 text-sm font-bold text-white">{selectedQueueDestinationLabels.length === 1 ? selectedQueueDestinationLabels[0] : "Mixed"}</p></div>
                <div className="rounded-lg border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Nesting status</p><p className="mt-1 text-sm font-bold text-white">{selectedQueueValidationLabel}</p></div>
              </div>
              <div className="mt-4 divide-y divide-[#2d3748] overflow-hidden rounded-lg border border-[#2d3748] bg-[#111921]">
                {selectedQueueItems.map((item) => (
                  <div key={item.lineItemId} className="grid gap-2 p-3 text-xs xl:grid-cols-[minmax(0,1fr)_150px_120px]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">Order {item.jobNumber || item.orderId}{item.lineNumber ? ` - Line ${item.lineNumber}` : ""}: {item.productName}</div>
                      <div className="mt-1 truncate text-slate-400">{item.customerName || "Customer/contact not resolved"}</div>
                    </div>
                    <div className="text-slate-400">{item.productionDestinationLabel || item.selectedProductionDestination || "No destination"}</div>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedLineItemId(item.lineItemId); setSelectedQueueLineItemIds(new Set([item.lineItemId])); }} className="h-8">Open job</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : !selectedItem ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg border border-[#2d3748] bg-[#1a232e]">
                <FileText className="h-7 w-7 text-slate-500" />
              </div>
              <h2 className="mt-5 text-xl font-black text-white">Select a job item</h2>
              <p className="mt-2 text-sm text-slate-400">Choose a queue item to review job specifications, customer artwork, proof files, and production artwork.</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Queue</p><p className="mt-1 font-bold text-white">{filteredQueueCount} jobs</p></div>
                <div className="rounded border border-[#2d3748] bg-[#1a232e] p-3"><p className="text-slate-500">Selected</p><p className="mt-1 font-bold text-white">{selectedQueueItems.length}</p></div>
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Workspace Header */}
        <header className="p-6 border-b border-[#2d3748] bg-[#1a232e]/30 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h2 className="text-2xl font-black text-white">
                {selectedItem ? selectedItem.jobNumber : "Select a line item"}
              </h2>
              {selectedItem && (
                <div className="flex items-center gap-2 mt-1">
                  {selectedItem.lineNumber ? <span className="text-slate-300 text-xs font-semibold">Line {selectedItem.lineNumber}</span> : null}
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest",
                    selectedWorkflowDisplay.bgClass,
                    selectedWorkflowDisplay.textClass,
                    selectedWorkflowDisplay.borderClass,
                  )}>
                    {selectedWorkflowDisplay.label}
                  </span>
                  {selectedWorkflowDisplay.note && (
                    <span className="text-emerald-300 text-xs">{selectedWorkflowDisplay.note}</span>
                  )}
                  {selectedItem.assignedTo && (
                    <span className="text-slate-400 text-xs">Assigned to: {selectedItem.assignedTo}</span>
                  )}
                  {selectedOwnerLabel && (
                    <span className="text-slate-400 text-xs">
                      Owner: {selectedOwnerLabel}
                    </span>
                  )}
                  {selectedWorkflowState === "in_prepress" && selectedItem.sessionStartedAt && (
                    <span className="text-[#1773cf] text-xs font-semibold">
                      Timer: {formatElapsedDuration(activeSessionElapsedSeconds)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="h-10 w-px bg-[#2d3748]"></div>
            <div className="flex gap-8">
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Customer</p>
                <p className="text-sm font-semibold">{selectedItem?.customerName || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Due Date</p>
                <p className={cn("text-sm font-semibold", selectedItem?.rush && "text-[#e53e3e]")}>
                  {selectedItem?.dueDate ? new Date(selectedItem.dueDate).toLocaleDateString() : "—"}
                </p>
              </div>
              {selectedWorkflowState === "in_prepress" && selectedItem?.sessionStartedAt ? (
                <div>
                  <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Started</p>
                  <p className="text-sm font-semibold text-[#1773cf]">
                    {formatDistanceToNow(new Date(selectedItem.sessionStartedAt), { addSuffix: true })}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              onClick={handleOpenHistory}
              disabled={!selectedItem}
            >
              <History className="w-4 h-4" /> History
            </button>
            <button
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              onClick={handleOpenSpecSheet}
              disabled={!selectedItem}
            >
              <FileText className="w-4 h-4" /> Spec Sheet
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-8 pb-6">
          {/* Section 1: Job Specifications */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" /> Job Specifications
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 bg-[#1a232e] p-5 border border-[#2d3748] rounded-lg shadow-sm items-start">
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Product</p>
                <p className="text-sm font-medium">
                  {selectedItem?.lineNumber ? `Line ${selectedItem.lineNumber} · ` : ""}{selectedItem?.productName || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Size</p>
                <p className="text-sm font-medium">
                  {selectedItem?.width && selectedItem?.height 
                    ? `${selectedItem.width}" x ${selectedItem.height}"` 
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Qty</p>
                <p className="text-sm font-medium">{selectedItem?.quantity ? `${selectedItem.quantity} units` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Sq Footage</p>
                <p className="text-sm font-medium text-[#1773cf]">
                  {selectedItem?.sqFootage ? `${selectedItem.sqFootage.toFixed(1)} sq ft` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Media</p>
                <p className="text-sm font-medium break-words">{selectedItem?.media || "Not specified"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Production Destination</p>
                <Select
                  value={selectedItem?.destinationOverrideActive ? selectedItem?.selectedProductionDestination || "auto" : "auto"}
                  onValueChange={handleProductionDestinationChange}
                  disabled={!selectedItem || updateProductionDestinationMutation.isPending}
                >
                  <SelectTrigger className="h-8 bg-[#111921] border-[#2d3748] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto / Suggested</SelectItem>
                    <SelectItem value="roll">Roll</SelectItem>
                    <SelectItem value="flatbed">Flatbed</SelectItem>
                  </SelectContent>
                </Select>
                <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                  <div>
                    Suggested: {selectedItem?.suggestedProductionDestination
                      ? selectedItem.suggestedProductionDestination === "roll" ? "Roll" : "Flatbed"
                      : "—"}
                  </div>
                  <div>
                    Selected: {selectedItem?.selectedProductionDestination
                      ? selectedItem.selectedProductionDestination === "roll" ? "Roll" : "Flatbed"
                      : "—"}
                    {selectedItem?.destinationOverrideActive ? <span className="ml-1 text-amber-300">Override active</span> : null}
                  </div>
                </div>
              </div>
              <div className="xl:col-start-1">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Bleed</p>
                <p className="text-sm font-medium">{selectedItem?.bleed || "—"}</p>
              </div>
              <div className="xl:col-start-2">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Print Sides</p>
                <p className="text-sm font-medium" data-testid="prepress-print-sides">
                  {selectedItem?.printSides || "Unknown"}
                </p>
              </div>
              <div className="sm:col-span-2 xl:col-start-3 xl:col-span-2 min-w-0 overflow-hidden">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Options</p>
                {(selectedItem?.optionsRows?.length || 0) > 0 ? (
                  <div className="space-y-1.5 min-w-0 max-w-full">
                    {Object.entries(
                      (selectedItem?.optionsRows || []).reduce((acc, row) => {
                        const key = row.groupLabel && row.groupLabel.trim() ? row.groupLabel.trim() : "Options";
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(row);
                        return acc;
                      }, {} as Record<string, NonNullable<PrepressQueueItem["optionsRows"]>>)
                    ).map(([groupLabel, rows]) => (
                      <div key={groupLabel}>
                        {groupLabel !== "Options" && (
                          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{groupLabel}</p>
                        )}
                        <ul className="text-sm font-medium list-disc pl-4 space-y-1 min-w-0 max-w-full">
                          {rows.map((row: NonNullable<PrepressQueueItem["optionsRows"]>[number], index: number) => (
                            <li key={`${groupLabel}-${row.optionLabel}-${row.selectedLabel}-${index}`} className="min-w-0 break-words [overflow-wrap:anywhere]">
                              <span>{row.optionLabel}: {row.selectedLabel}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-slate-400">—</p>
                )}
              </div>
              <div className="xl:col-start-5">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Priority</p>
                <p className={cn("text-sm font-bold", selectedItem?.rush ? "text-[#e53e3e]" : "text-slate-400")}>
                  {selectedItem?.rush ? "RUSH" : selectedItem?.priorityLabel || "Normal"}
                </p>
              </div>
              <div className="sm:col-span-2 xl:col-start-6 xl:col-span-1 min-w-0 overflow-hidden">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Line Item Notes</p>
                <p className="text-sm font-medium text-slate-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {selectedItem?.lineItemNotes || "No line item notes"}
                </p>
              </div>
            </div>

            {selectedMediaFitWarning && (
              <div
                className="mt-3 rounded-lg border border-amber-600/50 bg-amber-950/20 p-4 text-sm text-amber-100"
                data-testid="prepress-media-fit-warning"
              >
                <div className="font-semibold">{selectedMediaFitWarning.title}</div>
                <div className="mt-1">{selectedMediaFitWarning.description}</div>
              </div>
            )}

            {selectedItem?.printSides === "Double-sided" && (
              <div
                className={cn(
                  "mt-3 rounded-lg border p-4",
                  artworkSideReadiness.complete
                    ? "border-emerald-700/40 bg-emerald-950/15"
                    : "border-amber-600/50 bg-amber-950/20",
                )}
                data-testid="prepress-artwork-side-summary"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {artworkSideReadiness.complete
                    ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                    : <AlertCircle className="h-4 w-4 text-amber-400" />}
                  Double-sided artwork assignment
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  <div><span className="text-slate-500">Same artwork both sides:</span> {selectedItem.useSameArtworkBothSides ? "Yes" : "No"}</div>
                  <div><span className="text-slate-500">Front artwork:</span> {artworkFilename(artworkSideReadiness.front)}</div>
                  <div><span className="text-slate-500">Back artwork:</span> {artworkFilename(artworkSideReadiness.back)}</div>
                  <div><span className="text-slate-500">Both sides artwork:</span> {artworkSideReadiness.both ? artworkFilename(artworkSideReadiness.both) : "Not assigned"}</div>
                </div>
                {artworkSideReadiness.warning && (
                  <p className="mt-2 text-xs font-medium text-amber-300" role="alert">
                    {artworkSideReadiness.warning} Assign a file below as Front, Back, or Both before releasing this job.
                  </p>
                )}
              </div>
            )}

          </section>

          {/* Customer artwork remains selectable and downloadable until completion. */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> Customer Artwork
              </h3>
              <div className="flex items-center gap-3">
                {selectedLineItemId && (
                  <button
                    onClick={() => {
                      setUploadRole("original");
                      fileInputRef.current?.click();
                    }}
                    className="text-xs font-bold text-[#1773cf] hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-4 h-4" /> Upload Replacement Art
                  </button>
                )}
                {selectedLineItemId && visibleOriginalFiles.length > 0 && (
                  <button
                    onClick={handleDownloadAllOriginals}
                    className="text-xs font-bold text-[#1773cf] hover:underline flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" /> Download All
                  </button>
                )}
              </div>
            </div>
            <div className="mb-3">
              <ArtworkProductionBreakdownList
                item={selectedItem}
                showHeader
                updating={updateFinalArtworkAllocationMutation.isPending}
                onUpdateQuantity={(fileId, productionQuantity) => {
                  if (!selectedItem) return;
                  updateFinalArtworkAllocationMutation.mutate({
                    lineItemId: selectedItem.lineItemId,
                    fileId,
                    productionQuantity,
                  });
                }}
              />
            </div>
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">Filename</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Upload Date</th>
                    <th className="px-4 py-3 font-semibold">Uploaded By</th>
                    <th className="px-4 py-3 font-semibold">Tag</th>
                    <th className="px-4 py-3 font-semibold">Artwork Side</th>
                    <th className="px-4 py-3 font-semibold">Source Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {visibleOriginalFiles.length === 0 && visibleBridgedOriginalFiles.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                        {selectedLineItemId ? "No customer artwork uploaded" : "Select a line item to view files"}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {visibleOriginalFiles.map((file) => (
                        <tr key={file.id} className="hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => handleOpenViewer(file.id)}>
                          <td className="px-4 py-3">
                            <FileThumbnail
                              fileId={file.id}
                              filename={file.originalFilename || file.fileName}
                              mimeType={file.mimeType || undefined}
                              thumbnailUrl={file.thumbUrl || undefined}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-200">{file.displayName}</td>
                          <td className="px-4 py-3 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</td>
                          <td className="px-4 py-3">{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "—"}</td>
                          <td className="px-4 py-3">{file.uploadedByLabel}</td>
                          <td className="px-4 py-3">
                            <span className="bg-slate-700 px-2 py-0.5 rounded">{file.tagLabel}</span>
                          </td>
                          <td className="px-4 py-3">
                            {selectedItem?.printSides === "Double-sided" && file.artworkAssignable ? (
                              <PrepressArtworkSideSelect
                                filename={file.displayName}
                                side={file.sideLabel}
                                disabled={assignArtworkSideMutation.isPending}
                                onAssign={(side) => assignArtworkSideMutation.mutate({
                                  orderId: selectedItem.orderId,
                                  lineItemId: selectedItem.lineItemId,
                                  fileId: file.artworkAssignmentFileId,
                                  side,
                                })}
                              />
                            ) : <PrepressArtworkSideBadge side={file.sideLabel} />}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{sourceArtworkStatus}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  window.open(file.downloadUrl, "_blank");
                                }}
                                className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-[#1773cf]/20 hover:border-[#1773cf] transition-all"
                              >
                                Download
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  assignCustomerArtworkMutation.mutate({
                                    lineItemId: selectedItem!.lineItemId,
                                    file,
                                    tag: selectedTag !== "none" ? selectedTag : "final_print",
                                  });
                                }}
                                disabled={!selectedItem || assignCustomerArtworkMutation.isPending}
                                className="bg-emerald-600/20 border border-emerald-400/50 px-3 py-1 rounded text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50 transition-all"
                              >
                                Use as Production Artwork
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPromotionSourceFile(file);
                                  setPromotionTag(selectedTag !== "none" ? selectedTag : "final_print");
                                }}
                                className="bg-violet-600/20 border border-violet-400/50 px-3 py-1 rounded text-violet-100 hover:bg-violet-600/30 transition-all"
                              >
                                Create Modified Copy
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {/* Bridged files: customer artwork uploaded on the Order page before prepress */}
                      {visibleBridgedOriginalFiles.length > 0 && (
                        <>
                          <tr className="bg-amber-950/20">
                            <td colSpan={9} className="px-4 py-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
                                Pre-submitted by customer (from order)
                              </span>
                            </td>
                          </tr>
                          {visibleBridgedOriginalFiles.map((file) => (
                            <tr key={`bridged-${file.id}`} className="hover:bg-white/5 transition-colors cursor-pointer bg-amber-950/10" onClick={() => handleOpenViewer(file.id)}>
                              <td className="px-4 py-3">
                                <FileThumbnail
                                  filename={file.originalFilename || file.fileName}
                                  mimeType={file.mimeType || undefined}
                                  thumbnailUrl={file.thumbUrl || undefined}
                                />
                              </td>
                              <td className="px-4 py-3 font-medium text-slate-200">{file.displayName}</td>
                              <td className="px-4 py-3 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</td>
                              <td className="px-4 py-3">{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "—"}</td>
                              <td className="px-4 py-3">{file.uploadedByLabel}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  <span className="bg-amber-900/50 text-amber-300 border border-amber-700/40 px-2 py-0.5 rounded text-[9px] font-bold uppercase">{file.tagLabel}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {selectedItem?.printSides === "Double-sided" && file.artworkAssignable ? (
                                  <PrepressArtworkSideSelect
                                    filename={file.displayName}
                                    side={file.sideLabel}
                                    disabled={assignArtworkSideMutation.isPending}
                                    onAssign={(side) => assignArtworkSideMutation.mutate({
                                      orderId: selectedItem.orderId,
                                      lineItemId: selectedItem.lineItemId,
                                      fileId: file.artworkAssignmentFileId,
                                      side,
                                    })}
                                  />
                                ) : <PrepressArtworkSideBadge side={file.sideLabel} />}
                              </td>
                              <td className="px-4 py-3 text-slate-400">{sourceArtworkStatus}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      window.open(file.downloadUrl, "_blank");
                                    }}
                                    className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-amber-900/30 hover:border-amber-600 transition-all"
                                  >
                                    Download
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      assignCustomerArtworkMutation.mutate({
                                        lineItemId: selectedItem!.lineItemId,
                                        file,
                                        tag: selectedTag !== "none" ? selectedTag : "final_print",
                                      });
                                    }}
                                    disabled={!selectedItem || assignCustomerArtworkMutation.isPending}
                                    className="bg-emerald-600/20 border border-emerald-400/50 px-3 py-1 rounded text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50 transition-all"
                                  >
                                    Use as Production Artwork
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPromotionSourceFile(file);
                                      setPromotionTag(selectedTag !== "none" ? selectedTag : "final_print");
                                    }}
                                    className="bg-violet-600/20 border border-violet-400/50 px-3 py-1 rounded text-violet-100 hover:bg-violet-600/30 transition-all"
                                  >
                                    Create Modified Copy
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Proof Files */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Proof Files
            </h3>
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">Filename</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">Uploaded / Generated By</th>
                    <th className="px-4 py-3 font-semibold">Tag</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {visibleProofFiles.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        {selectedLineItemId ? "No proof files generated" : "Select a line item to view proof files"}
                      </td>
                    </tr>
                  ) : visibleProofFiles.map((file) => (
                    <tr key={`proof-${file.id}`} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleOpenViewer(file.id)}>
                      <td className="px-4 py-3">
                        <FileThumbnail
                          filename={file.originalFilename || file.fileName}
                          mimeType={file.mimeType || undefined}
                          thumbnailUrl={file.thumbUrl || undefined}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-200">{file.displayName}</td>
                      <td className="px-4 py-3 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</td>
                      <td className="px-4 py-3">{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "—"}</td>
                      <td className="px-4 py-3">{file.uploadedByLabel}</td>
                      <td className="px-4 py-3">
                        <span className="bg-violet-900/40 text-violet-200 border border-violet-700/40 px-2 py-0.5 rounded text-[9px] font-bold uppercase">
                          {file.tagLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(file.downloadUrl, "_blank");
                          }}
                          className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-violet-900/30 hover:border-violet-600 transition-all"
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 4: Final Production Files */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> {selectedItem?.hasCompletedSession ? "Final Production Files" : "Production Art Candidate"}
            </h3>

            {selectedItem?.artworkProductionBreakdown?.relationshipInconsistency ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <div>
                  <div className="font-semibold">Artwork relationship inconsistency detected</div>
                  <div className="mt-1 text-amber-100/80">{selectedItem.artworkProductionBreakdown.relationshipInconsistency}</div>
                </div>
                {canRepairArtworkRelationships ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-amber-400/50 bg-transparent text-amber-100 hover:bg-amber-500/20"
                    disabled={repairArtworkRelationshipsMutation.isPending}
                    onClick={() => repairArtworkRelationshipsMutation.mutate({ orderId: selectedItem.orderId, lineItemId: selectedItem.lineItemId })}
                  >
                    {repairArtworkRelationshipsMutation.isPending ? "Repairing…" : "Repair automatically"}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {visibleFinalFiles.length === 0 && selectedItem?.artworkProductionBreakdown?.designs?.length ? (
              <div className="mb-4">
                <ArtworkProductionBreakdownList item={selectedItem} showHeader />
              </div>
            ) : visibleFinalFiles.length > 0 ? (
              <div className="mb-4 rounded-lg border border-[#2d3748] bg-[#111921] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Artwork Production Breakdown</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Assigned {finalArtworkAllocation.allocatedTotal} of {finalArtworkAllocation.requiredQuantity ?? selectedItem?.quantity ?? "unknown"} ordered pieces across {finalArtworkAllocation.groups.length} design{finalArtworkAllocation.groups.length === 1 ? "" : "s"}.
                    </p>
                  </div>
                  <span className={cn(
                    "rounded border px-2 py-1 text-[11px] font-semibold",
                    finalArtworkAllocation.valid ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-100",
                  )}>
                    {finalArtworkAllocation.valid ? "Allocation ready" : "Allocation needs input"}
                  </span>
                </div>
                {finalArtworkAllocation.issue ? (
                  <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {finalArtworkAllocation.issue}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {finalArtworkBreakdownRows.map(({ file, group }) => (
                    <div key={`breakdown-${file.id}`} className="rounded border border-[#2d3748] bg-[#0f172a] px-3 py-2 text-xs">
                      <div className="truncate font-semibold text-slate-100">{file.displayName}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <label className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                          <span>Qty</span>
                          <Input
                            key={`${file.id}:${file.productionQuantity ?? "unresolved"}`}
                            aria-label={`Production quantity for ${file.displayName}`}
                            defaultValue={group?.quantity || file.productionQuantity || ""}
                            inputMode="numeric"
                            disabled={updateFinalArtworkAllocationMutation.isPending}
                            className="h-7 w-20 border-[#2d3748] bg-[#111921] px-2 text-xs"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                            onBlur={(event) => {
                              const raw = event.currentTarget.value.trim();
                              const nextQuantity = raw ? Number(raw) : null;
                              if ((file.productionQuantity ?? null) === nextQuantity) return;
                              if (!selectedItem?.lineItemId) return;
                              updateFinalArtworkAllocationMutation.mutate({
                                lineItemId: selectedItem.lineItemId,
                                fileId: file.id,
                                productionQuantity: nextQuantity,
                              });
                            }}
                          />
                        </label>
                        <PrepressArtworkSideBadge side={file.sideLabel} />
                        <span>{file.tagLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Existing Final Files */}
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e] mb-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">File Info</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {visibleFinalFiles.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        {selectedLineItemId
                          ? (selectedItem?.hasCompletedSession ? "No final production files available" : "No production-art candidate uploaded yet")
                          : "Select a line item to upload files"}
                      </td>
                    </tr>
                  ) : (
                    visibleFinalFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleOpenViewer(file.id)}>
                        <td className="px-4 py-3">
                          <FileThumbnail
                            fileId={file.id}
                            filename={file.originalFilename || file.fileName}
                            mimeType={file.mimeType || undefined}
                            thumbnailUrl={file.thumbUrl || undefined}
                            thumbnailAvailabilityStatus={file.thumbnailAvailabilityStatus}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <p className="font-bold text-slate-200">{file.displayName}</p>
                            <div className="flex items-center gap-3">
                              <span className="bg-[#1773cf]/30 text-[#1773cf] border border-[#1773cf]/40 px-2 py-0.5 rounded font-bold uppercase text-[9px]">
                                {file.tagLabel}
                              </span>
                              <span className="text-slate-500 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</span>
                              <span className="text-slate-400 italic">
                                Uploaded by {file.uploadedByLabel} ({file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "unknown"})
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button 
                            onClick={(event) => {
                              event.stopPropagation();
                              downloadFinalFileMutation.mutate({
                                url: file.downloadUrl,
                                filename: file.displayName || file.originalFilename || "production-file",
                              });
                            }}
                            disabled={downloadFinalFileMutation.isPending}
                            aria-label={`Download ${file.displayName}`}
                            className="text-slate-400 hover:text-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          {canRemoveProductionFiles && (
                            <button
                              onClick={(event) => { event.stopPropagation(); setFilePendingRemoval(file); setRemovalReason(""); }}
                              disabled={removeFinalFileMutation.isPending}
                              aria-label={`Remove production file ${file.displayName}`}
                              title="Remove from Final Production Files"
                              className="text-rose-300 hover:text-rose-100 p-1 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Drag & Drop Upload Zone */}
            <div className="border-2 border-dashed border-[#2d3748] rounded-xl p-8 bg-[#1a232e]/20 flex flex-col items-center justify-center text-center hover:border-[#1773cf]/50 hover:bg-[#1773cf]/5 transition-all group">
              <div className="w-12 h-12 bg-[#1a232e] border border-[#2d3748] rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-[#1773cf]" />
              </div>
              <p className="text-sm font-semibold mb-1">Upload replacement production art</p>
              <p className="text-xs text-slate-500 mb-4">PDF, TIF, JPG, or EPS up to 2GB</p>
              
              <div className="mb-4">
                <p className="text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">File Type</p>
                <RadioGroup
                  value={selectedTag}
                  onValueChange={(value) => {
                    hasSelectedTagManuallyRef.current = true;
                    setSelectedTag(value);
                  }}
                  className="flex items-center gap-6"
                >
                  {prepressFileLabelMode === "optional" ? (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="none" id="tag-none" className="border-[#2d3748] text-[#1773cf]" />
                      <Label htmlFor="tag-none" className="text-sm font-medium text-slate-300 cursor-pointer">No label</Label>
                    </div>
                  ) : null}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="final_print" id="tag-print" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-print" className="text-sm font-medium text-slate-300 cursor-pointer">Print</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="proof_only" id="tag-proof" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-proof" className="text-sm font-medium text-slate-300 cursor-pointer">Proof</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="cut_file" id="tag-cut" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-cut" className="text-sm font-medium text-slate-300 cursor-pointer">Cut File</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div className="flex items-center gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={!selectedLineItemId}
                />
                <Button 
                  onClick={() => {
                    setUploadRole("final");
                    fileInputRef.current?.click();
                  }}
                  disabled={!selectedLineItemId}
                  className="bg-[#1773cf] text-white text-sm font-bold px-6 py-2 rounded-lg hover:bg-[#1773cf]/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Choose File
                </Button>
              </div>

              {/* Recently Uploaded / In Progress */}
              {uploadingFiles.length > 0 && (
                <div className="w-full mt-8 border-t border-[#2d3748]/50 pt-6">
                  <p className="text-[10px] uppercase font-bold text-slate-500 mb-4 text-left">
                    Recently Uploaded / In Progress
                  </p>
                  <div className="flex gap-4">
                    {uploadingFiles.map((upload) => (
                      <div key={upload.id} className="w-24 flex flex-col gap-2">
                        <div className="w-24 h-24 rounded-lg border border-[#1773cf]/50 bg-[#1773cf]/5 flex items-center justify-center relative overflow-hidden">
                          <Upload className="w-6 h-6 text-[#1773cf] animate-pulse" />
                        </div>
                        <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                          <div 
                            className="bg-[#1773cf] h-full transition-all"
                            style={{ width: `${upload.progress}%` }}
                          ></div>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{upload.filename}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section 4: Sheet Plan + Materials Needed */}
          <section>
            {selectedSheetPlanDisplay ? (
              <div className="bg-[#1a232e]/70 p-5 border border-[#2d3748]/80 rounded-lg shadow-sm mb-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Sheet Plan</p>
                    <p className="text-sm font-semibold text-slate-200 mt-1">{selectedSheetPlanDisplay.primary}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-cyan-500 text-cyan-300 bg-cyan-900/20">
                    Production Layout
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded border border-slate-700 bg-[#111921] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Sheet Size</p>
                    <p className="text-slate-200 font-semibold mt-1">{selectedSheetPlanDisplay.sheetSize}</p>
                  </div>
                  <div className="rounded border border-slate-700 bg-[#111921] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Yield</p>
                    <p className="text-slate-200 font-semibold mt-1">{selectedSheetPlanDisplay.secondary}</p>
                  </div>
                  <div className="rounded border border-slate-700 bg-[#111921] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Passes</p>
                    <p className="text-slate-200 font-semibold mt-1">{selectedSheetPlanDisplay.impressions}</p>
                  </div>
                </div>
                {selectedSheetPlanDisplay.layoutDetails.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                    {selectedSheetPlanDisplay.layoutDetails.map((detail) => (
                      <li key={detail} className="rounded border border-slate-700 bg-slate-900/30 px-2 py-1">
                        {detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-[11px] text-slate-500 mt-3">
                  Production sheet counts use the saved PBV2 layout yield. Inventory usage below remains material consumption and stock availability.
                </p>
              </div>
            ) : showSheetPlanFallback ? (
              <div className="bg-[#1a232e]/70 p-5 border border-[#2d3748]/80 rounded-lg shadow-sm mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Sheet Plan</p>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500 text-amber-300 bg-amber-900/20">
                    Layout Unavailable
                  </span>
                </div>
                <p className="text-sm text-slate-300 mt-2">Sheet layout unavailable.</p>
                <p className="text-xs text-slate-500 mt-1">{selectedSheetPlanUnavailableMessage}</p>
              </div>
            ) : null}
            <div className="bg-[#1a232e]/70 p-5 border border-[#2d3748]/80 rounded-lg shadow-sm">
              <div className="flex items-center justify-between mb-2 gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Materials Needed</p>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 bg-slate-700/40">
                    Effective (including overrides)
                  </span>
                  {materialsAvailabilityLoading ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 bg-slate-700/40">
                      Checking Stock...
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                        materialsAllAvailable
                          ? "border-emerald-500 text-emerald-300 bg-emerald-900/20"
                          : "border-amber-500 text-amber-300 bg-amber-900/20"
                      )}
                    >
                      {materialsAllAvailable ? "Stock Available" : "Stock Shortage"}
                    </span>
                  )}
                  {pricingReviewRequired ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500 text-amber-300 bg-amber-900/20">
                      Pricing Review Required
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {materialsEffectiveLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!overrideAllowed || !selectedItem}
                    onClick={() => openMaterialOverrideModal({ mode: "add" })}
                  >
                    Add Material
                  </Button>
                </div>
              </div>

              {effectiveMaterials.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {effectiveMaterials.map((material, index) => (
                    <li key={`${material.materialId}-${material.uom}-${index}`} className="flex items-center justify-between gap-3 border border-slate-700 rounded p-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-200 flex items-center gap-2">
                          {material.materialName || `Material ${material.materialId}`}
                          {material.isOverridden ? (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-cyan-500 text-cyan-300 bg-cyan-900/20">
                              Overridden
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-slate-500">ID: {material.materialId}</span>
                        {(() => {
                          const availability = materialsAvailability.find(
                            (a) => a.materialId === material.materialId && a.uom === material.uom
                          );
                          if (!availability) return null;
                          return (
                            <span
                              className={cn(
                                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border w-fit",
                                availability.isAvailable
                                  ? "border-emerald-600 text-emerald-300 bg-emerald-950/40"
                                  : "border-amber-600 text-amber-300 bg-amber-950/40"
                              )}
                            >
                              {availability.isAvailable
                                ? `In Stock (${availability.availableQty} ${availability.uom})`
                                : `Short ${availability.shortageQty} ${availability.uom}`}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-mono min-w-[90px] text-right">
                          {material.qty} {material.uom}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "replace", materialId: material.materialId, uom: material.uom })}
                        >
                          Swap
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "adjust_qty", materialId: material.materialId, uom: material.uom, qty: material.qty })}
                        >
                          Adjust Qty
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "remove", materialId: material.materialId })}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-slate-400">No materials computed</p>
                  <p className="text-xs text-slate-500">Add inventory materials to PBV2 choices or set size/options</p>
                </div>
      )}

      <Dialog open={!!filePendingRemoval} onOpenChange={(open) => { if (!open && !removeFinalFileMutation.isPending) setFilePendingRemoval(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove production file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {filePendingRemoval?.displayName || "This file"} will no longer be available in Final Production Files. Original customer artwork, storage objects, and audit history will remain.
          </p>
          <p className="text-sm text-muted-foreground">Copies already downloaded or transferred by Local Bridge cannot be removed from shop computers.</p>
          <Textarea value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} placeholder="Reason (required after production completion)" disabled={removeFinalFileMutation.isPending} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFilePendingRemoval(null)} disabled={removeFinalFileMutation.isPending}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={!filePendingRemoval || removeFinalFileMutation.isPending} onClick={() => filePendingRemoval && removeFinalFileMutation.mutate({ fileId: filePendingRemoval.id, reason: removalReason })}>
              {removeFinalFileMutation.isPending ? "Removing…" : "Remove production file"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

              {plannedMaterials.length > 0 ? (
                <details className="mt-3">
                  <summary className="text-xs text-slate-400 cursor-pointer">View planned baseline materials ({plannedMaterials.length})</summary>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {plannedMaterials.map((material, index) => (
                      <li key={`planned-${material.materialId}-${material.basis}-${index}`} className="flex items-center justify-between gap-2 text-slate-300">
                        <span>{material.materialName || `Material ${material.materialId}`}</span>
                        <span className="font-mono">{material.qty} {material.uom}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {!overrideAllowed ? (
                <p className="text-xs text-amber-300 mt-2">
                  Overrides are disabled by policy ({overrideMode}). {overrideBlockedReason || "Status is beyond allowed stage."}
                </p>
              ) : null}

              {plannedMaterialsMessage ? (
                <p className="text-xs text-amber-300 mt-2">{plannedMaterialsMessage}</p>
              ) : null}

              {effectiveFingerprint ? (
                <p className="text-[10px] text-slate-500 mt-2">Fingerprint: {effectiveFingerprint.slice(0, 12)}…</p>
              ) : null}
            </div>
          </section>

          {/* Section 5: Prepress Notes + QC Flagging */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Prepress Notes + QC Flagging
            </h3>
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Notes */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Production Notes</label>
                  <Textarea
                    value={prepressNotes}
                    onChange={(e) => setPrepressNotes(e.target.value)}
                    className="w-full bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf] min-h-[120px] resize-none"
                    placeholder="Add prepress notes, color corrections, adjustments..."
                  />
                </div>
                <Button 
                  onClick={handleSaveNotes}
                  disabled={!selectedItem?.sessionId || saveNoteMutation.isPending}
                  className="bg-[#1a232e] border border-[#2d3748] text-slate-300 hover:bg-[#2d3748] w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveNoteMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    "Save Notes"
                  )}
                </Button>
              </div>

              {/* Right: QC Flagging */}
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-[#1a232e] border border-[#2d3748] rounded-lg">
                  <Checkbox
                    id="qc-flag"
                    checked={flagForQc}
                    onCheckedChange={(checked) => setFlagForQc(checked as boolean)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label htmlFor="qc-flag" className="text-sm font-semibold text-white cursor-pointer block">
                      Flag for Quality Control Review
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      Mark this job for additional QC inspection before final approval
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Issue Type (Optional)</label>
                  <Select value={issueType} onValueChange={setIssueType} disabled={!flagForQc}>
                    <SelectTrigger className="bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf]">
                      <SelectValue placeholder="Select issue type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="color">Color Mismatch</SelectItem>
                      <SelectItem value="resolution">Resolution Issue</SelectItem>
                      <SelectItem value="artwork">Artwork Problem</SelectItem>
                      <SelectItem value="specs">Spec Clarification Needed</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-600 mt-2">
                    Flagged jobs will appear in the QC queue for manager review
                  </p>
                </div>

                <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Production Alerts</div>
                      <p className="mt-1 text-xs text-slate-400">
                        Color, machine, registration, and finishing warnings that follow this item into production.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleOpenProductionAlert}
                      disabled={!selectedItem}
                      className="bg-red-600 text-white hover:bg-red-700"
                    >
                      Add Production Alert
                    </Button>
                  </div>
                  <div className="mt-3">
                    <ProductionAlertsPanel
                      alerts={productionAlertsQuery.data}
                      showAcknowledge={false}
                      compact
                      empty={
                        productionAlertsQuery.isLoading ? (
                          <div className="text-xs text-slate-500">Loading alerts...</div>
                        ) : (
                          <div className="text-xs text-slate-500">No production alerts for this item.</div>
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

          </>
              )}
      </main>
      </div>

      {!combinedRunOpen ? (
        <div className="shrink-0 border-t border-[#2d3748] bg-[#1a232e] px-4 py-3" data-testid="prepress-bottom-action-bar">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-slate-300">
              <span className="font-bold text-white">
                {selectedQueueItems.length > 0
                  ? `${selectedQueueItems.length} selected`
                  : selectedItem
                    ? `1 job open${selectedItem.lineNumber ? ` - Line ${selectedItem.lineNumber}` : ""}`
                    : "No job selected"}
              </span>
              {hasProofReleaseBlock ? <span className="ml-2 text-amber-300">Proof approval blocks release</span> : null}
              {artworkSideReadiness.warning && selectedItem ? <span className="ml-2 text-amber-300">{artworkSideReadiness.warning}</span> : null}
              {selectedQueueItems.length > 1 ? <span className="ml-2 text-slate-500">Use the queue footer to create a combined run.</span> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                onClick={handleStartPrepress}
                disabled={selectedQueueItems.length > 1 || !canStartPrepress || startSessionMutation.isPending || completeAndReleaseMutation.isPending}
                variant="outline"
                title={selectedQueueItems.length > 1 ? "Start Prepress applies to one open job at a time." : undefined}
                className="bg-transparent border-[#2d3748] text-slate-300 hover:bg-[#2d3748] hover:text-white disabled:opacity-50"
              >
                {startSessionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Start Prepress
              </Button>
              <Button
                type="button"
                onClick={() => selectedQueueItems.length > 0 ? handleBulkPrintReady(false) : handleComplete()}
                disabled={
                  selectedQueueItems.length > 0
                    ? bulkPrintReadyMutation.isPending
                    : !canComplete || completeSessionMutation.isPending || completeAndReleaseMutation.isPending
                }
                variant="outline"
                className="border-[#1773cf]/60 text-[#8ec5ff] hover:bg-[#1773cf]/10 disabled:opacity-50"
              >
                {(selectedQueueItems.length > 0 ? bulkPrintReadyMutation.isPending : completeSessionMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Mark Prepress Complete
              </Button>
              <Button
                type="button"
                onClick={() => selectedQueueItems.length > 0 ? handleBulkPrintReady(true) : handleCompleteAndRelease()}
                disabled={
                  selectedQueueItems.length > 0
                    ? bulkPrintReadyMutation.isPending
                    : !canCompleteAndRelease || completeAndReleaseMutation.isPending || completeSessionMutation.isPending || sendToPrintMutation.isPending
                }
                className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500"
              >
                {(selectedQueueItems.length > 0 ? bulkPrintReadyMutation.isPending : completeAndReleaseMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Complete and Release
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={combinedRunDetailOpen} onOpenChange={setCombinedRunDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>Combined Production Run</DialogTitle>
          </DialogHeader>
          {selectedCombinedRun ? (
            <div className="space-y-3">
              {productionRunNeedsPrepressAttention(selectedCombinedRun) ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                  This run still needs Prepress attention. Upload or replace the shared nested production file and review any planning warnings before release.
                </div>
              ) : null}
              <ProductionRunPanel
                run={selectedCombinedRun}
                focusNestedFileUpload={focusNestedFileUpload}
                onNestedFileUploadFocused={() => setFocusNestedFileUpload(false)}
                onCanceled={(result) => {
                  setCombinedRunDetailOpen(false);
                  setSelectedCombinedRunId(null);
                  setFocusNestedFileUpload(false);
                  if ((Number(result.restoredMemberCount) || 0) + (Number(result.alreadyRestoredMemberCount) || 0) > 0) {
                    setWorkspaceTab("queue");
                  }
                  void Promise.all([
                    refreshPrepressQueue(),
                    refreshPrepressNavigationCount(),
                    queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] }),
                  ]);
                }}
                onViewRestoredJobs={() => {
                  setCombinedRunDetailOpen(false);
                  setSelectedCombinedRunId(null);
                  setFocusNestedFileUpload(false);
                  setWorkspaceTab("queue");
                  void Promise.all([
                    refreshPrepressQueue(),
                    refreshPrepressNavigationCount(),
                    queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
                    queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] }),
                    queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] }),
                  ]);
                }}
              />
            </div>
          ) : productionRunsQuery.isLoading || productionRunsQuery.isFetching ? (
            <div className="flex items-center gap-2 rounded-lg border border-[#2d3748] px-3 py-6 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading combined run...
            </div>
          ) : (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-100">
              This combined run is no longer available in the current Prepress view. Refresh runs or adjust history/status filters.
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!promotionSourceFile} onOpenChange={(open) => {
        if (!open && !promoteCustomerArtworkMutation.isPending) {
          setPromotionSourceFile(null);
          setPromotionTag("final_print");
        }
      }}>
        <DialogContent className="max-w-lg bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>Create Production Artwork Copy</DialogTitle>
          </DialogHeader>
          {promotionSourceFile && selectedItem ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-[#2d3748] bg-[#0f172a] p-3 text-xs text-slate-300">
                <div><span className="text-slate-500">Original:</span> {promotionSourceFile.displayName}</div>
                <div><span className="text-slate-500">Job:</span> {selectedItem.jobNumber}</div>
                <div><span className="text-slate-500">Artwork side:</span> <PrepressArtworkSideBadge side={promotionSourceFile.sideLabel} /></div>
                <div><span className="text-slate-500">Target line:</span> {selectedItem.lineNumber ? `Line ${selectedItem.lineNumber}` : selectedItem.productName}</div>
              </div>

              <div>
                <Label className="mb-2 block text-xs text-slate-400">Production tag</Label>
                <RadioGroup value={promotionTag} onValueChange={setPromotionTag} className="grid gap-2 sm:grid-cols-3">
                  <label className="flex items-center gap-2 rounded border border-[#2d3748] px-3 py-2">
                    <RadioGroupItem value="final_print" id="promote-tag-print" />
                    <span>Print</span>
                  </label>
                  <label className="flex items-center gap-2 rounded border border-[#2d3748] px-3 py-2">
                    <RadioGroupItem value="cut_file" id="promote-tag-cut" />
                    <span>Cut File</span>
                  </label>
                  <label className="flex items-center gap-2 rounded border border-[#2d3748] px-3 py-2">
                    <RadioGroupItem value="proof_only" id="promote-tag-proof" />
                    <span>Proof</span>
                  </label>
                </RadioGroup>
              </div>

              <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3 text-xs">
                <div className="font-semibold text-violet-100">Generated production filename</div>
                <div className="mt-1 break-all font-mono text-violet-50">{promotionFilenamePreview}</div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPromotionSourceFile(null)} disabled={promoteCustomerArtworkMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!promotionTag || promotionTag === "none" || promoteCustomerArtworkMutation.isPending}
                  onClick={() => promoteCustomerArtworkMutation.mutate({ lineItemId: selectedItem.lineItemId, file: promotionSourceFile, tag: promotionTag })}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  {promoteCustomerArtworkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create Production Artwork Copy
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={productionAlertOpen} onOpenChange={setProductionAlertOpen}>
        <DialogContent className="max-w-lg bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>Add Production Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Use Preset</Label>
              <Select value={productionAlertPresetId} onValueChange={handleProductionAlertPresetChange}>
                <SelectTrigger className="bg-[#0f172a] border-[#2d3748]">
                  <SelectValue placeholder="Manual alert" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual / Freeform</SelectItem>
                  {(productionAlertPresetsQuery.data ?? []).map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {productionAlertPresetsQuery.isLoading ? (
                <div className="mt-1 text-[11px] text-slate-500">Loading presets...</div>
              ) : null}
            </div>

            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Title</Label>
              <Input
                value={productionAlertTitle}
                onChange={(event) => setProductionAlertTitle(event.target.value)}
                placeholder="Rick Red"
                className="bg-[#0f172a] border-[#2d3748]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400 mb-1 block">Alert Type</Label>
                <Select value={productionAlertType} onValueChange={(value) => setProductionAlertType(value as ProductionAlertType)}>
                  <SelectTrigger className="bg-[#0f172a] border-[#2d3748]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general_warning">General Warning</SelectItem>
                    <SelectItem value="color_match">Color Match</SelectItem>
                    <SelectItem value="pms_match">PMS Match</SelectItem>
                    <SelectItem value="customer_specific">Customer Specific</SelectItem>
                    <SelectItem value="machine_setting">Machine Setting</SelectItem>
                    <SelectItem value="finishing_instruction">Finishing Instruction</SelectItem>
                    <SelectItem value="registration_instruction">Registration Instruction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1 block">Severity</Label>
                <Select value={productionAlertSeverity} onValueChange={(value) => setProductionAlertSeverity(value as ProductionAlertSeverity)}>
                  <SelectTrigger className="bg-[#0f172a] border-[#2d3748]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-400 mb-2 block">Visible To</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["roll", "Roll Production"],
                  ["flatbed", "Flatbed Production"],
                  ["fulfillment", "Fulfillment"],
                  ["all", "All Stations"],
                ] as Array<[ProductionAlertStation, string]>).map(([station, label]) => (
                  <label key={station} className="flex items-center gap-2 rounded-md border border-[#2d3748] bg-[#0f172a] px-3 py-2 text-sm">
                    <Checkbox
                      checked={productionAlertStations.includes(station)}
                      onCheckedChange={(checked) => handleToggleProductionAlertStation(station, checked === true)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Notes</Label>
              <Textarea
                value={productionAlertMessage}
                onChange={(event) => setProductionAlertMessage(event.target.value)}
                placeholder="Use Rick Red density preset in Onyx. Adjust reds before printing."
                className="min-h-[100px] bg-[#0f172a] border-[#2d3748]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setProductionAlertOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCreateProductionAlert}
                disabled={!productionAlertTitle.trim() || createProductionAlert.isPending}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {createProductionAlert.isPending ? "Saving..." : "Save Alert"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={materialOverrideOpen} onOpenChange={setMaterialOverrideOpen}>
        <DialogContent className="max-w-xl bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {materialOverrideMode === "replace" && "Swap Material"}
              {materialOverrideMode === "add" && "Add Material"}
              {materialOverrideMode === "remove" && "Remove Material"}
              {materialOverrideMode === "adjust_qty" && "Adjust Material Quantity"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {materialOverrideMode === "replace" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">From Material ID</Label>
                  <Input value={overrideFromMaterialId} onChange={(e) => setOverrideFromMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">To Material ID</Label>
                  <Input value={overrideToMaterialId} onChange={(e) => setOverrideToMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <p className="text-xs text-amber-300">Replace operations auto-set potential price impact and trigger Pricing Review Required.</p>
              </>
            ) : null}

            {materialOverrideMode === "add" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                  <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">Qty</Label>
                    <Input type="number" step="0.01" min="0" value={overrideQty} onChange={(e) => setOverrideQty(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">UOM</Label>
                    <Select value={overrideUom} onValueChange={(value) => setOverrideUom(value as "sqft" | "ft" | "each")}>
                      <SelectTrigger className="bg-[#0f172a] border-[#2d3748]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sqft">sqft</SelectItem>
                        <SelectItem value="ft">ft</SelectItem>
                        <SelectItem value="each">each</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : null}

            {materialOverrideMode === "remove" ? (
              <div>
                <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
              </div>
            ) : null}

            {materialOverrideMode === "adjust_qty" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                  <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">Qty</Label>
                    <Input type="number" step="0.01" min="0" value={overrideQty} onChange={(e) => setOverrideQty(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">UOM</Label>
                    <Select value={overrideUom} onValueChange={(value) => setOverrideUom(value as "sqft" | "ft" | "each")}>
                      <SelectTrigger className="bg-[#0f172a] border-[#2d3748]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sqft">sqft</SelectItem>
                        <SelectItem value="ft">ft</SelectItem>
                        <SelectItem value="each">each</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : null}

            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Reason Note *</Label>
              <Textarea
                value={overrideReasonNote}
                onChange={(e) => setOverrideReasonNote(e.target.value)}
                placeholder="Explain why this material override is needed"
                className="bg-[#0f172a] border-[#2d3748] min-h-[90px]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMaterialOverrideOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitMaterialOverride} disabled={applyMaterialOverrideMutation.isPending || !overrideAllowed}>
                {applyMaterialOverrideMutation.isPending ? "Saving..." : "Apply Override"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[520px] bg-[#111921] border-[#2d3748] text-slate-100">
          <SheetHeader>
            <SheetTitle className="text-slate-100">History</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3 max-h-[85vh] overflow-y-auto pr-2">
            {historyLoading && (
              <div className="text-sm text-slate-400">Loading history...</div>
            )}
            {!historyLoading && (historyData?.length || 0) === 0 && (
              <div className="text-sm text-slate-500">No history found for this line item.</div>
            )}
            {!historyLoading && (historyData || []).map((entry, idx) => (
              <div key={`${entry.at}-${entry.type}-${idx}`} className="border border-[#2d3748] rounded-lg p-3 bg-[#1a232e]">
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">{entry.source.replaceAll("_", " ")}</div>
                <div className="text-xs text-slate-300 mt-1">{entry.type}</div>
                <div className="text-sm text-slate-100 mt-1">{entry.description}</div>
                <div className="text-[11px] text-slate-500 mt-2">{new Date(entry.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={specSheetOpen} onOpenChange={setSpecSheetOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>Spec Sheet</DialogTitle>
          </DialogHeader>
          {specSheetLoading ? (
            <div className="text-sm text-slate-400">Loading spec sheet...</div>
          ) : !specSheetData ? (
            <div className="text-sm text-slate-500">No spec data available.</div>
          ) : (
            <div className="space-y-6 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500">Job #:</span> {specSheetData.jobNumber || "—"}</div>
                <div><span className="text-slate-500">Order line:</span> {selectedItem?.lineNumber ? `Line ${selectedItem.lineNumber}` : "—"}</div>
                <div><span className="text-slate-500">Customer:</span> {specSheetData.customerName || "—"}</div>
                <div><span className="text-slate-500">Product:</span> {specSheetData.productName || "—"}</div>
                <div><span className="text-slate-500">Size:</span> {specSheetData.width && specSheetData.height ? `${specSheetData.width}" x ${specSheetData.height}"` : "—"}</div>
                <div><span className="text-slate-500">Qty:</span> {specSheetData.quantity || "—"}</div>
                <div><span className="text-slate-500">Sq Ft:</span> {specSheetData.sqFootage != null ? `${specSheetData.sqFootage.toFixed(1)} sq ft` : "—"}</div>
                <div><span className="text-slate-500">Media:</span> {specSheetData.media || "Not specified"}</div>
                <div><span className="text-slate-500">Production Destination:</span> {specSheetData.productionDestination || "—"}</div>
                <div><span className="text-slate-500">Print Sides:</span> {specSheetData.printSides || "Unknown"}</div>
                {specSheetData.printSides === "Double-sided" && (
                  <div><span className="text-slate-500">Same artwork both sides:</span> {specSheetData.useSameArtworkBothSides ? "Yes" : "No"}</div>
                )}
                <div><span className="text-slate-500">Line Item Notes:</span> {specSheetData.lineItemNotes || "No line item notes"}</div>
              </div>

              <div>
                <div className="text-slate-500 uppercase text-xs mb-2">Finishing</div>
                {(specSheetData.optionsRows || []).length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {(specSheetData.optionsRows || []).map((row, i) => (
                      <li key={`${row.optionLabel}-${row.selectedLabel}-${i}`} className="break-words">
                        {row.optionLabel}: {row.selectedLabel}
                      </li>
                    ))}
                  </ul>
                ) : (specSheetData.finishingBullets || []).length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {specSheetData.finishingBullets.map((bullet, i) => <li key={`${bullet}-${i}`} className="break-words">{bullet}</li>)}
                  </ul>
                ) : (
                  <div>No finishing options specified</div>
                )}
              </div>

              <div>
                <div className="text-slate-500 uppercase text-xs mb-2">Files</div>
                <div className="space-y-1">
                  {[...specSheetData.originals, ...specSheetData.finals].map((f) => (
                    <div key={f.id} className="text-slate-200">• {f.computedDisplayFilename || f.originalFilename}</div>
                  ))}
                  {(specSheetData.proofs || []).map((f) => (
                    <div key={`proof-${f.id}`} className="text-slate-200">• Proof: {f.computedDisplayFilename || f.displayFilename || f.originalFilename}</div>
                  ))}
                  {[...specSheetData.originals, ...specSheetData.finals, ...(specSheetData.proofs || [])].length === 0 && <div>—</div>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AttachmentViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        attachments={normalizedVisibleFiles}
        initialIndex={viewerIndex}
        showMetaPanel
        hideFilmstrip={false}
      />
    </div>
  );
}
function JobCard({
  item,
  isSelected,
  isChecked,
  selectionBlocker,
  nestedRunLabel,
  onCheckedChange,
  onClick,
  onPreviewClick,
}: {
  item: PrepressQueueItem;
  isSelected: boolean;
  isChecked: boolean;
  selectionBlocker?: { code?: string; message: string; resolvable: boolean } | null;
  nestedRunLabel?: string | null;
  onCheckedChange: (checked: boolean) => void;
  onClick: () => void;
  onPreviewClick: () => void;
}) {
  const config = getPrepressWorkflowDisplay(item);
  const ownerLabel = formatOwnerLabel(item);
  const selectionDisabled = Boolean(selectionBlocker && !selectionBlocker.resolvable);
  const needsProductionArtwork = selectionBlocker?.code === "resolvable_missing_production_artwork";

  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[Prepress Queue Thumbnail Selection]", {
      lineItemId: item.lineItemId,
      thumbFileId: item.thumbFileId ?? null,
      reason: item.thumbSelectionReason ?? "none",
      mimeType: item.thumbCandidateMimeType ?? null,
    });
  }, [item.lineItemId, item.thumbFileId, item.thumbSelectionReason, item.thumbCandidateMimeType]);

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-2 rounded-lg flex gap-3 transition-colors relative cursor-pointer",
        isSelected && "bg-[#1773cf]/10 border-l-4 border-[#1773cf] rounded-l-none rounded-r-lg",
        !isSelected && "bg-[#1a232e] border border-[#2d3748] hover:border-[#1773cf]/50"
      )}
    >
      <div
        className="flex shrink-0 items-start pt-1"
        onClick={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <Checkbox
          checked={isChecked}
          disabled={selectionDisabled}
          onCheckedChange={(checked) => onCheckedChange(checked === true)}
          aria-label={`Select ${item.jobNumber} ${item.productName}`}
          title={selectionBlocker?.message || "Select for nesting"}
        />
      </div>
      <div
        className="relative w-16 h-16 flex-shrink-0 rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group cursor-zoom-in"
        onClick={(event) => {
          event.stopPropagation();
          onPreviewClick();
        }}
        role="button"
        aria-label={`Open preview for ${item.jobNumber}`}
      >
        <FileThumbnail
          fileId={item.thumbFileId || undefined}
          filename={item.productName || "preview"}
          mimeType={item.thumbCandidateMimeType || undefined}
          thumbnailUrl={item.thumbnailUrl || undefined}
          compact
        />
        {item.fileCounts && (item.fileCounts.originals > 0 || item.fileCounts.finals > 0) && (
          <div className="absolute bottom-0 right-0 bg-[#1773cf] text-white text-[9px] font-black px-1 rounded-tl-sm shadow-lg z-20">
            +{item.fileCounts.originals + item.fileCounts.finals}
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <ZoomIn className="w-5 h-5 text-white" />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex justify-between items-start">
          <span className="text-sm font-bold text-white">
            {item.jobNumber}
          </span>
          <div className="flex flex-col items-end gap-1">
            <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded border tracking-wider", config.bgClass, config.textClass, config.borderClass)}>
              {config.label}
            </span>
            {nestedRunLabel ? (
              <span className="rounded border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-violet-200">
                Nested {nestedRunLabel}
              </span>
            ) : null}
            {config.note && <span className="text-[8px] font-semibold text-emerald-300">{config.note}</span>}
          </div>
        </div>
        <p className="text-xs font-semibold truncate text-slate-200">{item.customerName || "Customer/contact not resolved"}</p>
        <p className="text-[10px] truncate text-slate-400">
          {item.lineNumber ? `Line ${item.lineNumber} · ` : ""}{item.productName}
        </p>
        <div className="flex items-center justify-between mt-1 text-[9px]">
          {ownerLabel ? (
            <span className="text-slate-500">Owner: {ownerLabel}</span>
          ) : (
            <span className="text-slate-500">Owner: none</span>
          )}
          {item.rush && <span className="text-[#e53e3e] font-bold">RUSH</span>}
          {item.dueDate && !item.rush && <span className="text-slate-400">{new Date(item.dueDate).toLocaleDateString()}</span>}
        </div>
        {selectionBlocker ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] leading-snug">
            <span className={cn(
              "rounded border px-1.5 py-0.5 font-semibold",
              needsProductionArtwork
                ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                : "border-red-400/40 bg-red-500/10 text-red-100",
            )}>
              {needsProductionArtwork ? "Needs production artwork" : "Hard blocked"}
            </span>
            <span className={needsProductionArtwork ? "text-amber-200" : "text-red-100"}>
              {selectionBlocker.message}
            </span>
          </div>
        ) : (
          <div className="mt-1 text-[10px] font-medium text-emerald-300">Production artwork ready for nesting</div>
        )}
        {item.activeOwnerJobId ? (
          <div
            className="mt-2"
            onClick={(event) => event.stopPropagation()}
            onPointerDownCapture={(event) => event.stopPropagation()}
            onMouseDownCapture={(event) => event.stopPropagation()}
          >
            <PrintTicketActions
              jobId={item.activeOwnerJobId}
              jobQuantity={item.quantity}
              size="sm"
              variant="outline"
              className="flex flex-wrap"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
