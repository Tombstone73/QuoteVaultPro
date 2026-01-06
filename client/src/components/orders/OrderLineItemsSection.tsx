import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Image,
  Loader2,
  Minus,
  Plus,
  Save,
  Check,
  Trash2,
  Upload,
  GripVertical,
} from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OrderLineItem, Product, ProductOptionItem } from "@shared/schema";
import type { OptionSelection } from "@/features/quotes/editor/types";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { getAttachmentDisplayName, getPdfPageCount, isPdfAttachment } from "@/lib/attachments";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import { useToast } from "@/hooks/use-toast";
import { useCreateOrderLineItem, useDeleteOrderLineItem, useUpdateOrderLineItem, useUpdateOrderLineItemStatus } from "@/hooks/useOrders";
import { useOrderFiles } from "@/hooks/useOrderFiles";
import type { OrderFileWithUser } from "@/hooks/useOrderFiles";

type SortableChildRenderProps = {
  dragAttributes: Record<string, any> | undefined;
  dragListeners: Record<string, any> | undefined;
  isDragging: boolean;
  isOver: boolean;
};

function SortableOrderLineItemWrapper({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (props: SortableChildRenderProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragAttributes: attributes,
        dragListeners: listeners,
        isDragging,
        isOver,
      })}
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
  previewThumbnailUrl?: string | null;
  pages?: any[];
  pageCount?: number | null;
};

function getPdfThumbUrl(attachment: AttachmentForPreview | null): string | null {
  if (!attachment) return null;
  const src = getThumbSrc(attachment as any);
  return typeof src === 'string' && src.length ? src : null;
}

function buildOneLineOptionsSummary(selectedOptions: any[] | undefined | null): string {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return "";

  const parts: string[] = [];
  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== 'object') continue;
    const name = String(opt.optionName || opt.label || opt.name || '').trim();
    let value: any = opt.displayValue ?? opt.value;
    if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
    const valueStr = value != null ? String(value).trim() : '';
    if (!name && !valueStr) continue;
    if (valueStr === '' || valueStr.toLowerCase() === 'none' || valueStr.toLowerCase() === 'n/a' || valueStr === 'false' || valueStr === 'No') continue;
    parts.push(name ? `${name}: ${valueStr}` : valueStr);
  }

  if (parts.length <= 2) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
}

export function OrderLineItemsSection({
  orderId,
  customerId,
  readOnly,
  lineItems,
  onAfterLineItemsChange,
}: {
  orderId: string;
  customerId?: string | null;
  readOnly: boolean;
  lineItems: OrderLineItem[];
  onAfterLineItemsChange?: () => Promise<void>;
}) {
  const { toast } = useToast();

  const updateLineItem = useUpdateOrderLineItem(orderId);
  const updateLineItemStatus = useUpdateOrderLineItemStatus(orderId);
  const createLineItem = useCreateOrderLineItem(orderId);
  const deleteLineItem = useDeleteOrderLineItem(orderId);

  const { data: productsResponse } = useQuery<any>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  const products = (productsResponse?.data || productsResponse || []) as Product[];

  const { data: allOrderFiles = [] } = useOrderFiles(orderId);

  // UI-only reordering: keep a stable ordered id list for the current session.
  const activeLineItems = useMemo(
    () => lineItems.filter((li) => li.status !== "canceled"),
    [lineItems]
  );

  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);

  useEffect(() => {
    const nextIds = activeLineItems.map((li) => li.id);

    setOrderedKeys((prev) => {
      if (!prev.length) return nextIds;

      const existing = prev.filter((id) => nextIds.includes(id));
      const additions = nextIds.filter((id) => !existing.includes(id));
      return [...existing, ...additions];
    });
  }, [activeLineItems]);

  const orderedLineItems = useMemo(() => {
    if (!orderedKeys.length) return activeLineItems;
    const byId = new Map(activeLineItems.map((li) => [li.id, li] as const));
    return orderedKeys.map((id) => byId.get(id)).filter(Boolean) as OrderLineItem[];
  }, [activeLineItems, orderedKeys]);

  const sortableItems = useMemo(
    () => (orderedKeys.length ? orderedKeys : activeLineItems.map((li) => li.id)),
    [orderedKeys, activeLineItems]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const expandedItem = useMemo(
    () => lineItems.find((li) => li.id === expandedId) ?? null,
    [lineItems, expandedId]
  );

  const expandedProduct = useMemo(() => {
    if (!expandedItem) return null;
    return products.find((p) => p.id === expandedItem.productId) ?? null;
  }, [expandedItem, products]);

  const expandedProductOptions = useMemo(() => {
    const base = ((expandedProduct as any)?.optionsJson as ProductOptionItem[] | undefined) || [];
    return injectDerivedMaterialOptionIntoProductOptions(expandedProduct, base);
  }, [expandedProduct]);

  const dimsRequired = requiresDimensions(expandedProduct);

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [computedTotal, setComputedTotal] = useState<number | null>(null);

  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const savedSnapshotRef = useRef<
    Record<
      string,
      {
        width: number;
        height: number;
        quantity: number;
        notes: string;
        optionSelections: Record<string, OptionSelection>;
        totalPrice: number;
      }
    >
  >({});

  // Inline add product search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Preview modal state (shared with artwork panel)
  const [previewFile, setPreviewFile] = useState<AttachmentForPreview | null>(null);

  const filteredProducts = useMemo(() => {
    const active = products.filter((p) => (p as any).isActive !== false);
    if (!searchQuery.trim()) return active;
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

  // Initialize local editor state when expanded item changes
  useEffect(() => {
    if (!expandedItem) return;
    const itemId = expandedItem.id;

    setWidthText(String(expandedItem.width || 1));
    setHeightText(String(expandedItem.height || 1));
    setQty(expandedItem.quantity || 1);

    const nextNotes =
      (expandedItem.specsJson as any)?.notes ||
      expandedItem.description ||
      "";
    setNotes(nextNotes);

    const selections: Record<string, OptionSelection> = {};
    const savedSelectedOptions = (expandedItem.specsJson as any)?.selectedOptions;
    if (Array.isArray(savedSelectedOptions)) {
      savedSelectedOptions.forEach((opt: any) => {
        if (!opt?.optionId) return;
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
    }
    setOptionSelections(selections);

    setCalcError(null);

    const currentTotal = Number.parseFloat(expandedItem.totalPrice || "0") || 0;
    setComputedTotal(Number.isFinite(currentTotal) ? currentTotal : 0);

    savedSnapshotRef.current[itemId] = {
      width: Number.parseFloat(expandedItem.width || "1") || 1,
      height: Number.parseFloat(expandedItem.height || "1") || 1,
      quantity: expandedItem.quantity || 1,
      notes: nextNotes,
      optionSelections: selections,
      totalPrice: currentTotal,
    };
  }, [expandedItem?.id]);

  const widthNum = dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;

  const isDirty = useMemo(() => {
    if (!expandedItem) return false;
    const saved = savedSnapshotRef.current[expandedItem.id];
    if (!saved) return true;

    const currentNotes = notes || "";
    const savedNotes = saved.notes || "";
    const currentOptions = JSON.stringify(optionSelections || {});
    const savedOptions = JSON.stringify(saved.optionSelections || {});

    return (
      Math.abs(widthNum - saved.width) > 0.01 ||
      Math.abs(heightNum - saved.height) > 0.01 ||
      qtyNum !== saved.quantity ||
      currentNotes !== savedNotes ||
      currentOptions !== savedOptions
    );
  }, [expandedItem, widthNum, heightNum, qtyNum, notes, optionSelections]);

  // Debounced price calculation for expanded item
  useDebouncedEffect(
    () => {
      if (!expandedItem || !expandedProduct) return;
      if (dimsRequired && (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0)) return;
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;

      setIsCalculating(true);
      setCalcError(null);

      apiRequest("POST", "/api/quotes/calculate", {
        productId: expandedItem.productId,
        variantId: expandedItem.productVariantId || undefined,
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        selectedOptions: optionSelections,
        customerId,
      })
        .then((r) => r.json())
        .then((data) => {
          const price = Number(data?.price);
          if (!Number.isFinite(price)) return;
          setComputedTotal(price);
        })
        .catch((err: any) => {
          setCalcError(err?.message || "Calculation failed");
        })
        .finally(() => setIsCalculating(false));
    },
    [
      expandedItem?.productId,
      expandedItem?.productVariantId,
      widthText,
      heightText,
      qtyNum,
      optionSelections,
      expandedItem?.id,
      customerId,
    ],
    400
  );

  const handleSaveItem = async () => {
    if (!expandedItem) return;
    const itemId = expandedItem.id;

    setSavingItemId(itemId);
    setSavedItemId(null);

    try {
      const totalPrice = Number.isFinite(computedTotal) ? (computedTotal as number) : Number.parseFloat(expandedItem.totalPrice || "0") || 0;
      const unitPrice = qtyNum > 0 ? totalPrice / qtyNum : 0;

      const selectedOptionsArray = buildSelectedOptionsArray(expandedProductOptions, optionSelections, widthNum, heightNum, qtyNum);
      const nextSpecsJson = {
        ...(expandedItem.specsJson || {}),
        notes: notes || "",
        selectedOptions: selectedOptionsArray,
      };

      await updateLineItem.mutateAsync({
        id: itemId,
        data: {
          width: dimsRequired ? widthNum : null,
          height: dimsRequired ? heightNum : null,
          quantity: qtyNum,
          description: notes || "",
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
          specsJson: nextSpecsJson,
        },
      });

      setSavedItemId(itemId);

      savedSnapshotRef.current[itemId] = {
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        notes: notes || "",
        optionSelections,
        totalPrice,
      };

      setTimeout(() => setSavedItemId(null), 2000);

      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
    } finally {
      setSavingItemId(null);
    }
  };

  const handleDuplicateItem = async (item: OrderLineItem) => {
    try {
      const payload: any = {
        orderId,
        productId: item.productId,
        productVariantId: item.productVariantId,
        description: item.description,
        width: item.width ? Number.parseFloat(item.width) : null,
        height: item.height ? Number.parseFloat(item.height) : null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        status: item.status || "queued",
        specsJson: item.specsJson || null,
      };

      await createLineItem.mutateAsync(payload);
      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to duplicate item",
        variant: "destructive",
      });
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await deleteLineItem.mutateAsync(itemId);
      if (expandedId === itemId) setExpandedId(null);
      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to remove item",
        variant: "destructive",
      });
    }
  };

  const count = activeLineItems.length;

  return (
    <Card className="rounded-lg border border-border/40 bg-card/50">
      <CardHeader className="px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-border/60 text-xs">
            {count} {count === 1 ? "item" : "items"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-3 py-2 overflow-x-hidden">
        {lineItems.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">—</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
              const { active, over } = event;
              if (!over) return;

              const activeId = String(active.id);
              const overId = String(over.id);
              if (activeId === overId) return;

              setOrderedKeys((prev) => {
                const base = prev.length ? prev : sortableItems;
                const oldIndex = base.indexOf(activeId);
                const newIndex = base.indexOf(overId);
                if (oldIndex < 0 || newIndex < 0) return prev;
                return arrayMove(base, oldIndex, newIndex);
              });
            }}
          >
            <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
              <div className="space-y-1 overflow-x-hidden">
                {orderedLineItems.map((item) => {
                  const itemKey = item.id;
                  const isExpanded = itemKey === expandedId;
                  const contentId = `line-item-${itemKey}-details`;

                  const productName = (item as any).product?.name || item.description || "Item";

                  const itemSelectedOptions = (item.specsJson as any)?.selectedOptions;
                  const optionsSummaryText = buildOneLineOptionsSummary(itemSelectedOptions);
                  const hasNote = !!((item.specsJson as any)?.notes || item.description);

                  const total = Number.parseFloat(item.totalPrice || "0") || 0;
                  const perEa = item.quantity > 0 ? total / item.quantity : 0;

                  const attachmentsForThumb = (allOrderFiles as any[]).filter((f) => f?.orderLineItemId === item.id) as OrderFileWithUser[];

                  const reorderDisabled = readOnly;

                  return (
                    <SortableOrderLineItemWrapper key={itemKey} id={itemKey} disabled={reorderDisabled}>
                      {({ dragAttributes, dragListeners, isDragging, isOver }) => (
                        <div
                          className={cn(
                            "rounded-md border border-border/40 bg-background/30 overflow-x-hidden",
                            isExpanded && "bg-background/40 border-border/60",
                            isOver && !isDragging && "ring-1 ring-ring/40",
                            isDragging && "opacity-60"
                          )}
                        >
                          <div className="flex items-start min-w-0 overflow-x-hidden">
                            <div
                              className={cn(
                                "mt-2 flex h-8 w-7 shrink-0 items-center justify-center rounded-sm",
                                "touch-none",
                                "text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/20",
                                reorderDisabled
                                  ? "cursor-not-allowed opacity-50"
                                  : "cursor-grab active:cursor-grabbing"
                              )}
                              {...(dragAttributes || {})}
                              {...(dragListeners || {})}
                              aria-label="Reorder line item"
                            >
                              <GripVertical className="h-4 w-4" />
                            </div>

                            <div
                              role="button"
                              tabIndex={0}
                              className="min-w-0 flex-1 text-left px-2.5 py-2 hover:bg-muted/15 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-md"
                              onClick={() => {
                                setExpandedId(isExpanded ? null : itemKey);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setExpandedId(isExpanded ? null : itemKey);
                                }
                              }}
                              aria-expanded={isExpanded}
                              aria-controls={contentId}
                              aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
                            >
                              <div className="grid items-center gap-2 overflow-x-hidden">
                                  {/* Desktop/large: 3-zone row; small: left + right, options below */}
                                  <div className="grid items-center gap-2 min-w-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                    {/* Left zone */}
                                    <div className="flex items-center gap-2 min-w-0">
                                      <LineItemThumbnail
                                        parentId={orderId}
                                        lineItemId={item.id}
                                        parentType="order"
                                        attachments={attachmentsForThumb.length ? (attachmentsForThumb as any) : undefined}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[15px] font-semibold truncate">{productName}</span>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums min-w-0">
                                          <span className="font-mono truncate">
                                            {item.width && item.height ? `${item.width}" × ${item.height}"` : "—"}
                                          </span>
                                          <span className="shrink-0">·</span>
                                          <span className="shrink-0">Qty {item.quantity}</span>
                                          {!!hasNote && <span className="shrink-0">· Note</span>}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Middle zone (options summary) */}
                                    <div className="hidden md:block min-w-0">
                                      <div className="text-[15px] text-muted-foreground truncate" title={optionsSummaryText}>
                                        {optionsSummaryText}
                                      </div>
                                    </div>

                                    {/* Right zone */}
                                    <div className="flex items-center justify-end gap-2 shrink-0">
                                      <div
                                        className="w-[128px] shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                      >
                                        <Select
                                          value={item.status || "queued"}
                                          onValueChange={(next) => {
                                            if (readOnly) return;
                                            void updateLineItemStatus.mutateAsync({ lineItemId: item.id, status: next });
                                          }}
                                          disabled={readOnly}
                                        >
                                          <SelectTrigger className="h-8 w-full">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="queued">Queued</SelectItem>
                                            <SelectItem value="printing">Printing</SelectItem>
                                            <SelectItem value="finishing">Finishing</SelectItem>
                                            <SelectItem value="done">Done</SelectItem>
                                            <SelectItem value="canceled">Canceled</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>

                                      <div className="text-right tabular-nums shrink-0">
                                        <div className="font-mono text-[15px] font-semibold leading-5">{formatMoney(total)}</div>
                                        <div className="text-sm text-muted-foreground leading-4">{formatMoney(perEa)}/ea</div>
                                      </div>

                                      <ChevronRight
                                        className={cn(
                                          "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                                          isExpanded && "rotate-90"
                                        )}
                                      />
                                    </div>
                                  </div>

                                  {/* Small screens: show options summary on second line */}
                                  <div className="md:hidden min-w-0">
                                    <div className="text-sm text-muted-foreground truncate" title={optionsSummaryText}>
                                      {optionsSummaryText}
                                    </div>
                                  </div>
                                </div>
                            </div>
                          </div>

                          {isExpanded && expandedItem && expandedItem.id === item.id && (
                            <div id={contentId} className="px-2.5 pb-2.5">
                              <div className="rounded-md border border-border/40 bg-background/30 p-3">
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
                              <div className="font-mono text-lg font-bold">
                                {formatMoney(
                                  Number.isFinite(computedTotal)
                                    ? (computedTotal as number)
                                    : Number.parseFloat(item.totalPrice || "0") || 0
                                )}
                              </div>
                              <div className="h-5 flex items-center justify-end">
                                {isCalculating && <div className="text-[11px] text-muted-foreground">Calculating…</div>}
                                {!!calcError && <div className="text-[11px] text-destructive">{calcError}</div>}
                                {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
                              </div>
                            </div>
                          </div>

                          <Separator className="my-3" />

                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
                            <div className="min-w-0">
                              <ProductOptionsPanel
                                product={expandedProduct}
                                productOptions={expandedProductOptions}
                                optionSelections={optionSelections as any}
                                onOptionSelectionsChange={setOptionSelections as any}
                              />

                              {!readOnly && (
                                <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-sm">
                                  <div className="flex items-center gap-2">
                                    {isDirty && (
                                      <Button
                                        type="button"
                                        variant="default"
                                        size="sm"
                                        className="h-8"
                                        onClick={handleSaveItem}
                                        disabled={savingItemId === item.id || isCalculating}
                                      >
                                        {savingItemId === item.id ? (
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
                                    {!isDirty && savedItemId === item.id && (
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
                                      onClick={() => void handleDuplicateItem(item)}
                                    >
                                      Duplicate Item
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 text-destructive hover:text-destructive"
                                      onClick={() => void handleRemoveItem(item.id)}
                                    >
                                      Remove Item
                                    </Button>
                                  </div>
                                  {isDirty && <div className="text-xs text-amber-600">Unsaved</div>}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 lg:w-[360px] lg:shrink-0">
                              <div className={cn("rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">Artwork</div>
                                </div>
                                <LineItemAttachmentsPanel
                                  quoteId={null}
                                  parentType="order"
                                  orderId={orderId}
                                  lineItemId={item.id}
                                  productName={productName}
                                  defaultExpanded={readOnly ? true : false}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SortableOrderLineItemWrapper>
            );
              })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {!readOnly && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <Popover
              open={searchOpen}
              onOpenChange={(open) => {
                setSearchOpen(open);
                if (!open) setSearchQuery("");
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={searchOpen} className="w-full justify-between h-9 font-normal">
                  <span className="text-muted-foreground">{searchQuery ? `Searching: ${searchQuery}` : "Add Product"}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[520px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Search by name, SKU, or category…" value={searchQuery} onValueChange={setSearchQuery} />
                  <CommandList>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {filteredProducts.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={`${p.name} ${(p as any).sku || ""} ${(p as any).category || ""}`}
                          onSelect={async () => {
                            try {
                              const created = await createLineItem.mutateAsync({
                                orderId,
                                productId: p.id,
                                productVariantId: null,
                                description: "",
                                width: 1,
                                height: 1,
                                quantity: 1,
                                unitPrice: "0.00",
                                totalPrice: "0.00",
                                status: "queued",
                                specsJson: { notes: "", selectedOptions: [] },
                              });
                              const nextId = created?.data?.id ?? created?.id ?? null;
                              setSearchQuery("");
                              setSearchOpen(false);
                              if (typeof nextId === "string" && nextId.length) {
                                setExpandedId(nextId);
                              }
                              if (onAfterLineItemsChange) {
                                await onAfterLineItemsChange();
                              }
                            } catch (err: any) {
                              toast({
                                title: "Error",
                                description: err?.message || "Failed to add item",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{p.name}</div>
                            {(p as any).sku && <div className="text-xs text-muted-foreground truncate">SKU: {(p as any).sku}</div>}
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

      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewFile ? getAttachmentDisplayName(previewFile as any) : ""}</DialogTitle>
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
                <AttachmentPreviewMeta attachment={previewFile as any} />
              </div>
            </DialogDescription>
          </DialogHeader>

          {previewFile && (() => {
            const isPdf = isPdfAttachment(previewFile as any);
            const previewUrl = previewFile.previewUrl ?? previewFile.originalUrl;
            const hasValidPreview = !isPdf && previewUrl && isValidHttpUrl(previewUrl);
            const pdfThumbUrl = getPdfThumbUrl(previewFile);
            const hasPdfThumb = isPdf && typeof pdfThumbUrl === "string" && isValidHttpUrl(pdfThumbUrl);
            const originalUrl = previewFile.originalUrl ?? (previewFile as any).url ?? null;
            const canDownloadOriginal = typeof originalUrl === "string" && isValidHttpUrl(originalUrl);
            const fileName = previewFile.originalFilename || previewFile.fileName;

            return (
              <div className="space-y-4">
                {isPdf ? (
                  hasPdfThumb ? (
                    <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                      <img src={pdfThumbUrl!} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                      <FileText className="w-16 h-16 mb-4 opacity-50" />
                      <p className="text-sm mb-4">PDF preview not available</p>
                      {canDownloadOriginal && (
                        <div className="flex flex-col items-center gap-1">
                          <Button
                            onClick={() => {
                              const anchor = document.createElement("a");
                              anchor.href = originalUrl!;
                              anchor.download = fileName;
                              anchor.target = "_blank";
                              anchor.rel = "noreferrer";
                              anchor.style.display = "none";
                              document.body.appendChild(anchor);
                              anchor.click();
                              document.body.removeChild(anchor);
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
                  )
                ) : hasValidPreview ? (
                  <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                    <img src={previewUrl} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
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

                  {canDownloadOriginal && (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        onClick={() => {
                          const anchor = document.createElement("a");
                          anchor.href = originalUrl!;
                          anchor.download = fileName;
                          anchor.target = "_blank";
                          anchor.rel = "noreferrer";
                          anchor.style.display = "none";
                          document.body.appendChild(anchor);
                          anchor.click();
                          document.body.removeChild(anchor);
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
