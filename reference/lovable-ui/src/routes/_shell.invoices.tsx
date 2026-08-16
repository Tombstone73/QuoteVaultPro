import { Link, createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-store";
import { Metric, PageHeader, Status, td, th } from "@/components/app/primitives";
import { customers, docGrand, invoicePaid, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — PrintersHero V2" },
      { name: "description", content: "Every order carries an invoice automatically: drafts track the order, issued invoices become financial checkpoints." },
      { property: "og:title", content: "Invoices — PrintersHero V2" },
      { property: "og:description", content: "Draft and issued invoices with balances and payment state." },
    ],
  }),
  component: InvoiceList,
});

function InvoiceList() {
  const { invoices, docs } = useApp();
  const totalOpen = invoices.reduce((s, i) => {
    const d = docs.find((x) => x.id === i.orderId);
    return s + (d ? docGrand(d) - invoicePaid(i) : 0);
  }, 0);

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Invoices" subtitle={`${invoices.length} invoices · ${money(totalOpen)} outstanding`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Draft" value={invoices.filter((i) => i.status === "Draft").length} hint="Tracks the order live" />
        <Metric label="Issued" value={invoices.filter((i) => i.status === "Issued").length} />
        <Metric label="Paid" value={invoices.filter((i) => i.status === "Paid").length} tone="ok" />
        <Metric label="Outstanding" value={money(totalOpen)} tone="warn" />
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Invoice</th><th className={th}>Order</th><th className={th}>Customer</th>
              <th className={th}>Issued</th><th className={th}>Due</th><th className={th}>Status</th>
              <th className={th + " text-right"}>Total</th><th className={th + " text-right"}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const d = docs.find((x) => x.id === i.orderId);
              const total = d ? docGrand(d) : 0;
              return (
                <tr key={i.id} className="row-h border-t border-border hover:bg-accent/60">
                  <td className={td}><Link to="/invoices/$id" params={{ id: i.id }} className="num font-medium text-primary hover:underline">{i.number}</Link></td>
                  <td className={td}>{d && <Link to="/sales/$id" params={{ id: d.number }} className="num text-primary hover:underline">#{d.number}</Link>}</td>
                  <td className={td}>{customers.find((c) => c.id === i.customerId)?.name}</td>
                  <td className={td + " num text-muted-foreground"}>{i.issueDate ?? "—"}</td>
                  <td className={td + " num text-muted-foreground"}>{i.dueDate ?? "—"}</td>
                  <td className={td}><Status value={i.status} /></td>
                  <td className={td + " num text-right"}>{money(total)}</td>
                  <td className={td + " num text-right font-medium"}>{money(total - invoicePaid(i))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
