import { createFileRoute } from "@tanstack/react-router";
import { Metric, PageHeader, Panel, td, th } from "@/components/app/primitives";
import { customers, invoices, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/payments")({
  head: () => ({
    meta: [
      { title: "Payments — PrintersHero V2" },
      { name: "description", content: "All payments, refunds and credits applied across print shop invoices." },
      { property: "og:title", content: "Payments — PrintersHero V2" },
      { property: "og:description", content: "Payment activity across every invoice." },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const rows = invoices.flatMap((i) => i.payments.map((p) => ({ ...p, invoice: i.number, customer: customers.find((c) => c.id === i.customerId)?.name ?? "" })));
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Payments" subtitle="Payments are always recorded against an invoice, never against an order." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Received this week" value={money(rows.reduce((s, r) => s + r.amount, 0))} tone="ok" />
        <Metric label="Card" value={money(203.52)} />
        <Metric label="ACH" value={money(500)} />
        <Metric label="Refunds" value={money(0)} />
      </div>
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Date</th><th className={th}>Invoice</th><th className={th}>Customer</th><th className={th}>Method</th><th className={th}>Reference</th><th className={th + " text-right"}>Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="row-h border-t border-border">
                <td className={td + " num"}>{r.date}</td>
                <td className={td + " num"}>{r.invoice}</td>
                <td className={td}>{r.customer}</td>
                <td className={td}>{r.method}</td>
                <td className={td + " num text-muted-foreground"}>{r.ref}</td>
                <td className={td + " num text-right font-medium"}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
