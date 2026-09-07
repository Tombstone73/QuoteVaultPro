import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Money, Notice, PortalPage, ProductThumb, Section } from "@/components/portal/ui";
import { ArtworkUpload } from "@/components/portal/artwork-upload";
import { products } from "@/lib/portal/data";
import { portalApi } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";
import type { ArtworkFile } from "@/lib/portal/types";

export const Route = createFileRoute("/portal/shop/$productId")({
  head: ({ params }) => {
    const p = products.find((x) => x.id === params.productId);
    const title = p ? `${p.name} — Order Online` : "Configure your product";
    return {
      meta: [
        { title: `${title} | Hensley Print Co.` },
        { name: "description", content: p?.blurb ?? "Configure size, quantity and finishing, upload artwork and see your contracted price." },
        { property: "og:title", content: title },
        { property: "og:description", content: p?.blurb ?? "Configure and order print work online." },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: ConfigurePage,
});

function ConfigurePage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const { addLine } = usePortalStore();
  const product = products.find((p) => p.id === productId);

  const [width, setWidth] = useState("96");
  const [height, setHeight] = useState("36");
  const [qty, setQty] = useState("2");
  const [options, setOptions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [artwork, setArtwork] = useState<ArtworkFile[]>([]);
  const [artworkLater, setArtworkLater] = useState(false);

  const [price, setPrice] = useState<{ unitPrice: number; lineTotal: number; basis: string } | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    const defaults: Record<string, string> = {};
    for (const f of product.fields) if (f.kind === "select" && f.defaultValue) defaults[f.id] = f.defaultValue;
    setOptions(defaults);
    const qtyField = product.fields.find((f) => f.kind === "quantity");
    if (qtyField?.defaultValue) setQty(qtyField.defaultValue);
  }, [product]);

  const needsDimensions = Boolean(product?.fields.some((f) => f.kind === "dimensions"));

  // Server-authoritative price request. Nothing is calculated in the browser.
  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setPricing(true);
    setPriceError(null);
    const t = setTimeout(() => {
      portalApi
        .quotePrice({
          productId: product.id,
          width: Number(width) || 0,
          height: Number(height) || 0,
          qty: Number(qty) || 0,
          options,
        })
        .then((res) => {
          if (!cancelled) setPrice(res);
        })
        .catch(() => {
          if (!cancelled) {
            setPrice(null);
            setPriceError("We couldn't price this configuration. Check the size and quantity, or contact your account representative.");
          }
        })
        .finally(() => {
          if (!cancelled) setPricing(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [product, width, height, qty, options]);

  const configSummary = useMemo(() => {
    if (!product) return [];
    const rows: { label: string; value: string }[] = [];
    if (needsDimensions) rows.push({ label: "Size", value: `${width}" × ${height}"` });
    for (const f of product.fields) {
      if (f.kind !== "select") continue;
      const choice = f.choices?.find((c) => c.id === options[f.id]);
      if (choice) rows.push({ label: f.label, value: choice.label });
    }
    return rows;
  }, [product, options, width, height, needsDimensions]);

  if (!product) {
    return (
      <PortalPage title="Product unavailable">
        <Section bare>
          <EmptyState
            icon={ShoppingBag}
            title="This product isn't available for online ordering"
            message="Contact your account representative if you need assistance with this item."
            action={<Button asChild><Link to="/portal/shop">Back to shop</Link></Button>}
          />
        </Section>
      </PortalPage>
    );
  }

  const artworkReady = artworkLater || artwork.some((a) => a.status === "uploaded");
  const canAdd = Boolean(price) && !pricing && (!product.artworkRequired || artworkReady);

  return (
    <PortalPage
      title={product.name}
      description={product.blurb}
      actions={
        <Button variant="outline" asChild>
          <Link to="/portal/shop">
            <ArrowLeft className="mr-2 size-4" />
            Shop
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Section title="Configuration" description="Only the choices this product supports are shown.">
            <div className="space-y-4">
              {needsDimensions && (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="w">Width (in)</Label>
                    <Input id="w" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="h">Height (in)</Label>
                    <Input id="h" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="q">Quantity</Label>
                    <Input id="q" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                </div>
              )}
              {!needsDimensions && (
                <div className="space-y-1.5 sm:max-w-[200px]">
                  <Label htmlFor="q">Quantity</Label>
                  <Input id="q" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {product.fields
                  .filter((f) => f.kind === "select")
                  .map((f) => (
                    <div key={f.id} className="space-y-1.5">
                      <Label htmlFor={f.id}>{f.label}</Label>
                      <Select value={options[f.id] ?? ""} onValueChange={(v) => setOptions((o) => ({ ...o, [f.id]: v }))}>
                        <SelectTrigger id={f.id}>
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {f.choices?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {f.help && <p className="text-[12px] text-muted-foreground">{f.help}</p>}
                    </div>
                  ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes for this item</Label>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Colour matching, deadlines, anything we should know." />
              </div>
            </div>
          </Section>

          <Section title="Your artwork" description="Upload your source files. Our team prepares them for print.">
            <ArtworkUpload files={artwork} onChange={setArtwork} max={product.maxArtworkFiles} artworkLater={artworkLater} onArtworkLater={setArtworkLater} />
          </Section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Section bare>
            <ProductThumb hue={product.imageHue} label={product.name} className="h-32 w-full rounded-none rounded-t-xl border-0 border-b border-border text-sm" />
            <div className="space-y-3 p-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your price</p>
                {pricing ? (
                  <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Calculating your price
                  </p>
                ) : priceError ? (
                  <p className="mt-2 text-[13px] text-late">{priceError}</p>
                ) : price ? (
                  <>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      <Money value={price.lineTotal} />
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      <Money value={price.unitPrice} /> each · {price.basis}
                    </p>
                  </>
                ) : null}
              </div>

              <dl className="space-y-1.5 border-t border-border pt-3">
                {configSummary.map((r) => (
                  <div key={r.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[13px]">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="truncate text-right font-medium">{r.value}</dd>
                  </div>
                ))}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[13px]">
                  <dt className="text-muted-foreground">Quantity</dt>
                  <dd className="text-right font-medium tabular-nums">{Number(qty || 0).toLocaleString()}</dd>
                </div>
              </dl>

              {product.artworkRequired && !artworkReady && (
                <Notice tone="warn" title="Artwork needed">
                  Upload your files, or tick &quot;I&apos;ll send artwork later&quot; to continue.
                </Notice>
              )}

              <Button
                className="w-full"
                disabled={!canAdd}
                onClick={() => {
                  if (!price) return;
                  addLine({
                    id: `${Date.now()}`,
                    productId: product.id,
                    productName: product.name,
                    config: configSummary,
                    qty: Number(qty) || 0,
                    unitPrice: price.unitPrice,
                    lineTotal: price.lineTotal,
                    artwork,
                    artworkLater,
                    notes,
                  });
                  navigate({ to: "/portal/review" });
                }}
              >
                Add to order
              </Button>
              <p className="text-center text-[12px] text-muted-foreground">You&apos;ll review everything before placing the order.</p>
            </div>
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
