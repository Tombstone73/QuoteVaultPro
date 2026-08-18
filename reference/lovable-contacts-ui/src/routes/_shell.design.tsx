import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle, ChevronDown, Clock, Download, Maximize2, MessageSquarePlus, Pause,
  Play, Pencil, Search, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Status, Thumb } from "@/components/app/primitives";
import { ArtworkViewerPanel, useViewerHeight } from "@/components/app/resizable-viewer";
import { AggregateChip, LineRow, OrderGroup, QueueToolbarToggles } from "@/components/app/order-queue";
import { RailSection, TimeCorrectionDialog } from "@/components/app/rail-section";
import {
  designJobs, designSidesOf, fmtClock, fmtMinutes, groupDesignByOrder, nextAction,
  type DesignFile, type DesignJob, type DesignNote, type DesignSide, type DesignUnread,
  type TimeCorrection,
} from "@/lib/mock/design";

const CURRENT_USER = "Dale";

type RailKey = "feedback" | "versions" | "notes" | "activity" | "cost";

export const Route = createFileRoute("/_shell/design")({
  head: () => ({
    meta: [
      { title: "Design Workstation — PrintersHero V2" },
      { name: "description", content: "Designer workstation: design queue, customer brief, working files, versions, revision requests and route-aware next action." },
      { property: "og:title", content: "Design Workstation — PrintersHero V2" },
      { property: "og:description", content: "Create and revise customer-facing artwork before proofing and prepress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DesignPage,
});

/* ------------------------------------------------------------------ shared */

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded border border-border bg-surface-2/30 p-2.5", className)}>{children}</section>;
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[12.5px] font-medium">{value}</div>
    </div>
  );
}

function ViewerControls({
  zoom, setZoom, onFullscreen, fullscreenLabel,
}: { zoom: number; setZoom: (z: number) => void; onFullscreen: () => void; fullscreenLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-[15px]" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.25, +(zoom - 0.25).toFixed(2)))}>−</Button>
      <span className="num w-11 text-center text-[12px]">{Math.round(zoom * 100)}%</span>
      <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-[15px]" aria-label="Zoom in" onClick={() => setZoom(Math.min(4, +(zoom + 0.25).toFixed(2)))}>+</Button>
      <Button size="sm" variant="secondary" className="h-8 text-[12px]" onClick={() => setZoom(1)}>Fit</Button>
      <Button size="sm" variant="secondary" className="h-8 text-[12px]" onClick={() => setZoom(1)}>100%</Button>
      <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={onFullscreen}>
        <Maximize2 className="mr-1 size-3.5" />{fullscreenLabel}
      </Button>
    </div>
  );
}

function Stage({ file, zoom, label }: { file: DesignFile | null; zoom: number; label?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-border bg-surface-2/40 p-3">
      {file ? (
        <div className="mx-auto flex min-h-full items-center justify-center">
          <div style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? "100%" : undefined }}>
            <Thumb label={label ?? file.name} className="aspect-[4/3] h-auto w-full rounded text-[14px]" />
          </div>
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center text-[12px] text-muted-foreground">
          No design version yet — upload the first working file.
        </div>
      )}
    </div>
  );
}

function FileCard({
  file, active, badge, onClick,
}: { file: DesignFile; active?: boolean; badge?: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-[136px] shrink-0 flex-col gap-1 rounded border p-1.5 text-left transition",
        active ? "border-primary bg-primary/10" : "border-border bg-surface-2/40 hover:border-primary/50",
      )}
    >
      <Thumb label={file.name} className="h-16 w-full rounded text-[11px]" />
      <div className="flex items-center gap-1">
        <span className="truncate text-[11.5px] font-semibold">{file.version ?? file.type}</span>
        {badge}
      </div>
      <span className="num truncate text-[10.5px] text-muted-foreground" title={file.name}>{file.name}</span>
      <span className="truncate text-[10px] text-muted-foreground">{file.meta}</span>
    </button>
  );
}

/* -------------------------------------------------------------------- page */

function DesignPage() {
  const groups = useMemo(() => groupDesignByOrder(designJobs), []);
  const [q, setQ] = useState("");
  const [openOrders, setOpenOrders] = useState<Record<string, boolean>>({ [groups[0]!.order]: true });
  const [selectedId, setSelectedId] = useState(designJobs[0]!.id);
  const job = useMemo(() => designJobs.find((j) => j.id === selectedId)!, [selectedId]);

  const [viewSide, setViewSide] = useState<DesignSide>("Single");
  const [viewFileId, setViewFileId] = useState<string | null>(job.currentVersionId ?? null);
  const [zoom, setZoom] = useState(1);
  const { height: viewerHeight, setHeight: setViewerHeight, collapsed: viewerCollapsed, setCollapsed: setViewerCollapsed } = useViewerHeight();
  const [fullscreen, setFullscreen] = useState(false);
  const [currentVersionId, setCurrentVersionId] = useState(job.currentVersionId ?? null);
  const [costOpen, setCostOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [notes, setNotes] = useState<DesignNote[]>(job.notes);
  const uploadRef = useRef<HTMLInputElement>(null);

  // per-user unread state (prototype: seeded from mock, cleared on view for this user)
  const [unreadByJob, setUnreadByJob] = useState<Record<string, DesignUnread>>(() =>
    Object.fromEntries(designJobs.map((j) => [j.id, { ...(j.unread?.[CURRENT_USER] ?? {}) }])),
  );
  const unread = unreadByJob[selectedId] ?? {};
  const [open, setOpen] = useState<Record<RailKey, boolean>>({
    feedback: false, versions: false, notes: false, activity: false, cost: false,
  });
  const toggle = (key: RailKey, next: boolean) => {
    setOpen((o) => ({ ...o, [key]: next }));
    if (next) setUnreadByJob((u) => ({ ...u, [selectedId]: { ...(u[selectedId] ?? {}), [key]: 0 } }));
  };

  // time corrections
  const [correctionsByJob, setCorrectionsByJob] = useState<Record<string, TimeCorrection[]>>({});
  const corrections = correctionsByJob[selectedId] ?? [];
  const correctionTotal = corrections.reduce((n, c) => n + c.deltaMinutes, 0);
  const trackedMinutes = Math.max(0, job.timer.trackedMinutes + correctionTotal);
  const [timeDlg, setTimeDlg] = useState(false);

  // timer
  const [secs, setSecs] = useState(job.timer.runningSeconds);
  const [running, setRunning] = useState(job.timer.running);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    const sides = designSidesOf(job);
    setViewSide(sides[0]!);
    setViewFileId(job.currentVersionId ?? job.versions[0]?.id ?? job.sources[0]?.id ?? null);
    setCurrentVersionId(job.currentVersionId ?? null);
    setZoom(1);
    setNotes(job.notes);
    setSecs(job.timer.runningSeconds);
    setRunning(job.timer.running);
    // returned-for-revision jobs auto-open unviewed feedback once; never old, already-read feedback
    const hasNewFeedback = (unreadByJob[job.id]?.feedback ?? 0) > 0;
    const returned = job.status === "Revision Requested" || job.status === "In Design";
    const autoOpen = hasNewFeedback && returned && job.revisions.length > 0;
    setOpen({ feedback: autoOpen, versions: false, notes: false, activity: false, cost: false });
    if (autoOpen) setUnreadByJob((u) => ({ ...u, [job.id]: { ...(u[job.id] ?? {}), feedback: 0 } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return groups;
    return groups
      .map((g) => ({ ...g, jobs: g.jobs.filter((j) => `${g.order} ${g.customer} ${j.item}`.toLowerCase().includes(t)) }))
      .filter((g) => g.jobs.length > 0);
  }, [groups, q]);

  const allFiles = [...job.versions, ...job.sources];
  const viewFile = allFiles.find((f) => f.id === viewFileId) ?? null;
  const sides = designSidesOf(job);
  const next = nextAction(job);
  const latestRevision = job.revisions[0];
  const showBanner = job.status === "Blocked" || job.status === "Revision Requested";

  const addNote = () => {
    if (!noteDraft.trim()) return;
    setNotes((n) => [{ id: `local-${Date.now()}`, body: noteDraft.trim(), author: "Dale", when: "just now", tone: "progress" }, ...n]);
    setNoteDraft("");
    toast.success("Design note added");
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ------------------------------------------------------ LEFT: queue */}
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-border">
        <div className="space-y-1.5 border-b border-border px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Design Queue</h2>
            <span className="num text-[11px] text-muted-foreground">{designJobs.length} items</span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, customer, item" className="h-8 pl-7 text-[12px]" />
          </div>
          <QueueToolbarToggles
            onExpandAll={() => setOpenOrders(Object.fromEntries(groups.map((g) => [g.order, true])))}
            onCollapseAll={() => setOpenOrders({})}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
          {filtered.map((g) => {
            const need = g.counts.needsDesign + g.counts.inDesign + g.counts.revision + g.counts.blocked;
            return (
              <OrderGroup
                key={g.order}
                open={openOrders[g.order] ?? false}
                onToggle={() => setOpenOrders((o) => ({ ...o, [g.order]: !o[g.order] }))}
                orderNumber={g.order}
                customer={g.customer}
                due={g.due}
                count={g.jobs.length}
                pieces={g.pieces}
                rush={g.rush}
                alert={g.alert}
                active={g.jobs.some((j) => j.id === selectedId)}
                chips={
                  <>
                    {need > 0 && <AggregateChip label={`${need} need design`} tone="warn" />}
                    {g.counts.waiting > 0 && <AggregateChip label={`${g.counts.waiting} waiting`} tone="info" />}
                    {g.counts.proof > 0 && <AggregateChip label={`${g.counts.proof} ready for proof`} tone="info" />}
                    {g.counts.complete > 0 && <AggregateChip label={`${g.counts.complete} complete`} tone="ok" />}
                  </>
                }
              >
                {g.jobs.map((j) => (
                  <LineRow
                    key={j.id}
                    active={j.id === selectedId}
                    onClick={() => setSelectedId(j.id)}
                    thumb={<Thumb label={j.item} />}
                    title={j.item}
                    meta={[j.size, `Qty ${j.qty}`].filter(Boolean).join(" · ")}
                    sub={[j.media, j.sides === 2 ? "Double-sided" : "Single-sided"].filter(Boolean).join(" · ")}
                    status={<Status value={j.status} />}
                  />
                ))}
              </OrderGroup>
            );
          })}
        </div>
      </aside>

      {/* --------------------------------------------------- CENTER: the job */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-[13px] text-muted-foreground">#{job.order}</span>
              <h1 className="truncate text-[18px] font-semibold tracking-tight">{job.item}</h1>
              <Status value={job.status} />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {job.customer} · Due {job.due}{job.priority === "Rush" ? " · Rush" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => uploadRef.current?.click()}>
              <Upload className="mr-1 size-3.5" />Upload New Version
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => toast.success("Downloading all files")}>
              <Download className="mr-1 size-3.5" />Download All
            </Button>
            <input
              ref={uploadRef}
              type="file"
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) toast.success(`Uploaded ${e.target.files[0]!.name} as a new design version`); e.target.value = ""; }}
            />
          </div>
        </header>

        <div className="space-y-3 p-3">
          {showBanner && (
            <div className={cn(
              "rounded border-l-4 p-2.5",
              job.status === "Blocked" ? "border-l-blocked border border-blocked/40 bg-blocked/10" : "border-l-warn border border-warn/40 bg-warn/10",
            )}>
              <div className={cn("flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide", job.status === "Blocked" ? "text-blocked" : "text-warn")}>
                <AlertTriangle className="size-3.5" />
                {job.status === "Blocked" ? "Design Blocker" : "Revision Requested"}
              </div>
              <p className="mt-1 text-[13.5px] font-medium">
                “{job.status === "Blocked" ? job.blocker : latestRevision?.body}”
              </p>
              {job.status !== "Blocked" && latestRevision && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{latestRevision.source} · {latestRevision.when}</p>
              )}
            </div>
          )}

          {/* viewer */}
          <ArtworkViewerPanel
            height={viewerHeight}
            onHeightChange={setViewerHeight}
            collapsed={viewerCollapsed}
            onCollapsedChange={setViewerCollapsed}
            sideControls={
              <>
                {sides.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setViewSide(s)}
                    className={cn(
                      "rounded border px-2 py-1 text-[11.5px] font-semibold uppercase tracking-wide transition",
                      s === viewSide ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    {s === "Single" ? "Artwork" : s}
                  </button>
                ))}
                {!viewerCollapsed && (
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    {job.sides === 2 ? "Double-sided" : "Single-sided"}
                  </span>
                )}
              </>
            }
            controls={<ViewerControls zoom={zoom} setZoom={setZoom} onFullscreen={() => setFullscreen(true)} fullscreenLabel="Full screen" />}
            summary={
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px]">
                <span className="font-semibold">{viewFile?.kind === "Version" ? "Design Art" : "Source Art"}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-semibold uppercase tracking-wide">{viewSide === "Single" ? "Artwork" : viewSide}</span>
                <span className="text-muted-foreground">·</span>
                <span className="num truncate text-muted-foreground">{viewFile?.name ?? "No file"}</span>
                {viewFile && viewFile.id === currentVersionId && (
                  <span className="rounded border border-primary px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Current</span>
                )}
              </span>
            }
            footer={
              viewFile ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                  <span className="num truncate text-muted-foreground">{viewFile.name} · {viewFile.meta}</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => toast.success(`Downloading ${viewFile.name}`)}>Download</Button>
                    {viewFile.kind === "Version" && viewFile.id !== currentVersionId && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { setCurrentVersionId(viewFile.id); toast.success(`${viewFile.version} set as current design version`); }}>
                        Set as Current
                      </Button>
                    )}
                  </div>
                </div>
              ) : null
            }
          >
            <Stage file={viewFile} zoom={zoom} label={`${viewFile?.name ?? ""} ${viewSide}`} />
          </ArtworkViewerPanel>


          {/* files */}
          <Card>
            <div className="space-y-2">
              <div>
                <SectionTitle action={<Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => uploadRef.current?.click()}>Upload File</Button>}>
                  Source / Customer Files
                </SectionTitle>
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                  {job.sources.map((f) => (
                    <FileCard key={f.id} file={f} active={f.id === viewFileId} onClick={() => { setViewFileId(f.id); setZoom(1); }} />
                  ))}
                  {job.sources.length === 0 && <span className="text-[11.5px] text-muted-foreground">No customer files supplied.</span>}
                </div>
              </div>
              <div>
                <SectionTitle action={<Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => uploadRef.current?.click()}>Upload New Design Version</Button>}>
                  Design Files / Working Versions
                </SectionTitle>
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                  {job.versions.map((f) => (
                    <FileCard
                      key={f.id}
                      file={f}
                      active={f.id === viewFileId}
                      onClick={() => { setViewFileId(f.id); setZoom(1); if (f.side) setViewSide(f.side); }}
                      badge={f.id === currentVersionId
                        ? <span className="rounded border border-ok/50 bg-ok/15 px-1 text-[9px] font-bold uppercase text-ok">Current</span>
                        : f.side && f.side !== "Single"
                          ? <span className="rounded border border-border px-1 text-[9px] font-semibold uppercase text-muted-foreground">{f.side}</span>
                          : undefined}
                    />
                  ))}
                  {job.versions.length === 0 && <span className="text-[11.5px] text-muted-foreground">No design versions yet.</span>}
                </div>
              </div>
            </div>
          </Card>

          {/* brief + specs */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card>
              <SectionTitle>Design Brief</SectionTitle>
              <div className="mt-2 space-y-2.5">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Customer Request</div>
                  <p className="text-[14px] font-medium leading-snug">{job.brief.customerRequest}</p>
                </div>
                {job.brief.salesInstructions && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sales Instructions</div>
                    <p className="text-[13px] leading-snug">{job.brief.salesInstructions}</p>
                  </div>
                )}
                {job.brief.requiredCopy && job.brief.requiredCopy.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Required Copy</div>
                    <ul className="mt-0.5 space-y-0.5 rounded border border-border bg-background/60 p-1.5 text-[13px]">
                      {job.brief.requiredCopy.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {job.brief.brandNotes && <Spec label="Brand / Style Notes" value={<span className="whitespace-normal text-[12.5px] font-normal">{job.brief.brandNotes}</span>} />}
                  {job.brief.objective && <Spec label="Design Objective" value={<span className="whitespace-normal text-[12.5px] font-normal">{job.brief.objective}</span>} />}
                  {job.brief.layoutNotes && <Spec label="Layout Notes" value={<span className="whitespace-normal text-[12.5px] font-normal">{job.brief.layoutNotes}</span>} />}
                  {job.brief.referenceNotes && <Spec label="Reference Notes" value={<span className="whitespace-normal text-[12.5px] font-normal">{job.brief.referenceNotes}</span>} />}
                  {job.brief.priorityNotes && <Spec label="Priority Notes" value={<span className="whitespace-normal text-[12.5px] font-normal">{job.brief.priorityNotes}</span>} />}
                </div>
              </div>
            </Card>

            <div className="space-y-3">
              <Card>
                <SectionTitle>Job Specifications</SectionTitle>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Spec label="Product" value={job.item} />
                  <Spec label="Size" value={job.size ?? "—"} />
                  <Spec label="Quantity" value={<span className="num">{job.qty.toLocaleString()}</span>} />
                  <Spec label="Media" value={job.media ?? "—"} />
                  <Spec label="Sidedness" value={job.sides === 2 ? "Double-sided" : "Single-sided"} />
                  <Spec label="Finishing" value={job.finishing ?? "—"} />
                  <Spec label="Proof" value={job.proofRequired ? "Required" : "Not required"} />
                  <Spec label="Due" value={job.due} />
                  <Spec label="Priority" value={job.priority} />
                </div>
              </Card>

              {job.lineItemNotes && (
                <Card>
                  <SectionTitle>Line Item Notes</SectionTitle>
                  <p className="mt-1 text-[13px] leading-snug">“{job.lineItemNotes}”</p>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">From the Sales line item</p>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* --------------------------------------------------- RIGHT: status */}
      <aside className="flex w-[318px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border p-2.5">
        <Card>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Design Status</div>
              <div className="mt-1"><Status value={job.status} /></div>
            </div>
            <Spec label="Assigned Designer" value={job.designer} />
            <Spec label="Priority" value={job.priority} />
            <Spec label="Due" value={job.due} />
            <Spec label="Proof" value={job.proofRequired ? "Required" : "Not required"} />
            {job.proofStatus && <div className="col-span-2"><Spec label="Latest Proof" value={<span className="whitespace-normal text-[12px] font-normal">{job.proofStatus}</span>} /></div>}
          </div>
        </Card>

        <Card>
          <SectionTitle action={
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10.5px] uppercase tracking-wide" onClick={() => setTimeDlg(true)}>
              <Pencil className="mr-1 size-3" />Edit Time
            </Button>
          }>Design Timer</SectionTitle>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current session</div>
          <div className="num text-[30px] font-bold leading-none tracking-tight">{fmtClock(secs)}</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-border pt-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total tracked</span>
            <span className="num text-[12.5px] font-semibold">
              {fmtMinutes(trackedMinutes)} · {job.timer.sessions} session{job.timer.sessions === 1 ? "" : "s"}
            </span>
          </div>
          {corrections.length > 0 && (
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
              Includes {corrections.length} correction{corrections.length === 1 ? "" : "s"} ({correctionTotal > 0 ? "+" : "−"}{Math.abs(correctionTotal)}m)
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            {running ? (
              <Button size="sm" variant="outline" className="h-8 flex-1 text-[12px]" onClick={() => setRunning(false)}>
                <Pause className="mr-1 size-3.5" />Pause
              </Button>
            ) : (
              <Button size="sm" className="h-8 flex-1 text-[12px]" onClick={() => setRunning(true)}>
                <Play className="mr-1 size-3.5" />{secs > 0 ? "Resume" : "Start"}
              </Button>
            )}
            <Button size="sm" variant="secondary" className="h-8 text-[12px]" onClick={() => { setRunning(false); toast.success("Design session logged"); }}>
              <Clock className="mr-1 size-3.5" />Stop
            </Button>
          </div>
        </Card>

        <Card className="border-primary/40 bg-primary/[0.06]">
          <SectionTitle>Next</SectionTitle>
          <div className="mt-0.5 text-[14px] font-semibold">{next.label}</div>
          <Button
            size="sm"
            variant={next.tone === "primary" ? "default" : "secondary"}
            className="mt-2 h-9 w-full text-[12.5px] font-semibold uppercase tracking-wide"
            onClick={() => toast.success(`${next.cta} — ${job.item}`)}
          >
            {next.cta}
          </Button>
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-[11px]" onClick={() => uploadRef.current?.click()}>Upload Version</Button>
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-[11px]" onClick={() => toast.warning("Issue reported to Sales")}>Report Issue</Button>
          </div>
        </Card>

        {job.revisions.length > 0 && (
          <RailSection
            title="Latest Proof Feedback"
            unread={unread.feedback ?? 0}
            open={open.feedback}
            onOpenChange={(o) => toggle("feedback", o)}
          >
            <p className="text-[13px] font-medium leading-snug">“{job.revisions[0]!.body}”</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{job.revisions[0]!.source} · {job.revisions[0]!.when}</p>
            {job.revisions.slice(1).map((r) => (
              <div key={r.id} className="mt-2 border-t border-border pt-1.5">
                <p className="text-[12px] leading-snug text-muted-foreground">“{r.body}”</p>
                <p className="text-[10.5px] text-muted-foreground">{r.when}</p>
              </div>
            ))}
          </RailSection>
        )}

        <RailSection
          title="Design Versions"
          unread={unread.versions ?? 0}
          open={open.versions}
          onOpenChange={(o) => toggle("versions", o)}
        >
          <div className="space-y-1">
            {job.versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { setViewFileId(v.id); setZoom(1); if (v.side) setViewSide(v.side); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left transition",
                  v.id === viewFileId ? "border-primary bg-primary/10" : "border-transparent hover:border-primary/40",
                )}
              >
                <Thumb label={v.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold">{v.version}</span>
                    {v.id === currentVersionId && <span className="rounded border border-ok/50 bg-ok/15 px-1 text-[9px] font-bold uppercase text-ok">Current</span>}
                    {v.side && v.side !== "Single" && <span className="text-[10px] uppercase text-muted-foreground">{v.side}</span>}
                  </span>
                  <span className="num block truncate text-[11px] text-muted-foreground">{v.name}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{v.meta}</span>
                </span>
              </button>
            ))}
            {job.versions.length === 0 && <p className="text-[11.5px] text-muted-foreground">No versions uploaded yet.</p>}
          </div>
        </RailSection>

        <RailSection
          title="Design Notes"
          unread={unread.notes ?? 0}
          open={open.notes}
          onOpenChange={(o) => toggle("notes", o)}
        >
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Working note…"
            className="min-h-[52px] text-[12px]"
          />
          <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full text-[11px]" onClick={addNote}>
            <MessageSquarePlus className="mr-1 size-3.5" />Add Note
          </Button>
          <div className="mt-2 space-y-1.5">
            {notes.map((n) => (
              <div key={n.id} className={cn("rounded border-l-2 pl-1.5 text-[12px]", n.tone === "blocker" ? "border-l-blocked" : n.tone === "progress" ? "border-l-primary" : "border-l-border")}>
                <p className="leading-snug">{n.body}</p>
                <p className="text-[10.5px] text-muted-foreground">{n.author} · {n.when}</p>
              </div>
            ))}
            {notes.length === 0 && <p className="text-[11.5px] text-muted-foreground">No working notes yet.</p>}
          </div>
        </RailSection>

        <RailSection
          title="Recent Activity"
          unread={unread.activity ?? 0}
          open={open.activity}
          onOpenChange={(o) => toggle("activity", o)}
        >
          <ul className="space-y-1">
            {job.activity.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="truncate">{a.label}</span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">{a.when}</span>
              </li>
            ))}
          </ul>
        </RailSection>

        <RailSection title="Design Cost Summary" open={open.cost} onOpenChange={(o) => toggle("cost", o)}>
          <div className="grid grid-cols-2 gap-2">
            <Spec label="Tracked Time" value={fmtMinutes(trackedMinutes)} />
            <Spec label="Internal Cost" value={<span className="num">${((trackedMinutes / 60) * job.cost.rate).toFixed(0)}</span>} />
            <Spec label="Sold Design" value={<span className="num">${job.cost.sold}</span>} />
            <Spec
              label="Variance"
              value={<span className={cn("num", job.cost.sold - (trackedMinutes / 60) * job.cost.rate < 0 ? "text-late" : "text-ok")}>
                ${(job.cost.sold - (trackedMinutes / 60) * job.cost.rate).toFixed(0)}
              </span>}
            />
            <div className="col-span-2 text-[10.5px] text-muted-foreground">Detailed time history and corrections live in Reports.</div>
          </div>
        </RailSection>

      </aside>

      <TimeCorrectionDialog
        open={timeDlg}
        onOpenChange={setTimeDlg}
        trackedMinutes={trackedMinutes}
        sessions={job.timer.sessions}
        currentSessionSeconds={secs}
        corrections={corrections}
        author={CURRENT_USER}
        onApply={({ deltaMinutes, reason }) => {
          setCorrectionsByJob((c) => ({
            ...c,
            [selectedId]: [
              { id: `tc-${Date.now()}`, deltaMinutes, reason, author: CURRENT_USER, when: "just now" },
              ...(c[selectedId] ?? []),
            ],
          }));
          setTimeDlg(false);
          toast.success(`Time correction applied — ${deltaMinutes > 0 ? "+" : "−"}${Math.abs(deltaMinutes)}m`);
        }}
      />

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              {job.item} · {viewSide === "Single" ? "Artwork" : viewSide} · {viewFile?.name ?? "No file"}
            </DialogTitle>
          </DialogHeader>
          <Stage file={viewFile} zoom={zoom} />
          <div className="flex justify-center">
            <ViewerControls zoom={zoom} setZoom={setZoom} onFullscreen={() => setFullscreen(false)} fullscreenLabel="Exit" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
