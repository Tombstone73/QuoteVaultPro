import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, ChevronRight, CircleSlash, Clock, Pause, Play, Printer, RotateCcw, StickyNote, Trash2, Undo2, CheckCircle2, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import {
  completedToday,
  machineCenters,
  stationStatus,
  weekDays,
  workCenters,
  jobArt,
  jobSides,
  jobSpec,
  type ArtKind,
  type ArtTile,
  type ProdJob,
  type Priority,
  type WorkCenter,
} from "@/lib/mock/production";

function SidesBadge({ job, className }: { job: ProdJob; className?: string }) {
  const sides = jobSides(job);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-semibold leading-none",
        sides === 2 ? "border-info/40 bg-info/10 text-info" : "border-border text-muted-foreground",
        className,
      )}
      title={sides === 2 ? "Double-sided" : "Single-sided"}
    >
      {sides === 2 ? "2S" : "1S"}
    </span>
  );
}

interface ViewerItem extends ArtTile { kind: ArtKind }

function ArtTileCard({ tile, emphasis, onOpen }: { tile: ArtTile; emphasis?: boolean | undefined; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${tile.file}`}
      className={cn(
        "flex w-[168px] flex-col gap-1 rounded border p-1.5 text-left transition hover:border-primary hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        emphasis ? "border-primary/60 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : "border-border bg-surface-2/60",
      )}
    >
      <Thumb label={tile.file} className="h-[118px] w-full rounded-sm text-[12px]" />
      <div className="flex items-center justify-between gap-1">
        <span className="text-[13px] font-bold uppercase tracking-wide">{tile.side}</span>
        {tile.ready && (
          <span className="rounded border border-ok/40 bg-ok/10 px-1 text-[10px] font-semibold leading-[1.5] text-ok">RIP</span>
        )}
      </div>
      <div className="num truncate text-[11px] text-muted-foreground" title={tile.file}>{tile.file}</div>
    </button>
  );
}

function ArtGroup({
  label, tiles, kind, emphasis, onOpen,
}: { label: string; tiles: ArtTile[]; kind: ArtKind; emphasis?: boolean | undefined; onOpen: (kind: ArtKind, side: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="mb-1">
        <span className={cn("text-[12px] font-bold uppercase tracking-wide", emphasis ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tiles.map((t) => (
          <ArtTileCard key={label + t.side} tile={t} emphasis={emphasis} onOpen={() => onOpen(kind, t.side)} />
        ))}
      </div>
    </div>
  );
}

function ArtViewer({
  items, index, onIndex, onClose,
}: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const cur = items[index];
  if (!cur) return null;
  const sameKind = items.filter((i) => i.kind === cur.kind);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[min(1100px,95vw)] gap-2 p-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[18px]">
            <span>{cur.kind === "production" ? "Production art" : "Line item art"}</span>
            <span className="rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[14px] font-bold uppercase tracking-wide text-primary">{cur.side}</span>
            {cur.ready && <span className="rounded border border-ok/40 bg-ok/10 px-1.5 text-[12px] font-semibold text-ok">Production ready</span>}
          </DialogTitle>
          <div className="num truncate text-[13px] text-muted-foreground">{cur.file}</div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded border border-border bg-surface-2/50 p-3">
          <div className="mx-auto transition-transform" style={{ width: `${Math.round(560 * zoom)}px`, maxWidth: "100%" }}>
            <Thumb label={cur.file} className="aspect-[4/3] h-auto w-full rounded text-[14px]" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {sameKind.length > 1 && sameKind.map((t) => (
              <Button
                key={t.kind + t.side}
                size="sm"
                variant={t === cur ? "default" : "outline"}
                className="h-9 min-w-[74px] text-[13px]"
                onClick={() => onIndex(items.indexOf(t))}
              >
                {t.side}
              </Button>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            {items.filter((i) => i.kind !== cur.kind).slice(0, 1).map((t) => (
              <Button key="switch" size="sm" variant="ghost" className="h-9 text-[13px]" onClick={() => onIndex(items.indexOf(t))}>
                {t.kind === "production" ? "View production art" : "View line item art"}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-9 w-9 p-0 text-[16px]" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</Button>
            <span className="num w-12 text-center text-[13px]">{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="outline" className="h-9 w-9 p-0 text-[16px]" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</Button>
            <Button size="sm" variant="secondary" className="h-9 text-[13px]" onClick={() => setZoom(1)}>Fit</Button>
            <Button size="sm" className="h-9 px-4 text-[13px]" onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JobArtwork({ job }: { job: ProdJob }) {
  const line = jobArt(job, "line");
  const prod = jobArt(job, "production");
  const items: ViewerItem[] = useMemo(
    () => [...line.map((t) => ({ ...t, kind: "line" as ArtKind })), ...prod.map((t) => ({ ...t, kind: "production" as ArtKind }))],
    [line, prod],
  );
  const [open, setOpen] = useState<number | null>(null);
  const openTile = (kind: ArtKind, side: string) => {
    const i = items.findIndex((t) => t.kind === kind && t.side === side);
    setOpen(i < 0 ? 0 : i);
  };
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded border border-border bg-card/40 px-3 py-2.5">
      <ArtGroup label="Line item art" tiles={line} kind="line" onOpen={openTile} />
      <div className="hidden self-stretch border-l border-border sm:block" />
      <ArtGroup label="Production art" tiles={prod} kind="production" emphasis onOpen={openTile} />
      {open !== null && <ArtViewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}




export function PriorityPill({ value }: { value: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-semibold uppercase leading-none",
        value === "Rush" && "border-late/40 bg-late/10 text-late",
        value === "Standard" && "border-border text-muted-foreground",
        value === "Low" && "border-info/40 bg-info/10 text-info",
      )}
    >
      {value === "Rush" && <Flag className="size-2.5" />}
      {value}
    </span>
  );
}

function DueText({ job }: { job: ProdJob }) {
  return (
    <span className={cn("num", job.dueTone === "late" && "text-late", job.dueTone === "warn" && "text-warn", job.dueTone === "neutral" && "text-muted-foreground")}>
      {job.due}
    </span>
  );
}

/* ------------------------------- BOARD ---------------------------------- */

export function ProductionBoard({ jobs }: { jobs: ProdJob[] }) {
  const [assign, setAssign] = useState<Record<string, WorkCenter>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<WorkCenter | null>(null);

  const stationOf = (j: ProdJob) => assign[j.id] ?? j.station;

  const drop = (station: WorkCenter) => {
    if (dragId) setAssign((a) => ({ ...a, [dragId]: station }));
    setDragId(null);
    setOver(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        Columns are production work centers inside the Production step. Moving a card reassigns the machine — it does not change the job's business route stage.
      </p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {workCenters.map((station) => {
          const col = jobs.filter((j) => stationOf(j) === station);
          return (
            <div
              key={station}
              onDragOver={(e) => { e.preventDefault(); setOver(station); }}
              onDragLeave={() => setOver((o) => (o === station ? null : o))}
              onDrop={() => drop(station)}
              className={cn(
                "flex w-[260px] shrink-0 flex-col rounded-md border border-border bg-surface-1/40",
                over === station && "border-primary bg-primary/5",
              )}
            >
              <header className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
                <span className="text-[12px] font-semibold">{station}</span>
                <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">{col.length}</span>
              </header>
              <div className="flex-1 space-y-1.5 p-1.5">
                {col.map((j) => (
                  <article
                    key={j.id}
                    draggable
                    onDragStart={() => setDragId(j.id)}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    className={cn(
                      "cursor-grab rounded border border-border bg-card px-2 py-1.5 active:cursor-grabbing hover:border-primary/50",
                      dragId === j.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Thumb label={j.item} className="size-7" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="num text-[12px] font-semibold text-primary">#{j.orderNumber}</span>
                          <PriorityPill value={j.priority} />
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{j.customer}</div>
                        <div className="truncate text-[12px]">{j.item}</div>
                        <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
                          <span className="num text-muted-foreground">Qty {j.qty}</span>
                          <DueText job={j} />
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <Status value={j.routeStep} className="text-[10px]" />
                          {j.warning && (
                            <span className="inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1 py-0.5 text-[10px] text-warn">
                              <AlertTriangle className="size-2.5" />
                              {j.warning}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {col.length === 0 && <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">Drop jobs here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ CALENDAR -------------------------------- */

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];

export function ProductionCalendar({ jobs }: { jobs: ProdJob[] }) {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [day, setDay] = useState(0);
  const scheduled = jobs.filter((j) => j.day !== undefined && j.station !== "Unassigned");
  const unscheduled = jobs.filter((j) => j.day === undefined || j.station === "Unassigned");

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Panel
        title={mode === "week" ? "Week of Aug 17, 2026" : weekDays[day]}
        dense
        action={
          <div className="flex items-center gap-1">
            {mode === "day" && (
              <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px]">
                {weekDays.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
            <ViewToggle
              value={mode}
              onChange={(v) => setMode(v as "day" | "week")}
              options={[{ key: "day", label: "Day" }, { key: "week", label: "Week" }]}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          {mode === "week" ? (
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <th className={th + " w-[130px]"}>Station</th>
                  {weekDays.map((d) => <th key={d} className={th}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {machineCenters.map((s) => (
                  <tr key={s} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-[12px] font-medium">{s}</td>
                    {weekDays.map((_, di) => (
                      <td key={di} className="border-l border-border px-1.5 py-1.5">
                        <div className="space-y-1">
                          {scheduled.filter((j) => j.station === s && j.day === di).map((j) => <SlotCard key={j.id} job={j} />)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <th className={th + " w-[130px]"}>Station</th>
                  {HOURS.map((h) => <th key={h} className={th + " text-center"}>{h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}</th>)}
                </tr>
              </thead>
              <tbody>
                {machineCenters.map((s) => (
                  <tr key={s} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-[12px] font-medium">{s}</td>
                    {HOURS.map((h) => (
                      <td key={h} className="border-l border-border px-1 py-1">
                        <div className="space-y-1">
                          {scheduled.filter((j) => j.station === s && j.day === day && j.startHour === h).map((j) => <SlotCard key={j.id} job={j} compact />)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Durations are mocked estimates for layout evaluation — no machine-time calculation is implied.
        </p>
      </Panel>

      <Panel title={`Unscheduled jobs (${unscheduled.length})`} dense>
        <div className="max-h-[560px] space-y-1.5 overflow-y-auto p-1.5">
          {unscheduled.map((j) => (
            <div key={j.id} className="rounded border border-border bg-card px-2 py-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="num text-[12px] font-semibold text-primary">#{j.orderNumber}</span>
                <PriorityPill value={j.priority} />
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{j.customer}</div>
              <div className="truncate text-[12px]">{j.item}</div>
              <div className="mt-0.5 flex justify-between text-[11px]">
                <span className="num text-muted-foreground">Qty {j.qty} · ~{j.estHours}h</span>
                <DueText job={j} />
              </div>
            </div>
          ))}
          {unscheduled.length === 0 && <EmptyState title="Everything is scheduled" />}
        </div>
      </Panel>
    </div>
  );
}

function SlotCard({ job, compact }: { job: ProdJob; compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded border px-1.5 py-1 text-[11px]",
        job.blocked ? "border-late/40 bg-late/10" : job.priority === "Rush" ? "border-warn/40 bg-warn/10" : "border-border bg-surface-2",
      )}
      title={`${job.item} — ${job.customer}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="num font-semibold">#{job.orderNumber}</span>
        <span className="num text-muted-foreground">~{job.estHours}h</span>
      </div>
      {!compact && <div className="truncate text-muted-foreground">{job.item}</div>}
    </div>
  );
}

/* ------------------------------ STATIONS -------------------------------- */

export function StationsGrid({ jobs, onOpen }: { jobs: ProdJob[]; onOpen: (s: string) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {machineCenters.map((s) => {
        const mine = jobs.filter((j) => j.station === s);
        const active = mine.find((j) => /print|run|lamin|hem/i.test(j.status)) ?? mine[0];
        const next = [...mine].sort((a, b) => a.due.localeCompare(b.due))[0];
        const meta = stationStatus[s];
        const hours = mine.reduce((sum, j) => sum + j.estHours, 0);
        return (
          <button key={s} type="button" onClick={() => onOpen(s)} className="panel p-3 text-left transition hover:border-primary/60">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">{s}</h3>
              <Status value={meta?.status === "Running" ? "In Progress" : meta?.status === "Idle" ? "Queued" : "On Hold"} />
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Active job</div>
            <div className="truncate text-[12px]">{active ? `#${active.orderNumber} · ${active.item}` : "Idle — no active job"}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-[11px]">
              <div><div className="text-muted-foreground">Queued</div><div className="num text-[13px] font-semibold">{mine.length}</div></div>
              <div><div className="text-muted-foreground">Est. load</div><div className="num text-[13px] font-semibold">{hours.toFixed(1)}h</div></div>
              <div><div className="text-muted-foreground">Operator</div><div className="truncate text-[12px]">{meta?.operator ?? "—"}</div></div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" /> Next due: {next ? `#${next.orderNumber} — ${next.due}` : "—"}
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-primary">Open station <ChevronRight className="size-3" /></div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------- OPERATOR ACTION RAIL -------------------------- */

type RailTone = "neutral" | "go" | "warn" | "danger" | "flow";

const railTone: Record<RailTone, string> = {
  neutral: "border-border bg-surface-2 text-foreground hover:border-primary/60",
  go: "border-ok/50 bg-ok/15 text-ok hover:bg-ok/25",
  warn: "border-warn/50 bg-warn/15 text-warn hover:bg-warn/25",
  danger: "border-late/50 bg-late/15 text-late hover:bg-late/25",
  flow: "border-info/50 bg-info/10 text-info hover:bg-info/20",
};

function RailButton({
  icon: Icon, label, tone = "neutral", disabled, hint,
}: { icon: typeof Play; label: string; tone?: RailTone; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex min-h-[54px] w-full items-center gap-2.5 rounded-md border px-3 text-left text-[13px] font-semibold uppercase tracking-wide transition",
        railTone[tone],
        disabled && "cursor-not-allowed opacity-40 hover:border-border",
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block leading-tight">{label}</span>
        {hint && <span className="block text-[10px] font-normal normal-case text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

function ActionRail({ running, status }: { running: boolean; status: string }) {
  const isRunning = /print|run|lamin|hem/i.test(status);
  return (
    <aside className="lg:sticky lg:top-3 lg:self-start">
      <div className="space-y-1.5 rounded-md border border-border bg-surface-1/60 p-2">
        <RailButton icon={Printer} label="Print ticket" />
        <div className="h-px bg-border" />
        <RailButton icon={Play} label="Start" tone="go" disabled={!running || isRunning} />
        <RailButton icon={Pause} label="Pause" tone="warn" disabled={!running || !isRunning} />
        <RailButton icon={CheckCircle2} label="Complete" tone="go" disabled={!running} />
        <div className="h-px bg-border" />
        <RailButton icon={RotateCcw} label="Reprint" tone="warn" disabled={!running} />
        <RailButton icon={Trash2} label="Log waste" tone="danger" disabled={!running} />
        <RailButton icon={Undo2} label="Return to prepress" tone="flow" hint="Reason required" disabled={!running} />
        <div className="h-px bg-border" />
        <RailButton icon={StickyNote} label="Add production note" />
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Status: {running ? status : "Idle"}
      </p>
    </aside>
  );
}

/* --------------------------- STATION DETAIL ------------------------------ */

export function StationDetail({ station, jobs, onBack }: { station: string; jobs: ProdJob[]; onBack: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const mine = useMemo(() => jobs.filter((j) => j.station === station), [jobs, station]);
  const running = mine.find((j) => /print|run|lamin|hem/i.test(j.status) && !j.blocked) ?? mine.find((j) => !j.blocked);
  const blocked = mine.filter((j) => j.blocked);
  const queue = mine.filter((j) => j !== running && !j.blocked);
  const done = completedToday.filter((j) => j.station === station);

  const spec = running ? jobSpec(running) : null;
  const sides = running ? jobSides(running) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={onBack}>← All stations</Button>
        <h2 className="text-[15px] font-semibold">{station}</h2>
        <Status value={stationStatus[station]?.status === "Running" ? "In Progress" : "Queued"} />
        <span className="text-[12px] text-muted-foreground">Operator: {stationStatus[station]?.operator ?? "—"}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[214px_minmax(0,1fr)]">
        <ActionRail running={!!running} status={running?.status ?? "Idle"} />

        <div className="space-y-3">
          <Panel title="Currently running" dense>
            {running && spec ? (
              <div className="space-y-2.5 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="min-w-[280px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to="/sales/$id" params={{ id: running.orderNumber }} className="num text-[30px] font-bold leading-none text-primary hover:underline">#{running.orderNumber}</Link>
                      <span className="text-[22px] font-semibold leading-tight">· {running.customer}</span>
                      <PriorityPill value={running.priority} />
                      <Status value={running.routeStep} />
                    </div>
                    <div className="mt-1.5 text-[17px] font-medium leading-snug">
                      {running.item}
                      {!/[\u2033"]/.test(running.item) && <span className="num text-muted-foreground"> · {spec.size}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[16px] font-semibold">
                      <span className="num">Qty {running.qty}</span>
                      <span className="text-muted-foreground">·</span>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[14px] font-bold uppercase tracking-wide",
                          sides === 2 ? "border-info/50 bg-info/10 text-info" : "border-border text-muted-foreground",
                        )}
                      >
                        {sides === 2 ? "Double sided" : "Single sided"}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className={cn("num", running.dueTone === "late" && "text-late", running.dueTone === "warn" && "text-warn")}>Due {running.due}</span>
                    </div>
                  </div>

                  <dl className="grid min-w-[320px] grid-cols-2 gap-x-7 gap-y-1.5">
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Media</dt><dd className="text-[17px] font-semibold leading-tight">{spec.media}</dd></div>
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Machine</dt><dd className="text-[17px] font-semibold leading-tight">{station}</dd></div>
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Lamination</dt><dd className="text-[17px] font-semibold leading-tight">{spec.lamination}</dd></div>
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Finishing</dt><dd className="text-[17px] font-semibold leading-tight">{spec.finishing}</dd></div>
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Est. run time</dt><dd className="num text-[17px] font-semibold leading-tight">~{running.estHours}h</dd></div>
                    <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Status</dt><dd className="text-[17px] font-semibold leading-tight">{running.status}</dd></div>
                  </dl>
                </div>

                <div className="rounded border border-warn/30 bg-warn/5 px-2 py-1.5 text-[13px]">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-warn">Production notes</span>
                  <div>{spec.notes}</div>
                </div>

                <JobArtwork job={running} />
              </div>
            ) : (
              <EmptyState title="No job running" hint="Pull the next job from the queue below." />
            )}
          </Panel>


      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={`Next up (${queue.length})`} dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Order</th><th className={th}>Item</th><th className={th + " text-right"}>Qty</th><th className={th}>Due</th><th className={th}>Priority</th></tr></thead>
            <tbody>
              {queue.map((j) => (
                <tr key={j.id} className="row-h border-t border-border hover:bg-accent/60">
                  <td className={td}><Link to="/sales/$id" params={{ id: j.orderNumber }} className="num text-primary hover:underline">#{j.orderNumber}</Link></td>
                  <td className={td}><div className="flex items-center gap-2"><Thumb label={j.item} className="size-6" /><span className="truncate">{j.item}</span><SidesBadge job={j} className="shrink-0" /></div></td>
                  <td className={td + " num text-right"}>{j.qty}</td>
                  <td className={td}><DueText job={j} /></td>
                  <td className={td}><PriorityPill value={j.priority} /></td>
                </tr>
              ))}
              {queue.length === 0 && <tr><td className={td + " py-4 text-muted-foreground"} colSpan={5}>Queue is clear.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title={`Waiting / blocked (${blocked.length})`} dense>
          <ul className="divide-y divide-border">
            {blocked.map((j) => (
              <li key={j.id} className="flex items-start gap-2 px-3 py-2">
                <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-late" />
                <div className="min-w-0">
                  <div className="num text-[12px] font-semibold text-primary">#{j.orderNumber}</div>
                  <div className="truncate text-[12px]">{j.item}</div>
                  <div className="text-[11px] text-late">{j.blocked}</div>
                </div>
              </li>
            ))}
            {blocked.length === 0 && <li className="px-3 py-3 text-[12px] text-muted-foreground">Nothing blocked at this station.</li>}
          </ul>
        </Panel>
      </div>

      <Panel
        title={`Completed today (${done.length})`}
        dense
        action={<Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setShowDone((s) => !s)}>{showDone ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{showDone ? "Hide" : "Show"}</Button>}
      >
        {showDone && (
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Order</th><th className={th}>Item</th><th className={th + " text-right"}>Qty</th><th className={th}>Finished</th></tr></thead>
            <tbody>
              {done.map((j) => (
                <tr key={j.id} className="row-h border-t border-border">
                  <td className={td + " num text-primary"}>#{j.orderNumber}</td>
                  <td className={td}>{j.item}</td>
                  <td className={td + " num text-right"}>{j.qty}</td>
                  <td className={td + " num text-muted-foreground"}>{j.completedAt}</td>
                </tr>
              ))}
              {done.length === 0 && <tr><td className={td + " py-3 text-muted-foreground"} colSpan={4}>Nothing completed yet today.</td></tr>}
            </tbody>
          </table>
        )}
      </Panel>
        </div>
      </div>
    </div>

  );
}

/* ------------------------------ TOGGLE ---------------------------------- */

export function ViewToggle({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { key: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded px-2.5 py-1 text-[12px] font-medium transition",
            value === o.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
