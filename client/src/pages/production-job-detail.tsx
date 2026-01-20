import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROUTES } from "@/config/routes";
import {
  useAddProductionNote,
  useCompleteProductionJob,
  useProductionJob,
  useReopenProductionJob,
  useReprintProductionJob,
  useStartProductionTimer,
  useStopProductionTimer,
  ProductionOrderArtworkSummary,
} from "@/hooks/useProduction";
import {
  Play,
  Square,
  CheckCircle2,
  RotateCcw,
  ArrowLeft,
  Printer,
  FileText,
  ExternalLink,
  ChevronDown,
  AlertTriangle,
  Clock,
} from "lucide-react";

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatEventLabel(type: string) {
  switch (type) {
    case "timer_started":
      return "Timer started";
    case "timer_stopped":
      return "Timer stopped";
    case "reprint_incremented":
      return "Reprint recorded";
    case "media_used_set":
      return "Media used set";
    case "note":
      return "Note";
    default:
      return type;
  }
}

/**
 * Get the best available image source for artwork
 * Priority: thumbnailUrl > fileUrl (if image) > null
 */
function getBestArtworkImage(artwork: ProductionOrderArtworkSummary | null): string | null {
  if (!artwork) return null;

  // 1. Prefer thumbnailUrl (always an image if present)
  if (artwork.thumbnailUrl && artwork.thumbnailUrl.trim()) {
    return artwork.thumbnailUrl;
  }

  // 2. Fallback to fileUrl, but ONLY if it's an image file
  if (artwork.fileUrl && artwork.fileUrl.trim()) {
    const fileName = (artwork.fileName || "").toLowerCase();
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff"];
    const isImageFile = imageExtensions.some((ext) => fileName.endsWith(ext));

    if (isImageFile) {
      return artwork.fileUrl;
    }
  }

  return null;
}

/**
 * Production thumbnail component with fallback handling
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
  const src = getBestArtworkImage(artwork);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [artwork]);

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className || ""}`}>
        <div className="text-center p-2">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-1 text-[10px] text-muted-foreground">No Preview</div>
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
      onError={() => setFailed(true)}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}

function isProductionJobDone(status: unknown): boolean {
  return String(status || "").toLowerCase() === "done";
}

/**
 * Normalize artwork based on sides logic
 * Rules:
 * - Single: Only front, no back slot
 * - Double: Front + back (if back missing, defaults to front)
 */
function normalizeArtworkForSides(
  sides: string,
  artwork: ProductionOrderArtworkSummary[],
): {
  front: ProductionOrderArtworkSummary | null;
  back: ProductionOrderArtworkSummary | null;
  showBackSlot: boolean;
  isSameArtwork: boolean;
} {
  const list = [...(artwork || [])];
  const byFront = list.filter((a) => String(a.side || "").toLowerCase() === "front");
  const byBack = list.filter((a) => String(a.side || "").toLowerCase() === "back");

  const pickBest = (items: ProductionOrderArtworkSummary[]) => {
    if (items.length === 0) return null;
    const primary = items.find((a) => a.isPrimary);
    return primary || items[0];
  };

  const frontArt = pickBest(byFront) ?? pickBest(list);
  let backArt = pickBest(byBack);

  const sidesLower = String(sides || "").toLowerCase();
  const isDouble = sidesLower.includes("double") || sidesLower === "2" || sidesLower === "ds";

  if (isDouble) {
    // Double-sided: show back slot
    if (!backArt && frontArt) {
      // Default back to front if missing
      backArt = frontArt;
      return { front: frontArt, back: backArt, showBackSlot: true, isSameArtwork: true };
    }
    return { front: frontArt, back: backArt, showBackSlot: true, isSameArtwork: backArt === frontArt };
  } else {
    // Single-sided: no back slot
    return { front: frontArt, back: null, showBackSlot: false, isSameArtwork: false };
  }
}

export default function ProductionJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useProductionJob(jobId);

  const start = useStartProductionTimer(jobId || "");
  const stop = useStopProductionTimer(jobId || "");
  const complete = useCompleteProductionJob(jobId || "");
  const reopen = useReopenProductionJob(jobId || "");
  const reprint = useReprintProductionJob(jobId || "");
  const addNote = useAddProductionNote(jobId || "");

  const [tickSeconds, setTickSeconds] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [previewArtwork, setPreviewArtwork] = useState<ProductionOrderArtworkSummary | null>(null);

  useEffect(() => {
    if (!data) return;
    setTickSeconds(data.timer.currentSeconds);
  }, [data?.timer.currentSeconds]);

  useEffect(() => {
    if (!data?.timer.isRunning) return;
    const t = window.setInterval(() => setTickSeconds((p) => p + 1), 1000);
    return () => window.clearInterval(t);
  }, [data?.timer.isRunning]);

  const dueLabel = useMemo(() => {
    if (!data?.order.dueDate) return null;
    const d = new Date(data.order.dueDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }, [data?.order.dueDate]);

  const isDueOverdue = useMemo(() => {
    if (!data?.order.dueDate) return false;
    const d = new Date(data.order.dueDate);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  }, [data?.order.dueDate]);

  const isBusy =
    start.isPending ||
    stop.isPending ||
    complete.isPending ||
    reopen.isPending ||
    reprint.isPending ||
    addNote.isPending;

  // Artwork normalization
  const artwork = useMemo(() => {
    if (!data) return { front: null, back: null, showBackSlot: false, isSameArtwork: false };
    return normalizeArtworkForSides(String(data.sides || ""), data.order.artwork || []);
  }, [data]);

  if (isLoading) {
    return (
      <Page maxWidth="full">
        <PageHeader title="Production Job" subtitle="Loading…" />
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page maxWidth="full">
        <PageHeader title="Production Job" subtitle="Not found" />
        <ContentLayout>
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Failed to load production job.
            </CardContent>
          </Card>
        </ContentLayout>
      </Page>
    );
  }

  const jobDescription = data.jobDescription || `Job #${data.id.slice(-8)}`;
  const media = data.media || "—";
  const qty = data.qty ?? 0;
  const size = data.size || "—";
  const sidesDisplay = data.sides || "—";
  const otherJobsInOrder = data.otherJobsInOrder || [];
  const doneCount = otherJobsInOrder.filter((j) => isProductionJobDone(j.status)).length;
  const totalCount = otherJobsInOrder.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Get first artwork file URL for "Open File" button
  const firstArtworkFile = (data.order.artwork || [])[0];

  return (
    <Page maxWidth="full">
      <PageHeader
        title={`Production Job`}
        subtitle={`Order ${data.order.orderNumber} • ${data.order.customerName}`}
        backButton={
          <Button variant="ghost" size="icon" onClick={() => navigate(ROUTES.production.board)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        }
        actions={
          <div className="flex items-center gap-2">
            {data.order.priority === "rush" && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" />
                RUSH
              </Badge>
            )}
            {isDueOverdue && (
              <Badge variant="destructive" className="gap-1">
                OVERDUE
              </Badge>
            )}
            <Badge variant="outline" className="capitalize">
              {data.status.replace("_", " ")}
            </Badge>
          </div>
        }
      />

      <ContentLayout>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* LEFT COLUMN: Actions + Timeline */}
          <div className="space-y-4">
            {/* WORKFLOW ACTIONS */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                {/* Timer Display */}
                <div className="flex items-center justify-between p-3 rounded-md bg-muted">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Production Time</div>
                    <div className="text-xl font-mono">{formatSeconds(tickSeconds)}</div>
                    {data.timer.isRunning && (
                      <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-0.5">
                        <Clock className="w-3 h-3" />
                        Running
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => (data.timer.isRunning ? stop.mutate() : start.mutate())}
                      disabled={isBusy}
                      className="gap-1.5"
                    >
                      {data.timer.isRunning ? (
                        <>
                          <Square className="w-4 h-4" /> Stop
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" /> Start
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {data.status === "done" ? (
                    <Button variant="outline" onClick={() => reopen.mutate()} disabled={isBusy} className="gap-1.5">
                      <RotateCcw className="w-4 h-4" /> Reopen
                    </Button>
                  ) : data.status === "queued" ? (
                    <Button
                      variant="default"
                      onClick={() => complete.mutate({ skipProduction: true })}
                      disabled={isBusy}
                      className="gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Skip & Complete
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      onClick={() => complete.mutate({})}
                      disabled={isBusy}
                      className="gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Complete
                    </Button>
                  )}

                  <Button variant="secondary" onClick={() => reprint.mutate()} disabled={isBusy} className="gap-1.5">
                    <Printer className="w-4 h-4" /> Reprint
                  </Button>

                  <Button variant="outline" disabled className="gap-1.5">
                    <AlertTriangle className="w-4 h-4" /> Log Waste (soon)
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground pt-1">
                  Reprints: <span className="font-medium">{data.reprintCount}</span>
                </div>
              </CardContent>
            </Card>

            {/* TIMELINE - Collapsible */}
            <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="p-4 pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Timeline / History</CardTitle>
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground transition-transform ${timelineOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="p-4 pt-0">
                    {data.events.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No events yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {data.events.map((e) => (
                          <div key={e.id} className="border rounded-md p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium">{formatEventLabel(e.type)}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(e.createdAt).toLocaleString()}
                              </div>
                            </div>
                            {e.type === "note" && e.payload?.text && (
                              <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                                {e.payload.text}
                              </div>
                            )}
                            {e.type === "timer_stopped" && typeof e.payload?.seconds === "number" && (
                              <div className="text-xs text-muted-foreground mt-1">+{e.payload.seconds}s</div>
                            )}
                            {e.type === "media_used_set" && (
                              <div className="text-sm text-muted-foreground mt-2">
                                {String(e.payload?.text || "")}
                                {e.payload?.qty != null ? ` • ${e.payload.qty}` : ""}
                                {e.payload?.unit ? ` ${e.payload.unit}` : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* RIGHT COLUMN: Artwork thumbs + Job Specs + Order Jobs + Notes */}
          <div className="space-y-4">
            {/* ARTWORK THUMBNAILS (compact) */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Artwork Thumbnails
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    className="w-20 h-20 rounded-md border bg-muted overflow-hidden hover:opacity-90 transition-opacity"
                    onClick={() => artwork.front && setPreviewArtwork(artwork.front)}
                    title="Front"
                  >
                    <ProductionThumbnail
                      artwork={artwork.front}
                      alt="Front artwork"
                      className="w-full h-full object-contain"
                    />
                  </button>

                  {artwork.showBackSlot && (
                    <button
                      type="button"
                      className="w-20 h-20 rounded-md border bg-muted overflow-hidden hover:opacity-90 transition-opacity"
                      onClick={() => artwork.back && setPreviewArtwork(artwork.back)}
                      title="Back"
                    >
                      {artwork.isSameArtwork ? (
                        <div className="w-full h-full flex items-center justify-center p-2 text-center text-[10px] text-muted-foreground">
                          Same as front
                        </div>
                      ) : (
                        <ProductionThumbnail
                          artwork={artwork.back}
                          alt="Back artwork"
                          className="w-full h-full object-contain"
                        />
                      )}
                    </button>
                  )}

                  <div className="ml-auto flex flex-col gap-2">
                    {firstArtworkFile?.fileUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(firstArtworkFile.fileUrl, "_blank")}
                        className="gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open File
                      </Button>
                    )}
                    <Link to={ROUTES.orders.detail(data.order.id)}>
                      <Button size="sm" variant="ghost" className="gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        View Order
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* JOB SPECS */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base">Job Specifications</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2 text-sm">
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <div className="text-muted-foreground">Customer:</div>
                  <div className="font-medium">{data.order.customerName}</div>

                  <div className="text-muted-foreground">Order #:</div>
                  <div className="font-medium">{data.order.orderNumber}</div>

                  <div className="text-muted-foreground">Job ID:</div>
                  <div className="font-mono text-xs">{data.id.slice(-12)}</div>

                  {dueLabel && (
                    <>
                      <div className="text-muted-foreground">Due Date:</div>
                      <div className={isDueOverdue ? "text-destructive font-medium" : ""}>{dueLabel}</div>
                    </>
                  )}

                  <div className="text-muted-foreground">Priority:</div>
                  <div className="capitalize">{data.order.priority || "—"}</div>

                  <div className="text-muted-foreground">Description:</div>
                  <div>{jobDescription}</div>

                  <div className="text-muted-foreground">Media:</div>
                  <div>{media}</div>

                  <div className="text-muted-foreground">Size:</div>
                  <div>{size}</div>

                  <div className="text-muted-foreground">Quantity:</div>
                  <div className="font-medium">{qty}</div>

                  <div className="text-muted-foreground">Sides:</div>
                  <div>{sidesDisplay}</div>

                  <div className="text-muted-foreground">Station:</div>
                  <div className="capitalize">{data.stationKey || "—"}</div>

                  <div className="text-muted-foreground">Step:</div>
                  <div className="capitalize">{data.stepKey || "—"}</div>
                </div>
              </CardContent>
            </Card>

            {/* ORDER JOBS */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Order Jobs</CardTitle>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-normal text-muted-foreground">
                      {doneCount} of {totalCount} jobs done
                    </span>
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden" aria-label="Completion">
                      <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {otherJobsInOrder.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No production jobs found for this order.</div>
                ) : (
                  <div className="space-y-2">
                    {otherJobsInOrder.map((j) => {
                      const isCurrent = j.id === data.id;
                      return (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => {
                            if (!isCurrent) navigate(`/production/jobs/${j.id}`);
                          }}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            isCurrent
                              ? "border-primary bg-primary/5 cursor-default"
                              : "border-border hover:border-primary/50 hover:bg-accent"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant={isProductionJobDone(j.status) ? "default" : "outline"} className="capitalize">
                                  {String(j.status || "").replaceAll("_", " ")}
                                </Badge>
                                <Badge variant="secondary" className="capitalize">
                                  {j.stationKey || "—"}
                                </Badge>
                                <Badge variant="outline" className="capitalize">
                                  {j.stepKey || "—"}
                                </Badge>
                                {isCurrent && (
                                  <Badge variant="outline" className="border-primary text-primary">
                                    Current
                                  </Badge>
                                )}
                              </div>
                              <div className="font-medium mt-1 truncate">{j.jobDescription || "Untitled Job"}</div>
                              <div className="text-sm text-muted-foreground mt-0.5">
                                Qty: {j.qty ?? 0} • Sides: {j.sides || "—"} • Media: {j.media || "—"}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ADD NOTE */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Add Note</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-3">
                <Textarea
                  placeholder="Add a production note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    addNote.mutate(noteText);
                    setNoteText("");
                  }}
                  disabled={isBusy || !noteText.trim()}
                >
                  Add
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </ContentLayout>

      {/* ARTWORK PREVIEW MODAL */}
      <Dialog open={!!previewArtwork} onOpenChange={() => setPreviewArtwork(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewArtwork?.fileName || "Artwork Preview"}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4">
            {previewArtwork && (
              <ProductionThumbnail
                artwork={previewArtwork}
                alt="Artwork preview"
                className="max-h-[70vh] w-auto object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
