import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DocumentLink,
  EmptyState,
  KeyValue,
  Money,
  Notice,
  PortalPage,
  Section,
  StatusPill,
  TrackingRow,
} from "@/components/portal/ui";
import { invoices, orders } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/orders/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Order ${params.id.replace("o", "SO-")} — Hensley Print Co.` },
      { name: "description", content: "Order detail: line items, artwork, proof status, shipments, tracking and invoices." },
      { property: "og:title", content: "Order detail — Hensley Print Co." },
      { property: "og:description", content: "Everything about this print order in one customer view." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrderDetail,
});

function OrderDetail() {
  const { id } = Route.useParams();
  const { paidInvoices } = usePortalStore();
  const order = orders.find((o) => o.id === id);

  if (!order) {
    return (
      <PortalPage title="Order not available">
        <Section bare>
          <EmptyState icon={Package} title="We couldn't open that order" message="It may have been moved. Head back to your order list." action={<Button asChild><Link to="/portal/orders">Back to orders</Link></Button>} />
        </Section>
      </PortalPage>
    );
  }

  const linked = invoices
    .filter((i) => order.invoiceIds.includes(i.id))
    .map((i) => ({ ...i, balance: Math.max(0, i.balance - (paidInvoices[i.id] ?? 0)) }));
  const awaiting = order.lines.some((l) => l.proofStatus === "Awaiting Your Approval");

  return (
    <PortalPage
      title={order.number}
      description={`PO ${order.po} · Placed ${shortDate(order.placedOn)}${order.dueOn ? ` · Due ${shortDate(order.dueOn)}` : ""}`}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/portal/orders">
              <ArrowLeft className="mr-2 size-4" />
              All orders
            </Link>
          </Button>
          {order.balance > 0 && linked.some((i) => i.balance > 0) && (
            <Button asChild>
              <Link to="/portal/invoices">Pay balance</Link>
            </Button>
          )}
        </>
      }
    >
      {awaiting && (
        <Notice
          tone="warn"
          title="A proof is waiting for your approval"
          action={
            <Button size="sm" asChild>
              <Link to="/portal/proofs">Review proof</Link>
            </Button>
          }
        >
          Production starts once you approve.
        </Notice>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Order summary">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KeyValue label="Status"><StatusPill value={order.status} /></KeyValue>
              <KeyValue label="Fulfillment"><StatusPill value={order.fulfillment} icon={false} /></KeyValue>
              <KeyValue label="Order total"><Money value={order.total} /></KeyValue>
              <KeyValue label="Balance">
                {order.balance > 0 ? <Money value={order.balance} /> : <span className="text-ok">Paid in full</span>}
              </KeyValue>
              <KeyValue label="Contact">{order.contact}</KeyValue>
              <KeyValue label="Method">{order.method}</KeyValue>
              <KeyValue label={order.method === "Pickup" ? "Pickup at" : "Ship to"} className="col-span-2">
                <span className="font-normal text-muted-foreground">{order.shipTo}</span>
              </KeyValue>
            </dl>
            {order.notes && <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">Your note: {order.notes}</p>}
          </Section>

          <Section title="Items" bare>
            <ul className="divide-y divide-border">
              {order.lines.map((l) => (
                <li key={l.id} className="grid gap-3 px-4 py-4 sm:px-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
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
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {l.proofStatus && <StatusPill value={l.proofStatus} />}
                    {l.artwork.map((a) => (
                      <span key={a.name} className="truncate rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {a.name} · {a.status}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Shipments & pickup" bare>
            <div className="space-y-2 p-4 sm:p-5">
              {order.method === "Pickup" && order.fulfillment === "Pickup Ready" && (
                <Notice tone="ok" title="Ready for pickup">
                  Bring your PO number to the front counter, Monday–Friday 8am–5pm.
                </Notice>
              )}
              {order.shipments.length === 0 && order.method === "Ship" ? (
                <EmptyState icon={Truck} title="Nothing has shipped yet" message="Tracking appears here for each shipment, including partial shipments." />
              ) : (
                order.shipments.map((s) => <TrackingRow key={s.id} {...s} />)
              )}
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Invoices" bare>
            {linked.length === 0 ? (
              <EmptyState title="Not invoiced yet" message="We invoice as work ships or completes." />
            ) : (
              <ul className="divide-y divide-border">
                {linked.map((i) => (
                  <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <Link to="/portal/invoices/$id" params={{ id: i.id }} className="truncate text-sm font-medium hover:underline">
                        {i.number}
                      </Link>
                      <p className="text-[12px] text-muted-foreground">Due {shortDate(i.dueOn)}</p>
                    </div>
                    <div className="text-right">
                      <Money value={i.balance} className="block text-sm font-semibold" />
                      {i.balance > 0 && (
                        <Button size="sm" variant="outline" className="mt-1 h-7" asChild>
                          <Link to="/portal/invoices">Pay</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Documents" bare>
            <div className="space-y-2 p-4 sm:p-5">
              {order.documents.length === 0 ? (
                <EmptyState title="No documents yet" message="Acknowledgements, packing slips and invoices land here." />
              ) : (
                order.documents.map((d) => <DocumentLink key={d.name} name={d.name} date={shortDate(d.date)} />)
              )}
            </div>
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
