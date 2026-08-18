import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { materials, money } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/materials")({
  head: () => ({
    meta: [
      { title: "Materials — PrintersHero V2" },
      { name: "description", content: "Substrates, roll media and hardware with vendor, cost and reorder points feeding product recipes." },
      { property: "og:title", content: "Materials — PrintersHero V2" },
      { property: "og:description", content: "The material catalog behind every product recipe." },
    ],
  }),
  component: MaterialsPage,
});

function MaterialsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Materials" subtitle="Costs here flow straight into calculated pricing." />
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Material</th><th className={th}>SKU</th><th className={th}>Category</th><th className={th}>Vendor</th><th className={th}>Unit</th><th className={th + " text-right"}>Cost</th><th className={th + " text-right"}>On hand</th><th className={th}>Level</th></tr></thead>
          <tbody>
            {materials.map((m) => {
              const avail = m.onHand - m.reserved;
              return (
                <tr key={m.id} className="row-h border-t border-border">
                  <td className={td}>{m.name}</td>
                  <td className={td + " num text-muted-foreground"}>{m.sku}</td>
                  <td className={td + " text-muted-foreground"}>{m.category}</td>
                  <td className={td}>{m.vendor}</td>
                  <td className={td + " text-muted-foreground"}>{m.unit}</td>
                  <td className={td + " num text-right"}>{money(m.cost)}</td>
                  <td className={td + " num text-right"}>{m.onHand}</td>
                  <td className={td}><Status value={avail <= 0 ? "Out of Stock" : avail < m.reorder ? "Reorder" : "In Stock"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
