import { createFileRoute } from "@tanstack/react-router";
import { Metric, PageHeader, Panel, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { materials, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — PrintersHero V2" },
      { name: "description", content: "On hand, reserved and available material quantities with reorder alerts driven by live job demand." },
      { property: "og:title", content: "Inventory — PrintersHero V2" },
      { property: "og:description", content: "What's on the rack versus what's already promised to jobs." },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const low = materials.filter((m) => m.onHand - m.reserved < m.reorder);
  const value = materials.reduce((s, m) => s + m.onHand * m.cost, 0);
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Inventory" subtitle="Reserved quantities come from scheduled line items." actions={<Button size="sm" className="h-8">Adjust Stock</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="SKUs tracked" value={materials.length} />
        <Metric label="Below reorder" value={low.length} tone="warn" />
        <Metric label="Reserved units" value={materials.reduce((s, m) => s + m.reserved, 0)} />
        <Metric label="Inventory value" value={money(value)} />
      </div>
      <Panel title="Stock levels" dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Material</th><th className={th + " text-right"}>On hand</th><th className={th + " text-right"}>Reserved</th><th className={th + " text-right"}>Available</th><th className={th + " text-right"}>Reorder at</th><th className={th + " w-40"}>Coverage</th></tr></thead>
          <tbody>
            {materials.map((m) => {
              const avail = m.onHand - m.reserved;
              const pct = Math.max(4, Math.min(100, (avail / Math.max(m.reorder, 1)) * 50));
              return (
                <tr key={m.id} className="row-h border-t border-border">
                  <td className={td}>{m.name}</td>
                  <td className={td + " num text-right"}>{m.onHand}</td>
                  <td className={td + " num text-right text-muted-foreground"}>{m.reserved}</td>
                  <td className={td + " num text-right font-medium"}>{avail}</td>
                  <td className={td + " num text-right text-muted-foreground"}>{m.reorder}</td>
                  <td className={td}>
                    <div className="h-1.5 w-32 overflow-hidden rounded bg-surface-2">
                      <div className={`h-full rounded ${avail < m.reorder ? "bg-warn" : "bg-ok"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
