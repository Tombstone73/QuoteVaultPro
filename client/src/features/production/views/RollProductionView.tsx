import { useMemo, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import {
  ProductionJobListItem,
  ProductionOrderArtworkSummary,
  ProductionOrderLineItemSummary,
  useAddProductionNote,
  useCompleteProductionJob,
  useProductionJob,
  useProductionJobs,
  useReopenProductionJob,
  useSubmitReprintRequest,
  useSetProductionMediaUsed,
  useStartProductionTimer,
  useStopProductionTimer,
  useUpdateProductionJobStatus,
  useSendLineItemToPrepress,
} from "@/hooks/useProduction";
import {
  CheckCircle2,
  FileText,
  Home,
  Pause,
  MessageSquarePlus,
  Play,
  ArrowLeft,
  Printer,
  RotateCcw,
  Square,
  Undo2,
  Download,
  Upload,
} from "lucide-react";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import ZoomPanImageViewer from "@/components/production/ZoomPanImageViewer";
import { PrintTicketActions } from "@/components/production/PrintTicketActions";
import { PrinterMachineAssignment, hasProductionPrinterAssignment } from "@/components/production/PrinterMachineAssignment";
import { ProductionAlertsPanel } from "@/components/production/ProductionAlertsPanel";
import { ProductionNotesSection } from "@/components/production/ProductionNotesSection";
import { RecentlyCompletedProductionJobs } from "@/components/production/RecentlyCompletedProductionJobs";
import { formatFileSize, getFileTypeLabel, buildDownloadUrl } from "@/lib/fileUtils";
import { sanitizeDisplayText } from "@/lib/sanitizeDisplayText";
import { filterProductionJobsForTab, type ProductionBoardTab } from "@/lib/productionBoard";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { getProductionOrderNumber } from "@/lib/productionDocumentNumbers";
import type { ProductionDocumentNumberDisplayMode } from "@shared/documentNumbering";

type ProductionStatus = ProductionBoardTab;

type DueUrgency = "overdue" | "today" | "soon" | "normal";

/**
 * DEV-only: Test if a URL is accessible
 */
async function testUrlAccessibility(url: string, label: string): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;
  
  try {
    const response = await fetch(url, { method: 'HEAD', credentials: 'include' });
    console.log(`[DEV:URL] ${label}: ${response.status} ${response.statusText} - ${url}`);
  } catch (error) {
    console.error(`[DEV:URL] ${label}: FETCH_ERROR - ${url}`, error);
  }
}

/**
 * DEV-only: Log artwork details comprehensively
 */
function logArtworkDetails(artwork: ProductionOrderArtworkSummary | null, context: string): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  console.group(`[DEV:Artwork] ${context}`);
  if (!artwork) {
    console.log('No artwork provided');
  } else {
    console.log('ID:', artwork.id);
    console.log('fileName:', artwork.fileName);
    console.log('side:', artwork.side);
    console.log('fileUrl:', artwork.fileUrl || '(empty)');
    console.log('thumbnailUrl:', artwork.thumbnailUrl || '(empty)');
    console.log('thumbKey:', artwork.thumbKey || '(empty)');
    console.log('previewKey:', artwork.previewKey || '(empty)');
    console.log('thumbStatus:', artwork.thumbStatus || '(empty)');
    
    // Test URLs if present
    if (artwork.fileUrl) testUrlAccessibility(artwork.fileUrl, 'fileUrl');
    if (artwork.thumbnailUrl) testUrlAccessibility(artwork.thumbnailUrl, 'thumbnailUrl');
  }
  console.groupEnd();
}

/**
 * Get the best available image source for artwork
 * Priority: thumbnailUrl > fileUrl (if image) > null
 * 
 * Note: thumbnailUrl is always an image. fileUrl might be a PDF or other non-image.
 * We check fileName extension to determine if fileUrl can be used as an image.
 */
function getBestArtworkImage(artwork: ProductionOrderArtworkSummary | null): string | null {
  if (!artwork) return null;

  const normalizeArtworkImageUrl = (value: string): string | null => resolveObjectsPublicUrl(value);
  
  // 1. Prefer thumbnailUrl (always an image if present).
  if (artwork.thumbnailUrl && artwork.thumbnailUrl.trim()) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV:getBestArtworkImage] Using thumbnailUrl: ${artwork.thumbnailUrl}`);
    }
    return normalizeArtworkImageUrl(artwork.thumbnailUrl);
  }
  
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV:getBestArtworkImage] No derivative preview available - fileName: ${artwork.fileName}, has thumbnailUrl: ${!!artwork.thumbnailUrl}`);
  }
  return null;
}

/**
 * Artwork image component with fallback handling
 * Used primarily for modal previews
 */
function ArtworkImage({
  artwork,
  alt,
  className,
  onClick,
}: {
  artwork: ProductionOrderArtworkSummary | null;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(() => getBestArtworkImage(artwork));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // DEV: Log artwork details on mount/change
    if (process.env.NODE_ENV === 'development') {
      logArtworkDetails(artwork, 'ArtworkImage');
    }
    setSrc(getBestArtworkImage(artwork));
    setHasError(false);
  }, [artwork]);

  const handleError = () => {
    setHasError(true);
    setSrc(null);
  };

  if (!src || hasError) {
    return (
      <div className={`flex items-center justify-center bg-titan-bg-muted ${className || ""}`}>
        <div className="text-center p-2">
          <FileText className="mx-auto h-8 w-8 text-titan-text-muted" />
          <div className="mt-1 text-[10px] text-titan-text-muted">No Preview</div>
          {import.meta.env.DEV && hasError && src ? (
            <div className="mt-1 text-[9px] text-amber-400">thumb failed</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={handleError}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}

/**
 * Production-specific thumbnail component
 * More forgiving than ArtworkImage - renders any valid image URL without aggressive error handling
 */
function ProductionThumbnail({
  artwork,
  alt,
  className,
  onClick,
}: {
  artwork: ProductionOrderArtworkSummary | null;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  // DEV: Log artwork details on mount
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && artwork) {
      logArtworkDetails(artwork, `ProductionThumbnail (${alt})`);
    }
  }, [artwork, alt]);

  const src = getBestArtworkImage(artwork);
  const [failed, setFailed] = useState(false);

  // Reset failed state when artwork changes
  useEffect(() => {
    setFailed(false);
  }, [artwork]);

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-titan-bg-muted ${className || ""}`}>
        <div className="text-center p-2">
          <FileText className="mx-auto h-8 w-8 text-titan-text-muted" />
          <div className="mt-1 text-[10px] text-titan-text-muted">No Preview</div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => {
        if (import.meta.env.DEV) {
          console.info(`[thumb] failed url=${src}`);
        }
        setFailed(true);
      }}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatQtyPieces(qty: number | null | undefined) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const label = n === 1 ? "piece" : "pieces";
  return `${n} ${label}`;
}

function formatInchesOrRaw(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (raw.includes("\"") || raw.toLowerCase().includes("in")) return raw;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return `${raw}\"`;
  return raw;
}

function formatDimsMock(width: string | null | undefined, height: string | null | undefined) {
  const w = formatInchesOrRaw(width);
  const h = formatInchesOrRaw(height);
  if (!w || !h) return "—";
  return `${w} x ${h}`;
}

function dueLabel(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dueMeta(dueDate: string | null | undefined):
  | {
      dateLabel: string;
      dayDelta: number;
      urgency: DueUrgency;
      displaySuffix: string;
    }
  | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  const deltaMs = startOfDay(d).getTime() - startOfDay(now).getTime();
  const dayDelta = Math.round(deltaMs / 86400000);

  let urgency: DueUrgency = "normal";
  if (dayDelta < 0) urgency = "overdue";
  else if (dayDelta === 0) urgency = "today";
  else if (dayDelta <= 2) urgency = "soon";

  const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const displaySuffix =
    urgency === "overdue"
      ? "(OVERDUE)"
      : urgency === "today"
        ? "(TODAY)"
        : `(${dayDelta}d)`;

  return { dateLabel, dayDelta, urgency, displaySuffix };
}

function dueClass(urgency: DueUrgency | null | undefined) {
  if (urgency === "overdue") return "text-red-300";
  if (urgency === "today") return "text-amber-200";
  if (urgency === "soon") return "text-amber-100";
  return "text-titan-text-primary";
}

function priorityRank(priority: string | null | undefined) {
  const p = (priority || "").toLowerCase();
  if (p === "rush") return 0;
  if (p === "normal") return 1;
  if (p === "low") return 2;
  return 3;
}

function statusRank(status: ProductionStatus) {
  if (status === "in_progress") return 0;
  if (status === "queued") return 1;
  return 2;
}

// sanitizeDisplayText is imported from @/lib/sanitizeDisplayText

function normalizeSidesValue(raw: unknown): { label: "Single" | "Double" | "—"; isDouble: boolean } {
  const s = sanitizeDisplayText(raw);
  if (s === "—") return { label: "—", isDouble: false };

  const lowered = s.toLowerCase();
  const isDouble =
    lowered === "double" ||
    lowered === "ds" ||
    lowered === "2" ||
    lowered.includes("double") ||
    lowered.includes("2-sided") ||
    lowered.includes("2 sided") ||
    lowered.includes("two-sided") ||
    lowered.includes("two sided");

  return { label: isDouble ? "Double" : "Single", isDouble };
}

function formatDims(width: string | null | undefined, height: string | null | undefined) {
  if (!width || !height) return "—";
  return `${width} x ${height}`;
}

function primaryLineItem(job: ProductionJobListItem): ProductionOrderLineItemSummary | null {
  return job.order.lineItems?.primary ?? null;
}

function artworkThumbs(job: ProductionJobListItem): ProductionOrderArtworkSummary[] {
  return job.order.artwork ?? [];
}

function normalizeSide(side: string | null | undefined): "front" | "back" | "na" {
  const s = String(side || "").toLowerCase();
  if (s === "front") return "front";
  if (s === "back") return "back";
  return "na";
}

function pickArtworkForPreview(artwork: ProductionOrderArtworkSummary[]) {
  const list = [...(artwork || [])];
  const byFront = list.filter((a) => normalizeSide(a.side) === "front");
  const byBack = list.filter((a) => normalizeSide(a.side) === "back");

  const pickBest = (items: ProductionOrderArtworkSummary[]) => {
    if (items.length === 0) return null;
    const primary = items.find((a) => a.isPrimary);
    return primary || items[0];
  };

  const front = pickBest(byFront) ?? pickBest(list);
  const back = pickBest(byBack);
  return { front, back };
}

/**
 * Normalize artwork based on sides logic for Production MVP
 * Deterministic rule (NO "same as front" logic):
 * - If 2+ artwork assets: front = first, back = second
 * - If 1 artwork asset: front = first, back = null (show "Back file not uploaded" placeholder)
 * - If 0 artwork assets: both null
 * - Single-sided: only front, no back slot
 */
function normalizeArtworkForSides(
  isDouble: boolean,
  artwork: ProductionOrderArtworkSummary[],
): {
  front: ProductionOrderArtworkSummary | null;
  back: ProductionOrderArtworkSummary | null;
  showBackSlot: boolean;
  backMissingReason: "not_uploaded" | null;
} {
  const list = [...(artwork || [])];

  // DEV logging for debugging artwork mapping
  if (process.env.NODE_ENV === "development" && list.length > 0) {
    console.log("[normalizeArtworkForSides]", {
      isDouble,
      artworkCount: list.length,
      frontFile: list[0]?.fileName ?? null,
      backFile: list[1]?.fileName ?? null,
    });
  }

  if (!isDouble) {
    // Single-sided: only front, no back slot
    return { 
      front: list[0] ?? null, 
      back: null, 
      showBackSlot: false, 
      backMissingReason: null 
    };
  }

  // Double-sided: deterministic mapping
  if (list.length === 0) {
    // No artwork at all
    return { 
      front: null, 
      back: null, 
      showBackSlot: true, 
      backMissingReason: "not_uploaded" 
    };
  } else if (list.length === 1) {
    // Only 1 asset: front gets it, back is missing
    return { 
      front: list[0], 
      back: null, 
      showBackSlot: true, 
      backMissingReason: "not_uploaded" 
    };
  } else {
    // 2+ assets: front = first, back = second
    return { 
      front: list[0], 
      back: list[1], 
      showBackSlot: true, 
      backMissingReason: null 
    };
  }
}

function deriveRuntimeFromEvents(
  events: Array<{ type: string; createdAt: string }> | undefined,
): { seconds: number | null; isRunning: boolean; runningSince: string | null } {
  if (!events || events.length === 0) return { seconds: null, isRunning: false, runningSince: null };

  const sorted = [...events]
    .map((e) => ({ ...e, ts: new Date(e.createdAt).getTime() }))
    .filter((e) => Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);

  let runningStart: number | null = null;
  let totalSeconds = 0;
  for (const e of sorted) {
    if (e.type === "timer_started") {
      runningStart = e.ts;
    }
    if (e.type === "timer_stopped") {
      if (runningStart != null) {
        const seg = Math.max(0, Math.floor((e.ts - runningStart) / 1000));
        totalSeconds += seg;
        runningStart = null;
      }
    }
  }

  const isRunning = runningStart != null;
  if (isRunning && runningStart != null) {
    const now = Date.now();
    totalSeconds += Math.max(0, Math.floor((now - runningStart) / 1000));
  }

  return {
    seconds: Number.isFinite(totalSeconds) ? totalSeconds : null,
    isRunning,
    runningSince: isRunning && runningStart != null ? new Date(runningStart).toISOString() : null,
  };
}

function useLiveSeconds(baseSeconds: number | null, isRunning: boolean) {
  const [live, setLive] = useState<number | null>(baseSeconds);

  useEffect(() => {
    setLive(baseSeconds);
  }, [baseSeconds]);

  useEffect(() => {
    if (!isRunning) return;
    if (typeof live !== "number" || !Number.isFinite(live)) return;
    const t = window.setInterval(() => setLive((prev) => (typeof prev === "number" ? prev + 1 : prev)), 1000);
    return () => window.clearInterval(t);
  }, [isRunning, live]);

  return live;
}

function ActionRail({
  job,
  timerSeconds,
  timerIsRunning,
  notes,
}: {
  job: ProductionJobListItem;
  timerSeconds: number | null;
  timerIsRunning: boolean;
  notes: Array<{ id: string; text: string; createdAt: string; actorUserId?: string | null; edited?: boolean }>;
}) {
  const navigate = useNavigate();
  const start = useStartProductionTimer(job.id);
  const stop = useStopProductionTimer(job.id);
  const complete = useCompleteProductionJob(job.id);
  const reopen = useReopenProductionJob(job.id);
  const submitReprint = useSubmitReprintRequest(job.id);
  const addNote = useAddProductionNote(job.id);
  const setMedia = useSetProductionMediaUsed(job.id);

  const defaultReprintFilename = useMemo(() => {
    const aw = [...(job.artwork ?? []), ...(job.order?.artwork ?? [])];
    const front = aw.find(a => a.isPrimary) ?? aw.find(a => a.side === "front") ?? aw[0];
    return front?.fileName ?? null;
  }, [job.artwork, job.order?.artwork]);

  const [skipCompleteOpen, setSkipCompleteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteText, setWasteText] = useState("");
  const [wasteQty, setWasteQty] = useState<string>("");
  const [wasteUnit, setWasteUnit] = useState("");
  const [wasteComment, setWasteComment] = useState("");
  const [sendToPrepressOpen, setSendToPrepressOpen] = useState(false);
  const [sendToPrepressNote, setSendToPrepressNote] = useState("");
  const [sendToPrepressNoPrints, setSendToPrepressNoPrints] = useState(false);
  const sendToPrepress = useSendLineItemToPrepress();
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintQty, setReprintQty] = useState("");
  const [reprintUnit, setReprintUnit] = useState("");
  const [reprintReason, setReprintReason] = useState("");
  const [reprintNoPrints, setReprintNoPrints] = useState(false);
  const [reprintSendToPrepress, setReprintSendToPrepress] = useState(false);
  const [reprintEditNotes, setReprintEditNotes] = useState("");

  const resetReprintModal = () => {
    setReprintQty("");
    setReprintUnit("");
    setReprintReason("");
    setReprintNoPrints(false);
    setReprintSendToPrepress(false);
    setReprintEditNotes("");
    setReprintOpen(false);
  };

  const isBusy =
    start.isPending ||
    stop.isPending ||
    complete.isPending ||
    reopen.isPending ||
    submitReprint.isPending ||
    addNote.isPending ||
    setMedia.isPending ||
    sendToPrepress.isPending;

  const canAct = job.status !== "done";
  const canStart = canAct && !timerIsRunning;
  const canPause = canAct && timerIsRunning;
  const reprintCompletedAt = job.completedAt ? new Date(job.completedAt) : null;
  const reprintCompletedLabel =
    reprintCompletedAt && !Number.isNaN(reprintCompletedAt.getTime())
      ? reprintCompletedAt.toLocaleString()
      : "Not completed";

  return (
    <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-3">
      <div className="space-y-3">
        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            size="sm"
            variant="ghost"
            onClick={() => navigate(-1)}
            disabled={isBusy}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> BACK
          </Button>
          <Button
            className="w-full justify-start"
            size="sm"
            variant="ghost"
            onClick={() => navigate(ROUTES.production.board)}
            disabled={isBusy}
          >
            <Home className="w-4 h-4 mr-2" /> HOME
          </Button>
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <div className="space-y-2">
          <PrintTicketActions jobId={job.id} jobQuantity={job.qty} size="sm" variant="outline" className="flex w-full flex-wrap" />
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <div className="space-y-2">
          <Button
            className="w-full justify-start bg-emerald-600 hover:bg-emerald-600/90 text-white"
            onClick={() => {
              if (
                !hasProductionPrinterAssignment(job) &&
                !window.confirm("No printer / machine is assigned yet. Start this job anyway?")
              ) {
                return;
              }
              start.mutate();
            }}
            disabled={!canStart || isBusy}
          >
            <Play className="w-4 h-4 mr-2" /> START
          </Button>
          <Button
            className="w-full justify-start bg-blue-600 hover:bg-blue-600/90 text-white"
            onClick={() => stop.mutate()}
            disabled={!canPause || isBusy}
          >
            <Pause className="w-4 h-4 mr-2" /> PAUSE
          </Button>

          {job.status !== "done" ? (
            <>
              {job.stationKey === "prepress" || job.stationKey === "design" ? (
                <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-sm text-titan-text-muted">
                  <span className="font-medium text-titan-text-primary">
                    {job.stationKey === "prepress" ? "Use Send to Print or Complete Prepress" : "Use Complete Design"}
                  </span>{" "}
                  to advance this item.
                </div>
              ) : (
                <>
                  <Button
                    className="w-full justify-start bg-emerald-700 hover:bg-emerald-700/90 text-white"
                    onClick={() => {
                      if (
                        !hasProductionPrinterAssignment(job) &&
                        !window.confirm("No printer / machine is assigned yet. Complete this job anyway?")
                      ) {
                        return;
                      }
                      if (job.status === "queued") {
                        setSkipCompleteOpen(true);
                        return;
                      }
                      complete.mutate({ skipProduction: false });
                    }}
                    disabled={isBusy}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" /> COMPLETE
                  </Button>

                  <AlertDialog open={skipCompleteOpen} onOpenChange={setSkipCompleteOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Skip & complete?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This job is still queued. This will mark it done without running production.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => complete.mutate({ skipProduction: true })}>
                          Skip & Complete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </>
          ) : (
            <Button className="w-full justify-start" variant="outline" onClick={() => reopen.mutate()} disabled={isBusy}>
              <RotateCcw className="w-4 h-4 mr-2" /> REOPEN
            </Button>
          )}
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <div className="space-y-2">
          <Button className="w-full justify-start bg-yellow-600 hover:bg-yellow-600/90 text-white" onClick={() => setReprintOpen(true)} disabled={isBusy || !job.lineItemId}>
            <Printer className="w-4 h-4 mr-2" /> REPRINT
          </Button>
          <Button className="w-full justify-start bg-red-600 hover:bg-red-600/90 text-white" onClick={() => setWasteOpen(true)} disabled={isBusy}>
            <Undo2 className="w-4 h-4 mr-2" /> LOG WASTE
          </Button>
          <Button className="w-full justify-start whitespace-nowrap bg-orange-600 hover:bg-orange-600/90 text-white" onClick={() => setSendToPrepressOpen(true)} disabled={isBusy || !job.lineItemId}>
            <Square className="w-4 h-4 mr-2 shrink-0" /> Send to Prepress
          </Button>
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <Button className="w-full justify-start bg-sky-700 hover:bg-sky-700/90 text-white" onClick={() => setNoteOpen(true)} disabled={isBusy}>
          <MessageSquarePlus className="w-4 h-4 mr-2" /> ADD PRODUCTION NOTE
        </Button>

        <AlertDialog open={noteOpen} onOpenChange={setNoteOpen}>
          <AlertDialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Production Notes</AlertDialogTitle>
              <AlertDialogDescription>Add append-only production notes. Previous notes stay in the timeline history.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4">
              {notes && notes.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Existing Notes:</div>
                  <div className="space-y-2">
                    {notes.map((n) => {
                      const date = new Date(n.createdAt);
                      const timeStr = date.toLocaleString(undefined, { 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      });
                      
                      return (
                        <div key={n.id} className="rounded-md border border-muted bg-muted/30 p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="text-xs text-muted-foreground">
                              {timeStr}
                              {n.edited && <span className="ml-2 text-amber-600">(edited)</span>}
                            </div>
                          </div>
                          <div className="text-sm text-foreground whitespace-pre-wrap">{n.text}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <div className="text-sm font-medium">Add New Note:</div>
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter new note here..."
                  className="min-h-[96px]"
                  disabled={isBusy}
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy} onClick={() => {
                setNoteText("");
              }}>Close</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const text = noteText.trim();
                  if (!text) return;
                  addNote.mutate(text, {
                    onSuccess: () => {
                      setNoteText("");
                    },
                  });
                }}
                disabled={isBusy || !noteText.trim()}
              >
                Add Production Note
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={wasteOpen} onOpenChange={setWasteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log waste</AlertDialogTitle>
              <AlertDialogDescription>
                Record waste/media usage notes for this job (saved as a production event).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <Input
                value={wasteText}
                onChange={(e) => setWasteText(e.target.value)}
                placeholder='e.g. 1 sheet scrapped, edge damage'
                disabled={isBusy}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} placeholder="Qty" disabled={isBusy} />
                <Input value={wasteUnit} onChange={(e) => setWasteUnit(e.target.value)} placeholder="Unit" disabled={isBusy} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Reason <span className="text-destructive">*</span></div>
                <Textarea
                  value={wasteComment}
                  onChange={(e) => setWasteComment(e.target.value)}
                  placeholder="Why did this waste occur?"
                  className="min-h-[72px] resize-none"
                  disabled={isBusy}
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const text = wasteText.trim();
                  const comment = wasteComment.trim();
                  if (!text || !comment) return;
                  const qtyNum = wasteQty.trim() ? Number(wasteQty) : undefined;
                  setMedia.mutate(
                    {
                      text,
                      qty: Number.isFinite(qtyNum as any) ? qtyNum : undefined,
                      unit: wasteUnit.trim() || undefined,
                      comment,
                    },
                    {
                      onSuccess: () => {
                        setWasteText("");
                        setWasteQty("");
                        setWasteUnit("");
                        setWasteComment("");
                        setWasteOpen(false);
                      },
                    },
                  );
                }}
                disabled={isBusy || !wasteText.trim() || !wasteComment.trim()}
              >
                Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={sendToPrepressOpen} onOpenChange={(open) => { setSendToPrepressOpen(open); if (!open) { setSendToPrepressNote(""); setSendToPrepressNoPrints(false); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send to Prepress</AlertDialogTitle>
              <AlertDialogDescription>
                This will move the job back to the Prepress queue for file edits. It will be removed from this board until prepress completes it again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <Textarea
                value={sendToPrepressNote}
                onChange={(e) => setSendToPrepressNote(e.target.value)}
                placeholder="Describe what needs to change (required)..."
                className="min-h-[96px] resize-none"
                disabled={sendToPrepress.isPending}
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="roll-no-prints"
                  checked={sendToPrepressNoPrints}
                  onChange={(e) => setSendToPrepressNoPrints(e.target.checked)}
                  disabled={sendToPrepress.isPending}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="roll-no-prints" className="text-sm cursor-pointer select-none">
                  No prints completed yet
                </label>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sendToPrepress.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const note = sendToPrepressNote.trim();
                  if (!note || !job.lineItemId) return;
                  sendToPrepress.mutate(
                    { lineItemId: job.lineItemId, jobId: job.id, note, noPrintsCompletedYet: sendToPrepressNoPrints },
                    {
                      onSuccess: () => {
                        setSendToPrepressOpen(false);
                        setSendToPrepressNote("");
                        setSendToPrepressNoPrints(false);
                      },
                    },
                  );
                }}
                disabled={sendToPrepress.isPending || !sendToPrepressNote.trim()}
              >
                {sendToPrepress.isPending ? "Sending..." : "Send to Prepress"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* REPRINT REQUEST MODAL */}
        <AlertDialog open={reprintOpen} onOpenChange={(open) => { if (!open) resetReprintModal(); else setReprintOpen(true); }}>
          <AlertDialogContent className="max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Reprint Request</AlertDialogTitle>
              <AlertDialogDescription>
                Record a reprint. Fill in quantity, units, and reason. Optionally send the job back to prepress for file edits.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              {/* Filename — read-only */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">File</div>
                <Input
                  value={defaultReprintFilename ?? "No final file selected"}
                  readOnly
                  className="bg-muted text-muted-foreground cursor-default"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Original printer</div>
                  <div className="font-medium">{job.assignedPrinterName || "Unassigned"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Completed</div>
                  <div className="font-medium">{reprintCompletedLabel}</div>
                </div>
                {job.assignedPrinterAt ? (
                  <div className="col-span-2 text-muted-foreground">
                    Latest assignment saved {new Date(job.assignedPrinterAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
              {/* Quantity + Units */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Quantity <span className="text-destructive">*</span></div>
                  <Input
                    type="number"
                    min="1"
                    value={reprintQty}
                    onChange={(e) => setReprintQty(e.target.value)}
                    placeholder="e.g. 10"
                    disabled={submitReprint.isPending}
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Units <span className="text-destructive">*</span></div>
                  <Select value={reprintUnit} onValueChange={setReprintUnit} disabled={submitReprint.isPending}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select units" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pieces">Pieces</SelectItem>
                      <SelectItem value="sheets">Sheets</SelectItem>
                      <SelectItem value="prints">Prints</SelectItem>
                      <SelectItem value="banners">Banners</SelectItem>
                      <SelectItem value="rolls">Rolls</SelectItem>
                      <SelectItem value="feet">Feet</SelectItem>
                      <SelectItem value="meters">Meters</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Reason */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">Reason <span className="text-destructive">*</span></div>
                <Textarea
                  value={reprintReason}
                  onChange={(e) => setReprintReason(e.target.value)}
                  placeholder="Why is a reprint needed?"
                  className="min-h-[72px] resize-none"
                  disabled={submitReprint.isPending}
                />
              </div>
              {/* Checkboxes */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="roll-rp-noprints"
                    checked={reprintNoPrints}
                    onChange={(e) => setReprintNoPrints(e.target.checked)}
                    disabled={submitReprint.isPending}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor="roll-rp-noprints" className="text-sm cursor-pointer select-none">No prints completed yet</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="roll-rp-prepress"
                    checked={reprintSendToPrepress}
                    onChange={(e) => setReprintSendToPrepress(e.target.checked)}
                    disabled={submitReprint.isPending || !job.lineItemId}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor="roll-rp-prepress" className="text-sm cursor-pointer select-none">Send to Prepress for edits</label>
                </div>
              </div>
              {/* Conditional prepress edit notes */}
              {reprintSendToPrepress && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Prepress edit notes <span className="text-destructive">*</span></div>
                  <Textarea
                    value={reprintEditNotes}
                    onChange={(e) => setReprintEditNotes(e.target.value)}
                    placeholder="Describe what needs to change in the file..."
                    className="min-h-[72px] resize-none"
                    disabled={submitReprint.isPending}
                  />
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitReprint.isPending} onClick={resetReprintModal}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  submitReprint.isPending ||
                  !(Number(reprintQty) > 0) ||
                  !reprintUnit ||
                  !reprintReason.trim() ||
                  (reprintSendToPrepress && !reprintEditNotes.trim()) ||
                  !job.lineItemId
                }
                onClick={() => {
                  if (!job.lineItemId) return;
                  const filename = defaultReprintFilename ?? job.jobDescription ?? "Unknown";
                  submitReprint.mutate(
                    {
                      lineItemId: job.lineItemId,
                      filename,
                      quantity: Number(reprintQty),
                      units: reprintUnit,
                      reason: reprintReason.trim(),
                      noPrintsCompletedYet: reprintNoPrints,
                    },
                    {
                      onSuccess: () => {
                        if (reprintSendToPrepress && reprintEditNotes.trim()) {
                          sendToPrepress.mutate(
                            { lineItemId: job.lineItemId!, jobId: job.id, note: reprintEditNotes.trim(), noPrintsCompletedYet: reprintNoPrints },
                            { onSuccess: resetReprintModal },
                          );
                        } else {
                          resetReprintModal();
                        }
                      },
                    },
                  );
                }}
              >
                {submitReprint.isPending ? "Submitting..." : "Submit Reprint"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="text-[11px] text-titan-text-muted">
          Status: <span className="text-titan-text-secondary">{job.status.replace("_", " ")}</span>
          {typeof timerSeconds === "number" ? (
            <span>
              {" "}• Run {formatSeconds(timerSeconds)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-titan-text-muted">{label}</div>
      <div className={valueClassName || "text-sm font-semibold text-titan-text-primary"}>{value}</div>
    </div>
  );
}

function StatusDropdown({ jobId, currentStatus }: { jobId: string; currentStatus: string }) {
  const updateStatus = useUpdateProductionJobStatus(jobId);
  
  const statusDisplay: Record<string, string> = {
    queued: "Queued",
    in_progress: "In Progress",
    done: "Done",
  };
  
  const statusColors: Record<string, string> = {
    queued: "bg-gray-100 text-gray-800 border-gray-300",
    in_progress: "bg-blue-100 text-blue-800 border-blue-300",
    done: "bg-green-100 text-green-800 border-green-300",
  };
  
  return (
    <Select
      value={currentStatus}
      onValueChange={(value) => {
        if (value !== currentStatus) {
          updateStatus.mutate(value as "queued" | "in_progress" | "done");
        }
      }}
      disabled={updateStatus.isPending}
    >
      <SelectTrigger className={`w-[130px] h-8 text-xs font-medium border ${statusColors[currentStatus] || ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="queued">Queued</SelectItem>
        <SelectItem value="in_progress">In Progress</SelectItem>
        <SelectItem value="done">Done</SelectItem>
      </SelectContent>
    </Select>
  );
}

function PreviewPanel({
  job,
  timerSeconds,
  timerIsRunning,
  notes,
  onPreviewArtwork,
  documentNumberDisplayMode,
}: {
  job: ProductionJobListItem;
  timerSeconds: number | null;
  timerIsRunning: boolean;
  notes: Array<{ id: string; text: string; createdAt: string; actorUserId?: string | null; edited?: boolean }>;
  onPreviewArtwork: (side: "front" | "back") => void;
  documentNumberDisplayMode: ProductionDocumentNumberDisplayMode;
}) {
  const li = primaryLineItem(job);
  const thumbs = artworkThumbs(job);
  
  // Use backend-derived sides and normalize artwork accordingly
  const sidesInfo = normalizeSidesValue((job as any).sides);
  const { front, back, showBackSlot, backMissingReason } = useMemo(
    () => normalizeArtworkForSides(sidesInfo.isDouble, thumbs),
    [sidesInfo.isDouble, thumbs]
  );

  const due = dueMeta(job.order.dueDate);
  
  // Use backend-derived display fields (no UI computation)
  const media = sanitizeDisplayText((job as any).media);
  const sides = sidesInfo.label;
  const size = sanitizeDisplayText((job as any).size);
  const orderNumber = getProductionOrderNumber(job, documentNumberDisplayMode) || ((job as any).orderNumber ?? job.order.orderNumber ?? "—");
  const productionJobId = (job as any).productionJobId ?? job.id;
  
  // Extract IDs for linking
  const orderId = (job as any).orderId || job.order?.id;
  const customerId = (job as any).customerId || (job.order as any)?.customerId;
  
  const qty = li ? li.quantity : job.order.lineItems?.totalQuantity ?? null;
  const packaging =
    (typeof job.order.fulfillmentStatus === "string" && job.order.fulfillmentStatus.trim())
      ? job.order.fulfillmentStatus
      : "—";

  const laminationLabel = sanitizeDisplayText((job as any).lamination?.label ?? "None");
  const finishingRequirements = Array.isArray((job as any).finishingRequirements)
    ? (job as any).finishingRequirements.filter((entry: unknown) => String(entry || "").trim())
    : [];

  // Show Order # and Production Job ID (Order # is primary identifier)
  const jobRefParts = [
    job.lineNumber ? `Line ${job.lineNumber}` : null,
    orderNumber && orderNumber !== "—" ? `Order ${orderNumber}` : null,
    productionJobId ? `Job ${String(productionJobId).slice(-6)}` : null,
  ].filter(Boolean);
  const jobRef = jobRefParts.length ? jobRefParts.join(" • ") : "—";

  // Display notes as plain text without timestamps (timestamps belong in timeline)
  const formattedNotes = notes.length > 0 
    ? notes.map(n => n.text).join('\n\n')
    : "—";

  return (
    <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[700px_1fr_360px] gap-4">
        <div className="flex gap-4">
          {/* FRONT preview - always shown */}
          <div className="space-y-1">
            <div
              className="relative aspect-square w-[280px] md:w-[320px] lg:w-[340px] h-[280px] md:h-[320px] lg:h-[340px] overflow-hidden rounded-lg border-2 border-titan-border-subtle bg-titan-bg-card flex items-center justify-center hover:border-blue-500 transition-colors cursor-pointer"
              onClick={() => onPreviewArtwork("front")}
            >
              <ProductionThumbnail
                artwork={front}
                alt="Front artwork"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="text-xs text-titan-text-muted text-center">FRONT (click to enlarge)</div>
          </div>

          {/* BACK preview - only shown for double-sided */}
          {showBackSlot && (
            <div className="space-y-1">
              <div
                className={`relative aspect-square w-[280px] md:w-[320px] lg:w-[340px] h-[280px] md:h-[320px] lg:h-[340px] overflow-hidden rounded-lg ${backMissingReason === "not_uploaded" ? "border-2 border-dashed border-muted-foreground/30" : "border-2 border-titan-border-subtle"} bg-titan-bg-card flex items-center justify-center hover:border-blue-500 transition-colors cursor-pointer`}
                onClick={() => onPreviewArtwork("back")}
              >
                {backMissingReason === "not_uploaded" ? (
                  <div className="flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                    <FileText className="h-16 w-16 mb-4" />
                    <p className="text-sm font-medium">Back file not uploaded</p>
                  </div>
                ) : (
                  <ProductionThumbnail
                    artwork={back}
                    alt="Back artwork"
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
              <div className="text-xs text-titan-text-muted text-center">
                BACK (click to enlarge)
                {backMissingReason === "not_uploaded" && <span className="ml-1 text-[10px] text-amber-500">(Not uploaded)</span>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 min-w-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {customerId ? (
                <Link
                  to={ROUTES.customers.detail(customerId)}
                  className="text-xl font-semibold text-blue-600 hover:text-blue-700 hover:underline truncate block"
                  onClick={(e) => e.stopPropagation()}
                >
                  {job.order.customerName || "—"}
                </Link>
              ) : (
                <div className="text-xl font-semibold text-titan-text-primary truncate">{job.order.customerName || "—"}</div>
              )}
              <div className="text-xs text-titan-text-muted truncate">
                {orderId && orderNumber !== "—" ? (
                  <>
                    <Link
                      to={ROUTES.orders.detail(orderId)}
                      className="text-blue-600 hover:text-blue-700 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Order {orderNumber}
                    </Link>
                    {productionJobId && <span> • Job {String(productionJobId).slice(-6)}</span>}
                  </>
                ) : (
                  jobRef
                )}
              </div>
            </div>
            {job.order.priority === "rush" ? <Badge variant="destructive">RUSH</Badge> : null}
          </div>

          <ProductionAlertsPanel
            alerts={(job as any).productionAlerts}
            productionJobId={job.id}
            compact
          />

          <ProductionNotesSection jobId={job.id} notes={notes} />
          <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle px-3 py-2">
            <PrinterMachineAssignment
              jobId={job.id}
              stationKey={job.stationKey}
              assignedPrinterName={(job as any).assignedPrinterName}
              assignedPrinterId={(job as any).assignedPrinterId}
              assignedPrinterAt={(job as any).assignedPrinterAt}
              printerOptions={(job as any).printerOptions}
              compact
            />
          </div>
          {li?.description && li.description !== "—" && (
            <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-200">Description</div>
              <div className="text-sm text-titan-text-primary max-h-24 overflow-y-auto break-words whitespace-pre-wrap">
                {li.description}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <div className="space-y-3">
            <Fact
              label="Due date"
              value={
                due ? (
                  <span className={dueClass(due.urgency)}>
                    {due.dateLabel} <span className="text-titan-text-muted">{due.displaySuffix}</span>
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Fact label="Media" value={<span className="truncate">{media}</span>} />
            <Fact label="Sides" value={sides} />
            <Fact 
              label="Lamination" 
              value={(() => {
                const optSelections = li?.optionSelectionsJson;
                if (optSelections && typeof optSelections === 'object') {
                  const lam = (optSelections as any).lamination || (optSelections as any).Lamination;
                  if (lam) {
                    return (
                      <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-300">
                        {lam === 'Custom' ? 'Custom (see notes)' : String(lam)}
                      </Badge>
                    );
                  }
                }
                const selectedOpts = li?.selectedOptions;
                if (Array.isArray(selectedOpts)) {
                  const lamOpt = selectedOpts.find((o) => 
                    o.optionName?.toLowerCase().includes('lamin') ||
                    o.optionId?.toLowerCase().includes('lamin')
                  );
                  if (lamOpt?.value) {
                    return (
                      <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-300">
                        {lamOpt.value === 'Custom' ? 'Custom (see notes)' : String(lamOpt.value)}
                      </Badge>
                    );
                  }
                }
                return "—";
              })()}
            />
            <Fact
              label="Finishing"
              value={
                finishingRequirements.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {finishingRequirements.map((requirement: string) => (
                      <Badge key={requirement} variant="outline">
                        {requirement}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "None"
                )
              }
            />
          </div>

          <div className="space-y-3">
            <Fact label="Size" value={size} />
            <Fact label="Quantity" value={formatQtyPieces(qty)} />
            <Fact label="Packaging" value={packaging} />
            <Fact
              label="Run time"
              value={typeof timerSeconds === "number" ? <span className="font-mono">{formatSeconds(timerSeconds)}</span> : "—"}
              valueClassName="text-lg font-mono text-titan-text-primary"
            />
            {timerIsRunning ? <div className="text-[11px] text-titan-text-muted text-right">RUNNING</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewDisabledHint() {
  return (
    <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-titan-text-primary">
      Art previews are disabled. Enable in <Link className="underline" to={ROUTES.production.board}>Production Overview</Link>.
    </div>
  );
}

export default function RollProductionView(props: { viewKey: string; status: ProductionStatus; jobs?: ProductionJobListItem[] }) {
  const { preferences } = useOrgPreferences();
  const productionNumberDisplayMode = preferences.production?.documentNumberDisplayMode ?? "full";
  const previewsDisabled = useMemo(
    () => typeof window !== "undefined" && window.localStorage.getItem("titan.production.overview.showThumbnails") === "false",
    [],
  );
  const shouldFetchJobs = !props.jobs;
  const { data, isLoading, error } = useProductionJobs(
    { view: props.viewKey },
    { enabled: shouldFetchJobs },
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewSide, setPreviewSide] = useState<"front" | "back">("front");
  const [printerFilter, setPrinterFilter] = useState("all");

  const tabJobs = useMemo(
    () => filterProductionJobsForTab(props.jobs ?? data ?? [], props.status),
    [data, props.jobs, props.status],
  );
  const printerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const job of tabJobs) {
      const name = String((job as any).assignedPrinterName || "").trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [tabJobs]);
  const jobsSafe = useMemo(() => {
    if (printerFilter === "all") return tabJobs;
    if (printerFilter === "unassigned") {
      return tabJobs.filter((job) => !String((job as any).assignedPrinterName || "").trim());
    }
    return tabJobs.filter((job) => String((job as any).assignedPrinterName || "").trim() === printerFilter);
  }, [tabJobs, printerFilter]);

  const sortedJobs = useMemo(() => {
    return [...jobsSafe];
  }, [jobsSafe]);

  useEffect(() => {
    if (sortedJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId && sortedJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(sortedJobs[0].id);
  }, [sortedJobs, selectedJobId]);

  const selectedJob = useMemo(
    () => sortedJobs.find((j) => j.id === selectedJobId) ?? null,
    [sortedJobs, selectedJobId],
  );

  const { data: selectedDetail } = useProductionJob(selectedJob?.id ?? undefined);

  const recentNotes = useMemo(() => {
    const events = selectedDetail?.events ?? [];
    return events
      .filter((e) => e.type === "note" && !(e.payload as any)?.deleted)
      .slice() // copy
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        text: sanitizeDisplayText(e.payload?.text ?? e.payload?.note ?? ""),
        createdAt: e.createdAt,
        actorUserId: e.actorUserId ?? (e.payload as any)?.actorUserId ?? null,
        edited: !!(e.payload as any)?.edited,
      }))
      .filter((n) => n.text.trim());
  }, [selectedDetail]);

  const derivedTimer = useMemo(() => {
    if (!selectedJob) return { seconds: null as number | null, isRunning: false, source: "none" as const };

    const fromEvents = deriveRuntimeFromEvents(selectedDetail?.events);
    const eventSeconds = fromEvents.seconds;
    const eventIsRunning = fromEvents.isRunning;

    if (typeof eventSeconds === "number" && Number.isFinite(eventSeconds)) {
      return {
        seconds: eventSeconds,
        isRunning: selectedJob.status !== "done" && eventIsRunning,
        source: "events" as const,
      };
    }

    const fallbackSeconds =
      typeof selectedJob.timer?.currentSeconds === "number" && Number.isFinite(selectedJob.timer.currentSeconds)
        ? selectedJob.timer.currentSeconds
        : null;
    const fallbackIsRunning = !!selectedJob.timer?.isRunning;
    if (typeof fallbackSeconds === "number") {
      return {
        seconds: fallbackSeconds,
        isRunning: selectedJob.status !== "done" && fallbackIsRunning,
        source: "job" as const,
      };
    }

    return { seconds: null as number | null, isRunning: false, source: "none" as const };
  }, [selectedDetail?.events, selectedJob]);

  const liveTimerSeconds = useLiveSeconds(derivedTimer.seconds, derivedTimer.isRunning);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-3">
          <div className="h-9 w-full bg-titan-bg-muted rounded" />
          <div className="h-9 w-full bg-titan-bg-muted rounded mt-2" />
          <div className="h-9 w-full bg-titan-bg-muted rounded mt-4" />
          <div className="h-9 w-full bg-titan-bg-muted rounded mt-2" />
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
            <div className="h-56 w-full bg-titan-bg-muted rounded" />
          </div>
          <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
            <div className="h-64 w-full bg-titan-bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardContent className="p-4 text-sm text-titan-text-muted">
          Failed to load production jobs.
        </CardContent>
      </Card>
    );
  }

  if (props.status === "done") {
    return (
      <div className="space-y-3">
        {previewsDisabled ? <PreviewDisabledHint /> : null}
        <RecentlyCompletedProductionJobs station={props.viewKey} />
      </div>
    );
  }

  if (tabJobs.length === 0) {
    if (props.status === "queued") {
      return (
        <div className="space-y-3">
          {previewsDisabled ? <PreviewDisabledHint /> : null}
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-6">
              <div className="text-sm font-medium text-titan-text-primary">No production jobs yet</div>
              <div className="mt-1 text-sm text-titan-text-muted">
                Production jobs are created per line item from order routing. Open an order and send line items to production.
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button asChild size="sm">
                  <Link to={ROUTES.orders.list}>Go to Orders</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to={ROUTES.settings.production}>Production Settings</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {previewsDisabled ? <PreviewDisabledHint /> : null}
        <Card className="bg-titan-bg-card border-titan-border-subtle">
          <CardContent className="p-4 text-sm text-titan-text-muted">No roll jobs in this state.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
      <div className="space-y-4">
        {previewsDisabled ? <PreviewDisabledHint /> : null}
        {selectedJob ? (
          <ActionRail job={selectedJob} timerSeconds={liveTimerSeconds} timerIsRunning={derivedTimer.isRunning} notes={recentNotes} />
        ) : (
          <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4 text-sm text-titan-text-muted">
            Select a job to begin.
          </div>
        )}
      </div>

      <div className="space-y-4">
        {selectedJob ? (
          <PreviewPanel
            job={selectedJob}
            timerSeconds={liveTimerSeconds}
            timerIsRunning={derivedTimer.isRunning}
            notes={recentNotes}
            onPreviewArtwork={(side) => {
              setPreviewSide(side);
              setPreviewModalOpen(true);
            }}
            documentNumberDisplayMode={productionNumberDisplayMode}
          />
        ) : null}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-titan-text-primary">JOB QUEUE</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-titan-text-muted">Printer</span>
              <select
                value={printerFilter}
                onChange={(event) => setPrinterFilter(event.target.value)}
                className="h-8 rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 text-xs text-titan-text-primary"
              >
                <option value="all">All Printers</option>
                <option value="unassigned">Unassigned</option>
                {printerOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-titan-border-subtle bg-titan-bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CLIENT</TableHead>
                  <TableHead className="w-[100px]">ORDER #</TableHead>
                  <TableHead className="w-[120px]">ART</TableHead>
                  <TableHead className="w-[140px]">MEDIA</TableHead>
                  <TableHead className="w-[200px]">DUE DATE</TableHead>
                  <TableHead className="text-right w-[80px]">QTY</TableHead>
                  <TableHead className="text-right w-[80px]">SIDES</TableHead>
                  <TableHead className="w-[120px]">MACHINE</TableHead>
                  <TableHead className="w-[140px]">STATUS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-titan-text-muted">
                      No jobs match this printer filter.
                    </TableCell>
                  </TableRow>
                ) : null}
                {sortedJobs.map((job) => {
                  const selected = job.id === selectedJobId;
                  const li = primaryLineItem(job);
                  const qty = li?.quantity ?? job.order.lineItems?.totalQuantity ?? null;
                  const due = dueMeta(job.order.dueDate);
                  
                  // Backend-derived display fields (API computes these)
                  const mediaName = sanitizeDisplayText((job as any).media);
                  const sidesInfo = normalizeSidesValue((job as any).sides);
                  const sidesDisplay = sidesInfo.label;

                  // Normalize artwork based on sides for UI display
                  const thumbs = artworkThumbs(job);
                  const { front, back, showBackSlot, backMissingReason } = normalizeArtworkForSides(sidesInfo.isDouble, thumbs);
                  const hasFront = !!front;
                  const hasBack = !!back;

                  // Extract order number and ID for linking
                  const orderNumber = getProductionOrderNumber(job, productionNumberDisplayMode) || (job as any).orderNumber || job.order?.orderNumber || "—";
                  const orderId = (job as any).orderId || job.order?.id;
                  const customerId = (job as any).customerId || (job.order as any)?.customerId;

                  return (
                    <TableRow
                      key={job.id}
                      className={selected ? "bg-titan-bg-muted" : "hover:bg-titan-bg-muted/40"}
                      onClick={() => setSelectedJobId(job.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <TableCell className="py-5" onClick={(e) => e.stopPropagation()}>
                        {customerId ? (
                          <Link
                            to={ROUTES.customers.detail(customerId)}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {job.order.customerName || "—"}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold">{job.order.customerName || "—"}</span>
                        )}
                        {job.lineNumber ? <div className="mt-1 text-xs font-semibold text-titan-text-muted">Line {job.lineNumber}</div> : null}
                        {Array.isArray((job as any).productionAlerts) && (job as any).productionAlerts.length > 0 ? (
                          <div className="mt-1">
                            <Badge variant="destructive" className="text-[10px] uppercase tracking-wide">
                              {(job as any).productionAlerts.some((alert: any) => alert.severity === "critical")
                                ? "Critical alert"
                                : `${(job as any).productionAlerts.length} alert(s)`}
                            </Badge>
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-5" onClick={(e) => e.stopPropagation()}>
                        {orderId && orderNumber !== "—" ? (
                          <Link
                            to={ROUTES.orders.detail(orderId)}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {orderNumber}
                          </Link>
                        ) : (
                          <span className="text-sm text-titan-text-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-5">
                        <div className="flex items-center gap-1.5">
                          {!showBackSlot ? (
                            // Single-sided: show only Front thumbnail
                            <div
                              className="relative cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedJobId(job.id);
                                setPreviewSide("front");
                                setPreviewModalOpen(true);
                              }}
                            >
                              {hasFront ? (
                                <div className="relative">
                                  <ProductionThumbnail
                                    artwork={front}
                                    alt="Front"
                                    className="w-12 h-12 rounded object-cover border-2 border-blue-500 hover:border-blue-600 transition-colors"
                                  />
                                  <div className="absolute top-0.5 left-0.5 bg-blue-600 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                                    F
                                  </div>
                                </div>
                              ) : (
                                <span className="inline-flex items-center justify-center w-12 h-12 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors">
                                  F
                                </span>
                              )}
                            </div>
                          ) : (
                            // Double-sided: ALWAYS show both Front and Back thumbnails
                            <>
                              {/* Front Thumbnail */}
                              <div
                                className="relative cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedJobId(job.id);
                                  setPreviewSide("front");
                                  setPreviewModalOpen(true);
                                }}
                              >
                                {hasFront ? (
                                  <div className="relative">
                                    <ProductionThumbnail
                                      artwork={front}
                                      alt="Front"
                                      className="w-11 h-11 rounded object-cover border-2 border-rose-500 hover:border-rose-600 transition-colors"
                                    />
                                    <div className="absolute top-0.5 left-0.5 bg-rose-600 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                                      F
                                    </div>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center justify-center w-11 h-11 rounded bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition-colors">
                                    F
                                  </span>
                                )}
                              </div>
                              
                              {/* Back Thumbnail - ALWAYS shown for double-sided */}
                              <div
                                className="relative cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedJobId(job.id);
                                  setPreviewSide("back");
                                  setPreviewModalOpen(true);
                                }}
                              >
                                {hasBack ? (
                                  // Back has artwork
                                  <div className="relative">
                                    <ProductionThumbnail
                                      artwork={back}
                                      alt="Back"
                                      className="w-11 h-11 rounded object-cover border-2 border-teal-500 hover:border-teal-600 transition-colors"
                                    />
                                    <div className="absolute top-0.5 left-0.5 bg-teal-600 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                                      B
                                    </div>
                                  </div>
                                ) : (
                                  // Back file not uploaded
                                  <div className="relative inline-flex items-center justify-center w-11 h-11 rounded bg-muted border-2 border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 transition-colors" title="Back file not uploaded">
                                    <div className="text-[9px] font-bold text-muted-foreground">B</div>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-5 text-sm">{mediaName}</TableCell>
                      <TableCell className={`py-5 text-sm font-semibold ${due ? dueClass(due.urgency) : "text-titan-text-primary"}`}>
                        {due ? `${due.dateLabel} ${due.displaySuffix}` : "—"}
                      </TableCell>
                      <TableCell className="py-5 text-sm text-right font-semibold">{Number.isFinite(Number(qty)) ? Number(qty) : "—"}</TableCell>
                      <TableCell className="py-5 text-sm text-right font-semibold">
                        {sidesDisplay}
                      </TableCell>
                      <TableCell className="py-5 text-sm">
                        {(job as any).assignedPrinterName || "Unassigned"}
                      </TableCell>
                      <TableCell className="py-5" onClick={(e) => e.stopPropagation()}>
                        <StatusDropdown jobId={job.id} currentStatus={job.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {selectedJob ? null : (
          <div className="text-xs text-titan-text-muted">No job selected.</div>
        )}
      </div>

      {/* Artwork Preview Modal */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh] h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {selectedJob
                ? `${selectedJob.order.customerName} - Order ${getProductionOrderNumber(selectedJob, productionNumberDisplayMode) || ((selectedJob as any).orderNumber ?? selectedJob.order.orderNumber)} - Job ${String((selectedJob as any).productionJobId ?? selectedJob.id).slice(-6)}`
                : "Artwork Preview"}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (() => {
            const sidesInfo = normalizeSidesValue((selectedJob as any).sides);
            const thumbs = artworkThumbs(selectedJob);
            const { front, back, showBackSlot, backMissingReason } = normalizeArtworkForSides(sidesInfo.isDouble, thumbs);
            const currentArtwork = previewSide === "front" ? front : back;
            const imageSrc = getBestArtworkImage(currentArtwork);

            return (
              <div className="flex-1 flex flex-col min-h-0 gap-4">
                {/* Front/Back toggle - only show for double-sided jobs */}
                {showBackSlot && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={previewSide === "front" ? "default" : "outline"}
                      onClick={() => setPreviewSide("front")}
                    >
                      Front
                    </Button>
                    <Button
                      size="sm"
                      variant={previewSide === "back" ? "default" : "outline"}
                      onClick={() => setPreviewSide("back")}
                    >
                      Back
                    </Button>
                    {backMissingReason === "not_uploaded" && previewSide === "back" && (
                      <span className="text-xs text-amber-500 ml-2">(Not uploaded)</span>
                    )}
                  </div>
                )}

                {/* Large artwork preview with zoom/pan controls */}
                {previewSide === "back" && backMissingReason === "not_uploaded" ? (
                  <div className="flex-1 min-h-0 rounded-lg border-2 border-dashed border-titan-border-subtle flex flex-col items-center justify-center bg-muted/30 p-8 text-center">
                    <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold text-titan-text-primary mb-2">Back file not uploaded</h3>
                    <p className="text-sm text-muted-foreground mb-4">This double-sided job only has front artwork. Upload a back file to complete the artwork set.</p>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        const orderId = (selectedJob as any).orderId || selectedJob.order?.id;
                        if (orderId) window.location.href = `/orders/${orderId}`;
                      }}
                      className="gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload back file
                    </Button>
                  </div>
                ) : (
                  <ZoomPanImageViewer
                    src={imageSrc}
                    alt={`${previewSide === "front" ? "Front" : "Back"} artwork`}
                    className="flex-1 min-h-0 rounded-lg border-2 border-titan-border-subtle"
                  />
                )}

                {/* File info and actions - pinned at bottom */}
                {currentArtwork && (
                  <div className="flex items-center justify-between gap-4 text-sm shrink-0 p-3 bg-titan-bg-card rounded-lg border border-titan-border-subtle">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{currentArtwork.fileName}</div>
                      <div className="flex items-center gap-3 text-xs text-titan-text-muted mt-1">
                        <span>{getFileTypeLabel(currentArtwork.mimeType, currentArtwork.fileName)}</span>
                        {currentArtwork.sizeBytes && (
                          <>
                            <span>•</span>
                            <span>{formatFileSize(currentArtwork.sizeBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentArtwork.fileUrl && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              const downloadUrl = buildDownloadUrl(currentArtwork.fileUrl, currentArtwork.fileName);
                              window.location.href = downloadUrl;
                            }}
                            className="gap-1.5"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(currentArtwork.fileUrl, "_blank")}
                            className="gap-1.5"
                          >
                            Open
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
