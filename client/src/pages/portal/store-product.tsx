import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ImageOff, Info, Loader2, Ruler, ShoppingBag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PortalApiError,
  portalCartRequest,
  usePortalCart,
  usePortalSession,
  usePortalStorePrice,
  usePortalStoreProduct,
  type PortalStoreOptionDto,
  type PortalStoreOptionValue,
  type PortalStorePriceRequest,
  type PortalStoreProductDto,
  type PortalCartLineDto,
} from "@/hooks/usePortal";
import { useQueryClient } from "@tanstack/react-query";

function currency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function pricingErrorPresentation(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof PortalApiError) {
    if (error.status === 401) return { message: 'Your portal session has expired. Sign in again to see pricing.', retryable: false };
    if (error.code === 'STAFF_PORTAL_PREVIEW_REQUIRED') return { message: 'Open this portal from a customer record to preview pricing.', retryable: false };
    if (error.status === 403) return { message: 'Pricing is unavailable in this portal session. Reopen the customer portal or contact the shop.', retryable: false };
    if (error.code === 'PRODUCT_PRICING_NOT_CONFIGURED') return { message: 'Product pricing is not configured.', retryable: false };
    if (error.code === 'ACCOUNT_PRICING_UNAVAILABLE') return { message: 'Pricing is unavailable for this account. Contact the shop for a Quote.', retryable: false };
    if (error.code === 'CONFIGURATION_CANNOT_BE_PRICED' || error.status === 400) return { message: 'This configuration cannot be priced.', retryable: false };
  }
  return { message: 'Pricing is temporarily unavailable. Please try again.', retryable: true };
}

function positiveNumber(value: string) {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number > 0 ? number : null;
}

function OptionHelp({ option }: { option: PortalStoreOptionDto }) {
  if (!option.helpText) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`About ${option.label}`} className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 leading-relaxed">{option.helpText}</TooltipContent>
    </Tooltip>
  );
}

function ProductOption({
  option,
  value,
  onChange,
}: {
  option: PortalStoreOptionDto;
  value: PortalStoreOptionValue | undefined;
  onChange: (value: PortalStoreOptionValue) => void;
}) {
  const inputId = `store-option-${option.key}`;
  const label = <span className="flex items-center gap-1.5">{option.label}{option.required ? <span className="text-destructive" aria-label="required">*</span> : null}<OptionHelp option={option} /></span>;

  if (option.type === "boolean" || option.type === "checkbox") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2.5">
        <Checkbox id={inputId} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
        <Label htmlFor={inputId} className="cursor-pointer font-medium">{label}</Label>
      </div>
    );
  }

  if (option.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {option.choices.map((choice) => {
            const choiceId = `${inputId}-${choice.value}`;
            return (
              <label key={choice.value} htmlFor={choiceId} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 p-2.5 text-sm hover:bg-accent/40">
                <Checkbox id={choiceId} checked={selected.includes(choice.value)} onCheckedChange={(checked) => onChange(checked === true ? [...selected, choice.value] : selected.filter((item) => item !== choice.value))} />
                <span><span className="font-medium">{choice.label}</span>{choice.description ? <span className="block text-xs text-muted-foreground">{choice.description}</span> : null}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (option.type === "radio") {
    return (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {option.choices.map((choice) => (
            <label key={choice.value} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 p-2.5 text-sm hover:bg-accent/40">
              <input type="radio" name={inputId} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} className="mt-0.5 accent-primary" />
              <span><span className="font-medium">{choice.label}</span>{choice.description ? <span className="block text-xs text-muted-foreground">{choice.description}</span> : null}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {option.type === "select" ? (
        <Select value={typeof value === "string" && value ? value : undefined} onValueChange={onChange}>
          <SelectTrigger id={inputId}><SelectValue placeholder="Choose an option" /></SelectTrigger>
          <SelectContent>{option.choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : option.type === "number" ? (
        <Input id={inputId} type="number" inputMode="decimal" min={option.min ?? undefined} max={option.max ?? undefined} step={option.step ?? "any"} value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />
      ) : option.type === "textarea" ? (
        <Textarea id={inputId} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <Input id={inputId} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
      )}
      {option.type === "select" && typeof value === "string" ? (
        <p className="text-xs text-muted-foreground">{option.choices.find((choice) => choice.value === value)?.description}</p>
      ) : null}
    </div>
  );
}

function Configuration({ product, cartLine, canOrder }: { product: PortalStoreProductDto; cartLine?: PortalCartLineDto; canOrder: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cartError, setCartError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [quantity, setQuantity] = useState(String(cartLine?.quantity ?? product.defaults.quantity ?? 1));
  const [width, setWidth] = useState((cartLine?.widthIn ?? product.defaults.widthIn) == null ? "" : String(cartLine?.widthIn ?? product.defaults.widthIn));
  const [height, setHeight] = useState((cartLine?.heightIn ?? product.defaults.heightIn) == null ? "" : String(cartLine?.heightIn ?? product.defaults.heightIn));
  const [selections, setSelections] = useState<Record<string, PortalStoreOptionValue>>({ ...(cartLine?.selections ?? product.defaults.selections) });
  const [visibleOptions, setVisibleOptions] = useState(product.options);
  const parsedQuantity = positiveNumber(quantity);
  const parsedWidth = positiveNumber(width);
  const parsedHeight = positiveNumber(height);

  // The server also projects conditional controls for incomplete required
  // selections. Keep requesting that projection so a parent change can hide
  // an unselected child and unlock the new branch.
  const canPreview = parsedQuantity !== null && Number.isInteger(parsedQuantity) && (!product.dimensionsRequired || !!product.fixedDimensions || (parsedWidth !== null && parsedHeight !== null));
  const configuration = useMemo<PortalStorePriceRequest | null>(() => {
    if (!canPreview || parsedQuantity === null) return null;
    return {
      quantity: parsedQuantity,
      ...(product.dimensionsRequired && !product.fixedDimensions && parsedWidth !== null && parsedHeight !== null ? { widthIn: parsedWidth, heightIn: parsedHeight } : {}),
      selections,
    };
  }, [canPreview, parsedQuantity, product.dimensionsRequired, product.fixedDimensions, parsedWidth, parsedHeight, selections]);
  const configurationKey = JSON.stringify(configuration);
  const [debouncedConfiguration, setDebouncedConfiguration] = useState<PortalStorePriceRequest | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedConfiguration(configuration), 400);
    return () => window.clearTimeout(timer);
  }, [configurationKey]);
  const priceQuery = usePortalStorePrice(product.id, debouncedConfiguration);
  const priceError = priceQuery.isError ? pricingErrorPresentation(priceQuery.error) : null;
  const isCurrent = configuration !== null && configurationKey === JSON.stringify(debouncedConfiguration);
  const price = isCurrent && priceQuery.isSuccess ? priceQuery.data : null;
  const appliedPriceKey = useRef<string | null>(null);
  useEffect(() => {
    if (!price || appliedPriceKey.current === configurationKey) return;
    appliedPriceKey.current = configurationKey;
    setVisibleOptions(price.options);
    setSelections((current) => {
      const visibleKeys = new Set(price.options.map((option) => option.key));
      const retained = Object.fromEntries(Object.entries(current).filter(([key]) => visibleKeys.has(key))) as Record<string, PortalStoreOptionValue>;
      const newlyVisibleDefaults = Object.fromEntries(
        Object.entries(price.effectiveSelections).filter(([key]) => retained[key] === undefined),
      ) as Record<string, PortalStoreOptionValue>;
      return Object.keys(newlyVisibleDefaults).length || Object.keys(retained).length !== Object.keys(current).length
        ? { ...retained, ...newlyVisibleDefaults } : current;
    });
  }, [price, configurationKey]);

  async function saveToCart() {
    if (!configuration || !product.treeVersionId || !price?.priceAvailable || !canOrder || adding) return;
    setAdding(true);
    setCartError(null);
    try {
      await portalCartRequest(cartLine ? `/items/${encodeURIComponent(cartLine.id)}` : '/items', cartLine ? 'PUT' : 'POST', {
        productId: product.id, treeVersionId: product.treeVersionId, ...configuration,
        widthIn: configuration.widthIn ?? null, heightIn: configuration.heightIn ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['/api/portal/cart'] });
      navigate('/portal/cart');
    } catch (error) {
      setCartError(error instanceof Error ? error.message : 'Could not save this cart item. Please retry.');
    } finally { setAdding(false); }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader className="border-b border-border/70 pb-4"><CardTitle className="text-lg">Configure a pricing preview</CardTitle></CardHeader>
        <CardContent className="space-y-6 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="store-quantity">Quantity <span className="text-destructive" aria-label="required">*</span></Label>
              <Input id="store-quantity" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </div>
            {product.fixedDimensions ? (
              <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Ruler className="h-3.5 w-3.5" /> Fixed size</p>
                <p className="mt-1 text-sm font-medium">{product.fixedDimensions.widthIn} × {product.fixedDimensions.heightIn} in</p>
              </div>
            ) : null}
          </div>
          {product.dimensionsRequired && !product.fixedDimensions ? (
            <div className="grid gap-4 border-t border-border/70 pt-5 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="store-width">Width (inches) *</Label><Input id="store-width" type="number" inputMode="decimal" min="0.01" step="any" value={width} onChange={(event) => setWidth(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="store-height">Height (inches) *</Label><Input id="store-height" type="number" inputMode="decimal" min="0.01" step="any" value={height} onChange={(event) => setHeight(event.target.value)} /></div>
            </div>
          ) : null}
          {visibleOptions.length > 0 ? (
            <div className="space-y-5 border-t border-border/70 pt-5">
              <h2 className="text-sm font-semibold">Product options</h2>
              {visibleOptions.map((option) => <ProductOption key={option.key} option={option} value={selections[option.key]} onChange={(value) => setSelections((current) => ({ ...current, [option.key]: value }))} />)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden lg:sticky lg:top-5">
        <CardHeader className="border-b border-border/70 bg-muted/30 pb-4"><CardTitle className="text-base">Pricing preview</CardTitle></CardHeader>
        <CardContent className="space-y-5 pt-5" aria-live="polite">
          {!canPreview ? (
            <p className="text-sm text-muted-foreground">Enter a valid quantity and dimensions to see an estimate.</p>
          ) : !isCurrent || priceQuery.isPending || priceQuery.isFetching ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculating preview…</p>
          ) : priceError ? (
            <div className="space-y-2"><p className="text-sm font-medium text-destructive">{priceError.message}</p>{priceError.retryable ? <Button size="sm" variant="outline" onClick={() => void priceQuery.refetch()}>Try again</Button> : null}</div>
          ) : price && price.priceAvailable && price.unitPriceCents !== null && price.totalCents !== null ? (
            <div className="space-y-4">
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unit price</p><p className="mt-1 text-xl font-semibold tabular-nums">{currency(price.unitPriceCents)}</p></div>
              <div className="border-t border-border/70 pt-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimated product total</p><p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-primary">{currency(price.totalCents)}</p></div>
            </div>
          ) : price && !price.priceAvailable ? (
            <p className="text-sm text-muted-foreground">Choose the remaining required options to see an estimate.</p>
          ) : null}
          {product.orderable && canOrder ? <div className="space-y-2 border-t border-border/70 pt-4">
            <Button type="button" disabled={!price?.priceAvailable || !isCurrent || adding} onClick={() => void saveToCart()} className="w-full">
              {adding ? 'Saving item…' : cartLine ? 'Update cart item' : 'Add to cart'}
            </Button>
            {cartError ? <p role="alert" className="text-sm text-destructive">{cartError}</p> : null}
            <p className="text-xs text-muted-foreground">Pickup only. Artwork and tax are reviewed in the cart.</p>
          </div> : <p className="text-xs text-muted-foreground">{product.orderable ? 'Ordering requires a Buyer or Company Admin account.' : 'This Product is available for pricing preview. Contact the shop to order.'}</p>}
          <div className="border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground">
            <p>Tax is calculated at checkout. Shipping is not available for portal Orders yet.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductGallery({ product }: { product: PortalStoreProductDto }) {
  const images = product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const url = images[selected];
  return <div className="space-y-2">
    <div className="flex aspect-square max-h-80 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-gradient-to-br from-muted/80 via-background to-muted/50">
      {url && !failed.includes(url) ? <img src={url} alt={`${product.name}, image ${selected + 1}`} onError={() => setFailed((current) => [...current, url])} className="h-full w-full object-contain" /> : <ImageOff className="h-8 w-8 text-muted-foreground" aria-label="Image unavailable" />}
    </div>
    {images.length > 1 ? <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Product image gallery">
      {images.map((image, index) => <button key={`${image}-${index}`} type="button" onClick={() => setSelected(index)} aria-label={`View image ${index + 1}`} aria-pressed={selected === index} className={`h-16 w-16 shrink-0 overflow-hidden rounded border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === index ? "border-primary" : "border-border"}`}>
        {failed.includes(image) ? <ImageOff className="mx-auto h-5 w-5 text-muted-foreground" /> : <img src={image} alt="" onError={() => setFailed((current) => [...current, image])} className="h-full w-full object-cover" />}
      </button>)}
    </div> : null}
  </div>;
}

export default function PortalStoreProductPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const cartQuery = usePortalCart();
  const sessionQuery = usePortalSession();
  const productQuery = usePortalStoreProduct(id);
  const product = productQuery.data;
  const editingLineId = searchParams.get('cartLine');
  const editingLine = cartQuery.data?.lines.find(line => line.id === editingLineId && line.productId === id);

  if (editingLineId && cartQuery.isPending) return <div role="status" className="p-6">Loading cart item…</div>;
  if (editingLineId && cartQuery.isError) return <div className="mx-auto max-w-4xl space-y-3"><p role="alert">Could not load this cart item.</p><Button onClick={() => void cartQuery.refetch()}>Retry</Button></div>;
  if (editingLineId && !editingLine) return <div className="mx-auto max-w-4xl space-y-3"><p role="alert">This cart item is no longer available to edit.</p><Button asChild><Link to="/portal/cart">Return to cart</Link></Button></div>;

  if (productQuery.isPending) return <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Loading product"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (productQuery.isError || !product) {
    return <div className="mx-auto max-w-5xl space-y-4"><Button asChild variant="ghost" className="px-0"><Link to="/portal/store"><ArrowLeft className="mr-2 h-4 w-4" />Back to Product Calculator</Link></Button><Card><CardContent className="py-12 text-center"><ShoppingBag className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Product unavailable</p><p className="mt-1 text-sm text-muted-foreground">This product may no longer be available to preview.</p></CardContent></Card></div>;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <Button asChild variant="ghost" className="mb-3 px-0"><Link to="/portal/store"><ArrowLeft className="mr-2 h-4 w-4" />Back to Product Calculator</Link></Button>
        <div className="grid gap-5 border-b border-border/80 pb-6 sm:grid-cols-[minmax(180px,300px)_minmax(0,1fr)] sm:items-center">
          <ProductGallery key={product.id} product={product} />
          <div>
            <div className="mb-2 flex items-center gap-2">{product.category ? <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{product.category}</span> : null}<Badge variant="secondary" className="text-[11px]">Beta</Badge></div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
            {product.description ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{product.description}</p> : null}
          </div>
        </div>
      </header>
      {product.pricingAvailable ? <Configuration key={`${product.id}:${editingLine?.id ?? 'new'}`} product={product} cartLine={editingLine} canOrder={sessionQuery.data?.permissions.canPlaceOrders === true} /> : (
        <Card><CardContent className="py-8"><p className="font-medium">Product pricing is not configured</p><p className="mt-1 text-sm text-muted-foreground">This product is available to browse. Contact us for a quote.</p></CardContent></Card>
      )}
    </div>
  );
}
