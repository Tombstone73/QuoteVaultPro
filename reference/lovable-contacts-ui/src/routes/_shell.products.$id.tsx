import { Link, createFileRoute } from "@tanstack/react-router";
import { Field, PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { materials, money, products, routeTemplates } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/products/$id")({
  head: () => ({
    meta: [
      { title: "Product — PrintersHero V2" },
      { name: "description", content: "Product definition: pricing basis, material recipe with waste factors and the default production route." },
      { property: "og:title", content: "Product — PrintersHero V2" },
      { property: "og:description", content: "How a print product is configured, priced and routed." },
    ],
  }),
  component: ProductDetail,
});

function ProductDetail() {
  const { id } = Route.useParams();
  const p = products.find((x) => x.id === id);
  if (!p) return <div className="p-8 text-sm text-muted-foreground">Product not found.</div>;
  const route = routeTemplates.find((r) => r.name === p.routeTemplate);

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title={p.name}
        subtitle={`${p.category} · ${p.type}`}
        meta={<div className="mt-1.5 flex items-center gap-2"><Status value={p.active ? "Active" : "Inactive"} /><span className="num text-[12px] text-muted-foreground">{p.sku}</span></div>}
        actions={<Button size="sm" variant="outline" className="h-8" asChild><Link to="/product-builder">Edit in Builder</Link></Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Pricing">
          <div className="space-y-2">
            <Field label="Method">{p.pricingMethod}</Field>
            <Field label="Basis">{p.basis}</Field>
            <Field label="Route template">{p.routeTemplate}</Field>
          </div>
        </Panel>
        <Panel title="Material recipe" className="lg:col-span-2" dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Material</th><th className={th}>Consumption rule</th><th className={th}>Waste</th><th className={th + " text-right"}>Unit cost</th></tr></thead>
            <tbody>
              {p.recipe.map((r) => {
                const m = materials.find((x) => x.name === r.material);
                return (
                  <tr key={r.material} className="row-h border-t border-border">
                    <td className={td}>{r.material}</td>
                    <td className={td + " text-muted-foreground"}>{r.rule}</td>
                    <td className={td + " num"}>{r.waste}</td>
                    <td className={td + " num text-right"}>{m ? money(m.cost) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Default route">
        <ol className="flex flex-wrap gap-2">
          {(route?.steps ?? []).map((s, i) => (
            <li key={s.name} className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px]">
              <span className="num mr-1 text-muted-foreground">{i + 1}</span>{s.name} <span className="text-muted-foreground">· {s.station}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
