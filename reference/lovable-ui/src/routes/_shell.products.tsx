import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader, Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { products } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/products")({
  head: () => ({
    meta: [
      { title: "Products — PrintersHero V2" },
      { name: "description", content: "Configurable print products: banners, rigid signs, decals and wraps with pricing methods and route templates." },
      { property: "og:title", content: "Products — PrintersHero V2" },
      { property: "og:description", content: "The catalog that drives quoting, pricing and production routing." },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Products"
        subtitle={`${products.length} configurable products`}
        actions={<Button size="sm" className="h-8 gap-1.5" asChild><Link to="/product-builder" search={{}}><Plus className="size-4" />New Product</Link></Button>}
      />
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Product</th><th className={th}>Category</th><th className={th}>Pricing</th><th className={th}>Route</th><th className={th}>SKU</th><th className={th}>Basis</th><th className={th + " text-right"}>Materials</th><th className={th}>Status</th><th className={th + " text-right"}>Edit</th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="row-h border-t border-border hover:bg-accent/60">
                <td className={td}>
                  <div className="flex items-center gap-2 py-1.5">
                    <Thumb label={p.name.slice(0, 2)} />
                    <Link to="/products/$id" params={{ id: p.id }} className="font-medium text-primary hover:underline">{p.name}</Link>
                  </div>
                </td>
                <td className={td + " text-muted-foreground"}>{p.category}</td>
                <td className={td}>{p.pricingMethod}</td>
                <td className={td + " text-muted-foreground"}>{p.routeTemplate}</td>
                <td className={td + " num text-muted-foreground"}>{p.sku}</td><td className={td + " text-muted-foreground"}>{p.basis}</td>
                <td className={td + " num text-right"}>{p.recipe.length}</td>
                <td className={td}><Status value={p.active ? "Active" : "Inactive"} /></td>
                <td className={td + " text-right"}>
                  <Link to="/product-builder" search={{ product: p.id }} className="text-[12px] text-primary hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
