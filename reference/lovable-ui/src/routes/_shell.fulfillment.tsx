import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, Truck, PackageCheck } from "lucide-react";
import { PageHeader, Panel, Status, Thumb } from "@/components/app/primitives";
import { AggregateChip, LineRow, OrderGroup, QueueToolbarToggles } from "@/components/app/order-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fulfillOrders, summarize, type FulfillLine } from "@/lib/mock/fulfillment";

export const Route = createFileRoute("/_shell/fulfillment")({
  head: () => ({
    meta: [
      { title: "Fulfillment — PrintersHero V2" },
      { name: "description", content: "Order-aware fulfillment queue: expand an order to see line-level pickup, delivery and shipment progress." },
      { property: "og:title", content: "Fulfillment — PrintersHero V2" },
      { property: "og:description", content: "Partial pickups without breaking the order." },
    ],
  }),
  component: FulfillmentPage,
});

function FulfillmentPage() {
  const [orders, setOrders] = useState(fulfillOrders);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([fulfillOrders[0]!.order]));
  const [activeLine, setActiveLine] = useState<string>(fulfillOrders[0]!.lines[0]!.id);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders
      .filter((o) => !t || `${o.order} ${o.customer} ${o.lines.map((l) => l.item).join(" ")}`.toLowerCase().includes(t))
      .slice()
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || Number(b.rush) - Number(a.rush));
  }, [orders, q]);

  const toggle = (order: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order); else next.add(order);
      return next;
    });

  const record = (orderNo: string, lineId: string, all: boolean) =>
    setOrders((prev) =>
      prev.map((o) =>
        o.order !== orderNo
          ? o
          : {
              ...o,
              lines: o.lines.map((l) => {
                if (l.id !== lineId) return l;
                const done = all ? l.qty : Math.min(l.qty, l.done + Math.max(1, Math.ceil((l.qty - l.done) / 2)));
                return { ...l, done, status: done >= l.qty ? "Complete" : "Partially Picked Up" } as FulfillLine;
              }),
            },
      ),
    );

  const active = list.flatMap((o) => o.lines.map((l) => ({ o, l }))).find(({ l }) => l.id === activeLine);

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Fulfillment"
        subtitle="Orders group the work; each line item can still be handed off on its own."
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, product…" className="h-8 w-64 pl-7 text-[13px]" />
            </div>
            <QueueToolbarToggles
              onExpandAll={() => setExpanded(new Set(list.map((o) => o.order)))}
              onCollapseAll={() => setExpanded(new Set())}
            />
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-1.5">
          {list.map((o) => {
            const s = summarize(o);
            const open = expanded.has(o.order);
            return (
              <OrderGroup
                key={o.order}
                open={open}
                onToggle={() => toggle(o.order)}
                orderNumber={o.order}
                customer={o.customer}
                due={o.due.replace(", 2026", "")}
                count={o.lines.length}
                pieces={o.lines.reduce((n, l) => n + l.qty, 0)}
                rush={o.rush ?? false}
                active={active?.o.order === o.order}
                {...(s.remaining > 0 && s.partial ? { alert: `${s.remaining} item${s.remaining === 1 ? "" : "s"} still remaining` } : {})}
                chips={
                  <>
                    <AggregateChip tone={s.complete === s.total ? "ok" : "neutral"} label={`${s.complete} Complete · ${s.remaining} Remaining`} />
                    <AggregateChip tone={s.tone} label={s.label} />
                    <AggregateChip tone="info" label={o.method} />
                    {o.visits.length > 0 && <AggregateChip label={`${o.visits.length} handoff${o.visits.length === 1 ? "" : "s"}`} />}
                  </>
                }
              >
                {o.lines.map((l) => (
                  <LineRow
                    key={l.id}
                    active={l.id === activeLine}
                    onClick={() => setActiveLine(l.id)}
                    thumb={<Thumb label={l.item} className="size-10 shrink-0 rounded-sm" />}
                    title={l.item}
                    meta={`${l.size ? l.size + " · " : ""}${l.media} · Ordered ${l.qty} · Out ${l.done} · Remaining ${l.qty - l.done}`}
                    status={
                      <>
                        <Status value={l.status} />
                        <AggregateChip label={l.method} />
                        {l.note && <span className="text-[11px] text-warn">{l.note}</span>}
                      </>
                    }
                    right={
                      <span className="flex shrink-0 flex-col gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={l.done >= l.qty}
                          onClick={(e) => { e.stopPropagation(); record(o.order, l.id, false); }}
                        >
                          Partial
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={l.done >= l.qty}
                          onClick={(e) => { e.stopPropagation(); record(o.order, l.id, true); }}
                        >
                          Hand off all
                        </Button>
                      </span>
                    }
                  />
                ))}
              </OrderGroup>
            );
          })}
          {list.length === 0 && <p className="py-10 text-center text-[13px] text-muted-foreground">No orders match this search.</p>}
        </div>

        <div className="space-y-3">
          {active ? (
            <>
              <Panel title={`#${active.o.order} · ${active.o.customer}`}>
                <div className="space-y-1 text-[13px]">
                  <div className="text-[15px] font-semibold">{active.l.item}</div>
                  <div className="num text-muted-foreground">{active.l.size ? `${active.l.size} · ` : ""}{active.l.media}</div>
                  <div className="num">Ordered {active.l.qty} · Handed off {active.l.done} · Remaining {active.l.qty - active.l.done}</div>
                  <div className="pt-1"><Status value={active.l.status} /></div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="h-9 flex-1 text-[12px]" disabled={active.l.done >= active.l.qty} onClick={() => record(active.o.order, active.l.id, false)}>
                    <PackageCheck className="mr-1 size-4" />Record partial
                  </Button>
                  <Button size="sm" className="h-9 flex-1 text-[12px]" disabled={active.l.done >= active.l.qty} onClick={() => record(active.o.order, active.l.id, true)}>
                    <Truck className="mr-1 size-4" />Complete line
                  </Button>
                </div>
              </Panel>

              <Panel title="Handoff history">
                {active.o.visits.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No pickups or shipments recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {active.o.visits.map((v, i) => (
                      <li key={i} className="border-l-2 border-border pl-2 text-[12px]">
                        <div className="num font-semibold">{v.date}</div>
                        <div>{v.what}</div>
                        <div className="text-muted-foreground">{v.by}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          ) : (
            <Panel title="Line item"><p className="text-[13px] text-muted-foreground">Select a line item to see its fulfillment detail.</p></Panel>
          )}
        </div>
      </div>
    </div>
  );
}
