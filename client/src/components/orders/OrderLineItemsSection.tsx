import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
import { isSessionExpiredError, notifySessionExpired, SESSION_EXPIRED_MESSAGE } from "@/lib/authUtils";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { LineItemThumbnail } from "@/components/LineItemThumbnail";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { toAttachmentViewerAttachments } from "@/lib/attachmentViewer";
import { deriveLineItemPricingDisplay, deriveVisibleLineItemPriceDisplay } from "@/components/orders/lineItemPricingDisplay";
import { buildQuoteCalculatePayload } from "@/components/orders/quoteCalculatePayload";
import { filterAndPrioritizeProductsForMaterial } from "@/components/orders/productSuggestionPriority";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { orderDetailQueryKey, useCreateOrderLineItem, useDeleteOrderLineItem, useTransitionLineItemWorkflow, useUpdateOrderLineItem } from "@/hooks/useOrders";
import { useOrderFiles } from "@/hooks/useOrderFiles";
import type { OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useOrderLineItemPreviews } from "@/hooks/useOrderLineItemPreviews";
import { useScheduleOrderLineItemsForProduction } from "@/hooks/useProduction";
import { buildProofingLineItemPath, shouldOfferProofingNavigation } from "@/lib/proofingNavigation";
import { getLineItemProofBadgeClass } from "@/lib/orderProofUi";

import { computePbv2InputSignature, pickPbv2EnvExtras } from "@shared/pbv2/pbv2InputSignature";
import { LineItemCard } from "@/components/line-items/LineItemCard";
import {
  getOrderLineItemActiveWorkWarning,
  buildOrderLineNumberMap,
  applyOrderLineItemReorder,
  moveOrderLineItemIds,
  persistOrderLineItemReorder,
  buildOrderLineItemProductionActionRequests,
  getLineItemWorkflowActionLabel,
  getGroupedOrderLineItemProductionActions,
  getOrderLineItemProductionActions,
  getProductionScheduleTargetIds,
  getSelectableProductionLineItemIds,
  isChildLineItem,
  resolveOrderLineItemOperationalDisplay,
  sortOrderLineItemsByPersistedOrder,
  type OrderLineItemProductionAction,
} from "@/components/orders/orderLineItemEditorUi";
import { OrderLineItemSelectAllControl } from "@/components/orders/OrderLineItemSelectAllControl";
import {
  buildPbv2DefaultsHydrationKey,
  hasPbv2Selections,
  shouldHydratePbv2Defaults,
} from "@shared/pbv2OrderEntryRuntime";
import { getPbv2FixedDimensions } from "@shared/pbv2/fixedDimensions";
import { productRequiresEnteredDimensions } from "@shared/productMeasurementMode";
import { skipsRequiredPrintOptionValidation } from "@shared/productPricingValidation";
import { formatLineItemMeasurementLabel } from "@shared/lineItemPresentation";
import { resolveProductionSides } from "@shared/productionHydration";
import { removeArtworkFileReferencesFromSpecs } from "@shared/artworkSideAssignment";
import { buildLineItemOptionSummaryChips } from "@shared/lineItemOptionSelections";
import {
  buildInitialOrderLineItemDraftFromProduct,
  type InitialOrderLineItemDraftDebug,
} from "@shared/orderLineItemInitialization";
import {
  applyLineItemEditPriceOverride,
  getLineItemPriceOverrideLabel,
  hydrateLineItemEditPricingState,
  isLineItemPriceOverrideMode,
  type LineItemEffectivePricing,
  type LineItemPriceOverrideMode,
} from "@shared/lineItemPriceOverrides";
import {
  buildProductReplacementDraft,
  buildOrderLineItemDuplicatePayload,
  buildSavedSnapshotAfterLineItemSave,
  hydrateExpandedOrderLineItemOptionState,
  hydratePersistedArtworkSideIntent,
  mergeArtworkSideIntentIntoSpecs,
  hasOrderLineItemDraftChanges,
  reconcileLineItemListSafely,
  normalizeVariantId,
  shouldApplyOrderLineItemPreviewResult,
  type OrderLineItemSavedSnapshot,
} from "@/components/orders/orderLineItemEditState";

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

function requiresDimensions(product: Product | null, treeJson?: OptionTreeV2 | null): boolean {
  return productRequiresEnteredDimensions(product, treeJson);
}

function getPbv2SnapshotFromLineItem(lineItem: any): any | null {
  if (!lineItem || typeof lineItem !== "object") return null;
  return (lineItem as any).pbv2SnapshotJson ?? (lineItem as any).pbv2_snapshot_json ?? null;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function getLineItemPriceOverrideMeta(lineItem: any): any | null {
  const direct = lineItem?.priceOverride;
  if (direct && typeof direct === "object") return direct;
  const specs = lineItem?.specsJson;
  const meta = specs && typeof specs === "object" ? (specs as any).priceOverride : null;
  return meta && typeof meta === "object" ? meta : null;
}

function getLineItemPriceOverrideMode(lineItem: any): LineItemPriceOverrideMode | null {
  if (lineItem?.hasPriceOverride === false) return null;
  if (isLineItemPriceOverrideMode(lineItem?.priceOverrideMode)) return lineItem.priceOverrideMode;
  const meta = getLineItemPriceOverrideMeta(lineItem);
  if (isLineItemPriceOverrideMode(meta?.mode)) return meta.mode;
  if (isLineItemPriceOverrideMode(meta?.priceOverrideMode)) return meta.priceOverrideMode;
  if (meta?.mode === "total") return "override_total_after_margin";
  if (meta?.mode === "unit") return "override_unit_after_margin";
  return null;
}

function getLineItemBaseCalculatedTotalCents(lineItem: any, fallbackTotal: number): number {
  const topLevelBase = Number(lineItem?.baseCalculatedTotalCents);
  if (Number.isFinite(topLevelBase)) return Math.round(topLevelBase);
  const meta = getLineItemPriceOverrideMeta(lineItem);
  const metaBase = Number(meta?.baseCalculatedTotalCents);
  if (Number.isFinite(metaBase)) return Math.round(metaBase);
  const snapshotBase = Number(lineItem?.pbv2SnapshotJson?.pricing?.totalCents);
  if (Number.isFinite(snapshotBase)) return Math.round(snapshotBase);
  return Math.round((Number.isFinite(fallbackTotal) ? fallbackTotal : 0) * 100);
}

function getLineItemOverrideInputValue(lineItem: any, mode: LineItemPriceOverrideMode | null, fallbackTotal: number): number {
  const topLevelValueCents = Number(lineItem?.priceOverrideValueCents);
  if (Number.isFinite(topLevelValueCents)) return topLevelValueCents / 100;
  const meta = getLineItemPriceOverrideMeta(lineItem);
  const metaValueCents = Number(meta?.valueCents);
  if (Number.isFinite(metaValueCents)) return metaValueCents / 100;
  const metaPriceOverrideValueCents = Number(meta?.priceOverrideValueCents);
  if (Number.isFinite(metaPriceOverrideValueCents)) return metaPriceOverrideValueCents / 100;
  const legacyDollarValue = Number(meta?.value);
  if (Number.isFinite(legacyDollarValue)) return legacyDollarValue;
  if (mode === "override_unit_after_margin" || mode === "override_unit_before_margin") {
    const qty = Number(lineItem?.quantity) > 0 ? Number(lineItem.quantity) : 1;
    return fallbackTotal / qty;
  }
  return fallbackTotal;
}

type PendingLineItemPriceOverride = Pick<
  LineItemEffectivePricing,
  | "baseCalculatedUnitPriceCents"
  | "baseCalculatedTotalCents"
  | "effectiveUnitPriceCents"
  | "effectiveTotalCents"
  | "priceOverrideMode"
  | "priceOverrideValueCents"
  | "priceOverrideValuePercent"
  | "hasPriceOverride"
>;

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

/** Imperative API the parent order editor uses to orchestrate a Save Order. */
export type OrderLineItemDirtyDiagnostics = {
  expandedLineItemDirty: boolean;
  productReplacementDirty: boolean;
  designBriefDirty: boolean;
  expandedLineItemId: string | null;
  draftProductId: string | null;
  savedProductId: string | null;
  draftProductVariantId: string | null;
  savedProductVariantId: string | null;
  draftPbv2TreeVersionId: string | null;
  savedPbv2TreeVersionId: string | null;
  computedTotal: number | null;
  savedTotal: number | null;
};

export type OrderLineItemsSectionHandle = {
  /**
   * Persists the currently-expanded line item when it has unsaved edits.
   * No-op (resolves `{ saved: true }`) when nothing is dirty.
   */
  saveDirtyLineItem: () => Promise<{ saved: boolean; error?: string }>;
  /** Returns the current expanded-line dirty reporters for save/nav diagnostics. */
  getDirtyDiagnostics: () => OrderLineItemDirtyDiagnostics;
};

type OrderLineItemsSectionProps = {
  orderId: string;
  customerId?: string | null;
  readOnly: boolean;
  lineItems: OrderLineItem[];
  /** Cancelled orders retain their sold line-item history for read-only review. */
  showHistoricalCanceledLineItems?: boolean;
  productionFocusLineItemIds?: string[];
  productionPriorityLineItemIds?: string[];
  onAfterLineItemsChange?: () => Promise<void>;
  /** Reports whether the expanded line item has unsaved edits. */
  onDirtyStateChange?: (hasUnsavedLineItem: boolean) => void;
  /** Reports temporary edit-state line totals so the parent totals card can mirror the pending save payload. */
  onDraftLineItemPricingChange?: (lineItemId: string, effectiveTotalCents: number | null) => void;
};

export const OrderLineItemsSection = forwardRef<OrderLineItemsSectionHandle, OrderLineItemsSectionProps>(
  function OrderLineItemsSection({
  orderId,
  customerId,
  readOnly,
  lineItems,
  showHistoricalCanceledLineItems = false,
  productionFocusLineItemIds = [],
  productionPriorityLineItemIds = [],
  onAfterLineItemsChange,
  onDirtyStateChange,
  onDraftLineItemPricingChange,
}, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isPlatformAdmin, isPlatformDeveloper } = useAuth();
  const { preferences: orgPreferences } = useOrgPreferences();
  const canSeeDebug = isAdmin || isPlatformAdmin || isPlatformDeveloper;
  const [showLineItemDebug, setShowLineItemDebug] = useState(false);
  const [productionBypassTarget, setProductionBypassTarget] = useState<OrderLineItem | null>(null);
  const [productionBypassReason, setProductionBypassReason] = useState("");
  const [childParentLineItemId, setChildParentLineItemId] = useState<string | null>(null);
  const [parentLinkTarget, setParentLinkTarget] = useState<OrderLineItem | null>(null);
  const [selectedParentLineItemId, setSelectedParentLineItemId] = useState<string | null>(null);

  const [pbv2CurrentSignatureByLineItemId, setPbv2CurrentSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2SnapshotSignatureByLineItemId, setPbv2SnapshotSignatureByLineItemId] = useState<Record<string, string>>({});
  const [pbv2KeepAckByLineItemId, setPbv2KeepAckByLineItemId] = useState<Record<string, string>>({});

  // Production scheduling state
  const [selectedForProduction, setSelectedForProduction] = useState<Set<string>>(new Set());
  const scheduleProduction = useScheduleOrderLineItemsForProduction(orderId);;
  const transitionWorkflow = useTransitionLineItemWorkflow(orderId);
  const [productionOwnerOverrides, setProductionOwnerOverrides] = useState<Record<string, {
    activeOwnerJobId?: string | null;
    activeOwnerStationKey?: string | null;
    activeOwnerStepKey?: string | null;
    activeOwnerStatus?: string | null;
    workflowState?: string | null;
  }>>({});
  const productionAction = useMutation({
    mutationFn: async (input: {
      action: OrderLineItemProductionAction;
      targets: Array<{
        lineItemId: string;
        jobId: string;
        stationKey?: string | null;
      }>;
    }) => {
      const requests = input.targets.flatMap((target) => buildOrderLineItemProductionActionRequests({
        action: input.action,
        ...target,
      }));
      let result: any = null;
      for (const request of requests) {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.body ? { "Content-Type": "application/json" } : undefined,
          body: request.body ? JSON.stringify(request.body) : undefined,
          credentials: "include",
        });
        result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || result.message || `Failed to ${input.action.replace(/_/g, " ")}`);
      }
      return result;
    },
    onMutate: (input) => {
      const previous = Object.fromEntries(input.targets.map((target) => [target.lineItemId, productionOwnerOverrides[target.lineItemId]]));
      setProductionOwnerOverrides((current) => {
        const next = { ...current };
        for (const target of input.targets) {
          next[target.lineItemId] = input.action === "return_to_prepress"
            ? {
                activeOwnerJobId: target.jobId,
                activeOwnerStationKey: "prepress",
                activeOwnerStepKey: "prepress",
                activeOwnerStatus: "queued",
                workflowState: "in_prepress",
              }
            : {
                activeOwnerJobId: target.jobId,
                activeOwnerStationKey: target.stationKey ?? null,
                activeOwnerStatus: input.action === "hold" ? "paused" : "in_progress",
                workflowState: "in_production",
              };
        }
        return next;
      });
      return { previous };
    },
    onSuccess: async (_result, input) => {
      toast({
        title: input.action === "return_to_prepress" ? "Sent to prepress" : "Production updated",
        description: input.action === "hold"
          ? "Production is on hold."
          : input.action === "complete"
            ? "Production step completed."
            : input.action === "return_to_prepress"
              ? "The line item is back in the prepress queue."
              : "Production started.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] }),
      ]);
      await onAfterLineItemsChange?.();
      setProductionOwnerOverrides((current) => {
        const next = { ...current };
        input.targets.forEach((target) => delete next[target.lineItemId]);
        return next;
      });
    },
    onError: (error: Error, input, context) => {
      setProductionOwnerOverrides((current) => {
        const next = { ...current };
        input.targets.forEach((target) => {
          if (context?.previous?.[target.lineItemId]) next[target.lineItemId] = context.previous[target.lineItemId];
          else delete next[target.lineItemId];
        });
        return next;
      });
      toast({ title: "Workflow action failed", description: error.message, variant: "destructive" });
    },
  });

  const productionBypass = useMutation({
    mutationFn: async ({ lineItemId, reason }: { lineItemId: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/order-line-items/${lineItemId}/production-bypass`, { reason });
      return response.json();
    },
    onSuccess: async () => {
      toast({ title: "Production bypassed", description: "This line no longer requires artwork, prepress, or production scheduling." });
      setProductionBypassTarget(null);
      setProductionBypassReason("");
      await queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      await onAfterLineItemsChange?.();
    },
    onError: (error: Error) => toast({ title: "Unable to bypass production", description: error.message, variant: "destructive" }),
  });

  const parentLinkMutation = useMutation({
    mutationFn: async ({ lineItemId, parentLineItemId }: { lineItemId: string; parentLineItemId: string | null }) => {
      const response = await apiRequest("PATCH", `/api/order-line-items/${lineItemId}/parent`, { parentLineItemId });
      return response.json();
    },
    onSuccess: async () => {
      toast({ title: "Line item relationship updated" });
      setParentLinkTarget(null);
      setSelectedParentLineItemId(null);
      await queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      await onAfterLineItemsChange?.();
    },
    onError: (error: Error) => toast({ title: "Unable to update parent", description: error.message, variant: "destructive" }),
  });

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

  const previousLineItemsRef = useRef<OrderLineItem[]>([]);
  const displayLineItems = useMemo(() => {
    return reconcileLineItemListSafely(previousLineItemsRef.current as any[], lineItems as any[], {
      patchKind: "hydration",
      preserveLocalDrafts: false,
    }) as OrderLineItem[];
  }, [lineItems]);

  useEffect(() => {
    previousLineItemsRef.current = displayLineItems;
  }, [displayLineItems]);
  const lineItemAssetsAssociationKnown = lineItemPreviewsQuery.isSuccess;

  const activeLineItems = useMemo(
    () => sortOrderLineItemsByPersistedOrder(displayLineItems.filter((li) => showHistoricalCanceledLineItems || li.status !== "canceled") as any[]) as OrderLineItem[],
    [displayLineItems, showHistoricalCanceledLineItems]
  );

  const canEditLineItemRecord = useCallback(
    (item: OrderLineItem) => {
      if (readOnly) return false;

      const status = String((item as any)?.status ?? "").toLowerCase();
      const workflowState = String((item as any)?.workflowState ?? "new").toLowerCase();
      const lockedStates = new Set(["completed", "complete", "canceled", "cancelled"]);

      return !lockedStates.has(status) && !lockedStates.has(workflowState);
    },
    [readOnly]
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

    setOrderedKeys((prev) => prev.length === nextIds.length && prev.every((id, index) => id === nextIds[index]) ? prev : nextIds);
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

  const nestedOrderedLineItems = useMemo(() => {
    const byId = new Map(orderedLineItems.map((item) => [String(item.id), item] as const));
    const childrenByParent = new Map<string, OrderLineItem[]>();
    const roots: OrderLineItem[] = [];

    for (const item of orderedLineItems) {
      const parentId = (item as any).parentLineItemId as string | null | undefined;
      if (parentId && byId.has(String(parentId))) {
        const children = childrenByParent.get(String(parentId)) ?? [];
        children.push(item);
        childrenByParent.set(String(parentId), children);
      } else {
        roots.push(item);
      }
    }

    return roots.flatMap((parent) => [parent, ...(childrenByParent.get(String(parent.id)) ?? [])]);
  }, [orderedLineItems]);

  const sortableItems = useMemo(
    () => nestedOrderedLineItems.map((lineItem) => String(lineItem.id)),
    [nestedOrderedLineItems]
  );

  const lineNumberById = useMemo(
    () => buildOrderLineNumberMap(sortableItems),
    [sortableItems],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [priceEditTextById, setPriceEditTextById] = useState<Record<string, string>>({});
  const [priceOverrideModeById, setPriceOverrideModeById] = useState<Record<string, LineItemPriceOverrideMode>>({});
  const [pendingPriceOverrideById, setPendingPriceOverrideById] = useState<Record<string, PendingLineItemPriceOverride>>({});
  const pendingPriceOverrideRef = useRef<Record<string, PendingLineItemPriceOverride>>({});
  const pricingDirtyByUserRef = useRef<Record<string, boolean>>({});
  const latestPricingFingerprintRef = useRef("");
  const lastUserPricingFingerprintRef = useRef<Record<string, string>>({});

  useEffect(() => {
    pendingPriceOverrideRef.current = pendingPriceOverrideById;
  }, [pendingPriceOverrideById]);

  const markPricingDirtyByUser = useCallback((lineItemId: string | null | undefined, reason: string) => {
    if (!lineItemId) return;
    pricingDirtyByUserRef.current = {
      ...pricingDirtyByUserRef.current,
      [lineItemId]: true,
    };
    lastUserPricingFingerprintRef.current[lineItemId] = latestPricingFingerprintRef.current;
    if (import.meta.env.DEV) {
      console.warn("[OrderLineItemsSection] Pricing draft marked dirty by user", {
        lineItemId,
        reason,
        fingerprint: latestPricingFingerprintRef.current,
      });
    }
  }, []);

  const resetPricingDirtyByUser = useCallback((lineItemId: string | null | undefined) => {
    if (!lineItemId) return;
    pricingDirtyByUserRef.current = {
      ...pricingDirtyByUserRef.current,
      [lineItemId]: false,
    };
    delete lastUserPricingFingerprintRef.current[lineItemId];
  }, []);

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
    const liveIds = new Set(displayLineItems.map((item) => String(item.id)));
    for (const lineItemId of Object.keys(lineItemTopAnchorRefs.current)) {
      if (!liveIds.has(lineItemId)) {
        delete lineItemTopAnchorRefs.current[lineItemId];
        delete lineItemWidthInputRefs.current[lineItemId];
      }
    }
    setPendingPriceOverrideById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const lineItemId of Object.keys(next)) {
        if (!liveIds.has(lineItemId)) {
          delete next[lineItemId];
          onDraftLineItemPricingChange?.(lineItemId, null);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [displayLineItems]);

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
    () => displayLineItems.find((li) => li.id === expandedId) ?? null,
    [displayLineItems, expandedId]
  );
  const [draftProductId, setDraftProductId] = useState("");
  const [draftProductVariantId, setDraftProductVariantId] = useState<string | null>(null);
  const currentDraftProductId = draftProductId || expandedItem?.productId || "";
  const currentDraftProductVariantId = normalizeVariantId(draftProductVariantId ?? expandedItem?.productVariantId ?? null);

  const expandedProduct = useMemo(() => {
    if (!expandedItem) return null;
    const effectiveProductId = draftProductId || expandedItem.productId;
    return products.find((p) => p.id === effectiveProductId) ?? null;
  }, [draftProductId, expandedItem, products]);
  const expandedProductPbv2Runtime = expandedProduct as ProductWithPbv2Runtime | null;
  const expandedSkipsPrintOptionValidation = skipsRequiredPrintOptionValidation(expandedProduct);
  const expandedItemPbv2Runtime = expandedItem as OrderLineItemWithPbv2Runtime | null;
  const draftMatchesPersistedProduct = Boolean(expandedItem && currentDraftProductId === expandedItem.productId);
  const effectiveLineItemPbv2Runtime = draftMatchesPersistedProduct ? expandedItemPbv2Runtime : null;

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
  const fixedDimensions = getPbv2FixedDimensions(effectivePbv2Tree);
  const dimsRequired = requiresDimensions(expandedProduct, effectivePbv2Tree);

  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [requiresDesignInput, setRequiresDesignInput] = useState(false);
  const [requiresPrepressInput, setRequiresPrepressInput] = useState(true);
  const [requiresProofApprovalInput, setRequiresProofApprovalInput] = useState(false);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [useSameArtworkBothSides, setUseSameArtworkBothSides] = useState(false);
  const [artworkRemovalByLineItemId, setArtworkRemovalByLineItemId] = useState<Record<string, {
    fileIds: string[];
    removedBothSide: boolean;
  }>>({});
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
      OrderLineItemSavedSnapshot
    >
  >({});
  const initializedExpandedLineItemRef = useRef<string | null>(null);
  // Monotonic id per preview request. Incrementing it cancels older responses.
  const lastCalcKeyRef = useRef<string>("");
  const calcSeqRef = useRef(0);

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
  }, [expandedItem?.id, expandedItem?.productId, expandedItem?.productVariantId]);

  // Inline add product search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const knownMaterialIdForSuggestions = useMemo(() => {
    const fromLineItem = (expandedItem as any)?.productPrimaryMaterialId;
    if (typeof fromLineItem === "string" && fromLineItem.trim()) return fromLineItem.trim();
    const fromProduct = (expandedProduct as any)?.primaryMaterialId;
    if (typeof fromProduct === "string" && fromProduct.trim()) return fromProduct.trim();
    return null;
  }, [expandedItem, expandedProduct]);

  const [artworkViewerLineItemId, setArtworkViewerLineItemId] = useState<string | null>(null);

  const [missingArtworkSuppressReason, setMissingArtworkSuppressReason] = useState<string>("");
  const [savingFlagLineItemId, setSavingFlagLineItemId] = useState<string | null>(null);

  useEffect(() => {
    setMissingArtworkSuppressReason("");
  }, [expandedId]);

  const artworkViewerAttachments = useMemo(() => {
    const attachedFiles = (allOrderFiles as any[]).filter(
      (file) => String(file?.orderLineItemId ?? "") === String(artworkViewerLineItemId ?? ""),
    );
    if (attachedFiles.length > 0) return toAttachmentViewerAttachments(attachedFiles);
    const previewUrl = artworkViewerLineItemId
      ? lineItemPreviews[String(artworkViewerLineItemId)]?.thumbUrls?.[0]
      : null;
    return previewUrl
      ? toAttachmentViewerAttachments([{
          id: `line-item-preview-${artworkViewerLineItemId}`,
          fileName: "Artwork preview",
          mimeType: "image/jpeg",
          previewUrl,
          thumbnailUrl: previewUrl,
        }])
      : [];
  }, [allOrderFiles, artworkViewerLineItemId, lineItemPreviews]);

  const filteredProducts = useMemo(() => {
    return filterAndPrioritizeProductsForMaterial(products as any[], searchQuery, knownMaterialIdForSuggestions) as Product[];
  }, [knownMaterialIdForSuggestions, products, searchQuery]);

  const pbv2DefaultsHydratedRef = useRef<Set<string>>(new Set());
  const [initialDraftDebugByLineItemId, setInitialDraftDebugByLineItemId] = useState<Record<string, InitialOrderLineItemDraftDebug>>({});
  const [userEditedOptionsByLineItemId, setUserEditedOptionsByLineItemId] = useState<Record<string, boolean>>({});
  const markUserEditedOptions = useCallback((lineItemId: string | null | undefined) => {
    if (!lineItemId) return;
    setUserEditedOptionsByLineItemId((prev) => ({ ...prev, [lineItemId]: true }));
  }, []);

  const expandedItemHydrationFingerprint = useMemo(() => {
    if (!expandedItem) return null;
    const activeTreeNodes = effectivePbv2Tree
      ? Object.values(effectivePbv2Tree.nodes ?? {}).map((node: any) => ({
          id: node?.id,
          key: node?.key,
          label: node?.label,
          selectionKey: node?.input?.selectionKey,
          defaultValue: node?.input?.defaultValue,
          choices: Array.isArray(node?.choices)
            ? node.choices.map((choice: any) => ({ id: choice?.id, key: choice?.key, value: choice?.value, label: choice?.label }))
            : [],
        }))
      : null;
    return stableStringify({
      id: expandedItem.id,
      productId: expandedItem.productId ?? null,
      productVariantId: expandedItem.productVariantId ?? null,
      pbv2TreeVersionId: (expandedItem as any).pbv2TreeVersionId ?? null,
      optionSelectionsJson: (expandedItem as any).optionSelectionsJson ?? null,
      selectedOptions: (expandedItem as any).selectedOptions ?? null,
      snapshotSelections: (expandedItem as any).pbv2SnapshotJson?.selections ?? null,
      snapshotEffectiveSelections: (expandedItem as any).pbv2SnapshotJson?.pbv2PricingSnapshot?.effectiveSelections ?? null,
      tree: activeTreeNodes,
    });
  }, [effectivePbv2Tree, expandedItem]);

  const expandedItemOptionHydration = useMemo(
    () => expandedItem
      ? hydrateExpandedOrderLineItemOptionState(expandedItem, effectivePbv2Tree)
      : null,
    [expandedItemHydrationFingerprint, effectivePbv2Tree],
  );

  // Initialize local editor state when expanded item changes
  useEffect(() => {
    if (!expandedItem) {
      initializedExpandedLineItemRef.current = null;
      return;
    }
    const itemId = expandedItem.id;
    if (initializedExpandedLineItemRef.current === expandedItemHydrationFingerprint) return;
    initializedExpandedLineItemRef.current = expandedItemHydrationFingerprint;

    setDraftProductId(String(expandedItem.productId || ""));
    setDraftProductVariantId(normalizeVariantId(expandedItem.productVariantId));
    const fixed = getPbv2FixedDimensions(effectivePbv2Tree);
    const quantityOnly = (expandedProduct as any)?.measurementMode === "quantity_only";
    setWidthText(String(fixed?.widthIn ?? (quantityOnly ? 0 : expandedItem.width ?? 1)));
    setHeightText(String(fixed?.heightIn ?? (quantityOnly ? 0 : expandedItem.height ?? 1)));
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
    setRequiresProofApprovalInput(Boolean((expandedItem as any).requiresProofApproval));

    const persistedSelections = expandedItemOptionHydration
      ?? hydrateExpandedOrderLineItemOptionState(expandedItem, effectivePbv2Tree);
    const persistedArtworkSideIntent = hydratePersistedArtworkSideIntent(expandedItem);
    const selections = persistedSelections.optionSelections;
    setOptionSelections(selections);
    setUseSameArtworkBothSides(persistedArtworkSideIntent.useSameArtworkBothSides);

    const nextSelectionsV2: LineItemOptionSelectionsV2 =
      Object.keys(persistedSelections.optionSelectionsV2.selected).length > 0
        ? persistedSelections.optionSelectionsV2
        : (expandedItem.specsJson as any)?.initialDraft?.optionSelectionsJson &&
            typeof (expandedItem.specsJson as any).initialDraft.optionSelectionsJson === "object" &&
            (expandedItem.specsJson as any).initialDraft.optionSelectionsJson.schemaVersion === 2
          ? ((expandedItem.specsJson as any).initialDraft.optionSelectionsJson as LineItemOptionSelectionsV2)
          : persistedSelections.optionSelectionsV2;
    setOptionSelectionsV2(nextSelectionsV2);

    // Hydrate PBV2 snapshot from line item (used to render option questions)
    const savedSnapshot = getPbv2SnapshotFromLineItem(expandedItem);
    setPbv2SnapshotJson(savedSnapshot);

    setCalcError(null);

    const persistedPricing = hydrateLineItemEditPricingState(expandedItem);
    const currentTotal = persistedPricing.persistedEffectiveTotalCents / 100;
    setComputedTotal(Number.isFinite(currentTotal) ? currentTotal : 0);
    setComputedTotalQty(expandedItem.quantity || 1);
    setPendingPriceOverrideById((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    onDraftLineItemPricingChange?.(itemId, null);
    resetPricingDirtyByUser(itemId);
    calcSeqRef.current += 1;
    setIsCalculating(false);
    setPreviewDiag(null);
    const currentOverrideMode = persistedPricing.priceOverrideMode;
    const priceForEditor =
      currentOverrideMode
        ? getLineItemOverrideInputValue(expandedItem, currentOverrideMode, currentTotal)
        : currentTotal;
    if (currentOverrideMode) {
      setPriceOverrideModeById((prev) => ({ ...prev, [itemId]: currentOverrideMode }));
    }
    setPriceEditTextById((prev) => ({ ...prev, [itemId]: priceForEditor.toFixed(2) }));
    setEditingPriceItemId(null);

    savedSnapshotRef.current[itemId] = {
      productId: String(expandedItem.productId || ""),
      productVariantId: normalizeVariantId(expandedItem.productVariantId),
      pbv2TreeVersionId: String(
        (expandedItem as any).pbv2TreeVersionId ??
          (expandedItem as any).pbv2ActiveTreeVersionId ??
          getPbv2SnapshotFromLineItem(expandedItem)?.treeVersionId ??
          ""
      ),
      width: fixed?.widthIn ?? (quantityOnly ? 0 : (Number.parseFloat(expandedItem.width || "1") || 1)),
      height: fixed?.heightIn ?? (quantityOnly ? 0 : (Number.parseFloat(expandedItem.height || "1") || 1)),
      quantity: expandedItem.quantity || 1,
      notes: nextNotes,
      productionNotes: nextProductionNotes,
      requiresDesign: Boolean((expandedItem as any).requiresDesign),
      requiresPrepress: Boolean((expandedItem as any).requiresPrepress),
      requiresProofApproval: Boolean((expandedItem as any).requiresProofApproval),
      optionSelections: selections,
      optionSelectionsV2: nextSelectionsV2.selected ?? {},
      useSameArtworkBothSides: persistedArtworkSideIntent.useSameArtworkBothSides,
      totalPrice: currentTotal,
    };
  }, [expandedItemHydrationFingerprint, expandedItemOptionHydration, effectivePbv2Tree, onDraftLineItemPricingChange, resetPricingDirtyByUser]);

  // Hydrate PBV2 defaults from the product tree when a line item is first expanded
  // with no saved selections. resolveRuntimeVisibility computes effective defaults from
  // node.input.defaultValue, so we wrap that result into the LineItemOptionSelectionsV2 shape.
  useEffect(() => {
    const lineItemId = expandedItem?.id;
    const hydrationKey = buildPbv2DefaultsHydrationKey({
      lineItemId,
      productId: currentDraftProductId || expandedProduct?.id || null,
      activeTreeVersionId: getOrderLineItemPbv2TreeVersionId({
        product: expandedProductPbv2Runtime,
        lineItem: effectiveLineItemPbv2Runtime,
      }),
    });
    if (!lineItemId) return;
    if (!hydrationKey) return;

    // The saved-selection hydration effect above and this defaults effect run
    // from the same render. Local state can therefore still look empty here
    // even though the saved values have just been queued. Check the persisted
    // source directly so defaults never win that same-commit race.
    if (expandedItemOptionHydration?.hasPersistedSelections) {
      pbv2DefaultsHydratedRef.current.add(hydrationKey);
      return;
    }

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
    currentDraftProductId,
    effectiveLineItemPbv2Runtime?.pbv2ActiveTreeVersionId,
    effectiveLineItemPbv2Runtime?.pbv2TreeVersionId,
    expandedProductPbv2Runtime?.pbv2ActiveTreeVersionId,
    expandedProduct?.id,
    effectivePbv2Tree,
    expandedItemOptionHydration,
    optionSelectionsV2,
    userEditedOptionsByLineItemId,
    orderId,
  ]);

  const handleSavedArtworkRemoved = useCallback((file: {
    id: string;
    fileRecordId?: string | null;
    side?: "front" | "back" | "both" | "na" | null;
  }) => {
    if (!expandedItem) return;
    const itemId = String(expandedItem.id);
    const fileIds = [file.id, file.fileRecordId].filter((value): value is string => Boolean(value));
    setArtworkRemovalByLineItemId((current) => {
      const existing = current[itemId] ?? { fileIds: [], removedBothSide: false };
      return {
        ...current,
        [itemId]: {
          fileIds: Array.from(new Set([...existing.fileIds, ...fileIds])),
          removedBothSide: existing.removedBothSide || file.side === "both",
        },
      };
    });
    const cleanedSpecs = removeArtworkFileReferencesFromSpecs({
      specsJson: expandedItem.specsJson,
      fileIds,
      removedSide: file.side,
    });
    setUseSameArtworkBothSides(hydratePersistedArtworkSideIntent({ specsJson: cleanedSpecs }).useSameArtworkBothSides);
  }, [expandedItem]);

  const widthNum = fixedDimensions ? fixedDimensions.widthIn : dimsRequired ? Number.parseFloat(widthText) || 0 : 1;
  const heightNum = fixedDimensions ? fixedDimensions.heightIn : dimsRequired ? Number.parseFloat(heightText) || 0 : 1;
  const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 1;

  const handleProductReplacement = useCallback((nextProductId: string) => {
    if (!expandedItem) return;
    if (!nextProductId || nextProductId === currentDraftProductId) return;
    markPricingDirtyByUser(expandedItem.id, "product");

    const nextProduct = products.find((product) => product.id === nextProductId);
    if (!nextProduct) return;

    const activeTree = normalizePbv2Tree(getPbv2Tree(nextProduct));
    const replacementDraft = buildProductReplacementDraft({
      product: nextProduct as any,
      activeTree,
      orderId,
      currentQuantity: qtyNum,
    });

    setDraftProductId(replacementDraft.productId);
    setDraftProductVariantId(replacementDraft.productVariantId);
    setWidthText(replacementDraft.width);
    setHeightText(replacementDraft.height);
    setQty(replacementDraft.quantity);
    if (typeof replacementDraft.requiresDesign === "boolean") {
      setRequiresDesignInput(replacementDraft.requiresDesign);
    }
    if (typeof replacementDraft.requiresPrepress === "boolean") {
      setRequiresPrepressInput(replacementDraft.requiresPrepress);
    }
    setRequiresProofApprovalInput(replacementDraft.requiresProofApproval);
    setOptionSelections(replacementDraft.optionSelections);
    setOptionSelectionsV2(replacementDraft.optionSelectionsV2);
    setUseSameArtworkBothSides(false);
    setPbv2SnapshotJson(replacementDraft.pbv2SnapshotJson);
    setComputedTotal(replacementDraft.computedTotal);
    setComputedTotalQty(replacementDraft.computedTotalQty);
    setCalcError(null);
    setPreviewDiag(null);
    lastCalcKeyRef.current = "";
    calcSeqRef.current += 1;
    setInitialDraftDebugByLineItemId((prev) => ({ ...prev, [expandedItem.id]: replacementDraft.debug }));
    setUserEditedOptionsByLineItemId((prev) => ({ ...prev, [expandedItem.id]: false }));
    pbv2DefaultsHydratedRef.current.forEach((key) => {
      if (key.startsWith(`${expandedItem.id}|`)) {
        pbv2DefaultsHydratedRef.current.delete(key);
      }
    });
  }, [currentDraftProductId, expandedItem, markPricingDirtyByUser, orderId, products, qtyNum]);

  const v1SelectionsKey = useMemo(() => stableStringify(optionSelections || {}), [optionSelections]);
  const v2SelectionsKey = useMemo(() => stableStringify(optionSelectionsV2?.selected || {}), [optionSelectionsV2]);
  const pbv2TreeVersionId = String(
    getOrderLineItemPbv2TreeVersionId({
      product: expandedProductPbv2Runtime,
      lineItem: effectiveLineItemPbv2Runtime,
    })
  );
  const overridePriceCents = Number(
    ((expandedItem as any)?.overridePriceCents as number | undefined) || 0
  );
  const isPbv2Mode = Boolean(effectivePbv2Tree);
  const calcKey = useMemo(
    () =>
      [
        currentDraftProductId,
        pbv2TreeVersionId,
        String(widthNum),
        String(heightNum),
        String(qtyNum),
        isPbv2Mode ? v2SelectionsKey : v1SelectionsKey,
        String(overridePriceCents),
      ].join("|"),
    [currentDraftProductId, pbv2TreeVersionId, widthNum, heightNum, qtyNum, isPbv2Mode, v2SelectionsKey, v1SelectionsKey, overridePriceCents]
  );

  useEffect(() => {
    latestPricingFingerprintRef.current = calcKey;
  }, [calcKey]);

  useEffect(() => {
    lastCalcKeyRef.current = "";
  }, [expandedId]);

  useEffect(() => {
    if (!expandedItem) return;
    const itemId = expandedItem.id;
    const pendingPricing = pendingPriceOverrideById[itemId];
    if (!pendingPricing?.hasPriceOverride || !pendingPricing.priceOverrideMode) return;

    const nextPricing = applyLineItemEditPriceOverride({
      baseCalculatedTotalCents: pendingPricing.baseCalculatedTotalCents,
      quantity: qtyNum,
      mode: pendingPricing.priceOverrideMode,
      valueCents: pendingPricing.priceOverrideValueCents,
      valuePercent: pendingPricing.priceOverrideValuePercent,
    });

    if (nextPricing.effectiveTotalCents === pendingPricing.effectiveTotalCents) return;

    setPendingPriceOverrideById((prev) => ({
      ...prev,
      [itemId]: nextPricing,
    }));
    setComputedTotal(nextPricing.effectiveTotalCents / 100);
    setComputedTotalQty(qtyNum);
    onDraftLineItemPricingChange?.(itemId, nextPricing.effectiveTotalCents);
  }, [expandedItem?.id, qtyNum, pendingPriceOverrideById[expandedItem?.id ?? ""], onDraftLineItemPricingChange]);

  const isDirty = useMemo(() => {
    if (!expandedItem) return false;
    const saved = savedSnapshotRef.current[expandedItem.id];
    if (!saved) return true;
    const pendingPricing = pendingPriceOverrideById[expandedItem.id];
    if (pendingPricing) {
      const persistedPricing = hydrateLineItemEditPricingState(expandedItem);
      if (
        pendingPricing.hasPriceOverride !== persistedPricing.hasPriceOverride ||
        pendingPricing.priceOverrideMode !== persistedPricing.priceOverrideMode ||
        pendingPricing.priceOverrideValueCents !== persistedPricing.priceOverrideValueCents ||
        pendingPricing.priceOverrideValuePercent !== persistedPricing.priceOverrideValuePercent ||
        pendingPricing.effectiveTotalCents !== persistedPricing.effectiveTotalCents
      ) {
        return true;
      }
    }
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
    const pricingDirtyByUser = pricingDirtyByUserRef.current[expandedItem.id] === true;
    const artworkRemovalDirty = Boolean(artworkRemovalByLineItemId[expandedItem.id]?.fileIds.length);

    const dirty = hasOrderLineItemDraftChanges(saved, {
      productId: pricingDirtyByUser ? currentDraftProductId : saved.productId,
      productVariantId: pricingDirtyByUser ? currentDraftProductVariantId : saved.productVariantId,
      pbv2TreeVersionId: pricingDirtyByUser ? pbv2TreeVersionId : saved.pbv2TreeVersionId,
      width: pricingDirtyByUser ? widthNum : saved.width,
      height: pricingDirtyByUser ? heightNum : saved.height,
      quantity: pricingDirtyByUser ? qtyNum : saved.quantity,
      notes: currentNotes,
      productionNotes: currentProductionNotes,
      requiresDesign: requiresDesignInput,
      requiresPrepress: requiresPrepressInput,
      requiresProofApproval: requiresProofApprovalInput,
      optionSelections: pricingDirtyByUser ? optionSelections : saved.optionSelections,
      optionSelectionsV2: pricingDirtyByUser ? (optionSelectionsV2?.selected || {}) : saved.optionSelectionsV2,
      useSameArtworkBothSides,
      isPbv2Mode,
      designBriefDraftJson: currentBrief,
      savedDesignBriefJson: persistedBrief,
    });

    if (import.meta.env.DEV && dirty) {
      console.warn("[ORDER_LINE_ITEM_DIRTY] expanded draft differs from saved snapshot", {
        lineItemId: expandedItem.id,
        draftProductId: currentDraftProductId,
        savedProductId: saved.productId,
        draftProductVariantId: currentDraftProductVariantId,
        savedProductVariantId: saved.productVariantId,
        draftPbv2TreeVersionId: pbv2TreeVersionId,
        savedPbv2TreeVersionId: saved.pbv2TreeVersionId,
        widthNum,
        savedWidth: saved.width,
        heightNum,
        savedHeight: saved.height,
        qtyNum,
        savedQuantity: saved.quantity,
        currentOptions,
        savedOptions,
        currentOptionsV2,
        savedOptionsV2,
        currentTotal: computedTotal,
        savedTotal: saved.totalPrice,
        pricingDirtyByUser,
      });
    }

    return dirty || artworkRemovalDirty;
  }, [
    expandedItem,
    currentDraftProductId,
    currentDraftProductVariantId,
    pbv2TreeVersionId,
    widthNum,
    heightNum,
    qtyNum,
    notes,
    notesDraftById,
    optionSelections,
    optionSelectionsV2,
    useSameArtworkBothSides,
    isPbv2Mode,
    requiresDesignInput,
    requiresPrepressInput,
    requiresProofApprovalInput,
    designBriefDraft,
    computedTotal,
    // Forces recompute against the freshly-written savedSnapshotRef after a save.
    savedSnapshotVersion,
    pendingPriceOverrideById,
    artworkRemovalByLineItemId,
  ]);

  // Surface unsaved line item state to the parent order editor so it can guard
  // navigation and block Save Order until the open line item is saved.
  useEffect(() => {
    onDirtyStateChange?.(isDirty);
  }, [isDirty, onDirtyStateChange]);

  useEffect(() => {
    return () => onDirtyStateChange?.(false);
  }, [onDirtyStateChange]);

  const lineItemDirtyDiagnostics = useMemo<OrderLineItemDirtyDiagnostics>(() => {
    if (!expandedItem) {
      return {
        expandedLineItemDirty: false,
        productReplacementDirty: false,
        designBriefDirty: false,
        expandedLineItemId: null,
        draftProductId: null,
        savedProductId: null,
        draftProductVariantId: null,
        savedProductVariantId: null,
        draftPbv2TreeVersionId: null,
        savedPbv2TreeVersionId: null,
        computedTotal: null,
        savedTotal: null,
      };
    }

    const saved = savedSnapshotRef.current[expandedItem.id];
    const savedBrief = designBriefSnapshotRef.current[expandedItem.id] ?? EMPTY_DESIGN_BRIEF_DRAFT;
    const pricingDirtyByUser = pricingDirtyByUserRef.current[expandedItem.id] === true;
    const productReplacementDirty = Boolean(
      pricingDirtyByUser &&
        saved &&
        (currentDraftProductId !== saved.productId ||
          normalizeVariantId(currentDraftProductVariantId) !== normalizeVariantId(saved.productVariantId)),
    );
    const designBriefDirty = JSON.stringify(designBriefDraft) !== JSON.stringify(savedBrief);

    return {
      expandedLineItemDirty: isDirty,
      productReplacementDirty,
      designBriefDirty,
      expandedLineItemId: expandedItem.id,
      draftProductId: currentDraftProductId,
      savedProductId: saved?.productId ?? null,
      draftProductVariantId: normalizeVariantId(currentDraftProductVariantId),
      savedProductVariantId: normalizeVariantId(saved?.productVariantId),
      draftPbv2TreeVersionId: pbv2TreeVersionId || null,
      savedPbv2TreeVersionId: saved?.pbv2TreeVersionId || null,
      computedTotal: Number.isFinite(Number(computedTotal)) ? Number(computedTotal) : null,
      savedTotal: Number.isFinite(Number(saved?.totalPrice)) ? Number(saved?.totalPrice) : null,
    };
  }, [
    expandedItem,
    currentDraftProductId,
    currentDraftProductVariantId,
    pbv2TreeVersionId,
    designBriefDraft,
    computedTotal,
    isDirty,
    savedSnapshotVersion,
  ]);

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

      if (isPbv2Mode && !optionsV2Valid && !expandedSkipsPrintOptionValidation) {
        setCalcError(null);
        return;
      }

      if (calcKey === lastCalcKeyRef.current) {
        return;
      }

      const isDirtyByUser = pricingDirtyByUserRef.current[expandedItem.id] === true;
      if (pendingPriceOverrideById[expandedItem.id]?.hasPriceOverride) {
        lastCalcKeyRef.current = calcKey;
        if (import.meta.env.DEV) {
          console.warn("[OrderLineItemsSection] Preview request suppressed", {
            lineItemId: expandedItem.id,
            reasonIgnored: "manual_override_active",
            dirtyByUser: isDirtyByUser,
            requestFingerprint: calcKey,
            currentFingerprint: latestPricingFingerprintRef.current,
          });
        }
        return;
      }

      if (!isDirtyByUser) {
        const persistedPricing = hydrateLineItemEditPricingState(expandedItem);
        setComputedTotal(persistedPricing.persistedEffectiveTotalCents / 100);
        setComputedTotalQty(savedSnapshotRef.current[expandedItem.id]?.quantity ?? qtyNum);
        setIsCalculating(false);
        lastCalcKeyRef.current = calcKey;
        if (import.meta.env.DEV) {
          console.warn("[OrderLineItemsSection] Preview request suppressed", {
            lineItemId: expandedItem.id,
            reasonIgnored: "not_dirty_by_user",
            dirtyByUser: isDirtyByUser,
            requestFingerprint: calcKey,
            currentFingerprint: latestPricingFingerprintRef.current,
          });
        }
        return;
      }

      const saved = savedSnapshotRef.current[expandedItem.id];
      const pricingInputsMatchSaved =
        Boolean(saved) &&
        currentDraftProductId === saved!.productId &&
        normalizeVariantId(currentDraftProductVariantId) === normalizeVariantId(saved!.productVariantId) &&
        pbv2TreeVersionId === saved!.pbv2TreeVersionId &&
        Math.abs(widthNum - saved!.width) <= 0.01 &&
        Math.abs(heightNum - saved!.height) <= 0.01 &&
        qtyNum === saved!.quantity &&
        (isPbv2Mode
          ? stableStringify(optionSelectionsV2?.selected || {}) === stableStringify(saved!.optionSelectionsV2 || {})
          : JSON.stringify(optionSelections || {}) === JSON.stringify(saved!.optionSelections || {}));

      if (pricingInputsMatchSaved && !pendingPriceOverrideById[expandedItem.id]) {
        const persistedPricing = hydrateLineItemEditPricingState(expandedItem);
        const persistedTotal = persistedPricing.persistedEffectiveTotalCents / 100;
        if (
          import.meta.env.DEV &&
          Number.isFinite(Number(computedTotal)) &&
          Math.abs(Number(computedTotal) - persistedTotal) > 0.005
        ) {
          console.warn("[OrderLineItemsSection] Suppressed initial edit reprice; persisted effective price wins until a user changes pricing inputs.", {
            lineItemId: expandedItem.id,
            persistedEffectiveTotalCents: persistedPricing.persistedEffectiveTotalCents,
            computedTotal,
            calcKey,
          });
        }
        setComputedTotal(persistedTotal);
        setComputedTotalQty(saved?.quantity ?? qtyNum);
        lastCalcKeyRef.current = calcKey;
        return;
      }
      lastCalcKeyRef.current = calcKey;

      // Sequence id: a slower earlier response must not overwrite a newer one.
      calcSeqRef.current += 1;
      const seq = calcSeqRef.current;
      const requestFingerprint = calcKey;
      const requestedBecauseOfUserChange = true;

      // Payload is always built from current DRAFT state (qty/dims/options).
      const payload = buildQuoteCalculatePayload({
        productId: currentDraftProductId,
        variantId: currentDraftProductVariantId,
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
          const gate = shouldApplyOrderLineItemPreviewResult({
            requestId: seq,
            latestRequestId: calcSeqRef.current,
            requestFingerprint,
            currentFingerprint: latestPricingFingerprintRef.current,
            isDirtyByUser: pricingDirtyByUserRef.current[expandedItem.id] === true,
            requestedBecauseOfUserChange,
            hasPendingManualOverride: pendingPriceOverrideRef.current[expandedItem.id]?.hasPriceOverride === true,
          });
          if (!gate.apply) {
            if (import.meta.env.DEV) {
              console.warn("[OrderLineItemsSection] Preview response ignored", {
                lineItemId: expandedItem.id,
                requestId: seq,
                reasonIgnored: gate.reasonIgnored,
                dirtyByUser: pricingDirtyByUserRef.current[expandedItem.id] === true,
                requestFingerprint,
                currentFingerprint: latestPricingFingerprintRef.current,
              });
            }
            return;
          }
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
          onDraftLineItemPricingChange?.(expandedItem.id, Math.round(price * 100));
          setPreviewDiag((prev) =>
            prev && prev.seq === seq ? { ...prev, responseTotal: price, status: "ok" } : prev,
          );

          // Store PBV2 snapshot from response (contains treeJson, visibleNodeIds, selections)
          if (data?.pbv2SnapshotJson) {
            setPbv2SnapshotJson(data.pbv2SnapshotJson);
          }
        })
        .catch((err: any) => {
          const gate = shouldApplyOrderLineItemPreviewResult({
            requestId: seq,
            latestRequestId: calcSeqRef.current,
            requestFingerprint,
            currentFingerprint: latestPricingFingerprintRef.current,
            isDirtyByUser: pricingDirtyByUserRef.current[expandedItem.id] === true,
            requestedBecauseOfUserChange,
            hasPendingManualOverride: pendingPriceOverrideRef.current[expandedItem.id]?.hasPriceOverride === true,
          });
          if (!gate.apply) {
            if (import.meta.env.DEV) {
              console.warn("[OrderLineItemsSection] Preview error ignored", {
                lineItemId: expandedItem.id,
                requestId: seq,
                reasonIgnored: gate.reasonIgnored,
                dirtyByUser: pricingDirtyByUserRef.current[expandedItem.id] === true,
                requestFingerprint,
                currentFingerprint: latestPricingFingerprintRef.current,
              });
            }
            return;
          }
          if (isSessionExpiredError(err)) {
            setCalcError(SESSION_EXPIRED_MESSAGE);
            notifySessionExpired("order-line-price-preview");
            setPreviewDiag((prev) => (prev && prev.seq === seq ? { ...prev, status: "error" } : prev));
            return;
          }
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
      currentDraftProductId,
      currentDraftProductVariantId,
      isPbv2Mode,
      optionsV2Valid,
      expandedSkipsPrintOptionValidation,
      customerId,
      pbv2TreeVersionId,
      widthNum,
      heightNum,
      qtyNum,
      v1SelectionsKey,
      v2SelectionsKey,
      pendingPriceOverrideById[expandedItem?.id ?? ""],
    ],
    400
  );

  // Persists the currently-expanded line item. Returns a result instead of
  // throwing so the parent's Save Order orchestration can decide what to do.
  // `silent` suppresses the per-mutation toast (the orchestrator shows one).
  const saveExpandedLineItem = async (
    opts?: { silent?: boolean },
  ): Promise<{ saved: boolean; error?: string }> => {
    if (!expandedItem) return { saved: true };
    if (isPbv2Mode && !optionsV2Valid && !expandedSkipsPrintOptionValidation) {
      const message = "Complete required product options before saving.";
      setCalcError(message);
      return { saved: false, error: message };
    }
    const itemId = expandedItem.id;
    const lineItemMutation = opts?.silent ? updateLineItemSilent : updateLineItem;

    setSavingItemId(itemId);
    setSavedItemId(null);

    try {
      const persistedPricing = hydrateLineItemEditPricingState(expandedItem);
      const pendingPricing = pendingPriceOverrideById[itemId];
      const pricingForSave = pendingPricing ?? (
        persistedPricing.hasPriceOverride && persistedPricing.priceOverrideMode
          ? applyLineItemEditPriceOverride({
              baseCalculatedTotalCents: persistedPricing.baseCalculatedTotalCents,
              quantity: qtyNum,
              mode: persistedPricing.priceOverrideMode,
              valueCents: persistedPricing.priceOverrideValueCents,
              valuePercent: persistedPricing.priceOverrideValuePercent,
            })
          : null
      );
      const totalPrice = pricingForSave
        ? pricingForSave.effectiveTotalCents / 100
        : Number.isFinite(computedTotal)
          ? (computedTotal as number)
          : persistedPricing.persistedEffectiveTotalCents / 100;
      const unitPrice = qtyNum > 0 ? totalPrice / qtyNum : 0;
      const productionNotesDraft = notesDraftById[itemId] ?? "";
      const productChanged =
        currentDraftProductId !== String(expandedItem.productId || "") ||
        normalizeVariantId(currentDraftProductVariantId) !== normalizeVariantId(expandedItem.productVariantId);

      const selectedOptionsArray = buildSelectedOptionsArray(expandedProductOptions, optionSelections, widthNum, heightNum, qtyNum);
      const replacementInitialDraft = productChanged ? initialDraftDebugByLineItemId[itemId] : null;
      const artworkRemoval = artworkRemovalByLineItemId[itemId];
      const baseSpecsJson = productChanged
        ? {}
        : removeArtworkFileReferencesFromSpecs({
            specsJson: expandedItem.specsJson || {},
            fileIds: artworkRemoval?.fileIds ?? [],
            removedSide: artworkRemoval?.removedBothSide ? "both" : null,
          });
      const nextSpecsJson = mergeArtworkSideIntentIntoSpecs({
        ...baseSpecsJson,
        notes: notes || "",
        lineItemNotes: {
          ...(productChanged ? {} : (((expandedItem.specsJson as any)?.lineItemNotes as any) || {})),
          descLong: productionNotesDraft,
        },
        selectedOptions: selectedOptionsArray,
        ...(replacementInitialDraft
          ? {
              initialDraft: {
                requiresDesign: replacementInitialDraft.requiresDesign,
                requiresPrepress: replacementInitialDraft.requiresPrepress,
                requiresProofApproval: replacementInitialDraft.requiresProofApproval,
                requiresProductionJob: replacementInitialDraft.requiresProductionJob,
                productRoutingDefaultsUsed: replacementInitialDraft.productRoutingDefaultsUsed,
                optionSelectionsJson: replacementInitialDraft.optionSelectionsJson,
                renderedOptionLabels: replacementInitialDraft.sortedOptionLabels,
              },
            }
          : {}),
      }, useSameArtworkBothSides);

      const savedPricingDrivers = savedSnapshotRef.current[itemId];
      const pricingDriversChangedForSave = Boolean(
        savedPricingDrivers && (
          currentDraftProductId !== savedPricingDrivers.productId ||
          normalizeVariantId(currentDraftProductVariantId) !== normalizeVariantId(savedPricingDrivers.productVariantId) ||
          Math.abs(widthNum - savedPricingDrivers.width) > 0.01 ||
          Math.abs(heightNum - savedPricingDrivers.height) > 0.01 ||
          qtyNum !== savedPricingDrivers.quantity ||
          (
            isPbv2Mode
              ? stableStringify(optionSelectionsV2?.selected || {}) !== stableStringify(savedPricingDrivers.optionSelectionsV2 || {})
              : JSON.stringify(optionSelections || {}) !== JSON.stringify(savedPricingDrivers.optionSelections || {})
          )
        )
      );
      const isPbv2 = Boolean(effectivePbv2Tree || pbv2SnapshotJson?.treeJson);
      const v2Patch = isPbv2
        ? { 
            optionSelectionsJson: optionSelectionsV2,
            // Store PBV2 preview snapshots only when the user changed pricing
            // drivers. Override-only saves must preserve the persisted base.
            ...(pricingDriversChangedForSave ? { pbv2SnapshotJson: pbv2SnapshotJson || undefined } : {}),
          }
        : {
            optionSelectionsJson: null,
            pbv2SnapshotJson: null,
            pbv2TreeVersionId: null,
          };

      const savedLineItem = await lineItemMutation.mutateAsync({
        id: itemId,
        data: {
          productId: currentDraftProductId,
          productVariantId: currentDraftProductVariantId,
          width: dimsRequired ? widthNum : null,
          height: dimsRequired ? heightNum : null,
          quantity: qtyNum,
          description: notes || "",
          requiresDesign: requiresDesignInput,
          requiresPrepress: requiresPrepressInput,
          requiresProofApproval: requiresProofApprovalInput,
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
          ...(pricingForSave
            ? {
                priceOverrideMode: pricingForSave.hasPriceOverride ? pricingForSave.priceOverrideMode : null,
                priceOverrideValueCents: pricingForSave.hasPriceOverride ? pricingForSave.priceOverrideValueCents : null,
                priceOverrideValuePercent: pricingForSave.hasPriceOverride ? pricingForSave.priceOverrideValuePercent : null,
                overridePriceCents: pricingForSave.hasPriceOverride ? pricingForSave.effectiveTotalCents : null,
                overrideReason: null,
              }
            : {}),
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
      setPendingPriceOverrideById((prev) => {
        if (!prev[itemId]) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setArtworkRemovalByLineItemId((current) => {
        if (!current[itemId]) return current;
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      onDraftLineItemPricingChange?.(itemId, null);
      resetPricingDirtyByUser(itemId);

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

      const nextSavedSnapshot: OrderLineItemSavedSnapshot = {
        productId: currentDraftProductId,
        productVariantId: currentDraftProductVariantId,
        pbv2TreeVersionId,
        width: widthNum,
        height: heightNum,
        quantity: qtyNum,
        notes: notes || "",
        productionNotes: productionNotesDraft,
        requiresDesign: requiresDesignInput,
        requiresPrepress: requiresPrepressInput,
        requiresProofApproval: requiresProofApprovalInput,
        optionSelections,
        optionSelectionsV2: optionSelectionsV2.selected ?? {},
        useSameArtworkBothSides,
        totalPrice: resolvedTotal,
      };
      savedSnapshotRef.current[itemId] = buildSavedSnapshotAfterLineItemSave({
        savedLineItem,
        fallback: nextSavedSnapshot,
      });
      designBriefSnapshotRef.current[itemId] = designBriefDraft;
      // Force `isDirty` to recompute against the snapshot just written, so the
      // line item dirty flag (and the order navigation guard) clear immediately
      // — independent of when the post-save order refetch happens to land.
      setSavedSnapshotVersion((v) => v + 1);
      onDirtyStateChange?.(false);
      // A successful save supersedes any prior preview calculation error.
      setCalcError(null);
      setPreviewDiag(null);

      if (import.meta.env.DEV) {
        console.warn("[ORDER_LINE_ITEM_SAVE_ADOPT] saved line item baseline", {
          lineItemId: itemId,
          draftProductId: currentDraftProductId,
          savedProductId: savedSnapshotRef.current[itemId]?.productId,
          draftProductVariantId: normalizeVariantId(currentDraftProductVariantId),
          savedProductVariantId: savedSnapshotRef.current[itemId]?.productVariantId,
          draftPbv2TreeVersionId: pbv2TreeVersionId,
          savedPbv2TreeVersionId: savedSnapshotRef.current[itemId]?.pbv2TreeVersionId,
          computedTotal: resolvedTotal,
        });
      }

      setTimeout(() => setSavedItemId(null), 2000);
      setTimeout(() => setDesignBriefSavedAt(null), 2000);

      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "line-item-previews"] });
      return { saved: true };
    } catch (error: any) {
      // The mutation's onError already toasts (unless silent). Surface the
      // message to the caller so Save Order can stop and keep dirty state.
      return { saved: false, error: error?.message || "Failed to save line item." };
    } finally {
      setSavingItemId(null);
    }
  };

  // Button handler — fire-and-forget targeted save of the open line item.
  const handleSaveItem = () => {
    void saveExpandedLineItem();
  };

  // Imperative API for the parent's Save Order orchestration. Recreated each
  // render so it always closes over the latest draft state / dirty flag.
  useImperativeHandle(ref, () => ({
    saveDirtyLineItem: async () => {
      if (!isDirty || !expandedItem) return { saved: true };
      return saveExpandedLineItem({ silent: true });
    },
    getDirtyDiagnostics: () => lineItemDirtyDiagnostics,
  }));

  const handleDuplicateItem = async (item: OrderLineItem) => {
    try {
      const payload = buildOrderLineItemDuplicatePayload(item);
      await createLineItem.mutateAsync(payload);
      if (onAfterLineItemsChange) {
        await onAfterLineItemsChange();
      }
    } catch {
      // useCreateOrderLineItem owns the error toast so a failed duplicate is
      // reported once with the backend's specific validation message.
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await deleteLineItem.mutateAsync(itemId);
      setSelectedForProduction((current) => {
        if (!current.has(itemId)) return current;
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
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

  const selectableProductionLineItemIds = useMemo(
    () => getSelectableProductionLineItemIds(activeLineItems, products),
    [activeLineItems, products],
  );
  const selectableProductionLineItemIdSet = useMemo(
    () => new Set(selectableProductionLineItemIds),
    [selectableProductionLineItemIds],
  );

  useEffect(() => {
    setSelectedForProduction((current) => {
      const next = new Set(Array.from(current).filter((id) => selectableProductionLineItemIdSet.has(id)));
      if (next.size === current.size && Array.from(next).every((id) => current.has(id))) return current;
      return next;
    });
  }, [selectableProductionLineItemIdSet]);

  const handleToggleProductionSelection = (lineItemId: string) => {
    if (!selectableProductionLineItemIdSet.has(lineItemId)) return;
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

    const lineItemIds = Array.from(new Set(
      Array.from(selectedForProduction).flatMap((lineItemId) =>
        getProductionScheduleTargetIds(lineItemId, activeLineItems, products),
      ),
    ));
    if (lineItemIds.length === 0) {
      setSelectedForProduction(new Set());
      return;
    }
    await scheduleProduction.mutateAsync(lineItemIds);
    setSelectedForProduction(new Set());
  };

  const handleLineItemDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || String(active.id) === String(over.id)) return;
    const previous = sortableItems;
    const oldIndex = previous.indexOf(String(active.id));
    const newIndex = previous.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = moveOrderLineItemIds(previous, String(active.id), String(over.id));
    setOrderedKeys(next);
    try {
      const persistedEntries = await persistOrderLineItemReorder(orderId, next);
      queryClient.setQueryData(orderDetailQueryKey(orderId), (current: any) => current
        ? { ...current, lineItems: applyOrderLineItemReorder(current.lineItems ?? [], persistedEntries) }
        : current);
      await queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
    } catch (error: any) {
      setOrderedKeys(previous);
      toast({ title: "Reorder failed", description: error?.message || "Could not save line item order.", variant: "destructive" });
    }
  };

  const productionRequiredItemCount = selectableProductionLineItemIds.length;

  const actionNeededCount = useMemo(() => {
    return activeLineItems.filter((item) => {
      if (isChildLineItem(item)) return false;
      const operational = resolveOrderLineItemOperationalDisplay(item as any);
      if (operational.isProductionOwned) {
        return ["queued", "paused"].includes(String((item as any).activeOwnerStatus ?? "queued").toLowerCase());
      }
      return needsOperationalAction(String((item as any).workflowState || "new"));
    }).length;
  }, [activeLineItems]);

  return (
    <Popover
      open={searchOpen}
      onOpenChange={(open) => {
        setSearchOpen(open);
        if (!open) {
          setSearchQuery("");
          setChildParentLineItemId(null);
        }
      }}
    >
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
          
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {productionRequiredItemCount > 0 && (
                <OrderLineItemSelectAllControl
                  selectedIds={selectedForProduction}
                  selectableIds={selectableProductionLineItemIds}
                  onSelectedIdsChange={setSelectedForProduction}
                  disabled={scheduleProduction.isPending}
                />
              )}
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label="Add Product"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Product
                </Button>
              </PopoverTrigger>
              {productionRequiredItemCount > 0 && selectedForProduction.size > 0 && (
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
              {productionRequiredItemCount > 0 && (
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
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-0 py-0 overflow-x-hidden">
        {displayLineItems.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">—</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => { void handleLineItemDragEnd(event); }}
          >
            <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
              <div className="space-y-1 overflow-x-hidden">
                {nestedOrderedLineItems.map((item) => {
                  const itemKey = item.id;
                  const childItem = isChildLineItem(item);
                  const groupChildren = childItem
                    ? []
                    : activeLineItems.filter((candidate) => String((candidate as any).parentLineItemId || "") === String(item.id));
                  const hasGroupChildren = groupChildren.length > 0;
                  const groupScheduleTargetIds = getProductionScheduleTargetIds(String(item.id), activeLineItems, products);
                  const isExpanded = itemKey === expandedId;
                  const contentId = `line-item-${itemKey}-details`;

                  const productName =
                    isExpanded && expandedItem?.id === item.id && expandedProduct
                      ? expandedProduct.name
                      : (item as any).product?.name || item.description || "Item";

                  const itemSpecsJson: any =
                    item.specsJson && typeof item.specsJson === "object" ? (item.specsJson as any) : {};

                  const summaryProduct = products.find((product) => product.id === item.productId) ?? null;
                  const summaryTree = normalizePbv2Tree(
                    (item as any).pbv2SnapshotJson?.treeJson ?? getPbv2Tree(summaryProduct),
                  );
                  const { chips: optionChips, overflowCount } = buildLineItemOptionSummaryChips(item, summaryTree, 3);

                  const persistedDescription = typeof item.description === "string" ? item.description.trim() : "";

                  const persistedPricing = hydrateLineItemEditPricingState(item);
                  const pendingPricing = pendingPriceOverrideById[String(item.id)];
                  const total = persistedPricing.persistedEffectiveTotalCents / 100;
                  const previousDisplayLineItem =
                    previousLineItemsRef.current.find((previous) => String(previous.id) === String(item.id)) as any | undefined;
                  const isActiveItem = isExpanded && expandedItem?.id === item.id;
                  const visiblePersistedPrice = deriveVisibleLineItemPriceDisplay({
                    lineItem: item as any,
                    previousLineItem: previousDisplayLineItem ?? null,
                    aggregateTotalCents: pendingPricing
                      ? pendingPricing.effectiveTotalCents
                      : isActiveItem && computedTotal !== null && Number.isFinite(computedTotal)
                        ? Math.round(computedTotal * 100)
                        : null,
                    attachmentState: "attachment_attached_or_saved",
                    source: "OrderLineItemsSection.visible",
                  });
                  const displayPersistedTotal = pendingPricing ? pendingPricing.effectiveTotalCents / 100 : visiblePersistedPrice.displayTotal;
                  const displayPersistedPerEa = pendingPricing
                    ? pendingPricing.effectiveUnitPriceCents / 100
                    : visiblePersistedPrice.displayPerEach;

                  const itemNotes = (itemSpecsJson as any)?.lineItemNotes as
                    | { sku?: string | null; descShort?: string | null; descLong?: string | null }
                    | undefined;

                  const persistedProductionNotes = typeof itemNotes?.descLong === "string" ? itemNotes.descLong : "";
                  const hasProductionNotes = Boolean(persistedProductionNotes && persistedProductionNotes.trim());

                  const currentOverrideCents = pendingPricing
                    ? (pendingPricing.hasPriceOverride ? pendingPricing.effectiveTotalCents : null)
                    : (persistedPricing.hasPriceOverride ? persistedPricing.effectiveTotalCents : null);
                  const isOverride = currentOverrideCents !== null;
                  const persistedOverrideMode = persistedPricing.priceOverrideMode ?? getLineItemPriceOverrideMode(item);
                  const selectedOverrideMode =
                    pendingPricing?.priceOverrideMode ?? priceOverrideModeById[String(item.id)] ?? persistedOverrideMode ?? "override_total_after_margin";
                  const overrideLabel = getLineItemPriceOverrideLabel(persistedOverrideMode ?? selectedOverrideMode);
                  const baseCalculatedTotalCents = persistedPricing.baseCalculatedTotalCents || getLineItemBaseCalculatedTotalCents(item, total);
                  const baseCalculatedTotal = baseCalculatedTotalCents / 100;
                  // Live preview price for the currently-expanded item (not yet saved).
                  // Per-each is derived from the qty the preview total was priced for,
                  // never the live draft qty, so total and per-each stay consistent.
                  const { displayTotal, displayPerEach: displayPerEa, isPreviewPrice } =
                    deriveLineItemPricingDisplay({
                      isActiveItem,
                      isOverride,
                      persistedTotal: displayPersistedTotal,
                      persistedPerEach: displayPersistedPerEa,
                      computedTotal: isActiveItem ? computedTotal : null,
                      computedTotalQty: isActiveItem ? computedTotalQty : null,
                      isDirty,
                      isCalculating,
                      hasCalcError: Boolean(calcError),
                    });
                  const displayPrice = isOverride ? currentOverrideCents / 100 : total;
                  const editorPriceValue = isOverride
                    ? pendingPricing?.priceOverrideValueCents != null
                      ? pendingPricing.priceOverrideValueCents / 100
                      : getLineItemOverrideInputValue(item, selectedOverrideMode, total)
                    : displayPersistedTotal;
                  const priceEditText = priceEditTextById[String(item.id)] ?? editorPriceValue.toFixed(2);
                  const isEditingPrice = editingPriceItemId === String(item.id);
                  const overrideSelectValue = isOverride ? selectedOverrideMode : "__none";

                  const statusValue = item.status || "new";
                  const readOnly = !canEditLineItemRecord(item);

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
                  const quantityOnly = (productForPolicy as any)?.measurementMode === "quantity_only";
                  const fulfillmentOnly = (productForPolicy as any)?.workflowIntent === "fulfillment_only";
                  const serviceFee = (productForPolicy as any)?.workflowIntent === "service_fee";

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
                  const lineNumber = lineNumberById.get(String(item.id)) ?? (Number((item as any).lineNumber) || 1);

                  const reorderDisabled = readOnly || productionPriorityLineItemIds.length > 0;
                  const reorderDisabledReason = productionPriorityLineItemIds.length > 0
                    ? "Clear the production-focused view before reordering line items."
                    : undefined;

                  const thumbnailNode = heroThumbUrls.length ? (
                    <button
                      type="button"
                      className="w-11 h-11 relative rounded overflow-hidden"
                      data-li-interactive="true"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setArtworkViewerLineItemId(String(item.id));
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      aria-label={`View artwork for Line ${lineNumber}`}
                      title={`View artwork for Line ${lineNumber}`}
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
                  ) : attachmentsForThumb.length > 0 ? (
                    <button
                      type="button"
                      className="h-11 w-11 shrink-0 rounded"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setArtworkViewerLineItemId(String(item.id));
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={`View artwork for Line ${lineNumber}`}
                      title={`View artwork for Line ${lineNumber}`}
                    >
                      <span className="pointer-events-none">
                        <LineItemThumbnail
                          parentId={orderId}
                          lineItemId={item.id}
                          parentType="order"
                          attachments={attachmentsForThumb as any}
                        />
                      </span>
                    </button>
                  ) : (
                    <LineItemThumbnail parentId={orderId} lineItemId={item.id} parentType="order" />
                  );

                  const itemRequiresProduction = !childItem && selectableProductionLineItemIdSet.has(String(item.id));
                  const isSelectedForProduction = selectedForProduction.has(item.id);
                  const isProductionFocused = productionFocusLineItemIds.includes(String(item.id));
                  const expandedBriefDetail = isExpanded && expandedItem && expandedItem.id === item.id ? designBriefQuery.data : null;
                  const showDesignBriefEditor = Boolean(
                    expandedBriefDetail?.effectiveRequiresDesign ||
                    hasAnyDesignBriefText(designBriefDraft)
                  );
                  const ownerOverride = productionOwnerOverrides[String(item.id)] ?? null;
                  const operationalItem = ownerOverride ? { ...(item as any), ...ownerOverride } : (item as any);
                  const workflowState = String(operationalItem.workflowState || "new");
                  const lineItemProofSummary = (item as any).proofSummary ?? null;
                  const showOpenProofingAction = shouldOfferProofingNavigation({
                    lineItemId: item.id,
                    requiresProofApproval: Boolean((item as any).requiresProofApproval),
                    approvedProofVersionId: (item as any).approvedProofVersionId ?? null,
                  }) || Boolean(lineItemProofSummary?.openProofingAvailable);
                  const hasActiveOwner = Boolean(operationalItem.activeOwnerStepKey || operationalItem.activeOwnerStationKey || operationalItem.activeOwnerJobId);
                  const activeWorkWarning = !readOnly && isExpanded
                    ? getOrderLineItemActiveWorkWarning({ fulfillmentOnly, workflowState, hasActiveOwner })
                    : null;
                  const operationalDisplay = resolveOrderLineItemOperationalDisplay(operationalItem);
                  const ownerLabel = operationalDisplay.ownerLabel;
                  const activeProductionActions = getOrderLineItemProductionActions(operationalItem);
                  const groupProductionActionTargets = hasGroupChildren
                    ? groupChildren
                        .filter((child) => {
                          const childOperational = productionOwnerOverrides[String(child.id)]
                            ? { ...(child as any), ...productionOwnerOverrides[String(child.id)] }
                            : child as any;
                          return Boolean(childOperational.activeOwnerJobId) && resolveOrderLineItemOperationalDisplay(childOperational).isProductionOwned;
                        })
                        .map((child) => {
                          const childOperational = productionOwnerOverrides[String(child.id)]
                            ? { ...(child as any), ...productionOwnerOverrides[String(child.id)] }
                            : child as any;
                          return {
                            lineItemId: String(child.id),
                            jobId: String(childOperational.activeOwnerJobId),
                            stationKey: childOperational.activeOwnerStationKey,
                          };
                        })
                    : [{
                        lineItemId: String(item.id),
                        jobId: String(operationalItem.activeOwnerJobId),
                        stationKey: operationalItem.activeOwnerStationKey,
                      }];
                  const displayedProductionActions = hasGroupChildren
                    ? getGroupedOrderLineItemProductionActions(groupChildren.map((child) => productionOwnerOverrides[String(child.id)]
                      ? { ...(child as any), ...productionOwnerOverrides[String(child.id)] }
                      : child as any))
                    : activeProductionActions;
                  const operationalBadgeState = operationalDisplay.isProductionOwned
                    ? String(operationalItem.activeOwnerStatus || "").toLowerCase() === "paused" ? "on_hold" : "in_production"
                    : workflowState;
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
                  const missingArtworkActive = !fulfillmentOnly && !serviceFee && policy === "required" && canDeriveArtwork && !hasAnyArtwork && !isMissingArtworkSuppressed;
                  const operationalStatusLabel = serviceFee
                    ? "Billing line"
                    : fulfillmentOnly && workflowState === "ready_for_production"
                    ? "Ready for fulfillment"
                    : fulfillmentOnly && workflowState === "in_production"
                      ? "Pick / pack"
                      : operationalDisplay.statusLabel;
                  const operationalNextStep = serviceFee
                    ? (displayTotal > 0 || (productForPolicy as any)?.allowZeroPrice === true ? "Ready to invoice" : "Price not configured")
                    : fulfillmentOnly && workflowState === "ready_for_production"
                    ? "Pick / pack"
                    : fulfillmentOnly && workflowState === "in_production"
                      ? "Complete fulfillment"
                      : operationalDisplay.nextStepLabel;
                  const initialDraftDebug = initialDraftDebugByLineItemId[String(item.id)];
                  const initialDraftSnapshot = (itemSpecsJson?.initialDraft && typeof itemSpecsJson.initialDraft === "object")
                    ? itemSpecsJson.initialDraft as any
                    : null;
                  const lineItemUserEditedOptions = userEditedOptionsByLineItemId[String(item.id)] === true;
                  const pricingDebugSnapshot = isExpanded && expandedItem && expandedItem.id === item.id
                    ? (pbv2SnapshotJson as any)?.pbv2PricingSnapshot
                    : (item as any)?.pbv2SnapshotJson?.pbv2PricingSnapshot;
                  const pricingDetailQuantity = isExpanded && expandedItem?.id === item.id
                    ? qtyNum
                    : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
                  const pricingDetailWidth = isExpanded && expandedItem?.id === item.id ? widthNum : Number(item.width);
                  const pricingDetailHeight = isExpanded && expandedItem?.id === item.id ? heightNum : Number(item.height);
                  const calculatedSqft = !quantityOnly && Number.isFinite(pricingDetailWidth) && Number.isFinite(pricingDetailHeight)
                    ? (pricingDetailWidth * pricingDetailHeight * pricingDetailQuantity) / 144
                    : null;
                  const formulaDebug = pricingDebugSnapshot?.formulaDebug ?? pricingDebugSnapshot?.debug ?? null;
                  const billedSqft = typeof formulaDebug?.sheetYield?.billedSheetSqft === "number"
                    ? formulaDebug.sheetYield.billedSheetSqft
                    : null;
                  const ratePerSqft = typeof pricingDebugSnapshot?.baseRateUsed === "number"
                    ? pricingDebugSnapshot.baseRateUsed
                    : null;
                  const displayedRatePerSqft = ratePerSqft ?? (calculatedSqft && calculatedSqft > 0 ? displayTotal / calculatedSqft : null);
                  const renderedRequiresDesign = isExpanded && expandedItem && expandedItem.id === item.id
                    ? requiresDesignInput
                    : Boolean((item as any).requiresDesign);
                  const renderedRequiresPrepress = isExpanded && expandedItem && expandedItem.id === item.id
                    ? requiresPrepressInput
                    : (typeof (item as any).requiresPrepress === "boolean" ? (item as any).requiresPrepress : null);
                  const proofApprovalRequiredByDefault = Boolean(
                    isExpanded && expandedItem && expandedItem.id === item.id
                      ? (expandedProduct as any)?.requiresProofApproval
                      : (item as any)?.product?.requiresProofApproval ?? (item as any)?.requiresProofApproval
                  );
                  const proofApprovalLockEnabled = orgPreferences.proofing?.proofApprovalLockEnabled === true;
                  const renderedRequiresProofApproval = isExpanded && expandedItem && expandedItem.id === item.id
                    ? requiresProofApprovalInput
                    : Boolean((item as any)?.requiresProofApproval);
                  const showArtworkControls =
                    (!fulfillmentOnly && !serviceFee) || renderedRequiresDesign || renderedRequiresPrepress === true || renderedRequiresProofApproval;
                  const printSides = isExpanded && expandedItem?.id === item.id
                    ? resolveProductionSides({
                      ...(item as any),
                      optionSelectionsJson: { schemaVersion: 2, selected: optionSelectionsV2.selected ?? {} },
                    })
                    : resolveProductionSides(item);

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
                  } else if (quantityOnly && !((productForPolicy as any)?.allowZeroPrice === true) && displayTotal === 0) {
                    operationalWarning = "Price not configured";
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
                            childItem && "ml-5 border-l-2 border-primary/30 pl-2",
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
                              {childItem ? (
                                <div className="px-2 pt-2">
                                  <Badge variant="outline">
                                    Child item · Runs with Line {lineNumberById.get(String((item as any).parentLineItemId)) ?? "parent"}
                                  </Badge>
                                </div>
                              ) : null}
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
                                lineLabel={`Line ${lineNumber}`}
                                sizeLabel={formatLineItemMeasurementLabel(productForPolicy, item.width, item.height)}
                                qtyLabel={`Qty ${item.quantity || 0}`}
                                unitPriceLabel={serviceFee ? formatMoney(displayTotal) : `${formatMoney(displayPerEa)}/ea`}
                                priceLabel={serviceFee ? "Flat fee" : "Unit price"}
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
                                    <Badge variant={workflowBadgeVariant(operationalBadgeState)} className="h-5 px-1.5 text-[11px] font-medium">
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
                                    {(item as any).productionBypassed ? (
                                      <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium">No production required</Badge>
                                    ) : null}
                                    {childItem ? <span className="text-muted-foreground">Included with parent workflow</span> : null}
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
                                  disabledReason: reorderDisabledReason,
                                }}
                                showDragHandle={!readOnly}
                                primaryControlSlot={
                                  !readOnly && isExpanded && expandedItem?.id === item.id ? (
                                    <div>
                                      <div className="mb-1 text-xs text-muted-foreground">Product</div>
                                      <select
                                        aria-label="Product"
                                        value={currentDraftProductId}
                                        onChange={(event) => handleProductReplacement(event.target.value)}
                                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                      >
                                        {products.map((product) => (
                                          <option key={product.id} value={product.id}>{product.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : undefined
                                }
                                width={widthText}
                                height={heightText}
                                quantity={qty}
                                onWidthChange={(value) => {
                                  markPricingDirtyByUser(String(item.id), "width");
                                  setWidthText(value);
                                }}
                                onHeightChange={(value) => {
                                  markPricingDirtyByUser(String(item.id), "height");
                                  setHeightText(value);
                                }}
                                onQuantityChange={(value) => {
                                  markPricingDirtyByUser(String(item.id), "quantity");
                                  setQty(value);
                                }}
                                onQuantityIncrement={() => {
                                  markPricingDirtyByUser(String(item.id), "quantity_increment");
                                  setQty((q) => (q || 1) + 1);
                                }}
                                onQuantityDecrement={() => {
                                  markPricingDirtyByUser(String(item.id), "quantity_decrement");
                                  setQty((q) => Math.max(1, (q || 1) - 1));
                                }}
                                dimsRequired={dimsRequired}
                                price={displayTotal}
                                priceOverride={isOverride ? displayTotal : null}
                                priceOverrideLabel={overrideLabel}
                                editingPrice={isEditingPrice}
                                priceEditText={priceEditText}
                                onPriceClick={
                                  readOnly
                                    ? undefined
                                    : () => {
                                        const lineItemId = String(item.id);
                                        setEditingPriceItemId(lineItemId);
                                        setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: editorPriceValue.toFixed(2) }));
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
                                        const rawValue = priceEditTextById[lineItemId] ?? editorPriceValue.toFixed(2);
                                        const parsed = Number.parseFloat(rawValue);
                                        if (!Number.isFinite(parsed) || parsed < 0) {
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: editorPriceValue.toFixed(2) }));
                                          setEditingPriceItemId((prev) => (prev === lineItemId ? null : prev));
                                          return;
                                        }

                                        const nextCents = Math.round(parsed * 100);
                                        const calculatedCents = baseCalculatedTotalCents;
                                        const mode = selectedOverrideMode;
                                        markPricingDirtyByUser(lineItemId, "price_override_value");
                                        const qtyForOverride = isExpanded && expandedItem?.id === item.id ? qtyNum : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
                                        const nextPricing = applyLineItemEditPriceOverride({
                                          baseCalculatedTotalCents: calculatedCents,
                                          quantity: qtyForOverride,
                                          mode,
                                          valueCents: nextCents,
                                        });

                                        if (nextPricing.effectiveTotalCents !== calculatedCents || mode !== "override_total_after_margin") {
                                          setPendingPriceOverrideById((prev) => ({ ...prev, [lineItemId]: nextPricing }));
                                          setComputedTotal(nextPricing.effectiveTotalCents / 100);
                                          setComputedTotalQty(qtyForOverride);
                                          onDraftLineItemPricingChange?.(lineItemId, nextPricing.effectiveTotalCents);
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (nextCents / 100).toFixed(2) }));
                                        } else {
                                          const clearPricing: PendingLineItemPriceOverride = {
                                            ...nextPricing,
                                            hasPriceOverride: false,
                                            priceOverrideMode: null,
                                            priceOverrideValueCents: null,
                                            priceOverrideValuePercent: null,
                                            effectiveTotalCents: calculatedCents,
                                            effectiveUnitPriceCents: Math.round(calculatedCents / Math.max(1, qtyForOverride)),
                                          };
                                          setPendingPriceOverrideById((prev) => ({ ...prev, [lineItemId]: clearPricing }));
                                          setComputedTotal(clearPricing.effectiveTotalCents / 100);
                                          setComputedTotalQty(qtyForOverride);
                                          onDraftLineItemPricingChange?.(lineItemId, clearPricing.effectiveTotalCents);
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (calculatedCents / 100).toFixed(2) }));
                                        }
                                        setEditingPriceItemId((prev) => (prev === lineItemId ? null : prev));
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
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: editorPriceValue.toFixed(2) }));
                                        }
                                      }
                                }
                                onUndoOverride={
                                  readOnly || currentOverrideCents === null
                                    ? undefined
                                    : () => {
                                        const lineItemId = String(item.id);
                                        markPricingDirtyByUser(lineItemId, "price_override_clear");
                                        const calculatedCents = baseCalculatedTotalCents;
                                        const qtyForOverride = isExpanded && expandedItem?.id === item.id ? qtyNum : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);
                                        const clearPricing: PendingLineItemPriceOverride = {
                                          baseCalculatedTotalCents: calculatedCents,
                                          baseCalculatedUnitPriceCents: Math.round(calculatedCents / Math.max(1, qtyForOverride)),
                                          effectiveTotalCents: calculatedCents,
                                          effectiveUnitPriceCents: Math.round(calculatedCents / Math.max(1, qtyForOverride)),
                                          priceOverrideMode: null,
                                          priceOverrideValueCents: null,
                                          priceOverrideValuePercent: null,
                                          hasPriceOverride: false,
                                        };
                                        setPendingPriceOverrideById((prev) => ({ ...prev, [lineItemId]: clearPricing }));
                                        setComputedTotal(clearPricing.effectiveTotalCents / 100);
                                        setComputedTotalQty(qtyForOverride);
                                        onDraftLineItemPricingChange?.(lineItemId, clearPricing.effectiveTotalCents);
                                        setPriceOverrideModeById((prev) => {
                                          const next = { ...prev };
                                          delete next[lineItemId];
                                          return next;
                                        });
                                        setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (calculatedCents / 100).toFixed(2) }));
                                      }
                                }
                                priceControlSlot={
                                  isExpanded && expandedItem && expandedItem.id === item.id ? (
                                    <div>
                                      <select
                                        aria-label="Price override mode"
                                        value={overrideSelectValue}
                                        onChange={(event) => {
                                          const lineItemId = String(item.id);
                                          const selectedValue = event.target.value;
                                          const calculatedCents = baseCalculatedTotalCents;
                                          const qtyForOverride = isExpanded && expandedItem?.id === item.id ? qtyNum : (Number(item.quantity) > 0 ? Number(item.quantity) : 1);

                                          if (selectedValue === "__none") {
                                            markPricingDirtyByUser(lineItemId, "price_override_clear");
                                            const clearPricing: PendingLineItemPriceOverride = {
                                              baseCalculatedTotalCents: calculatedCents,
                                              baseCalculatedUnitPriceCents: Math.round(calculatedCents / Math.max(1, qtyForOverride)),
                                              effectiveTotalCents: calculatedCents,
                                              effectiveUnitPriceCents: Math.round(calculatedCents / Math.max(1, qtyForOverride)),
                                              priceOverrideMode: null,
                                              priceOverrideValueCents: null,
                                              priceOverrideValuePercent: null,
                                              hasPriceOverride: false,
                                            };
                                            setPendingPriceOverrideById((prev) => ({ ...prev, [lineItemId]: clearPricing }));
                                            setComputedTotal(clearPricing.effectiveTotalCents / 100);
                                            setComputedTotalQty(qtyForOverride);
                                            onDraftLineItemPricingChange?.(lineItemId, clearPricing.effectiveTotalCents);
                                            setPriceOverrideModeById((prev) => {
                                              const next = { ...prev };
                                              delete next[lineItemId];
                                              return next;
                                            });
                                            setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (calculatedCents / 100).toFixed(2) }));
                                            return;
                                          }

                                          const nextMode = selectedValue as LineItemPriceOverrideMode;
                                          markPricingDirtyByUser(lineItemId, "price_override_mode");
                                          setPriceOverrideModeById((prev) => ({ ...prev, [lineItemId]: nextMode }));

                                          const rawValue = priceEditTextById[lineItemId] ?? editorPriceValue.toFixed(2);
                                          const parsed = Number.parseFloat(rawValue);
                                          const valueCents = Math.round((Number.isFinite(parsed) && parsed >= 0 ? parsed : editorPriceValue) * 100);
                                          const nextPricing = applyLineItemEditPriceOverride({
                                            baseCalculatedTotalCents: calculatedCents,
                                            quantity: qtyForOverride,
                                            mode: nextMode,
                                            valueCents,
                                          });

                                          setPendingPriceOverrideById((prev) => ({ ...prev, [lineItemId]: nextPricing }));
                                          setComputedTotal(nextPricing.effectiveTotalCents / 100);
                                          setComputedTotalQty(qtyForOverride);
                                          onDraftLineItemPricingChange?.(lineItemId, nextPricing.effectiveTotalCents);
                                          setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: (valueCents / 100).toFixed(2) }));
                                        }}
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
                                        Calculated {formatMoney(baseCalculatedTotal)} · Effective {formatMoney(displayTotal)}
                                      </div>
                                    </div>
                                  ) : undefined
                                }
                                pricingDetailsSlot={
                                  isExpanded && expandedItem && expandedItem.id === item.id ? (
                                    <div className="space-y-0.5" data-testid="line-item-pricing-details">
                                      {quantityOnly ? (
                                        <>
                                          <div>Quantity {pricingDetailQuantity}</div>
                                          <div>Rate per piece {formatMoney(displayPerEa)}</div>
                                          <div>Formula: q x rate per piece = {formatMoney(displayTotal)}</div>
                                        </>
                                      ) : (
                                        <>
                                          {calculatedSqft != null ? <div>Calculated sqft: {calculatedSqft.toFixed(2)}</div> : null}
                                          {billedSqft != null && billedSqft !== calculatedSqft ? <div>Billed sqft: {billedSqft.toFixed(2)}</div> : null}
                                          {displayedRatePerSqft != null ? <div>Price per sqft: {formatMoney(displayedRatePerSqft)}</div> : null}
                                          <div>Unit price: {formatMoney(displayPerEa)}</div>
                                          <div>Quantity: {pricingDetailQuantity}</div>
                                          <div>Formula: width x height / 144 x quantity</div>
                                          <div>Calculated: {formatMoney(baseCalculatedTotal)}; Effective: {formatMoney(displayTotal)}</div>
                                        </>
                                      )}
                                      {isOverride ? <div>Override: {overrideLabel}</div> : <div>No price override</div>}
                                    </div>
                                  ) : undefined
                                }
                                internalNoteCount={(lineItemInternalNotesQuery.data ?? []).length}
                                internalNotesSlot={
                                  <Collapsible defaultOpen={false} className="mt-3 rounded-md border border-border/40 bg-muted/20 p-3">
                                    <CollapsibleTrigger asChild>
                                      <button type="button" className="flex w-full items-center justify-between gap-2 text-left">
                                        <div>
                                          <div className="text-sm font-medium">Line Item Internal Notes</div>
                                          <div className="text-xs text-muted-foreground">
                                            Structured staff notes. {fulfillmentOnly ? "Use Fulfillment Notes for pick/pack instructions." : "Use Production Notes for operator instructions."}
                                          </div>
                                        </div>
                                        {lineItemInternalNotesQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                      </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-3 space-y-2">
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
                                    </CollapsibleContent>
                                  </Collapsible>
                                }
                                quantityOnly={quantityOnly}
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
                                    {activeWorkWarning && (
                                      <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
                                        <div className="font-medium">{activeWorkWarning.title}</div>
                                        <div className="mt-1">{activeWorkWarning.description}</div>
                                      </div>
                                    )}

                                    {isExpanded && expandedItem && expandedItem.id === item.id && false && (
                                      <div className="mb-3 rounded-md border border-border/40 bg-background/70 p-3">
                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <div className="text-sm font-medium">Price details</div>
                                            <div className="text-xs text-muted-foreground">
                                              Calculated {formatMoney(baseCalculatedTotal)} · Effective {formatMoney(displayTotal)}
                                            </div>
                                          </div>
                                          {isOverride ? (
                                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">
                                              {overrideLabel}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="flex">
                                          <select
                                            value={selectedOverrideMode}
                                            onChange={(event) => {
                                              const nextMode = event.target.value as LineItemPriceOverrideMode;
                                              const lineItemId = String(item.id);
                                              markPricingDirtyByUser(lineItemId, "price_override_mode");
                                              setPriceOverrideModeById((prev) => ({ ...prev, [lineItemId]: nextMode }));
                                              const currentValue = getLineItemOverrideInputValue(item, nextMode, displayPrice);
                                              setPriceEditTextById((prev) => ({ ...prev, [lineItemId]: currentValue.toFixed(2) }));
                                            }}
                                            className="hidden"
                                            disabled={readOnly}
                                          >
                                            <option value="override_total_after_margin">Total override</option>
                                            <option value="override_unit_after_margin">Unit override</option>
                                            <option value="override_total_before_margin">Total before margin</option>
                                            <option value="override_unit_before_margin">Unit before margin</option>
                                            <option value="apply_discount">Discount</option>
                                            <option value="append_value">Add value</option>
                                          </select>
                                          <div className="text-xs text-muted-foreground self-center">
                                            Base unit {formatMoney(baseCalculatedTotal / Math.max(1, Number(item.quantity) || 1))} · Qty {item.quantity || 0}
                                          </div>
                                        </div>
                                      </div>
                                    )}

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
                                          onUserEdit={() => {
                                            markPricingDirtyByUser(String(item.id), "pbv2_user_edit");
                                            markUserEditedOptions(expandedItem?.id);
                                          }}
                                          onValidityChange={setOptionsV2Valid}
                                          onRenderStatsChange={setPbv2PanelRenderStats}
                                          compact
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
                                            markPricingDirtyByUser(String(item.id), "legacy_options");
                                            markUserEditedOptions(expandedItem?.id);
                                            setOptionSelections(next);
                                          }}
                                          compact
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

                                  </>
                                }
                                artworkSlot={
                                  showArtworkControls ? <>
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
                                        lineQuantity={item.quantity}
                                        defaultExpanded={true}
                                        doubleSided={printSides === "Double-sided"}
                                        useSameArtworkBothSides={useSameArtworkBothSides}
                                        onUseSameArtworkBothSidesChange={setUseSameArtworkBothSides}
                                        onSavedAttachmentRemoved={handleSavedArtworkRemoved}
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
                                  </> : null
                                }
                                requiresDesign={isExpanded && expandedItem?.id === item.id ? requiresDesignInput : Boolean((item as any).requiresDesign)}
                                requiresPrepress={isExpanded && expandedItem?.id === item.id ? requiresPrepressInput : ((item as any).requiresPrepress ?? null)}
                                requiresProofApproval={renderedRequiresProofApproval}
                                proofApprovalRequiredByDefault={proofApprovalRequiredByDefault}
                                proofApprovalLockEnabled={proofApprovalLockEnabled}
                                onRequiresDesignChange={!readOnly && isExpanded && expandedItem?.id === item.id ? setRequiresDesignInput : undefined}
                                onRequiresPrepressChange={!readOnly && isExpanded && expandedItem?.id === item.id ? setRequiresPrepressInput : undefined}
                                onRequiresProofApprovalChange={!readOnly && isExpanded && expandedItem?.id === item.id ? setRequiresProofApprovalInput : undefined}
                                topAnchorRef={setLineItemTopAnchorRef(String(item.id))}
                                widthInputRef={setLineItemWidthInputRef(String(item.id))}
                                detailsSide="right"
                                collapseSecondaryDetails={false}
                                compactExpandedLayout={true}
                                fulfillmentOnly={fulfillmentOnly}
                                serviceFee={serviceFee}
                                isDirty={isExpanded && expandedItem && expandedItem.id === item.id ? isDirty : false}
                                isSaving={savingItemId === item.id}
                                isSaved={!isDirty && (savedItemId === item.id || designBriefSavedAt === item.id)}
                                onSave={readOnly ? undefined : handleSaveItem}
                                onDuplicate={readOnly ? undefined : () => void handleDuplicateItem(item)}
                                onRemove={readOnly ? undefined : () => void handleRemoveItem(item.id)}
                                readOnly={readOnly}
                              />

                              {!readOnly && !serviceFee ? (
                                <div className="mt-2 flex flex-wrap justify-end gap-2">
                                  {!childItem && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => {
                                        setChildParentLineItemId(String(item.id));
                                        setSearchQuery("");
                                        setSearchOpen(true);
                                      }}
                                    >
                                      <Plus className="mr-1 h-3.5 w-3.5" />
                                      Add child item
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => {
                                      setParentLinkTarget(item);
                                      setSelectedParentLineItemId((item as any).parentLineItemId ?? null);
                                    }}
                                    data-testid={`button-link-parent-${item.id}`}
                                  >
                                    {(item as any).parentLineItemId ? "Change parent" : "Link to parent"}
                                  </Button>
                                  {(item as any).parentLineItemId ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={parentLinkMutation.isPending}
                                      onClick={() => parentLinkMutation.mutate({ lineItemId: String(item.id), parentLineItemId: null })}
                                      data-testid={`button-unlink-parent-${item.id}`}
                                    >
                                      Unlink
                                    </Button>
                                  ) : null}
                                  {!childItem && showOpenProofingAction ? (
                                    <Button asChild type="button" variant="outline" size="sm" className="h-8">
                                      <Link to={buildProofingLineItemPath(item.id)}>Open Proofing</Link>
                                    </Button>
                                  ) : null}
                                  {!childItem && displayedProductionActions.map((action) => (
                                    <Button
                                      key={`${item.id}-${action}`}
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={productionAction.isPending}
                                      onClick={() => productionAction.mutate({
                                        action,
                                        targets: groupProductionActionTargets,
                                      })}
                                    >
                                      {getLineItemWorkflowActionLabel(
                                        ({ start: "Start Production", resume: "Resume Production", hold: "Hold", complete: "Complete", return_to_prepress: "Return to Prepress" }[action]),
                                        hasGroupChildren,
                                      )}
                                    </Button>
                                  ))}
                                  {!childItem && !operationalDisplay.isProductionOwned && !fulfillmentOnly && groupScheduleTargetIds.length > 0 && (workflowState === "ready_for_production" || hasGroupChildren) ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={scheduleProduction.isPending}
                                      onClick={() => scheduleProduction.mutate(groupScheduleTargetIds)}
                                    >
                                      {getLineItemWorkflowActionLabel("Send to Production", hasGroupChildren)}
                                    </Button>
                                  ) : null}
                                  {!childItem && !operationalDisplay.isProductionOwned && workflowState !== "ready_for_production"
                                    ? getWorkflowActions(workflowState).map((action, index) => (
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
                                          {fulfillmentOnly && action.label === "Start Production"
                                            ? "Start Fulfillment"
                                            : getLineItemWorkflowActionLabel(action.label, hasGroupChildren)}
                                        </Button>
                                      ))
                                    : null}
                                  {!childItem && !(item as any).productionBypassed ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => { setProductionBypassTarget(item); setProductionBypassReason(""); }}
                                    >
                                      {getLineItemWorkflowActionLabel("Bypass Production", hasGroupChildren)}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
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
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-label="Add Product"
                  aria-expanded={searchOpen}
                  className="h-10 w-full justify-center border-primary/40 bg-primary/5 font-medium text-primary hover:bg-primary/10"
                >
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  <span>{searchQuery ? "Searching: " + searchQuery : childParentLineItemId ? "Add child item" : "Add Product"}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(520px,calc(100vw-2rem))] p-0"
                align="start"
                onCloseAutoFocus={(event) => {
                  // Prevent Radix from restoring focus to an Add Product trigger when the popover
                  // closes. The pendingJumpToLineItemId scroll effect moves focus to the new
                  // line-item anchor so Width / Height / Qty stay in view.
                  event.preventDefault();
                }}
              >
                <Command shouldFilter={false}>
                  <CommandInput placeholder={childParentLineItemId ? "Choose a product for this child item..." : "Search by name, SKU, or category..."} value={searchQuery} onValueChange={setSearchQuery} />
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
                              const created = await createLineItem.mutateAsync({
                                ...createPayload,
                                ...(childParentLineItemId
                                  ? { parentLineItemId: childParentLineItemId, lineItemRole: "child" as const }
                                  : {}),
                              });
                              const nextId = created?.data?.id ?? created?.id ?? null;
                              setSearchQuery("");
                              setSearchOpen(false);
                              setChildParentLineItemId(null);
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
          </div>
        )}
      </CardContent>

      <AttachmentViewerDialog
        attachments={artworkViewerAttachments}
        open={!!artworkViewerLineItemId && artworkViewerAttachments.length > 0}
        onOpenChange={(open) => {
          if (!open) setArtworkViewerLineItemId(null);
        }}
      />
      <Dialog open={productionBypassTarget !== null} onOpenChange={(open) => { if (!open && !productionBypass.isPending) setProductionBypassTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bypass production?</DialogTitle>
            <DialogDescription>
              {productionBypassTarget?.lineItemRole === "parent"
                ? "This marks the parent group and its child items as No Production Required. It does not mark production complete or remove existing production history."
                : "This marks the selected line as No Production Required. It does not mark production complete or remove any existing production history."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={productionBypassReason}
            onChange={(event) => setProductionBypassReason(event.target.value)}
            placeholder="Reason required (for example: blank substrate sold without printing)"
            aria-label="Production bypass reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductionBypassTarget(null)} disabled={productionBypass.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={productionBypass.isPending || productionBypassReason.trim().length < 3 || !productionBypassTarget}
              onClick={() => productionBypassTarget && productionBypass.mutate({ lineItemId: String(productionBypassTarget.id), reason: productionBypassReason.trim() })}
            >
              {productionBypass.isPending
                ? "Bypassing..."
                : productionBypassTarget?.lineItemRole === "parent"
                  ? "Mark Group No Production Required"
                  : "Mark No Production Required"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={parentLinkTarget !== null} onOpenChange={(open) => { if (!open && !parentLinkMutation.isPending) setParentLinkTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{(parentLinkTarget as any)?.parentLineItemId ? "Change parent line item" : "Link line item to parent"}</DialogTitle>
            <DialogDescription>Select another eligible line item in this order. No line item, artwork, or production history is recreated.</DialogDescription>
          </DialogHeader>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={selectedParentLineItemId ?? ""}
            onChange={(event) => setSelectedParentLineItemId(event.target.value || null)}
            aria-label="Parent line item"
          >
            <option value="">Choose a parent line item</option>
            {orderedLineItems.filter((candidate) => String(candidate.id) !== String(parentLinkTarget?.id) && (candidate as any).lineItemRole !== "child").map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{(candidate as any).description ?? `Line item ${candidate.id}`}</option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParentLinkTarget(null)} disabled={parentLinkMutation.isPending}>Cancel</Button>
            <Button disabled={!selectedParentLineItemId || parentLinkMutation.isPending} onClick={() => parentLinkTarget && parentLinkMutation.mutate({ lineItemId: String(parentLinkTarget.id), parentLineItemId: selectedParentLineItemId })}>
              {parentLinkMutation.isPending ? "Saving..." : "Save parent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </Popover>
  );
});
