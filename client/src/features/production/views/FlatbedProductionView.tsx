import { useMemo, useEffect, useRef, useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { getThumbSrc } from "@/lib/getThumbSrc";
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
  useStartProductionTimer,
  useStopProductionTimer,
} from "@/hooks/useProduction";
import {
  CheckCircle2,
  ChevronsUpDown,
  ExternalLink,
  FileText,
  GripHorizontal,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Square,
  Undo2,
} from "lucide-react";

type ProductionStatus = "queued" | "in_progress" | "done";

const PREVIEW_HEIGHT_KEY = "qvp.production.flatbed.previewHeight";
const PREVIEW_HEIGHT_MIN = 220;
const PREVIEW_HEIGHT_MAX = 560;

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function dueLabel(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
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

function ActionRail({ job }: { job: ProductionJobListItem }) {
  const navigate = useNavigate();
  const start = useStartProductionTimer(job.id);
  const stop = useStopProductionTimer(job.id);
  const complete = useCompleteProductionJob(job.id);
  const reopen = useReopenProductionJob(job.id);
  const reprint = useReprintProductionJob(job.id);
  const addNote = useAddProductionNote(job.id);

  const [tickSeconds, setTickSeconds] = useState(job.timer.currentSeconds);
  const [skipCompleteOpen, setSkipCompleteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    setTickSeconds(job.timer.currentSeconds);
  }, [job.timer.currentSeconds]);

  useEffect(() => {
    if (!job.timer.isRunning) return;
    const t = window.setInterval(() => setTickSeconds((prev) => prev + 1), 1000);
    return () => window.clearInterval(t);
  }, [job.timer.isRunning]);

  const isBusy =
    start.isPending ||
    stop.isPending ||
    complete.isPending ||
    reopen.isPending ||
    reprint.isPending ||
    addNote.isPending;

  const canStartStop = job.status !== "done";

  return (
    <Card className="bg-titan-bg-card border-titan-border-subtle">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-titan-text-primary truncate">Operator</div>
            <div className="text-xs text-titan-text-muted truncate">Actions for selected job</div>
          </div>
          <Badge variant="outline" className="text-titan-text-secondary">
            {job.status.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 space-y-4">
        <div>
          <div className="text-xs text-titan-text-muted">Timer</div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="text-2xl font-mono text-titan-text-primary">{formatSeconds(tickSeconds)}</div>
            {job.timer.isRunning ? (
              <Badge variant="secondary">Running</Badge>
            ) : (
              <Badge variant="outline" className="text-titan-text-secondary">
                Paused
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            variant={job.timer.isRunning ? "secondary" : "default"}
            onClick={() => (job.timer.isRunning ? stop.mutate() : start.mutate())}
            disabled={!canStartStop || isBusy}
          >
            {job.timer.isRunning ? (
              <>
                <Square className="w-4 h-4 mr-2" /> Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" /> Start
              </>
            )}
          </Button>

          {job.status !== "done" ? (
            <>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  if (job.status === "queued") {
                    setSkipCompleteOpen(true);
                    return;
                  }
                  complete.mutate({ skipProduction: false });
                }}
                disabled={isBusy}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Complete
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
                    <AlertDialogAction
                      onClick={() => complete.mutate({ skipProduction: true })}
                    >
                      Skip & Complete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <Button className="w-full" variant="outline" onClick={() => reopen.mutate()} disabled={isBusy}>
              <RotateCcw className="w-4 h-4 mr-2" /> Reopen
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button className="w-full" variant="outline" onClick={() => reprint.mutate()} disabled={isBusy}>
            <Undo2 className="w-4 h-4 mr-2" /> Reprint
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => navigate(ROUTES.production.jobDetail(job.id))}
            disabled={isBusy}
          >
            <FileText className="w-4 h-4 mr-2" /> Details
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            variant="ghost"
            onClick={() => navigate(ROUTES.orders.detail(job.order.id))}
            disabled={isBusy}
          >
            <ExternalLink className="w-4 h-4 mr-2" /> Order
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            onClick={() => navigate(ROUTES.production.board)}
            disabled={isBusy}
          >
            <ChevronsUpDown className="w-4 h-4 mr-2" /> Queue
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-titan-text-primary">Quick note</div>
            <div className="text-xs text-titan-text-muted">Reprints: {job.reprintCount}</div>
          </div>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add operator note…"
            className="min-h-[72px]"
            disabled={isBusy}
          />
          <Button
            className="w-full"
            onClick={() => {
              const text = noteText.trim();
              if (!text) return;
              addNote.mutate(text, {
                onSuccess: () => setNoteText(""),
              });
            }}
            disabled={isBusy || !noteText.trim()}
          >
            <MessageSquarePlus className="w-4 h-4 mr-2" /> Add Note
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewPanel({ job }: { job: ProductionJobListItem }) {
  const li = primaryLineItem(job);
  const thumbs = artworkThumbs(job);

  const due = dueLabel(job.order.dueDate);
  const dims = li ? formatDims(li.width, li.height) : "—";
  const qty = li ? li.quantity : job.order.lineItems?.totalQuantity ?? 0;
  const material = li?.materialName || "—";

  return (
    <Card className="bg-titan-bg-card border-titan-border-subtle">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-titan-text-primary truncate">{job.order.customerName || "—"}</div>
            <div className="text-xs text-titan-text-muted truncate">
              Order {job.order.orderNumber || "—"}
              {due ? ` • Due ${due}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {job.order.priority === "rush" && <Badge variant="destructive">RUSH</Badge>}
            <Badge variant="outline" className="text-titan-text-secondary">
              {job.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <div className="space-y-2">
            <div className="text-xs text-titan-text-muted">Item</div>
            <div className="text-sm font-medium text-titan-text-primary line-clamp-2">
              {li?.description || job.order.lineItems?.items?.[0]?.description || "—"}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-titan-border-subtle p-2">
                <div className="text-titan-text-muted">Qty</div>
                <div className="text-titan-text-primary font-medium">{qty || "—"}</div>
              </div>
              <div className="rounded-md border border-titan-border-subtle p-2">
                <div className="text-titan-text-muted">Size</div>
                <div className="text-titan-text-primary font-medium">{dims}</div>
              </div>
              <div className="rounded-md border border-titan-border-subtle p-2">
                <div className="text-titan-text-muted">Material</div>
                <div className="text-titan-text-primary font-medium truncate">{material}</div>
              </div>
              <div className="rounded-md border border-titan-border-subtle p-2">
                <div className="text-titan-text-muted">Line items</div>
                <div className="text-titan-text-primary font-medium">{job.order.lineItems?.count ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-titan-text-muted">Artwork</div>
            {thumbs.length === 0 ? (
              <div className="rounded-md border border-dashed border-titan-border-subtle p-3 text-xs text-titan-text-muted">
                No artwork thumbnails available.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {thumbs.slice(0, 6).map((a) => {
                  const src = getThumbSrc(a);
                  return (
                    <div
                      key={a.id}
                      className="rounded-md border border-titan-border-subtle bg-titan-bg-muted overflow-hidden"
                      title={a.fileName}
                    >
                      {src ? (
                        <img src={src} alt={a.fileName} className="w-full h-16 object-cover" />
                      ) : (
                        <div className="w-full h-16 flex items-center justify-center text-xs text-titan-text-muted">
                          —
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FlatbedProductionView(props: { viewKey: string; status: ProductionStatus }) {
  const { data, isLoading, error } = useProductionJobs({ status: props.status, view: props.viewKey });

  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [previewHeight, setPreviewHeight] = useState<number>(() => {
    const raw = window.localStorage.getItem(PREVIEW_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 340;
    return Math.min(PREVIEW_HEIGHT_MAX, Math.max(PREVIEW_HEIGHT_MIN, n));
  });

  const dragStateRef = useRef<
    | null
    | {
        startY: number;
        startHeight: number;
      }
  >(null);

  const jobsSafe = data ?? [];

  const filteredSortedJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? jobsSafe.filter((j) => {
          const parts = [
            j.order.orderNumber,
            j.order.customerName,
            j.order.priority,
            j.order.lineItems?.primary?.description,
            j.order.lineItems?.items?.[0]?.description,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return parts.includes(q);
        })
      : jobsSafe;

    return [...base].sort((a, b) => {
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
  }, [jobsSafe, search]);

  useEffect(() => {
    if (filteredSortedJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId && filteredSortedJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(filteredSortedJobs[0].id);
  }, [filteredSortedJobs, selectedJobId]);

  const selectedJob = useMemo(
    () => filteredSortedJobs.find((j) => j.id === selectedJobId) ?? null,
    [filteredSortedJobs, selectedJobId],
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

  const beginDrag = (e: React.MouseEvent) => {
    dragStateRef.current = { startY: e.clientY, startHeight: previewHeight };
    const onMove = (ev: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const delta = ev.clientY - state.startY;
      const next = Math.min(PREVIEW_HEIGHT_MAX, Math.max(PREVIEW_HEIGHT_MIN, state.startHeight + delta));
      setPreviewHeight(next);
      window.localStorage.setItem(PREVIEW_HEIGHT_KEY, String(next));
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Card className="bg-titan-bg-card border-titan-border-subtle">
          <CardContent className="p-4 space-y-3">
            <div className="h-4 w-2/3 bg-titan-bg-muted rounded" />
            <div className="h-9 w-full bg-titan-bg-muted rounded" />
            <div className="h-9 w-full bg-titan-bg-muted rounded" />
            <div className="h-9 w-full bg-titan-bg-muted rounded" />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-4">
              <div className="h-4 w-1/2 bg-titan-bg-muted rounded" />
              <div className="h-3 w-1/3 bg-titan-bg-muted rounded mt-2" />
              <div className="h-28 w-full bg-titan-bg-muted rounded mt-4" />
            </CardContent>
          </Card>
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-4">
              <div className="h-4 w-1/3 bg-titan-bg-muted rounded" />
              <div className="h-40 w-full bg-titan-bg-muted rounded mt-3" />
            </CardContent>
          </Card>
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
        <CardContent className="p-4 text-sm text-titan-text-muted">No jobs in this state.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <div className="space-y-4">
        {selectedJob ? (
          <ActionRail job={selectedJob} />
        ) : (
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-4 text-sm text-titan-text-muted">Select a job to begin.</CardContent>
          </Card>
        )}

        {recentNotes.length > 0 && (
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardHeader className="p-4 pb-2">
              <div className="text-sm font-semibold text-titan-text-primary">Recent notes</div>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-2">
              {recentNotes.map((n) => (
                <div key={n.id} className="rounded-md border border-titan-border-subtle p-2">
                  <div className="text-xs text-titan-text-muted">{new Date(n.createdAt).toLocaleString()}</div>
                  <div className="text-sm text-titan-text-primary whitespace-pre-wrap">{n.text}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <div style={{ height: previewHeight }} className="min-h-0">
          {selectedJob ? <PreviewPanel job={selectedJob} /> : null}
        </div>

        <div
          className="flex items-center justify-center text-titan-text-muted select-none"
          onMouseDown={beginDrag}
          role="separator"
          aria-label="Resize preview"
        >
          <div className="w-full h-7 rounded-md border border-titan-border-subtle bg-titan-bg-card flex items-center justify-center gap-2 cursor-row-resize">
            <GripHorizontal className="w-4 h-4" />
            <span className="text-xs">Drag to resize preview</span>
          </div>
        </div>

        <Card className="bg-titan-bg-card border-titan-border-subtle">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-titan-text-primary">Queue</div>
                <div className="text-xs text-titan-text-muted">{filteredSortedJobs.length} jobs</div>
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order/customer…"
                className="max-w-[260px]"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Reprints</TableHead>
                  <TableHead className="text-right">Timer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSortedJobs.map((job) => {
                  const li = primaryLineItem(job);
                  const selected = job.id === selectedJobId;
                  return (
                    <TableRow
                      key={job.id}
                      className={selected ? "bg-titan-bg-muted" : undefined}
                      onClick={() => setSelectedJobId(job.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <TableCell className="font-medium">{job.order.orderNumber || "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{job.order.customerName || "—"}</TableCell>
                      <TableCell>{dueLabel(job.order.dueDate) || "—"}</TableCell>
                      <TableCell>
                        {job.order.priority === "rush" ? (
                          <Badge variant="destructive">RUSH</Badge>
                        ) : (
                          <Badge variant="outline" className="text-titan-text-secondary">
                            {job.order.priority || "—"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate">
                        {li?.description || job.order.lineItems?.items?.[0]?.description || "—"}
                      </TableCell>
                      <TableCell className="text-right">{li?.quantity ?? job.order.lineItems?.totalQuantity ?? "—"}</TableCell>
                      <TableCell>{li ? formatDims(li.width, li.height) : "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{li?.materialName || "—"}</TableCell>
                      <TableCell className="text-right">{job.reprintCount}</TableCell>
                      <TableCell className="text-right font-mono">{formatSeconds(job.timer.currentSeconds)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {selectedJob && (
          <div className="text-xs text-titan-text-muted">
            Tip: open job details for full timeline.
          </div>
        )}
      </div>
    </div>
  );
}
