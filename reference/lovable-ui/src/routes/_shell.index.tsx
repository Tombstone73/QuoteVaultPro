import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle, Boxes, Building2, FileText, Package, Plus, Search, Bot, ArrowRight,
} from "lucide-react";
import { useApp } from "@/lib/app-store";
import { Metric, Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { customers, docTotal, materials, money, products } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/")({
  head: () => ({
    meta: [
      { title: "Command Center — PrintersHero V2" },
      { name: "description", content: "Operations command center for a commercial print shop: proofs, prepress, production, pickups, invoices and material shortages at a glance." },
      { property: "og:title", content: "Command Center — PrintersHero V2" },
      { property: "og:description", content: "One screen for what needs attention today across the whole print shop." },
    ],
  }),
  component: CommandCenter,
});

const ATTENTION = [
  { label: "Proofs awaiting approval", count: 7, tone: "warn", to: "/artwork" },
  { label: "Prepress waiting", count: 4, tone: "warn", to: "/prepress" },
  { label: "Due today", count: 9, tone: "info", to: "/production" },
  { label: "Late jobs", count: 3, tone: "late", to: "/production" },
  { label: "Ready for pickup", count: 5, tone: "ok", to: "/fulfillment" },
  { label: "Waiting to ship", count: 2, tone: "info", to: "/shipping" },
  { label: "Unpaid invoices", count: 11, tone: "warn", to: "/invoices" },
  { label: "Material shortages", count: 2, tone: "late", to: "/inventory" },
  { label: "Failed integrations", count: 1, tone: "late", to: "/integrations" },
  { label: "Inbound needing review", count: 3, tone: "info", to: "/inbound" },
] as const;

function CommandCenter() {
  const { docs, setPaletteOpen, setAiOpen } = useApp();
  const orders = docs.filter((d) => d.documentType === "Order");
  const jobs = orders.flatMap((o) =>
    o.lines.map((l) => ({
      order: o.number,
      customer: customers.find((c) => c.id === o.customerId)?.name ?? "",
      product: products.find((p) => p.id === l.productId)?.name ?? l.description,
      qty: l.qty,
      step: l.routeStep,
      due: o.dueDate,
      station: l.station ?? "—",
      status: o.status,
    })),
  );
  const short = materials.filter((m) => m.onHand - m.reserved < m.reorder);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Command Center</h1>
          <p className="text-[13px] text-muted-foreground">Saturday, August 15 · 3 late jobs · 9 due today</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" className="h-8 gap-1.5" asChild><Link to="/quotes"><Plus className="size-4" />New Quote</Link></Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild><Link to="/orders"><FileText className="size-4" />New Order</Link></Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild><Link to="/customers"><Building2 className="size-4" />New Customer</Link></Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild><Link to="/procurement"><Boxes className="size-4" />Receive Material</Link></Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPaletteOpen(true)}><Search className="size-4" />Search</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setAiOpen(true)}><Bot className="size-4" />AI</Button>
        </div>
      </div>

      <Panel title="Needs Attention" dense>
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5">
          {ATTENTION.map((a) => (
            <Link
              key={a.label} to={a.to}
              className="group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-accent"
            >
              <span className="text-[12px] leading-tight text-muted-foreground group-hover:text-foreground">{a.label}</span>
              <span
                className={
                  "num text-lg font-semibold " +
                  (a.tone === "late" ? "text-late" : a.tone === "warn" ? "text-warn" : a.tone === "ok" ? "text-ok" : "text-foreground")
                }
              >
                {a.count}
              </span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Today's Production"
          dense
          action={<Link to="/production" className="flex items-center gap-1 text-[12px] text-primary hover:underline">Board <ArrowRight className="size-3" /></Link>}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Job</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Product</th>
                  <th className={th + " text-right"}>Qty</th>
                  <th className={th}>Step</th>
                  <th className={th}>Station</th>
                  <th className={th}>Due</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={i} className="row-h border-t border-border hover:bg-accent/60">
                    <td className={td}>
                      <Link to="/sales/$id" params={{ id: j.order }} className="num text-primary hover:underline">#{j.order}</Link>
                    </td>
                    <td className={td + " max-w-[160px] truncate"}>{j.customer}</td>
                    <td className={td}>
                      <span className="flex items-center gap-2">
                        <Thumb label={j.product} />
                        <span className="truncate">{j.product}</span>
                      </span>
                    </td>
                    <td className={td + " num text-right"}>{j.qty}</td>
                    <td className={td}>{j.step}</td>
                    <td className={td + " text-muted-foreground"}>{j.station}</td>
                    <td className={td + " num"}>{j.due.replace(", 2026", "")}</td>
                    <td className={td}><Status value={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Sales this week" value={money(42300)} hint="+9% vs last week" tone="ok" />
            <Metric label="Orders today" value="6" hint="2 from storefront" />
            <Metric label="Quotes awaiting" value="8" hint={money(31480) + " open"} />
            <Metric label="A/R balance" value={money(32630)} hint="4 invoices past due" tone="warn" />
          </div>

          <Panel title="Quotes Awaiting Response" dense>
            <ul className="divide-y divide-border">
              {docs.filter((d) => d.documentType === "Quote" && d.status !== "Converted").map((q) => (
                <li key={q.id}>
                  <Link to="/sales/$id" params={{ id: q.number }} className="flex items-center gap-2 px-3 py-2 hover:bg-accent">
                    <span className="num text-[12px] text-primary">#{q.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{customers.find((c) => c.id === q.customerId)?.name}</span>
                    <span className="num text-[12px]">{money(docTotal(q))}</span>
                    <Status value={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Material Shortages" dense>
            <ul className="divide-y divide-border">
              {short.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <AlertTriangle className="size-3.5 text-late" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
                  <span className="num text-[12px] text-muted-foreground">
                    {m.onHand - m.reserved} / {m.reorder} {m.unit}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
                    <Link to="/procurement">Order</Link>
                  </Button>
                </li>
              ))}
              {short.length === 0 && <li className="px-3 py-4 text-[13px] text-muted-foreground">Stock is healthy.</li>}
            </ul>
          </Panel>

          <Panel title="Inbound Needing Review" dense>
            <Link to="/inbound" className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent">
              <Package className="size-4 text-warn" />
              <span className="flex-1 text-[13px]">3 requests parsed and waiting</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
