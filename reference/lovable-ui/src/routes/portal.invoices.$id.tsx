import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentLink, EmptyState, KeyValue, Money, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { invoices, orders } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Invoice Detail — Hensley Print Co." },
      { name: "description", content: "Invoice totals, payments applied, remaining balance and the order it covers." },
      { property: "og:title", content: "Invoice Detail — Hensley Print Co." },
      { property: "og:description", content: "See exactly what this invoice covers and pay the balance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoiceDetail,
});

function InvoiceDetail() {
  const { id } = Route.useParams();
  const { paidInvoices, setSelectedForPayment } = usePortalStore();
  const base = invoices.find((i) => i.id === id);

  if (!base) {
    return (
      <PortalPage title="Invoice unavailable">
        <Section bare>
          <EmptyState icon={Receipt} title="We couldn't open that invoice" action={<Button asChild><Link to="/portal/invoices">Back to invoices</Link></Button>} />
        </Section>
      </PortalPage>
    );
  }

  const extra = paidInvoices[base.id] ?? 0;
  const paid = base.paid + extra;
  const balance = Math.max(0, base.total - paid);
  const status = balance === 0 ? "Paid" : base.status;
  const order = orders.find((o) => o.id === base.orderId);

  return (
    <PortalPage
      title={base.number}
      description={`${base.orderNumber} · PO ${base.po} · Issued ${shortDate(base.date)}`}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/portal/invoices">
              <ArrowLeft className="mr-2 size-4" />
              All invoices
            </Link>
          </Button>
          {balance > 0 && (
            <Button asChild onClick={() => setSelectedForPayment([base.id])}>
              <Link to="/portal/pay">Pay this invoice</Link>
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Section title="What this invoice covers" bare>
            {order ? (
              <ul className="divide-y divide-border">
                {order.lines.map((l) => (
                  <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{l.product}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {l.description} · {l.size ? `${l.size} · ` : ""}Qty {l.qty.toLocaleString()}
                      </p>
                    </div>
                    <Money value={l.total} className="text-sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Line detail unavailable" message="Download the PDF for the full breakdown." />
            )}
          </Section>

          <Section title="Documents" bare>
            <div className="space-y-2 p-4 sm:p-5">
              <DocumentLink name={`${base.number}.pdf`} date={shortDate(base.date)} />
            </div>
          </Section>
        </div>

        <Section title="Balance">
          <dl className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Invoice total</dt>
              <dd><Money value={base.total} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Payments applied</dt>
              <dd>−<Money value={paid} /></dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Balance due</dt>
              <dd><Money value={balance} /></dd>
            </div>
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
            <KeyValue label="Status"><StatusPill value={status} /></KeyValue>
            <KeyValue label="Due">{shortDate(base.dueOn)}</KeyValue>
            <KeyValue label="Order" className="col-span-2">
              <Link to="/portal/orders/$id" params={{ id: base.orderId }} className="text-primary hover:underline">
                {base.orderNumber}
              </Link>
            </KeyValue>
          </div>
        </Section>
      </div>
    </PortalPage>
  );
}
