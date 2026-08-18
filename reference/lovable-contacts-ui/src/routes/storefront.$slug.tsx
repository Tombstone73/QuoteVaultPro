import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { customers, money, products } from "@/lib/mock/data";

export const Route = createFileRoute("/storefront/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Order Center — ${params.slug} storefront` },
      { name: "description", content: "Branded customer storefront: reorder approved print products, upload artwork and track jobs without calling the shop." },
      { property: "og:title", content: "Customer Storefront — PrintersHero V2" },
      { property: "og:description", content: "A branded ordering portal your customers actually use." },
    ],
  }),
  component: Storefront,
});

function Storefront() {
  const { slug } = Route.useParams();
  const customer = customers.find((c) => c.brand?.slug === slug) ?? customers[0]!;
  const brand = customer.brand?.color ?? "#0B6FB4";

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 py-4 text-white" style={{ background: brand }}>
        <div>
          <div className="text-[11px] uppercase tracking-widest opacity-80">Order Center</div>
          <div className="text-lg font-semibold">{customer.name}</div>
        </div>
        <div className="text-[12px] opacity-90">Powered by Hensley Print Co.</div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Approved products</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Reorder pre-approved items at your contracted pricing.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.slice(0, 6).map((p) => (
            <article key={p.id} className="panel p-3">
              <div className="h-24 rounded" style={{ background: `${brand}22` }} />
              <h2 className="mt-2 text-[14px] font-semibold">{p.name}</h2>
              <p className="text-[12px] text-muted-foreground">{p.category} · priced per {p.basis}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="num text-[13px] font-medium">from {money(11.8)}</span>
                <Button size="sm" className="h-7 text-[12px]">Configure</Button>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
