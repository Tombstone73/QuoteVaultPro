import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FileCheck2, Loader2, Maximize2, MessageSquare, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, KeyValue, Notice, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { proofs } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/proofs/$id")({
  head: () => ({
    meta: [
      { title: "Proof Review — Hensley Print Co." },
      { name: "description", content: "View your proof at full size, approve it, or request a revision with comments." },
      { property: "og:title", content: "Proof Review — Hensley Print Co." },
      { property: "og:description", content: "Approve or request changes before we print." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProofDetail,
});

function ProofDetail() {
  const { id } = Route.useParams();
  const { proofOverrides, setProofStatus } = usePortalStore();
  const proof = proofs.find((p) => p.id === id);

  const [zoom, setZoom] = useState(1);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "revision" | null>(null);

  if (!proof) {
    return (
      <PortalPage title="Proof unavailable">
        <Section bare>
          <EmptyState
            icon={FileCheck2}
            title="We couldn't open that proof"
            message="It may have been replaced by a newer version."
            action={<Button asChild><Link to="/portal/proofs">Back to proofs</Link></Button>}
          />
        </Section>
      </PortalPage>
    );
  }

  const status = proofOverrides[proof.id] ?? proof.status;
  const actionable = status === "Awaiting Your Approval";

  const submit = (kind: "approved" | "revision") => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      setBusy(false);
      setApproveOpen(false);
      setReviseOpen(false);
      setProofStatus(proof.id, kind === "approved" ? "Approved" : "Revision Requested");
      setDone(kind);
    }, 800);
  };

  return (
    <PortalPage
      title={proof.jobName}
      description={`${proof.orderNumber} · Version ${proof.version} · Sent ${shortDate(proof.sentOn)}`}
      actions={
        <Button variant="outline" asChild>
          <Link to="/portal/proofs">
            <ArrowLeft className="mr-2 size-4" />
            All proofs
          </Link>
        </Button>
      }
    >
      {done === "approved" && (
        <Notice tone="ok" title="Proof approved">
          Thanks — this job is released to production. You&apos;ll see it move on the order.
        </Notice>
      )}
      {done === "revision" && (
        <Notice tone="warn" title="Revision requested">
          Our design team has your comments and will send a new version.
        </Notice>
      )}
      {error && <Notice tone="danger" title="We couldn't record that">{error}</Notice>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section bare>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Button size="icon" variant="ghost" className="size-8" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                <ZoomOut className="size-4" />
              </Button>
              <span className="w-12 text-center text-[12px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setZoom(1)}>
                Fit
              </Button>
            </div>
            <Button size="sm" variant="outline" className="h-8" asChild>
              <a href="#" onClick={(e) => e.preventDefault()}>
                <Maximize2 className="mr-1.5 size-3.5" />
                Open PDF
              </a>
            </Button>
          </div>
          <div className="flex min-h-[320px] items-center justify-center overflow-auto bg-muted/50 p-6 sm:min-h-[480px]">
            <div
              className="rounded-md border border-border shadow-sm transition-transform"
              style={{
                width: 420,
                height: 260,
                transform: `scale(${zoom})`,
                background: `linear-gradient(140deg, oklch(0.88 0.07 ${proof.hue} / 0.75), oklch(0.7 0.11 ${proof.hue} / 0.45))`,
              }}
              aria-label={`Proof preview for ${proof.jobName}`}
            />
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="This proof">
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Status"><StatusPill value={status} /></KeyValue>
              <KeyValue label="Version">v{proof.version}</KeyValue>
              <KeyValue label="Size">{proof.size}</KeyValue>
              <KeyValue label="Order">
                <Link to="/portal/orders/$id" params={{ id: proof.orderId }} className="text-primary hover:underline">
                  {proof.orderNumber}
                </Link>
              </KeyValue>
            </dl>

            {actionable ? (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <Button className="w-full" onClick={() => setApproveOpen(true)}>
                  <CheckCircle2 className="mr-2 size-4" />
                  Approve proof
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setReviseOpen(true)}>
                  <MessageSquare className="mr-2 size-4" />
                  Request revision
                </Button>
                <p className="text-center text-[12px] text-muted-foreground">
                  Approving releases this job to print exactly as shown.
                </p>
              </div>
            ) : (
              <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted-foreground">
                This proof is closed. Past proofs stay here for your records.
              </p>
            )}
          </Section>

          <Section title="Version history" bare>
            <ol className="divide-y divide-border">
              {[...proof.history].reverse().map((h, i) => (
                <li key={i} className="px-4 py-3 sm:px-5">
                  <p className="text-[13px] font-medium">
                    v{h.version} · {h.event}
                  </p>
                  <p className="text-[12px] text-muted-foreground">{shortDate(h.date)}</p>
                  {h.note && <p className="mt-1 rounded-md bg-muted px-2.5 py-1.5 text-[12px]">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this proof?</DialogTitle>
            <DialogDescription>
              We&apos;ll print {proof.jobName} exactly as shown in version {proof.version}. Changes after approval may
              affect your schedule and price.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={() => submit("approved")} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Yes, approve and print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a revision</DialogTitle>
            <DialogDescription>Tell us what to change. The more specific, the faster the next version.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Move the phone number below the logo and darken the green." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!comment.trim()) {
                  setError("Add a short note so our designer knows what to change.");
                  setReviseOpen(false);
                  return;
                }
                submit("revision");
              }}
              disabled={busy}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send revision request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalPage>
  );
}
