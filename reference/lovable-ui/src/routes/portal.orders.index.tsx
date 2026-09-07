import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { orders } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/orders/")({
  head: () => ({
    meta: [
      { title: "Your Orders — Hensley Print Co." },
      { name: "description", content: "Search current and historical print orders by number or PO, with status, totals and shipping." },
      { property: "og:title", content: "Your Orders — Hensley Print Co." },
      { property: "og:description", content: "Every order you've placed, current and historical, in one searchable list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

const PAGE = 8;

function OrdersPage() {
  const [tab, setTab] = useState<"current" | "history">("current");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);

  const current = (o: (typeof orders)[number]) => o.status !== "Completed" && o.status !== "Cancelled";
  const base = orders.filter((o) => (tab === "current" ? current(o) : !current(o)));
  const statuses = ["All", ...Array.from(new Set(base.map((o) => o.status)))];
  const filtered = base.filter(
    (o) =>
      (status === "All" || o.status === status) &&
      (o.number.toLowerCase().includes(q.toLowerCase()) || o.po.toLowerCase().includes(q.toLowerCase())),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <PortalPage
      title="Orders"
      description="Search by order number or your PO."
      actions={
        <Button asChild>
          <Link to="/portal/shop">Start new order</Link>
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["current", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setStatus("All");
                setPage(1);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                tab === t ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Order number or PO"
            className="pl-9"
            aria-label="Search orders"
          />
        </div>
      </div>

      <div className="mt-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
              status === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <Section className="mt-4" bare>
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={tab === "current" ? "No orders in progress" : "No past orders yet"}
            message="When you place an order it appears here with live status and tracking."
          />
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full border-collapse md:table">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Order</th>
                  <th className="px-3 py-2.5 font-semibold">PO</th>
                  <th className="px-3 py-2.5 font-semibold">Placed</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Fulfillment</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-5 py-3">
                      <Link to="/portal/orders/$id" params={{ id: o.id }} className="text-sm font-medium text-primary hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted-foreground">{o.po}</td>
                    <td className="px-3 py-3 text-[13px] text-muted-foreground">{shortDate(o.placedOn)}</td>
                    <td className="px-3 py-3"><StatusPill value={o.status} /></td>
                    <td className="px-3 py-3"><StatusPill value={o.fulfillment} icon={false} /></td>
                    <td className="px-3 py-3 text-right text-[13px]"><Money value={o.total} /></td>
                    <td className="px-5 py-3 text-right text-[13px] font-medium">
                      {o.balance > 0 ? <Money value={o.balance} /> : <span className="text-muted-foreground">Paid</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile row cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link to="/portal/orders/$id" params={{ id: o.id }} className="block px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{o.number}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          PO {o.po} · {shortDate(o.placedOn)}
                        </p>
                      </div>
                      <Money value={o.total} className="shrink-0 text-sm font-semibold" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusPill value={o.status} />
                      <StatusPill value={o.fulfillment} icon={false} />
                      {o.balance > 0 && <span className="text-[12px] text-muted-foreground">Balance <Money value={o.balance} /></span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-[13px] text-muted-foreground">
            Page {page} of {pages} · {filtered.length} orders
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </PortalPage>
  );
}
