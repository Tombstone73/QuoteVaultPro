import { type FocusEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Bug, ChevronRight, CircleHelp, Copy, GripVertical, History, Loader2, Minus, Plus, Save, Check, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LineItemCard - Shared presentational component for Quote and Order line items.
 * 
 * Provides:
 * - Collapsed 3-row summary with description preview + "Internal" badge
 * - Expanded operational layout (configuration left, artwork and staff notes right)
 * - Consistent styling and behavior across Quotes and Orders
 * 
 * Pure UI component - no data fetching or mutations. All logic passed as props.
 */

export type LineItemCardProps = {
  // Identity
  id: string;
  itemKey: string;
  contentId: string;

  // Expansion state
  isExpanded: boolean;
  onToggleExpand: () => void;

  // Collapsed view data
  title: string; // Product name
  lineLabel?: string;
  sizeLabel: string; // e.g., "24\" × 36\""
  qtyLabel: string; // e.g., "Qty 100"
  unitPriceLabel: string; // e.g., "$2.50/ea"
  priceLabel?: string;
  totalLabel: string; // e.g., "$250.00"
  
  // Optional badges for collapsed view
  badges?: {
    draft?: boolean;
    isNew?: boolean;
    override?: boolean;
    internal?: boolean; // Shows "Internal" badge if productionNotes exists
  };

  // Description preview (customer-facing)
  descriptionPreview?: string | null;
  showNoteLabel?: boolean;
  
  // Option chips for collapsed view
  optionChips?: Array<{ text: string; key: string }>;
  overflowCount?: number;
  summaryFooter?: ReactNode;
  relationshipActionsSlot?: ReactNode;
  containerClassName?: string;

  // Thumbnail
  thumbnail?: ReactNode;
  /** Compact identity of the primary production artwork for a collapsed line. */
  artworkSummary?: string | null;
  artworkSummaryKind?: "artwork" | "file";

  // Drag handle (for edit mode)
  dragHandleProps?: {
    attributes?: Record<string, any>;
    listeners?: Record<string, any>;
    disabled?: boolean;
    disabledReason?: string;
  };
  showDragHandle?: boolean;

  // Expanded view - Dimensions & Quantity
  width: string;
  height: string;
  quantity: number;
  onWidthChange?: (value: string) => void;
  onHeightChange?: (value: string) => void;
  onQuantityChange?: (value: number) => void;
  onQuantityIncrement?: () => void;
  onQuantityDecrement?: () => void;
  dimsRequired?: boolean;

  // Expanded view - Price
  price: number; // Total price
  priceOverride?: number | null;
  priceOverrideLabel?: string;
  editingPrice?: boolean;
  priceEditText?: string;
  onPriceClick?: () => void;
  onPriceChange?: (value: string) => void;
  onPriceBlur?: () => void;
  onPriceKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Uses the existing canonical unit-price override path. */
  editingUnitPrice?: boolean;
  unitPriceEditText?: string;
  onUnitPriceClick?: () => void;
  onUnitPriceChange?: (value: string) => void;
  onUnitPriceBlur?: () => void;
  onUnitPriceKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onUndoOverride?: () => void;
  priceControlSlot?: ReactNode;
  /** Existing taxability control, placed adjacent to the commercial override controls. */
  taxControlSlot?: ReactNode;
  pricingDetailsSlot?: ReactNode;
  primaryControlSlot?: ReactNode;

  // Calculating state
  isCalculating?: boolean;
  calcError?: string | null;

  // Expanded view - Description & Production Notes
  description: string;
  productionNotes: string;
  onDescriptionChange?: (value: string) => void;
  onProductionNotesChange?: (value: string) => void;

  // Expanded view - Routing intent (migration 0015, internal / staff only)
  requiresDesign?: boolean;
  requiresPrepress?: boolean | null;
  requiresProofApproval?: boolean;
  proofApprovalRequiredByDefault?: boolean;
  proofApprovalLockEnabled?: boolean;
  onRequiresDesignChange?: (value: boolean) => void;
  onRequiresPrepressChange?: (value: boolean) => void;
  onRequiresProofApprovalChange?: (value: boolean) => void;
  topAnchorRef?: (node: HTMLDivElement | null) => void;
  widthInputRef?: (node: HTMLInputElement | null) => void;

  // Expanded view - Product, material, print, and finishing controls (left column)
  optionsSlot?: ReactNode;

  // Expanded view - Artwork slot (right column, above notes)
  artworkSlot?: ReactNode;
  internalNotesSlot?: ReactNode;
  advancedControlsSlot?: ReactNode;
  internalNoteCount?: number;
  detailsSide?: "left" | "right";
  collapseSecondaryDetails?: boolean;
  compactExpandedLayout?: boolean;
  fulfillmentOnly?: boolean;
  serviceFee?: boolean;
  quantityOnly?: boolean;

  // Actions
  isDirty?: boolean;
  isSaving?: boolean;
  isSaved?: boolean;
  isPreviewPrice?: boolean;
  onSave?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;

  // Mode
  readOnly?: boolean;
  /** Allows only the price override control while operational fields stay read-only. */
  commercialPricingEditable?: boolean;
};

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function selectInputTextOnFocus(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  input.select();

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      if (document.activeElement === input) {
        input.select();
      }
    });
  }
}

function stopLineItemActionPropagation(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function RemoveLineItemButton({
  onRemove,
  iconOnly = false,
}: {
  onRemove: () => void;
  iconOnly?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={iconOnly ? "icon" : "sm"}
          className={cn(
            iconOnly ? "h-8 w-8 shrink-0" : "h-8",
            "text-destructive hover:text-destructive"
          )}
          aria-label="Remove line item"
          title="Remove line item"
          onClick={stopLineItemActionPropagation}
          onPointerDown={stopLineItemActionPropagation}
        >
          {iconOnly ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : "Remove Item"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={stopLineItemActionPropagation}>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove line item?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the line item from the quote or order. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onRemove}
          >
            Remove line item
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LineItemCard({
  id,
  itemKey,
  contentId,
  isExpanded,
  onToggleExpand,
  title,
  lineLabel,
  sizeLabel,
  qtyLabel,
  unitPriceLabel,
  priceLabel = "Unit price",
  totalLabel,
  badges,
  descriptionPreview,
  showNoteLabel = true,
  optionChips = [],
  overflowCount = 0,
  summaryFooter,
  relationshipActionsSlot,
  containerClassName,
  thumbnail,
  artworkSummary,
  artworkSummaryKind = "artwork",
  dragHandleProps,
  showDragHandle = false,
  width,
  height,
  quantity,
  onWidthChange,
  onHeightChange,
  onQuantityChange,
  onQuantityIncrement,
  onQuantityDecrement,
  dimsRequired = true,
  price,
  priceOverride,
  priceOverrideLabel = "Override",
  editingPrice = false,
  priceEditText = "",
  onPriceClick,
  onPriceChange,
  onPriceBlur,
  onPriceKeyDown,
  editingUnitPrice = false,
  unitPriceEditText = "",
  onUnitPriceClick,
  onUnitPriceChange,
  onUnitPriceBlur,
  onUnitPriceKeyDown,
  onUndoOverride,
  priceControlSlot,
  taxControlSlot,
  pricingDetailsSlot,
  primaryControlSlot,
  isCalculating = false,
  calcError = null,
  description,
  productionNotes,
  onDescriptionChange,
  onProductionNotesChange,
  requiresDesign = false,
  requiresPrepress = null,
  requiresProofApproval = false,
  proofApprovalRequiredByDefault,
  proofApprovalLockEnabled = false,
  onRequiresDesignChange,
  onRequiresPrepressChange,
  onRequiresProofApprovalChange,
  topAnchorRef,
  widthInputRef,
  optionsSlot,
  artworkSlot,
  internalNotesSlot,
  advancedControlsSlot,
  internalNoteCount = 0,
  detailsSide = "left",
  collapseSecondaryDetails = false,
  compactExpandedLayout = false,
  fulfillmentOnly = false,
  serviceFee = false,
  quantityOnly = false,
  isDirty = false,
  isSaving = false,
  isSaved = false,
  isPreviewPrice = false,
  onSave,
  onDuplicate,
  onRemove,
  readOnly = false,
  commercialPricingEditable = false,
}: LineItemCardProps) {
  const nonProductionItem = fulfillmentOnly || serviceFee;
  const hasNote = Boolean(descriptionPreview) && showNoteLabel;
  const hasOverride = Boolean(priceOverride != null);
  const hasProductionNotes = Boolean(productionNotes && productionNotes.trim());
  const dragDisabled = Boolean(dragHandleProps?.disabled);
  const detailsOnRight = detailsSide === "right";
  const proofRequiredByDefault = proofApprovalRequiredByDefault ?? requiresProofApproval === true;
  const proofApprovalLocked = proofApprovalLockEnabled && proofRequiredByDefault;
  const displayedRequiresProofApproval = proofApprovalLocked ? true : requiresProofApproval === true;
  const proofApprovalDisabled = readOnly || proofApprovalLocked || !onRequiresProofApprovalChange;
  const canEditPrice = !readOnly || commercialPricingEditable;
  const [secondaryDetailsOpen, setSecondaryDetailsOpen] = useState(false);
  const [quantityDraft, setQuantityDraft] = useState(String(quantity));
  const [quantityError, setQuantityError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded) {
      setSecondaryDetailsOpen(false);
    }
  }, [isExpanded]);

  useEffect(() => {
    setQuantityDraft(String(quantity));
    setQuantityError(null);
  }, [quantity, id]);

  const applyQuantity = (nextQuantity: number) => {
    const normalized = Math.max(1, Math.floor(nextQuantity));
    setQuantityDraft(String(normalized));
    setQuantityError(null);
    onQuantityChange?.(normalized);
  };

  const updateQuantityDraft = (nextValue: string) => {
    setQuantityDraft(nextValue);
    if (!/^\d+$/.test(nextValue)) {
      setQuantityError("Enter a whole quantity of 1 or more.");
      return;
    }
    const parsed = Number(nextValue);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setQuantityError("Quantity must be a whole number of 1 or more.");
      return;
    }
    setQuantityError(null);
    onQuantityChange?.(parsed);
  };

  const commitQuantityDraft = () => {
    if (!/^\d+$/.test(quantityDraft)) {
      setQuantityError("Enter a whole quantity of 1 or more.");
      return;
    }
    const parsed = Number(quantityDraft);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setQuantityError("Quantity must be a whole number of 1 or more.");
      return;
    }
    applyQuantity(parsed);
  };

  const secondaryDetailsSummary = useMemo(() => {
    const parts: string[] = [];
    if (artworkSlot) parts.push("Artwork");
    if (description.trim()) parts.push("Description");
    if (hasProductionNotes) parts.push("Notes");
    if (internalNoteCount > 0) parts.push(`${internalNoteCount} internal`);
    if (!readOnly || requiresDesign || requiresPrepress !== null || requiresProofApproval) parts.push("Setup");
    return parts.length > 0 ? parts.join(" · ") : "Artwork, notes, and setup";
  }, [artworkSlot, description, hasProductionNotes, internalNoteCount, readOnly, requiresDesign, requiresPrepress, requiresProofApproval]);

  const notesFields = (
    <>
      <Collapsible defaultOpen={Boolean(description.trim())} className="mt-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground">
            Customer-facing description
            <ChevronRight className="h-4 w-4" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange?.(e.target.value)}
            placeholder="Add custom description for this line item..."
            className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            disabled={readOnly}
          />
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-3 space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {serviceFee ? "Service Notes (internal)" : fulfillmentOnly ? "Fulfillment Notes (internal)" : "Production Notes (internal)"}
          <span className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded">
            Staff only
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          {serviceFee ? "Visible to staff handling this billing line; not shown to customers." : fulfillmentOnly ? "Visible to staff handling pick, pack, and fulfillment." : "Visible to production staff; not shown to customers."}
        </p>
        <textarea
          value={productionNotes}
          onChange={(e) => onProductionNotesChange?.(e.target.value)}
          placeholder={serviceFee ? "Internal service or billing instructions (not shown to customers)..." : fulfillmentOnly ? "Internal pick, pack, or fulfillment instructions (not shown to customers)..." : "Internal production notes (not shown to customers)..."}
          className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          disabled={readOnly}
        />
      </div>

      {!compactExpandedLayout ? internalNotesSlot : null}
    </>
  );

  const routingControls = !readOnly ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Line routing requirements">
      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none">
        <input type="checkbox" checked={requiresDesign === true} onChange={(e) => onRequiresDesignChange?.(e.target.checked)} className="h-3.5 w-3.5 rounded border-input accent-primary" />
        Design
      </label>
      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none">
        <input type="checkbox" checked={requiresPrepress === true} onChange={(e) => onRequiresPrepressChange?.(e.target.checked)} className="h-3.5 w-3.5 rounded border-input accent-primary" />
        Prepress
      </label>
      <label className={cn("flex items-center gap-1.5 text-xs font-medium select-none", proofApprovalDisabled ? "text-muted-foreground" : "cursor-pointer")}>
        <input type="checkbox" checked={displayedRequiresProofApproval} onChange={(e) => onRequiresProofApprovalChange?.(e.target.checked)} disabled={proofApprovalDisabled} className="h-3.5 w-3.5 rounded border-input accent-primary" />
        Proof approval
      </label>
    </div>
  ) : null;

  const lineHistoryControl = compactExpandedLayout && internalNotesSlot ? (
    <Collapsible className="relative">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" title="Line-item note history">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          History
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="absolute bottom-full left-0 z-30 mb-2 w-[min(34rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-3 shadow-lg">
        {internalNotesSlot}
      </CollapsibleContent>
    </Collapsible>
  ) : null;

  const diagnosticsControl = advancedControlsSlot ? (
    <Collapsible className="relative">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Line diagnostics" title="Line diagnostics">
          <Bug className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="absolute bottom-full right-0 z-30 mb-2 w-[min(46rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-3 shadow-lg">
        <div className="space-y-3">
          {requiresPrepress === null ? <p className="text-xs text-muted-foreground">Prepress routing follows the product or organization default.</p> : null}
          {advancedControlsSlot}
        </div>
      </CollapsibleContent>
    </Collapsible>
  ) : null;

  const actionsRow = (
    <>
      {(!readOnly && (onSave || onDuplicate || onRemove || relationshipActionsSlot)) || lineHistoryControl || diagnosticsControl ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && onSave && isDirty && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-auto min-h-8 whitespace-normal leading-tight"
                onClick={onSave}
                disabled={isSaving || isCalculating}
              >
                {isSaving ? (
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
            {!readOnly && onSave && !isDirty && isSaved && (
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <Check className="w-3.5 h-3.5" />
                Saved
              </div>
            )}
            {!readOnly && onDuplicate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal leading-tight"
                onClick={onDuplicate}
              >
                Duplicate Item
              </Button>
            )}
            {!readOnly && onRemove && <RemoveLineItemButton onRemove={onRemove} />}
            {!readOnly ? relationshipActionsSlot : null}
            {!readOnly ? routingControls : null}
            {lineHistoryControl}
            {diagnosticsControl}
          </div>
          {!readOnly && isDirty && (
            <div className="text-xs text-amber-600">Unsaved</div>
          )}
        </div>
      ) : null}
    </>
  );

  const compactCommercialControls = (
    <div className="min-w-0 space-y-3">
      {primaryControlSlot ? <div className="min-w-0">{primaryControlSlot}</div> : null}
      <div
        className={cn(
          "grid min-w-0 gap-3",
          dimsRequired ? "grid-cols-1 sm:grid-cols-3" : "max-w-[10rem] grid-cols-1",
        )}
        data-testid="order-line-dimensions-row"
      >
        {dimsRequired ? (
          <>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Width
              <Input id={`line-item-width-input-${id}`} ref={widthInputRef} value={width} onChange={(event) => onWidthChange?.(event.target.value)} onFocus={selectInputTextOnFocus} className="h-8 w-full min-w-0 font-mono" inputMode="decimal" disabled={readOnly} readOnly={readOnly} />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Height
              <Input value={height} onChange={(event) => onHeightChange?.(event.target.value)} onFocus={selectInputTextOnFocus} className="h-8 w-full min-w-0 font-mono" inputMode="decimal" disabled={readOnly} readOnly={readOnly} />
            </label>
          </>
        ) : null}
        <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
          Qty
          <div className="flex h-8 min-w-0 items-center rounded-md border border-border/60 bg-background/40">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Decrease quantity" onClick={() => { if (onQuantityChange) applyQuantity(quantity - 1); else onQuantityDecrement?.(); }} disabled={readOnly}><Minus className="h-3.5 w-3.5" /></Button>
            <Input value={quantityDraft} onChange={(event) => updateQuantityDraft(event.currentTarget.value)} onBlur={commitQuantityDraft} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitQuantityDraft(); event.currentTarget.blur(); } }} className="h-7 min-w-0 border-0 px-1 text-center font-mono focus-visible:ring-0" inputMode="numeric" type="text" pattern="[0-9]*" aria-label="Quantity" aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? `line-item-quantity-error-${id}` : undefined} disabled={readOnly} readOnly={readOnly} />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Increase quantity" onClick={() => { if (onQuantityChange) applyQuantity(quantity + 1); else onQuantityIncrement?.(); }} disabled={readOnly}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {quantityError ? <div id={`line-item-quantity-error-${id}`} className="text-xs text-destructive" role="alert">{quantityError}</div> : null}
        </div>
      </div>
      <div
        className="grid min-w-0 grid-cols-2 items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,9rem)_minmax(0,12rem)_auto]"
        data-testid="order-line-pricing-row"
      >
        <label className="grid min-w-0 gap-1 text-center text-xs text-muted-foreground">
          {priceLabel}
          {editingUnitPrice ? <Input type="text" inputMode="decimal" value={unitPriceEditText} onChange={(event) => onUnitPriceChange?.(event.target.value)} onBlur={onUnitPriceBlur} onKeyDown={onUnitPriceKeyDown} autoFocus className="h-8 w-full min-w-0 px-2 text-center font-mono text-sm font-semibold" aria-label="Unit price override" /> : onUnitPriceClick ? <button type="button" className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-center font-mono text-sm font-semibold shadow-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onUnitPriceClick} aria-label="Edit unit price">{unitPriceLabel}</button> : <div className="flex h-8 items-center justify-center font-mono text-sm font-semibold">{unitPriceLabel}</div>}
        </label>
        <div className="grid min-w-0 gap-1 text-center text-xs text-muted-foreground">
          <span className="flex items-center justify-center gap-1">
            Line total
            {pricingDetailsSlot ? (
              <Collapsible className="relative leading-none">
                <CollapsibleTrigger asChild>
                  <button type="button" data-quantity-only={quantityOnly ? "true" : "false"} className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Pricing details" title="Pricing details">
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-md border border-border bg-background p-2.5 text-left text-[11px] leading-4 text-muted-foreground shadow-lg">
                  {pricingDetailsSlot}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </span>
          {editingPrice ? <Input type="text" inputMode="decimal" value={priceEditText} onChange={(event) => onPriceChange?.(event.target.value)} onBlur={onPriceBlur} onKeyDown={onPriceKeyDown} autoFocus className="h-8 w-full min-w-0 px-2 text-center font-mono text-sm font-semibold" /> : <button type="button" className={cn("h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-center font-mono text-sm font-semibold shadow-sm", canEditPrice && onPriceClick ? "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default")} onClick={onPriceClick} disabled={!canEditPrice || !onPriceClick}>{formatMoney(priceOverride != null ? priceOverride : price)}</button>}
        </div>
        <div className="grid min-w-0 gap-1 text-center text-xs text-muted-foreground">
          <span>Override</span>
          <div className="flex min-h-8 flex-wrap items-center justify-center gap-2">
            {priceControlSlot ?? <span className="text-sm">—</span>}
          </div>
          {priceOverride != null && <div className="flex items-center justify-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"><span>{priceOverrideLabel}</span>{canEditPrice && onUndoOverride ? <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={onUndoOverride} title="Undo override"><Undo2 className="h-3 w-3" /></Button> : null}</div>}
        </div>
        {taxControlSlot ? <div className="flex min-w-0 items-center self-end pb-0.5">{taxControlSlot}</div> : null}
        <div className="col-span-full flex items-center text-[11px]">
          {isCalculating ? <div className="text-muted-foreground">Calculating…</div> : null}
          {!!calcError && calcError === "PBV2_SCHEMA_MISMATCH" ? <div className="font-medium text-amber-600 dark:text-amber-500">⚠️ Outdated PBV2 config</div> : null}
          {!!calcError && calcError !== "PBV2_SCHEMA_MISMATCH" ? <div className="max-w-[420px] truncate text-destructive" title={calcError}>{calcError.trim().startsWith("{") || /^\d+:\s*{/.test(calcError) ? "Calculation failed. Check required options." : calcError}</div> : null}
          {!isCalculating && !calcError && isPreviewPrice ? <div className="font-medium text-amber-600 dark:text-amber-500">Preview price · unsaved</div> : null}
        </div>
      </div>
    </div>
  );

  const commercialControls = compactExpandedLayout ? compactCommercialControls : (
            <div className={compactExpandedLayout ? "flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3" : "flex flex-wrap items-end gap-x-5 gap-y-3"}>
              {primaryControlSlot ? (
                <section className={cn(compactExpandedLayout ? "basis-full min-w-0" : "min-w-[220px] flex-[1_1_280px]", !nonProductionItem && !compactExpandedLayout && "rounded-md border border-border/40 bg-background/40 p-2.5")}>
                  {!nonProductionItem && !compactExpandedLayout ? <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</div> : null}
                  {primaryControlSlot}
                </section>
              ) : null}
              <section className={cn("flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3", !nonProductionItem && !compactExpandedLayout && "rounded-md border border-border/40 bg-background/40 p-2.5")}>
              {!nonProductionItem && !compactExpandedLayout ? <div className="w-full text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dimsRequired ? "Dimensions & Quantity" : "Quantity"}</div> : null}
              {dimsRequired ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted-foreground">Width</div>
                    <Input
                      id={`line-item-width-input-${id}`}
                      ref={widthInputRef}
                      value={width}
                      onChange={(e) => onWidthChange?.(e.target.value)}
                      onFocus={selectInputTextOnFocus}
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
                      value={height}
                      onChange={(e) => onHeightChange?.(e.target.value)}
                      onFocus={selectInputTextOnFocus}
                      className={cn("h-8 w-24 font-mono", !dimsRequired && "opacity-60")}
                      inputMode="decimal"
                      disabled={readOnly || !dimsRequired}
                      readOnly={readOnly}
                    />
                  </div>
                </div>
              </div>
              ) : null}

              <div className={cn("flex gap-2", compactExpandedLayout ? "flex-col items-start gap-1" : "items-center")}>
                <div className="text-xs text-muted-foreground">Qty</div>
                <div className="flex items-center rounded-md border border-border/60 bg-background/40">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Decrease quantity"
                    onClick={() => {
                      if (onQuantityChange) applyQuantity(quantity - 1);
                      else onQuantityDecrement?.();
                    }}
                    disabled={readOnly}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    value={quantityDraft}
                    onChange={(e) => updateQuantityDraft(e.currentTarget.value)}
                    onBlur={commitQuantityDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitQuantityDraft();
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-8 w-16 border-0 text-center font-mono focus-visible:ring-0"
                    inputMode="numeric"
                    type="text"
                    pattern="[0-9]*"
                    aria-label="Quantity"
                    aria-invalid={Boolean(quantityError)}
                    aria-describedby={quantityError ? `line-item-quantity-error-${id}` : undefined}
                    disabled={readOnly}
                    readOnly={readOnly}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Increase quantity"
                    onClick={() => {
                      if (onQuantityChange) applyQuantity(quantity + 1);
                      else onQuantityIncrement?.();
                    }}
                    disabled={readOnly}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {quantityError ? (
                  <div id={`line-item-quantity-error-${id}`} className="mt-1 text-xs text-destructive" role="alert">
                    {quantityError}
                  </div>
                ) : null}
              </div>
              </section>

              <div className={cn(compactExpandedLayout ? "grid min-w-0 grid-cols-2 items-start gap-x-3 gap-y-1 text-left" : "min-w-[190px] self-end", !compactExpandedLayout && "rounded-md border border-border/40 bg-background/40 p-2.5", nonProductionItem || compactExpandedLayout ? "text-left" : "text-right")}>
                {!nonProductionItem && !compactExpandedLayout ? <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</div> : null}
                <div className={compactExpandedLayout ? "col-start-2 text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>Line total</div>
                <div className={cn("flex flex-wrap items-center gap-2", compactExpandedLayout ? "col-start-2 row-start-2 justify-start" : nonProductionItem ? "justify-start" : "justify-end")}>
                  {editingPrice ? (
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={priceEditText}
                      onChange={(e) => onPriceChange?.(e.target.value)}
                      onBlur={onPriceBlur}
                      onKeyDown={onPriceKeyDown}
                      autoFocus
                      className="h-8 w-32 px-3 text-right font-mono text-sm font-semibold"
                    />
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        "h-8 w-32 rounded-md border border-input bg-background px-3 text-right font-mono text-sm font-semibold shadow-sm",
                        canEditPrice && onPriceClick
                          ? "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          : "cursor-default"
                      )}
                      onClick={onPriceClick}
                      disabled={!canEditPrice || !onPriceClick}
                    >
                      {formatMoney(priceOverride != null ? priceOverride : price)}
                    </button>
                  )}
                  {priceOverride != null && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-medium">
                        {priceOverrideLabel}
                      </span>
                      {canEditPrice && onUndoOverride && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={onUndoOverride}
                          title="Undo override"
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {priceControlSlot ? (
                  <div className={compactExpandedLayout ? "col-span-2 mt-1" : "mt-1"}>{priceControlSlot}</div>
                ) : null}
                <div className={compactExpandedLayout ? "col-start-1 row-start-1 row-span-2 space-y-1 text-sm" : "text-[11px] text-muted-foreground"}>{compactExpandedLayout ? <><div className="text-xs text-muted-foreground">{priceLabel}</div>{editingUnitPrice ? <Input type="text" inputMode="decimal" value={unitPriceEditText} onChange={(event) => onUnitPriceChange?.(event.target.value)} onBlur={onUnitPriceBlur} onKeyDown={onUnitPriceKeyDown} autoFocus className="h-8 w-28 px-2 font-mono text-sm font-semibold" aria-label="Unit price override" /> : onUnitPriceClick ? <button type="button" className="flex h-8 min-w-28 items-center rounded-md border border-input bg-background px-2 font-mono text-sm font-semibold shadow-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onUnitPriceClick} aria-label="Edit unit price">{unitPriceLabel}</button> : <div className="flex h-8 items-center font-mono font-semibold">{unitPriceLabel}</div>}</> : <>{priceLabel} {unitPriceLabel}</>}</div>
                {pricingDetailsSlot ? (
                  <Collapsible defaultOpen={false} className={compactExpandedLayout ? "col-span-2 mt-1" : "mt-1"}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        data-quantity-only={quantityOnly ? "true" : "false"}
                        className={cn(
                          "text-[11px] font-medium text-muted-foreground hover:text-foreground",
                          nonProductionItem || compactExpandedLayout ? "text-left" : "ml-auto block"
                        )}
                      >
                        Pricing details
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className={cn("pt-1 text-[11px] text-muted-foreground", nonProductionItem || compactExpandedLayout ? "text-left" : "text-right")}>
                      {pricingDetailsSlot}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
                <div className={cn("flex items-center", compactExpandedLayout ? "col-span-2 justify-start" : "h-5", nonProductionItem ? "justify-start" : "justify-end")}>
                  {isCalculating && <div className="text-[11px] text-muted-foreground">Calculating…</div>}
                  {!!calcError && calcError === "PBV2_SCHEMA_MISMATCH" && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-500 font-medium">
                      ⚠️ Outdated PBV2 config
                    </div>
                  )}
                  {!!calcError && calcError !== "PBV2_SCHEMA_MISMATCH" && (
                    <div className="text-[11px] text-destructive truncate max-w-[420px]" title={calcError}>
                      {/* Never show raw JSON in the UI; fall back to a friendly message if it leaks through. */}
                      {calcError.trim().startsWith("{") || /^\d+:\s*{/.test(calcError)
                        ? "Calculation failed. Check required options."
                        : calcError}
                    </div>
                  )}
                  {!isCalculating && !calcError && isPreviewPrice && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-500 font-medium">Preview price · unsaved</div>
                  )}
                  {!compactExpandedLayout && !isCalculating && !calcError && !isPreviewPrice && <div className="text-[11px] text-transparent">—</div>}
                </div>
              </div>
            </div>
  );

  const configurationSection = optionsSlot ? (
    <section className={cn(!compactExpandedLayout && "rounded-md border border-border/40 bg-background/40 p-3")}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product Options</div>
      {optionsSlot}
    </section>
  ) : null;

  const compactNotesSection = (
    <section className="min-w-0 rounded-md border border-border/40 bg-background/40 p-3" aria-label="Notes">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Customer notes
          <textarea value={description} onChange={(event) => onDescriptionChange?.(event.target.value)} placeholder="Add customer-facing description..." className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm normal-case font-normal tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" disabled={readOnly} />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Staff only notes
          <textarea value={productionNotes} onChange={(event) => onProductionNotesChange?.(event.target.value)} placeholder={serviceFee ? "Internal service or billing instructions..." : fulfillmentOnly ? "Internal pick, pack, or fulfillment instructions..." : "Internal production notes..."} className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm normal-case font-normal tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" disabled={readOnly} />
        </label>
      </div>
    </section>
  );

  const secondaryDetailsContent = (
    <div className="space-y-3">
      {artworkSlot ? (
        <section className="rounded-md border border-border/40 bg-background/40 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artwork</div>
          {artworkSlot}
        </section>
      ) : null}
      <Collapsible defaultOpen={false} className="rounded-md border border-border/40 bg-background/40">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</span>
              {(Boolean(description.trim()) || hasProductionNotes || internalNoteCount > 0) ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {internalNoteCount > 0 ? `${internalNoteCount} internal${internalNoteCount === 1 ? " note" : " notes"}` : "Has notes"}
                </span>
              ) : null}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border/40 px-3 pb-3">
          {notesFields}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );

  const secondaryDetailsPanel = collapseSecondaryDetails ? (
    <Collapsible open={secondaryDetailsOpen} onOpenChange={setSecondaryDetailsOpen}>
      <div className="rounded-md border border-border/40 bg-background/60 p-2.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">Details</div>
              <div className="truncate text-xs text-muted-foreground">{secondaryDetailsSummary}</div>
            </div>
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", secondaryDetailsOpen && "rotate-90")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {secondaryDetailsContent}
        </CollapsibleContent>
      </div>
    </Collapsible>
  ) : secondaryDetailsContent;

  const headerActions = !readOnly && (onDuplicate || onRemove) ? (
    <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1">
      {onDuplicate && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Duplicate line item"
          title="Duplicate line item"
          onClick={(event) => {
            stopLineItemActionPropagation(event);
            onDuplicate();
          }}
          onPointerDown={stopLineItemActionPropagation}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {onRemove && <RemoveLineItemButton onRemove={onRemove} iconOnly />}
    </div>
  ) : null;

  return (
    <div
      id={`line-item-${id}`}
      ref={topAnchorRef}
      tabIndex={-1}
      className={cn("relative rounded-lg border border-border/40 bg-background/30 focus:outline-none", isExpanded && "bg-background/40 border-border/60", containerClassName)}
    >
      {/* Collapsed Summary Row - Enterprise Dense Layout */}
      <div
        className={cn(
          "w-full text-left p-2.5 hover:bg-muted/20 transition-colors rounded-lg",
          headerActions && "pr-20"
        )}
        onClick={onToggleExpand}
      >
        <div className={cn("grid gap-2 items-center", compactExpandedLayout && (showDragHandle ? "grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,2fr)_auto]" : "grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto]"))} style={compactExpandedLayout ? undefined : { gridTemplateColumns: showDragHandle ? 'auto minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' : 'minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' }}>
          {/* Drag Handle (edit mode only) */}
          {showDragHandle && (
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded p-0.5 disabled:opacity-30 disabled:cursor-not-allowed self-center"
              {...dragHandleProps?.attributes}
              {...dragHandleProps?.listeners}
              disabled={dragDisabled}
              aria-label="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                dragHandleProps?.listeners?.onPointerDown?.(event);
              }}
              title={dragDisabled ? dragHandleProps?.disabledReason ?? "Reordering is unavailable" : "Drag to reorder"}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          
          {/* Left Zone: Product + Size + Qty */}
          <div className="flex items-center gap-2 min-w-0">
            {thumbnail}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                {lineLabel ? <span className="shrink-0 text-xs font-semibold text-muted-foreground">{lineLabel}</span> : null}
                <span className="text-sm font-semibold truncate">{title}</span>
                {badges?.draft && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 shrink-0">
                    Draft
                  </Badge>
                )}
                {badges?.isNew && (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                    New
                  </Badge>
                )}
              </div>
              <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums", compactExpandedLayout && "flex-wrap")}>
                <span className="font-mono">{sizeLabel}</span>
                <span>·</span>
                <span>{qtyLabel}</span>
              </div>
              {/* Description preview (customer-facing) */}
              {descriptionPreview && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-xs text-muted-foreground/80 mt-0.5 truncate max-w-full italic">
                        {descriptionPreview}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm">
                      <p className="text-xs whitespace-pre-wrap">{descriptionPreview}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {artworkSummary && (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={artworkSummary}>
                  {artworkSummaryKind === "artwork" ? "Artwork" : "Files"} · {artworkSummary}
                </div>
              )}
            </div>
          </div>

          {/* Middle Zone: Option Chips (single line, no wrap) */}
          <div className={cn("min-w-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap", compactExpandedLayout && showDragHandle && "col-start-2 md:col-start-auto")}>
            {optionChips.map((chip) => (
              <span
                key={chip.key}
                className="px-1.5 py-0.5 rounded text-[11px] bg-muted/40 text-muted-foreground whitespace-nowrap shrink-0"
              >
                {chip.text}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="text-[11px] text-muted-foreground/60 shrink-0">
                +{overflowCount}
              </span>
            )}
          </div>

          {/* Right Zone: Price + Expand Icon */}
          <div className={cn("flex items-center gap-2 shrink-0", compactExpandedLayout ? "justify-start md:justify-end" : "justify-end", compactExpandedLayout && showDragHandle && "col-start-2 md:col-start-auto")}>
            <div className="text-right tabular-nums">
              <div className="font-mono text-sm font-semibold">{totalLabel}</div>
              <div className="text-[10px] text-muted-foreground">{unitPriceLabel}</div>
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={isExpanded}
              aria-controls={contentId}
              aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
              onClick={(event) => {
                stopLineItemActionPropagation(event);
                onToggleExpand();
              }}
              onPointerDown={stopLineItemActionPropagation}
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} aria-hidden="true" />
            </button>
          </div>
        </div>

        {summaryFooter ? (
          <div className="mt-1.5">{summaryFooter}</div>
        ) : null}

        {/* Optional Meta Row (only if relevant) */}
        {(hasNote || hasOverride || hasProductionNotes) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            {hasNote && (
              <span className="bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded font-medium">
                Note
              </span>
            )}
            {hasOverride && (
              <span className="bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded font-medium">
                {priceOverrideLabel}
              </span>
            )}
            {hasProductionNotes && (
              <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">Internal</span>
            )}
          </div>
        )}
      </div>
      {headerActions}

      {/* Expanded Editor - When Expanded (edit mode OR view mode) */}
      {isExpanded && (
        <div id={contentId} className="px-3 pb-3">
          <div className={cn("rounded-md border border-border/40 bg-muted/20 p-3", !compactExpandedLayout && "min-h-[400px]")}>
            {!compactExpandedLayout && lineLabel ? <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lineLabel}</div> : null}
            {!compactExpandedLayout ? commercialControls : null}

            {!nonProductionItem && !compactExpandedLayout ? <Separator className="my-3" /> : null}

            {compactExpandedLayout ? (
              <div className="space-y-3" data-testid="order-line-editor">
                <div className={cn(
                  "grid items-start gap-3",
                  optionsSlot && artworkSlot && "2xl:grid-cols-[minmax(17rem,0.85fr)_minmax(21rem,1.2fr)_minmax(19rem,0.95fr)]",
                  optionsSlot && !artworkSlot && "xl:grid-cols-[minmax(17rem,0.85fr)_minmax(21rem,1.2fr)]",
                  !optionsSlot && artworkSlot && "xl:grid-cols-[minmax(17rem,0.85fr)_minmax(19rem,1.15fr)]",
                )} data-testid="order-line-main-editing">
                  <section className="min-w-0 rounded-md border border-border/40 bg-background/40 p-3" aria-label={dimsRequired ? "Dimensions & Pricing" : "Quantity & Pricing"}>
                    <h3 className="mb-3 text-sm font-semibold">{dimsRequired ? "Dimensions & Pricing" : "Quantity & Pricing"}</h3>
                    {commercialControls}
                  </section>
                  {optionsSlot ? <section className="min-w-0 rounded-md border border-border/40 bg-background/40 p-3" aria-label="Product Options"><h3 className="mb-2 text-sm font-semibold">Product Options</h3>{optionsSlot}</section> : null}
                  {artworkSlot ? <section className="min-w-0 rounded-md border border-border/40 bg-background/40 p-3" aria-label="Artwork"><h3 className="mb-2 text-sm font-semibold">Artwork</h3>{artworkSlot}</section> : null}
                </div>
                <div className="grid min-w-0 items-start gap-3" data-testid="order-line-lower-editing">
                  {compactNotesSection}
                </div>
                {actionsRow}
              </div>
            ) : (
            <div className={cn("grid grid-cols-1 gap-3", !nonProductionItem && "xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]")}>
              {nonProductionItem ? (
                <div className="min-w-0">
                  {secondaryDetailsPanel}
                  {configurationSection}
                  {actionsRow}
                </div>
              ) : detailsOnRight ? (
                <>
                  <div className="min-w-0">
                    {configurationSection}
                  </div>

                  <div className="min-w-0 lg:w-[360px] lg:shrink-0">
                    {secondaryDetailsPanel}
                    {actionsRow}
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    {configurationSection}
                  </div>

                  <div className="min-w-0 lg:w-[360px] lg:shrink-0">
                    {collapseSecondaryDetails ? secondaryDetailsPanel : secondaryDetailsContent}
                    {actionsRow}
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
