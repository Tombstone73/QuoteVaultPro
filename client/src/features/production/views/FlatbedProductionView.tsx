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
  useSetProductionMediaUsed,
  useStartProductionTimer,
  useStopProductionTimer,
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
} from "lucide-react";

type ProductionStatus = "queued" | "in_progress" | "done";

type DueUrgency = "overdue" | "today" | "soon" | "normal";

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

function PreviewPanel({
  job,
  timerSeconds,
  timerIsRunning,
  notes,
}: {
  job: ProductionJobListItem;
  timerSeconds: number | null;
  timerIsRunning: boolean;
  notes: Array<{ id: string; text: string; createdAt: string }>;
}) {
  const li = primaryLineItem(job);
  const thumbs = artworkThumbs(job);
  const { front, back } = useMemo(() => pickArtworkForPreview(thumbs), [thumbs]);
  const frontSrc = front ? getThumbSrc(front) : null;
  const backSrc = back ? getThumbSrc(back) : null;

  const due = dueMeta(job.order.dueDate);
  const dims = li ? formatDimsMock(li.width, li.height) : "—";
  const qty = li ? li.quantity : job.order.lineItems?.totalQuantity ?? null;
  const material = li?.materialName || "—";
  const thicknessRaw = li ? (li as any).thickness ?? (li as any).thicknessMm ?? null : null;
  const thickness = typeof thicknessRaw === "string" || typeof thicknessRaw === "number" ? String(thicknessRaw).trim() : "";
  const media = material !== "—" ? `${material}${thickness ? ` ${thickness}` : ""}` : "—";
  const sidesCount = typeof job.order.sides === "number" ? job.order.sides : null;
  const sidesLabelHuman = sidesCount === 1 ? "Single-Sided" : sidesCount === 2 ? "Double-Sided" : "—";

  const packaging =
    (typeof job.order.fulfillmentStatus === "string" && job.order.fulfillmentStatus.trim())
      ? job.order.fulfillmentStatus
      : "—";

  const jobRefParts = [
    job.lineItemId ? `Job ${String(job.lineItemId).slice(-6)}` : null,
    job.id ? `ID ${String(job.id).slice(-6)}` : null,
  ].filter(Boolean);
  const jobRef = jobRefParts.length ? jobRefParts.join(" • ") : "—";

  const noteText = (notes[0]?.text || "").trim() || "—";

  return (
    <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr_360px] gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="rounded-md border border-titan-border-subtle bg-titan-bg-muted overflow-hidden aspect-[4/3] flex items-center justify-center">
              {frontSrc ? (
                <img src={frontSrc} alt={front?.fileName || "Front"} className="w-full h-full object-contain" />
              ) : (
                <div className="text-2xl font-semibold text-titan-text-muted">—</div>
              )}
            </div>
            <div className="text-xs text-titan-text-muted text-center">FRONT</div>
          </div>

          <div className="space-y-2">
            <div className="rounded-md border border-titan-border-subtle bg-titan-bg-muted overflow-hidden aspect-[4/3] flex items-center justify-center">
              {backSrc ? (
                <img src={backSrc} alt={back?.fileName || "Back"} className="w-full h-full object-contain" />
              ) : (
                <div className="text-2xl font-semibold text-titan-text-muted">—</div>
              )}
            </div>
            <div className="text-xs text-titan-text-muted text-center">BACK</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-titan-text-primary truncate">{job.order.customerName || "—"}</div>
              <div className="text-xs text-titan-text-muted truncate">{jobRef}</div>
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
            <Fact label="Sides" value={sidesLabelHuman} />
          </div>

          <div className="space-y-3">
            <Fact label="Size" value={dims} />
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
        <CardContent className="p-4 text-sm text-titan-text-muted">No jobs in this state.</CardContent>
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
          />
        ) : null}

        <div>
          <div className="text-sm font-semibold text-titan-text-primary">JOB QUEUE</div>
          <div className="mt-2 rounded-lg border border-titan-border-subtle bg-titan-bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CLIENT</TableHead>
                  <TableHead className="w-[120px]">ART</TableHead>
                  <TableHead className="w-[200px]">DUE DATE</TableHead>
                  <TableHead className="text-right w-[120px]">QTY</TableHead>
                  <TableHead className="text-right w-[120px]">SIDES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedJobs.map((job) => {
                  const selected = job.id === selectedJobId;
                  const li = primaryLineItem(job);
                  const qty = li?.quantity ?? job.order.lineItems?.totalQuantity ?? null;
                  const due = dueMeta(job.order.dueDate);
                  const sidesCount = typeof job.order.sides === "number" ? job.order.sides : null;

                  const thumbs = artworkThumbs(job);
                  const sidesInArtwork = new Set<string>();
                  for (const a of thumbs) {
                    const s = normalizeSide(a.side);
                    if (s === "front" || s === "back") sidesInArtwork.add(s);
                  }
                  const hasFront = sidesInArtwork.has("front");
                  const hasBack = sidesInArtwork.has("back");

                  const showSingle = sidesCount === 1 || (!hasBack && hasFront);

                  return (
                    <TableRow
                      key={job.id}
                      className={selected ? "bg-titan-bg-muted" : "hover:bg-titan-bg-muted/40"}
                      onClick={() => setSelectedJobId(job.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <TableCell className="py-5 text-sm font-semibold">{job.order.customerName || "—"}</TableCell>
                      <TableCell className="py-5">
                        <div className="flex items-center gap-2">
                          {showSingle ? (
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-blue-600 text-white text-xs font-semibold">S</span>
                          ) : (
                            <>
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-white text-xs font-semibold ${
                                  hasFront ? "bg-rose-500" : "bg-titan-bg-muted border border-titan-border-subtle text-titan-text-muted"
                                }`}
                              >
                                F
                              </span>
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-white text-xs font-semibold ${
                                  hasBack ? "bg-teal-500" : "bg-titan-bg-muted border border-titan-border-subtle text-titan-text-muted"
                                }`}
                              >
                                B
                              </span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`py-5 text-sm font-semibold ${due ? dueClass(due.urgency) : "text-titan-text-primary"}`}>
                        {due ? `${due.dateLabel} ${due.displaySuffix}` : "—"}
                      </TableCell>
                      <TableCell className="py-5 text-sm text-right font-semibold">{Number.isFinite(Number(qty)) ? Number(qty) : "—"}</TableCell>
                      <TableCell className="py-5 text-sm text-right font-semibold">
                        {typeof sidesCount === "number" && Number.isFinite(sidesCount) ? sidesCount : "—"}
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
    </div>
  );
}
