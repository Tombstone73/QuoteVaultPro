import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money, docGrand, invoicePaid, type Invoice, type SalesDoc } from "@/lib/mock/data";
import {
  artworkSummary,
  fulfillmentContext,
  productionSummary,
  proofingSummary,
  type Tone,
} from "@/lib/mock/order-context";

/**
 * Compact cross-module band: CONTEXT SUMMARY → DIRECT RECORD ACTION → OWNING MODULE.
 * Read-only aggregation with record-scoped links; no workflow logic lives in Sales.
 */

const toneText: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-destructive",
  info: "text-primary",
  neutral: "text-foreground",
};

function Cell({
  title,
  tone = "neutral",
  headline,
  lines,
  action,
  children,
}: {
  title: string;
  tone?: Tone;
  headline: string;
  lines: string[];
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 basis-52 border-border px-3 py-2 not-last:border-r">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className={cn("num mt-0.5 truncate text-[13px] font-semibold", toneText[tone])}>
        {headline}
      </div>
      {lines.map((l) => (
        <div key={l} className="truncate text-[11px] text-muted-foreground">
          {l}
        </div>
      ))}
      {children}
      <div className="mt-1.5 flex flex-wrap gap-1">{action}</div>
    </div>
  );
}

export function OrderContextBand({
  doc,
  invoice,
}: {
  doc: SalesDoc;
  invoice?: Invoice | undefined;
}) {
  const [openFulfill, setOpenFulfill] = useState(false);
  const art = artworkSummary(doc);
  const proof = proofingSummary(doc);
  const prod = productionSummary(doc);
  const ful = fulfillmentContext(doc);
  const total = docGrand(doc);
  const paid = invoice ? invoicePaid(invoice) : 0;

  return (
    <div className="panel mb-3 flex flex-wrap items-stretch divide-border">
      <Cell
        title="Artwork"
        tone={art.tone}
        headline={`${art.ready}/${art.lines} lines ready`}
        lines={[art.label]}
        action={
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
            <Link to="/artwork" search={{ order: doc.number }}>
              Open Artwork
            </Link>
          </Button>
        }
      />

      <Cell
        title="Proofing"
        tone={proof.tone}
        headline={proof.label}
        lines={proof.counts.map((c) => `${c.n} ${c.label}`)}
        action={
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
            <Link
              to="/proofing"
              search={proof.jobId ? { order: doc.number, job: proof.jobId } : { order: doc.number }}
            >
              Open Proof
            </Link>
          </Button>
        }
      />

      <Cell
        title="Production"
        tone={prod.tone}
        headline={`${prod.complete} complete · ${prod.active} active`}
        lines={[prod.stations.length ? `Current: ${prod.stations.join(", ")}` : prod.label]}
        action={
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
            <Link
              to="/production"
              search={{
                order: doc.number,
                ...(prod.stations[0] ? { station: prod.stations[0] } : {}),
              }}
            >
              Open Production
            </Link>
          </Button>
        }
      />

      <Cell
        title="Fulfillment"
        tone={ful.tone}
        headline={`${ful.fulfilled}/${ful.ordered} pcs · ${ful.status}`}
        lines={[
          `Method: ${ful.method}`,
          ful.latest
            ? `Latest: ${ful.latest}`
            : `${ful.visits} handoff${ful.visits === 1 ? "" : "s"} recorded`,
        ]}
        action={
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
            <Link to="/fulfillment" search={{ order: doc.number }}>
              Open Fulfillment
            </Link>
          </Button>
        }
      >
        <button
          type="button"
          onClick={() => setOpenFulfill((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ChevronDown className={cn("size-3 transition-transform", openFulfill && "rotate-180")} />
          {openFulfill ? "Hide lines" : "Per line"}
        </button>
        {openFulfill && (
          <ul className="mt-1 space-y-0.5">
            {ful.lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-muted-foreground">{l.item}</span>
                <span
                  className={cn(
                    "num shrink-0",
                    l.done >= l.qty ? "text-ok" : "text-muted-foreground",
                  )}
                >
                  {l.done}/{l.qty}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cell>

      <Cell
        title="Billing"
        tone={total - paid <= 0 ? "ok" : "warn"}
        headline={`${money(total - paid)} balance`}
        lines={[
          `${invoice?.number ?? "No invoice"}${invoice ? ` · ${invoice.status}` : ""}`,
          `Total ${money(total)} · Paid ${money(paid)}`,
        ]}
        action={
          invoice ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
                <Link to="/invoices/$id" params={{ id: invoice.id }}>
                  Open Invoice
                </Link>
              </Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
                <Link to="/invoices/$id" params={{ id: invoice.id }} search={{ pay: true }}>
                  Make Payment
                </Link>
              </Button>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Invoice is created on order confirmation.
            </span>
          )
        }
      />
    </div>
  );
}
