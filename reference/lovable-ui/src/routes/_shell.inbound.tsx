import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { inboundOrders } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/inbound")({
  head: () => ({
    meta: [
      { title: "Inbound Orders — PrintersHero V2" },
      { name: "description", content: "Emails, PDF purchase orders and storefront submissions parsed into draft orders with confidence scores you can review before accepting." },
      { property: "og:title", content: "Inbound Orders — PrintersHero V2" },
      { property: "og:description", content: "Turn messy customer emails into structured orders." },
    ],
  }),
  component: InboundPage,
});

function InboundPage() {
  const [sel, setSel] = useState(inboundOrders[0]!.id);
  const item = inboundOrders.find((i) => i.id === sel)!;

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Inbound Orders" subtitle="Nothing is created until a human accepts it." />
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel dense>
          <ul className="divide-y divide-border">
            {inboundOrders.map((i) => (
              <li key={i.id}>
                <button onClick={() => setSel(i.id)} className={`w-full px-3 py-2.5 text-left ${sel === i.id ? "bg-accent" : "hover:bg-accent/60"}`}>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{i.source}</span><span className="num">{Math.round(i.confidence * 100)}%</span></div>
                  <div className="mt-0.5 truncate text-[13px] font-medium">{i.subject}</div>
                  <div className="num truncate text-[11px] text-muted-foreground">{i.from} · {i.received}</div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-3">
          <Panel title="Original message">
            <pre className="whitespace-pre-wrap font-sans text-[13px] text-muted-foreground">{item.body}</pre>
          </Panel>
          <Panel title="Parsed order" dense action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[12px]">Ignore</Button>
              <Button size="sm" className="h-7 text-[12px]" onClick={() => toast.success("Draft order created for review")}>Accept as Draft Order</Button>
            </div>
          }>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-border p-3 text-[13px] sm:grid-cols-4">
              <div><div className="text-[11px] uppercase text-muted-foreground">Customer</div>{item.parsed.customer}</div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Contact</div>{item.parsed.contact}</div>
              <div><div className="text-[11px] uppercase text-muted-foreground">PO</div><span className="num">{item.parsed.po}</span></div>
              <div><div className="text-[11px] uppercase text-muted-foreground">Due</div><span className="num">{item.parsed.due}</span></div>
            </div>
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Product</th><th className={th}>Size</th><th className={th + " text-right"}>Qty</th><th className={th + " text-right"}>Confidence</th><th className={th}>Needs review</th></tr></thead>
              <tbody>
                {item.lines.map((l, i) => (
                  <tr key={i} className="row-h border-t border-border">
                    <td className={td}>{l.product}</td>
                    <td className={td + " num text-muted-foreground"}>{l.size}</td>
                    <td className={td + " num text-right"}>{l.qty}</td>
                    <td className={td + " num text-right"}>{Math.round(l.confidence * 100)}%</td>
                    <td className={td}>{l.missing.length ? <Status value="Needs Artwork" /> : <span className="text-[12px] text-muted-foreground">—</span>}{l.missing.length ? <span className="ml-2 text-[12px] text-muted-foreground">{l.missing.join(", ")}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
