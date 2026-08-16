import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { money, purchaseOrders, vendors } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement — PrintersHero V2" },
      { name: "description", content: "Purchase orders and vendors: order substrate, receive partials and keep material costs current." },
      { property: "og:title", content: "Procurement — PrintersHero V2" },
      { property: "og:description", content: "Vendors, POs and receiving in one workspace." },
    ],
  }),
  component: ProcurementPage,
});

function ProcurementPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Procurement" subtitle="Receiving updates material cost and available inventory instantly." actions={<Button size="sm" className="h-8">New Purchase Order</Button>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Purchase orders" dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>PO</th><th className={th}>Vendor</th><th className={th}>Expected</th><th className={th}>Status</th><th className={th + " text-right"}>Total</th><th className={th + " w-32"}>Received</th></tr></thead>
            <tbody>
              {purchaseOrders.map((p) => (
                <tr key={p.id} className="row-h border-t border-border">
                  <td className={td + " num font-medium"}>{p.number}</td>
                  <td className={td}>{p.vendor}</td>
                  <td className={td + " num text-muted-foreground"}>{p.expected}</td>
                  <td className={td}><Status value={p.status} /></td>
                  <td className={td + " num text-right"}>{money(p.total)}</td>
                  <td className={td}>
                    <div className="h-1.5 w-24 overflow-hidden rounded bg-surface-2"><div className="h-full rounded bg-primary" style={{ width: `${p.received * 100}%` }} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Vendors" dense>
          <ul className="divide-y divide-border text-[13px]">
            {vendors.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-2">
                <div><div className="font-medium">{v.name}</div><div className="text-[11px] text-muted-foreground">{v.terms} · {v.openPOs} open PO</div></div>
                <span className="num text-muted-foreground">{money(v.spend)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
