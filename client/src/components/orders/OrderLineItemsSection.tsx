import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import type { Product, ProductOptionItem } from "@shared/schema";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { getAttachmentDisplayName, getPdfPageCount, isPdfAttachment } from "@/lib/attachments";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import {
  useAttachFileToOrder,
  useDetachOrderFile,
  useOrderFiles,
  useAttachFileToOrderLineItem,
  useDetachOrderLineItemFile,
  type OrderFileWithUser,
} from "@/hooks/useOrderFiles";
import {
  useCreateOrderLineItem,
  useDeleteOrderLineItem,
  useUpdateOrderLineItem,
  useUpdateOrderLineItemStatus,
  type OrderWithRelations,
} from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";

type OrderLineItem = OrderWithRelations["lineItems"][number];

type OptionSelection = {
  value: boolean | number | string;
  grommetsLocation?: string;
  grommetsSpacingCount?: number;
  grommetsPerSign?: number;
  grommetsSpacingInches?: number;
  customPlacementNote?: string;
  hemsType?: string;
  polePocket?: string;
};

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
};

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

function extractOptionChips(
  selectedOptions: any[] | undefined | null,
  maxChips: number = 3
): { chips: string[]; overflowCount: number } {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
    return { chips: [], overflowCount: 0 };
  }

  const chips: string[] = [];

  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== "object") continue;

    const name = opt.optionName || opt.label || opt.name || "";

    let value = opt.displayValue ?? opt.value;
    if (typeof value === "boolean") {
      value = value ? "Yes" : "No";
    }

    const nameStr = String(name).trim();
    const valueStr = value != null ? String(value).trim() : "";

    if (!nameStr) continue;
    if (
      !valueStr ||
      valueStr.toLowerCase() === "none" ||
      valueStr.toLowerCase() === "n/a" ||
      valueStr === "false" ||
      valueStr === "No"
    )
      continue;

    let chipText: string;

    if (valueStr && valueStr !== "true" && valueStr !== "Yes") {
      if (valueStr.length <= 12) {
        chipText = valueStr;
      } else if (nameStr.length <= 12) {
        chipText = nameStr;
      } else {
        chipText = nameStr.substring(0, 9) + "...";
      }
    } else {
      chipText = nameStr.length <= 12 ? nameStr : nameStr.substring(0, 9) + "...";
    }

    chips.push(chipText);
  }

  const totalCount = chips.length;
  const displayChips = chips.slice(0, maxChips);
  const overflowCount = Math.max(0, totalCount - maxChips);

  return { chips: displayChips, overflowCount };
}

function buildOneLineOptionsSummary(selectedOptions: any[] | undefined | null): string {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return "—";

  const parts: string[] = [];

  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== "object") continue;

    const name = String(opt.optionName || opt.label || opt.name || "").trim();
    let value = opt.displayValue ?? opt.value;

    if (typeof value === "boolean") value = value ? "Yes" : "No";

    const valueStr = value != null ? String(value).trim() : "";
    if (!name) continue;
    if (!valueStr || valueStr.toLowerCase() === "none" || valueStr.toLowerCase() === "n/a" || valueStr === "false" || valueStr === "No") {
      continue;
    }

    // Keep it compact; drop the name when the value is short.
    if (valueStr.length <= 14) {
      parts.push(valueStr);
    } else {
      parts.push(name.length <= 18 ? name : name.slice(0, 15) + "…");
    }
  }

  return parts.length ? parts.join(" · ") : "—";
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

function getPdfThumbUrl(file: {
  pages?: Array<{ thumbUrl?: string | null }>;
  thumbUrl?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  const url = file.pages?.[0]?.thumbUrl ?? file.thumbUrl ?? file.thumbnailUrl ?? null;
  return typeof url === "string" && isValidHttpUrl(url) ? url : null;
}

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
  disabled: boolean;
  children: (props: SortableChildRenderProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragAttributes: disabled ? undefined : attributes,
        dragListeners: disabled ? undefined : listeners,
        isDragging,
        isOver,
      })}
    </div>
  );
}

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

function OrderLineItemArtworkStrip({
  files,
  onPreview,
}: {
  files: AttachmentForPreview[];
  onPreview: (attachment: AttachmentForPreview) => void;
}) {
  if (files.length === 0) return null;

  const getFileIcon = (mimeType: string | null | undefined) => {
    if (!mimeType) return FileText;
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType === "application/pdf") return FileText;
    return FileText;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {files.map((attachment) => {
        const thumbSrc = getThumbSrc(attachment);
        const FileIcon = getFileIcon(attachment.mimeType);
        const hasPreviewUrl = attachment.previewUrl && isValidHttpUrl(attachment.previewUrl);
        const hasOriginalUrl = attachment.originalUrl && isValidHttpUrl(attachment.originalUrl);
        const canPreview = hasPreviewUrl || hasOriginalUrl;
        const fileName = getAttachmentDisplayName(attachment as any);
        const isPdf = isPdfAttachment(attachment as any);
        const pageCount = getPdfPageCount(attachment as any);
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
                onPreview(attachment);
              }}
              onPointerDownCapture={(e) => {
                if (!canPreview) return;
                e.stopPropagation();
              }}
              disabled={!canPreview}
              title={fileName}
              aria-label={canPreview ? `Preview ${fileName}` : `${fileName} (no preview available)`}
            >
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt={fileName}
                  title={fileName}
                  className="w-full h-full object-cover pointer-events-none"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
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

function OrderLineItemArtworkPanel({
  orderId,
  lineItemId,
  productName,
  readOnly,
  onPreview,
}: {
  orderId: string;
  lineItemId: string;
  productName?: string;
  readOnly: boolean;
  onPreview: (attachment: AttachmentForPreview) => void;
}) {
  const { toast } = useToast();
  const { data: allFiles = [] } = useOrderFiles(orderId);
  const attachFile = useAttachFileToOrderLineItem(orderId, lineItemId);
  const detachFile = useDetachOrderLineItemFile(orderId, lineItemId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const filesForLineItem = useMemo(() => {
    return (allFiles as any[])
      .filter((f) => f?.orderLineItemId === lineItemId)
      .map((f) => f as AttachmentForPreview);
  }, [allFiles, lineItemId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const filesToUpload = Array.from(e.target.files);

    const oversizedFiles = filesToUpload.filter((f) => f.size > MAX_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File Too Large",
        description: "Files larger than 50MB cannot be uploaded.",
        variant: "destructive",
      });
      const validFiles = filesToUpload.filter((f) => f.size <= MAX_SIZE_BYTES);
      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    setIsUploading(true);

    try {
      for (const file of filesToUpload) {
        if (file.size > MAX_SIZE_BYTES) continue;

        const urlResponse = await fetch("/api/objects/upload", {
          method: "POST",
          credentials: "include",
        });

        if (!urlResponse.ok) {
          const errorData = await urlResponse.json().catch(() => ({}));
          throw new Error(errorData.message || "Failed to get upload URL");
        }

        const { url, method, path } = await urlResponse.json();

        const uploadResponse = await fetch(url, {
          method: method || "PUT",
          body: file,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        // Persist storage key (bucket-relative path) — never persist signed URLs.
        // Supabase returns { url, path, token }. Replit fallback returns only { url }.
        const fileUrl = typeof path === "string" && path ? path : url.split("?")[0];

        await attachFile.mutateAsync({
          fileName: file.name,
          fileUrl,
          fileSize: file.size,
          mimeType: file.type,
          role: "other",
          side: "na",
          orderLineItemId: lineItemId,
        } as any);
      }

      toast({
        title: "Uploaded",
        description: "File uploaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error?.message || "Failed to upload file.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className={cn("rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Artwork</div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading || attachFile.isPending}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || attachFile.isPending}
            >
              {isUploading || attachFile.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Upload
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {filesForLineItem.length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        <div className="space-y-2">
          <OrderLineItemArtworkStrip files={filesForLineItem} onPreview={onPreview} />
          <div className="space-y-1">
            {filesForLineItem.map((f) => {
              const name = getAttachmentDisplayName(f as any);
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    className="text-left truncate text-foreground hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(f);
                    }}
                    title={name}
                  >
                    {name}
                  </button>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void detachFile.mutateAsync(f.id);
                      }}
                      disabled={detachFile.isPending}
                      aria-label={`Remove ${name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!!productName && (
        <div className="mt-2 text-[11px] text-muted-foreground">{productName}</div>
      )}
    </div>
  );
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

                  const productName = item.product?.name || item.description || "Item";

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
                              <OrderLineItemArtworkPanel
                                orderId={orderId}
                                lineItemId={item.id}
                                productName={productName}
                                readOnly={readOnly}
                                onPreview={setPreviewFile}
                              />
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
