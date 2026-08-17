import { Link, createFileRoute } from "@tanstack/react-router";
import { Metric, PageHeader, TxType } from "@/components/app/primitives";
import { WorkGrid, type GridColumn } from "@/components/app/work-grid";
import { useApp } from "@/lib/app-store";
import { customers, docGrand, invoiceNetPaid, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/payments")({
  head: () => ({
    meta: [
      { title: "Payments — PrintersHero V2" },
      { name: "description", content: "Global financial transaction ledger: every payment and refund applied across print shop invoices." },
      { property: "og:title", content: "Payments — PrintersHero V2" },
      { property: "og:description", content: "Payment and refund activity across every invoice." },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { invoices, docs } = useApp();

  const rows = invoices.flatMap((i) => {
    const order = docs.find((d) => d.id === i.orderId);
    const invTotal = order ? docGrand(order) : 0;
    const customer = customers.find((c) => c.id === i.customerId);
    let running = invTotal;
    const events = [
      ...i.payments.map((p) => ({ kind: "Payment" as const, id: p.id, date: p.date, method: p.method, ref: p.ref, amount: p.amount })),
      ...i.refunds.map((r) => ({ kind: "Refund" as const, id: r.id, date: r.date, method: r.method, ref: r.ref, amount: -r.amount })),
    ];
    return events.map((e) => {
      running -= e.amount;
      return {
        ...e,
        invoiceId: i.id,
        invoiceNumber: i.number,
        invoiceTotal: invTotal,
        orderNumber: order?.number ?? "",
        customerId: customer?.id ?? "",
        customerName: customer?.name ?? "",
        balanceAfter: running,
      };
    });
  });
  type Row = (typeof rows)[number];

  const received = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const card = rows.filter((r) => r.amount > 0 && /card|electronic/i.test(r.method)).reduce((s, r) => s + r.amount, 0);
  const ach = rows.filter((r) => r.amount > 0 && !/card|electronic/i.test(r.method)).reduce((s, r) => s + r.amount, 0);
  const refunds = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const outstanding = invoices
    .filter((i) => i.status === "Issued")
    .reduce((s, i) => {
      const d = docs.find((x) => x.id === i.orderId);
      return s + ((d ? docGrand(d) : 0) - invoiceNetPaid(i));
    }, 0);

  const columns: GridColumn<Row>[] = [
    { key: "date", label: "Date", width: 120, sortValue: (r) => r.date, render: (r) => <span className="num">{r.date}</span> },
    { key: "type", label: "Type", width: 110, sortValue: (r) => r.kind, render: (r) => <TxType type={r.kind} /> },
    {
      key: "invoice", label: "Invoice", width: 130, sortValue: (r) => r.invoiceNumber,
      render: (r) => <Link to="/invoices/$id" params={{ id: r.invoiceId }} className="num text-primary hover:underline">{r.invoiceNumber}</Link>,
    },
    {
      key: "order", label: "Order", width: 100, sortValue: (r) => r.orderNumber,
      render: (r) => r.orderNumber ? <Link to="/sales/$id" params={{ id: r.orderNumber }} className="num text-primary hover:underline">#{r.orderNumber}</Link> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "customer", label: "Customer", width: 200, sortValue: (r) => r.customerName,
      render: (r) => r.customerId ? <Link to="/customers/$id" params={{ id: r.customerId }} className="text-primary hover:underline">{r.customerName}</Link> : "—",
    },
    { key: "method", label: "Method", width: 150, sortValue: (r) => r.method, render: (r) => r.method },
    { key: "ref", label: "Reference", width: 150, sortValue: (r) => r.ref, render: (r) => <span className="num text-muted-foreground">{r.ref}</span> },
    {
      key: "amount", label: "Amount", width: 120, align: "right", sortValue: (r) => r.amount,
      render: (r) => <span className={`num font-medium ${r.amount < 0 ? "text-warn" : ""}`}>{r.amount < 0 ? `-${money(-r.amount)}` : money(r.amount)}</span>,
    },
    { key: "invTotal", label: "Invoice Total", width: 120, align: "right", sortValue: (r) => r.invoiceTotal, render: (r) => <span className="num text-muted-foreground">{money(r.invoiceTotal)}</span> },
    { key: "balanceAfter", label: "Balance After", width: 120, align: "right", sortValue: (r) => r.balanceAfter, render: (r) => <span className="num">{money(r.balanceAfter)}</span> },
  ];

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Payments" subtitle="Global transaction ledger — payments and refunds are always recorded against an invoice, never against an order." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Received this week" value={money(received)} tone="ok" />
        <Metric label="Card / Electronic" value={money(card)} />
        <Metric label="ACH / Other" value={money(ach)} />
        <Metric label="Refunds" value={refunds ? `-${money(refunds)}` : money(0)} tone={refunds ? "warn" : "neutral"} />
      </div>
      <div className="panel overflow-hidden">
        <WorkGrid<Row> id="payments" columns={columns} rows={rows} rowKey={(r: Row) => r.id} empty="No transactions yet." />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {money(outstanding)} still outstanding across issued invoices. Take payments and refunds from the invoice detail screen.
      </p>
    </div>
  );
}
