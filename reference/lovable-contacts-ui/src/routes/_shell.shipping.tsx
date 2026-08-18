import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { money, shipments } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/shipping")({
  head: () => ({
    meta: [
      { title: "Shipping — PrintersHero V2" },
      { name: "description", content: "Outbound shipments, carriers, tracking numbers and local delivery runs." },
      { property: "og:title", content: "Shipping — PrintersHero V2" },
      { property: "og:description", content: "Carrier labels and delivery runs in one place." },
    ],
  }),
  component: ShippingPage,
});

function ShippingPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Shipping" subtitle="Carrier and local delivery shipments." actions={<Button size="sm" className="h-8">Create Label</Button>} />
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Order</th><th className={th}>Carrier</th><th className={th}>Service</th><th className={th}>Tracking</th><th className={th}>Destination</th><th className={th + " text-right"}>Cost</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.id} className="row-h border-t border-border">
                <td className={td + " num"}>#{s.order}</td>
                <td className={td}>{s.carrier}</td>
                <td className={td + " text-muted-foreground"}>{s.service}</td>
                <td className={td + " num text-muted-foreground"}>{s.tracking}</td>
                <td className={td + " text-muted-foreground"}>{s.to}</td><td className={td + " num text-right"}>{money(s.cost)}</td>
                <td className={td}><Status value={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
