import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
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
  Send,
} from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OrderLineItem, Product, ProductOptionItem } from "@shared/schema";
import type { OptionSelection } from "@/features/quotes/editor/types";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import { ProductOptionsPanelV2 } from "@/features/quotes/editor/components/ProductOptionsPanelV2";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { isPbv2Product, getPbv2Tree } from "@/lib/pbv2Utils";
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
import { useOrderLineItemPreviews } from "@/hooks/useOrderLineItemPreviews";
import { useScheduleOrderLineItemsForProduction } from "@/hooks/useProduction";

import LineItemRowEnterprise, { type LineItemEnterpriseRowModel } from "@/components/line-items/LineItemRowEnterprise";
import { buildLineItemFlags } from "@/lib/lineItems/lineItemDerivation";
import { formatLineItemOptionSummary } from "@shared/lineItemOptionSummary";
import type { PBV2Outputs } from "@/lib/pbv2/pbv2Outputs";
import { computePbv2InputSignature, pickPbv2EnvExtras } from "@shared/pbv2/pbv2InputSignature";

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

function getPbv2SnapshotFromLineItem(lineItem: any): any | null {
  if (!lineItem || typeof lineItem !== "object") return null;
  return (lineItem as any).pbv2SnapshotJson ?? (lineItem as any).pbv2_snapshot_json ?? null;
}

function getAcceptedComponentsFromLineItem(item: any): any[] {
  if (!item || typeof item !== "object") return [];
  const comps = (item as any).components;
  return Array.isArray(comps) ? comps : [];
}

function mapPbv2SnapshotToOutputs(snapshot: any): PBV2Outputs | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;

  const pricing = (snapshot as any).pricing;
  const materials = (snapshot as any).materials;
  const childItems = (snapshot as any).childItems;

  const hasAny = Boolean(pricing || materials || childItems);
  if (!hasAny) return undefined;

  return {
    pricingAddons:
      pricing && typeof pricing === "object"
        ? {
            addOnCents: Number((pricing as any).addOnCents) || 0,
            breakdown: Array.isArray((pricing as any).breakdown) ? (pricing as any).breakdown : [],
          }
        : null,
    materialEffects: {
      materials: Array.isArray(materials) ? materials : [],
    },
    childItemProposals: {
      childItems: Array.isArray(childItems) ? childItems : [],
    },
  };
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

function buildOptionFlags(selectedOptions: any[] | undefined | null): string[] {
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return [];

  const flags: string[] = [];
  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== "object") continue;
    const name = String(opt.optionName || opt.label || opt.name || "").trim();
    let value: any = opt.displayValue ?? opt.value;
    if (typeof value === "boolean") {
      if (!value) continue;
      value = "Yes";
    }
    const valueStr = value != null ? String(value).trim() : "";
    if (!name && !valueStr) continue;
    if (valueStr === "" || valueStr.toLowerCase() === "none" || valueStr.toLowerCase() === "n/a") continue;

    const compact = valueStr && /^[A-Za-z0-9./+\-]{1,12}$/.test(valueStr) ? valueStr : "";
    const label = compact || (name ? (valueStr ? `${name}: ${valueStr}` : name) : valueStr);
    const cleaned = label.trim();
    if (!cleaned) continue;
    flags.push(cleaned.length > 22 ? `${cleaned.slice(0, 21)}…` : cleaned);
    if (flags.length >= 4) break;
  }
  return flags;
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
  const queryClient = useQueryClient();

  const [pbv2CurrentSignatureByLineItemId, setPbv2CurrentSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2SnapshotSignatureByLineItemId, setPbv2SnapshotSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2KeepAckByLineItemId, setPbv2KeepAckByLineItemId] = useState<Record<string, string>>({});

  // Production scheduling state
  const [selectedForProduction, setSelectedForProduction] = useState<Set<string>>(new Set());
  const scheduleProduction = useScheduleOrderLineItemsForProduction(orderId);;

  const acceptPbv2Components = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await apiRequest("POST", `/api/order-line-items/${lineItemId}/pbv2/components/accept`, {});
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
    },
  });

  const voidComponent = useMutation({
    mutationFn: async (componentId: string) => {
      const res = await apiRequest("PATCH", `/api/order-line-item-components/${componentId}/void`, {});
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
    },
  });

  const recomputePbv2 = useMutation({
    mutationFn: async ({ lineItemId, body }: { lineItemId: string; body: any }) => {
      const res = await apiRequest("POST", `/api/order-line-items/${lineItemId}/pbv2/recompute`, body);
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      setPbv2KeepAckByLineItemId((prev) => {
        const next = { ...prev };
        delete next[variables.lineItemId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      await onAfterLineItemsChange?.();
    },
  });

  const keepExistingPbv2 = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await apiRequest("POST", `/api/order-line-items/${lineItemId}/pbv2/keep-existing`, {});
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      await onAfterLineItemsChange?.();
    },
  });

  const applyPbv2Updates = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await apiRequest("POST", `/api/order-line-items/${lineItemId}/pbv2/apply`, {});
      return res.json();
    },
    onSuccess: async (data: any) => {
      toast({
        title: "PBV2 updates applied",
        description: typeof data?.message === "string" ? data.message : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      await onAfterLineItemsChange?.();
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to apply PBV2 updates",
        description: "Please try again.",
      });
    },
  });

  const updateLineItem = useUpdateOrderLineItem(orderId);
  const updateLineItemSilent = useUpdateOrderLineItem(orderId, { toast: false });
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

  const orderFilesQuery = useOrderFiles(orderId);
  const allOrderFiles = orderFilesQuery.data ?? [];
  const orderFilesAssociationKnown = orderFilesQuery.isSuccess;

  const lineItemPreviewsQuery = useOrderLineItemPreviews(orderId);
  const lineItemPreviews = lineItemPreviewsQuery.data ?? {};
  const lineItemAssetsAssociationKnown = lineItemPreviewsQuery.isSuccess;

  // UI-only reordering: keep a stable ordered id list for the current session.
  const activeLineItems = useMemo(
    () => lineItems.filter((li) => li.status !== "canceled"),
    [lineItems]
  );

  const buildComputedPbv2Env = (li: any): Record<string, unknown> => {
    const widthIn = typeof li?.width === "number" && Number.isFinite(li.width) ? li.width : li?.width ? Number(li.width) : undefined;
    const heightIn = typeof li?.height === "number" && Number.isFinite(li.height) ? li.height : li?.height ? Number(li.height) : undefined;
    const quantity = typeof li?.quantity === "number" && Number.isFinite(li.quantity) ? li.quantity : li?.quantity ? Number(li.quantity) : undefined;

    return {
      widthIn: Number.isFinite(widthIn) ? widthIn : undefined,
      heightIn: Number.isFinite(heightIn) ? heightIn : undefined,
      quantity: Number.isFinite(quantity) ? quantity : undefined,
      sqft:
        Number.isFinite(widthIn) && Number.isFinite(heightIn)
          ? (Number(widthIn) * Number(heightIn)) / 144
          : undefined,
      perimeterIn:
        Number.isFinite(widthIn) && Number.isFinite(heightIn)
          ? 2 * (Number(widthIn) + Number(heightIn))
          : undefined,
    };
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const nextCurrent: Record<string, string> = {};
      const nextSnapshot: Record<string, string> = {};

      for (const li of activeLineItems as any[]) {
        const snapshot = getPbv2SnapshotFromLineItem(li as any);
        if (!snapshot || typeof snapshot !== "object") continue;

        const treeVersionIdSnapshot = String((snapshot as any).treeVersionId || "");
        if (!treeVersionIdSnapshot) continue;

        const explicitSelections =
          (snapshot as any).explicitSelections && typeof (snapshot as any).explicitSelections === "object"
            ? (snapshot as any).explicitSelections
            : {};

        const envSnapshot =
          (snapshot as any).env && typeof (snapshot as any).env === "object" ? (snapshot as any).env : {};

        const snapshotSig =
          typeof (snapshot as any).pbv2InputSignature === "string" && (snapshot as any).pbv2InputSignature.length
            ? String((snapshot as any).pbv2InputSignature)
            : await computePbv2InputSignature({
                treeVersionId: treeVersionIdSnapshot,
                explicitSelections,
                env: envSnapshot,
              });

        const activeTreeVersionId = String((li as any).pbv2ActiveTreeVersionId || "");
        const treeVersionIdCurrent = activeTreeVersionId || treeVersionIdSnapshot;

        const computedEnv = buildComputedPbv2Env(li);
        const envExtras = pickPbv2EnvExtras(envSnapshot);
        const envCurrent = { ...computedEnv, ...envExtras };

        const currentSig = await computePbv2InputSignature({
          treeVersionId: treeVersionIdCurrent,
          explicitSelections,
          env: envCurrent,
        });

        nextSnapshot[String(li.id)] = snapshotSig;
        nextCurrent[String(li.id)] = currentSig;
      }

      if (cancelled) return;
      setPbv2SnapshotSignatureByLineItemId(nextSnapshot);
      setPbv2CurrentSignatureByLineItemId(nextCurrent);
    };

    run().catch((e) => {
      console.error("[OrderLineItemsSection] PBV2 signature compute failed", e);
    });

    return () => {
      cancelled = true;
    };
  }, [activeLineItems]);

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
  const [overrideById, setOverrideById] = useState<Record<string, boolean>>({});

  const [pendingJumpToLineItemId, setPendingJumpToLineItemId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const e = event as CustomEvent<{ lineItemId?: string }>;
      const rawId = e?.detail?.lineItemId;
      const lineItemId = typeof rawId === "string" ? rawId : rawId != null ? String(rawId) : "";
      if (!lineItemId) return;

      setExpandedId(lineItemId);
      setPendingJumpToLineItemId(lineItemId);
    };

    window.addEventListener("titanos:jump-to-line-item", handler);
    return () => window.removeEventListener("titanos:jump-to-line-item", handler);
  }, []);

  useEffect(() => {
    if (!pendingJumpToLineItemId) return;
    if (expandedId !== pendingJumpToLineItemId) return;

    const contentId = `line-item-${pendingJumpToLineItemId}-details`;
    const el = document.getElementById(contentId);
    if (el) {
      try {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      } catch {
        // ignore
      }
    }

    setPendingJumpToLineItemId(null);
  }, [expandedId, pendingJumpToLineItemId]);

  const notesEditorRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [pendingNotesFocusId, setPendingNotesFocusId] = useState<string | null>(null);
  const [notesDraftById, setNotesDraftById] = useState<Record<string, string>>({});
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingNotesFocusId) return;
    if (expandedId !== pendingNotesFocusId) return;

    const el = notesEditorRefs.current[pendingNotesFocusId];
    if (el) {
      try {
        el.scrollIntoView({ block: "center" });
      } catch {
        // ignore
      }
      requestAnimationFrame(() => {
        try {
          el.focus();
        } catch {
          // ignore
        }
      });
    }

    setPendingNotesFocusId(null);
  }, [expandedId, pendingNotesFocusId]);

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

  const expandedOptionTreeJson = useMemo(() => {
    return (((expandedProduct as any)?.optionTreeJson ?? null) as OptionTreeV2 | null) ?? null;
  }, [expandedProduct]);

  const isExpandedTreeV2 = useMemo(() => {
    return Boolean(expandedOptionTreeJson && (expandedOptionTreeJson as any)?.schemaVersion === 2);
  }, [expandedOptionTreeJson]);

  const dimsRequired = requiresDimensions(expandedProduct);

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [computedTotal, setComputedTotal] = useState<number | null>(null);

  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [pdfEmbedError, setPdfEmbedError] = useState(false);

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

  const [artworkModalLineItemId, setArtworkModalLineItemId] = useState<string | null>(null);

  const [missingArtworkSuppressReason, setMissingArtworkSuppressReason] = useState<string>("");
  const [savingFlagLineItemId, setSavingFlagLineItemId] = useState<string | null>(null);

  useEffect(() => {
    setMissingArtworkSuppressReason("");
  }, [expandedId]);

  // Reset PDF embed error when preview file changes
  useEffect(() => {
    setPdfEmbedError(false);
  }, [previewFile?.id]);

  const artworkModalLineItem = useMemo(
    () => lineItems.find((li) => li.id === artworkModalLineItemId) ?? null,
    [lineItems, artworkModalLineItemId]
  );

  const artworkModalProductName = useMemo(() => {
    if (!artworkModalLineItem) return "";
    return (artworkModalLineItem as any).product?.name || artworkModalLineItem.description || "Item";
  }, [artworkModalLineItem]);

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

    const rawV2 = (expandedItem as any)?.optionSelectionsJson;
    if (rawV2 && typeof rawV2 === "object" && (rawV2 as any)?.schemaVersion === 2) {
      setOptionSelectionsV2(rawV2 as LineItemOptionSelectionsV2);
    } else {
      setOptionSelectionsV2({ schemaVersion: 2, selected: {} });
    }

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

      if (isExpandedTreeV2 && !optionsV2Valid) {
        setCalcError(null);
        return;
      }

      setIsCalculating(true);
      setCalcError(null);

      apiRequest("POST", "/api/quotes/calculate", {
        productId: expandedItem.productId,
        variantId: expandedItem.productVariantId || undefined,
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        ...(isExpandedTreeV2
          ? { optionSelectionsJson: optionSelectionsV2 }
          : { selectedOptions: optionSelections }),
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
      optionSelectionsV2,
      isExpandedTreeV2,
      optionsV2Valid,
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

      const v2Patch = isExpandedTreeV2
        ? { optionSelectionsJson: optionSelectionsV2 }
        : {};

      await updateLineItem.mutateAsync({
        id: itemId,
        data: {
          width: dimsRequired ? widthNum : null,
          height: dimsRequired ? heightNum : null,
          quantity: qtyNum,
          description: notes || "",
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
          selectedOptions: selectedOptionsArray,
          specsJson: nextSpecsJson,
          ...(v2Patch as any),
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

  const handleToggleProductionSelection = (lineItemId: string) => {
    setSelectedForProduction((prev) => {
      const next = new Set(prev);
      if (next.has(lineItemId)) {
        next.delete(lineItemId);
      } else {
        next.add(lineItemId);
      }
      return next;
    });
  };

  const handleSendSelectedToProduction = async () => {
    if (selectedForProduction.size === 0) return;
    
    const lineItemIds = Array.from(selectedForProduction);
    await scheduleProduction.mutateAsync(lineItemIds);
    setSelectedForProduction(new Set());
  };

  const productionRequiredItemCount = useMemo(() => {
    return activeLineItems.filter((item) => {
      const product = products.find((p) => p.id === item.productId);
      return (product as any)?.requiresProductionJob === true;
    }).length;
  }, [activeLineItems, products]);

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="px-0 pt-0 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border/60 text-xs">
              {count} {count === 1 ? "item" : "items"}
            </Badge>
            {productionRequiredItemCount > 0 && !readOnly && (
              <Badge variant="secondary" className="text-xs">
                {productionRequiredItemCount} require production
              </Badge>
            )}
          </div>
          
          {!readOnly && productionRequiredItemCount > 0 && (
            <div className="flex items-center gap-2">
              {selectedForProduction.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {selectedForProduction.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedForProduction(new Set())}
                    disabled={scheduleProduction.isPending}
                  >
                    Clear
                  </Button>
                </>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={handleSendSelectedToProduction}
                disabled={selectedForProduction.size === 0 || scheduleProduction.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                {scheduleProduction.isPending
                  ? "Sending..."
                  : `Send ${selectedForProduction.size > 0 ? selectedForProduction.size : "Selected"} to Production`}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-0 py-0 overflow-x-hidden">
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

                  const optionsSummaryText = formatLineItemOptionSummary(item);

                  const persistedDescription = typeof item.description === "string" ? item.description.trim() : "";
                  const subtitleText = persistedDescription;

                  const total = Number.parseFloat(item.totalPrice || "0") || 0;
                  const parsedUnit = Number.parseFloat(item.unitPrice || "");
                  const perEa = Number.isFinite(parsedUnit)
                    ? parsedUnit
                    : item.quantity > 0
                      ? total / item.quantity
                      : 0;

                  const itemSpecsJson: any =
                    item.specsJson && typeof item.specsJson === "object" ? (item.specsJson as any) : {};
                  const itemNotes = (itemSpecsJson as any)?.lineItemNotes as
                    | { sku?: string | null; descShort?: string | null; descLong?: string | null }
                    | undefined;

                  const persistedNotesText = typeof itemNotes?.descLong === "string" ? itemNotes.descLong : "";

                  const persistedOverride = Boolean(
                    (itemSpecsJson as any)?.priceOverride &&
                      (((itemSpecsJson as any).priceOverride as any)?.mode
                        ? ((itemSpecsJson as any).priceOverride as any)?.mode === "total"
                        : true)
                  );
                  const isOverride = overrideById[String(item.id)] ?? persistedOverride;

                  const statusValue = item.status || "queued";
                  const statusLabel = statusValue.charAt(0).toUpperCase() + statusValue.slice(1);
                  const statusTone: LineItemEnterpriseRowModel["statusTone"] =
                    statusValue === "done"
                      ? "green"
                      : statusValue === "finishing"
                        ? "purple"
                        : statusValue === "printing"
                          ? "blue"
                          : "neutral";

                  const attachmentsForThumb = (allOrderFiles as any[]).filter((f) => f?.orderLineItemId === item.id) as OrderFileWithUser[];
                  const lineItemAttachmentsAssociationKnown =
                    orderFilesAssociationKnown &&
                    ((allOrderFiles as any[]).length === 0 ||
                      (allOrderFiles as any[]).some((f) => Object.prototype.hasOwnProperty.call(f ?? {}, "orderLineItemId")));

                  const previewForLineItem = (lineItemPreviews as any)?.[String(item.id)] as
                    | { thumbUrls?: string[]; thumbCount?: number }
                    | undefined;
                  const lineItemAssetsKnownForItem =
                    lineItemAssetsAssociationKnown &&
                    Object.prototype.hasOwnProperty.call(lineItemPreviews as any, String(item.id));

                  const assetCountForItem = Number(previewForLineItem?.thumbCount) || 0;

                  const productForPolicy =
                    products.find((p) => p.id === item.productId) ?? ((item as any).product as Product | undefined) ?? null;
                  const productArtworkPolicy = (productForPolicy as any)?.artworkPolicy ?? null;

                  const derivedFlags = buildLineItemFlags(item, {
                    notesText: persistedNotesText,
                    productArtworkPolicy,
                    artwork: {
                      lineItemAttachments: {
                        associationKnown: lineItemAttachmentsAssociationKnown,
                        count: attachmentsForThumb.length,
                        items: attachmentsForThumb as any,
                      },
                      lineItemAssets: {
                        associationKnown: lineItemAssetsKnownForItem,
                        count: assetCountForItem,
                      },
                    },
                  });

                  const previewThumbUrls = Array.isArray(previewForLineItem?.thumbUrls) ? previewForLineItem!.thumbUrls! : [];
                  const heroThumbUrls = Array.from(
                    new Set(
                      previewThumbUrls
                        .map((u) => getThumbSrc({ previewThumbnailUrl: u }))
                        .filter((u): u is string => typeof u === "string" && u.length > 0)
                    )
                  ).slice(0, 1);

                  const heroTotalCount = Number(previewForLineItem?.thumbCount) || previewThumbUrls.length;
                  const heroOverflowCount = Math.max(0, heroTotalCount - 1);

                  const reorderDisabled = readOnly;

                  const enterpriseItem: LineItemEnterpriseRowModel = {
                    id: String(item.id),
                    title: productName,
                    subtitle: subtitleText,
                    optionsSummaryText,
                    flags: derivedFlags,
                    notes: persistedNotesText,
                    alertText: null,
                    statusLabel,
                    statusTone,
                    qty: typeof item.quantity === "number" ? item.quantity : null,
                    unitPrice: perEa,
                    isOverride,
                    total,
                  };

                  const thumbnailNode = heroThumbUrls.length ? (
                    <button
                      type="button"
                      className="w-11 h-11 relative rounded overflow-hidden"
                      data-li-interactive="true"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setArtworkModalLineItemId(String(item.id));
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      aria-label="Open artwork"
                    >
                      <img
                        src={heroThumbUrls[0]}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      />

                      {heroOverflowCount > 0 && (
                        <div
                          className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-background/90 border border-border text-[11px] text-foreground flex items-center justify-center"
                          aria-hidden
                        >
                          +{heroOverflowCount}
                        </div>
                      )}
                    </button>
                  ) : (
                    <LineItemThumbnail
                      parentId={orderId}
                      lineItemId={item.id}
                      parentType="order"
                      attachments={attachmentsForThumb.length ? (attachmentsForThumb as any) : undefined}
                    />
                  );

                  const productForItem = products.find((p) => p.id === item.productId);
                  const itemRequiresProduction = (productForItem as any)?.requiresProductionJob === true;
                  const isSelectedForProduction = selectedForProduction.has(item.id);

                  return (
                    <SortableOrderLineItemWrapper key={itemKey} id={itemKey} disabled={reorderDisabled}>
                      {({ dragAttributes, dragListeners, isDragging, isOver }) => (
                        <div
                          className={cn(
                            "rounded-md overflow-x-hidden",
                            isOver && !isDragging && "ring-1 ring-ring/40",
                            isDragging && "opacity-60"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {!readOnly && itemRequiresProduction && (
                              <div className="pt-3 pl-2" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isSelectedForProduction}
                                  onCheckedChange={() => handleToggleProductionSelection(item.id)}
                                  aria-label="Select for production"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                          <div
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "min-w-0 text-left p-0 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-md",
                              isExpanded && "ring-1 ring-ring/20"
                            )}
                            onClick={() => {
                              setExpandedId(isExpanded ? null : itemKey);
                            }}
                            onKeyDown={(e) => {
                              const target = e.target as HTMLElement | null;
                              if (target?.closest?.('[data-li-interactive="true"]')) return;
                              const tag = (target?.tagName || "").toUpperCase();
                              if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;

                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedId(isExpanded ? null : itemKey);
                              }
                            }}
                            aria-expanded={isExpanded}
                            aria-controls={contentId}
                            aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
                          >
                            <LineItemRowEnterprise
                              item={enterpriseItem}
                              pbv2Outputs={mapPbv2SnapshotToOutputs(getPbv2SnapshotFromLineItem(item as any))}
                              pbv2AcceptedComponents={getAcceptedComponentsFromLineItem(item as any)}
                              pbv2IsStale={(() => {
                                const snapshot = getPbv2SnapshotFromLineItem(item as any);
                                if (!snapshot) return false;
                                const snapshotSig = pbv2SnapshotSignatureByLineItemId[String(item.id)];
                                const currentSig = pbv2CurrentSignatureByLineItemId[String(item.id)];
                                if (!snapshotSig || !currentSig) return false;
                                const isStale = snapshotSig !== currentSig;
                                if (!isStale) return false;
                                return pbv2KeepAckByLineItemId[String(item.id)] !== currentSig;
                              })()}
                              onRecomputePbv2={
                                readOnly
                                  ? undefined
                                  : async (lineItemId) => {
                                      const liAny = item as any;
                                      const snapshot = getPbv2SnapshotFromLineItem(liAny);
                                      if (!snapshot || typeof snapshot !== "object") {
                                        toast({
                                          variant: "destructive",
                                          title: "Cannot recompute PBV2",
                                          description: "Missing PBV2 snapshot inputs.",
                                        });
                                        return;
                                      }

                                      const explicitSelections =
                                        (snapshot as any).explicitSelections && typeof (snapshot as any).explicitSelections === "object"
                                          ? (snapshot as any).explicitSelections
                                          : {};
                                      const envSnapshot =
                                        (snapshot as any).env && typeof (snapshot as any).env === "object" ? (snapshot as any).env : {};
                                      const computedEnv = buildComputedPbv2Env(liAny);
                                      const envExtras = pickPbv2EnvExtras(envSnapshot);
                                      const pbv2Env = { ...computedEnv, ...envExtras };

                                      try {
                                        await recomputePbv2.mutateAsync({
                                          lineItemId,
                                          body: {
                                            pbv2ExplicitSelections: explicitSelections,
                                            pbv2Env,
                                          },
                                        });
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "PBV2 recompute failed",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onKeepExistingPbv2={
                                readOnly
                                  ? undefined
                                  : async (lineItemId) => {
                                      const currentSig = pbv2CurrentSignatureByLineItemId[String(item.id)];
                                      if (!currentSig) return;

                                      try {
                                        await keepExistingPbv2.mutateAsync(lineItemId);
                                        setPbv2KeepAckByLineItemId((prev) => ({ ...prev, [String(lineItemId)]: currentSig }));
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not keep existing PBV2",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onApplyPbv2Updates={
                                readOnly
                                  ? undefined
                                  : async (lineItemId) => {
                                      await applyPbv2Updates.mutateAsync(lineItemId);
                                    }
                              }
                              onAcceptPbv2Components={
                                readOnly
                                  ? undefined
                                  : async (lineItemId) => {
                                      try {
                                        await acceptPbv2Components.mutateAsync(lineItemId);
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not accept PBV2 components",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onVoidPbv2Component={
                                readOnly
                                  ? undefined
                                  : async (componentId) => {
                                      try {
                                        await voidComponent.mutateAsync(componentId);
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not void component",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              variant="tray"
                              thumbnail={thumbnailNode}
                              dragHandleProps={{
                                attributes: dragAttributes,
                                listeners: dragListeners,
                                disabled: reorderDisabled,
                              }}
                              onDescriptionCommit={
                                readOnly
                                  ? undefined
                                  : async (_id, nextDescription) => {
                                      try {
                                        await updateLineItemSilent.mutateAsync({
                                          id: String(item.id),
                                          data: {
                                            description: nextDescription,
                                          },
                                        });

                                        await queryClient.invalidateQueries({
                                          queryKey: ["/api/orders", orderId],
                                        });
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not update description",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onNotesClick={(lineItemId) => {
                                setExpandedId(lineItemId);
                                setPendingNotesFocusId(lineItemId);
                              }}
                              onQtyChange={
                                readOnly
                                  ? undefined
                                  : async (_id, nextQty) => {
                                      const lineItemId = String(item.id);
                                      const nextQtyInt = Number.isFinite(nextQty)
                                        ? Math.max(1, Math.trunc(nextQty))
                                        : 1;

                                      if ((item.quantity || 0) === nextQtyInt) return;

                                      // If override is active, keep the overridden total and recompute unit price.
                                      if (isOverride) {
                                        const nextSpecsJson = {
                                          ...(itemSpecsJson || {}),
                                          priceOverride: {
                                            mode: "total",
                                            value: total,
                                          },
                                        } as any;

                                        const nextUnit = nextQtyInt > 0 ? total / nextQtyInt : 0;

                                        try {
                                          await updateLineItemSilent.mutateAsync({
                                            id: lineItemId,
                                            data: {
                                              quantity: nextQtyInt,
                                              unitPrice: nextUnit.toFixed(2),
                                              totalPrice: total.toFixed(2),
                                              specsJson: nextSpecsJson,
                                            },
                                          });
                                        } catch (e) {
                                          toast({
                                            variant: "destructive",
                                            title: "Could not update quantity",
                                            description: "Please try again.",
                                          });
                                          throw e;
                                        }

                                        return;
                                      }

                                      // Otherwise recompute pricing server-side and persist qty/unit/total.
                                      const productForCalc = products.find((p) => p.id === item.productId) ?? null;
                                      const dimsRequiredForCalc = requiresDimensions(productForCalc);

                                      const widthForCalc = dimsRequiredForCalc ? Number.parseFloat(item.width || "") || 0 : 1;
                                      const heightForCalc = dimsRequiredForCalc ? Number.parseFloat(item.height || "") || 0 : 1;

                                      // Detect if this is a PBV2 product to send correct payload format
                                      const isPbv2 = isPbv2Product(productForCalc);
                                      const rawPbv2Selections = (item as any)?.optionSelectionsJson;
                                      const pbv2Selections = isPbv2 && rawPbv2Selections && typeof rawPbv2Selections === "object"
                                        ? rawPbv2Selections
                                        : { schemaVersion: 2, selected: {} };

                                      const selections: Record<string, OptionSelection> = {};
                                      const savedSelectedOptions = (itemSpecsJson as any)?.selectedOptions;
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

                                      try {
                                        // If we can't compute (missing dims), still persist qty and leave pricing unchanged.
                                        if (
                                          dimsRequiredForCalc &&
                                          (!Number.isFinite(widthForCalc) ||
                                            widthForCalc <= 0 ||
                                            !Number.isFinite(heightForCalc) ||
                                            heightForCalc <= 0)
                                        ) {
                                          await updateLineItemSilent.mutateAsync({
                                            id: lineItemId,
                                            data: {
                                              quantity: nextQtyInt,
                                            },
                                          });
                                          return;
                                        }

                                        const calcResponse = await apiRequest("POST", "/api/quotes/calculate", {
                                          productId: item.productId,
                                          variantId: item.productVariantId || undefined,
                                          width: widthForCalc,
                                          height: heightForCalc,
                                          quantity: nextQtyInt,
                                          ...(isPbv2 ? { optionSelectionsJson: pbv2Selections } : { selectedOptions: selections }),
                                          customerId,
                                        });

                                        const calcData = await calcResponse.json();
                                        const nextTotal = Number(calcData?.price);
                                        if (!Number.isFinite(nextTotal)) {
                                          throw new Error("Invalid price returned");
                                        }

                                        const nextUnit = nextQtyInt > 0 ? nextTotal / nextQtyInt : 0;

                                        await updateLineItemSilent.mutateAsync({
                                          id: lineItemId,
                                          data: {
                                            quantity: nextQtyInt,
                                            unitPrice: nextUnit.toFixed(2),
                                            totalPrice: nextTotal.toFixed(2),
                                          },
                                        });
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not update quantity",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onOverrideChange={
                                readOnly
                                  ? undefined
                                  : (_id, nextChecked) => {
                                      const lineItemId = String(item.id);

                                      setOverrideById((prev) => ({ ...prev, [lineItemId]: nextChecked }));

                                      const nextSpecsJson = { ...(itemSpecsJson || {}) } as any;
                                      if (nextChecked) {
                                        nextSpecsJson.priceOverride = {
                                          mode: "total",
                                          value: total,
                                        };
                                      } else {
                                        delete nextSpecsJson.priceOverride;
                                      }

                                      void updateLineItemSilent
                                        .mutateAsync({
                                          id: lineItemId,
                                          data: {
                                            specsJson: nextSpecsJson,
                                          },
                                        })
                                        .then(() => {
                                          setOverrideById((prev) => {
                                            const { [lineItemId]: _omit, ...rest } = prev;
                                            return rest;
                                          });
                                        })
                                        .catch(() => {
                                          setOverrideById((prev) => ({ ...prev, [lineItemId]: persistedOverride }));
                                        });
                                    }
                              }
                              onOverrideTotalCommit={
                                readOnly
                                  ? undefined
                                  : async (_id, nextTotal) => {
                                      const lineItemId = String(item.id);
                                      const qty = item.quantity > 0 ? item.quantity : 1;
                                      const unitPrice = qty > 0 ? nextTotal / qty : 0;

                                      const nextSpecsJson = {
                                        ...(itemSpecsJson || {}),
                                        priceOverride: {
                                          mode: "total",
                                          value: nextTotal,
                                        },
                                      };

                                      try {
                                        await updateLineItemSilent.mutateAsync({
                                          id: lineItemId,
                                          data: {
                                            unitPrice: unitPrice.toFixed(2),
                                            totalPrice: nextTotal.toFixed(2),
                                            specsJson: nextSpecsJson,
                                          },
                                        });
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not update total",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              onOverrideUnitCommit={
                                readOnly
                                  ? undefined
                                  : async (_id, nextUnitPrice) => {
                                      const lineItemId = String(item.id);
                                      const qty = item.quantity > 0 ? item.quantity : 1;
                                      const nextTotal = nextUnitPrice * qty;

                                      const nextSpecsJson = {
                                        ...(itemSpecsJson || {}),
                                        priceOverride: {
                                          mode: "total",
                                          value: nextTotal,
                                        },
                                      };

                                      try {
                                        await updateLineItemSilent.mutateAsync({
                                          id: lineItemId,
                                          data: {
                                            unitPrice: nextUnitPrice.toFixed(2),
                                            totalPrice: nextTotal.toFixed(2),
                                            specsJson: nextSpecsJson,
                                          },
                                        });
                                      } catch (e) {
                                        toast({
                                          variant: "destructive",
                                          title: "Could not update unit price",
                                          description: "Please try again.",
                                        });
                                        throw e;
                                      }
                                    }
                              }
                              statusOptions={[
                                { value: "queued", label: "Queued" },
                                { value: "printing", label: "Printing" },
                                { value: "finishing", label: "Finishing" },
                                { value: "done", label: "Done" },
                                { value: "canceled", label: "Canceled" },
                              ]}
                              onStatusChange={
                                readOnly
                                  ? undefined
                                  : (_id, next) => {
                                      void updateLineItemStatus.mutateAsync({ lineItemId: item.id, status: next });
                                    }
                              }
                              onDuplicate={readOnly ? undefined : () => void handleDuplicateItem(item)}
                              onDelete={readOnly ? undefined : () => void handleRemoveItem(item.id)}
                            />
                          </div>

                          {isExpanded && expandedItem && expandedItem.id === item.id && (
                            <div id={contentId} className="px-2.5 pb-2.5">
                              <div className="rounded-md border border-border/40 bg-transparent p-3">
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
                                  optionSelections={optionSelections as any}
                                  onOptionSelectionsChange={setOptionSelections as any}
                                />
                              )}

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
                                        disabled={savingItemId === item.id || isCalculating || (isExpandedTreeV2 && !optionsV2Valid)}
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

                              {(() => {
                                const policy =
                                  productArtworkPolicy === "required" || productArtworkPolicy === "not_required"
                                    ? productArtworkPolicy
                                    : null;

                                const suppressedEntry =
                                  itemSpecsJson?.flags?.suppressed && typeof itemSpecsJson.flags.suppressed === "object"
                                    ? (itemSpecsJson.flags.suppressed as any)?.missing_artwork
                                    : null;
                                const suppressedReason =
                                  typeof suppressedEntry?.reason === "string" ? suppressedEntry.reason.trim() : "";
                                const suppressedAt = typeof suppressedEntry?.at === "string" ? suppressedEntry.at.trim() : "";
                                const isSuppressed = Boolean(suppressedReason && suppressedAt);

                                if (policy !== "required" && !isSuppressed) return null;

                                const canDerive = lineItemAttachmentsAssociationKnown && lineItemAssetsKnownForItem;
                                const hasAnyArtwork = attachmentsForThumb.length > 0 || assetCountForItem > 0;
                                const isMissingActive = policy === "required" && canDerive && !hasAnyArtwork && !isSuppressed;

                                const suppress = async () => {
                                  if (readOnly) return;
                                  const reason = missingArtworkSuppressReason.trim();
                                  if (!reason) {
                                    toast({
                                      title: "Reason required",
                                      description: "A reason is required to suppress this flag.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }

                                  const nextSpecsJson = {
                                    ...(itemSpecsJson || {}),
                                    flags: {
                                      ...((itemSpecsJson?.flags as any) || {}),
                                      suppressed: {
                                        ...(((itemSpecsJson?.flags as any)?.suppressed as any) || {}),
                                        missing_artwork: {
                                          reason,
                                          at: new Date().toISOString(),
                                        },
                                      },
                                    },
                                  };

                                  setSavingFlagLineItemId(String(item.id));
                                  try {
                                    await updateLineItemSilent.mutateAsync({
                                      id: String(item.id),
                                      data: { specsJson: nextSpecsJson },
                                    });
                                    setMissingArtworkSuppressReason("");
                                    await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
                                  } catch (err: any) {
                                    toast({
                                      title: "Failed to suppress flag",
                                      description: err?.message || "Please try again.",
                                      variant: "destructive",
                                    });
                                  } finally {
                                    setSavingFlagLineItemId(null);
                                  }
                                };

                                const clearSuppression = async () => {
                                  if (readOnly) return;

                                  const nextSuppressed = { ...(((itemSpecsJson?.flags as any)?.suppressed as any) || {}) };
                                  delete nextSuppressed.missing_artwork;

                                  const nextSpecsJson = {
                                    ...(itemSpecsJson || {}),
                                    flags: {
                                      ...((itemSpecsJson?.flags as any) || {}),
                                      suppressed: nextSuppressed,
                                    },
                                  };

                                  setSavingFlagLineItemId(String(item.id));
                                  try {
                                    await updateLineItemSilent.mutateAsync({
                                      id: String(item.id),
                                      data: { specsJson: nextSpecsJson },
                                    });
                                    await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
                                  } catch (err: any) {
                                    toast({
                                      title: "Failed to clear suppression",
                                      description: err?.message || "Please try again.",
                                      variant: "destructive",
                                    });
                                  } finally {
                                    setSavingFlagLineItemId(null);
                                  }
                                };

                                return (
                                  <div className={cn("mt-3 rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="text-sm font-medium">Flags</div>
                                    </div>

                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm">Missing artwork</div>

                                        <div className="mt-1">
                                          {isSuppressed ? (
                                            <TooltipProvider delayDuration={150}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Badge variant="outline" className="border-border/60 text-xs">
                                                    Suppressed
                                                  </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-[420px] whitespace-pre-wrap break-words">
                                                  {suppressedReason}
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          ) : isMissingActive ? (
                                            <Badge
                                              variant="outline"
                                              className="border-amber-500/30 bg-amber-500/10 text-amber-700 text-xs"
                                            >
                                              Active
                                            </Badge>
                                          ) : null}
                                        </div>
                                      </div>

                                      <div className="flex flex-col items-end gap-2">
                                        {isSuppressed ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            disabled={readOnly || savingFlagLineItemId === String(item.id)}
                                            onClick={() => void clearSuppression()}
                                          >
                                            Clear
                                          </Button>
                                        ) : (
                                          <div className="flex flex-col gap-2 items-end">
                                            <div className="w-56">
                                              <div className="text-xs text-muted-foreground mb-1">Reason</div>
                                              <Input
                                                value={missingArtworkSuppressReason}
                                                onChange={(e) => setMissingArtworkSuppressReason(e.target.value)}
                                                className="h-8"
                                                disabled={readOnly || savingFlagLineItemId === String(item.id)}
                                              />
                                            </div>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-8"
                                                disabled={readOnly || savingFlagLineItemId === String(item.id)}
                                              onClick={() => void suppress()}
                                            >
                                              Suppress
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              <div className={cn("mt-3 rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">Notes</div>

                                  {!readOnly && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={savingNotesId === String(item.id)}
                                      onClick={async () => {
                                        const lineItemId = String(item.id);
                                        const draft = notesDraftById[lineItemId] ?? persistedNotesText;

                                        const nextSpecsJson = {
                                          ...(itemSpecsJson || {}),
                                          lineItemNotes: {
                                            ...(((itemSpecsJson as any)?.lineItemNotes as any) || {}),
                                            descLong: draft,
                                          },
                                        } as any;

                                        setSavingNotesId(lineItemId);
                                        try {
                                          await updateLineItemSilent.mutateAsync({
                                            id: lineItemId,
                                            data: {
                                              specsJson: nextSpecsJson,
                                            },
                                          });

                                          await queryClient.invalidateQueries({
                                            queryKey: ["/api/orders", orderId],
                                          });
                                        } catch (e) {
                                          toast({
                                            variant: "destructive",
                                            title: "Could not save notes",
                                            description: "Please try again.",
                                          });
                                        } finally {
                                          setSavingNotesId((prev) => (prev === lineItemId ? null : prev));
                                        }
                                      }}
                                    >
                                      {savingNotesId === String(item.id) ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                          Saving…
                                        </>
                                      ) : (
                                        "Save"
                                      )}
                                    </Button>
                                  )}
                                </div>

                                <textarea
                                  ref={(el) => {
                                    notesEditorRefs.current[String(item.id)] = el;
                                  }}
                                  value={notesDraftById[String(item.id)] ?? persistedNotesText}
                                  onChange={(e) => {
                                    const next = e.target.value;
                                    const lineItemId = String(item.id);
                                    setNotesDraftById((prev) => ({ ...prev, [lineItemId]: next }));
                                  }}
                                  className={cn(
                                    "w-full min-h-[120px] resize-y rounded-md border border-border bg-background/40 px-3 py-2 text-sm",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                    readOnly && "opacity-70"
                                  )}
                                  placeholder={readOnly ? "" : "Add notes…"}
                                  disabled={readOnly}
                                  readOnly={readOnly}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
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
            const fileName = previewFile.originalFilename || previewFile.fileName;
            
            // Construct same-origin view URL for iframe (PDFs must use /objects proxy)
            const objectPath = (previewFile as any).objectPath as string | null | undefined;
            let iframeViewUrl: string | null = null;
            
            if (isPdf && typeof objectPath === "string" && objectPath.length) {
              iframeViewUrl = `/objects/${objectPath}?filename=${encodeURIComponent(fileName)}`;
            } else if (isPdf && previewFile.originalUrl && previewFile.originalUrl.startsWith('/objects/')) {
              iframeViewUrl = previewFile.originalUrl;
            }
            
            // Non-PDF preview URL
            const previewUrl = previewFile.previewUrl ?? previewFile.originalUrl;
            const hasValidPreview = !isPdf && previewUrl && isValidHttpUrl(previewUrl);
            
            // Construct download URL
            let downloadUrl: string | null = null;
            if (typeof objectPath === "string" && objectPath.length) {
              downloadUrl = `/objects/${objectPath}?download=1&filename=${encodeURIComponent(fileName)}`;
            } else if (previewFile.originalUrl) {
              downloadUrl = previewFile.originalUrl;
            }

            return (
              <div className="space-y-4">
                {isPdf && iframeViewUrl ? (
                  <div className="bg-muted/30 rounded-lg p-2 space-y-2">
                    {!pdfEmbedError ? (
                      <iframe
                        title={fileName}
                        src={`${iframeViewUrl}#toolbar=1&navpanes=0`}
                        className="w-full h-[60vh] rounded-md border border-border bg-background"
                        style={{ width: '100%', height: '60vh', border: 0 }}
                        allow="fullscreen"
                        onLoad={() => {
                          console.log('[OrderLineItemsSection] PDF iframe loaded:', iframeViewUrl);
                        }}
                        onError={(e) => {
                          setPdfEmbedError(true);
                          console.error("[OrderLineItemsSection] PDF iframe failed to load", {
                            src: iframeViewUrl,
                            fileName,
                          });
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                        <FileText className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-sm mb-2">PDF failed to render inline</p>
                        {downloadUrl && (
                          <Button
                            onClick={() => {
                              const anchor = document.createElement("a");
                              anchor.href = downloadUrl!;
                              anchor.download = fileName;
                              anchor.style.display = "none";
                              document.body.appendChild(anchor);
                              anchor.click();
                              document.body.removeChild(anchor);
                            }}
                            variant="outline"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : isPdf && !iframeViewUrl ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-sm mb-2">PDF preview unavailable</p>
                    <p className="text-xs mb-4">No same-origin URL available</p>
                    {downloadUrl && (
                      <Button
                        onClick={() => {
                          const anchor = document.createElement("a");
                          anchor.href = downloadUrl!;
                          anchor.download = fileName;
                          anchor.style.display = "none";
                          document.body.appendChild(anchor);
                          anchor.click();
                          document.body.removeChild(anchor);
                        }}
                        variant="outline"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    )}
                  </div>
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

                  {downloadUrl && (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        onClick={() => {
                          const anchor = document.createElement("a");
                          anchor.href = downloadUrl!;
                          anchor.download = fileName;
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

      <Dialog
        open={!!artworkModalLineItemId}
        onOpenChange={(open) => {
          if (!open) setArtworkModalLineItemId(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{artworkModalProductName ? `Artwork — ${artworkModalProductName}` : "Artwork"}</DialogTitle>
            <DialogDescription>View and manage artwork for this line item.</DialogDescription>
          </DialogHeader>

          {artworkModalLineItemId && (
            <div className="mt-2">
              <LineItemAttachmentsPanel
                quoteId={null}
                parentType="order"
                orderId={orderId}
                lineItemId={artworkModalLineItemId}
                productName={artworkModalProductName}
                defaultExpanded={true}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
