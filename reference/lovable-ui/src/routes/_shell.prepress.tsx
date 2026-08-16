import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Search, Upload, Flag, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Thumb } from "@/components/app/primitives";
import { AggregateChip, LineRow, OrderGroup } from "@/components/app/order-queue";
import {
  groupPrepressByOrder,
  prepressDestinations,
  prepressJobs,
  sidesOf,
  isRoleReleased,
  lineItemSummary,
  roleBlockers,
  roleState,
  type ArtFile,
  type Destination,
  type PrepressJob,
  type Side,
} from "@/lib/mock/prepress";

export const Route = createFileRoute("/_shell/prepress")({
  head: () => ({
    meta: [
      { title: "Prepress Workspace — PrintersHero V2" },
      { name: "description", content: "Operator prepress workspace: inspect customer artwork, assign production art per side, set the production destination and release to production." },
      { property: "og:title", content: "Prepress Workspace — PrintersHero V2" },
      { property: "og:description", content: "Inspect artwork, assign Front/Back production art and mark jobs ready." },
    ],
  }),
  component: PrepressPage,
});

/* --------------------------------- bits --------------------------------- */

function SidesBadge({ sides }: { sides: 1 | 2 }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-semibold leading-none",
        sides === 2 ? "border-info/40 bg-info/10 text-info" : "border-border text-muted-foreground",
      )}
      title={sides === 2 ? "Double-sided" : "Single-sided"}
    >
      {sides === 2 ? "2S" : "1S"}
    </span>
  );
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[14px]">{value}</div>
    </div>
  );
}

type ArtKind = "line" | "production";
type ViewerTile = { kind: ArtKind; side: Side; file: ArtFile };
type Sel = { kind: ArtKind; side: Side };

function ArtCard({
  tile, active, emphasis, onSelect, actions, badge,
}: {
  tile: { side: Side; file: ArtFile | undefined };
  kind: ArtKind;
  active?: boolean;
  emphasis?: boolean;
  onSelect: () => void;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-[168px] flex-col gap-1.5 rounded border p-1.5 transition",
        emphasis ? "border-primary/50 bg-primary/5" : "border-border bg-surface-2/50",
        active && "border-primary ring-2 ring-primary",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!tile.file}
        className="group rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
      >
        {tile.file ? (
          <Thumb label={tile.file.name} className="h-[104px] w-full rounded-sm text-[12px] transition group-hover:opacity-90" />
        ) : (
          <div className="flex h-[104px] w-full items-center justify-center rounded-sm border border-dashed border-border text-[12px] text-muted-foreground">
            Not assigned
          </div>
        )}
      </button>
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-[13px] font-bold uppercase tracking-wide", active && "text-primary")}>
          {tile.side === "Single" ? "Artwork" : tile.side}
        </span>
        {badge}
      </div>
      <div className="num truncate text-[11px] text-muted-foreground" title={tile.file?.name}>{tile.file?.name ?? "—"}</div>
      {actions && <div className="flex flex-wrap gap-1.5 pt-0.5">{actions}</div>}
    </div>
  );
}

function ViewerControls({
  zoom, setZoom, fit, onFullscreen, fullscreenLabel,
}: {
  zoom: number; setZoom: (z: number) => void; fit: () => void;
  onFullscreen: () => void; fullscreenLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" className="h-9 w-9 p-0 text-[16px]" onClick={() => setZoom(Math.max(0.25, +(zoom - 0.25).toFixed(2)))} aria-label="Zoom out">−</Button>
      <span className="num w-12 text-center text-[13px]">{Math.round(zoom * 100)}%</span>
      <Button size="sm" variant="outline" className="h-9 w-9 p-0 text-[16px]" onClick={() => setZoom(Math.min(4, +(zoom + 0.25).toFixed(2)))} aria-label="Zoom in">+</Button>
      <Button size="sm" variant="secondary" className="h-9 text-[13px]" onClick={fit}>Fit</Button>
      <Button size="sm" variant="secondary" className="h-9 text-[13px]" onClick={() => setZoom(1)}>100%</Button>
      <Button size="sm" variant="outline" className="h-9 text-[13px]" onClick={onFullscreen}>
        <Maximize2 className="mr-1 size-3.5" />{fullscreenLabel}
      </Button>
    </div>
  );
}

function ViewerStage({ file, zoom }: { file: ArtFile; zoom: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-border bg-surface-2/40 p-3">
      <div className="mx-auto flex min-h-full items-center justify-center">
        <div style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? "100%" : undefined }}>
          <Thumb label={file.name} className="aspect-[4/3] h-auto w-full rounded text-[14px]" />
        </div>
      </div>
    </div>
  );
}

/* Mock "scanned" artwork dimensions read from the file itself (not the ordered size). */
function hashOf(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function parseExpected(size: string): { w: number; h: number } | null {
  const m = size.match(/([\d.]+)\s*"?\s*[×x]\s*([\d.]+)/);
  return m ? { w: parseFloat(m[1]!), h: parseFloat(m[2]!) } : null;
}

type DetectedSize = { label: string; w?: number; h?: number };

function detectArtSize(file: ArtFile, expected: string): DetectedSize {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const exp = parseExpected(expected);
  const h = hashOf(file.name + file.id);
  if (!exp || !["pdf", "ai", "eps", "svg", "tif", "tiff", "png", "jpg", "jpeg"].includes(ext)) {
    return { label: "Unknown" };
  }
  const raster = ["tif", "tiff", "png", "jpg", "jpeg"].includes(ext);
  if (raster && h % 5 === 0) {
    // no reliable DPI metadata — report pixels instead of inventing inches
    return { label: `${Math.round(exp.w * 150)} × ${Math.round(exp.h * 150)} px (no DPI)` };
  }
  // small deterministic drift on a minority of files
  const drift = h % 7 === 0 ? -0.25 : 0;
  const w = exp.w;
  const hh = exp.h + drift;
  return { label: `${w.toFixed(2)}" × ${hh.toFixed(2)}"`, w, h: hh };
}

function ArtSizeBlock({ file, expected }: { file: ArtFile; expected: string }) {
  const det = detectArtSize(file, expected);
  const exp = parseExpected(expected);
  const match = det.w != null && det.h != null && exp
    ? Math.abs(det.w - exp.w) < 0.01 && Math.abs(det.h - exp.h) < 0.01
    : null;

  return (
    <div className="flex items-center justify-center gap-3">
      <div className="text-center leading-tight">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Detected art size</div>
        <div className={cn("num text-[18px] font-bold", match === false ? "text-warn" : "text-foreground")}>
          {det.label}
        </div>
        <div className="num text-[13px] text-muted-foreground">
          Expected: <span className="font-medium text-foreground">{expected}</span>
        </div>
      </div>
      {match === true && (
        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-3 py-1.5 text-ok">
          <CheckCircle2 className="size-5" />
          <span className="text-[13px] font-bold uppercase tracking-wide">Match</span>
        </div>
      )}
      {match === false && (
        <div className="flex items-center gap-1.5 rounded-md border border-warn/50 bg-warn/15 px-3 py-2 text-warn shadow-sm">
          <AlertTriangle className="size-6" />
          <div className="text-left leading-tight">
            <div className="text-[13px] font-bold uppercase tracking-wide">Size mismatch</div>
            <div className="text-[11px]">Art differs from expected</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtSizeLine({ file, expected }: { file: ArtFile; expected: string }) {
  const det = detectArtSize(file, expected);
  const exp = parseExpected(expected);
  const match = det.w != null && det.h != null && exp
    ? Math.abs(det.w - exp.w) < 0.01 && Math.abs(det.h - exp.h) < 0.01
    : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      <span className="num">
        <span className="text-muted-foreground">Art size:</span>{" "}
        <span className={cn("font-semibold", match === false ? "text-warn" : "text-foreground")}>{det.label}</span>
      </span>
      <span className="num text-muted-foreground">Expected: {expected}</span>
      {match === true && <span className="text-ok">✓</span>}
      {match === false && <span className="font-semibold text-warn">⚠ Size differs</span>}
    </div>
  );
}

function ViewerTitle({ sel, file, size = "lg" }: { sel: Sel; file: ArtFile; size?: "lg" | "sm" }) {
  return (
    <div className="min-w-0">
      <div className={cn("flex flex-wrap items-center gap-2 font-bold uppercase tracking-wide", size === "lg" ? "text-[15px]" : "text-[14px]")}>
        <span className={sel.kind === "production" ? "text-primary" : "text-muted-foreground"}>
          {sel.kind === "production" ? "Production art" : "Line item art"}
        </span>
        <span className="rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[13px] text-primary">
          {sel.side === "Single" ? "Artwork" : sel.side}
        </span>
      </div>
      <div className="num truncate text-[12px] text-muted-foreground">{file.name} · {file.size}</div>
    </div>
  );
}



function FullscreenViewer({
  sel, file, sides, expected, onSel, onClose,
}: { sel: Sel; file: ArtFile; sides: Side[]; expected: string; onSel: (s: Sel) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[94vh] max-w-[min(1600px,97vw)] flex-col gap-2 p-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="sr-only">Artwork viewer</DialogTitle>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <ViewerTitle sel={sel} file={file} />
            <ArtSizeBlock file={file} expected={expected} />
            <div />
          </div>
        </DialogHeader>
        <ViewerStage file={file} zoom={zoom} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["line", "production"] as ArtKind[]).map((k) => (
              <Button key={k} size="sm" variant={sel.kind === k ? "default" : "outline"} className="h-9 text-[12px]" onClick={() => onSel({ ...sel, kind: k })}>
                {k === "line" ? "Line item art" : "Production art"}
              </Button>
            ))}
            {sides.length > 1 && sides.map((s) => (
              <Button key={s} size="sm" variant={sel.side === s ? "default" : "outline"} className="h-9 text-[12px]" onClick={() => onSel({ ...sel, side: s })}>
                {s}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <ViewerControls zoom={zoom} setZoom={setZoom} fit={() => setZoom(1)} onFullscreen={onClose} fullscreenLabel="Exit" />
            <Button size="sm" className="h-9 px-4 text-[13px]" onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function ContextCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface-2/30 p-2">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

type Ctx = { notes: string; qc: boolean; qcType: string; alerts: string[] };

const roleTone: Record<string, "ok" | "warn" | "late" | "info" | "neutral"> = {
  "In Production": "info",
  "Ready to Release": "ok",
  "Needs Production Art": "warn",
  "Needs Destination": "warn",
  "Waiting on Proof": "neutral",
  "Artwork Issue": "late",
};

/** Per production-art page state for a line item — roles progress independently. */
function LineRoleChips({ job }: { job: PrepressJob }) {
  const s = lineItemSummary(job);
  return (
    <>
      {s.roles.map((r) => (
        <AggregateChip
          key={r.side}
          tone={roleTone[r.state] ?? "neutral"}
          label={`${r.side === "Single" ? "Art" : r.side.toUpperCase()} · ${r.state}`}
        />
      ))}
      <span className="w-full text-[10.5px] text-muted-foreground">{s.label}</span>
    </>
  );
}

/* --------------------------------- page --------------------------------- */

function PrepressPage() {
  const [jobs, setJobs] = useState<PrepressJob[]>(prepressJobs);
  const [selectedId, setSelectedId] = useState(prepressJobs[0]!.id);
  const [q, setQ] = useState("");
  const [dest, setDest] = useState<string>("All");
  const [status, setStatus] = useState<string>("All");
  const [sort, setSort] = useState<"due" | "order">("due");
  const [sel, setSel] = useState<Sel>({ kind: "production", side: "Front" });
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [ctxMap, setCtxMap] = useState<Record<string, Ctx>>({});
  /** accordion: exactly one order is expanded at a time */
  const [openOrder, setOpenOrder] = useState<string>(prepressJobs[0]!.order);

  const job = jobs.find((j) => j.id === selectedId) ?? jobs[0]!;
  const sides = sidesOf(job);
  const summary = lineItemSummary(job);
  /** the production-art page/role currently being prepared */
  const role: Side = sides.includes(sel.side) ? sel.side : sides[0]!;
  const roleReleased = isRoleReleased(job, role);
  const roleBlk = roleBlockers(job, role);
  const canRelease = roleBlk.length === 0 && !roleReleased;

  const ctx: Ctx = ctxMap[job.id] ?? { notes: "", qc: false, qcType: "Color match", alerts: job.notes ? [job.notes] : [] };
  const patchCtx = (patch: Partial<Ctx>) => setCtxMap((prev) => ({ ...prev, [job.id]: { ...ctx, ...patch } }));

  /** contextual, read-only production plan summary */
  const plan = useMemo(() => {
    const exp = parseExpected(job.size);
    const up = exp ? Math.max(1, Math.floor(48 / Math.min(exp.w, exp.h)) * Math.floor(96 / Math.max(exp.w, exp.h))) : 1;
    const sheets = Math.ceil(job.qty / up);
    return { line: `48" × 96" sheet · ${up}-up · ${sheets} sheet${sheets === 1 ? "" : "s"} · ${job.sides} pass${job.sides === 1 ? "" : "es"}` };
  }, [job.size, job.qty, job.sides]);

  const material = useMemo(() => {
    const exp = parseExpected(job.size);
    const required = exp ? Math.round((exp.w * exp.h * job.qty) / 144) : 0;
    const available = hashOf(job.media) % 3 === 0 ? Math.round(required / 2) : required * 3;
    return { required, available, ok: available >= required };
  }, [job.size, job.qty, job.media]);

  /** every customer file attached to this line item, with its known role */
  const customerArt = useMemo(() => {
    const seen = new Set<string>();
    const out: { role: Side | "Unassigned"; file: ArtFile }[] = [];
    for (const s of sides) {
      const f2 = job.lineArt[s];
      if (f2) { out.push({ role: s, file: f2 }); seen.add(f2.id); }
    }
    for (const f2 of job.files) if (!seen.has(f2.id) && f2.kind === "Customer") out.push({ role: "Unassigned", file: f2 });
    return out;
  }, [job.id, job.lineArt, job.files, sides]);


  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = jobs
      .filter((j) => (dest === "All" ? true : j.destination === dest))
      .filter((j) => (status === "All" ? true : j.status === status))
      .filter((j) => !t || `${j.order} ${j.customer} ${j.item}`.toLowerCase().includes(t));
    return groupPrepressByOrder(filtered).sort((a, b) =>
      sort === "order"
        ? a.order.localeCompare(b.order)
        : Date.parse(a.due) - Date.parse(b.due) || Number(b.rush) - Number(a.rush),
    );
  }, [jobs, q, dest, status, sort, selectedId]);

  const lineCount = groups.reduce((n, g) => n + g.jobs.length, 0);


  const update = (patch: Partial<PrepressJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...patch } : j)));

  const toProd = (file: ArtFile): ArtFile => ({ ...file, id: `prd-${file.id}`, kind: "Production", name: file.name.replace(/\.[a-z]+$/i, "") + ".tif" });

  const assign = (file: ArtFile, targets: Side[]) => {
    const next = { ...job.prodArt };
    for (const s of targets) next[s] = toProd(file);
    const filled = sides.every((s) => next[s]);
    update({ prodArt: next, status: filled && job.status === "Needs Production Art" ? "Ready for Prepress" : job.status });
  };

  const upload = (side: Side | "all") => {
    const file: ArtFile = {
      id: `up-${Date.now()}`,
      name: `PRD-${job.order}-upload.tif`,
      size: "72 MB",
      uploaded: "just now",
      kind: "Production",
    };
    const next = { ...job.prodArt };
    for (const s of side === "all" ? sides : [side]) next[s] = file;
    update({ prodArt: next, files: [...job.files, file], status: job.status === "Needs Production Art" ? "Ready for Prepress" : job.status });
  };

  /** Prototype-only hint; does not change the underlying business route. */
  const suggested: Destination = useMemo(() => {
    const m = `${job.media} ${job.item}`.toLowerCase();
    if (m.includes("coroplast") || m.includes("acm") || m.includes("pvc") || m.includes("rigid")) return "Océ Arizona";
    if (m.includes("banner") || m.includes("mesh")) return "HP Latex";
    if (m.includes("vinyl") || m.includes("decal")) return "Roland";
    if (m.includes("cut") || m.includes("shape")) return "Router";
    return "Finishing";
  }, [job.media, job.item]);


  /** Keep selection valid for the current job; default to production art when it exists. */
  useEffect(() => {
    const first = sides.find((s) => !isRoleReleased(job, s)) ?? sides[0]!;
    const preferProd = !!job.prodArt[first];
    setSel({ kind: preferProd ? "production" : "line", side: first });
    setZoom(1);
  }, [job.id]);

  const fileFor = (s: Sel) => (s.kind === "production" ? job.prodArt[s.side] : job.lineArt[s.side]);
  const current = fileFor(sel);

  const select = (kind: ArtKind, side: Side) => { setSel({ kind, side }); setZoom(1); };

  const selectJob = (id: string) => { setSelectedId(id); };

  /** attach a new customer file to the selected line item */
  const uploadCustomer = () => {
    const file: ArtFile = {
      id: `cust-${Date.now()}`,
      name: `${job.order}_customer_upload.pdf`,
      size: "8.6 MB",
      uploaded: "just now",
      kind: "Customer",
    };
    update({ files: [...job.files, file] });
  };

  /** inspect a customer file; role-assigned files load directly in the viewer */
  const selectCustomer = (file: ArtFile, role: Side | "Unassigned") => {
    if (role !== "Unassigned") select("line", role);
    else select("line", sides[0]!);
  };


  /** first line item that still needs prepress work, else the first line item */
  const firstNeedingPrepress = (g: { jobs: PrepressJob[] }) => {
    const sums = g.jobs.map((j) => ({ j, s: lineItemSummary(j) }));
    return (
      sums.find((x) => x.s.roles.some((r) => r.state === "Ready to Release"))?.j ??
      sums.find((x) => !x.s.complete)?.j ??
      g.jobs[0]!
    );
  };

  /** accordion open: collapses the previous order and loads its first actionable line item */
  const openGroup = (g: { order: string; jobs: PrepressJob[] }) => {
    if (openOrder === g.order) { setOpenOrder(""); return; }
    setOpenOrder(g.order);
    selectJob(firstNeedingPrepress(g).id);
  };



  return (
    <div className="flex h-[calc(100vh-var(--topbar-h,52px))] min-h-0 gap-3 p-3">
      {/* LEFT — queue */}
      <aside className="flex w-[320px] shrink-0 flex-col gap-2 rounded border border-border bg-card/40 p-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[13px] font-bold uppercase tracking-wide">Prepress Queue</h1>
          <span className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">{groups.length} orders · {lineCount} items</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, product…" className="h-9 pl-7 text-[13px]" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-8 rounded border border-border bg-surface-2/60 px-1.5 text-[12px]">
            <option>All</option>
            {prepressDestinations.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded border border-border bg-surface-2/60 px-1.5 text-[12px]">
            {["All", "Ready for Prepress", "Needs Production Art", "Waiting on Proof", "Artwork Issue"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Sort</span>
          {(["due", "order"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={cn("rounded border px-1.5 py-0.5", sort === s ? "border-primary/50 bg-primary/10 text-primary" : "border-border")}
            >
              {s === "due" ? "Due date" : "Order #"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {groups.map((g) => {
            const open = openOrder === g.order;
            return (
              <OrderGroup
                key={g.order}
                open={open}
                onToggle={() => openGroup(g)}
                orderNumber={g.order}
                customer={g.customer}
                due={g.due.replace(", 2026", "")}
                count={g.jobs.length}
                pieces={g.pieces}
                rush={g.rush}
                alert={g.alert}
                active={g.order === job.order}
                chips={
                  g.allReleased ? (
                    <AggregateChip tone="ok" label="All items in production" />
                  ) : (
                    <>
                      {g.counts.inProduction > 0 && <AggregateChip tone="info" label={`${g.counts.inProduction} In production`} />}
                      {g.counts.ready > 0 && <AggregateChip tone="ok" label={`${g.counts.ready} Ready`} />}
                      {g.counts.needsArt > 0 && <AggregateChip tone="warn" label={`${g.counts.needsArt} Needs art`} />}
                      {g.counts.proof > 0 && <AggregateChip tone="info" label={`${g.counts.proof} Waiting on proof`} />}
                      {g.counts.issue > 0 && <AggregateChip tone="late" label={`${g.counts.issue} Artwork issue`} />}
                    </>
                  )
                }
              >
                {g.jobs.map((j) => (
                  <LineRow
                    key={j.id}
                    active={j.id === job.id}
                    onClick={() => selectJob(j.id)}
                    thumb={<Thumb label={j.item} className="size-10 shrink-0 rounded-sm" />}
                    title={
                      <span className="flex items-center gap-1.5">
                        {j.item}
                        {j.sides === 2 && <SidesBadge sides={j.sides} />}
                      </span>
                    }
                    meta={`${j.size} · ${j.media} · Qty ${j.qty}`}
                    status={<LineRoleChips job={j} />}
                  />
                ))}
              </OrderGroup>
            );
          })}
          {groups.length === 0 && <p className="py-8 text-center text-[13px] text-muted-foreground">No jobs match these filters.</p>}
        </div>

      </aside>

      {/* CENTER — artwork workspace: thumbnails select, big viewer inspects */}
      <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded border border-border bg-card/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-wide">Artwork</h2>
            <span className="text-[12px] text-muted-foreground">
              {job.sides === 2 ? "Double-sided — Front and Back required" : "Single-sided"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {/* customer art */}
          <div className="rounded border border-border bg-surface-2/30 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Line item / customer art</span>
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={uploadCustomer}>
                <Upload className="mr-1 size-3" />Upload art
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {customerArt.map(({ role, file }) => (
                <div key={file.id + role} className="flex w-[168px] flex-col gap-1.5 rounded border border-border bg-surface-2/50 p-1.5">
                  <button
                    type="button"
                    onClick={() => selectCustomer(file, role)}
                    className="group rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Thumb label={file.name} className="h-[104px] w-full rounded-sm text-[12px] transition group-hover:opacity-90" />
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[12px] font-bold uppercase tracking-wide">
                      {role === "Single" ? "Artwork" : role === "Unassigned" ? "Unassigned" : role}
                    </span>
                    <span className="rounded border border-border px-1 text-[10px] leading-[1.5] text-muted-foreground">{file.kind}</span>
                  </div>
                  <div className="num truncate text-[11px] text-muted-foreground" title={file.name}>{file.name}</div>
                  <div className="num text-[10px] text-muted-foreground">{file.size} · {file.uploaded}</div>
                  {job.sides === 2 ? (
                    <div className="grid grid-cols-2 gap-1">
                      <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => assign(file, ["Front"])}>Front</Button>
                      <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => assign(file, ["Back"])}>Back</Button>
                      <Button size="sm" variant="secondary" className="col-span-2 h-8 text-[11px]" onClick={() => assign(file, sides)}>Use for both sides</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" className="h-8 w-full text-[11px]" onClick={() => assign(file, ["Single"])}>
                      Use as production art
                    </Button>
                  )}
                </div>
              ))}
              {customerArt.length === 0 && (
                <p className="py-6 text-[12px] text-muted-foreground">No customer artwork attached to this line item.</p>
              )}
            </div>
          </div>

          {/* production art */}
          <div className="rounded border border-primary/30 bg-primary/[0.04] p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wide">Production art</span>
              <span className="text-[11px] text-muted-foreground">What will actually be produced</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sides.map((s) => {
                const st = roleState(job, s);
                const rel = isRoleReleased(job, s);
                return (
                  <ArtCard
                    key={"prod" + s}
                    kind="production"
                    emphasis
                    tile={{ side: s, file: job.prodArt[s] }}
                    active={role === s}
                    onSelect={() => select("production", s)}
                    badge={<AggregateChip tone={roleTone[st] ?? "neutral"} label={st === "Ready to Release" ? "READY" : st.toUpperCase()} />}
                    actions={
                      rel ? (
                        <p className="w-full text-[11px] text-info">Released to production — locked for this page.</p>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-8 w-full text-[11px]" onClick={() => upload(s)}>
                            <Upload className="mr-1 size-3" />{job.prodArt[s] ? "Replace production art" : "Upload production art"}
                          </Button>
                          {!job.prodArt[s] && job.lineArt[s] && (
                            <Button size="sm" variant="secondary" className="h-8 w-full text-[11px]" onClick={() => assign(job.lineArt[s]!, [s])}>
                              Assign {s === "Single" ? "art" : s}
                            </Button>
                          )}
                        </>
                      )
                    }
                  />
                );
              })}
            </div>
            {sides.some((s) => !job.prodArt[s] && !isRoleReleased(job, s)) && (
              <p className="mt-1.5 text-[12px] font-semibold text-warn">
                {sides.filter((s) => !job.prodArt[s]).map((s) => (s === "Single" ? "Artwork" : s)).join(" / ")} production art required.
              </p>
            )}
          </div>
        </div>

        {/* large inspection viewer */}
        <div className="flex min-h-[420px] flex-1 flex-col gap-2 rounded border border-border bg-surface-2/20 p-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              {current ? <ViewerTitle sel={sel} file={current} /> : (
                <div className="text-[14px] font-bold uppercase tracking-wide text-muted-foreground">No artwork selected</div>
              )}
            </div>
            <div className="flex justify-center">
              {current && <ArtSizeBlock file={current} expected={job.size} />}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <div className="flex overflow-hidden rounded border border-border">
                {(["line", "production"] as ArtKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => select(k, sel.side)}
                    className={cn("px-3 py-1.5 text-[12px] font-semibold", sel.kind === k ? "bg-primary text-primary-foreground" : "hover:bg-surface-2/60")}
                  >
                    {k === "line" ? "Line item art" : "Production art"}
                  </button>
                ))}
              </div>
              {sides.length > 1 && (
                <div className="flex overflow-hidden rounded border border-border">
                  {sides.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => select(sel.kind, s)}
                      className={cn("px-3 py-1.5 text-[12px] font-semibold uppercase", sel.side === s ? "bg-primary text-primary-foreground" : "hover:bg-surface-2/60")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {current ? (
            <>
              <ViewerStage file={current} zoom={zoom} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ViewerControls zoom={zoom} setZoom={setZoom} fit={() => setZoom(1)} onFullscreen={() => setFullscreen(true)} fullscreenLabel="Full screen" />
                {sides.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[13px]"
                    onClick={() => select(sel.kind, sel.side === "Front" ? "Back" : "Front")}
                  >
                    View {sel.side === "Front" ? "Back" : "Front"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-dashed border-border text-[13px] text-muted-foreground">
              Select an artwork thumbnail to inspect it here.
            </div>
          )}
        </div>

        {/* compact production context */}
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-4">
          <ContextCard title="Production plan">
            <div className="num text-[13px]">{plan.line}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Planned in Production · read-only here</p>
          </ContextCard>

          <ContextCard title="Material">
            <div className="text-[13px] font-semibold">{job.media}</div>
            <div className="num text-[12px] text-muted-foreground">{material.required} sq ft required</div>
            <div className={cn("mt-1 text-[12px] font-semibold", material.ok ? "text-ok" : "text-warn")}>
              {material.ok ? `✓ Stock available` : `⚠ Only ${material.available} sq ft available`}
            </div>
            <Button size="sm" variant="ghost" className="mt-1 h-7 px-0 text-[11px]">Report material issue</Button>
          </ContextCard>

          <ContextCard title="Prepress notes & flags">
            <textarea
              value={ctx.notes}
              onChange={(e) => patchCtx({ notes: e.target.value })}
              placeholder="Add color, orientation, finishing, cut-file, registration, or production notes…"
              className="h-[62px] w-full resize-none rounded border border-border bg-surface-2/60 p-1.5 text-[12px]"
            />
            <label className="mt-1.5 flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={ctx.qc} onChange={(e) => patchCtx({ qc: e.target.checked })} className="size-3.5 accent-[hsl(var(--warn))]" />
              <Flag className="size-3.5 text-warn" />Flag for QC review
            </label>
            {ctx.qc && (
              <select
                value={ctx.qcType}
                onChange={(e) => patchCtx({ qcType: e.target.value })}
                className="mt-1.5 h-8 w-full rounded border border-border bg-surface-2/60 px-1.5 text-[12px]"
              >
                {["Color match", "Resolution", "Bleed / trim", "Orientation", "Cut file", "Other"].map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </ContextCard>

          <ContextCard title="Production alerts">
            {ctx.alerts.length > 0 ? (
              <ul className="space-y-1">
                {ctx.alerts.map((a, i) => (
                  <li key={i} className="rounded border border-warn/40 bg-warn/10 px-1.5 py-1 text-[12px] text-warn">{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">No production alerts for this item.</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5 h-8 w-full text-[11px]"
              onClick={() => {
                const a = window.prompt("Production alert");
                if (a?.trim()) patchCtx({ alerts: [...ctx.alerts, a.trim()] });
              }}
            >
              Add production alert
            </Button>
          </ContextCard>
        </div>
      </section>



      {/* RIGHT — job info + actions */}
      <aside className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto rounded border border-border bg-card/40 p-3">
        <div>
          <div className="num text-[28px] font-bold leading-tight">ORDER #{job.order}</div>
          <div className="text-[17px] text-muted-foreground">{job.customer}</div>
          <div className="mt-2 text-[18px] font-semibold leading-snug">{job.item}</div>
          <div className="num text-[16px]">{job.size} · Qty {job.qty}</div>
          <div className={cn("mt-1.5 inline-flex items-center rounded border px-2 py-1 text-[13px] font-bold uppercase tracking-wide",
            job.sides === 2 ? "border-info/40 bg-info/10 text-info" : "border-border text-muted-foreground")}>
            {job.sides === 2 ? "Double sided" : "Single sided"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border pt-2.5">
          <Spec label="Media" value={job.media} />
          <Spec label="Lamination" value={job.lamination} />
          <Spec label="Finishing" value={job.finishing} />
          <Spec label="Proof status" value={job.proofStatus} />
          <Spec label="Due date" value={job.due} />
          <Spec label="Priority" value={job.priority} />
        </div>

        <div className="border-t border-border pt-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Production destination</div>
            <div className="text-[12px] text-muted-foreground">Suggested: <span className="font-semibold text-foreground">{suggested}</span></div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {prepressDestinations.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => update({ destination: d as Destination })}
                className={cn(
                  "rounded border px-2.5 py-2 text-[13px]",
                  job.destination === d ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:border-primary/50",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            {job.destination ? <>Selected: <span className="font-semibold text-foreground">{job.destination}</span></> : <span className="text-warn">Production destination required.</span>}
          </p>
        </div>


        {job.notes && (
          <div className="rounded border border-border bg-surface-2/50 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Production notes</div>
            <p className="mt-0.5 text-[13px]">{job.notes}</p>
          </div>
        )}

        <div className="mt-auto space-y-2 border-t border-border pt-2">
          {/* Per production-art page state — each releases independently */}
          <div className="rounded border border-border bg-surface-2/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Production art pages</span>
              <span className="text-[11px] text-muted-foreground">{summary.released} of {summary.total} released</span>
            </div>
            <ul className="mt-1.5 space-y-1">
              {summary.roles.map((r) => (
                <li key={r.side}>
                  <button
                    type="button"
                    onClick={() => select("production", r.side)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-[12.5px]",
                      role === r.side ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                    )}
                  >
                    <span className="font-bold uppercase tracking-wide">{r.side === "Single" ? "Artwork" : r.side}</span>
                    <AggregateChip tone={roleTone[r.state] ?? "neutral"} label={r.state} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{summary.label}</p>
          </div>

          {!roleReleased && roleBlk.length > 0 && (
            <div className="rounded border border-warn/40 bg-warn/10 p-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
                <AlertTriangle className="size-3.5" />
                {role === "Single" ? "Artwork" : role} page blocked
              </div>
              <ul className="mt-1 space-y-0.5 text-[12px] text-warn">
                {roleBlk.map((b) => <li key={b}>· {b}</li>)}
              </ul>
            </div>
          )}

          <Button
            variant="outline"
            className="h-11 w-full text-[13px]"
            onClick={() => update({ status: "Artwork Issue", blocked: "Artwork issue reported by prepress" })}
          >
            Report artwork issue
          </Button>

          <Button
            className="h-14 w-full text-[15px] font-bold uppercase tracking-wide"
            disabled={!canRelease}
            onClick={() => {
              update({ releasedRoles: { ...job.releasedRoles, [role]: true } });
              const nextRole = sides.find((s) => s !== role && !isRoleReleased(job, s));
              if (nextRole) { select("production", nextRole); return; }
              const nextJob = groups.flatMap((g) => g.jobs).find((j) => j.id !== job.id && !lineItemSummary(j).complete);
              if (nextJob) setSelectedId(nextJob.id);
            }}
          >
            <CheckCircle2 className="mr-2 size-5" />
            {roleReleased
              ? `${role === "Single" ? "Artwork" : role} released`
              : `Complete prepress · ${role === "Single" ? "Artwork" : role.toUpperCase()}`}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            {roleReleased
              ? "This art page is in production. Other pages and line items are unaffected."
              : canRelease
                ? `Releases only the ${role === "Single" ? "artwork" : role} page to production.`
                : "Resolve this page's requirements to release it."}
          </p>
        </div>

      </aside>

      {fullscreen && current && (
        <FullscreenViewer sel={sel} file={current} sides={sides} expected={job.size} onSel={(s) => setSel(s)} onClose={() => setFullscreen(false)} />
      )}
    </div>
  );
}
