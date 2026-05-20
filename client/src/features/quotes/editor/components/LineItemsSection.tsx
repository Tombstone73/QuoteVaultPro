import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { ProductOptionsPanelV2 } from "./ProductOptionsPanelV2";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { setPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { buildPbv2DefaultSelections } from "@shared/pbv2OrderEntryRuntime";
import { LineItemCard } from "@/components/line-items/LineItemCard";

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

/**
 * Check if dimensions are required for a PBV2 product tree.
 * Reads from tree.meta?.requiresDimensions if available, otherwise falls back to product-level logic.
 */
function requiresDimensionsV2(product: Product | null, treeJson: OptionTreeV2 | null): boolean {
  // Priority 1: PBV2 tree meta (if present)
  if (treeJson?.meta?.requiresDimensions !== undefined) {
    return treeJson.meta.requiresDimensions;
  }
  // Priority 2: Product-level logic
  return requiresDimensions(product);
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
}: LineItemsSectionProps) {
  const queryClient = useQueryClient();
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
  const [description, setDescription] = useState<string>("");
  const [productionNotes, setProductionNotes] = useState<string>("");
  // Canonical routing intent (migration 0015)
  const [requiresDesign, setRequiresDesign] = useState<boolean>(false);
  const [requiresPrepress, setRequiresPrepress] = useState<boolean | null>(null);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [savingItemKey, setSavingItemKey] = useState<string | null>(null);
  const [savedItemKey, setSavedItemKey] = useState<string | null>(null);
  const [editingPriceItemKey, setEditingPriceItemKey] = useState<string | null>(null);
  const [priceEditTextByKey, setPriceEditTextByKey] = useState<Record<string, string>>({});
  
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
    setDescription(expandedItem.description || "");
    setProductionNotes(expandedItem.productionNotes || "");
    // Rehydrate routing intent from quote line item (migration 0015)
    // Fall back to product-level defaults for new draft items (requiresDesign/requiresPrepress not yet persisted)
    const itemRequiresDesign = (expandedItem as any).requiresDesign;
    const productRequiresDesign = (expandedProduct as any)?.requiresDesign;
    setRequiresDesign(
      itemRequiresDesign === true ||
      (itemRequiresDesign === undefined && productRequiresDesign === true)
    );
    const itemRequiresPrepress = (expandedItem as any).requiresPrepress;
    const productRequiresPrepress = (expandedProduct as any)?.requiresPrepress;
    setRequiresPrepress(
      typeof itemRequiresPrepress === 'boolean'
        ? itemRequiresPrepress
        : typeof productRequiresPrepress === 'boolean'
          ? productRequiresPrepress
          : null
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

    // Initialize price edit text from override or calculated price
    const displayPrice = expandedItem.overridePriceCents != null 
      ? expandedItem.overridePriceCents / 100 
      : (expandedItem.linePrice || 0);
    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: displayPrice.toFixed(2) }));
    setEditingPriceItemKey(null);

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
  }, [
    expandedItem?.id,
    expandedItem?.tempId,
    expandedProduct?.id,
    expandedProduct?.name,
    (expandedProduct as any)?.requiresDesign,
    (expandedProduct as any)?.requiresPrepress,
    (expandedProduct as any)?.requiresProofApproval,
    (expandedProduct as any)?.requiresProductionJob,
  ]);

  const dimsRequired = requiresDimensionsV2(expandedProduct, expandedOptionTreeJson);
  const widthNum = dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;

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
    if (isExpandedTreeV2 && !optionsV2Valid) {
      setCalcError("Complete required product options before saving.");
      return;
    }
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

  const refreshQuotePricingAfterOverrideChange = async ({
    item,
    itemKey,
    nextOverrideCents,
    previousOverrideCents,
  }: {
    item: QuoteLineItemDraft;
    itemKey: string;
    nextOverrideCents: number | null;
    previousOverrideCents: number | null;
  }) => {
    if (nextOverrideCents === previousOverrideCents) return;

    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const width = Number(item.width) > 0 ? Number(item.width) : 1;
    const height = Number(item.height) > 0 ? Number(item.height) : 1;
    const optionSelectionsJson = (item as any)?.optionSelectionsJson;
    const isTreeV2 = Boolean(optionSelectionsJson && typeof optionSelectionsJson === "object" && optionSelectionsJson.schemaVersion === 2);

    let formulaPrice = Number(item.formulaLinePrice ?? item.linePrice ?? 0) || 0;
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
    } catch {
      // Keep current formula fallback
    }

    const effectiveLinePrice =
      typeof nextOverrideCents === "number" && Number.isFinite(nextOverrideCents)
        ? nextOverrideCents / 100
        : formulaPrice;

    onUpdateLineItem(itemKey, {
      formulaLinePrice: formulaPrice,
      linePrice: effectiveLinePrice,
      overridePriceCents: nextOverrideCents,
      overrideAt: nextOverrideCents == null ? null : new Date().toISOString(),
      overrideByUserId: null,
      overrideReason: null,
    });

    if (onSaveLineItem) {
      await onSaveLineItem(itemKey);
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
      ...(v2Patch as any),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, widthNum, heightNum, qtyNum, notes, description, productionNotes, requiresDesign, requiresPrepress, isExpandedTreeV2, optionSelectionsV2]);

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
                    const hasOverride = typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents);
                    const hasProductionNotes = !!(item.productionNotes && item.productionNotes.trim());
                    const requiresProofApproval = Boolean((product as any)?.requiresProofApproval ?? (item as any).requiresProofApproval);

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
                            sizeLabel={`${item.width}" × ${item.height}"`}
                            qtyLabel={`Qty ${item.quantity}`}
                            unitPriceLabel={`${formatMoney(item.linePrice / item.quantity)}/ea`}
                            totalLabel={formatMoney(item.linePrice)}
                            badges={{
                              draft: item.status === "draft" && !readOnly,
                              override: hasOverride,
                              internal: hasProductionNotes,
                            }}
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
                            price={item.linePrice}
                            priceOverride={item.overridePriceCents != null ? item.overridePriceCents / 100 : null}
                            editingPrice={editingPriceItemKey === itemKey}
                            priceEditText={
                              priceEditTextByKey[itemKey] ??
                              ((item.overridePriceCents != null ? item.overridePriceCents / 100 : item.linePrice) || 0).toFixed(2)
                            }
                            onPriceClick={
                              readOnly
                                ? undefined
                                : () => {
                                    const currentPrice = item.overridePriceCents != null
                                      ? item.overridePriceCents / 100
                                      : item.linePrice;
                                    setEditingPriceItemKey(itemKey);
                                    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentPrice.toFixed(2) }));
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
                                    const currentDisplay = item.overridePriceCents != null
                                      ? item.overridePriceCents / 100
                                      : item.linePrice;
                                    const rawValue = priceEditTextByKey[itemKey] ?? currentDisplay.toFixed(2);
                                    const parsed = Number.parseFloat(rawValue);
                                    if (!Number.isFinite(parsed) || parsed < 0) {
                                      setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentDisplay.toFixed(2) }));
                                      setEditingPriceItemKey((prev) => (prev === itemKey ? null : prev));
                                      return;
                                    }

                                    const newCents = Math.round(parsed * 100);
                                    const previousOverrideCents =
                                      typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents)
                                        ? item.overridePriceCents
                                        : null;
                                    const formulaCents = Math.round((item.formulaLinePrice ?? item.linePrice ?? 0) * 100);

                                    try {
                                      if (newCents !== formulaCents) {
                                        if (previousOverrideCents === newCents) {
                                          setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: (newCents / 100).toFixed(2) }));
                                          return;
                                        }
                                        await refreshQuotePricingAfterOverrideChange({
                                          item,
                                          itemKey,
                                          nextOverrideCents: newCents,
                                          previousOverrideCents,
                                        });
                                        setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: (newCents / 100).toFixed(2) }));
                                      } else if (previousOverrideCents !== null) {
                                        await refreshQuotePricingAfterOverrideChange({
                                          item,
                                          itemKey,
                                          nextOverrideCents: null,
                                          previousOverrideCents,
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
                                const currentPrice = item.overridePriceCents != null 
                                  ? item.overridePriceCents / 100 
                                  : item.linePrice;
                                setEditingPriceItemKey((prev) => (prev === itemKey ? null : prev));
                                setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentPrice.toFixed(2) }));
                              }
                            }}
                            onUndoOverride={
                              readOnly || item.overridePriceCents == null
                                ? undefined
                                : async () => {
                                    const previousOverrideCents =
                                      typeof item.overridePriceCents === "number" && Number.isFinite(item.overridePriceCents)
                                        ? item.overridePriceCents
                                        : null;
                                    await refreshQuotePricingAfterOverrideChange({
                                      item,
                                      itemKey,
                                      nextOverrideCents: null,
                                      previousOverrideCents,
                                    });
                                    const currentFormula = Number(item.formulaLinePrice ?? item.linePrice ?? 0) || 0;
                                    setPriceEditTextByKey((prev) => ({ ...prev, [itemKey]: currentFormula.toFixed(2) }));
                                  }
                            }
                            isCalculating={isCalculating}
                            calcError={calcError}
                            description={description}
                            productionNotes={productionNotes}
                            onDescriptionChange={setDescription}
                            onProductionNotesChange={setProductionNotes}
                            requiresDesign={requiresDesign}
                            requiresPrepress={requiresPrepress}
                            requiresProofApproval={requiresProofApproval}
                            onRequiresDesignChange={handleRequiresDesignChange}
                            onRequiresPrepressChange={handleRequiresPrepressChange}
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
                                    setPendingScrollPosition(window.scrollY);
                                    setPendingExpandedLineItemId(itemKey, itemIndex);
                                    return ensureLineItemId(itemKey);
                                  } : undefined}
                                  lineItemKey={itemKey}
                                />
                              </div>
                            }
                            detailsSide="right"
                            isDirty={isDirty}
                            isSaving={savingItemKey === itemKey}
                            isSaved={!isDirty && savedItemKey === itemKey}
                            onSave={onSaveLineItem ? handleSaveItem : undefined}
                            onDuplicate={() => onDuplicateLineItem(itemKey)}
                            onRemove={() => onRemoveLineItem(itemKey)}
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


