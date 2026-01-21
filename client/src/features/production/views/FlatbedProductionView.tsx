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
  useReprintProductionJob,
  useSetProductionMediaUsed,
  useStartProductionTimer,
  useStopProductionTimer,
  useUpdateProductionJobStatus,
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
import ZoomPanImageViewer from "@/components/production/ZoomPanImageViewer";
import { formatFileSize, getFileTypeLabel, buildDownloadUrl } from "@/lib/fileUtils";

type ProductionStatus = "queued" | "in_progress" | "done";

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
  
  // 1. Prefer thumbnailUrl (always an image if present)
  if (artwork.thumbnailUrl && artwork.thumbnailUrl.trim()) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV:getBestArtworkImage] Using thumbnailUrl: ${artwork.thumbnailUrl}`);
    }
    return artwork.thumbnailUrl;
  }
  
  // 2. Fallback to fileUrl, but ONLY if it's an image file
  if (artwork.fileUrl && artwork.fileUrl.trim()) {
    // Check if fileName suggests an image (jpg, jpeg, png, gif, webp, svg)
    const fileName = (artwork.fileName || '').toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tif', '.tiff'];
    const isImageFile = imageExtensions.some(ext => fileName.endsWith(ext));
    
    if (isImageFile) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV:getBestArtworkImage] Using fileUrl (image): ${artwork.fileUrl}`);
      }
      return artwork.fileUrl;
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV:getBestArtworkImage] fileUrl exists but not an image file: ${fileName}`);
    }
  }
  
  // 3. No valid image URL available (might be PDF or thumbnail pending)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV:getBestArtworkImage] No valid image URL - fileName: ${artwork.fileName}, has thumbnailUrl: ${!!artwork.thumbnailUrl}, has fileUrl: ${!!artwork.fileUrl}`);
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
    if (!hasError && artwork?.fileUrl && src !== artwork.fileUrl) {
      // Fallback to fileUrl if thumbnail fails
      setSrc(artwork.fileUrl);
      setHasError(false);
    } else {
      setHasError(true);
    }
  };

  if (!src || hasError) {
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
        // DEV-only: log thumbnail load failures
        if (process.env.NODE_ENV === 'development') {
          console.error(`[ProductionThumbnail] Failed to load:`, {
            src,
            artwork: artwork ? {
              id: artwork.id,
              fileName: artwork.fileName,
              fileUrl: artwork.fileUrl,
              thumbnailUrl: artwork.thumbnailUrl,
              side: artwork.side
            } : null
          });
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

function formatDims(width: string | null | undefined, height: string | null | undefined) {
  if (!width || !height) return "—";
  return `${width} × ${height}`;
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
  sides: string,
  artwork: ProductionOrderArtworkSummary[],
): {
  front: ProductionOrderArtworkSummary | null;
  back: ProductionOrderArtworkSummary | null;
  showBackSlot: boolean;
  backMissingReason: "not_uploaded" | null;
} {
  const list = [...(artwork || [])];
  const isDouble = sides === "Double" || sides === "2" || sides === "double";

  // DEV logging for debugging artwork mapping
  if (process.env.NODE_ENV === "development" && list.length > 0) {
    console.log("[normalizeArtworkForSides]", {
      sides,
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
}: {
  job: ProductionJobListItem;
  timerSeconds: number | null;
  timerIsRunning: boolean;
}) {
  const navigate = useNavigate();
  const start = useStartProductionTimer(job.id);
  const stop = useStopProductionTimer(job.id);
  const complete = useCompleteProductionJob(job.id);
  const reopen = useReopenProductionJob(job.id);
  const reprint = useReprintProductionJob(job.id);
  const addNote = useAddProductionNote(job.id);
  const setMedia = useSetProductionMediaUsed(job.id);

  const [skipCompleteOpen, setSkipCompleteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteText, setWasteText] = useState("");
  const [wasteQty, setWasteQty] = useState<string>("");
  const [wasteUnit, setWasteUnit] = useState("");

  const isBusy =
    start.isPending ||
    stop.isPending ||
    complete.isPending ||
    reopen.isPending ||
    reprint.isPending ||
    addNote.isPending ||
    setMedia.isPending;

  const canAct = job.status !== "done";
  const canStart = canAct && !timerIsRunning;
  const canPause = canAct && timerIsRunning;

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
          <Button
            className="w-full justify-start bg-emerald-600 hover:bg-emerald-600/90 text-white"
            onClick={() => start.mutate()}
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
              <Button
                className="w-full justify-start bg-emerald-700 hover:bg-emerald-700/90 text-white"
                onClick={() => {
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
          ) : (
            <Button className="w-full justify-start" variant="outline" onClick={() => reopen.mutate()} disabled={isBusy}>
              <RotateCcw className="w-4 h-4 mr-2" /> REOPEN
            </Button>
          )}
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <div className="space-y-2">
          <Button className="w-full justify-start bg-yellow-600 hover:bg-yellow-600/90 text-white" onClick={() => reprint.mutate()} disabled={isBusy}>
            <Printer className="w-4 h-4 mr-2" /> REPRINT
          </Button>
          <Button className="w-full justify-start bg-red-600 hover:bg-red-600/90 text-white" onClick={() => setWasteOpen(true)} disabled={isBusy}>
            <Undo2 className="w-4 h-4 mr-2" /> LOG WASTE
          </Button>
        </div>

        <div className="h-px bg-titan-border-subtle" />

        <Button className="w-full justify-start bg-sky-700 hover:bg-sky-700/90 text-white" onClick={() => setNoteOpen(true)} disabled={isBusy}>
          <MessageSquarePlus className="w-4 h-4 mr-2" /> ADD NOTES
        </Button>

        <AlertDialog open={noteOpen} onOpenChange={setNoteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add note</AlertDialogTitle>
              <AlertDialogDescription>Attach a production note to this job.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add operator note…"
                className="min-h-[96px]"
                disabled={isBusy}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const text = noteText.trim();
                  if (!text) return;
                  addNote.mutate(text, {
                    onSuccess: () => {
                      setNoteText("");
                      setNoteOpen(false);
                    },
                  });
                }}
                disabled={isBusy || !noteText.trim()}
              >
                Add Note
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
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const text = wasteText.trim();
                  if (!text) return;
                  const qtyNum = wasteQty.trim() ? Number(wasteQty) : undefined;
                  setMedia.mutate(
                    {
                      text,
                      qty: Number.isFinite(qtyNum as any) ? qtyNum : undefined,
                      unit: wasteUnit.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setWasteText("");
                        setWasteQty("");
                        setWasteUnit("");
                        setWasteOpen(false);
                      },
                    },
                  );
                }}
                disabled={isBusy || !wasteText.trim()}
              >
                Save
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
}: {
  job: ProductionJobListItem;
  timerSeconds: number | null;
  timerIsRunning: boolean;
  notes: Array<{ id: string; text: string; createdAt: string }>;
  onPreviewArtwork: (side: "front" | "back") => void;
}) {
  const li = primaryLineItem(job);
  const thumbs = artworkThumbs(job);
  
  // Use backend-derived sides and normalize artwork accordingly
  const sidesValue = (job as any).sides ?? "—";
  const { front, back, showBackSlot, backMissingReason } = useMemo(
    () => normalizeArtworkForSides(sidesValue, thumbs),
    [sidesValue, thumbs]
  );

  const due = dueMeta(job.order.dueDate);
  
  // Use backend-derived display fields (no UI computation)
  const media = (job as any).media ?? "—";
  const sides = (job as any).sides ?? "—";
  const size = (job as any).size ?? "—";
  const orderNumber = (job as any).orderNumber ?? job.order.orderNumber ?? "—";
  const productionJobId = (job as any).productionJobId ?? job.id;
  
  // Extract IDs for linking
  const orderId = (job as any).orderId || job.order?.id;
  const customerId = (job as any).customerId || (job.order as any)?.customerId;
  
  const qty = li ? li.quantity : job.order.lineItems?.totalQuantity ?? null;
  const packaging =
    (typeof job.order.fulfillmentStatus === "string" && job.order.fulfillmentStatus.trim())
      ? job.order.fulfillmentStatus
      : "—";

  // Show Order # and Production Job ID (Order # is primary identifier)
  const jobRefParts = [
    orderNumber && orderNumber !== "—" ? `Order #${orderNumber}` : null,
    productionJobId ? `Job ${String(productionJobId).slice(-6)}` : null,
  ].filter(Boolean);
  const jobRef = jobRefParts.length ? jobRefParts.join(" • ") : "—";

  const noteText = (notes[0]?.text || "").trim() || "—";

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

        <div className="space-y-3">
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
                      Order #{orderNumber}
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

          <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-amber-200">Production notes</div>
            <div className="text-sm font-semibold text-titan-text-primary line-clamp-2">{noteText}</div>
          </div>
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

export default function FlatbedProductionView(props: { viewKey: string; status: ProductionStatus }) {
  const { data, isLoading, error } = useProductionJobs({ status: props.status, view: props.viewKey });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewSide, setPreviewSide] = useState<"front" | "back">("front");

  const jobsSafe = data ?? [];

  const sortedJobs = useMemo(() => {
    return [...jobsSafe].sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;

      const ad = a.order.dueDate ? new Date(a.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.order.dueDate ? new Date(b.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;

      const pr = priorityRank(a.order.priority) - priorityRank(b.order.priority);
      if (pr !== 0) return pr;

      const on = String(a.order.orderNumber || "").localeCompare(String(b.order.orderNumber || ""));
      if (on !== 0) return on;

      return String(a.id).localeCompare(String(b.id));
    });
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
      .filter((e) => e.type === "note")
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        text: typeof e.payload?.text === "string" ? e.payload.text : "",
        createdAt: e.createdAt,
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
      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-4">
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

  if (jobsSafe.length === 0) {
    if (props.status === "queued") {
      return (
        <Card className="bg-titan-bg-card border-titan-border-subtle">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-titan-text-primary">No production jobs yet</div>
            <div className="mt-1 text-sm text-titan-text-muted">
              Production jobs are created from Orders. Open an order and click <span className="font-medium">Production Job</span>
              to generate the first job.
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
      );
    }

    return (
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardContent className="p-4 text-sm text-titan-text-muted">No flatbed jobs in this state.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-4">
      <div className="space-y-4">
        {selectedJob ? (
          <ActionRail job={selectedJob} timerSeconds={liveTimerSeconds} timerIsRunning={derivedTimer.isRunning} />
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
          />
        ) : null}

        <div>
          <div className="text-sm font-semibold text-titan-text-primary">JOB QUEUE</div>
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
                  <TableHead className="w-[140px]">STATUS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedJobs.map((job) => {
                  const selected = job.id === selectedJobId;
                  const li = primaryLineItem(job);
                  const qty = li?.quantity ?? job.order.lineItems?.totalQuantity ?? null;
                  const due = dueMeta(job.order.dueDate);
                  
                  // Backend-derived display fields (API computes these)
                  const mediaName = (job as any).media ?? "—";
                  const sidesDisplay = (job as any).sides ?? "—";

                  // Normalize artwork based on sides for UI display
                  const thumbs = artworkThumbs(job);
                  const { front, back, showBackSlot, backMissingReason } = normalizeArtworkForSides(sidesDisplay, thumbs);
                  const hasFront = !!front;
                  const hasBack = !!back;

                  // Extract order number and ID for linking
                  const orderNumber = (job as any).orderNumber || job.order?.orderNumber || "—";
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
                ? `${selectedJob.order.customerName} • Order #${(selectedJob as any).orderNumber ?? selectedJob.order.orderNumber} • Job ${String((selectedJob as any).productionJobId ?? selectedJob.id).slice(-6)}`
                : "Artwork Preview"}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (() => {
            const sidesValue = (selectedJob as any).sides ?? "—";
            const thumbs = artworkThumbs(selectedJob);
            const { front, back, showBackSlot, backMissingReason } = normalizeArtworkForSides(sidesValue, thumbs);
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
