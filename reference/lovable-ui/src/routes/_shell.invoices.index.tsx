import { Link, createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-store";
import { Metric, PageHeader, Status } from "@/components/app/primitives";
import { WorkGrid, type GridColumn } from "@/components/app/work-grid";
import { customers, docGrand, invoiceNetPaid, invoiceSettlement, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — PrintersHero V2" },
      { name: "description", content: "Every order carries an invoice automatically: drafts track the order, issued invoices become immutable financial checkpoints." },
      { property: "og:title", content: "Invoices — PrintersHero V2" },
      { property: "og:description", content: "Draft and issued invoices with settlement state, totals and balances." },
    ],
  }),
  component: InvoiceList,
});

function InvoiceList() {
  const { invoices, docs } = useApp();

  const rows = invoices.map((i) => {
    const order = docs.find((x) => x.id === i.orderId);
    const total = order ? docGrand(order) : 0;
    const net = invoiceNetPaid(i);
    return {
      inv: i,
      orderNumber: order?.number ?? "",
      customer: customers.find((c) => c.id === i.customerId),
      total,
      balance: total - net,
      settlement: i.status === "Draft" ? null : invoiceSettlement(i, total),
    };
  });
  type Row = (typeof rows)[number];

  const totalOpen = rows.filter((r) => r.inv.status === "Issued").reduce((s, r) => s + r.balance, 0);

  const columns: GridColumn<Row>[] = [
    {
      key: "invoice", label: "Invoice", width: 130, sortValue: (r) => r.inv.number,
      render: (r) => <Link to="/invoices/$id" params={{ id: r.inv.id }} className="num font-medium text-primary hover:underline">{r.inv.number}</Link>,
    },
    {
      key: "order", label: "Order", width: 100, sortValue: (r) => r.orderNumber,
      render: (r) => r.orderNumber ? <Link to="/sales/$id" params={{ id: r.orderNumber }} className="num text-primary hover:underline">#{r.orderNumber}</Link> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "customer", label: "Customer", width: 220, sortValue: (r) => r.customer?.name ?? "",
      render: (r) => r.customer ? <Link to="/customers/$id" params={{ id: r.customer.id }} className="text-primary hover:underline">{r.customer.name}</Link> : "—",
    },
    { key: "issued", label: "Issued", width: 120, sortValue: (r) => r.inv.issueDate ?? "", render: (r) => <span className="num text-muted-foreground">{r.inv.issueDate ?? "—"}</span> },
    { key: "due", label: "Due", width: 120, sortValue: (r) => r.inv.dueDate ?? "", render: (r) => <span className="num text-muted-foreground">{r.inv.dueDate ?? "—"}</span> },
    { key: "status", label: "Invoice Status", width: 130, sortValue: (r) => r.inv.status, render: (r) => <Status value={r.inv.status} /> },
    {
      key: "settlement", label: "Settlement", width: 140, sortValue: (r) => r.settlement ?? "",
      render: (r) => r.settlement ? <Status value={r.settlement} /> : <span className="text-muted-foreground">—</span>,
    },
    { key: "total", label: "Total", width: 110, align: "right", sortValue: (r) => r.total, render: (r) => <span className="num">{money(r.total)}</span> },
    { key: "balance", label: "Balance", width: 110, align: "right", sortValue: (r) => r.balance, render: (r) => <span className="num font-medium">{money(r.balance)}</span> },
  ];

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Invoices" subtitle={`${invoices.length} invoices · ${money(totalOpen)} outstanding`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Draft" value={invoices.filter((i) => i.status === "Draft").length} hint="Tracks the order live" />
        <Metric label="Issued" value={invoices.filter((i) => i.status === "Issued").length} />
        <Metric label="Fully Settled" value={rows.filter((r) => r.settlement === "Paid").length} tone="ok" />
        <Metric label="Outstanding" value={money(totalOpen)} tone="warn" />
      </div>
      <div className="panel overflow-hidden">
        <WorkGrid<Row> id="invoices" columns={columns} rows={rows} rowKey={(r: Row) => r.inv.id} empty="No invoices yet." />
      </div>
      <p className="text-[11px] text-muted-foreground">Click a header to sort · drag a header to reorder · drag the header edge to resize. Your layout is remembered.</p>
    </div>
  );
}
