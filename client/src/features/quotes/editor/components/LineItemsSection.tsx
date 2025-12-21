import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, FileText, Minus, Plus, Save, Loader2, Check, ChevronsUpDown, Download, Image } from "lucide-react";
import type { Product, ProductOptionItem } from "@shared/schema";
import type { QuoteLineItemDraft, OptionSelection } from "../types";
import { apiRequest } from "@/lib/queryClient";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { getAttachmentDisplayName, isPdfAttachment, getPdfPageCount } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";

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

type AttachmentForPreview = {
  id: string;
  fileName: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  originalUrl?: string | null;
  previewUrl?: string | null;
  thumbUrl?: string | null;
  pageCount?: number | null;
  pages?: Array<{ thumbUrl?: string | null }>;
  lineItemId?: string; // Added for download handler
};

function LineItemThumb({ quoteId, lineItemId }: { quoteId: string | null; lineItemId: string | undefined }) {
  const [imageError, setImageError] = useState(false);
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
  
  // Don't render anything if no attachments
  if (!first) {
    return (
      <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0 flex items-center justify-center">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const isImage = first?.mimeType?.startsWith?.("image/");
  const isPdf = first?.mimeType === "application/pdf" || (first?.fileName || "").toLowerCase().endsWith(".pdf");
  
  // Determine image URL - ONLY use signed URLs from server, never construct URLs client-side
  // For images: use thumbUrl if available, fallback to originalUrl (both are signed URLs from server)
  // For PDFs: use first page thumbUrl if available (signed URL from server)
  let imageUrl: string | null = null;
  if (!imageError && first) {
    if (isImage) {
      // Only use signed URLs - thumbUrl or originalUrl (both from server)
      const candidateUrl = first?.thumbUrl || first?.originalUrl;
      // Validate URL is actually a string and looks like a URL
      if (candidateUrl && typeof candidateUrl === 'string' && candidateUrl.startsWith('http')) {
        imageUrl = candidateUrl;
      }
    } else if (isPdf && first?.pages?.length > 0) {
      // Only use signed thumbUrl from first page
      const candidateUrl = first.pages[0]?.thumbUrl;
      if (candidateUrl && typeof candidateUrl === 'string' && candidateUrl.startsWith('http')) {
        imageUrl = candidateUrl;
      }
    }
  }

  return (
    <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0">
      {imageUrl ? (
        <img 
          src={imageUrl} 
          alt="" 
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
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

// Artwork strip component - shows up to 3 thumbnails + "+N" indicator
function LineItemArtworkStrip({ 
  quoteId, 
  lineItemId, 
  onPreview 
}: { 
  quoteId: string | null; 
  lineItemId: string | undefined;
  onPreview: (attachment: AttachmentForPreview & { lineItemId: string }) => void;
}) {
  const filesApiPath = quoteId
    ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
    : `/api/line-items/${lineItemId}/files`;

  const { data: attachments = [] } = useQuery<AttachmentForPreview[]>({
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

  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.slice(0, 3);
  const remainingCount = attachments.length - 3;

  const getThumbnailUrl = (attachment: AttachmentForPreview): string | null => {
    // Prefer previewUrl, fallback to thumbUrl, then originalUrl
    if (attachment.previewUrl && isValidHttpUrl(attachment.previewUrl)) {
      return attachment.previewUrl;
    }
    // For PDFs, use first page thumbUrl
    if (attachment.mimeType === 'application/pdf' && attachment.pages?.[0]?.thumbUrl) {
      const url = attachment.pages[0].thumbUrl;
      if (url && isValidHttpUrl(url)) return url;
    }
    // For other files, use thumbUrl
    if (attachment.thumbUrl && isValidHttpUrl(attachment.thumbUrl)) {
      return attachment.thumbUrl;
    }
    // Fallback to originalUrl for preview (only if no thumbUrl/previewUrl)
    if (attachment.originalUrl && isValidHttpUrl(attachment.originalUrl)) {
      return attachment.originalUrl;
    }
    return null;
  };

  const getFileIcon = (mimeType: string | null | undefined) => {
    if (!mimeType) return FileText;
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType === "application/pdf") return FileText;
    return FileText;
  };

  return (
    <div className="flex items-center gap-1.5">
      {visibleAttachments.map((attachment) => {
        const thumbUrl = getThumbnailUrl(attachment);
        const FileIcon = getFileIcon(attachment.mimeType);
        const hasPreviewUrl = attachment.previewUrl && isValidHttpUrl(attachment.previewUrl);
        const hasOriginalUrl = attachment.originalUrl && isValidHttpUrl(attachment.originalUrl);
        const canPreview = hasPreviewUrl || hasOriginalUrl;
        const fileName = getAttachmentDisplayName(attachment);
        const isPdf = isPdfAttachment(attachment);
        const pageCount = getPdfPageCount(attachment);
        const showPageCount = isPdf && pageCount !== null && pageCount > 1;
        
        return (
          <div key={attachment.id} className="relative shrink-0">
            <button
              type="button"
              className="h-8 w-8 rounded border border-border/60 overflow-hidden shrink-0 cursor-pointer hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 bg-muted/30"
              style={{ cursor: canPreview ? "pointer" : "default" }}
              onClick={(e) => {
                if (!canPreview) return;
                e.stopPropagation();
                onPreview({ ...attachment, lineItemId: lineItemId || '' });
              }}
              onPointerDownCapture={(e) => {
                if (!canPreview) return;
                e.stopPropagation();
              }}
              disabled={!canPreview}
              title={fileName}
              aria-label={canPreview ? `Preview ${fileName}` : `${fileName} (no preview available)`}
            >
              {thumbUrl ? (
                <img 
                  src={thumbUrl} 
                  alt={fileName}
                  title={fileName}
                  className="w-full h-full object-cover pointer-events-none"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <FileIcon className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </button>
            {showPageCount && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-medium bg-muted border border-border/60 rounded text-muted-foreground leading-none whitespace-nowrap">
                Pages: {pageCount}
              </span>
            )}
          </div>
        );
      })}
      {remainingCount > 0 && (
        <button
          type="button"
          className="h-8 px-2 rounded border border-border/60 bg-muted/30 flex items-center justify-center shrink-0 cursor-pointer hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            // Optional: expand line item when clicking +N (nice-to-have)
            // This would require passing an expand handler, but for now just show it's clickable
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          aria-label={`${remainingCount} more file${remainingCount === 1 ? '' : 's'}`}
          title={`${remainingCount} more file${remainingCount === 1 ? '' : 's'}`}
        >
          <span className="text-[10px] font-medium text-muted-foreground">+{remainingCount}</span>
        </button>
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
  
  // Preview modal state (shared with artwork strip)
  const [previewFile, setPreviewFile] = useState<AttachmentForPreview | null>(null);

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

                // Extract key options for summary display
                const displayOptions = (item.selectedOptions || []).slice(0, 4).map((opt: any) => {
                  let displayValue = '';
                  if (typeof opt.value === 'boolean') {
                    displayValue = opt.value ? 'Yes' : 'No';
                  } else if (opt.value !== undefined && opt.value !== null && opt.value !== '') {
                    displayValue = `: ${opt.value}`;
                  }
                  return {
                    name: opt.optionName,
                    display: `${opt.optionName}${displayValue}`,
                  };
                });

                return (
                  <div key={itemKey} className={cn("rounded-lg border border-border/40 bg-background/30", isExpanded && "bg-background/40 border-border/60")}>
                    {/* Collapsed Summary Row - Always Visible */}
                    <div className="p-3">
                      <div className="flex items-start gap-3">
                        {/* Thumbnail */}
                        <LineItemThumb quoteId={quoteId} lineItemId={item.id} />

                        {/* Product Info & Details */}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {/* Product Name + Category */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold">{item.productName}</div>
                            {subtitle && (
                              <span className="text-xs text-muted-foreground">• {subtitle}</span>
                            )}
                            {item.status === "draft" && !readOnly && (
                              <Badge variant="secondary" className="text-[10px] py-0">
                                Draft
                              </Badge>
                            )}
                          </div>

                          {/* Size + Quantity */}
                          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            <span className="font-mono">
                              {item.width}" × {item.height}"
                            </span>
                            <span>•</span>
                            <span>
                              Qty: <span className="font-semibold text-foreground">{item.quantity}</span>
                            </span>
                          </div>

                          {/* Key Options (2-4 shown) */}
                          {displayOptions.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                              {displayOptions.map((opt, idx) => (
                                <Badge 
                                  key={idx} 
                                  variant="outline" 
                                  className="font-normal text-[10px] px-1.5 py-0 border-border/60"
                                >
                                  {opt.display}
                                </Badge>
                              ))}
                              {(item.selectedOptions || []).length > 4 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{(item.selectedOptions || []).length - 4} more
                                </span>
                              )}
                            </div>
                          )}
                          
                          {/* Artwork strip - shows up to 3 thumbnails +N indicator */}
                          <div className="mt-1.5">
                            <LineItemArtworkStrip
                              quoteId={quoteId}
                              lineItemId={item.id}
                              onPreview={setPreviewFile}
                            />
                          </div>
                        </div>

                        {/* Price + Expand Button */}
                        <div className="flex items-start gap-3 shrink-0">
                          <div className="text-right">
                            <div className="font-mono text-sm font-semibold whitespace-nowrap">{formatMoney(item.linePrice)}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatMoney(item.linePrice / item.quantity)}/ea
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              onExpandedKeyChange(isExpanded ? null : itemKey);
                            }}
                            aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Editor - When Expanded (edit mode) OR Read-Only View (for attachments) */}
                    {isExpanded && (
                      <>
                        {!readOnly && (
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
                                  disabled={readOnly || !dimsRequired}
                                  readOnly={readOnly}
                                />
                                <span className="text-muted-foreground">×</span>
                                <Input
                                  value={heightText}
                                  onChange={(e) => setHeightText(e.target.value)}
                                  className={cn("h-8 w-24 font-mono", !dimsRequired && "opacity-60")}
                                  inputMode="decimal"
                                  disabled={readOnly || !dimsRequired}
                                  readOnly={readOnly}
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
                                  disabled={readOnly}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <Input
                                  value={String(qty)}
                                  onChange={(e) => setQty(Number.parseInt(e.target.value || "1", 10) || 1)}
                                  className="h-8 w-16 border-0 text-center font-mono focus-visible:ring-0"
                                  inputMode="numeric"
                                  disabled={readOnly}
                                  readOnly={readOnly}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setQty((q) => (q || 1) + 1)}
                                  disabled={readOnly}
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

                          {/* Bottom actions - Edit mode only */}
                          {!readOnly && (
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
                          )}
                        </div>
                      </div>
                        )}
                        
                        {/* Artwork Panel - Always visible when expanded (edit or view mode) */}
                        <div className="px-3 pb-3">
                          <div className={cn("rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-medium">Artwork</div>
                            </div>
                            <LineItemAttachmentsPanel
                              quoteId={quoteId}
                              lineItemId={item.id}
                              productName={item.productName}
                              defaultExpanded={readOnly ? true : false}
                              ensureQuoteId={!readOnly ? ensureQuoteId : undefined}
                              ensureLineItemId={!readOnly && ensureLineItemId ? () => ensureLineItemId(itemKey) : undefined}
                            />
                          </div>
                        </div>
                      </>
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
      
      {/* Shared Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previewFile ? getAttachmentDisplayName(previewFile) : ""}
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-1">
                {previewFile?.mimeType ? (
                  <div>
                    <span>File type: </span>
                    <span>{previewFile.mimeType}</span>
                  </div>
                ) : (
                  <div>Preview attachment</div>
                )}
                <AttachmentPreviewMeta attachment={previewFile} />
              </div>
            </DialogDescription>
          </DialogHeader>
          {previewFile && (() => {
            const isPdf = previewFile.mimeType === 'application/pdf';
            const previewUrl = previewFile.previewUrl ?? previewFile.originalUrl;
            const hasValidPreview = !isPdf && previewUrl && isValidHttpUrl(previewUrl);
            const hasValidOriginal = previewFile.originalUrl && isValidHttpUrl(previewFile.originalUrl);
            const fileName = previewFile.originalFilename || previewFile.fileName;
            // Find the line item ID for this attachment - we need to get it from the attachment's lineItemId
            // For now, we'll need to pass lineItemId through the preview state or find it another way
            // Since we don't have lineItemId in the preview state, we'll construct the path differently
            // Actually, we need to get the lineItemId - let's store it in the preview state
            // For now, let's use a simpler approach - we'll need to pass more context
            
            const handleDownload = async () => {
              try {
                const lineItemId = previewFile.lineItemId;
                if (!lineItemId) return;
                const filesApiPath = quoteId
                  ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
                  : `/api/line-items/${lineItemId}/files`;
                const proxyUrl = `${filesApiPath}/${previewFile.id}/download/proxy`;
                const anchor = document.createElement("a");
                anchor.href = proxyUrl;
                anchor.download = fileName;
                anchor.rel = "noreferrer";
                anchor.style.display = "none";
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
              } catch (error: any) {
                console.error("[PreviewDownload] Error:", error);
              }
            };
            
            return (
              <div className="space-y-4">
                {isPdf ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-sm mb-4">PDF preview not available</p>
                    {hasValidOriginal && (
                      <div className="flex flex-col items-center gap-1">
                        <Button
                          onClick={handleDownload}
                          variant="outline"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </Button>
                        <span className="text-xs text-muted-foreground">Downloads original file</span>
                      </div>
                    )}
                  </div>
                ) : hasValidPreview ? (
                  <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                    <img 
                      src={previewUrl} 
                      alt={fileName}
                      className="max-w-full max-h-[60vh] object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-sm">Preview not available for this file</p>
                  </div>
                )}
                
                <div className="flex items-center justify-between text-sm">
                  <div className="space-y-1">
                    <div>
                      <span className="font-medium">Filename: </span>
                      <span className="text-muted-foreground">{fileName}</span>
                    </div>
                    {previewFile.mimeType && (
                      <div>
                        <span className="font-medium">Type: </span>
                        <span className="text-muted-foreground">{previewFile.mimeType}</span>
                      </div>
                    )}
                  </div>
                  
                  {!isPdf && hasValidOriginal && (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        onClick={handleDownload}
                        variant="outline"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <span className="text-xs text-muted-foreground">Downloads original file</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}


