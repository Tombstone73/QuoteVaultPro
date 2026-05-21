import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
import { ProductOptionsPanelV2, type ProductOptionsPanelV2RenderStats } from "@/features/quotes/editor/components/ProductOptionsPanelV2";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { validateOptionTreeV2 } from "@shared/optionTreeV2";
import { resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";
import { getPbv2Tree, isPbv2Product, isPbv2QuestionNode, normalizePbv2Tree, summarizePbv2Tree } from "@/lib/pbv2Utils";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { deriveLineItemPricingDisplay } from "@/components/orders/lineItemPricingDisplay";
import { buildQuoteCalculatePayload } from "@/components/orders/quoteCalculatePayload";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCreateOrderLineItem, useDeleteOrderLineItem, useTransitionLineItemWorkflow, useUpdateOrderLineItem } from "@/hooks/useOrders";
import { useOrderFiles } from "@/hooks/useOrderFiles";
import type { OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useOrderLineItemPreviews } from "@/hooks/useOrderLineItemPreviews";
import { useScheduleOrderLineItemsForProduction } from "@/hooks/useProduction";
import { buildProofingLineItemPath, shouldOfferProofingNavigation } from "@/lib/proofingNavigation";
import { getLineItemProofBadgeClass } from "@/lib/orderProofUi";

import { computePbv2InputSignature, pickPbv2EnvExtras } from "@shared/pbv2/pbv2InputSignature";
import { LineItemCard } from "@/components/line-items/LineItemCard";
import {
  buildPbv2DefaultsHydrationKey,
  hasPbv2Selections,
  shouldHydratePbv2Defaults,
} from "@shared/pbv2OrderEntryRuntime";
import {
  buildInitialOrderLineItemDraftFromProduct,
  type InitialOrderLineItemDraftDebug,
} from "@shared/orderLineItemInitialization";

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

function getPbv2SnapshotFromLineItem(lineItem: any): any | null {
  if (!lineItem || typeof lineItem !== "object") return null;
  return (lineItem as any).pbv2SnapshotJson ?? (lineItem as any).pbv2_snapshot_json ?? null;
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

function buildOptionSelectionsRecordFromSpecs(specsJson: any): Record<string, OptionSelection> {
  const selections: Record<string, OptionSelection> = {};
  const selectedOptions = specsJson?.selectedOptions;
  if (!Array.isArray(selectedOptions)) return selections;

  for (const opt of selectedOptions) {
    if (!opt?.optionId) continue;
    selections[String(opt.optionId)] = {
      value: opt.value,
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

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

const WORKFLOW_LABELS: Record<string, string> = {
  new: "New",
  needs_design: "Needs Design",
  in_design: "In Design",
  ready_for_prepress: "Ready for Prepress",
  in_prepress: "In Prepress",
  ready_for_production: "Ready for Production",
  in_production: "In Production",
  completed: "Completed",
  on_hold: "On Hold",
  canceled: "Canceled",
};

function workflowBadgeVariant(state: string | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (state === "completed") return "default";
  if (state === "canceled") return "destructive";
  if (state === "on_hold") return "secondary";
  if (state === "in_design" || state === "in_prepress" || state === "in_production") return "default";
  return "outline";
}

function getInitialWorkflowStateForFlags(requiresDesign: boolean, requiresPrepress: boolean): string {
  if (requiresDesign) return "needs_design";
  if (requiresPrepress) return "ready_for_prepress";
  return "ready_for_production";
}

function getWorkflowActions(state: string | undefined) {
  switch (state) {
    case "new":
      return [
        { label: "Send to Design", toState: "needs_design" as const },
        { label: "Send to Prepress", toState: "ready_for_prepress" as const },
      ];
    case "needs_design":
      return [
        { label: "Start Design", toState: "in_design" as const },
        { label: "Hold", toState: "on_hold" as const },
        { label: "Cancel", toState: "canceled" as const },
      ];
    case "in_design":
      return [
        { label: "Back to Needs Design", toState: "needs_design" as const },
        { label: "Complete Design", action: "complete-design" as const },
        { label: "Hold", toState: "on_hold" as const },
      ];
    case "ready_for_prepress":
      return [
        { label: "Start Prepress", toState: "in_prepress" as const },
        { label: "Send to Production", toState: "ready_for_production" as const },
        { label: "Hold", toState: "on_hold" as const },
      ];
    case "in_prepress":
      return [
        { label: "Send to Production", toState: "ready_for_production" as const },
        { label: "Back to Design", toState: "in_design" as const },
        { label: "Back to Needs Design", toState: "needs_design" as const },
      ];
    case "ready_for_production":
      return [
        { label: "Start Production", toState: "in_production" as const },
        { label: "Return to Prepress", toState: "in_prepress" as const },
        { label: "Hold", toState: "on_hold" as const },
      ];
    case "in_production":
      return [
        { label: "Complete", toState: "completed" as const },
        { label: "Return to Prepress", toState: "in_prepress" as const },
        { label: "Hold", toState: "on_hold" as const },
      ];
    case "on_hold":
      return [];
    default:
      return [];
  }
}

function getOperationalNextStep(state: string | undefined, hasActiveOwner: boolean): string {
  switch (state) {
    case "new":
      return "Review routing";
    case "needs_design":
      return "Start design";
    case "in_design":
      return "Finish design";
    case "ready_for_prepress":
      return "Start prepress";
    case "in_prepress":
      return "Finish prepress";
    case "ready_for_production":
      return hasActiveOwner ? "Production scheduled" : "Send to production";
    case "in_production":
      return "Production in progress";
    case "completed":
      return "None";
    case "on_hold":
      return "Review hold";
    case "canceled":
      return "None";
    default:
      return "Review item";
  }
}

function needsOperationalAction(state: string | undefined): boolean {
  return ["new", "needs_design", "ready_for_prepress", "ready_for_production", "on_hold"].includes(String(state || "new"));
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

type LineItemDesignBriefStatus = "not_required" | "required_missing" | "captured";

type LineItemDesignBriefDraft = {
  keyInstructions: string;
  designObjective: string;
  requestedContent: string;
  layoutNotes: string;
  brandStyleNotes: string;
  referenceNotes: string;
  priorityNotes: string;
};

type LineItemDesignBriefDetail = LineItemDesignBriefDraft & {
  id: string | null;
  orderId: string;
  orderLineItemId: string;
  effectiveRequiresDesign: boolean;
  designBriefRequired: boolean;
  status: LineItemDesignBriefStatus;
  createdAt: string | null;
  updatedAt: string | null;
};

type LineItemScopedNote = {
  id: string;
  orderId: string;
  lineItemId: string;
  category: "internal" | "design_working";
  noteText: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: string;
};

const EMPTY_DESIGN_BRIEF_DRAFT: LineItemDesignBriefDraft = {
  keyInstructions: "",
  designObjective: "",
  requestedContent: "",
  layoutNotes: "",
  brandStyleNotes: "",
  referenceNotes: "",
  priorityNotes: "",
};

const DESIGN_BRIEF_STATUS_LABELS: Record<LineItemDesignBriefStatus, string> = {
  not_required: "Not required",
  required_missing: "Required missing",
  captured: "Captured",
};

// Lets Radix focus restoration and expansion reflow finish before the fallback scroll/focus pass.
const LAYOUT_STABILIZATION_DELAY_MS = 80;

type OrderLineItemWithPbv2Runtime = OrderLineItem & {
  pbv2ActiveTreeVersionId?: string | null;
  pbv2TreeVersionId?: string | null;
};

type ProductWithPbv2Runtime = Product & {
  pbv2ActiveTreeVersionId?: string | null;
};

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function getOrderLineItemPbv2TreeVersionId({
  product,
  lineItem,
}: {
  product: ProductWithPbv2Runtime | null;
  lineItem: OrderLineItemWithPbv2Runtime | null;
}): string {
  return String(
    product?.pbv2ActiveTreeVersionId
      ?? lineItem?.pbv2ActiveTreeVersionId
      ?? lineItem?.pbv2TreeVersionId
      ?? (getPbv2SnapshotFromLineItem(lineItem)?.treeVersionId as string | undefined)
      ?? ""
  );
}

function toDesignBriefDraft(detail?: Partial<LineItemDesignBriefDetail> | null): LineItemDesignBriefDraft {
  return {
    keyInstructions: detail?.keyInstructions ?? "",
    designObjective: detail?.designObjective ?? "",
    requestedContent: detail?.requestedContent ?? "",
    layoutNotes: detail?.layoutNotes ?? "",
    brandStyleNotes: detail?.brandStyleNotes ?? "",
    referenceNotes: detail?.referenceNotes ?? "",
    priorityNotes: detail?.priorityNotes ?? "",
  };
}

function hasAnyDesignBriefText(draft: LineItemDesignBriefDraft): boolean {
  return Object.values(draft).some((value) => value.trim().length > 0);
}

export function OrderLineItemsSection({
  orderId,
  customerId,
  readOnly,
  lineItems,
  productionFocusLineItemIds = [],
  productionPriorityLineItemIds = [],
  onAfterLineItemsChange,
  onDirtyStateChange,
}: {
  orderId: string;
  customerId?: string | null;
  readOnly: boolean;
  lineItems: OrderLineItem[];
  productionFocusLineItemIds?: string[];
  productionPriorityLineItemIds?: string[];
  onAfterLineItemsChange?: () => Promise<void>;
  /** Reports whether the expanded line item has unsaved edits. */
  onDirtyStateChange?: (hasUnsavedLineItem: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isPlatformAdmin, isPlatformDeveloper } = useAuth();
  const canSeeDebug = isAdmin || isPlatformAdmin || isPlatformDeveloper;
  const [showLineItemDebug, setShowLineItemDebug] = useState(false);

  const [pbv2CurrentSignatureByLineItemId, setPbv2CurrentSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2SnapshotSignatureByLineItemId, setPbv2SnapshotSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2KeepAckByLineItemId, setPbv2KeepAckByLineItemId] = useState<Record<string, string>>({});

  // Production scheduling state
  const [selectedForProduction, setSelectedForProduction] = useState<Set<string>>(new Set());
  const scheduleProduction = useScheduleOrderLineItemsForProduction(orderId);;
  const transitionWorkflow = useTransitionLineItemWorkflow(orderId);

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
    const baseItems = orderedKeys.map((id) => byId.get(id)).filter(Boolean) as OrderLineItem[];

    if (!productionPriorityLineItemIds.length) {
      return baseItems;
    }

    const prioritySet = new Set(productionPriorityLineItemIds.map((id) => String(id)));
    const priorityOrder = new Map(productionPriorityLineItemIds.map((id, index) => [String(id), index] as const));

    return [...baseItems].sort((left, right) => {
      const leftPriority = prioritySet.has(String(left.id));
      const rightPriority = prioritySet.has(String(right.id));
      if (leftPriority && rightPriority) {
        return (priorityOrder.get(String(left.id)) ?? 0) - (priorityOrder.get(String(right.id)) ?? 0);
      }
      if (leftPriority) return -1;
      if (rightPriority) return 1;
      return 0;
    });
  }, [activeLineItems, orderedKeys, productionPriorityLineItemIds]);

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
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [priceEditTextById, setPriceEditTextById] = useState<Record<string, string>>({});

  const [pendingJumpToLineItemId, setPendingJumpToLineItemId] = useState<string | null>(null);
  const lineItemTopAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lineItemWidthInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const setLineItemTopAnchorRef = useCallback(
    (lineItemId: string) => (node: HTMLDivElement | null) => {
      lineItemTopAnchorRefs.current[lineItemId] = node;
    },
    []
  );
  const setLineItemWidthInputRef = useCallback(
    (lineItemId: string) => (node: HTMLInputElement | null) => {
      lineItemWidthInputRefs.current[lineItemId] = node;
    },
    []
  );

  useEffect(() => {
    const liveIds = new Set(lineItems.map((item) => String(item.id)));
    for (const lineItemId of Object.keys(lineItemTopAnchorRefs.current)) {
      if (!liveIds.has(lineItemId)) {
        delete lineItemTopAnchorRefs.current[lineItemId];
        delete lineItemWidthInputRefs.current[lineItemId];
      }
    }
  }, [lineItems]);

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

    // Prefer the live ref, but fall back to DOM lookup during the first render pass
    // when the callback ref may not have been populated yet.
    const el = lineItemTopAnchorRefs.current[pendingJumpToLineItemId]
      ?? document.getElementById(`line-item-top-anchor-${pendingJumpToLineItemId}`)
      ?? document.getElementById(`line-item-${pendingJumpToLineItemId}`);
    // If the new item isn't in the DOM yet (list hasn't re-rendered), do not clear
    // the pending target — the effect will retry once orderedKeys updates and the
    // item appears.
    if (!el) return;

    let raf1 = 0;
    let raf2 = 0;
    let timeoutId = 0;
    const scrollToAnchor = () => {
      el.scrollIntoView({ block: "start", behavior: "auto" });
    };
    const focusTarget = () => {
      const focusEl = lineItemWidthInputRefs.current[pendingJumpToLineItemId]
        ?? (document.getElementById(`line-item-width-input-${pendingJumpToLineItemId}`) as HTMLInputElement | null);
      const target = focusEl && !focusEl.disabled
        ? focusEl
        : document.getElementById(`line-item-${pendingJumpToLineItemId}`) ?? el;
      if ("focus" in target && typeof (target as HTMLElement).focus === "function") {
        (target as HTMLElement).focus({ preventScroll: true });
      }
    };

    blurActiveElement();

    // Double RAF lets Radix/browser focus restoration and expanded layout finish;
    // the timeout is a deterministic fallback for late content height changes.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          scrollToAnchor();
          focusTarget();
          scrollToAnchor();
          timeoutId = window.setTimeout(() => {
            try {
              focusTarget();
              scrollToAnchor();
            } finally {
              setPendingJumpToLineItemId(null);
            }
          }, LAYOUT_STABILIZATION_DELAY_MS);
        } catch {
          setPendingJumpToLineItemId(null);
        }
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timeoutId);
    };
    // orderedKeys changes when a newly-created item is inserted into the list,
    // which triggers a retry if the element wasn't in the DOM on the first run.
  }, [expandedId, pendingJumpToLineItemId, orderedKeys]);

  const [notesDraftById, setNotesDraftById] = useState<Record<string, string>>({});

  const expandedItem = useMemo(
    () => lineItems.find((li) => li.id === expandedId) ?? null,
    [lineItems, expandedId]
  );

  const expandedProduct = useMemo(() => {
    if (!expandedItem) return null;
    return products.find((p) => p.id === expandedItem.productId) ?? null;
  }, [expandedItem, products]);
  const expandedProductPbv2Runtime = expandedProduct as ProductWithPbv2Runtime | null;
  const expandedItemPbv2Runtime = expandedItem as OrderLineItemWithPbv2Runtime | null;

  const expandedProductPbv2TreeDirect = getPbv2Tree(expandedProduct);
  const expandedProductActiveTreeVersionId = expandedProductPbv2Runtime?.pbv2ActiveTreeVersionId ?? null;
  const expandedProductOptionTreeSummary = summarizePbv2Tree((expandedProduct as any)?.optionTreeJson);

  // Fallback: if the product was activated via PBV2 but optionTreeJson is missing,
  // stale, or not renderable, fetch the live active tree from pbv2TreeVersions.
  const needsLivePbv2TreeFetch = isPbv2Product(expandedProduct)
    && (!!expandedProductActiveTreeVersionId || !expandedProductPbv2TreeDirect);
  const {
    data: livePbv2TreeData,
    status: livePbv2TreeStatus,
    fetchStatus: livePbv2TreeFetchStatus,
    isFetching: livePbv2TreeIsFetching,
  } = useQuery({
    queryKey: ["/api/products", expandedProduct?.id, "pbv2/tree", expandedProductActiveTreeVersionId],
    enabled: needsLivePbv2TreeFetch && !!expandedProduct?.id,
    queryFn: async () => {
      const res = await fetch(`/api/products/${expandedProduct!.id}/pbv2/tree`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.data?.active?.treeJson ?? null) as import("@shared/optionTreeV2").OptionTreeV2 | null;
    },
    staleTime: 0,
  });

  const expandedProductPbv2Tree = useMemo(
    () => normalizePbv2Tree(livePbv2TreeData ?? expandedProductPbv2TreeDirect) ?? null,
    [expandedProductPbv2TreeDirect, livePbv2TreeData]
  );

  const expandedProductOptions = useMemo(() => {
    const base = ((expandedProduct as any)?.optionsJson as ProductOptionItem[] | undefined) || [];
    return injectDerivedMaterialOptionIntoProductOptions(expandedProduct, base);
  }, [expandedProduct]);

  const [designBriefDraft, setDesignBriefDraft] = useState<LineItemDesignBriefDraft>(EMPTY_DESIGN_BRIEF_DRAFT);
  const [designBriefSavedAt, setDesignBriefSavedAt] = useState<string | null>(null);
  const designBriefSnapshotRef = useRef<Record<string, LineItemDesignBriefDraft>>({});
  const [lineItemInternalNoteDraft, setLineItemInternalNoteDraft] = useState("");

  const designBriefQuery = useQuery<LineItemDesignBriefDetail>({
    queryKey: ["orders", "lineItemDesignBrief", orderId, expandedItem?.id],
    queryFn: async () => {
      if (!expandedItem?.id) {
        throw new Error("Line item ID is required");
      }

      const response = await fetch(`/api/orders/${orderId}/line-items/${expandedItem.id}/design-brief`, {
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to fetch design brief");
      }

      const data = await response.json();
      return data.data as LineItemDesignBriefDetail;
    },
    enabled: !!expandedItem?.id,
  });

  const saveDesignBrief = useMutation({
    mutationFn: async ({ lineItemId, data }: { lineItemId: string; data: LineItemDesignBriefDraft }) => {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/design-brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to save design brief");
      }

      const payload = await response.json();
      return payload.data as LineItemDesignBriefDetail;
    },
    onSuccess: async (detail) => {
      designBriefSnapshotRef.current[detail.orderLineItemId] = toDesignBriefDraft(detail);
      setDesignBriefSavedAt(detail.orderLineItemId);
      await queryClient.invalidateQueries({ queryKey: ["orders", "lineItemDesignBrief", orderId, detail.orderLineItemId] });
    },
  });

  const lineItemInternalNotesQuery = useQuery<LineItemScopedNote[]>({
    queryKey: ["orders", "lineItemNotes", orderId, expandedItem?.id, "internal"],
    queryFn: async () => {
      if (!expandedItem?.id) {
        throw new Error("Line item ID is required");
      }

      const response = await fetch(`/api/orders/${orderId}/line-items/${expandedItem.id}/notes?category=internal`, {
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to fetch line item internal notes");
      }

      const payload = await response.json();
      return payload.data as LineItemScopedNote[];
    },
    enabled: !!expandedItem?.id,
  });

  const addLineItemInternalNote = useMutation({
    mutationFn: async ({ lineItemId, noteText }: { lineItemId: string; noteText: string }) => {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "internal", noteText }),
        credentials: "include",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to add line item internal note");
      }

      return payload.data as LineItemScopedNote;
    },
    onSuccess: async (_note, variables) => {
      setLineItemInternalNoteDraft("");
      await queryClient.invalidateQueries({ queryKey: ["orders", "lineItemNotes", orderId, variables.lineItemId, "internal"] });
    },
  });

  // PBV2 snapshot from /calculate response (contains treeJson, visibleNodeIds, selections)
  const [pbv2SnapshotJson, setPbv2SnapshotJson] = useState<any>(null);

  // Render PBV2 controls from the product's active tree, not pricing snapshots/results.
  const effectivePbv2Tree = useMemo(
    () => normalizePbv2Tree(expandedProductPbv2Tree) ?? null,
    [expandedProductPbv2Tree]
  );

  const expandedProductIsPbv2 = isPbv2Product(expandedProduct);
  const dimsRequired = requiresDimensions(expandedProduct);

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [requiresDesignInput, setRequiresDesignInput] = useState(false);
  const [requiresPrepressInput, setRequiresPrepressInput] = useState(true);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const [pbv2PanelRenderStats, setPbv2PanelRenderStats] = useState<ProductOptionsPanelV2RenderStats>({
    renderedNodeCount: 0,
    renderedControlCount: 0,
    renderedControlNodeIds: [],
  });
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [computedTotal, setComputedTotal] = useState<number | null>(null);
  // Admin-only live-preview diagnostics (last calculate request/response).
  const [previewDiag, setPreviewDiag] = useState<{
    seq: number;
    payloadQuantity: number;
    payloadSelections: Record<string, unknown>;
    responseTotal: number | null;
    status: "pending" | "ok" | "error";
    at: string;
  } | null>(null);
  // Quantity that `computedTotal` was computed for. Used to derive per-each
  // consistently so a stale total is never divided by a freshly-changed qty.
  const [computedTotalQty, setComputedTotalQty] = useState<number | null>(null);
  // Bumped whenever `savedSnapshotRef` is rewritten. `savedSnapshotRef` is a ref,
  // so mutating it does not re-run the `isDirty` memo on its own — this counter
  // (a memo dep) forces a deterministic recompute after a save so the dirty
  // flag and navigation guard clear without waiting on an incidental refetch.
  const [savedSnapshotVersion, setSavedSnapshotVersion] = useState(0);

  // Dev-only PBV2 diagnostics: surfaces tree shape, node counts, and visibility resolution.
  const pbv2Diagnostics = useMemo(() => {
    const tree = normalizePbv2Tree(effectivePbv2Tree);
    const liveActiveTreeQueryStatus = needsLivePbv2TreeFetch
      ? `${livePbv2TreeStatus}/${livePbv2TreeFetchStatus}${livePbv2TreeIsFetching ? " (fetching)" : ""}`
      : "disabled";

    if (!tree || typeof tree !== "object") {
      return {
        treeOk: false,
        treeErrors: ["effectivePbv2Tree is null"] as string[],
        productId: expandedProduct?.id ?? null,
        productName: (expandedProduct as any)?.name ?? null,
        isPbv2Product: expandedProductIsPbv2,
        optionTreeJsonExists: expandedProductOptionTreeSummary.exists,
        pbv2ActiveTreeVersionId: expandedProductActiveTreeVersionId,
        liveActiveTreeQueryStatus,
        effectivePbv2TreeExists: false,
        totalNodeCount: 0,
        groupCount: 0,
        selectableQuestionCount: 0,
        choiceCount: 0,
        visibleNodeCount: 0,
        renderedControlCount: pbv2PanelRenderStats.renderedControlCount,
        firstQuestionLabels: [] as string[],
        firstQuestionInputTypes: [] as string[],
        firstSelectionKeys: [] as string[],
      };
    }

    const validation = validateOptionTreeV2(tree);
    const nodes = tree.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
    const nodeValues = Object.values(nodes) as any[];
    const summary = summarizePbv2Tree(tree);

    const questionLabels: string[] = [];
    const questionInputTypes: string[] = [];
    const questionSelectionKeys: string[] = [];
    for (const node of nodeValues) {
      if (!isPbv2QuestionNode(node) || !node.input) continue;
      questionLabels.push(String(node.label || node.id || "(unnamed)"));
      questionInputTypes.push(String(node.input?.type || "(none)"));
      const sk = node.input?.selectionKey || node.key || node.id;
      if (typeof sk === "string") questionSelectionKeys.push(sk);
    }

    let visibleNodeIds: string[] = [];
    if (validation.ok) {
      try {
        visibleNodeIds = resolveRuntimeVisibility(tree, optionSelectionsV2).visibleNodeIds;
      } catch {
        visibleNodeIds = [];
      }
    }

    return {
      treeOk: validation.ok,
      treeErrors: validation.ok ? [] : validation.errors,
      productId: expandedProduct?.id ?? null,
      productName: (expandedProduct as any)?.name ?? null,
      isPbv2Product: expandedProductIsPbv2,
      optionTreeJsonExists: expandedProductOptionTreeSummary.exists,
      pbv2ActiveTreeVersionId: expandedProductActiveTreeVersionId,
      liveActiveTreeQueryStatus,
      effectivePbv2TreeExists: true,
      totalNodeCount: Object.keys(nodes).length,
      groupCount: summary.groupCount,
      selectableQuestionCount: summary.questionCount,
      choiceCount: summary.choiceCount,
      visibleNodeCount: visibleNodeIds.length,
      renderedControlCount: pbv2PanelRenderStats.renderedControlCount,
      firstQuestionLabels: questionLabels.slice(0, 10),
      firstQuestionInputTypes: questionInputTypes.slice(0, 10),
      firstSelectionKeys: questionSelectionKeys.slice(0, 10),
    };
  }, [
    effectivePbv2Tree,
    expandedProduct,
    expandedProductActiveTreeVersionId,
    expandedProductIsPbv2,
    livePbv2TreeFetchStatus,
    livePbv2TreeIsFetching,
    livePbv2TreeStatus,
    expandedProductOptionTreeSummary.exists,
    needsLivePbv2TreeFetch,
    optionSelectionsV2,
    pbv2PanelRenderStats.renderedControlCount,
  ]);

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
        productionNotes: string;
        requiresDesign: boolean;
        requiresPrepress: boolean;
        optionSelections: Record<string, OptionSelection>;
        optionSelectionsV2: LineItemOptionSelectionsV2["selected"];
        totalPrice: number;
      }
    >
  >({});

  useEffect(() => {
    if (!expandedItem?.id) {
      setDesignBriefDraft(EMPTY_DESIGN_BRIEF_DRAFT);
      setLineItemInternalNoteDraft("");
      return;
    }

    if (!designBriefQuery.data) {
      const savedDraft = designBriefSnapshotRef.current[expandedItem.id];
      if (savedDraft) {
        setDesignBriefDraft(savedDraft);
      } else {
        setDesignBriefDraft(EMPTY_DESIGN_BRIEF_DRAFT);
      }
      return;
    }

    const nextDraft = toDesignBriefDraft(designBriefQuery.data);
    setDesignBriefDraft(nextDraft);
    designBriefSnapshotRef.current[expandedItem.id] = nextDraft;
  }, [expandedItem?.id, designBriefQuery.data]);

  useEffect(() => {
    setLineItemInternalNoteDraft("");
  }, [expandedItem?.id]);

  // Inline add product search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [artworkModalLineItemId, setArtworkModalLineItemId] = useState<string | null>(null);

  const [missingArtworkSuppressReason, setMissingArtworkSuppressReason] = useState<string>("");
  const [savingFlagLineItemId, setSavingFlagLineItemId] = useState<string | null>(null);

  useEffect(() => {
    setMissingArtworkSuppressReason("");
  }, [expandedId]);

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

  const pbv2DefaultsHydratedRef = useRef<Set<string>>(new Set());
  const [initialDraftDebugByLineItemId, setInitialDraftDebugByLineItemId] = useState<Record<string, InitialOrderLineItemDraftDebug>>({});
  const [userEditedOptionsByLineItemId, setUserEditedOptionsByLineItemId] = useState<Record<string, boolean>>({});
  const markUserEditedOptions = useCallback((lineItemId: string | null | undefined) => {
    if (!lineItemId) return;
    setUserEditedOptionsByLineItemId((prev) => ({ ...prev, [lineItemId]: true }));
  }, []);

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

    const nextProductionNotes =
      (((expandedItem.specsJson as any)?.lineItemNotes as any)?.descLong as string | undefined) ||
      "";
    setNotesDraftById((prev) => ({ ...prev, [itemId]: nextProductionNotes }));
    setRequiresDesignInput(Boolean((expandedItem as any).requiresDesign));
    setRequiresPrepressInput(Boolean((expandedItem as any).requiresPrepress));

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
    const nextSelectionsV2: LineItemOptionSelectionsV2 =
      rawV2 && typeof rawV2 === "object" && (rawV2 as any)?.schemaVersion === 2
        ? (rawV2 as LineItemOptionSelectionsV2)
        : (expandedItem.specsJson as any)?.initialDraft?.optionSelectionsJson &&
            typeof (expandedItem.specsJson as any).initialDraft.optionSelectionsJson === "object" &&
            (expandedItem.specsJson as any).initialDraft.optionSelectionsJson.schemaVersion === 2
          ? ((expandedItem.specsJson as any).initialDraft.optionSelectionsJson as LineItemOptionSelectionsV2)
        : { schemaVersion: 2, selected: {} };
    setOptionSelectionsV2(nextSelectionsV2);

    // Hydrate PBV2 snapshot from line item (used to render option questions)
    const savedSnapshot = getPbv2SnapshotFromLineItem(expandedItem);
    setPbv2SnapshotJson(savedSnapshot);

    setCalcError(null);

    const currentTotal = Number.parseFloat(expandedItem.totalPrice || "0") || 0;
    setComputedTotal(Number.isFinite(currentTotal) ? currentTotal : 0);
    setComputedTotalQty(expandedItem.quantity || 1);
    const currentOverrideCents = (expandedItem as any)?.overridePriceCents;
    const priceForEditor =
      typeof currentOverrideCents === "number" && Number.isFinite(currentOverrideCents)
        ? currentOverrideCents / 100
        : currentTotal;
    setPriceEditTextById((prev) => ({ ...prev, [itemId]: priceForEditor.toFixed(2) }));
    setEditingPriceItemId(null);

    savedSnapshotRef.current[itemId] = {
      width: Number.parseFloat(expandedItem.width || "1") || 1,
      height: Number.parseFloat(expandedItem.height || "1") || 1,
      quantity: expandedItem.quantity || 1,
      notes: nextNotes,
      productionNotes: nextProductionNotes,
      requiresDesign: Boolean((expandedItem as any).requiresDesign),
      requiresPrepress: Boolean((expandedItem as any).requiresPrepress),
      optionSelections: selections,
      optionSelectionsV2: nextSelectionsV2.selected ?? {},
      totalPrice: currentTotal,
    };
  }, [expandedItem?.id]);

  // Hydrate PBV2 defaults from the product tree when a line item is first expanded
  // with no saved selections. resolveRuntimeVisibility computes effective defaults from
  // node.input.defaultValue, so we wrap that result into the LineItemOptionSelectionsV2 shape.
  useEffect(() => {
    const lineItemId = expandedItem?.id;
    const hydrationKey = buildPbv2DefaultsHydrationKey({
      lineItemId,
      productId: expandedItem?.productId ?? expandedProduct?.id ?? null,
      activeTreeVersionId: getOrderLineItemPbv2TreeVersionId({
        product: expandedProductPbv2Runtime,
        lineItem: expandedItemPbv2Runtime,
      }),
    });
    if (!lineItemId) return;
    if (!hydrationKey) return;

    if (hasPbv2Selections(optionSelectionsV2)) {
      pbv2DefaultsHydratedRef.current.add(hydrationKey);
      return;
    }

    try {
      if (!shouldHydratePbv2Defaults({
        hydrationKey,
        hydratedKeys: pbv2DefaultsHydratedRef.current,
        selections: optionSelectionsV2,
        tree: effectivePbv2Tree as OptionTreeV2 | null,
      })) {
        return;
      }
      if (userEditedOptionsByLineItemId[lineItemId]) return;
      if (!expandedProduct) return;
      const initializedDraft = buildInitialOrderLineItemDraftFromProduct(
        expandedProduct as any,
        effectivePbv2Tree as OptionTreeV2 | null,
        orderId,
      );
      const defaults = initializedDraft.optionSelectionsJson;
      if (!defaults) return;
      pbv2DefaultsHydratedRef.current.add(hydrationKey);
      if (hasPbv2Selections(defaults)) {
        setOptionSelectionsV2(defaults);
        setInitialDraftDebugByLineItemId((prev) => ({
          ...prev,
          [lineItemId]: initializedDraft.debug,
        }));
      }
    } catch {
      // Best-effort: never block expansion on default hydration failure.
    }
  }, [
    expandedItem?.id,
    expandedItem?.productId,
    expandedItemPbv2Runtime?.pbv2ActiveTreeVersionId,
    expandedItemPbv2Runtime?.pbv2TreeVersionId,
    expandedProductPbv2Runtime?.pbv2ActiveTreeVersionId,
    expandedProduct?.id,
    effectivePbv2Tree,
    optionSelectionsV2,
    userEditedOptionsByLineItemId,
    orderId,
  ]);

  const widthNum = dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const lastCalcKeyRef = useRef<string>("");
  // Monotonic id per preview request — guards against an earlier, slower
  // response overwriting a newer one.
  const calcSeqRef = useRef(0);

  const v1SelectionsKey = useMemo(() => stableStringify(optionSelections || {}), [optionSelections]);
  const v2SelectionsKey = useMemo(() => stableStringify(optionSelectionsV2?.selected || {}), [optionSelectionsV2]);
  const pbv2TreeVersionId = String(
    getOrderLineItemPbv2TreeVersionId({
      product: expandedProductPbv2Runtime,
      lineItem: expandedItemPbv2Runtime,
    })
  );
  const overridePriceCents = Number(
    ((expandedItem as any)?.overridePriceCents as number | undefined) || 0
  );
  const isPbv2Mode = Boolean(effectivePbv2Tree);
  const calcKey = useMemo(
    () =>
      [
        expandedItem?.productId || "",
        pbv2TreeVersionId,
        String(widthNum),
        String(heightNum),
        String(qtyNum),
        isPbv2Mode ? v2SelectionsKey : v1SelectionsKey,
        String(overridePriceCents),
      ].join("|"),
    [expandedItem?.productId, pbv2TreeVersionId, widthNum, heightNum, qtyNum, isPbv2Mode, v2SelectionsKey, v1SelectionsKey, overridePriceCents]
  );

  useEffect(() => {
    lastCalcKeyRef.current = "";
  }, [expandedId]);

  const isDirty = useMemo(() => {
    if (!expandedItem) return false;
    const saved = savedSnapshotRef.current[expandedItem.id];
    if (!saved) return true;
    const savedBrief = designBriefSnapshotRef.current[expandedItem.id] ?? EMPTY_DESIGN_BRIEF_DRAFT;

    const currentNotes = notes || "";
    const savedNotes = saved.notes || "";
    const currentProductionNotes = expandedItem ? notesDraftById[expandedItem.id] ?? "" : "";
    const savedProductionNotes = saved.productionNotes || "";
    const currentOptions = JSON.stringify(optionSelections || {});
    const savedOptions = JSON.stringify(saved.optionSelections || {});
    const currentOptionsV2 = stableStringify(optionSelectionsV2?.selected || {});
    const savedOptionsV2 = stableStringify(saved.optionSelectionsV2 || {});
    const currentBrief = JSON.stringify(designBriefDraft);
    const persistedBrief = JSON.stringify(savedBrief);

    return (
      Math.abs(widthNum - saved.width) > 0.01 ||
      Math.abs(heightNum - saved.height) > 0.01 ||
      qtyNum !== saved.quantity ||
      currentNotes !== savedNotes ||
      currentProductionNotes !== savedProductionNotes ||
      requiresDesignInput !== saved.requiresDesign ||
      requiresPrepressInput !== saved.requiresPrepress ||
      (isPbv2Mode ? currentOptionsV2 !== savedOptionsV2 : currentOptions !== savedOptions) ||
      currentBrief !== persistedBrief
    );
  }, [
    expandedItem,
    widthNum,
    heightNum,
    qtyNum,
    notes,
    notesDraftById,
    optionSelections,
    optionSelectionsV2,
    isPbv2Mode,
    requiresDesignInput,
    requiresPrepressInput,
    designBriefDraft,
    // Forces recompute against the freshly-written savedSnapshotRef after a save.
    savedSnapshotVersion,
  ]);

  // Surface unsaved line item state to the parent order editor so it can guard
  // navigation and block Save Order until the open line item is saved.
  useEffect(() => {
    onDirtyStateChange?.(isDirty);
  }, [isDirty, onDirtyStateChange]);

  useEffect(() => {
    return () => onDirtyStateChange?.(false);
  }, [onDirtyStateChange]);

  // Debounced live-preview price calculation for the expanded line item.
  //
  // The debounce is keyed ONLY on primitives — the `calcKey` string plus a few
  // ids/flags — never on object references. `ProductOptionsPanelV2` re-emits a
  // content-identical `optionSelectionsV2` object (new reference) on re-render;
  // if that reference were a dependency here, every render would clear and
  // reset the 400ms timer and the calculation would never fire. `calcKey` is a
  // stableStringify-based string, so equal pricing inputs produce an equal key
  // and a reference-only churn leaves the debounce timer untouched.
  useDebouncedEffect(
    () => {
      if (!expandedItem || !expandedProduct) return;
      if (dimsRequired && (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0)) return;
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;

      if (isPbv2Mode && !optionsV2Valid) {
        setCalcError(null);
        return;
      }

      if (calcKey === lastCalcKeyRef.current) {
        return;
      }
      lastCalcKeyRef.current = calcKey;

      // Sequence id: a slower earlier response must not overwrite a newer one.
      calcSeqRef.current += 1;
      const seq = calcSeqRef.current;

      // Payload is always built from current DRAFT state (qty/dims/options).
      const payload = buildQuoteCalculatePayload({
        productId: expandedItem.productId,
        variantId: expandedItem.productVariantId,
        widthNum,
        heightNum,
        qtyNum,
        isPbv2Mode,
        optionSelectionsV2Selected: optionSelectionsV2.selected || {},
        optionSelectionsV1: optionSelections,
        customerId,
      });

      setIsCalculating(true);
      setCalcError(null);
      setPreviewDiag({
        seq,
        payloadQuantity: qtyNum,
        payloadSelections:
          (payload.optionSelectionsJson as Record<string, unknown>) ??
          (payload.selectedOptions as Record<string, unknown>) ??
          {},
        responseTotal: null,
        status: "pending",
        at: new Date().toISOString(),
      });

      apiRequest("POST", "/api/quotes/calculate", payload)
        .then((r) => r.json())
        .then((data) => {
          // Ignore a response that a newer request has already superseded.
          if (seq !== calcSeqRef.current) return;
          // Backend returns 'linePrice' in dollars (legacy compatibility)
          const price = Number(data?.linePrice);
          if (!Number.isFinite(price)) {
            setCalcError("Calculation failed");
            setPreviewDiag((prev) => (prev && prev.seq === seq ? { ...prev, status: "error" } : prev));
            return;
          }
          setComputedTotal(price);
          // Record the qty this total was priced for so per-each stays consistent.
          setComputedTotalQty(qtyNum);
          setPreviewDiag((prev) =>
            prev && prev.seq === seq ? { ...prev, responseTotal: price, status: "ok" } : prev,
          );

          // Store PBV2 snapshot from response (contains treeJson, visibleNodeIds, selections)
          if (data?.pbv2SnapshotJson) {
            setPbv2SnapshotJson(data.pbv2SnapshotJson);
          }
        })
        .catch((err: any) => {
          if (seq !== calcSeqRef.current) return;
          // Error message format from apiRequest: "<status>: <responseBody>"
          // Always extract a friendly message; never leak raw JSON to the UI.
          const raw: string = (err?.message as string) || "";
          let errorMessage = "Calculation failed";
          const jsonMatch = raw.match(/^\d+:\s*({.*})\s*$/);
          if (jsonMatch) {
            try {
              const errorData = JSON.parse(jsonMatch[1]);
              if (errorData?.code === "PBV2_E_SCHEMA_VERSION_MISMATCH") {
                errorMessage = "PBV2_SCHEMA_MISMATCH";
              } else if (errorData?.code === "PBV2_PRICING_MATRIX_ERROR" && typeof errorData?.message === "string") {
                errorMessage = errorData.message;
              } else if (typeof errorData?.message === "string" && errorData.message.trim()) {
                errorMessage = errorData.message;
              }
            } catch {
              // Couldn't parse JSON body — fall back to generic friendly message.
            }
          } else if (raw && !raw.includes("{")) {
            // Plain (non-JSON) error: safe to show.
            errorMessage = raw;
          }
          setCalcError(errorMessage);
          setPreviewDiag((prev) => (prev && prev.seq === seq ? { ...prev, status: "error" } : prev));
        })
        .finally(() => {
          if (seq === calcSeqRef.current) setIsCalculating(false);
        });
    },
    [
      // Primitives only — see comment above. `calcKey` already encodes
      // productId, tree version, width, height, qty, option selections and
      // any override, so a reference change with identical content is a no-op.
      calcKey,
      expandedItem?.id,
      expandedItem?.productVariantId,
      isPbv2Mode,
      optionsV2Valid,
      customerId,
    ],
    400
  );

  const handleSaveItem = async () => {
    if (!expandedItem) return;
    if (isPbv2Mode && !optionsV2Valid) {
      setCalcError("Complete required product options before saving.");
      return;
    }
    const itemId = expandedItem.id;

    setSavingItemId(itemId);
    setSavedItemId(null);

    try {
      const totalPrice = Number.isFinite(computedTotal) ? (computedTotal as number) : Number.parseFloat(expandedItem.totalPrice || "0") || 0;
      const unitPrice = qtyNum > 0 ? totalPrice / qtyNum : 0;
      const productionNotesDraft = notesDraftById[itemId] ?? "";

      const selectedOptionsArray = buildSelectedOptionsArray(expandedProductOptions, optionSelections, widthNum, heightNum, qtyNum);
      const nextSpecsJson = {
        ...(expandedItem.specsJson || {}),
        notes: notes || "",
        lineItemNotes: {
          ...(((expandedItem.specsJson as any)?.lineItemNotes as any) || {}),
          descLong: productionNotesDraft,
        },
        selectedOptions: selectedOptionsArray,
      };

      const isPbv2 = Boolean(effectivePbv2Tree || pbv2SnapshotJson?.treeJson);
      const v2Patch = isPbv2
        ? { 
            optionSelectionsJson: optionSelectionsV2,
            // Store PBV2 snapshot from /calculate for future reference
            pbv2SnapshotJson: pbv2SnapshotJson || undefined,
          }
        : {};

      const savedLineItem = await updateLineItem.mutateAsync({
        id: itemId,
        data: {
          width: dimsRequired ? widthNum : null,
          height: dimsRequired ? heightNum : null,
          quantity: qtyNum,
          description: notes || "",
          requiresDesign: requiresDesignInput,
          requiresPrepress: requiresPrepressInput,
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
          selectedOptions: selectedOptionsArray,
          specsJson: nextSpecsJson,
          ...(v2Patch as any),
        },
      });

      // Server reprices authoritatively — adopt its result as the new baseline
      // so the displayed preview matches the persisted price after save.
      const authoritativeTotal = Number((savedLineItem as any)?.totalPrice);
      const resolvedTotal = Number.isFinite(authoritativeTotal) ? authoritativeTotal : totalPrice;
      setComputedTotal(resolvedTotal);
      setComputedTotalQty(qtyNum);

      const shouldPersistDesignBrief = Boolean(designBriefQuery.data?.id)
        || Boolean(designBriefQuery.data?.effectiveRequiresDesign)
        || hasAnyDesignBriefText(designBriefDraft);
      if (shouldPersistDesignBrief) {
        await saveDesignBrief.mutateAsync({
          lineItemId: itemId,
          data: designBriefDraft,
        });
      }

      setSavedItemId(itemId);

      savedSnapshotRef.current[itemId] = {
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        notes: notes || "",
        productionNotes: productionNotesDraft,
        requiresDesign: requiresDesignInput,
        requiresPrepress: requiresPrepressInput,
        optionSelections,
        optionSelectionsV2: optionSelectionsV2.selected ?? {},
        totalPrice: resolvedTotal,
      };
      designBriefSnapshotRef.current[itemId] = designBriefDraft;
      // Force `isDirty` to recompute against the snapshot just written, so the
      // line item dirty flag (and the order navigation guard) clear immediately
      // — independent of when the post-save order refetch happens to land.
      setSavedSnapshotVersion((v) => v + 1);
      // A successful save supersedes any prior preview calculation error.
      setCalcError(null);

      setTimeout(() => setSavedItemId(null), 2000);
      setTimeout(() => setDesignBriefSavedAt(null), 2000);

      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
    } finally {
      setSavingItemId(null);
    }
  };

  const refreshPricingAfterOverrideChange = async ({
    item,
    nextOverrideCents,
    previousOverrideCents,
  }: {
    item: OrderLineItem;
    nextOverrideCents: number | null;
    previousOverrideCents: number | null;
  }) => {
    if (nextOverrideCents === previousOverrideCents) return;

    const itemSpecsJson: any =
      item.specsJson && typeof item.specsJson === "object" ? (item.specsJson as any) : {};
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const width = Number.parseFloat(item.width || "1") || 1;
    const height = Number.parseFloat(item.height || "1") || 1;

    const pbv2Snapshot = getPbv2SnapshotFromLineItem(item);
    const optionSelectionsJsonRaw = (item as any)?.optionSelectionsJson;
    const pbv2Selected =
      optionSelectionsJsonRaw &&
      typeof optionSelectionsJsonRaw === "object" &&
      (optionSelectionsJsonRaw as any)?.schemaVersion === 2
        ? (optionSelectionsJsonRaw as any).selected || {}
        : {};
    const isPbv2 = Boolean((pbv2Snapshot as any)?.treeJson);

    const v1Selections = buildOptionSelectionsRecordFromSpecs(itemSpecsJson);

    let calculatedLinePrice = Number.parseFloat(item.totalPrice || "0") || 0;
    try {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: item.productId,
        variantId: item.productVariantId || undefined,
        width,
        height,
        quantity,
        ...(isPbv2
          ? { optionSelectionsJson: pbv2Selected }
          : { selectedOptions: v1Selections }),
        customerId,
        debugSource: "OrderLineItemsSection.override-refresh",
      });
      const data = await response.json();
      const price = Number(data?.linePrice);
      if (Number.isFinite(price)) {
        calculatedLinePrice = price;
      }
    } catch {
      // keep fallback to existing persisted total
    }

    const effectiveTotal =
      typeof nextOverrideCents === "number" && Number.isFinite(nextOverrideCents)
        ? nextOverrideCents / 100
        : calculatedLinePrice;
    const effectiveUnit = quantity > 0 ? effectiveTotal / quantity : effectiveTotal;

    const currentTotal = Number.parseFloat(item.totalPrice || "0") || 0;
    const currentUnit = Number.parseFloat(item.unitPrice || "0") || 0;
    const totalChanged = Math.abs(currentTotal - effectiveTotal) > 0.0001;
    const unitChanged = Math.abs(currentUnit - effectiveUnit) > 0.0001;

    if (totalChanged || unitChanged) {
      await updateLineItemSilent.mutateAsync({
        id: String(item.id),
        data: {
          unitPrice: effectiveUnit.toFixed(2),
          totalPrice: effectiveTotal.toFixed(2),
        },
      });
    }

    await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
    await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });
    await onAfterLineItemsChange?.();
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
        status: item.status || "new",
        requiresDesign: Boolean((item as any).requiresDesign),
        requiresPrepress: Boolean((item as any).requiresPrepress),
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

  const actionNeededCount = useMemo(() => {
    return activeLineItems.filter((item) => needsOperationalAction(String((item as any).workflowState || "new"))).length;
  }, [activeLineItems]);

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="px-0 pt-0 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/15 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Line Items</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{count} {count === 1 ? "item" : "items"}</span>
              {productionRequiredItemCount > 0 && <span>{productionRequiredItemCount} require production</span>}
              {actionNeededCount > 0 && <span>{actionNeededCount} need action</span>}
            </div>
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

                  const itemSpecsJson: any =
                    item.specsJson && typeof item.specsJson === "object" ? (item.specsJson as any) : {};

                  const selectedOptionsForChips = (itemSpecsJson as any)?.selectedOptions || [];
                  const { chips: optionChips, overflowCount } = extractOptionChips(selectedOptionsForChips, 3);

                  const persistedDescription = typeof item.description === "string" ? item.description.trim() : "";

                  const total = Number.parseFloat(item.totalPrice || "0") || 0;
                  const parsedUnit = Number.parseFloat(item.unitPrice || "");
                  const perEa = Number.isFinite(parsedUnit)
                    ? parsedUnit
                    : item.quantity > 0
                      ? total / item.quantity
                      : 0;

                  const itemNotes = (itemSpecsJson as any)?.lineItemNotes as
                    | { sku?: string | null; descShort?: string | null; descLong?: string | null }
                    | undefined;

                  const persistedProductionNotes = typeof itemNotes?.descLong === "string" ? itemNotes.descLong : "";
                  const hasProductionNotes = Boolean(persistedProductionNotes && persistedProductionNotes.trim());

                  const currentOverrideCents =
                    typeof (item as any)?.overridePriceCents === "number" && Number.isFinite((item as any).overridePriceCents)
                      ? ((item as any).overridePriceCents as number)
                      : null;
                  const isOverride = currentOverrideCents !== null;

                  // Live preview price for the currently-expanded item (not yet saved).
                  // Per-each is derived from the qty the preview total was priced for,
                  // never the live draft qty, so total and per-each stay consistent.
                  const isActiveItem = isExpanded && expandedItem?.id === item.id;
                  const { displayTotal, displayPerEach: displayPerEa, isPreviewPrice } =
                    deriveLineItemPricingDisplay({
                      isActiveItem,
                      isOverride,
                      persistedTotal: total,
                      persistedPerEach: perEa,
                      computedTotal: isActiveItem ? computedTotal : null,
                      computedTotalQty: isActiveItem ? computedTotalQty : null,
                      isDirty,
                      isCalculating,
                      hasCalcError: Boolean(calcError),
                    });
                  const displayPrice = isOverride ? currentOverrideCents / 100 : total;
                  const priceEditText = priceEditTextById[String(item.id)] ?? displayPrice.toFixed(2);
                  const isEditingPrice = editingPriceItemId === String(item.id);

                  const statusValue = item.status || "new";

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
                  const isProductionFocused = productionFocusLineItemIds.includes(String(item.id));
                  const expandedBriefDetail = isExpanded && expandedItem && expandedItem.id === item.id ? designBriefQuery.data : null;
                  const showDesignBriefEditor = Boolean(
                    expandedBriefDetail?.effectiveRequiresDesign ||
                    hasAnyDesignBriefText(designBriefDraft)
                  );
                  const workflowState = String((item as any).workflowState || "new");
                  const lineItemProofSummary = (item as any).proofSummary ?? null;
                  const showOpenProofingAction = shouldOfferProofingNavigation({
                    lineItemId: item.id,
                    requiresProofApproval: Boolean((item as any).requiresProofApproval),
                    approvedProofVersionId: (item as any).approvedProofVersionId ?? null,
                  }) || Boolean(lineItemProofSummary?.openProofingAvailable);
                  const hasActiveOwner = Boolean((item as any).activeOwnerStepKey || (item as any).activeOwnerStationKey || (item as any).activeOwnerJobId);
                  const ownerLabel = (item as any).activeOwnerStepKey || (item as any).activeOwnerStationKey || null;
                  const policy =
                    productArtworkPolicy === "required" || productArtworkPolicy === "not_required"
                      ? productArtworkPolicy
                      : null;
                  const suppressedEntry =
                    itemSpecsJson?.flags?.suppressed && typeof itemSpecsJson.flags.suppressed === "object"
                      ? (itemSpecsJson.flags.suppressed as any)?.missing_artwork
                      : null;
                  const suppressedReason = typeof suppressedEntry?.reason === "string" ? suppressedEntry.reason.trim() : "";
                  const suppressedAt = typeof suppressedEntry?.at === "string" ? suppressedEntry.at.trim() : "";
                  const isMissingArtworkSuppressed = Boolean(suppressedReason && suppressedAt);
                  const canDeriveArtwork = lineItemAttachmentsAssociationKnown && lineItemAssetsKnownForItem;
                  const hasAnyArtwork = attachmentsForThumb.length > 0 || assetCountForItem > 0;
                  const missingArtworkActive = policy === "required" && canDeriveArtwork && !hasAnyArtwork && !isMissingArtworkSuppressed;
                  const operationalStatusLabel = WORKFLOW_LABELS[workflowState] || workflowState;
                  const operationalNextStep = getOperationalNextStep(workflowState, hasActiveOwner);
                  const initialDraftDebug = initialDraftDebugByLineItemId[String(item.id)];
                  const initialDraftSnapshot = (itemSpecsJson?.initialDraft && typeof itemSpecsJson.initialDraft === "object")
                    ? itemSpecsJson.initialDraft as any
                    : null;
                  const lineItemUserEditedOptions = userEditedOptionsByLineItemId[String(item.id)] === true;
                  const pricingDebugSnapshot = isExpanded && expandedItem && expandedItem.id === item.id
                    ? (pbv2SnapshotJson as any)?.pbv2PricingSnapshot
                    : (item as any)?.pbv2SnapshotJson?.pbv2PricingSnapshot;
                  const renderedRequiresDesign = isExpanded && expandedItem && expandedItem.id === item.id
                    ? requiresDesignInput
                    : Boolean((item as any).requiresDesign);
                  const renderedRequiresPrepress = isExpanded && expandedItem && expandedItem.id === item.id
                    ? requiresPrepressInput
                    : (typeof (item as any).requiresPrepress === "boolean" ? (item as any).requiresPrepress : null);
                  const renderedRequiresProofApproval = Boolean((expandedProduct as any)?.requiresProofApproval ?? (item as any)?.requiresProofApproval);

                  let operationalWarning: string | null = null;
                  let operationalWarningTone: "warning" | "danger" | null = null;

                  if (missingArtworkActive) {
                    operationalWarning = "Missing artwork";
                    operationalWarningTone = "warning";
                  } else if (workflowState === "on_hold") {
                    operationalWarning = "On hold";
                    operationalWarningTone = "danger";
                  } else if (showDesignBriefEditor && expandedBriefDetail?.status === "required_missing") {
                    operationalWarning = "Design brief incomplete";
                    operationalWarningTone = "warning";
                  } else if (calcError && isExpanded && expandedItem && expandedItem.id === item.id) {
                    operationalWarning = calcError === "PBV2_SCHEMA_MISMATCH"
                      ? "Pricing issue: outdated PBV2 config"
                      : `Pricing issue: ${calcError}`;
                    operationalWarningTone = "warning";
                  }

                  return (
                    <SortableOrderLineItemWrapper key={itemKey} id={itemKey} disabled={reorderDisabled}>
                      {({ dragAttributes, dragListeners, isDragging, isOver }) => (
                        <div
                          className={cn(
                            "rounded-md overflow-x-hidden",
                            isProductionFocused && "ring-1 ring-amber-300/80 bg-amber-50/40",
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
                              <LineItemCard
                                id={String(item.id)}
                                itemKey={itemKey}
                                contentId={contentId}
                                isExpanded={isExpanded}
                                onToggleExpand={() => {
                                  if (isExpanded) {
                                    setExpandedId(null);
                                    return;
                                  }
                                  setExpandedId(itemKey);
                                  setPendingJumpToLineItemId(itemKey);
                                }}
                                title={productName}
                                sizeLabel={`${item.width || "0"}" × ${item.height || "0"}"`}
                                qtyLabel={`Qty ${item.quantity || 0}`}
                                unitPriceLabel={`${formatMoney(displayPerEa)}/ea`}
                                totalLabel={formatMoney(displayTotal)}
                                badges={{
                                  isNew: statusValue === "new",
                                  override: isOverride,
                                  internal: hasProductionNotes,
                                }}
                                showNoteLabel={false}
                                descriptionPreview={undefined}
                                optionChips={optionChips.map((chip, index) => ({
                                  text: chip,
                                  key: `${itemKey}-chip-${index}`,
                                }))}
                                overflowCount={overflowCount}
                                summaryFooter={
                                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <Badge variant={workflowBadgeVariant(workflowState)} className="h-5 px-1.5 text-[11px] font-medium">
                                      {operationalStatusLabel}
                                    </Badge>
                                    {lineItemProofSummary ? (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "h-5 px-1.5 text-[11px] font-medium",
                                          getLineItemProofBadgeClass(lineItemProofSummary.status)
                                        )}
                                      >
                                        {lineItemProofSummary.label}
                                      </Badge>
                                    ) : null}
                                    <span className="text-muted-foreground">
                                      Next: <span className="text-foreground">{operationalNextStep}</span>
                                    </span>
                                    {ownerLabel ? <span className="text-muted-foreground">Owner: {String(ownerLabel)}</span> : null}
                                    {operationalWarning ? (
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded px-1.5 py-0.5 font-medium",
                                          operationalWarningTone === "danger"
                                            ? "bg-red-100 text-red-800"
                                            : "bg-amber-100 text-amber-800"
                                        )}
                                      >
                                        {operationalWarning}
                                      </span>
                                    ) : null}
                                  </div>
                                }
                                thumbnail={thumbnailNode}
                                dragHandleProps={{
                                  attributes: dragAttributes,
                                  listeners: dragListeners,
                                  disabled: reorderDisabled,
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
                                price={
                                  isExpanded && expandedItem && expandedItem.id === item.id && !isOverride && Number.isFinite(computedTotal)
                                    ? (computedTotal as number)
                                    : total
                                }
                                priceOverride={isOverride ? currentOverrideCents! / 100 : null}
                                editingPrice={isEditingPrice}
                                priceEditText={priceEditText}
                                onPriceClick={
                                  readOnly
                                    ? undefined
                                    : () => {
                                        const lineItemId = String(item.id);
                                        setEditingPriceItemId(lineItemId);
                                        setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: displayPrice.toFixed(2) }));
                                      }
                                }
                                onPriceChange={
                                  readOnly
                                    ? undefined
                                    : (value) => {
                                        const lineItemId = String(item.id);
                                        setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: value }));
                                      }
                                }
                                onPriceBlur={
                                  readOnly
                                    ? undefined
                                    : async () => {
                                        const lineItemId = String(item.id);
                                        const rawValue = priceEditTextById[lineItemId] ?? displayPrice.toFixed(2);
                                        const parsed = Number.parseFloat(rawValue);
                                        if (!Number.isFinite(parsed) || parsed < 0) {
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: displayPrice.toFixed(2) }));
                                          setEditingPriceItemId((prev) => (prev === lineItemId ? null : prev));
                                          return;
                                        }

                                        const nextCents = Math.round(parsed * 100);
                                        const calculatedCents = Math.round(total * 100);
                                        const previousOverrideCents = currentOverrideCents;

                                        try {
                                          if (nextCents !== calculatedCents) {
                                            if (previousOverrideCents === nextCents) {
                                              setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (nextCents / 100).toFixed(2) }));
                                              return;
                                            }
                                            await updateLineItemSilent.mutateAsync({
                                              id: lineItemId,
                                              data: {
                                                overridePriceCents: nextCents,
                                                overrideReason: null,
                                              },
                                            });
                                            await refreshPricingAfterOverrideChange({
                                              item,
                                              nextOverrideCents: nextCents,
                                              previousOverrideCents,
                                            });
                                            setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (nextCents / 100).toFixed(2) }));
                                          } else if (currentOverrideCents !== null) {
                                            await updateLineItemSilent.mutateAsync({
                                              id: lineItemId,
                                              data: {
                                                overridePriceCents: null,
                                                overrideReason: null,
                                              },
                                            });
                                            await refreshPricingAfterOverrideChange({
                                              item,
                                              nextOverrideCents: null,
                                              previousOverrideCents,
                                            });
                                            setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (calculatedCents / 100).toFixed(2) }));
                                          }
                                        } catch (e) {
                                          toast({
                                            variant: "destructive",
                                            title: "Could not update price override",
                                            description: "Please try again.",
                                          });
                                        } finally {
                                          setEditingPriceItemId((prev) => (prev === lineItemId ? null : prev));
                                        }
                                      }
                                }
                                onPriceKeyDown={
                                  readOnly
                                    ? undefined
                                    : (e) => {
                                        const lineItemId = String(item.id);
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          (e.currentTarget as HTMLInputElement).blur();
                                        }
                                        if (e.key === "Escape") {
                                          e.preventDefault();
                                          setEditingPriceItemId((prev) => (prev === lineItemId ? null : prev));
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: displayPrice.toFixed(2) }));
                                        }
                                      }
                                }
                                onUndoOverride={
                                  readOnly || currentOverrideCents === null
                                    ? undefined
                                    : async () => {
                                        const lineItemId = String(item.id);
                                        const calculatedCents = Math.round(total * 100);
                                      const previousOverrideCents = currentOverrideCents;
                                        try {
                                          await updateLineItemSilent.mutateAsync({
                                            id: lineItemId,
                                            data: {
                                              overridePriceCents: null,
                                              overrideReason: null,
                                            },
                                          });
                                        await refreshPricingAfterOverrideChange({
                                          item,
                                          nextOverrideCents: null,
                                          previousOverrideCents,
                                        });
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (calculatedCents / 100).toFixed(2) }));
                                        } catch (e) {
                                          toast({
                                            variant: "destructive",
                                            title: "Could not clear price override",
                                            description: "Please try again.",
                                          });
                                        }
                                      }
                                }
                                isCalculating={isCalculating}
                                calcError={calcError}
                                isPreviewPrice={isPreviewPrice}
                                description={isExpanded && expandedItem && expandedItem.id === item.id ? notes : persistedDescription}
                                productionNotes={notesDraftById[String(item.id)] ?? persistedProductionNotes}
                                onDescriptionChange={
                                  isExpanded && expandedItem && expandedItem.id === item.id ? setNotes : undefined
                                }
                                onProductionNotesChange={
                                  isExpanded && expandedItem && expandedItem.id === item.id
                                    ? (value) => {
                                        const lineItemId = String(item.id);
                                        setNotesDraftById((prev) => ({ ...prev, [lineItemId]: value }));
                                      }
                                    : undefined
                                }
                                optionsSlot={
                                  <>
                                    {isExpanded && canSeeDebug && (
                                      <div className="mb-3">
                                        <button
                                          type="button"
                                          onClick={() => setShowLineItemDebug((v) => !v)}
                                          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                        >
                                          <ChevronDown className={cn("h-3 w-3 transition-transform", showLineItemDebug && "rotate-180")} />
                                          {showLineItemDebug ? "Hide Debug" : "Show Debug"}
                                        </button>

                                        {showLineItemDebug && (
                                          <>
                                            <div className="mt-2 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/5 p-3 text-[11px]">
                                              <div className="font-medium text-fuchsia-700 dark:text-fuchsia-300">Initial line item draft debug</div>
                                              <div className="mt-2 grid gap-1 font-mono text-muted-foreground">
                                                <div>initialDraft.requiresDesign: {String(initialDraftSnapshot?.requiresDesign ?? initialDraftDebug?.requiresDesign ?? "(missing)")}</div>
                                                <div>initialDraft.requiresPrepress: {String(initialDraftSnapshot?.requiresPrepress ?? initialDraftDebug?.requiresPrepress ?? "(missing)")}</div>
                                                <div>initialDraft.requiresProofApproval: {String(initialDraftSnapshot?.requiresProofApproval ?? initialDraftDebug?.requiresProofApproval ?? "(missing)")}</div>
                                                <div>initialDraft.optionSelectionsJson: {JSON.stringify(initialDraftSnapshot?.optionSelectionsJson ?? initialDraftDebug?.optionSelectionsJson ?? null)}</div>
                                                <div>rendered option labels in order: {(initialDraftSnapshot?.renderedOptionLabels ?? initialDraftDebug?.sortedOptionLabels ?? []).join(", ") || "(none)"}</div>
                                                <div>product routing defaults used: {JSON.stringify(initialDraftSnapshot?.productRoutingDefaultsUsed ?? initialDraftDebug?.productRoutingDefaultsUsed ?? null)}</div>
                                                <div>rendered.requiresDesign: {String(renderedRequiresDesign)}</div>
                                                <div>rendered.requiresPrepress: {String(renderedRequiresPrepress)}</div>
                                                <div>rendered.requiresProofApproval: {String(renderedRequiresProofApproval)}</div>
                                                <div>userEditedOptions: {String(lineItemUserEditedOptions)}</div>
                                              </div>
                                            </div>

                                            {pricingDebugSnapshot && (
                                              <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-[11px]">
                                                <div className="font-medium text-emerald-700 dark:text-emerald-300">PBV2 pricing runtime debug</div>
                                                <div className="mt-2 grid gap-1 font-mono text-muted-foreground">
                                                  <div>selected option values: {JSON.stringify(pricingDebugSnapshot.selectedOptionValues ?? pricingDebugSnapshot.effectiveSelections ?? null)}</div>
                                                  <div>matched matrix row id: {String(pricingDebugSnapshot.resolvedMatrixRowId ?? "(none)")}</div>
                                                  <div>resolved matrix variables: {JSON.stringify(pricingDebugSnapshot.resolvedMatrixVariables ?? {})}</div>
                                                  <div>base_price source: {String(pricingDebugSnapshot.basePriceSource ?? "(unknown)")}</div>
                                                  <div>rate used source: {String(pricingDebugSnapshot.rateUsedSource ?? "(unknown)")}</div>
                                                  <div>minimum applied: {String(pricingDebugSnapshot.minimumApplied ?? false)}</div>
                                                  <div>formula scope used: {JSON.stringify(pricingDebugSnapshot.formulaScopeUsed ?? pricingDebugSnapshot.formulaVariables ?? null)}</div>
                                                </div>
                                              </div>
                                            )}

                                            <div className="mt-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-[11px]">
                                              <div className="font-medium text-sky-700 dark:text-sky-300">Live preview calc diagnostics</div>
                                              <div className="mt-2 grid gap-1 font-mono text-muted-foreground">
                                                <div>request seq: {String(previewDiag?.seq ?? "(none)")}</div>
                                                <div>status: {String(previewDiag?.status ?? "(idle)")}</div>
                                                <div>payload quantity: {String(previewDiag?.payloadQuantity ?? "(none)")}</div>
                                                <div>payload option selections: {JSON.stringify(previewDiag?.payloadSelections ?? {})}</div>
                                                <div>last response total: {previewDiag?.responseTotal != null ? `$${previewDiag.responseTotal.toFixed(2)}` : "(none)"}</div>
                                                <div>requested at: {String(previewDiag?.at ?? "(none)")}</div>
                                                <div>computedTotal: {computedTotal != null ? `$${Number(computedTotal).toFixed(2)}` : "(none)"}</div>
                                                <div>computedTotalQty: {String(computedTotalQty ?? "(none)")}</div>
                                              </div>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}

                                    {import.meta.env.DEV && expandedProductIsPbv2 && (
                                      <div className="mb-3 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-[11px]">
                                        <div className="font-medium text-sky-700 dark:text-sky-300">PBV2 diagnostics (dev only)</div>
                                        <div className="mt-2 space-y-0.5 font-mono text-muted-foreground">
                                          <div>productId: {String(pbv2Diagnostics.productId ?? "(none)")}</div>
                                          <div>productName: {String(pbv2Diagnostics.productName ?? "(none)")}</div>
                                          <div>isPbv2Product: {String(pbv2Diagnostics.isPbv2Product)}</div>
                                          <div>optionTreeJson present: {String(pbv2Diagnostics.optionTreeJsonExists)}</div>
                                          <div>pbv2ActiveTreeVersionId: {String(pbv2Diagnostics.pbv2ActiveTreeVersionId ?? "(none)")}</div>
                                          <div>live active tree query status: {pbv2Diagnostics.liveActiveTreeQueryStatus}</div>
                                          <div>effectivePbv2Tree exists: {String(pbv2Diagnostics.effectivePbv2TreeExists)}</div>
                                          <div>total node count: {pbv2Diagnostics.totalNodeCount}</div>
                                          <div>group count: {pbv2Diagnostics.groupCount}</div>
                                          <div>selectable question count: {pbv2Diagnostics.selectableQuestionCount}</div>
                                          <div>choice count: {pbv2Diagnostics.choiceCount}</div>
                                          <div>visible node count: {pbv2Diagnostics.visibleNodeCount}</div>
                                          <div>rendered control count: {pbv2Diagnostics.renderedControlCount}</div>
                                          <div>
                                            first 10 question labels: {pbv2Diagnostics.firstQuestionLabels.join(", ") || "(none)"}
                                          </div>
                                          <div>
                                            first 10 question input types: {pbv2Diagnostics.firstQuestionInputTypes.join(", ") || "(none)"}
                                          </div>
                                          <div>
                                            first 10 selection keys: {pbv2Diagnostics.firstSelectionKeys.join(", ") || "(none)"}
                                          </div>
                                          <div>tree valid: {String(pbv2Diagnostics.treeOk)}</div>
                                          {pbv2Diagnostics.treeErrors.length > 0 && (
                                            <div className="text-amber-600 dark:text-amber-400">
                                              tree errors: {pbv2Diagnostics.treeErrors.join("; ")}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {expandedProductIsPbv2 && !effectivePbv2Tree && (
                                      <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                                        <div className="font-medium">PBV2 options unavailable</div>
                                        <div className="mt-0.5">
                                          This product is marked as PBV2 but no active option tree was loaded. Open the product and re-save / activate to publish its option tree.
                                        </div>
                                      </div>
                                    )}

                                    {effectivePbv2Tree && (
                                      <div className="mb-3">
                                        <ProductOptionsPanelV2
                                          tree={effectivePbv2Tree}
                                          selections={optionSelectionsV2}
                                          onSelectionsChange={setOptionSelectionsV2}
                                          onUserEdit={() => markUserEditedOptions(expandedItem?.id)}
                                          onValidityChange={setOptionsV2Valid}
                                          onRenderStatsChange={setPbv2PanelRenderStats}
                                        />
                                      </div>
                                    )}

                                    {!effectivePbv2Tree && expandedProductOptions.length > 0 && (
                                      <div className="mb-3">
                                        <ProductOptionsPanel
                                          product={expandedProduct}
                                          productOptions={expandedProductOptions}
                                          optionSelections={optionSelections as any}
                                          onOptionSelectionsChange={(next: Record<string, OptionSelection>) => {
                                            markUserEditedOptions(expandedItem?.id);
                                            setOptionSelections(next);
                                          }}
                                        />
                                      </div>
                                    )}

                                    {showDesignBriefEditor && (
                                      <div className="mb-3 rounded-md border border-border/40 bg-muted/20 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <div className="text-sm font-medium">Design brief</div>
                                            <div className="text-xs text-muted-foreground">
                                              Key Instructions and Design Objective are required when this item needs design.
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Badge
                                              variant={expandedBriefDetail?.status === "captured" ? "secondary" : "outline"}
                                              className={cn(
                                                expandedBriefDetail?.status === "required_missing" && "border-amber-500/30 bg-amber-500/10 text-amber-700"
                                              )}
                                            >
                                              {DESIGN_BRIEF_STATUS_LABELS[expandedBriefDetail?.status ?? "required_missing"]}
                                            </Badge>
                                            {designBriefQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                          </div>
                                        </div>

                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Key Instructions</div>
                                            <Textarea
                                              value={designBriefDraft.keyInstructions}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, keyInstructions: e.target.value }))}
                                              placeholder="Critical copy, offer, CTA, or non-negotiable requirements"
                                              className="min-h-24"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Design Objective</div>
                                            <Textarea
                                              value={designBriefDraft.designObjective}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, designObjective: e.target.value }))}
                                              placeholder="What the design must accomplish"
                                              className="min-h-24"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Requested Content</div>
                                            <Textarea
                                              value={designBriefDraft.requestedContent}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, requestedContent: e.target.value }))}
                                              placeholder="Specific text, assets, or required elements"
                                              className="min-h-20"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Layout Notes</div>
                                            <Textarea
                                              value={designBriefDraft.layoutNotes}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, layoutNotes: e.target.value }))}
                                              placeholder="Sizing, hierarchy, or placement guidance"
                                              className="min-h-20"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Brand / Style Notes</div>
                                            <Textarea
                                              value={designBriefDraft.brandStyleNotes}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, brandStyleNotes: e.target.value }))}
                                              placeholder="Brand tone, color, or visual direction"
                                              className="min-h-20"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <div className="text-xs font-medium text-muted-foreground">Reference Notes</div>
                                            <Textarea
                                              value={designBriefDraft.referenceNotes}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, referenceNotes: e.target.value }))}
                                              placeholder="Reference files, links, or examples"
                                              className="min-h-20"
                                              disabled={readOnly}
                                            />
                                          </div>
                                          <div className="space-y-2 md:col-span-2">
                                            <div className="text-xs font-medium text-muted-foreground">Priority Notes</div>
                                            <Textarea
                                              value={designBriefDraft.priorityNotes}
                                              onChange={(e) => setDesignBriefDraft((prev) => ({ ...prev, priorityNotes: e.target.value }))}
                                              placeholder="Rush notes, sequencing, or internal priorities"
                                              className="min-h-20"
                                              disabled={readOnly}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    <div className="mb-3 rounded-md border border-border/40 bg-muted/20 p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <div>
                                          <div className="text-sm font-medium">Line Item Internal Notes</div>
                                          <div className="text-xs text-muted-foreground">
                                            Structured staff notes for this line item. Legacy production notes remain below for compatibility.
                                          </div>
                                        </div>
                                        {lineItemInternalNotesQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                      </div>

                                      <div className="mt-3 space-y-2">
                                        {(lineItemInternalNotesQuery.data ?? []).length === 0 ? (
                                          <div className="rounded-md border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                                            No structured line item internal notes yet.
                                          </div>
                                        ) : (
                                          (lineItemInternalNotesQuery.data ?? []).map((note) => (
                                            <div key={note.id} className="rounded-md border border-border/50 bg-background/80 p-3">
                                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                                <span>{note.createdByUserName || "Unknown user"}</span>
                                                <span>{new Date(note.createdAt).toLocaleString()}</span>
                                              </div>
                                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{note.noteText}</div>
                                            </div>
                                          ))
                                        )}

                                        {!readOnly && isExpanded && expandedItem && expandedItem.id === item.id && (
                                          <div className="space-y-2 pt-1">
                                            <Textarea
                                              value={lineItemInternalNoteDraft}
                                              onChange={(e) => setLineItemInternalNoteDraft(e.target.value)}
                                              placeholder="Add a structured internal note for this line item..."
                                              className="min-h-24"
                                            />
                                            <div className="flex justify-end">
                                              <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => addLineItemInternalNote.mutate({ lineItemId: item.id, noteText: lineItemInternalNoteDraft })}
                                                disabled={addLineItemInternalNote.isPending || lineItemInternalNoteDraft.trim().length === 0}
                                              >
                                                {addLineItemInternalNote.isPending ? "Adding..." : "Add Line Item Internal Note"}
                                              </Button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                }
                                artworkSlot={
                                  <>
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
                                      if (policy !== "required" && !isMissingArtworkSuppressed) return null;

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
                                                {isMissingArtworkSuppressed ? (
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
                                                ) : missingArtworkActive ? (
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
                                              {isMissingArtworkSuppressed ? (
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
                                  </>
                                }
                                requiresDesign={isExpanded && expandedItem?.id === item.id ? requiresDesignInput : Boolean((item as any).requiresDesign)}
                                requiresPrepress={isExpanded && expandedItem?.id === item.id ? requiresPrepressInput : ((item as any).requiresPrepress ?? null)}
                                requiresProofApproval={Boolean((item as any).requiresProofApproval)}
                                onRequiresDesignChange={!readOnly && isExpanded && expandedItem?.id === item.id ? setRequiresDesignInput : undefined}
                                onRequiresPrepressChange={!readOnly && isExpanded && expandedItem?.id === item.id ? setRequiresPrepressInput : undefined}
                                topAnchorRef={setLineItemTopAnchorRef(String(item.id))}
                                widthInputRef={setLineItemWidthInputRef(String(item.id))}
                                detailsSide="right"
                                collapseSecondaryDetails={true}
                                compactExpandedLayout={true}
                                isDirty={isExpanded && expandedItem && expandedItem.id === item.id ? isDirty : false}
                                isSaving={savingItemId === item.id}
                                isSaved={!isDirty && (savedItemId === item.id || designBriefSavedAt === item.id)}
                                onSave={readOnly ? undefined : handleSaveItem}
                                onDuplicate={readOnly ? undefined : () => void handleDuplicateItem(item)}
                                onRemove={readOnly ? undefined : () => void handleRemoveItem(item.id)}
                                readOnly={readOnly}
                              />

                              <div className="mt-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</span>
                                      <Badge variant={workflowBadgeVariant(workflowState)}>
                                        {operationalStatusLabel}
                                      </Badge>
                                      {lineItemProofSummary ? (
                                        <Badge
                                          variant="outline"
                                          className={cn(getLineItemProofBadgeClass(lineItemProofSummary.status))}
                                        >
                                          {lineItemProofSummary.label}
                                        </Badge>
                                      ) : null}
                                      {operationalWarning ? (
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
                                            operationalWarningTone === "danger"
                                              ? "bg-red-100 text-red-800"
                                              : "bg-amber-100 text-amber-800"
                                          )}
                                        >
                                          {operationalWarning}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 text-sm">
                                      <span className="text-muted-foreground">Next step:</span>{" "}
                                      <span className="font-medium text-foreground">{operationalNextStep}</span>
                                    </div>
                                    {ownerLabel ? (
                                      <div className="mt-1 text-xs text-muted-foreground">Owner: {String(ownerLabel)}</div>
                                    ) : null}
                                  </div>

                                  {!readOnly && getWorkflowActions(workflowState).length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                      {showOpenProofingAction ? (
                                        <Button asChild type="button" variant="outline" size="sm" className="h-8">
                                          <Link to={buildProofingLineItemPath(item.id)}>Open Proofing</Link>
                                        </Button>
                                      ) : null}
                                      {getWorkflowActions(workflowState).map((action, index) => (
                                      <Button
                                        key={`${item.id}-${index}`}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8"
                                        disabled={transitionWorkflow.isPending}
                                        onClick={() => transitionWorkflow.mutate({
                                          lineItemId: String(item.id),
                                          toState: action.toState,
                                          action: (action as any).action,
                                        })}
                                      >
                                        {action.label}
                                      </Button>
                                    ))}
                                    </div>
                                  )}
                                  {!readOnly && showOpenProofingAction && getWorkflowActions(workflowState).length === 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                      <Button asChild type="button" variant="outline" size="sm" className="h-8">
                                        <Link to={buildProofingLineItemPath(item.id)}>Open Proofing</Link>
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
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
                  <span className="text-muted-foreground">{searchQuery ? "Searching: " + searchQuery : "Add Product"}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[520px] p-0"
                align="start"
                onCloseAutoFocus={(event) => {
                  // Prevent Radix from restoring focus to the footer trigger when the popover
                  // closes. The pendingJumpToLineItemId scroll effect moves focus to the new
                  // line-item anchor so Width / Height / Qty stay in view.
                  event.preventDefault();
                }}
              >
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Search by name, SKU, or category..." value={searchQuery} onValueChange={setSearchQuery} />
                  <CommandList>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {filteredProducts.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.name + " " + ((p as any).sku || "") + " " + ((p as any).category || "")}
                          onSelect={async () => {
                            try {
                              blurActiveElement();
                              const activeTree = normalizePbv2Tree(getPbv2Tree(p));
                              const initialDraft = buildInitialOrderLineItemDraftFromProduct(p as any, activeTree, orderId);
                              console.info("[OrderLineItemsSection.addProduct.initialDraft]", initialDraft.debug);

                              const {
                                debug: _debug,
                                requiresProductionJob: _requiresProductionJob,
                                ...createPayload
                              } = initialDraft;
                              const created = await createLineItem.mutateAsync(createPayload);
                              const nextId = created?.data?.id ?? created?.id ?? null;
                              setSearchQuery("");
                              setSearchOpen(false);
                              if (typeof nextId === "string" && nextId.length) {
                                setInitialDraftDebugByLineItemId((prev) => ({ ...prev, [nextId]: initialDraft.debug }));
                                setUserEditedOptionsByLineItemId((prev) => ({ ...prev, [nextId]: false }));
                                setExpandedId(nextId);
                                setPendingJumpToLineItemId(nextId);
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

      <Dialog
        open={!!artworkModalLineItemId}
        onOpenChange={(open) => {
          if (!open) setArtworkModalLineItemId(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{artworkModalProductName ? "Artwork — " + artworkModalProductName : "Artwork"}</DialogTitle>
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
