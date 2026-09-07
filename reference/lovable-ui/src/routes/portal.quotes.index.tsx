import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { EmptyState, Money, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { quotes } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";

export const Route = createFileRoute("/portal/quotes/")({
  head: () => ({
    meta: [
      { title: "Quotes — Hensley Print Co." },
      { name: "description", content: "Review open and past print quotes, expiration dates, totals and related orders." },
      { property: "og:title", content: "Quotes — Hensley Print Co." },
      { property: "og:description", content: "Accept a quote and we'll turn it into an order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotesPage,
});

function QuotesPage() {
  const open = quotes.filter((q) => q.status === "Open");
  const past = quotes.filter((q) => q.status !== "Open");

  return (
    <PortalPage title="Quotes" description="Pricing we've prepared for you.">
      <Section title={`Open quotes (${open.length})`} bare>
        {open.length === 0 ? (
          <EmptyState icon={FileText} title="No open quotes" message="Ask your account representative for a quote and it will appear here." />
        ) : (
          <QuoteRows rows={open} />
        )}
      </Section>
      <Section className="mt-4" title="Quote history" bare>
        {past.length === 0 ? <EmptyState title="No past quotes yet" /> : <QuoteRows rows={past} />}
      </Section>
    </PortalPage>
  );
}

function QuoteRows({ rows }: { rows: typeof quotes }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((q) => (
        <li key={q.id}>
          <Link
            to="/portal/quotes/$id"
            params={{ id: q.id }}
            className="grid gap-2 px-4 py-3 transition-colors hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{q.number}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {shortDate(q.date)} · Expires {shortDate(q.expiresOn)} · {q.lines.length} item{q.lines.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill value={q.status} />
              <Money value={q.total} className="text-sm font-semibold" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
