import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ImageOff, Loader2, PackageSearch, Search, ShoppingBag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePortalStoreProducts, type PortalStoreProductSummaryDto } from "@/hooks/usePortal";

function ProductImage({ product }: { product: PortalStoreProductSummaryDto }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-36 items-center justify-center overflow-hidden border-b border-border/70 bg-gradient-to-br from-muted/80 via-background to-muted/50 sm:h-40">
      {product.imageUrl && !failed ? (
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImageOff className="h-7 w-7 stroke-[1.5]" aria-hidden="true" />
          <span className="text-xs font-medium">Product preview</span>
        </div>
      )}
    </div>
  );
}

export default function PortalStorePage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const searchReady = search.trim() === debouncedSearch;
  const productsQuery = usePortalStoreProducts({ search: debouncedSearch, category: category === "all" ? null : category, page });
  useEffect(() => {
    if (productsQuery.data?.categories) setCategories(productsQuery.data.categories);
  }, [productsQuery.data]);
  const products = searchReady ? productsQuery.data?.items ?? [] : [];
  const hasFilters = !!search.trim() || category !== "all";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customer Portal</span>
            <Badge variant="secondary" className="text-[11px]">Beta</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Storefront</h1>
          <p className="mt-1 text-sm text-muted-foreground">Explore products and preview pricing for your next project.</p>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">Pricing preview is available. Online ordering is not yet enabled.</p>
      </header>

      <section aria-label="Find products" className="grid gap-3 rounded-lg border border-border/80 bg-card p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="store-search">Search products</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="store-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Name or description" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="store-category">Category</Label>
          <Select value={category} onValueChange={(value) => { setCategory(value); setPage(0); }}>
            <SelectTrigger id="store-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </section>

      {!searchReady || productsQuery.isPending ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Loading products">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : productsQuery.isError ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <PackageSearch className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div><p className="font-medium">Products are unavailable right now</p><p className="mt-1 text-sm text-muted-foreground">Please try again in a moment.</p></div>
          <Button variant="outline" size="sm" onClick={() => void productsQuery.refetch()}>Try again</Button>
        </CardContent></Card>
      ) : products.length === 0 && !hasFilters && page === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-14 text-center">
          <ShoppingBag className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No products available yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Check back as more products are added to the storefront.</p>
        </CardContent></Card>
      ) : products.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12 text-center">
          <PackageSearch className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{page > 0 ? "No products on this page" : "No matching products"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{page > 0 ? "Go back to the previous page." : "Try a different search or category."}</p>
          {page > 0 ? <Button variant="link" onClick={() => setPage((current) => current - 1)}>Previous page</Button> : <Button variant="link" onClick={() => { setSearch(""); setCategory("all"); setPage(0); }}>Clear filters</Button>}
        </CardContent></Card>
      ) : (
        <section aria-label="Products">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Page {page + 1} · {products.length} product{products.length === 1 ? "" : "s"} shown</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <Link key={product.id} to={`/portal/store/${encodeURIComponent(product.id)}`} className="group overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <ProductImage product={product} />
                <div className="flex min-h-40 flex-col p-4">
                  {product.category ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{product.category}</p> : null}
                  <h2 className="font-semibold leading-snug group-hover:text-primary">{product.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{product.description || "Explore options and preview pricing."}</p>
                  <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-primary">View product <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                </div>
              </Link>
            ))}
          </div>
          {page > 0 || productsQuery.data?.hasMore ? (
            <nav aria-label="Product pages" className="mt-6 flex items-center justify-between border-t border-border/70 pt-4">
              <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page + 1}</span>
              <Button type="button" variant="outline" size="sm" disabled={!productsQuery.data?.hasMore} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
