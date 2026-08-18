import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle, ArrowRight, Check, Download, Mail, Maximize2, Plus, Search, Send, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Status, Thumb } from "@/components/app/primitives";
import { ArtworkViewerPanel, useViewerHeight } from "@/components/app/resizable-viewer";
import { AggregateChip, LineRow, OrderGroup, QueueToolbarToggles } from "@/components/app/order-queue";
import { RailSection } from "@/components/app/rail-section";
import {
  groupProofsByOrder, proofJobs, proofNextAction, proofSidesOf,
  type ProofFeedback, type ProofJob, type ProofRecipient, type ProofSide, type ProofUnread,
  type ProofVersion,
} from "@/lib/mock/proofing";

const CURRENT_USER = "Dale";

type RailKey = "feedback" | "versions" | "history" | "activity";

export const Route = createFileRoute("/_shell/proofing")({
  head: () => ({
    meta: [
      { title: "Proofing Workstation — PrintersHero V2" },
      { name: "description", content: "Proof queue, proof viewer, versions, recipients, customer feedback and route-aware approval actions between Design and Prepress." },
      { property: "og:title", content: "Proofing Workstation — PrintersHero V2" },
      { property: "og:description", content: "What did we send, who received it, what did they say, is it approved, what happens next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProofingPage,
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

function Stage({ label, zoom }: { label: string; zoom: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-border bg-surface-2/40 p-3">
      <div className="mx-auto flex min-h-full items-center justify-center">
        <div style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? "100%" : undefined }}>
          <Thumb label={label} className="aspect-[4/3] h-auto w-full rounded text-[14px]" />
        </div>
      </div>
    </div>
  );
}

function VersionRow({
  v, active, onSelect,
}: { v: ProofVersion; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded border px-1.5 py-1 text-left transition",
        active ? "border-primary bg-primary/10" : "border-transparent hover:border-primary/40",
      )}
    >
      <Thumb label={v.label} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="num text-[12.5px] font-bold">{v.label}</span>
          {v.state === "Current" && <span className="rounded border border-primary px-1 text-[9px] font-bold uppercase text-primary">Current</span>}
          {v.state === "Superseded" && <span className="rounded border border-border px-1 text-[9px] font-bold uppercase text-muted-foreground">Superseded</span>}
          {v.state === "Revoked" && <span className="rounded border border-late/50 bg-late/15 px-1 text-[9px] font-bold uppercase text-late">Revoked</span>}
        </span>
        <span className="num block truncate text-[11px] text-muted-foreground">{v.file}</span>
        <span className="block text-[10.5px] text-muted-foreground">
          {v.sentAt ? `Sent ${v.sentAt}` : "Not sent"} · {v.outcome}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------- page */

function ProofingPage() {
  const groups = useMemo(() => groupProofsByOrder(proofJobs), []);
  const [q, setQ] = useState("");
  const [openOrders, setOpenOrders] = useState<Record<string, boolean>>({ [groups[0]!.order]: true });
  const [selectedId, setSelectedId] = useState(proofJobs[0]!.id);
  const job: ProofJob = useMemo(() => proofJobs.find((j) => j.id === selectedId)!, [selectedId]);

  const [viewVersionId, setViewVersionId] = useState(job.currentVersionId);
  const [viewSide, setViewSide] = useState<ProofSide>("Single");
  const [zoom, setZoom] = useState(1);
  const { height: viewerHeight, setHeight: setViewerHeight, collapsed: viewerCollapsed, setCollapsed: setViewerCollapsed } = useViewerHeight();
  const [fullscreen, setFullscreen] = useState(false);

  const [recipientsByJob, setRecipientsByJob] = useState<Record<string, ProofRecipient[]>>({});
  const recipients = recipientsByJob[selectedId] ?? job.recipients;
  const [recipDlg, setRecipDlg] = useState(false);
  const [recipName, setRecipName] = useState("");
  const [recipEmail, setRecipEmail] = useState("");

  const [respondDlg, setRespondDlg] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [feedbackByJob, setFeedbackByJob] = useState<Record<string, ProofFeedback[]>>({});
  const feedback = feedbackByJob[selectedId] ?? job.feedback;

  const [unreadByJob, setUnreadByJob] = useState<Record<string, ProofUnread>>(() =>
    Object.fromEntries(proofJobs.map((j) => [j.id, { ...(j.unread?.[CURRENT_USER] ?? {}) }])),
  );
  const unread = unreadByJob[selectedId] ?? {};
  const [open, setOpen] = useState<Record<RailKey, boolean>>({ feedback: false, versions: false, history: false, activity: false });
  const toggle = (key: RailKey, next: boolean) => {
    setOpen((o) => ({ ...o, [key]: next }));
    if (next) setUnreadByJob((u) => ({ ...u, [selectedId]: { ...(u[selectedId] ?? {}), [key]: 0 } }));
  };

  const version = job.versions.find((v) => v.id === viewVersionId) ?? job.versions[0]!;
  const sides = proofSidesOf(job, version.id);
  const page = version.pages.find((p) => p.side === viewSide) ?? version.pages[0]!;
  const next = proofNextAction(job);
  const latest = feedback[0];
  const isCurrent = version.id === job.currentVersionId;

  useEffect(() => {
    setViewVersionId(job.currentVersionId);
    const s = proofSidesOf(job, job.currentVersionId);
    setViewSide(s[0]!);
    setZoom(1);
    // revision-requested jobs auto-open unviewed customer feedback once
    const hasNew = (unreadByJob[job.id]?.feedback ?? 0) > 0;
    const autoOpen = hasNew && job.status === "Revision Requested";
    setOpen({ feedback: autoOpen, versions: false, history: false, activity: false });
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

  const banner = job.status === "Revision Requested" || job.status === "Revoked";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ------------------------------------------------ LEFT: proof queue */}
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-border">
        <div className="space-y-1.5 border-b border-border px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Proof Queue</h2>
            <span className="num text-[11px] text-muted-foreground">{proofJobs.length} proofs</span>
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
          {filtered.map((g) => (
            <OrderGroup
              key={g.order}
              open={openOrders[g.order] ?? false}
              onToggle={() => setOpenOrders((o) => ({ ...o, [g.order]: !o[g.order] }))}
              orderNumber={g.order}
              customer={g.customer}
              due={g.due}
              count={g.jobs.length}
              rush={g.rush}
              alert={g.alert}
              active={g.jobs.some((j) => j.id === selectedId)}
              chips={
                <>
                  {g.counts.approved > 0 && <AggregateChip label={`${g.counts.approved} approved`} tone="ok" />}
                  {g.counts.revision > 0 && <AggregateChip label={`${g.counts.revision} revision`} tone="warn" />}
                  {g.counts.awaiting > 0 && <AggregateChip label={`${g.counts.awaiting} awaiting`} tone="info" />}
                  {g.counts.viewed > 0 && <AggregateChip label={`${g.counts.viewed} viewed`} tone="info" />}
                  {g.counts.notSent > 0 && <AggregateChip label={`${g.counts.notSent} not sent`} tone="neutral" />}
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
                  sub={[
                    j.versions.find((v) => v.id === j.currentVersionId)?.label ?? "v1",
                    j.sides === 2 ? "Double-sided" : "Single-sided",
                  ].join(" · ")}
                  status={<Status value={j.status} />}
                />
              ))}
            </OrderGroup>
          ))}
        </div>
      </aside>

      {/* --------------------------------------------- CENTER: proof viewer */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-[13px] text-muted-foreground">#{job.order}</span>
              <h1 className="truncate text-[18px] font-semibold tracking-tight">{job.item}</h1>
              <Status value={job.status} />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {job.customer} · Due {job.due}{job.priority === "Rush" ? " · Rush" : ""} · Proof owner {job.owner}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => toast.success(`Downloading ${version.file}`)}>
              <Download className="mr-1 size-3.5" />Download Proof
            </Button>
            <Button size="sm" variant="secondary" className="h-8 text-[12px]" onClick={() => setRespondDlg(true)}>
              Simulate Customer Response
            </Button>
          </div>
        </header>

        <div className="space-y-3 p-3">
          {banner && (
            <div className={cn(
              "rounded border-l-4 p-2.5",
              job.status === "Revoked" ? "border-l-late border border-late/40 bg-late/10" : "border-l-warn border border-warn/40 bg-warn/10",
            )}>
              <div className={cn("flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide", job.status === "Revoked" ? "text-late" : "text-warn")}>
                <AlertTriangle className="size-3.5" />
                {job.status === "Revoked" ? "Proof Revoked" : "Revision Requested"}
              </div>
              {latest && (
                <>
                  <p className="mt-1 text-[13.5px] font-medium">“{latest.body}”</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{latest.author} · {latest.when} · Proof {latest.version}</p>
                </>
              )}
            </div>
          )}

          {/* proof relationship: design source → proof version */}
          <Card className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Design / Source Art</div>
              <div className="num truncate text-[12.5px] font-medium">{job.sourceArt.name}</div>
              <div className="text-[10.5px] text-muted-foreground">{job.sourceArt.version} · {job.sourceArt.designer}</div>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wide text-primary">Proof Version</div>
              <div className="num truncate text-[12.5px] font-semibold">{version.file}</div>
              <div className="text-[10.5px] text-muted-foreground">Proof {version.label} · {version.outcome}</div>
            </div>
            <span className="ml-auto text-[10.5px] text-muted-foreground">
              Proofs are for approval only — Prepress prepares production art later.
            </span>
          </Card>

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
                    {s === "Single" ? "Proof" : s}
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
                <span className="num font-semibold uppercase tracking-wide">Proof {version.label}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-semibold uppercase tracking-wide">{viewSide === "Single" ? "Proof" : viewSide}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-semibold">{isCurrent ? job.status : version.outcome}</span>
              </span>
            }
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                <span className="num truncate text-muted-foreground">
                  PROOF {version.label.toUpperCase()} · {viewSide === "Single" ? "PROOF" : viewSide.toUpperCase()} · {page.name}
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => toast.success(`Downloading ${page.name}`)}>Download</Button>
                  {!isCurrent && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { setViewVersionId(job.currentVersionId); setZoom(1); }}>
                      Back to Current
                    </Button>
                  )}
                </div>
              </div>
            }
          >
            <Stage label={`${page.name} ${viewSide}`} zoom={zoom} />
          </ArtworkViewerPanel>

          {!isCurrent && (
            <div className="rounded border border-border bg-surface-2/40 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
              You are viewing <span className="num font-semibold text-foreground">{version.label}</span> — {version.state.toLowerCase()}. It is kept for history and is not the proof awaiting response.
            </div>
          )}

          {/* proof versions strip */}
          <Card>
            <SectionTitle>Proof Versions</SectionTitle>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {job.versions.map((v) => (
                <div key={v.id} className={cn("rounded border p-1.5", v.id === viewVersionId ? "border-primary bg-primary/[0.07]" : "border-border bg-surface-2/40")}>
                  <VersionRow v={v} active={v.id === viewVersionId} onSelect={() => { setViewVersionId(v.id); setViewSide(v.pages[0]!.side); setZoom(1); }} />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10.5px]" onClick={() => { setViewVersionId(v.id); setViewSide(v.pages[0]!.side); setZoom(1); }}>Preview</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10.5px]" onClick={() => toast.success(`Downloading ${v.file}`)}>Download</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10.5px]"
                      onClick={() => { toggle("history", true); toast.info(`Showing feedback for proof ${v.label}`); }}
                    >
                      Feedback
                    </Button>
                  </div>
                  {v.approvedAt && (
                    <div className="mt-1 rounded border border-ok/40 bg-ok/10 px-1.5 py-1 text-[10.5px] text-ok">
                      Approved by {v.approvedBy} · {v.approvedAt}
                    </div>
                  )}
                  {v.note && <div className="mt-1 text-[10.5px] text-muted-foreground">{v.note}</div>}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              Approval applies to the exact version approved. A new proof version requires its own approval.
            </p>
          </Card>
        </div>
      </main>

      {/* --------------------------------------------- RIGHT: proof status */}
      <aside className="flex w-[318px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border p-2.5">
        <Card>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proof Status</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[17px] font-bold leading-none tracking-tight">{job.status}</span>
            <Status value={job.status} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
            <Spec label="Current Version" value={<span className="num">{job.versions.find((v) => v.id === job.currentVersionId)?.label}</span>} />
            <Spec label="Sidedness" value={job.sides === 2 ? "Double-sided" : "Single-sided"} />
            <Spec label="Sent" value={currentV(job)?.sentAt ?? "Not sent"} />
            <Spec label="Last Viewed" value={currentV(job)?.viewedAt ?? "Not viewed"} />
            {currentV(job)?.approvedAt && <Spec label="Approved" value={currentV(job)!.approvedAt!} />}
            {currentV(job)?.revisionAt && <Spec label="Revision Requested" value={currentV(job)!.revisionAt!} />}
            <Spec label="Due" value={job.due} />
            <Spec label="Priority" value={job.priority} />
          </div>
          {job.status === "Approved" && (
            <div className="mt-2 rounded border border-ok/40 bg-ok/10 p-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ok">
                <Check className="size-3.5" />Approved
              </div>
              <div className="text-[12.5px] font-medium">by {currentV(job)?.approvedBy}</div>
              <div className="text-[11px] text-muted-foreground">{currentV(job)?.approvedAt} · proof {currentV(job)?.label}</div>
            </div>
          )}
          {(job.status === "Sent" || job.status === "Viewed" || job.status === "Awaiting Customer") && (
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Viewed is not approved. Awaiting customer is not approved.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle action={
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10.5px] uppercase tracking-wide" onClick={() => setRecipDlg(true)}>
              <Plus className="mr-1 size-3" />Add
            </Button>
          }>Recipients</SectionTitle>
          <div className="mt-1.5 space-y-1.5">
            {recipients.map((r) => (
              <div key={r.id} className="flex items-start gap-2 rounded border border-border bg-background/40 px-1.5 py-1">
                <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{r.name}</div>
                  <div className="num truncate text-[11px] text-muted-foreground">{r.email}</div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {r.role ?? "Contact"}{r.lastViewed ? ` · viewed ${r.lastViewed}` : " · no view recorded"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  className="text-muted-foreground hover:text-late"
                  onClick={() => {
                    setRecipientsByJob((m) => ({ ...m, [selectedId]: (m[selectedId] ?? job.recipients).filter((x) => x.id !== r.id) }));
                    toast.success(`${r.name} removed from this proof`);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {recipients.length === 0 && <p className="text-[11.5px] text-muted-foreground">No recipients yet — add one before sending.</p>}
          </div>
        </Card>

        <Card className="border-primary/40 bg-primary/[0.06]">
          <SectionTitle>Next</SectionTitle>
          <div className="mt-0.5 text-[14px] font-semibold">{next.label}</div>
          <Button
            size="sm"
            variant={next.tone === "primary" ? "default" : "secondary"}
            className="mt-2 h-9 w-full text-[12.5px] font-semibold uppercase tracking-wide"
            disabled={next.cta === "Send Proof" && recipients.length === 0}
            onClick={() => toast.success(`${next.cta} — ${job.item}`)}
          >
            {next.cta === "Send Proof" || next.cta === "Resend Proof" ? <Send className="mr-1.5 size-3.5" /> : null}
            {next.cta}
          </Button>
          {next.cta === "Send Proof" && recipients.length === 0 && (
            <p className="mt-1 text-[10.5px] text-warn">Add a recipient before sending this proof.</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {next.extras.map((x) => (
              <Button
                key={x}
                size="sm"
                variant="ghost"
                className="h-7 flex-1 text-[11px]"
                onClick={() => (x === "Add Recipient" ? setRecipDlg(true) : toast.success(`${x} — ${job.item}`))}
              >
                {x}
              </Button>
            ))}
          </div>
        </Card>

        <RailSection
          title="Latest Customer Feedback"
          unread={unread.feedback ?? 0}
          open={open.feedback}
          onOpenChange={(o) => toggle("feedback", o)}
        >
          {latest ? (
            <>
              <p className="text-[13.5px] font-medium leading-snug">“{latest.body}”</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {latest.author} · {latest.when} · Proof {latest.version} · {latest.kind}
              </p>
            </>
          ) : (
            <p className="text-[11.5px] text-muted-foreground">No customer feedback on this proof yet.</p>
          )}
        </RailSection>

        <RailSection
          title="Proof Versions"
          unread={unread.versions ?? 0}
          open={open.versions}
          onOpenChange={(o) => toggle("versions", o)}
        >
          <div className="space-y-1">
            {job.versions.map((v) => (
              <VersionRow
                key={v.id}
                v={v}
                active={v.id === viewVersionId}
                onSelect={() => { setViewVersionId(v.id); setViewSide(v.pages[0]!.side); setZoom(1); }}
              />
            ))}
          </div>
        </RailSection>

        <RailSection
          title="Feedback History"
          unread={unread.history ?? 0}
          open={open.history}
          onOpenChange={(o) => toggle("history", o)}
        >
          <div className="space-y-1.5">
            {feedback.map((f) => (
              <div key={f.id} className="border-l-2 border-l-border pl-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="num text-[11px] font-bold">Proof {f.version}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.kind}</span>
                </div>
                <p className="text-[12px] leading-snug">“{f.body}”</p>
                <p className="text-[10.5px] text-muted-foreground">{f.author} · {f.when}</p>
              </div>
            ))}
            {feedback.length === 0 && <p className="text-[11.5px] text-muted-foreground">No feedback recorded.</p>}
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
      </aside>

      {/* ------------------------------------------------------- dialogs */}
      <Dialog open={recipDlg} onOpenChange={setRecipDlg}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="text-[14px]">Add Recipient</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input value={recipName} onChange={(e) => setRecipName(e.target.value)} placeholder="Name" className="h-8 text-[12.5px]" />
            <Input value={recipEmail} onChange={(e) => setRecipEmail(e.target.value)} placeholder="Email" className="h-8 text-[12.5px]" />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setRecipDlg(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-[12px]"
              disabled={!recipName.trim() || !recipEmail.trim()}
              onClick={() => {
                setRecipientsByJob((m) => ({
                  ...m,
                  [selectedId]: [...(m[selectedId] ?? job.recipients), { id: `r-${Date.now()}`, name: recipName.trim(), email: recipEmail.trim(), role: "Added by Proofing" }],
                }));
                setRecipName(""); setRecipEmail(""); setRecipDlg(false);
                toast.success("Recipient added to this proof");
              }}
            >
              Add Recipient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={respondDlg} onOpenChange={setRespondDlg}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader><DialogTitle className="text-[14px]">Customer Proof Response</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded border border-border bg-surface-2/40 px-2.5 py-2 text-[12px]">
              <span className="num font-semibold">Proof {version.label}</span> · {job.item} · {job.customer}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-9 flex-1 text-[12.5px] font-semibold uppercase tracking-wide"
                onClick={() => { setRespondDlg(false); toast.success(`Proof ${version.label} approved by the customer`); }}
              >
                <Check className="mr-1.5 size-3.5" />Approve Proof
              </Button>
              <Button size="sm" variant="secondary" className="h-9 flex-1 text-[12.5px] font-semibold uppercase tracking-wide">
                <X className="mr-1.5 size-3.5" />Request Changes
              </Button>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tell us what needs to change.</div>
              <Textarea value={changeText} onChange={(e) => setChangeText(e.target.value)} className="mt-1 min-h-[64px] text-[12px]" placeholder="Move the logo up one inch…" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setRespondDlg(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-[12px]"
              disabled={changeText.trim().length < 3}
              onClick={() => {
                const entry: ProofFeedback = {
                  id: `fb-${Date.now()}`, version: version.label, body: changeText.trim(),
                  author: recipients[0]?.name ?? "Customer", when: "just now", kind: "Revision Requested",
                };
                setFeedbackByJob((m) => ({ ...m, [selectedId]: [entry, ...(m[selectedId] ?? job.feedback)] }));
                setUnreadByJob((u) => ({ ...u, [selectedId]: { ...(u[selectedId] ?? {}), feedback: 1 } }));
                setChangeText(""); setRespondDlg(false);
                toast.warning("Changes requested — proof returned for revision");
              }}
            >
              Submit Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              Proof {version.label} · {viewSide === "Single" ? "Proof" : viewSide} · {page.name}
            </DialogTitle>
          </DialogHeader>
          <Stage label={page.name} zoom={zoom} />
          <div className="flex justify-center">
            <ViewerControls zoom={zoom} setZoom={setZoom} onFullscreen={() => setFullscreen(false)} fullscreenLabel="Exit" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function currentV(job: ProofJob): ProofVersion | undefined {
  return job.versions.find((v) => v.id === job.currentVersionId);
}
