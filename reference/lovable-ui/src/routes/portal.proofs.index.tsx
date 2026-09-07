import { createFileRoute, Link } from "@tanstack/react-router";
import { FileCheck2 } from "lucide-react";
import { EmptyState, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { proofs } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/proofs/")({
  head: () => ({
    meta: [
      { title: "Proofs — Hensley Print Co." },
      { name: "description", content: "Review, approve or request revisions on the proofs for your print jobs." },
      { property: "og:title", content: "Proofs — Hensley Print Co." },
      { property: "og:description", content: "Approve proofs in a couple of taps so production can start." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProofsPage,
});

function ProofsPage() {
  const { proofOverrides } = usePortalStore();
  const list = proofs.map((p) => ({ ...p, status: proofOverrides[p.id] ?? p.status }));
  const waiting = list.filter((p) => p.status === "Awaiting Your Approval");
  const rest = list.filter((p) => p.status !== "Awaiting Your Approval");

  return (
    <PortalPage title="Proofs" description="Approve a proof and we'll move it straight into production.">
      <Section title={`Action required (${waiting.length})`} bare>
        {waiting.length === 0 ? (
          <EmptyState icon={FileCheck2} title="Nothing waiting on you" message="We'll email you as soon as a new proof is ready to review." />
        ) : (
          <ProofRows rows={waiting} />
        )}
      </Section>

      <Section className="mt-4" title="Proof history" bare>
        {rest.length === 0 ? <EmptyState title="No past proofs yet" /> : <ProofRows rows={rest} />}
      </Section>
    </PortalPage>
  );
}

function ProofRows({ rows }: { rows: (typeof proofs) }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            to="/portal/proofs/$id"
            params={{ id: p.id }}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 sm:px-5"
          >
            <div
              className="size-12 shrink-0 rounded-md border border-border"
              style={{ background: `linear-gradient(140deg, oklch(0.84 0.08 ${p.hue} / 0.6), oklch(0.7 0.1 ${p.hue} / 0.35))` }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.jobName}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {p.orderNumber} · Version {p.version} · Sent {shortDate(p.sentOn)} · {p.size}
              </p>
            </div>
            <StatusPill value={p.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
