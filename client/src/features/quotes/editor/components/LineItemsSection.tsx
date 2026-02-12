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
import { ChevronDown, ChevronRight, FileText, Minus, Plus, Save, Loader2, Check, ChevronsUpDown, Download, Image, GripVertical } from "lucide-react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Product, ProductOptionItem } from "@shared/schema";
import type { QuoteLineItemDraft, OptionSelection } from "../types";
import { apiRequest } from "@/lib/queryClient";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { ProductOptionsPanelV2 } from "./ProductOptionsPanelV2";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { setPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { getAttachmentDisplayName, isPdfAttachment, getPdfPageCount } from "@/lib/attachments";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";

type LineItemsSectionProps = {
  quoteId: string | null;
  customerId?: string | null;
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
  onReorderLineItems?: (orderedKeys: string[]) => Promise<{ ok: boolean }>;
  ensureQuoteId?: () => Promise<string>;
  ensureLineItemId?: (itemKey: string) => Promise<{ quoteId: string; lineItemId: string }>;
};

function getItemKey(item: QuoteLineItemDraft): string {
  return item.tempId || item.id || "";
}

function getProduct(products: Product[], productId: string) {
  return products.find((p) => p.id === productId) ?? null;
}

type SortableChildRenderProps = {
  dragAttributes: Record<string, any> | undefined;
  dragListeners: Record<string, any> | undefined;
};

function SortableLineItemWrapper({
  id,
  children,
}: {
  id: string;
  children: (props: SortableChildRenderProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragAttributes: attributes, dragListeners: listeners })}
    </div>
  );
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

/**
 * Generic option chip extractor for collapsed line item display.
 * Works with any product's option structure without hardcoded keys.
 */
function extractOptionChips(
  selectedOptions: any[] | undefined | null,
  maxChips: number = 3
): { chips: string[]; overflowCount: number } {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
    return { chips: [], overflowCount: 0 };
  }

  const chips: string[] = [];
  
  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== 'object') continue;
    
    // Extract name from common fields
    const name = opt.optionName || opt.label || opt.name || '';
    
    // Extract value from common fields, handle booleans
    let value = opt.displayValue ?? opt.value;
    if (typeof value === 'boolean') {
      value = value ? 'Yes' : 'No';
    }
    
    // Convert to string and trim
    const nameStr = String(name).trim();
    const valueStr = value != null ? String(value).trim() : '';
    
    // Skip empty/meaningless values
    if (!nameStr) continue;
    if (!valueStr || valueStr.toLowerCase() === 'none' || valueStr.toLowerCase() === 'n/a' || valueStr === 'false' || valueStr === 'No') continue;
    
    // Build chip string: prefer short value-only when possible
    let chipText: string;
    
    if (valueStr && valueStr !== 'true' && valueStr !== 'Yes') {
      if (valueStr.length <= 12) {
        // Short value → use value only
        chipText = valueStr;
      } else if (nameStr.length <= 12) {
        // Long value, short name → use name only
        chipText = nameStr;
      } else {
        // Both long → use name with ellipsis
        chipText = nameStr.substring(0, 9) + '...';
      }
    } else {
      // Boolean yes or empty → use name only
      chipText = nameStr.length <= 12 ? nameStr : nameStr.substring(0, 9) + '...';
    }
    
    chips.push(chipText);
  }
  
  const totalCount = chips.length;
  const displayChips = chips.slice(0, maxChips);
  const overflowCount = Math.max(0, totalCount - maxChips);
  
  return { chips: displayChips, overflowCount };
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
  thumbnailUrl?: string | null;
  pageCount?: number | null;
  pages?: Array<{ thumbUrl?: string | null }>;
  lineItemId?: string; // Added for download handler
};

const isViewableUrl = (value: unknown): boolean =>
  typeof value === "string" &&
  (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/objects/"));

// Artwork strip component - shows all thumbnails in a wrapping layout
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


  const getFileIcon = (mimeType: string | null | undefined) => {
    if (!mimeType) return FileText;
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType === "application/pdf") return FileText;
    return FileText;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attachments.map((attachment) => {
        const thumbUrl = getThumbSrc(attachment);
        const FileIcon = getFileIcon(attachment.mimeType);
        const hasPreviewUrl = isViewableUrl(attachment.previewUrl);
        const hasOriginalUrl = isViewableUrl(attachment.originalUrl);
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
    </div>
  );
}

export function LineItemsSection({
  quoteId,
  customerId,
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
  onReorderLineItems,
  ensureQuoteId,
  ensureLineItemId,
}: LineItemsSectionProps) {
  const count = lineItems.filter((li) => li.status !== "canceled").length;

  // TEMP UI-only reorder state (not persisted)
  const [uiOrderKeys, setUiOrderKeys] = useState<string[] | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Reset UI order when lineItems change
  useEffect(() => {
    setUiOrderKeys(null);
  }, [lineItems]);

  // Derive stable keys and ordered line items
  const baseKeys = lineItems.map(li => getItemKey(li)).filter(Boolean) as string[];
  const orderedKeys = uiOrderKeys ?? baseKeys;
  
  const orderedLineItems = useMemo(() => {
    const ordered = orderedKeys
      .map(k => lineItems.find(li => getItemKey(li) === k))
      .filter(Boolean) as typeof lineItems;
    return ordered.length === lineItems.length ? ordered : lineItems;
  }, [orderedKeys, lineItems]);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Handle drag end
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    // Compute new order
    const current = uiOrderKeys ?? baseKeys;
    const oldIndex = current.indexOf(active.id as string);
    const newIndex = current.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    
    const nextKeys = arrayMove(current, oldIndex, newIndex);
    
    // Update UI immediately
    setUiOrderKeys(nextKeys);

    // Persist if we have a persisted quote and handler
    if (quoteId && onReorderLineItems && !readOnly) {
      setIsSavingOrder(true);
      const result = await onReorderLineItems(nextKeys);
      setIsSavingOrder(false);
      
      if (result.ok) {
        // Clear UI order after successful save (let server order drive)
        setUiOrderKeys(null);
      }
      // If failed, uiOrderKeys stays set and will be reset on next lineItems change
    }
  }

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

  // Prefer pbv2SnapshotJson.treeJson from line item (server-calculated)
  // Fallback to product definition optionTreeJson
  const expandedOptionTreeJson = useMemo(() => {
    const snapshot = (expandedItem as any)?.pbv2SnapshotJson;
    if (snapshot?.treeJson) {
      return snapshot.treeJson as OptionTreeV2 | null;
    }
    return (((expandedProduct as any)?.optionTreeJson ?? null) as OptionTreeV2 | null) ?? null;
  }, [expandedProduct, expandedItem]);

  const isExpandedTreeV2 = useMemo(() => {
    return Boolean(expandedOptionTreeJson && (expandedOptionTreeJson as any)?.schemaVersion === 2);
  }, [expandedOptionTreeJson]);
  const expandedProductOptions = useMemo(
    () => {
      const base = ((expandedProduct as any)?.optionsJson as ProductOptionItem[] | undefined) || [];
      return injectDerivedMaterialOptionIntoProductOptions(expandedProduct, base);
    },
    [expandedProduct]
  );

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [savingItemKey, setSavingItemKey] = useState<string | null>(null);
  const [savedItemKey, setSavedItemKey] = useState<string | null>(null);
  
  // Track saved state snapshot for dirty detection
  const savedSnapshotRef = useRef<
    Record<
      string,
      {
        width: number;
        height: number;
        quantity: number;
        notes: string;
        selectedOptions: any[];
        optionSelectionsJson: any;
      }
    >
  >({});

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

    const rawV2 = (expandedItem as any)?.optionSelectionsJson;
    if (rawV2 && typeof rawV2 === "object" && (rawV2 as any)?.schemaVersion === 2) {
      setOptionSelectionsV2(rawV2 as LineItemOptionSelectionsV2);
    } else {
      setOptionSelectionsV2({ schemaVersion: 2, selected: {} });
    }

    setCalcError(null);
    
    // Save snapshot for dirty detection
    savedSnapshotRef.current[itemKey] = {
      width: expandedItem.width,
      height: expandedItem.height,
      quantity: expandedItem.quantity,
      notes: (expandedItem.specsJson as any)?.notes || expandedItem.notes || "",
      selectedOptions: expandedItem.selectedOptions || [],
      optionSelectionsJson: (expandedItem as any)?.optionSelectionsJson ?? null,
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

    const currentV2 = JSON.stringify((expandedItem as any)?.optionSelectionsJson ?? null);
    const savedV2 = JSON.stringify(saved.optionSelectionsJson ?? null);
    
    return (
      Math.abs(widthNum - saved.width) > 0.01 ||
      Math.abs(heightNum - saved.height) > 0.01 ||
      qtyNum !== saved.quantity ||
      currentNotes !== savedNotes ||
      currentOptions !== savedOptions ||
      currentV2 !== savedV2
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
          optionSelectionsJson: (expandedItem as any)?.optionSelectionsJson ?? null,
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

    // Persist canonical v2 selections locally when the v2 panel is active.
    const v2Patch = isExpandedTreeV2
      ? { optionSelectionsJson: optionSelectionsV2 }
      : {};

    onUpdateLineItem(expandedKey, {
      width: Number.isFinite(widthNum) && widthNum > 0 ? widthNum : expandedItem.width,
      height: Number.isFinite(heightNum) && heightNum > 0 ? heightNum : expandedItem.height,
      quantity: qtyNum,
      specsJson: nextSpecsJson,
      notes: notes || undefined,
      ...(v2Patch as any),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, widthNum, heightNum, qtyNum, notes, isExpandedTreeV2, optionSelectionsV2]);

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

      if (isExpandedTreeV2 && !optionsV2Valid) {
        setCalcError(null);
        return;
      }

      setIsCalculating(true);
      setCalcError(null);

      if (!isExpandedTreeV2) {
        const selectedOptionsArray = buildSelectedOptionsArray(expandedProductOptions, optionSelections, widthNum, heightNum, qtyNum);

        // Persist selectedOptions array on the item (for summary chips + save payload)
        if (expandedKey) {
          onUpdateLineItem(expandedKey, { selectedOptions: selectedOptionsArray });
        }
      }

      // PBV2 request: backend expects optionSelectionsJson as Record<string, any>
      // ProductOptionsPanelV2 manages LineItemOptionSelectionsV2 { schemaVersion: 2, selected: {...} }
      // Extract .selected dict for API
      const pbv2Payload = isExpandedTreeV2 
        ? { optionSelectionsJson: optionSelectionsV2.selected || {} } 
        : {};
      const v1Payload = !isExpandedTreeV2 ? { selectedOptions: optionSelections } : {};

      apiRequest("POST", "/api/quotes/calculate", {
        productId: expandedItem.productId,
        variantId: expandedItem.variantId,
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        ...pbv2Payload,
        ...v1Payload,
        customerId,
        quoteId,
        debugSource: "LineItemsSection",
      })
        .then((r) => r.json())
        .then((data) => {
          // Backend returns 'linePrice' in dollars (legacy compatibility)
          const price = Number(data?.linePrice);
          if (!Number.isFinite(price)) return;
          if (expandedKey) {
            const breakdown = data?.breakdown;
            const snapshotSelectedOptions = Array.isArray(breakdown?.selectedOptions) ? breakdown.selectedOptions : undefined;
            onUpdateLineItem(expandedKey, {
              linePrice: price,
              formulaLinePrice: price,
              priceBreakdown:
                breakdown ||
                ({
                  ...(expandedItem.priceBreakdown || {}),
                  basePrice: price,
                  total: price,
                } as any),
              ...(snapshotSelectedOptions ? { selectedOptions: snapshotSelectedOptions } : {}),
              // Store PBV2 snapshot from /calculate for future reference
              ...(data?.pbv2SnapshotJson ? { pbv2SnapshotJson: data.pbv2SnapshotJson } : {}),
            });
          }
        })
        .catch((err: any) => {
          // Parse JSON error for PBV2 schema mismatch
          let errorMessage = err?.message || "Calculation failed";
          try {
            // Error message format: "400: {json}" or similar
            const jsonMatch = errorMessage.match(/\d+:\s*({.*})/);
            if (jsonMatch) {
              const errorData = JSON.parse(jsonMatch[1]);
              if (errorData.code === "PBV2_E_SCHEMA_VERSION_MISMATCH") {
                errorMessage = "PBV2_SCHEMA_MISMATCH";
              }
            }
          } catch (parseErr) {
            // Keep original error message if parsing fails
          }
          setCalcError(errorMessage);
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
      optionSelectionsV2,
      isExpandedTreeV2,
      optionsV2Valid,
      expandedKey,
      customerId,
      quoteId,
    ],
    400
  );

  return (
    <Card className="rounded-lg border border-border/40 bg-card/50">
      {/* TESTER: Verify this fingerprint appears on /orders/new after hard refresh */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 99999,
        padding: "10px 12px",
        background: "#ff0066",
        color: "white",
        fontWeight: 900,
        letterSpacing: "0.5px"
      }}>
        ORDERS_REAL_UI_FINGERPRINT_v124
      </div>
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {orderedLineItems
                  .filter((li) => li.status !== "canceled")
                  .map((item, itemIndex) => {
                    const itemKey = getItemKey(item);
                    const isExpanded = !!itemKey && expandedKey === itemKey;
                    const contentId = itemKey ? `line-item-${itemKey}-details` : undefined;
                    const product = getProduct(products, item.productId);
                    
                    // Generic option summary (no hardcoded keys)
                    const { chips: optionChips, overflowCount } = extractOptionChips(item.selectedOptions, 3);
                    
                    // Meta indicators (best effort with existing fields)
                    const hasNote = !!(item.notes || (item.specsJson as any)?.notes);
                    const hasOverride = !!((item as any).priceOverride || (item as any).manualPrice);

                    return (
                      <SortableLineItemWrapper key={itemKey} id={itemKey}>
                        {({ dragAttributes, dragListeners }) => (
                          <div className={cn("rounded-lg border border-border/40 bg-background/30", isExpanded && "bg-background/40 border-border/60")}>
                            {/* Collapsed Summary Row - Enterprise Dense Layout */}
                            <button
                              type="button"
                              className="w-full text-left p-2.5 hover:bg-muted/20 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-lg"
                              onClick={() => {
                                onExpandedKeyChange(isExpanded ? null : itemKey);
                              }}
                              aria-expanded={isExpanded}
                              aria-controls={contentId}
                              aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
                            >
                              <div className="grid gap-2 items-center" style={{ gridTemplateColumns: readOnly ? 'minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' : 'auto minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' }}>
                                {/* Drag Handle (edit mode only) */}
                                {!readOnly && (
                                  <button
                                    type="button"
                                    className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded p-0.5 disabled:opacity-30 disabled:cursor-not-allowed self-center"
                                    {...dragAttributes}
                                    {...dragListeners}
                                    disabled={isSavingOrder}
                                    aria-label="Drag to reorder"
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    <GripVertical className="h-4 w-4" />
                                  </button>
                                )}
                                
                                {/* Left Zone: Product + Size + Qty */}
                                <div className="flex items-center gap-2 min-w-0">
                                  <LineItemThumbnail parentId={quoteId} lineItemId={item.id} parentType="quote" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="text-sm font-semibold truncate">{item.productName}</span>
                                      {item.status === "draft" && !readOnly && (
                                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 shrink-0">
                                          Draft
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                                      <span className="font-mono">{item.width}" × {item.height}"</span>
                                      <span>·</span>
                                      <span>Qty {item.quantity}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Middle Zone: Option Chips (single line, no wrap) */}
                                <div className="min-w-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                                  {optionChips.map((chip, idx) => (
                                    <span
                                      key={idx}
                                      className="px-1.5 py-0.5 rounded text-[11px] bg-muted/40 text-muted-foreground whitespace-nowrap shrink-0"
                                    >
                                      {chip}
                                    </span>
                                  ))}
                                  {overflowCount > 0 && (
                                    <span className="text-[11px] text-muted-foreground/60 shrink-0">
                                      +{overflowCount}
                                    </span>
                                  )}
                                </div>

                                {/* Right Zone: Price + Expand Icon */}
                                <div className="flex items-center justify-end gap-2 shrink-0">
                                  <div className="text-right tabular-nums">
                                    <div className="font-mono text-sm font-semibold">{formatMoney(item.linePrice)}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {formatMoney(item.linePrice / item.quantity)}/ea
                                    </div>
                                  </div>
                                  <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
                                </div>
                              </div>

                              {/* Optional Meta Row (only if relevant) */}
                              {(hasNote || hasOverride) && (
                                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                                  {hasNote && <span>Note</span>}
                                  {hasOverride && (
                                    <>
                                      {hasNote && <span>·</span>}
                                      <span>Overridden</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </button>

                            {/* Expanded Editor - When Expanded (edit mode OR view mode) */}
                            {isExpanded && (
                      <div id={contentId} className="px-3 pb-3">
                        <div className="rounded-md border border-border/40 bg-muted/20 p-3 min-h-[400px]">
                          {/* Top editing row */}
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted-foreground">Width</div>
                                  <Input
                                    value={widthText}
                                    onChange={(e) => setWidthText(e.target.value)}
                                    className={cn("h-8 w-24 font-mono", !dimsRequired && "opacity-60")}
                                    inputMode="decimal"
                                    disabled={readOnly || !dimsRequired}
                                    readOnly={readOnly}
                                  />
                                </div>
                                <span className="text-muted-foreground self-end pb-2">×</span>
                                <div className="flex flex-col gap-1">
                                  <div className="text-xs text-muted-foreground">Height</div>
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
                                {!!calcError && calcError === "PBV2_SCHEMA_MISMATCH" && (
                                  <div className="text-[11px] text-amber-600 dark:text-amber-500 font-medium">
                                    ⚠️ Outdated PBV2 config
                                  </div>
                                )}
                                {!!calcError && calcError !== "PBV2_SCHEMA_MISMATCH" && (
                                  <div className="text-[11px] text-destructive">{calcError}</div>
                                )}
                                {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
                              </div>
                            </div>
                          </div>

                          <Separator className="my-3" />

                          {/* TESTER: Verify this fingerprint appears when line item is expanded */}
                          <div style={{ padding: 10, background: "#220022", color: "white", fontWeight: 900 }}>
                            LINEITEM_EDITOR_FINGERPRINT_v124
                          </div>

                          {/* Options (left) + Artwork (right) */}
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
                            <div className="min-w-0">
                              {/* DEBUG: PBV2 snapshot status */}
                              {isExpandedTreeV2 && (
                                <div style={{ color: 'orange', fontSize: '12px', marginBottom: '8px', fontFamily: 'monospace' }}>
                                  PBV2: snapshot={(expandedItem as any)?.pbv2SnapshotJson ? 'true' : 'false'} visible={(expandedItem as any)?.pbv2SnapshotJson?.visibleNodeIds?.length || 0}
                                </div>
                              )}
                              {/* Finishing / options */}
                              {isExpandedTreeV2 && expandedOptionTreeJson ? (
                                <ProductOptionsPanelV2
                                  tree={expandedOptionTreeJson}
                                  selections={optionSelectionsV2}
                                  onSelectionsChange={setOptionSelectionsV2}
                                  onValidityChange={setOptionsV2Valid}
                                />
                              ) : (
                                <ProductOptionsPanel
                                  product={expandedProduct}
                                  productOptions={expandedProductOptions}
                                  optionSelections={optionSelections}
                                  onOptionSelectionsChange={setOptionSelections}
                                />
                              )}

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
                                        disabled={savingItemKey === itemKey || isCalculating || (isExpandedTreeV2 && !optionsV2Valid)}
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

                            {/* Artwork panel (right on desktop, stacks below on small) */}
                            <div className="min-w-0 lg:w-[360px] lg:shrink-0">
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
                                  ensureLineItemId={!readOnly && ensureLineItemId ? () => {
                                    // Save scroll position AND expansion before ensuring (for restoration after route change)
                                    setPendingScrollPosition(window.scrollY);
                                    setPendingExpandedLineItemId(itemKey, itemIndex);
                                    return ensureLineItemId(itemKey);
                                  } : undefined}
                                  lineItemKey={itemKey}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                            )}
                          </div>
                        )}
                      </SortableLineItemWrapper>
                    );
                  })}
              </div>
            </SortableContext>
          </DndContext>
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
            const isPdf = isPdfAttachment(previewFile);
            const thumbSrc = getThumbSrc(previewFile as any);
            const previewUrl = previewFile.previewUrl ?? previewFile.originalUrl;

            const isViewableUrl = (url: unknown) =>
              typeof url === "string" &&
              (url.startsWith("/objects/") || url.startsWith("http://") || url.startsWith("https://"));

            const originalUrl =
              previewFile.originalUrl ??
              (previewFile as any).originalURL ??
              (previewFile as any).url ??
              null;
            const canDownloadOriginal = isViewableUrl(originalUrl);
            const fileName = previewFile.originalFilename || previewFile.fileName;
            const lineItemId = previewFile.lineItemId;
            const filesApiPath = lineItemId
              ? (quoteId
                  ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
                  : `/api/line-items/${lineItemId}/files`)
              : null;
            const canDownloadViaApi = typeof filesApiPath === "string" && filesApiPath.length > 0;

            const handleDownload = async () => {
              try {
                if (!filesApiPath) return;
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
                {typeof thumbSrc === "string" && isViewableUrl(thumbSrc) ? (
                  <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                    <img src={thumbSrc} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
                  </div>
                ) : !isPdf && isViewableUrl(previewUrl) ? (
                  <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                    <img src={previewUrl!} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
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
                  
                  {(canDownloadViaApi || canDownloadOriginal) && (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        onClick={() => {
                          if (canDownloadViaApi) {
                            handleDownload();
                            return;
                          }
                          if (canDownloadOriginal) {
                            const anchor = document.createElement("a");
                            anchor.href = originalUrl!;
                            anchor.download = fileName;
                            anchor.target = "_blank";
                            anchor.rel = "noreferrer";
                            anchor.style.display = "none";
                            document.body.appendChild(anchor);
                            anchor.click();
                            document.body.removeChild(anchor);
                          }
                        }}
                        variant="outline"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download original
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


