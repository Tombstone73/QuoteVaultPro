import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, ShoppingBag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PortalPage, ProductThumb, Section } from "@/components/portal/ui";
import { products } from "@/lib/portal/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/shop/")({
  head: () => ({
    meta: [
      { title: "Shop Print Products — Hensley Print Co." },
      { name: "description", content: "Browse the print products approved for your account and order at your contracted pricing." },
      { property: "og:title", content: "Shop Print Products — Hensley Print Co." },
      { property: "og:description", content: "Banners, coroplast, vinyl, stickers, acrylic and posters, ready to reorder." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map((p) => p.category)))], []);
  const list = products.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      (p.name.toLowerCase().includes(q.toLowerCase()) || p.blurb.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <PortalPage title="Shop" description="Products approved for your account, priced at your agreed rates.">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="pl-9" aria-label="Search products" />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                category === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <Section className="mt-4" bare>
          <EmptyState
            icon={ShoppingBag}
            title="No matching products"
            message="No products are currently available for online ordering that match this search. Contact your account representative if you need assistance."
          />
        </Section>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              <ProductThumb hue={p.imageHue} label={p.name} className="h-32 w-full rounded-none border-0 border-b border-border text-sm" />
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug">{p.name}</h2>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{p.category}</span>
                </div>
                <p className="text-[13px] text-muted-foreground">{p.blurb}</p>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-[13px] font-medium">
                    {p.startingAt}
                    {p.negotiated && <span className="block text-[11px] font-normal text-muted-foreground">Your price</span>}
                  </span>
                  <Button size="sm" asChild>
                    <Link to="/portal/shop/$productId" params={{ productId: p.id }}>
                      Configure
                    </Link>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </PortalPage>
  );
}
