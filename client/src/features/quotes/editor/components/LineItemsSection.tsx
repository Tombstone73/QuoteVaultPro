import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight, FileText, Minus, Plus, Save, Loader2, Check, ChevronsUpDown } from "lucide-react";
import type { Product, ProductOptionItem } from "@shared/schema";
import type { QuoteLineItemDraft, OptionSelection } from "../types";
import { apiRequest } from "@/lib/queryClient";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { cn } from "@/lib/utils";

type LineItemsSectionProps = {
  quoteId: string | null;
  readOnly: boolean;
  lineItems: QuoteLineItemDraft[];
  products: Product[];
  expandedKey: string | null;
  onExpandedKeyChange: (next: string | null) => void;
  onCreateDraftLineItem: (productId: string) => Promise<QuoteLineItemDraft | null>;
  onUpdateLineItem: (itemKey: string, updates: Partial<QuoteLineItemDraft>) => void;
  onSaveLineItem?: (itemKey: string) => Promise<boolean>;
  onDuplicateLineItem: (itemKey: string) => void;
  onRemoveLineItem: (itemKey: string) => void;
  ensureQuoteId?: () => Promise<string>;
  ensureLineItemId?: (itemKey: string) => Promise<{ quoteId: string; lineItemId: string }>;
};

function getItemKey(item: QuoteLineItemDraft): string {
  return item.tempId || item.id || "";
}

function getProduct(products: Product[], productId: string) {
  return products.find((p) => p.id === productId) ?? null;
}

function requiresDimensions(product: Product | null): boolean {
  if (!product) return true;
  const anyProduct = product as any;
  if (typeof anyProduct.requiresDimensions === "boolean") return anyProduct.requiresDimensions;
  if (anyProduct.pricingMode === "fee" || anyProduct.pricingMode === "addon") return false;
  if (anyProduct.pricingMode === "area") return true;
  return false;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function buildSelectedOptionsArray(
  productOptions: ProductOptionItem[],
  selections: Record<string, OptionSelection>,
  width: number,
  height: number,
  quantity: number
) {
  const arr: any[] = [];
  for (const [optionId, sel] of Object.entries(selections)) {
    const opt = productOptions.find((o) => o.id === optionId);
    if (!opt) continue;

    const amount = opt.amount || 0;
    let setupCost = 0;
    let calculatedCost = 0;

    if ((opt as any).priceMode === "flat") {
      setupCost = amount;
      calculatedCost = amount;
    } else if ((opt as any).priceMode === "per_qty") {
      calculatedCost = amount * quantity;
    } else if ((opt as any).priceMode === "per_sqft") {
      calculatedCost = amount * width * height * quantity;
    }

    arr.push({
      optionId: opt.id,
      optionName: (opt as any).label || (opt as any).name || "Option",
      value: sel.value,
      setupCost,
      calculatedCost,
      // Preserve advanced fields used by some option kinds
      grommetsLocation: sel.grommetsLocation,
      grommetsSpacingCount: sel.grommetsSpacingCount,
      grommetsPerSign: sel.grommetsPerSign,
      grommetsSpacingInches: sel.grommetsSpacingInches,
      customPlacementNote: sel.customPlacementNote,
      hemsType: sel.hemsType,
      polePocket: sel.polePocket,
    });
  }
  return arr;
}

function useDebouncedEffect(effect: () => void, deps: any[], delayMs: number) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => effect(), delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function LineItemThumb({ quoteId, lineItemId }: { quoteId: string | null; lineItemId: string | undefined }) {
  const filesApiPath = quoteId
    ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
    : `/api/line-items/${lineItemId}/files`;

  const { data: attachments = [] } = useQuery<any[]>({
    queryKey: [filesApiPath],
    queryFn: async () => {
      if (!lineItemId) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!lineItemId,
  });

  const first = attachments[0];
  const isImage = first?.mimeType?.startsWith?.("image/");
  const isPdf = first?.mimeType === "application/pdf" || (first?.fileName || "").toLowerCase().endsWith(".pdf");

  return (
    <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0">
      {isImage ? (
        <img src={first.fileUrl} alt={first.fileName || "Artwork"} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center relative">
          <FileText className="h-5 w-5 text-muted-foreground" />
          {isPdf && (
            <div className="absolute bottom-1 right-1 rounded-sm bg-background/70 px-1 py-0.5 text-[10px] font-semibold text-foreground">
              PDF
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LineItemsSection({
  quoteId,
  readOnly,
  lineItems,
  products,
  expandedKey,
  onExpandedKeyChange,
  onCreateDraftLineItem,
  onUpdateLineItem,
  onSaveLineItem,
  onDuplicateLineItem,
  onRemoveLineItem,
  ensureQuoteId,
  ensureLineItemId,
}: LineItemsSectionProps) {
  const count = lineItems.filter((li) => li.status !== "canceled").length;

  // Inline add product search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = useMemo(() => {
    const active = products.filter((p) => (p as any).isActive !== false);
    if (!searchQuery.trim()) return active; // Show all products when no search query
    const q = searchQuery.trim().toLowerCase();
    return active.filter((p) => {
      const sku = ((p as any).sku as string | undefined) || "";
      const category = ((p as any).category as string | undefined) || "";
      return (
        p.name.toLowerCase().includes(q) ||
        sku.toLowerCase().includes(q) ||
        category.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery]);

  // Expanded item editing state (kept local so read-only mode can hide all inputs cleanly)
  const expandedItem = useMemo(() => lineItems.find((li) => getItemKey(li) === expandedKey) ?? null, [lineItems, expandedKey]);
  const expandedProduct = useMemo(
    () => (expandedItem ? getProduct(products, expandedItem.productId) : null),
    [products, expandedItem]
  );
  const expandedProductOptions = useMemo(
    () => ((expandedProduct as any)?.optionsJson as ProductOptionItem[] | undefined) || [],
    [expandedProduct]
  );

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [savingItemKey, setSavingItemKey] = useState<string | null>(null);
  const [savedItemKey, setSavedItemKey] = useState<string | null>(null);
  
  // Track saved state snapshot for dirty detection
  const savedSnapshotRef = useRef<Record<string, { width: number; height: number; quantity: number; notes: string; selectedOptions: any[] }>>({});

  useEffect(() => {
    if (!expandedItem) return;
    const itemKey = getItemKey(expandedItem);
    setWidthText(String(expandedItem.width || 1));
    setHeightText(String(expandedItem.height || 1));
    setQty(expandedItem.quantity || 1);
    setNotes((expandedItem.specsJson as any)?.notes || expandedItem.notes || "");
    const selections: Record<string, OptionSelection> = {};
    (expandedItem.selectedOptions || []).forEach((opt: any) => {
      selections[opt.optionId] = {
        value: opt.value,
        grommetsLocation: opt.grommetsLocation,
        grommetsSpacingCount: opt.grommetsSpacingCount,
        grommetsPerSign: opt.grommetsPerSign,
        grommetsSpacingInches: opt.grommetsSpacingInches,
        customPlacementNote: opt.customPlacementNote,
        hemsType: opt.hemsType,
        polePocket: opt.polePocket,
      };
    });
    setOptionSelections(selections);
    setCalcError(null);
    
    // Save snapshot for dirty detection
    savedSnapshotRef.current[itemKey] = {
      width: expandedItem.width,
      height: expandedItem.height,
      quantity: expandedItem.quantity,
      notes: (expandedItem.specsJson as any)?.notes || expandedItem.notes || "",
      selectedOptions: expandedItem.selectedOptions || [],
    };
  }, [expandedItem?.id, expandedItem?.tempId]);

  const dimsRequired = requiresDimensions(expandedProduct);
  const widthNum = dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;

  // Detect if current item has unsaved changes (dirty state)
  const isDirty = useMemo(() => {
    if (!expandedItem || !expandedKey) return false;
    const saved = savedSnapshotRef.current[expandedKey];
    if (!saved) return true; // New item is always dirty
    
    const currentNotes = notes || "";
    const savedNotes = saved.notes || "";
    const currentOptions = JSON.stringify(expandedItem.selectedOptions || []);
    const savedOptions = JSON.stringify(saved.selectedOptions || []);
    
    return (
      Math.abs(widthNum - saved.width) > 0.01 ||
      Math.abs(heightNum - saved.height) > 0.01 ||
      qtyNum !== saved.quantity ||
      currentNotes !== savedNotes ||
      currentOptions !== savedOptions
    );
  }, [expandedItem, expandedKey, widthNum, heightNum, qtyNum, notes]);

  // Handle save line item
  const handleSaveItem = async () => {
    if (!expandedKey || !onSaveLineItem || !expandedItem) return;
    setSavingItemKey(expandedKey);
    setSavedItemKey(null);
    try {
      const success = await onSaveLineItem(expandedKey);
      if (success) {
        setSavedItemKey(expandedKey);
        // Update saved snapshot with current values
        savedSnapshotRef.current[expandedKey] = {
          width: widthNum,
          height: heightNum,
          quantity: qtyNum,
          notes: notes || "",
          selectedOptions: expandedItem.selectedOptions || [],
        };
        // Clear saved indicator after 2 seconds
        setTimeout(() => setSavedItemKey(null), 2000);
      }
    } finally {
      setSavingItemKey(null);
    }
  };

  // Keep line item fields in sync as user edits
  useEffect(() => {
    if (!expandedItem || !expandedKey) return;
    const nextSpecsJson = {
      ...(expandedItem.specsJson || {}),
      ...(notes ? { notes } : {}),
    };
    onUpdateLineItem(expandedKey, {
      width: Number.isFinite(widthNum) && widthNum > 0 ? widthNum : expandedItem.width,
      height: Number.isFinite(heightNum) && heightNum > 0 ? heightNum : expandedItem.height,
      quantity: qtyNum,
      specsJson: nextSpecsJson,
      notes: notes || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, widthNum, heightNum, qtyNum, notes]);

  // Identity persistence must not reset edit snapshot; only explicit user saves do.
  // The snapshot is already correctly updated in handleSaveItem when user clicks Save.
  // This effect was incorrectly treating "ID appeared" as "user saved", breaking live pricing.
  // REMOVED: Snapshot updates now ONLY occur in handleSaveItem (explicit save action).

  // Debounced price calculation for expanded item
  useDebouncedEffect(
    () => {
      if (!expandedItem || !expandedProduct) return;
      if (dimsRequired && (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0)) return;
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;

      setIsCalculating(true);
      setCalcError(null);

      const selectedOptionsArray = buildSelectedOptionsArray(expandedProductOptions, optionSelections, widthNum, heightNum, qtyNum);

      // Persist selectedOptions array on the item (for summary chips + save payload)
      if (expandedKey) {
        onUpdateLineItem(expandedKey, { selectedOptions: selectedOptionsArray });
      }

      apiRequest("POST", "/api/quotes/calculate", {
        productId: expandedItem.productId,
        variantId: expandedItem.variantId,
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        selectedOptions: optionSelections,
      })
        .then((r) => r.json())
        .then((data) => {
          const price = Number(data?.price);
          if (!Number.isFinite(price)) return;
          if (expandedKey) {
            onUpdateLineItem(expandedKey, {
              linePrice: price,
              formulaLinePrice: price,
              priceBreakdown: data?.priceBreakdown || {
                ...(expandedItem.priceBreakdown || {}),
                basePrice: price,
                total: price,
              },
            });
          }
        })
        .catch((err: any) => {
          setCalcError(err?.message || "Calculation failed");
        })
        .finally(() => setIsCalculating(false));
    },
    [
      expandedItem?.productId,
      expandedItem?.variantId,
      widthText,
      heightText,
      qtyNum,
      optionSelections,
      expandedKey,
    ],
    400
  );

  return (
    <Card className="rounded-lg border border-border/40 bg-card/50">
      <CardHeader className="px-4 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-border/60 text-xs">
            {count} {count === 1 ? 'item' : 'items'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3">
        {lineItems.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            —
          </div>
        ) : (
          <div className="space-y-2">
            {lineItems
              .filter((li) => li.status !== "canceled")
              .map((item) => {
                const itemKey = getItemKey(item);
                const isExpanded = !!itemKey && expandedKey === itemKey;
                const product = getProduct(products, item.productId);
                const subtitle = item.variantName || (product as any)?.category || (product as any)?.sku || "";

                return (
                  <div key={itemKey} className={cn("rounded-lg border border-border/40 bg-background/30", isExpanded && "bg-background/40 border-border/60")}>
                    <div className="flex items-center gap-3 p-3">
                      <LineItemThumb quoteId={quoteId} lineItemId={item.id} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold truncate">{item.productName}</div>
                          {item.status === "draft" && !readOnly && (
                            <Badge variant="secondary" className="text-[10px] py-0">
                              Draft
                            </Badge>
                          )}
                        </div>
                        {subtitle ? (
                          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
                        ) : (
                          <div className="text-xs text-muted-foreground truncate">—</div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold">{formatMoney(item.linePrice)}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {item.quantity} · {item.width}"×{item.height}"
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn("h-8 w-8", readOnly && "opacity-40 cursor-not-allowed")}
                          onClick={() => {
                            if (readOnly) return;
                            onExpandedKeyChange(isExpanded ? null : itemKey);
                          }}
                          aria-label={readOnly ? "Locked (enable Edit Mode to expand)" : isExpanded ? "Collapse line item" : "Expand line item"}
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && !readOnly && (
                      <div className="px-3 pb-3">
                        <div className="rounded-md border border-border/40 bg-muted/20 p-3 min-h-[400px]">
                          {/* Top editing row */}
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-2">
                                <Input
                                  value={widthText}
                                  onChange={(e) => setWidthText(e.target.value)}
                                  className={cn("h-8 w-24 font-mono", !dimsRequired && "opacity-60")}
                                  inputMode="decimal"
                                  disabled={!dimsRequired}
                                />
                                <span className="text-muted-foreground">×</span>
                                <Input
                                  value={heightText}
                                  onChange={(e) => setHeightText(e.target.value)}
                                  className={cn("h-8 w-24 font-mono", !dimsRequired && "opacity-60")}
                                  inputMode="decimal"
                                  disabled={!dimsRequired}
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="text-xs text-muted-foreground">Qty</div>
                              <div className="flex items-center rounded-md border border-border/60 bg-background/40">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setQty((q) => Math.max(1, (q || 1) - 1))}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <Input
                                  value={String(qty)}
                                  onChange={(e) => setQty(Number.parseInt(e.target.value || "1", 10) || 1)}
                                  className="h-8 w-16 border-0 text-center font-mono focus-visible:ring-0"
                                  inputMode="numeric"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setQty((q) => (q || 1) + 1)}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="ml-auto text-right min-h-[60px]">
                              <div className="text-xs text-muted-foreground">Total</div>
                              <div className="font-mono text-lg font-bold">{formatMoney(expandedItem?.linePrice ?? item.linePrice)}</div>
                              <div className="h-5 flex items-center justify-end">
                                {isCalculating && <div className="text-[11px] text-muted-foreground">Calculating…</div>}
                                {!!calcError && <div className="text-[11px] text-destructive">{calcError}</div>}
                                {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
                              </div>
                            </div>
                          </div>

                          <Separator className="my-3" />

                          {/* Finishing / options */}
                          <ProductOptionsPanel
                            productOptions={expandedProductOptions}
                            optionSelections={optionSelections}
                            width={widthText}
                            height={heightText}
                            quantity={String(qtyNum)}
                            requiresDimensions={dimsRequired}
                            onOptionSelectionsChange={setOptionSelections}
                          />

                          {/* Artwork */}
                          <div className="mt-3 border-t border-border/50 pt-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">Artwork</div>
                            </div>
                            <div className="mt-2">
                              <LineItemAttachmentsPanel
                                quoteId={quoteId}
                                lineItemId={item.id}
                                productName={item.productName}
                                defaultExpanded={false}
                                ensureQuoteId={ensureQuoteId}
                                ensureLineItemId={ensureLineItemId ? () => ensureLineItemId(itemKey) : undefined}
                              />
                            </div>
                          </div>

                          {/* Bottom actions */}
                          <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-sm">
                            <div className="flex items-center gap-2">
                              {onSaveLineItem && isDirty && (
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="h-8"
                                  onClick={handleSaveItem}
                                  disabled={savingItemKey === itemKey || isCalculating}
                                >
                                  {savingItemKey === itemKey ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    <>
                                      <Save className="w-3.5 h-3.5 mr-1.5" />
                                      Save Item
                                    </>
                                  )}
                                </Button>
                              )}
                              {onSaveLineItem && !isDirty && savedItemKey === itemKey && (
                                <div className="flex items-center gap-1.5 text-xs text-green-600">
                                  <Check className="w-3.5 h-3.5" />
                                  Saved
                                </div>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={() => onDuplicateLineItem(itemKey)}
                              >
                                Duplicate Item
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive hover:text-destructive"
                                onClick={() => onRemoveLineItem(itemKey)}
                              >
                                Remove Item
                              </Button>
                            </div>
                            {isDirty && (
                              <div className="text-xs text-amber-600">Unsaved</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* Add Product (edit mode only) */}
        {!readOnly && (
          <div className="mt-4 pt-4 border-t border-border/40">
            <Popover open={searchOpen} onOpenChange={(open) => {
              setSearchOpen(open);
              if (!open) {
                setSearchQuery("");
              }
            }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={searchOpen}
                  className="w-full justify-between h-9 font-normal"
                >
                  <span className="text-muted-foreground">
                    {searchQuery ? `Searching: ${searchQuery}` : "Add Product"}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[520px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search by name, SKU, or category…"
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                  />
                  <CommandList>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {filteredProducts.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={`${p.name} ${(p as any).sku || ''} ${(p as any).category || ''}`}
                          onSelect={async () => {
                            const created = await onCreateDraftLineItem(p.id);
                            const k = created ? getItemKey(created) : null;
                            setSearchQuery("");
                            setSearchOpen(false);
                            if (k) onExpandedKeyChange(k);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{p.name}</div>
                            {(p as any).sku && (
                              <div className="text-xs text-muted-foreground truncate">SKU: {(p as any).sku}</div>
                            )}
                          </div>
                          <Badge variant="outline" className="ml-2 text-[10px] shrink-0">
                            {(p as any).category || "Product"}
                          </Badge>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


