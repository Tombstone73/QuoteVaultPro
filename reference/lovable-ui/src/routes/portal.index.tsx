import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileCheck2, Package, Receipt, ShoppingBag, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentLink, EmptyState, Money, PortalPage, Section, StatusPill, Stat } from "@/components/portal/ui";
import { invoices, orders, proofs, account } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Your Print Account — Hensley Print Co." },
      { name: "description", content: "Orders in progress, proofs awaiting approval, open invoices and recent shipments in one dashboard." },
      { property: "og:title", content: "Your Print Account — Hensley Print Co." },
      { property: "og:description", content: "See what needs your attention and reorder in a couple of clicks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalHome,
});

function PortalHome() {
  const { proofOverrides, paidInvoices } = usePortalStore();

  const activeOrders = orders.filter((o) => o.status !== "Completed" && o.status !== "Cancelled");
  const openProofs = proofs.filter((p) => (proofOverrides[p.id] ?? p.status) === "Awaiting Your Approval");
  const openInvoices = invoices
    .map((i) => ({ ...i, balance: Math.max(0, i.balance - (paidInvoices[i.id] ?? 0)) }))
    .filter((i) => i.balance > 0);
  const overdue = openInvoices.filter((i) => i.status === "Overdue");
  const shipments = orders.flatMap((o) => o.shipments.map((s) => ({ ...s, order: o })));

  return (
    <PortalPage
      title={`Welcome back, ${account.contactName.split(" ")[0]}`}
      description="Here's what needs your attention today."
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/portal/shop">
              <ShoppingBag className="mr-2 size-4" />
              Browse products
            </Link>
          </Button>
          <Button asChild>
            <Link to="/portal/shop">Start new order</Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders in progress" value={activeOrders.length} hint="Received through shipping" />
        <Stat
          label="Proofs to approve"
          value={openProofs.length}
          tone={openProofs.length ? "warn" : undefined}
          hint={openProofs.length ? "Production is waiting" : "Nothing waiting on you"}
        />
        <Stat
          label="Open balance"
          value={<Money value={openInvoices.reduce((s, i) => s + i.balance, 0)} />}
          hint={`${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Overdue"
          value={<Money value={overdue.reduce((s, i) => s + i.balance, 0)} />}
          tone={overdue.length ? "danger" : undefined}
          hint={overdue.length ? "Please review" : "Nothing past due"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section
            title="Proofs needing attention"
            action={
              <Button variant="ghost" size="sm" className="h-8" asChild>
                <Link to="/portal/proofs">
                  All proofs <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            }
            bare
          >
            {openProofs.length === 0 ? (
              <EmptyState icon={FileCheck2} title="No proofs are waiting on you" message="We'll email you the moment a new proof is ready." />
            ) : (
              <ul className="divide-y divide-border">
                {openProofs.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/portal/proofs/$id"
                      params={{ id: p.id }}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 sm:px-5"
                    >
                      <div
                        className="size-11 shrink-0 rounded-md border border-border"
                        style={{ background: `linear-gradient(140deg, oklch(0.84 0.08 ${p.hue} / 0.6), oklch(0.7 0.1 ${p.hue} / 0.35))` }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.jobName}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {p.orderNumber} · Version {p.version} · Sent {shortDate(p.sentOn)}
                        </p>
                      </div>
                      <StatusPill value="Awaiting Your Approval" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Orders in progress"
            action={
              <Button variant="ghost" size="sm" className="h-8" asChild>
                <Link to="/portal/orders">
                  All orders <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            }
            bare
          >
            {activeOrders.length === 0 ? (
              <EmptyState icon={Package} title="No orders in progress" message="Your completed work stays available under Orders." />
            ) : (
              <ul className="divide-y divide-border">
                {activeOrders.map((o) => (
                  <li key={o.id}>
                    <Link
                      to="/portal/orders/$id"
                      params={{ id: o.id }}
                      className="grid gap-2 px-4 py-3 transition-colors hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {o.number} <span className="font-normal text-muted-foreground">· PO {o.po}</span>
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          Placed {shortDate(o.placedOn)}
                          {o.dueOn ? ` · Due ${shortDate(o.dueOn)}` : ""} · {o.lines.length} item{o.lines.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill value={o.status} />
                        <Money value={o.total} className="text-sm font-semibold" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="Open invoices"
            action={
              <Button size="sm" className="h-8" asChild>
                <Link to="/portal/invoices">Pay</Link>
              </Button>
            }
            bare
          >
            {openInvoices.length === 0 ? (
              <EmptyState icon={Receipt} title="You're all paid up" message="Nothing is currently outstanding." />
            ) : (
              <ul className="divide-y divide-border">
                {openInvoices.map((i) => (
                  <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <Link to="/portal/invoices/$id" params={{ id: i.id }} className="truncate text-sm font-medium hover:underline">
                        {i.number}
                      </Link>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {i.orderNumber} · Due {shortDate(i.dueOn)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money value={i.balance} className="block text-sm font-semibold" />
                      {i.status === "Overdue" && <StatusPill value="Overdue" className="mt-1" icon={false} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent shipments" bare>
            {shipments.length === 0 ? (
              <EmptyState icon={Truck} title="No shipments yet" message="Tracking appears here as soon as your work leaves the shop." />
            ) : (
              <ul className="divide-y divide-border">
                {shipments.slice(0, 4).map((s) => (
                  <li key={s.order.id + s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <Link to="/portal/orders/$id" params={{ id: s.order.id }} className="truncate text-sm font-medium hover:underline">
                        {s.order.number}
                      </Link>
                      <p className="truncate text-[12px] tabular-nums text-muted-foreground">
                        {s.carrier} {s.tracking}
                      </p>
                    </div>
                    <StatusPill value={s.status} icon={false} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Documents" bare>
            <div className="space-y-2 p-4 sm:p-5">
              {orders.flatMap((o) => o.documents).slice(0, 3).map((d) => (
                <DocumentLink key={d.name} name={d.name} date={shortDate(d.date)} />
              ))}
            </div>
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
