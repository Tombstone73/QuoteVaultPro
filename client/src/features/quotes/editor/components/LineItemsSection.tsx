import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Minus, Plus, Save, Loader2, Check, ChevronsUpDown, GripVertical, Undo2 } from "lucide-react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Product, ProductOptionItem } from "@shared/schema";
import type { QuoteLineItemDraft, OptionSelection } from "../types";
import { apiRequest } from "@/lib/queryClient";
import { isSessionExpiredError, notifySessionExpired, SESSION_EXPIRED_MESSAGE } from "@/lib/authUtils";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { ProductOptionsPanelV2 } from "./ProductOptionsPanelV2";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { uploadTemporaryOrderAttachmentViaChunked, type TemporaryOrderAttachmentUpload } from "@/lib/uploads/chunkedAttachmentUpload";
import { setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { setPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { buildPbv2DefaultSelections } from "@shared/pbv2OrderEntryRuntime";
import { getPbv2FixedDimensions } from "@shared/pbv2/fixedDimensions";
import { productRequiresEnteredDimensions } from "@shared/productMeasurementMode";
import { getProductWorkflowDefaults } from "@shared/productWorkflowIntent";
import { skipsRequiredPrintOptionValidation } from "@shared/productPricingValidation";
import { formatLineItemMeasurementLabel } from "@shared/lineItemPresentation";
import { deriveVisibleLineItemPriceDisplay } from "@/components/orders/lineItemPricingDisplay";
import { LineItemCard } from "@/components/line-items/LineItemCard";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import {
  applyLineItemEditPriceOverride,
  getLineItemPriceOverrideLabel,
  type LineItemPriceOverrideMode,
} from "@shared/lineItemPriceOverrides";
import {
  getQuoteLineItemOverrideValueCents,
  getQuoteLineItemPriceOverrideMode,
  mergeQuoteLineItemPriceOverrideIntoSpecsJson,
  resolveQuoteLineItemOverrideModeChange,
  resolveQuoteLineItemOverrideUiState,
} from "./quoteLineItemPriceOverrideUiState";
import {
  buildQuoteLineItemPricingFingerprint,
  shouldRequestQuoteLineItemPricingPreview,
} from "../quoteLineItemPricingPreview";
import { buildArtworkAllocationStatus, reconcileStagedArtworkAllocations } from "@shared/artworkAllocation";

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
  onSaveLineItem?: (itemKey: string, overrides?: Partial<QuoteLineItemDraft>) => Promise<boolean>;
  onDuplicateLineItem: (itemKey: string) => void;
  onRemoveLineItem: (itemKey: string) => void;
  onReorderLineItems?: (orderedKeys: string[]) => Promise<{ ok: boolean }>;
  ensureQuoteId?: () => Promise<string>;
  ensureLineItemId?: (itemKey: string) => Promise<{ quoteId: string; lineItemId: string }>;
  createTarget?: "quote" | "order";
};

function getItemKey(item: QuoteLineItemDraft): string {
  return item.tempId || item.id || "";
}

function getProduct(products: Product[], productId: string) {
  return products.find((p) => p.id === productId) ?? null;
}

function getQuoteLineItemBaseTotalCents(item: QuoteLineItemDraft): number {
  const overrideBase = Number(
    (item.priceOverride as any)?.baseCalculatedTotalCents ??
      (item.specsJson as any)?.priceOverride?.baseCalculatedTotalCents,
  );
  if (Number.isFinite(overrideBase)) return Math.round(overrideBase);
  const snapshotBase = Number((item.pbv2SnapshotJson as any)?.pricing?.totalCents);
  if (Number.isFinite(snapshotBase)) return Math.round(snapshotBase);
  return Math.round(Number(item.formulaLinePrice ?? item.linePrice ?? 0) * 100);
}

function buildQuoteLineItemOverridePatch(input: {
  mode: LineItemPriceOverrideMode;
  valueCents: number;
  baseTotalCents: number;
  quantity: number;
}) {
  const pricing = applyLineItemEditPriceOverride({
    baseCalculatedTotalCents: input.baseTotalCents,
    quantity: input.quantity,
    mode: input.mode,
    valueCents: input.valueCents,
  });

  return {
    pricing,
    priceOverride: {
      schemaVersion: 1,
      mode: pricing.priceOverrideMode,
      valueCents: pricing.priceOverrideValueCents,
      valuePercent: pricing.priceOverrideValuePercent,
      baseCalculatedUnitPriceCents: pricing.baseCalculatedUnitPriceCents,
      baseCalculatedTotalCents: pricing.baseCalculatedTotalCents,
      effectiveUnitPriceCents: pricing.effectiveUnitPriceCents,
      effectiveTotalCents: pricing.effectiveTotalCents,
      appliedAt: new Date().toISOString(),
    },
  };
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
  return productRequiresEnteredDimensions(product);
}

/**
 * Check if dimensions are required for a PBV2 product tree.
 * Reads from tree.meta?.requiresDimensions if available, otherwise falls back to product-level logic.
 */
function requiresDimensionsV2(product: Product | null, treeJson: OptionTreeV2 | null): boolean {
  return productRequiresEnteredDimensions(product, treeJson);
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

function buildOptionSelectionsRecordFromSelectedOptions(selectedOptions: any[] | undefined | null): Record<string, OptionSelection> {
  const selections: Record<string, OptionSelection> = {};
  if (!Array.isArray(selectedOptions)) return selections;

  for (const opt of selectedOptions) {
    if (!opt?.optionId) continue;
    selections[String(opt.optionId)] = {
      value: opt.value,
      note: opt.note,
      grommetsLocation: opt.grommetsLocation,
      grommetsSpacingCount: opt.grommetsSpacingCount,
      grommetsPerSign: opt.grommetsPerSign,
      grommetsSpacingInches: opt.grommetsSpacingInches,
      customPlacementNote: opt.customPlacementNote,
      hemsType: opt.hemsType,
      polePocket: opt.polePocket,
    };
  }

  return selections;
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
  createTarget = "quote",
}: LineItemsSectionProps) {
  const queryClient = useQueryClient();
  const { preferences: orgPreferences } = useOrgPreferences();
  const count = lineItems.filter((li) => li.status !== "canceled").length;

  // TEMP UI-only reorder state (not persisted)
  const [uiOrderKeys, setUiOrderKeys] = useState<string[] | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [parentLinkTargetKey, setParentLinkTargetKey] = useState<string | null>(null);
  const [selectedParentLineItemId, setSelectedParentLineItemId] = useState("");
  const [isSavingParentLink, setIsSavingParentLink] = useState(false);
  const [parentLinkError, setParentLinkError] = useState<string | null>(null);

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

  const displayLineItems = useMemo(() => {
    const childrenByParent = new Map<string, QuoteLineItemDraft[]>();
    const topLevel: QuoteLineItemDraft[] = [];
    for (const item of orderedLineItems) {
      if (item.parentLineItemId) {
        const children = childrenByParent.get(item.parentLineItemId) ?? [];
        children.push(item);
        childrenByParent.set(item.parentLineItemId, children);
      } else {
        topLevel.push(item);
      }
    }
    const grouped = topLevel.flatMap((item) => [item, ...(item.id ? childrenByParent.get(item.id) ?? [] : [])]);
    const renderedKeys = new Set(grouped.map(getItemKey));
    return [...grouped, ...orderedLineItems.filter((item) => !renderedKeys.has(getItemKey(item)))];
  }, [orderedLineItems]);

  const parentLinkTarget = useMemo(
    () => lineItems.find((item) => getItemKey(item) === parentLinkTargetKey) ?? null,
    [lineItems, parentLinkTargetKey],
  );
  const eligibleParentLineItems = useMemo(() => lineItems.filter((candidate) =>
    !!candidate.id && candidate.id !== parentLinkTarget?.id && !candidate.parentLineItemId,
  ), [lineItems, parentLinkTarget]);
  const openParentLinkDialog = useCallback((item: QuoteLineItemDraft) => {
    setParentLinkTargetKey(getItemKey(item));
    setSelectedParentLineItemId(item.parentLineItemId ?? "");
    setParentLinkError(null);
  }, []);
  const updateParentRelationship = useCallback(async (child: QuoteLineItemDraft, parentLineItemId: string | null) => {
    if (!quoteId || !child.id) return;
    setIsSavingParentLink(true);
    setParentLinkError(null);
    try {
      await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${child.id}/parent`, { parentLineItemId });
      const priorParentId = child.parentLineItemId ?? null;
      onUpdateLineItem(getItemKey(child), { parentLineItemId, lineItemRole: parentLineItemId ? "child" : "standalone" });
      if (parentLineItemId) {
        const parent = lineItems.find((item) => item.id === parentLineItemId);
        if (parent) onUpdateLineItem(getItemKey(parent), { lineItemRole: "parent" });
      }
      if (priorParentId && priorParentId !== parentLineItemId) {
        const stillHasChildren = lineItems.some((item) => item.id !== child.id && item.parentLineItemId === priorParentId);
        if (!stillHasChildren) {
          const priorParent = lineItems.find((item) => item.id === priorParentId);
          if (priorParent) onUpdateLineItem(getItemKey(priorParent), { lineItemRole: "standalone" });
        }
      }
      setParentLinkTargetKey(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
    } catch (error) {
      setParentLinkError(error instanceof Error ? error.message : "Unable to update the line item relationship.");
    } finally {
      setIsSavingParentLink(false);
    }
  }, [lineItems, onUpdateLineItem, queryClient, quoteId]);

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

  // Live PBV2 tree fetch: always reads the current active tree from the server so
  // that a newly published option group appears immediately without requiring a hard
  // refresh or waiting for the products-list cache to revalidate.
  const expandedProductActiveTreeVersionId = (expandedProduct as any)?.pbv2ActiveTreeVersionId ?? null;
  const { data: livePbv2TreeData } = useQuery<OptionTreeV2 | null>({
    queryKey: ["/api/products", expandedProduct?.id, "pbv2/tree", expandedProductActiveTreeVersionId],
    enabled: !!expandedProductActiveTreeVersionId && !!expandedProduct?.id,
    queryFn: async () => {
      const res = await fetch(`/api/products/${expandedProduct!.id}/pbv2/tree`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.data?.active?.treeJson ?? null) as OptionTreeV2 | null;
    },
    staleTime: 0,
  });

  // Priority: snapshot tree (from priced line item) → live active tree → cached product.optionTreeJson
  const expandedOptionTreeJson = useMemo(() => {
    const snapshot = (expandedItem as any)?.pbv2SnapshotJson;
    if (snapshot?.treeJson) {
      return snapshot.treeJson as OptionTreeV2 | null;
    }
    if (livePbv2TreeData) {
      return livePbv2TreeData;
    }
    return (((expandedProduct as any)?.optionTreeJson ?? null) as OptionTreeV2 | null) ?? null;
  }, [expandedProduct, expandedItem, livePbv2TreeData]);

  const isExpandedTreeV2 = useMemo(() => {
    return Boolean(expandedOptionTreeJson && (expandedOptionTreeJson as any)?.schemaVersion === 2);
  }, [expandedOptionTreeJson]);
  const expandedSkipsPrintOptionValidation = skipsRequiredPrintOptionValidation(expandedProduct);
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
  const [description, setDescription] = useState<string>("");
  const [productionNotes, setProductionNotes] = useState<string>("");
  // Canonical routing intent (migration 0015)
  const [requiresDesign, setRequiresDesign] = useState<boolean>(false);
  const [requiresPrepress, setRequiresPrepress] = useState<boolean | null>(null);
  const [requiresProofApproval, setRequiresProofApproval] = useState<boolean>(false);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const lastPricingFingerprintRef = useRef("");
  const pricingRequestSequenceRef = useRef(0);
  const currentPricingFingerprintRef = useRef("");
  const [savingItemKey, setSavingItemKey] = useState<string | null>(null);
  const [savedItemKey, setSavedItemKey] = useState<string | null>(null);
  const [editingPriceItemKey, setEditingPriceItemKey] = useState<string | null>(null);
  const [priceEditTextByKey, setPriceEditTextByKey] = useState<Record<string, string>>({});
  const [priceOverrideModeByKey, setPriceOverrideModeByKey] = useState<Record<string, LineItemPriceOverrideMode>>({});
  
  // Tracks the itemKey of a product just added so we can scroll to it once it's expanded.
  // Set before onExpandedKeyChange so the effect fires on the correct render.
  const pendingScrollToItemKeyRef = useRef<string | null>(null);
  const widthInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadTemporaryOrderAttachments = useCallback(
    async (itemKey: string, files: File[]) => {
      if (!itemKey || files.length === 0) return;
      const uploaded = [];
      let errorCount = 0;
      for (const file of files) {
        try {
          uploaded.push(await uploadTemporaryOrderAttachmentViaChunked(file));
        } catch (error) {
          errorCount += 1;
          console.error("[LineItemsSection] TEMP order artwork upload failed", error);
        }
      }
      if (uploaded.length > 0) {
        const currentItem = lineItems.find((li) => getItemKey(li) === itemKey);
        const pendingOrderAttachments = reconcileStagedArtworkAllocations({
          lineQuantity: currentItem?.quantity,
          attachments: [
            ...((currentItem?.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? []),
            ...uploaded,
          ],
        });
        onUpdateLineItem(itemKey, {
          pendingOrderAttachments,
        });
      }
      if (uploaded.length === 0 && errorCount > 0) {
        throw new Error("Failed to stage artwork for this new order.");
      }
    },
    [lineItems, onUpdateLineItem],
  );

  const removeTemporaryOrderAttachment = useCallback((itemKey: string, uploadId: string) => {
    const currentItem = lineItems.find((lineItem) => getItemKey(lineItem) === itemKey);
    if (!currentItem) return;
    const pendingOrderAttachments = reconcileStagedArtworkAllocations({
      lineQuantity: currentItem.quantity,
      attachments: ((currentItem.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
        .filter((attachment) => attachment.uploadId !== uploadId),
    });
    onUpdateLineItem(itemKey, { pendingOrderAttachments });
  }, [lineItems, onUpdateLineItem]);

  // Track saved state snapshot for dirty detection
  const savedSnapshotRef = useRef<
    Record<
      string,
      {
        productId: string;
        variantId: string | null;
        pbv2TreeVersionId: string | null;
        width: number;
        height: number;
        quantity: number;
        notes: string;
        requiresProofApproval: boolean;
        selectedOptions: any[];
        optionSelectionsJson: any;
        pendingOrderAttachmentIds: string[];
      }
    >
  >({});

  // After a product is added: clear Radix focus-return scroll and land at the top of the
  // new card with the Width input focused.  Radix Popover restores focus to its trigger
  // (the "Add Product" button at the bottom of the page) via a RAF when it closes.
  // We fire a second double-RAF — guaranteed to run after Radix's — to undo that scroll,
  // scrollIntoView the new card, and focus Width with preventScroll.
  useEffect(() => {
    const pendingKey = pendingScrollToItemKeyRef.current;
    if (!pendingKey || expandedKey !== pendingKey) return;

    pendingScrollToItemKeyRef.current = null;
    let cancelled = false;

    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;

        // Blur whatever Radix focused (the "Add Product" trigger or similar)
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) {
          active.blur();
        }

        // The expanded panel id = "line-item-${itemKey}-details"; its parentElement
        // is the card's px-3 pb-3 wrapper, so scroll the grandparent (the card root).
        const contentEl = document.getElementById(`line-item-${pendingKey}-details`);
        const cardRoot = contentEl?.parentElement ?? contentEl;
        cardRoot?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });

        const currentDimsRequired = requiresDimensionsV2(expandedProduct, expandedOptionTreeJson) && !getPbv2FixedDimensions(expandedOptionTreeJson);
        if (currentDimsRequired) {
          widthInputRefs.current[pendingKey]?.focus({ preventScroll: true });
        }

        // Re-anchor after focus in case the browser nudged the viewport.
        cardRoot?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
    };
  }, [expandedKey, expandedProduct, expandedOptionTreeJson]);

  useEffect(() => {
    if (!expandedItem) return;
    const itemKey = getItemKey(expandedItem);
    const fixed = getPbv2FixedDimensions(expandedOptionTreeJson);
    const quantityOnly = (expandedProduct as any)?.measurementMode === "quantity_only";
    setWidthText(String(fixed?.widthIn ?? (quantityOnly ? 0 : expandedItem.width ?? 1)));
    setHeightText(String(fixed?.heightIn ?? (quantityOnly ? 0 : expandedItem.height ?? 1)));
    setQty(expandedItem.quantity || 1);
    setNotes((expandedItem.specsJson as any)?.notes || expandedItem.notes || "");
    setDescription(expandedItem.description || "");
    setProductionNotes(expandedItem.productionNotes || "");
    // Rehydrate routing intent from quote line item (migration 0015)
    // Fall back to product-level defaults for new draft items (requiresDesign/requiresPrepress not yet persisted)
    const workflowDefaults = getProductWorkflowDefaults(expandedProduct as any);
    const itemRequiresDesign = (expandedItem as any).requiresDesign;
    const productRequiresDesign = (expandedProduct as any)?.requiresDesign;
    setRequiresDesign(
      typeof itemRequiresDesign === "boolean"
        ? itemRequiresDesign
        : workflowDefaults.requiresDesign ?? productRequiresDesign === true
    );
    const itemRequiresPrepress = (expandedItem as any).requiresPrepress;
    const productRequiresPrepress = (expandedProduct as any)?.requiresPrepress;
    setRequiresPrepress(
      typeof itemRequiresPrepress === 'boolean'
        ? itemRequiresPrepress
        : typeof workflowDefaults.requiresPrepress === "boolean"
          ? workflowDefaults.requiresPrepress
        : typeof productRequiresPrepress === 'boolean'
          ? productRequiresPrepress
          : null
    );
    const itemRequiresProofApproval = (expandedItem as any).requiresProofApproval;
    const productRequiresProofApproval = (expandedProduct as any)?.requiresProofApproval;
    setRequiresProofApproval(
      typeof itemRequiresProofApproval === "boolean"
        ? itemRequiresProofApproval
        : typeof workflowDefaults.requiresProofApproval === "boolean"
          ? workflowDefaults.requiresProofApproval
        : productRequiresProofApproval === true
    );
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
      // Seed from product tree defaults for new (unsaved) items so options render pre-selected
      const treeForDefaults = expandedOptionTreeJson;
      const defaults =
        treeForDefaults && (treeForDefaults as any).schemaVersion === 2
          ? buildPbv2DefaultSelections(treeForDefaults)
          : null;
      const next: LineItemOptionSelectionsV2 =
        defaults?.selected && Object.keys(defaults.selected).length > 0
          ? { schemaVersion: 2, selected: defaults.selected }
          : { schemaVersion: 2, selected: {} };
      setOptionSelectionsV2(next);
    }

    // Initialize price edit text from override mode/value or calculated price.
    const overrideMode = getQuoteLineItemPriceOverrideMode(expandedItem);
    const overrideValueCents = getQuoteLineItemOverrideValueCents(expandedItem, overrideMode);
    const displayPrice = overrideValueCents != null
      ? overrideValueCents / 100
      : (expandedItem.linePrice || 0);
    if (overrideMode) {
      setPriceOverrideModeByKey((prev) => ({ ...prev, [itemKey]: overrideMode }));
    } else {
      setPriceOverrideModeByKey((prev) => {
        if (!prev[itemKey]) return prev;
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
    }
    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: displayPrice.toFixed(2) }));
    setEditingPriceItemKey(null);

    setCalcError(null);
    
    // Save snapshot for dirty detection
    savedSnapshotRef.current[itemKey] = {
      productId: expandedItem.productId,
      variantId: expandedItem.variantId ?? null,
      pbv2TreeVersionId: expandedItem.pbv2TreeVersionId ?? expandedProductActiveTreeVersionId ?? null,
      width: expandedItem.width,
      height: expandedItem.height,
      quantity: expandedItem.quantity,
      notes: (expandedItem.specsJson as any)?.notes || expandedItem.notes || "",
      requiresProofApproval: typeof (expandedItem as any).requiresProofApproval === "boolean"
        ? (expandedItem as any).requiresProofApproval
        : (expandedProduct as any)?.requiresProofApproval === true,
      selectedOptions: expandedItem.selectedOptions || [],
      optionSelectionsJson: (expandedItem as any)?.optionSelectionsJson ?? null,
      pendingOrderAttachmentIds: ((expandedItem.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
        .map((attachment) => attachment.uploadId),
    };
  }, [
    expandedItem?.id,
    expandedItem?.tempId,
    expandedProduct?.id,
    expandedProduct?.name,
    expandedOptionTreeJson,
    (expandedProduct as any)?.requiresDesign,
    (expandedProduct as any)?.requiresPrepress,
    (expandedProduct as any)?.requiresProofApproval,
    (expandedProduct as any)?.requiresProductionJob,
    (expandedProduct as any)?.measurementMode,
    (expandedProduct as any)?.workflowIntent,
  ]);

  const fixedDimensions = getPbv2FixedDimensions(expandedOptionTreeJson);
  const dimsRequired = requiresDimensionsV2(expandedProduct, expandedOptionTreeJson) && !fixedDimensions;
  const widthNum = fixedDimensions ? fixedDimensions.widthIn : dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = fixedDimensions ? fixedDimensions.heightIn : dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const pricingSelections = isExpandedTreeV2 ? optionSelectionsV2.selected || {} : optionSelections;
  const pricingFingerprint = buildQuoteLineItemPricingFingerprint({
    productId: expandedItem?.productId ?? "",
    variantId: expandedItem?.variantId ?? null,
    treeVersionId: expandedItem?.pbv2TreeVersionId ?? expandedProductActiveTreeVersionId ?? null,
    width: widthNum,
    height: heightNum,
    quantity: qtyNum,
    selections: pricingSelections,
  });
  currentPricingFingerprintRef.current = pricingFingerprint;

  useEffect(() => {
    lastPricingFingerprintRef.current = "";
    pricingRequestSequenceRef.current += 1;
  }, [expandedKey]);

  const handleOptionSelectionsV2Change = useCallback((next: LineItemOptionSelectionsV2) => {
    setOptionSelectionsV2(next);
  }, []);

  const handleOptionsV2ValidityChange = useCallback((nextValid: boolean) => {
    setOptionsV2Valid(nextValid);
  }, []);

  const handleRequiresDesignChange = useCallback((next: boolean) => {
    setRequiresDesign(next);
  }, []);

  const handleRequiresPrepressChange = useCallback((next: boolean) => {
    setRequiresPrepress(next);
  }, []);

  const handleRequiresProofApprovalChange = useCallback((next: boolean) => {
    setRequiresProofApproval(next);
  }, []);

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
    const currentPendingOrderAttachmentIds = ((expandedItem.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
      .map((attachment) => attachment.uploadId);
    
    return (
      Math.abs(widthNum - saved.width) > 0.01 ||
      Math.abs(heightNum - saved.height) > 0.01 ||
      qtyNum !== saved.quantity ||
      currentNotes !== savedNotes ||
      requiresProofApproval !== saved.requiresProofApproval ||
      currentOptions !== savedOptions ||
      currentV2 !== savedV2 ||
      JSON.stringify(currentPendingOrderAttachmentIds) !== JSON.stringify(saved.pendingOrderAttachmentIds)
    );
  }, [expandedItem, expandedKey, widthNum, heightNum, qtyNum, notes, requiresProofApproval]);

  // Handle save line item
  const handleSaveItem = async () => {
    if (!expandedKey || !onSaveLineItem || !expandedItem) return;
    if (isExpandedTreeV2 && !optionsV2Valid && !expandedSkipsPrintOptionValidation) {
      setCalcError("Complete required product options before saving.");
      return;
    }
    if (createTarget === "order" && expandedItem.pendingOrderAttachments?.length) {
      const allocation = buildArtworkAllocationStatus({
        lineQuantity: qtyNum,
        members: expandedItem.pendingOrderAttachments.map((attachment) => ({
          id: attachment.uploadId,
          role: "artwork",
          productionQuantity: attachment.productionQuantity ?? null,
          productionGroupId: attachment.productionGroupId ?? null,
        })),
      });
      if (!allocation.valid) {
        setCalcError(`Artwork allocation is unresolved: ${allocation.issue}`);
        return;
      }
    }
    setSavingItemKey(expandedKey);
    setSavedItemKey(null);
    try {
      const success = await onSaveLineItem(expandedKey);
      if (success) {
        setSavedItemKey(expandedKey);
        // Update saved snapshot with current values
        savedSnapshotRef.current[expandedKey] = {
          productId: expandedItem.productId,
          variantId: expandedItem.variantId ?? null,
          pbv2TreeVersionId: expandedItem.pbv2TreeVersionId ?? expandedProductActiveTreeVersionId ?? null,
          width: widthNum,
          height: heightNum,
          quantity: qtyNum,
          notes: notes || "",
          requiresProofApproval,
          selectedOptions: expandedItem.selectedOptions || [],
          optionSelectionsJson: (expandedItem as any)?.optionSelectionsJson ?? null,
          pendingOrderAttachmentIds: ((expandedItem.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
            .map((attachment) => attachment.uploadId),
        };
        // Clear saved indicator after 2 seconds
        setTimeout(() => setSavedItemKey(null), 2000);
      }
    } finally {
      setSavingItemKey(null);
    }
  };

  const refreshQuotePricingAfterOverrideChange = async ({
    item,
    itemKey,
    nextOverrideCents,
    priceOverrideMode,
    priceOverrideValueCents,
    previousOverrideCents: _previousOverrideCents,
  }: {
    item: QuoteLineItemDraft;
    itemKey: string;
    nextOverrideCents: number | null;
    priceOverrideMode?: LineItemPriceOverrideMode | null;
    priceOverrideValueCents?: number | null;
    previousOverrideCents: number | null;
  }) => {
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const width = Number(item.width) > 0 ? Number(item.width) : 1;
    const height = Number(item.height) > 0 ? Number(item.height) : 1;
    const optionSelectionsJson = (item as any)?.optionSelectionsJson;
    const isTreeV2 = Boolean(optionSelectionsJson && typeof optionSelectionsJson === "object" && optionSelectionsJson.schemaVersion === 2);

    let formulaPrice = Number(item.formulaLinePrice ?? item.linePrice ?? 0) || 0;
    const buildPricingPatch = (nextFormulaPrice: number): Partial<QuoteLineItemDraft> => {
      const baseTotalCents = Math.round(nextFormulaPrice * 100);
      const overridePatch =
        typeof nextOverrideCents === "number" && Number.isFinite(nextOverrideCents) && priceOverrideMode
          ? buildQuoteLineItemOverridePatch({
              mode: priceOverrideMode,
              valueCents: Math.max(0, Math.round(priceOverrideValueCents ?? nextOverrideCents)),
              baseTotalCents,
              quantity,
            })
          : null;
      const effectiveOverrideCents = overridePatch ? overridePatch.pricing.effectiveTotalCents : null;
      const effectiveLinePrice = effectiveOverrideCents != null ? effectiveOverrideCents / 100 : nextFormulaPrice;
      const nextSpecsJson = mergeQuoteLineItemPriceOverrideIntoSpecsJson(item.specsJson, overridePatch?.priceOverride ?? null);

      return {
        specsJson: nextSpecsJson,
        formulaLinePrice: nextFormulaPrice,
        linePrice: effectiveLinePrice,
        priceOverride: overridePatch?.priceOverride ?? null,
        overridePriceCents: effectiveOverrideCents,
        overrideAt: effectiveOverrideCents == null ? null : new Date().toISOString(),
        overrideByUserId: null,
        overrideReason: null,
      };
    };

    onUpdateLineItem(itemKey, buildPricingPatch(formulaPrice));

    try {
      const calculateResponse = await apiRequest("POST", "/api/quotes/calculate", {
        productId: item.productId,
        variantId: item.variantId,
        width,
        height,
        quantity,
        ...(isTreeV2
          ? { optionSelectionsJson: (optionSelectionsJson as any)?.selected || {} }
          : { selectedOptions: buildOptionSelectionsRecordFromSelectedOptions(item.selectedOptions) }),
        customerId,
        quoteId,
        debugSource: "LineItemsSection.override-refresh",
      });
      const calculateData = await calculateResponse.json();
      const nextFormula = Number(calculateData?.linePrice);
      if (Number.isFinite(nextFormula)) {
        formulaPrice = nextFormula;
      }
    } catch (error) {
      if (isSessionExpiredError(error)) {
        setCalcError(SESSION_EXPIRED_MESSAGE);
        notifySessionExpired("quote-line-price-override-refresh");
        return;
      }
      // Keep current formula fallback
    }

    const pricingPatch = buildPricingPatch(formulaPrice);

    onUpdateLineItem(itemKey, pricingPatch);

    if (onSaveLineItem) {
      await onSaveLineItem(itemKey, pricingPatch);
    }

    if (quoteId) {
      await queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      await queryClient.refetchQueries({ queryKey: ["/api/quotes", quoteId], type: "active" });
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
      description: description || undefined,
      productionNotes: productionNotes || undefined,
      // Canonical routing intent (migration 0015)
      requiresDesign,
      requiresPrepress,
      requiresProofApproval,
      pendingOrderAttachments: reconcileStagedArtworkAllocations({
        lineQuantity: qtyNum,
        attachments: (expandedItem.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [],
      }),
      ...(v2Patch as any),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, widthNum, heightNum, qtyNum, notes, description, productionNotes, requiresDesign, requiresPrepress, requiresProofApproval, isExpandedTreeV2, optionSelectionsV2]);

  // Identity persistence must not reset edit snapshot; only explicit user saves do.
  // The snapshot is already correctly updated in handleSaveItem when user clicks Save.
  // This effect was incorrectly treating "ID appeared" as "user saved", breaking live pricing.
  // REMOVED: Snapshot updates now ONLY occur in handleSaveItem (explicit save action).

  // Debounced price calculation for expanded item
  useDebouncedEffect(
    () => {
      if (!expandedItem || !expandedProduct) {
        return;
      }
      if (dimsRequired && (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0)) {
        return;
      }
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return;
      }

      const saved = expandedKey ? savedSnapshotRef.current[expandedKey] : null;
      const savedSelections = isExpandedTreeV2
        ? ((saved?.optionSelectionsJson as any)?.selected ?? saved?.optionSelectionsJson ?? {})
        : buildOptionSelectionsRecordFromSelectedOptions(saved?.selectedOptions);
      const savedFingerprint = saved
        ? buildQuoteLineItemPricingFingerprint({
            productId: saved.productId,
            variantId: saved.variantId,
            treeVersionId: saved.pbv2TreeVersionId,
            width: saved.width,
            height: saved.height,
            quantity: saved.quantity,
            selections: savedSelections,
          })
        : "";
      const pricingInputsMatchSaved = Boolean(saved && pricingFingerprint === savedFingerprint);
      const optionsValid = !isExpandedTreeV2 || optionsV2Valid || expandedSkipsPrintOptionValidation;
      if (!shouldRequestQuoteLineItemPricingPreview({
        fingerprint: pricingFingerprint,
        lastRequestedFingerprint: lastPricingFingerprintRef.current,
        pricingInputsMatchSaved,
        optionsValid,
      })) {
        setCalcError(null);
        setIsCalculating(false);
        return;
      }
      lastPricingFingerprintRef.current = pricingFingerprint;
      const requestSequence = ++pricingRequestSequenceRef.current;

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
        ...(expandedSkipsPrintOptionValidation &&
        getQuoteLineItemPriceOverrideMode(expandedItem) &&
        Number.isFinite(Number(expandedItem.overridePriceCents))
          ? { overridePriceCents: Math.max(0, Math.round(Number(expandedItem.overridePriceCents))) }
          : {}),
      })
        .then((r) => r.json())
        .then((data) => {
          if (
            requestSequence !== pricingRequestSequenceRef.current ||
            currentPricingFingerprintRef.current !== pricingFingerprint
          ) {
            return;
          }
          // Backend returns 'linePrice' in dollars (legacy compatibility)
          const price = Number(data?.linePrice);
          if (!Number.isFinite(price)) return;
          if (expandedKey) {
            const breakdown = data?.breakdown;
            const snapshotSelectedOptions = Array.isArray(breakdown?.selectedOptions) ? breakdown.selectedOptions : undefined;
            const overrideMode = getQuoteLineItemPriceOverrideMode(expandedItem);
            const overrideValueCents = getQuoteLineItemOverrideValueCents(expandedItem, overrideMode);
            const overridePatch = overrideMode && overrideValueCents != null
              ? buildQuoteLineItemOverridePatch({
                  mode: overrideMode,
                  valueCents: overrideValueCents,
                  baseTotalCents: Math.round(price * 100),
                  quantity: qtyNum,
                })
              : null;
            const effectivePrice = overridePatch ? overridePatch.pricing.effectiveTotalCents / 100 : price;
            onUpdateLineItem(expandedKey, {
              linePrice: effectivePrice,
              formulaLinePrice: price,
              ...(overridePatch
                ? {
                    priceOverride: overridePatch.priceOverride,
                    overridePriceCents: overridePatch.pricing.effectiveTotalCents,
                  }
                : {}),
              priceBreakdown:
                breakdown ||
                ({
                  ...(expandedItem.priceBreakdown || {}),
                  basePrice: price,
                  total: effectivePrice,
                } as any),
              ...(snapshotSelectedOptions ? { selectedOptions: snapshotSelectedOptions } : {}),
              // Store PBV2 snapshot from /calculate for future reference
              ...(data?.pbv2SnapshotJson ? { pbv2SnapshotJson: data.pbv2SnapshotJson } : {}),
            });
          }
        })
        .catch((err: any) => {
          if (
            requestSequence !== pricingRequestSequenceRef.current ||
            currentPricingFingerprintRef.current !== pricingFingerprint
          ) {
            return;
          }
          if (isSessionExpiredError(err)) {
            setCalcError(SESSION_EXPIRED_MESSAGE);
            notifySessionExpired("quote-line-price-preview");
            return;
          }
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
        .finally(() => {
          if (
            requestSequence === pricingRequestSequenceRef.current &&
            currentPricingFingerprintRef.current === pricingFingerprint
          ) {
            setIsCalculating(false);
          }
        });
    },
    [
      pricingFingerprint,
      isExpandedTreeV2,
      optionsV2Valid,
      expandedSkipsPrintOptionValidation,
      expandedKey,
      customerId,
      quoteId,
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {displayLineItems
                  .filter((li) => li.status !== "canceled")
                  .map((item, itemIndex) => {
                    const itemKey = getItemKey(item);
                    const isExpanded = !!itemKey && expandedKey === itemKey;
                    const contentId = itemKey ? `line-item-${itemKey}-details` : undefined;
                    const product = getProduct(products, item.productId);
                    const fulfillmentOnly = (product as any)?.workflowIntent === "fulfillment_only";
                    const serviceFee = skipsRequiredPrintOptionValidation(product);
                    
                    // Generic option summary (no hardcoded keys)
                    const { chips: optionChips, overflowCount } = extractOptionChips(item.selectedOptions, 3);
                    
                    // Meta indicators (best effort with existing fields)
                    const hasNote = !!(item.notes || (item.specsJson as any)?.notes);
                    const overrideUiState = resolveQuoteLineItemOverrideUiState(item, priceOverrideModeByKey[itemKey] ?? null);
                    const persistedOverrideMode = overrideUiState.persistedOverrideMode;
                    const hasOverride = overrideUiState.hasOverride;
                    const selectedOverrideMode = overrideUiState.selectedOverrideMode;
                    const activeOrDraftOverrideMode = selectedOverrideMode ?? "override_total_after_margin";
                    const overrideLabel = getLineItemPriceOverrideLabel(persistedOverrideMode ?? selectedOverrideMode);
                    const baseCalculatedTotalCents = getQuoteLineItemBaseTotalCents(item);
                    const baseCalculatedTotal = baseCalculatedTotalCents / 100;
                    const overrideValueCents = overrideUiState.overrideValueCents;
                    const visiblePrice = deriveVisibleLineItemPriceDisplay({
                      lineItem: item as any,
                      aggregateTotalCents: baseCalculatedTotalCents > 0 ? baseCalculatedTotalCents : null,
                      attachmentState: item.pendingAttachments?.length ? "attachment_uploading" : item.id ? "attachment_attached_or_saved" : "temp",
                      source: "QuoteLineItemsSection.visible",
                    });
                    const editorPriceValue = overrideValueCents != null ? overrideValueCents / 100 : visiblePrice.displayTotal;
                    const hasProductionNotes = !!(item.productionNotes && item.productionNotes.trim());
                    const childCount = item.id ? lineItems.filter((candidate) => candidate.parentLineItemId === item.id).length : 0;
                    const parentLineNumber = item.parentLineItemId
                      ? displayLineItems.findIndex((candidate) => candidate.id === item.parentLineItemId) + 1
                      : 0;
                    const productRequiresProofApproval = Boolean((product as any)?.requiresProofApproval);
                    const renderedRequiresProofApproval = isExpanded
                      ? requiresProofApproval
                      : Boolean((item as any).requiresProofApproval ?? productRequiresProofApproval);
                    const proofApprovalLockEnabled = orgPreferences.proofing?.proofApprovalLockEnabled === true;
                    const handlePriceOverrideModeChange = async (selectedValue: string) => {
                      const previousOverrideCents =
                        hasOverride && typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents)
                          ? item.overridePriceCents
                          : null;
                      if (selectedValue === "__none") {
                        setPriceOverrideModeByKey((prev) => {
                          const next = { ...prev };
                          delete next[itemKey];
                          return next;
                        });
                        setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: baseCalculatedTotal.toFixed(2) }));
                        await refreshQuotePricingAfterOverrideChange({
                          item,
                          itemKey,
                          nextOverrideCents: null,
                          priceOverrideMode: null,
                          priceOverrideValueCents: null,
                          previousOverrideCents,
                        });
                        return;
                      }

                      const nextMode = selectedValue as LineItemPriceOverrideMode;
                      setPriceOverrideModeByKey((prev) => ({ ...prev, [itemKey]: nextMode }));
                      const rawValue = priceEditTextByKey[itemKey] ?? editorPriceValue.toFixed(2);
                      const nextOverride = resolveQuoteLineItemOverrideModeChange({
                        baseCalculatedTotalCents,
                        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
                        mode: nextMode,
                        rawValue,
                        fallbackValueCents: Math.round(editorPriceValue * 100),
                      });

                      if (!nextOverride) {
                        setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: editorPriceValue.toFixed(2) }));
                        return;
                      }

                      setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: nextOverride.displayText }));
                      await refreshQuotePricingAfterOverrideChange({
                        item,
                        itemKey,
                        nextOverrideCents: nextOverride.pricing.effectiveTotalCents,
                        priceOverrideMode: nextMode,
                        priceOverrideValueCents: nextOverride.valueCents,
                        previousOverrideCents,
                      });
                    };

                    return (
                      <SortableLineItemWrapper key={itemKey} id={itemKey}>
                        {({ dragAttributes, dragListeners }) => (
                          <LineItemCard
                            id={item.id || ""}
                            itemKey={itemKey}
                            contentId={contentId || ""}
                            isExpanded={isExpanded}
                            onToggleExpand={() => onExpandedKeyChange(isExpanded ? null : itemKey)}
                            title={item.productName}
                            sizeLabel={formatLineItemMeasurementLabel(product, item.width, item.height)}
                            qtyLabel={`Qty ${item.quantity}`}
                            unitPriceLabel={`${formatMoney(visiblePrice.displayPerEach)}/ea`}
                            totalLabel={formatMoney(visiblePrice.displayTotal)}
                            badges={{
                              draft: item.status === "draft" && !readOnly,
                              override: hasOverride,
                              internal: hasProductionNotes,
                            }}
                            summaryFooter={item.parentLineItemId ? (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">Child item · Runs with Line {parentLineNumber || "parent"}</Badge>
                            ) : childCount > 0 ? (
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Group · {childCount} child {childCount === 1 ? "item" : "items"}</Badge>
                            ) : undefined}
                            containerClassName={item.parentLineItemId ? "ml-5 border-l-2 border-l-muted-foreground/30" : undefined}
                            descriptionPreview={item.description}
                            optionChips={optionChips.map((chip, idx) => ({ text: chip, key: `${itemKey}-chip-${idx}` }))}
                            overflowCount={overflowCount}
                            thumbnail={<LineItemThumbnail parentId={quoteId} lineItemId={item.id} parentType="quote" />}
                            dragHandleProps={{
                              attributes: dragAttributes,
                              listeners: dragListeners,
                              disabled: isSavingOrder,
                            }}
                            showDragHandle={!readOnly}
                            width={widthText}
                            height={heightText}
                            quantity={qty}
                            onWidthChange={setWidthText}
                            onHeightChange={setHeightText}
                            onQuantityChange={setQty}
                            onQuantityIncrement={() => setQty((q) => (q || 1) + 1)}
                            onQuantityDecrement={() => setQty((q) => Math.max(1, (q || 1) - 1))}
                            dimsRequired={dimsRequired}
                            price={visiblePrice.displayTotal}
                            priceOverride={hasOverride ? visiblePrice.displayTotal : null}
                            priceOverrideLabel={overrideLabel}
                            editingPrice={editingPriceItemKey === itemKey}
                            priceEditText={
                              priceEditTextByKey[itemKey] ??
                              (editorPriceValue || 0).toFixed(2)
                            }
                            onPriceClick={
                              readOnly
                                ? undefined
                                : () => {
                                    setEditingPriceItemKey(itemKey);
                                    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: editorPriceValue.toFixed(2) }));
                                  }
                            }
                            onPriceChange={
                              readOnly
                                ? undefined
                                : (value) => {
                                    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: value }));
                                  }
                            }
                            onPriceBlur={
                              readOnly
                                ? undefined
                                : async () => {
                                    const currentDisplay = editorPriceValue;
                                    const rawValue = priceEditTextByKey[itemKey] ?? currentDisplay.toFixed(2);
                                    const parsed = Number.parseFloat(rawValue);
                                    if (!Number.isFinite(parsed) || parsed < 0) {
                                      setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentDisplay.toFixed(2) }));
                                      setEditingPriceItemKey((prev) => (prev === itemKey ? null : prev));
                                      return;
                                    }

                                    const newCents = Math.round(parsed * 100);
                                    const previousOverrideCents =
                                      hasOverride && typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents)
                                        ? item.overridePriceCents
                                        : null;
                                    const formulaCents = baseCalculatedTotalCents;
                                    const mode = activeOrDraftOverrideMode;
                                    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
                                    const nextValueCents = newCents;
                                    const nextPricing = applyLineItemEditPriceOverride({
                                      baseCalculatedTotalCents: formulaCents,
                                      quantity,
                                      mode,
                                      valueCents: nextValueCents,
                                    });
                                    const nextEffectiveCents = nextPricing.effectiveTotalCents;

                                    try {
                                      if (nextEffectiveCents !== formulaCents || mode !== "override_total_after_margin") {
                                        if (previousOverrideCents === nextEffectiveCents && persistedOverrideMode === mode) {
                                          setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: (newCents / 100).toFixed(2) }));
                                          return;
                                        }
                                        await refreshQuotePricingAfterOverrideChange({
                                          item,
                                          itemKey,
                                          nextOverrideCents: nextEffectiveCents,
                                          priceOverrideMode: mode,
                                          priceOverrideValueCents: nextValueCents,
                                          previousOverrideCents,
                                        });
                                        setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: (newCents / 100).toFixed(2) }));
                                      } else if (previousOverrideCents !== null) {
                                        await refreshQuotePricingAfterOverrideChange({
                                          item,
                                          itemKey,
                                          nextOverrideCents: null,
                                          priceOverrideMode: null,
                                          priceOverrideValueCents: null,
                                          previousOverrideCents,
                                        });
                                        setPriceOverrideModeByKey((prev) => {
                                          const next = { ...prev };
                                          delete next[itemKey];
                                          return next;
                                        });
                                        setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: (formulaCents / 100).toFixed(2) }));
                                      }
                                    } finally {
                                      setEditingPriceItemKey((prev) => (prev === itemKey ? null : prev));
                                    }
                                  }
                            }
                            onPriceKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.currentTarget as HTMLInputElement).blur();
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingPriceItemKey((prev) => (prev === itemKey ? null : prev));
                                setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: editorPriceValue.toFixed(2) }));
                              }
                            }}
                            onUndoOverride={
                              readOnly || !hasOverride
                                ? undefined
                                : async () => {
                                    const previousOverrideCents =
                                      hasOverride && typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents)
                                        ? item.overridePriceCents
                                        : null;
                                    await refreshQuotePricingAfterOverrideChange({
                                      item,
                                      itemKey,
                                      nextOverrideCents: null,
                                      priceOverrideMode: null,
                                      priceOverrideValueCents: null,
                                      previousOverrideCents,
                                    });
                                    setPriceOverrideModeByKey((prev) => {
                                      const next = { ...prev };
                                      delete next[itemKey];
                                      return next;
                                    });
                                    const currentFormula = Number(item.formulaLinePrice ?? item.linePrice ?? 0) || 0;
                                    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentFormula.toFixed(2) }));
                                  }
                            }
                            isCalculating={isCalculating}
                            calcError={calcError}
                            fulfillmentOnly={fulfillmentOnly}
                            serviceFee={serviceFee}
                            quantityOnly={(product as any)?.measurementMode === "quantity_only"}
                            description={description}
                            productionNotes={productionNotes}
                            onDescriptionChange={setDescription}
                            onProductionNotesChange={setProductionNotes}
                            requiresDesign={requiresDesign}
                            requiresPrepress={requiresPrepress}
                            requiresProofApproval={renderedRequiresProofApproval}
                            proofApprovalRequiredByDefault={productRequiresProofApproval}
                            proofApprovalLockEnabled={proofApprovalLockEnabled}
                            onRequiresDesignChange={handleRequiresDesignChange}
                            onRequiresPrepressChange={handleRequiresPrepressChange}
                            onRequiresProofApprovalChange={handleRequiresProofApprovalChange}
                            widthInputRef={(node) => {
                              widthInputRefs.current[itemKey] = node;
                            }}
                            priceControlSlot={
                              isExpanded ? (
                                <div>
                                  <select
                                    aria-label="Price override mode"
                                    value={overrideUiState.selectValue}
                                    onChange={(event) => void handlePriceOverrideModeChange(event.target.value)}
                                    className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    disabled={readOnly}
                                  >
                                    <option value="__none">No override</option>
                                    <option value="override_total_after_margin">Total override</option>
                                    <option value="override_unit_after_margin">Unit override</option>
                                    <option value="override_total_before_margin">Total before margin</option>
                                    <option value="override_unit_before_margin">Unit before margin</option>
                                    <option value="apply_discount">Discount</option>
                                    <option value="append_value">Add value</option>
                                  </select>
                                  <div className="hidden">
                                    Calculated {formatMoney(baseCalculatedTotal)} · Effective {formatMoney(visiblePrice.displayTotal)}
                                  </div>
                                </div>
                              ) : undefined
                            }
                            optionsSlot={
                              <>
                                {isExpandedTreeV2 && expandedOptionTreeJson ? (
                                  <ProductOptionsPanelV2
                                    tree={expandedOptionTreeJson}
                                    selections={optionSelectionsV2}
                                    onSelectionsChange={handleOptionSelectionsV2Change}
                                    onValidityChange={handleOptionsV2ValidityChange}
                                  />
                                ) : (
                                  <ProductOptionsPanel
                                    product={expandedProduct}
                                    productOptions={expandedProductOptions}
                                    optionSelections={optionSelections}
                                    onOptionSelectionsChange={setOptionSelections}
                                  />
                                )}
                              </>
                            }
                            artworkSlot={
                              !fulfillmentOnly || Boolean((item as any).requiresDesign || (item as any).requiresPrepress || (item as any).requiresProofApproval) ? (
                              <div className={cn("rounded-md border border-border/40 p-3", !readOnly && "bg-muted/20")}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">Artwork</div>
                                </div>
                                <LineItemAttachmentsPanel
                                  quoteId={quoteId}
                                  parentType={createTarget === "order" ? "order" : "quote"}
                                  orderId={null}
                                  lineItemId={item.id}
                                  productName={item.productName}
                                  lineQuantity={item.quantity}
                                  defaultExpanded={true}
                                  ensureQuoteId={createTarget === "order" ? undefined : (!readOnly ? ensureQuoteId : undefined)}
                                  ensureLineItemId={createTarget === "order" ? undefined : (!readOnly && ensureLineItemId ? () => {
                                    setPendingScrollPosition(window.scrollY);
                                    setPendingExpandedLineItemId(itemKey, itemIndex);
                                    return ensureLineItemId(itemKey);
                                  } : undefined)}
                                  pendingOrderAttachments={item.pendingOrderAttachments}
                                  onTemporaryOrderUpload={
                                    !readOnly && createTarget === "order"
                                      ? (files) => uploadTemporaryOrderAttachments(itemKey, files)
                                      : undefined
                                  }
                                  onTemporaryOrderAttachmentRemove={
                                    !readOnly && createTarget === "order"
                                      ? (uploadId) => removeTemporaryOrderAttachment(itemKey, uploadId)
                                      : undefined
                                  }
                                  onTemporaryOrderAttachmentUpdate={
                                    !readOnly && createTarget === "order"
                                      ? (uploadId, patch) => {
                                        const pendingOrderAttachments = reconcileStagedArtworkAllocations({
                                          lineQuantity: item.quantity,
                                          attachments: ((item.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
                                            .map((attachment) => attachment.uploadId === uploadId ? { ...attachment, ...patch } : attachment),
                                        });
                                        onUpdateLineItem(itemKey, { pendingOrderAttachments });
                                      }
                                      : undefined
                                  }
                                  onTemporaryOrderArtworkSetUpdate={
                                    !readOnly && createTarget === "order"
                                      ? (uploadIds, patch) => {
                                        const selected = new Set(uploadIds);
                                        const pendingOrderAttachments = reconcileStagedArtworkAllocations({
                                          lineQuantity: item.quantity,
                                          attachments: ((item.pendingOrderAttachments as TemporaryOrderAttachmentUpload[] | undefined) ?? [])
                                            .map((attachment) => selected.has(attachment.uploadId) ? { ...attachment, ...patch } : attachment),
                                        });
                                        onUpdateLineItem(itemKey, { pendingOrderAttachments });
                                      }
                                      : undefined
                                  }
                                  lineItemKey={itemKey}
                                />
                              </div>
                              ) : null
                            }
                            detailsSide="right"
                            isDirty={isDirty}
                            isSaving={savingItemKey === itemKey}
                            isSaved={!isDirty && savedItemKey === itemKey}
                            onSave={onSaveLineItem ? handleSaveItem : undefined}
                            onDuplicate={() => onDuplicateLineItem(itemKey)}
                            onRemove={() => onRemoveLineItem(itemKey)}
                            relationshipActionsSlot={!quoteId || !item.id ? undefined : item.parentLineItemId ? (
                              <>
                                <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8" onClick={() => openParentLinkDialog(item)} disabled={isSavingParentLink} data-testid={`button-link-parent-${item.id}`}>
                                  Change parent
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8" onClick={() => void updateParentRelationship(item, null)} disabled={isSavingParentLink} data-testid={`button-unlink-parent-${item.id}`}>
                                  Unlink
                                </Button>
                              </>
                            ) : childCount === 0 ? (
                              <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8" onClick={() => openParentLinkDialog(item)} disabled={isSavingParentLink} data-testid={`button-link-parent-${item.id}`}>
                                Link to parent
                              </Button>
                            ) : undefined}
                            readOnly={readOnly}
                          />
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
                            if (k) {
                              pendingScrollToItemKeyRef.current = k;
                              onExpandedKeyChange(k);
                            }
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
      <Dialog open={parentLinkTarget !== null} onOpenChange={(open) => { if (!open && !isSavingParentLink) setParentLinkTargetKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{parentLinkTarget?.parentLineItemId ? "Change parent line item" : "Link line item to parent"}</DialogTitle>
            <DialogDescription>Select an eligible line item in this quote. The item keeps its price, files, and identity.</DialogDescription>
          </DialogHeader>
          <select
            aria-label="Parent line item"
            value={selectedParentLineItemId}
            onChange={(event) => setSelectedParentLineItemId(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a parent line item</option>
            {eligibleParentLineItems.map((candidate, index) => (
              <option key={candidate.id} value={candidate.id}>Line {index + 1}: {candidate.productName}</option>
            ))}
          </select>
          {parentLinkError ? <p className="text-sm text-destructive">{parentLinkError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setParentLinkTargetKey(null)} disabled={isSavingParentLink}>Cancel</Button>
            <Button disabled={!parentLinkTarget || !selectedParentLineItemId || isSavingParentLink} onClick={() => parentLinkTarget && void updateParentRelationship(parentLinkTarget, selectedParentLineItemId)}>
              {isSavingParentLink ? "Saving..." : "Save parent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


