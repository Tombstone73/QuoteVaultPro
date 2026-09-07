import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentLink, EmptyState, KeyValue, Money, Notice, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { orders, quotes } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";

export const Route = createFileRoute("/portal/quotes/$id")({
  head: () => ({
    meta: [
      { title: "Quote Detail — Hensley Print Co." },
      { name: "description", content: "Quote items, configuration, pricing, documents and any related order." },
      { property: "og:title", content: "Quote Detail — Hensley Print Co." },
      { property: "og:description", content: "Review your quote and accept it when you're ready." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuoteDetail,
});

function QuoteDetail() {
  const { id } = Route.useParams();
  const quote = quotes.find((q) => q.id === id);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  if (!quote) {
    return (
      <PortalPage title="Quote unavailable">
        <Section bare>
          <EmptyState icon={FileText} title="We couldn't open that quote" action={<Button asChild><Link to="/portal/quotes">Back to quotes</Link></Button>} />
        </Section>
      </PortalPage>
    );
  }

  const relatedOrder = quote.convertedOrderId ? orders.find((o) => o.id === quote.convertedOrderId) : undefined;
  const status = accepted ? "Accepted" : quote.status;

  return (
    <PortalPage
      title={quote.number}
      description={`Prepared ${shortDate(quote.date)} · Expires ${shortDate(quote.expiresOn)}`}
      actions={
        <Button variant="outline" asChild>
          <Link to="/portal/quotes">
            <ArrowLeft className="mr-2 size-4" />
            All quotes
          </Link>
        </Button>
      }
    >
      {accepted && (
        <Notice tone="ok" title="Quote accepted">
          Thanks — your account representative will confirm the schedule and turn this into an order.
        </Notice>
      )}
      {quote.status === "Expired" && !accepted && (
        <Notice tone="warn" title="This quote has expired">
          Pricing may have changed. Contact your account representative for a refreshed quote.
        </Notice>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Section title="Items" bare>
            <ul className="divide-y divide-border">
              {quote.lines.map((l) => (
                <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-4 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{l.product}</p>
                    <p className="text-[13px] text-muted-foreground">{l.description}</p>
                    <p className="mt-1 text-[13px]">
                      {l.size ? `${l.size} · ` : ""}Qty {l.qty.toLocaleString()}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {l.options.map((o) => (
                        <li key={o} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="text-right">
                    <Money value={l.total} className="block text-sm font-semibold" />
                    <span className="text-[12px] text-muted-foreground">
                      <Money value={l.unitPrice} /> each
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Documents" bare>
            <div className="space-y-2 p-4 sm:p-5">
              {quote.documents.map((d) => (
                <DocumentLink key={d.name} name={d.name} date={shortDate(d.date)} />
              ))}
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Summary">
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Status"><StatusPill value={status} /></KeyValue>
              <KeyValue label="Total"><Money value={quote.total} /></KeyValue>
              {quote.po && <KeyValue label="Your PO">{quote.po}</KeyValue>}
              <KeyValue label="Valid until">{shortDate(quote.expiresOn)}</KeyValue>
            </dl>
            {status === "Open" && (
              <Button
                className="mt-4 w-full"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setTimeout(() => {
                    setBusy(false);
                    setAccepted(true);
                  }, 700);
                }}
              >
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Accept quote
              </Button>
            )}
            {relatedOrder && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">Related order</p>
                <Link to="/portal/orders/$id" params={{ id: relatedOrder.id }} className="text-sm font-medium text-primary hover:underline">
                  {relatedOrder.number}
                </Link>
              </div>
            )}
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
