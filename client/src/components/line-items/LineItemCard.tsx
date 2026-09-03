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
import { ChevronRight, Copy, GripVertical, Loader2, Minus, Plus, Save, Check, Trash2, Undo2 } from "lucide-react";
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
  onUndoOverride?: () => void;
  priceControlSlot?: ReactNode;
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
  onUndoOverride,
  priceControlSlot,
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

      {internalNotesSlot}
    </>
  );

  const advancedControls = (
      <Collapsible defaultOpen={requiresDesign || requiresPrepress === true || requiresProofApproval} className="rounded-md border border-border/40 bg-background/40 p-2.5">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between text-left">
            <span className="text-sm font-medium">Advanced / Staff Controls</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={requiresDesign === true}
              onChange={(e) => onRequiresDesignChange?.(e.target.checked)}
              disabled={readOnly}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Requires Design
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={requiresPrepress === true}
              onChange={(e) => onRequiresPrepressChange?.(e.target.checked)}
              disabled={readOnly}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Requires Prepress
          </label>
          <label className={cn(
            "flex items-center gap-2 text-sm select-none",
            proofApprovalDisabled ? "text-muted-foreground" : "cursor-pointer",
          )}>
            <input
              type="checkbox"
              checked={displayedRequiresProofApproval}
              onChange={(e) => onRequiresProofApprovalChange?.(e.target.checked)}
              disabled={proofApprovalDisabled}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Proof Approval
          </label>
        </div>
        {requiresPrepress === null && (
          <p className="text-xs text-muted-foreground">Prepress routing not explicitly set — will default to product type / org setting on conversion.</p>
        )}
      </div>
        </CollapsibleContent>
      </Collapsible>
  );

  const actionsRow = (
    <>
      {!readOnly && (onSave || onDuplicate || onRemove || relationshipActionsSlot) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {onSave && isDirty && (
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
            {onSave && !isDirty && isSaved && (
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <Check className="w-3.5 h-3.5" />
                Saved
              </div>
            )}
            {onDuplicate && (
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
            {onRemove && <RemoveLineItemButton onRemove={onRemove} />}
            {relationshipActionsSlot}
          </div>
          {isDirty && (
            <div className="text-xs text-amber-600">Unsaved</div>
          )}
        </div>
      )}
    </>
  );

  const configurationSection = optionsSlot ? (
    <section className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Finishing &amp; Print</div>
      {optionsSlot}
    </section>
  ) : null;

  const secondaryDetailsContent = (
    <div className="space-y-3">
      {artworkSlot ? (
        <section className="rounded-md border border-border/40 bg-background/40 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artwork Assets</div>
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
      {advancedControls}
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
      tabIndex={-1}
      className={cn("relative rounded-lg border border-border/40 bg-background/30 focus:outline-none", isExpanded && "bg-background/40 border-border/60", containerClassName)}
    >
      {/* Collapsed Summary Row - Enterprise Dense Layout */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "w-full text-left p-2.5 hover:bg-muted/20 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-lg",
          headerActions && "pr-20"
        )}
        onClick={onToggleExpand}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpand();
          }
        }}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        aria-label={isExpanded ? "Collapse line item" : "Expand line item"}
      >
        <div className="grid gap-2 items-center" style={{ gridTemplateColumns: showDragHandle ? 'auto minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' : 'minmax(240px,1.2fr) minmax(220px,2fr) minmax(140px,0.8fr)' }}>
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
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
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
            </div>
          </div>

          {/* Middle Zone: Option Chips (single line, no wrap) */}
          <div className="min-w-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
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
          <div className="flex items-center justify-end gap-2 shrink-0">
            <div className="text-right tabular-nums">
              <div className="font-mono text-sm font-semibold">{totalLabel}</div>
              <div className="text-[10px] text-muted-foreground">{unitPriceLabel}</div>
            </div>
            <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
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
            <div
              id={`line-item-top-anchor-${id}`}
              ref={topAnchorRef}
              tabIndex={-1}
              aria-hidden="true"
              className="h-0 w-full overflow-hidden outline-none"
            />
            {lineLabel ? <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lineLabel}</div> : null}
            {/* Compact operational controls */}
            <div className="flex flex-wrap items-end gap-3">
              {primaryControlSlot ? (
                <section className={cn("min-w-[220px] flex-1", !nonProductionItem && "rounded-md border border-border/40 bg-background/40 p-2.5")}>
                  {!nonProductionItem ? <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material &amp; Product</div> : null}
                  {primaryControlSlot}
                </section>
              ) : null}
              <section className={cn("flex flex-wrap items-end gap-3", !nonProductionItem && "rounded-md border border-border/40 bg-background/40 p-2.5")}>
              {!nonProductionItem ? <div className="w-full text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dimensions &amp; Quantity</div> : null}
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

              <div className="flex items-center gap-2">
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

              <div className={cn("w-[220px] self-end", nonProductionItem ? "text-left" : "ml-auto text-right")}>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className={cn("flex items-center gap-2", nonProductionItem ? "justify-start" : "justify-end")}>
                  {editingPrice ? (
                    <Input
                      type="text"
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
                  <div className="mt-1">{priceControlSlot}</div>
                ) : null}
                <div className="text-[11px] text-muted-foreground">{priceLabel} {unitPriceLabel}</div>
                {pricingDetailsSlot ? (
                  <Collapsible defaultOpen={false} className="mt-1">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        data-quantity-only={quantityOnly ? "true" : "false"}
                        className={cn(
                          "text-[11px] font-medium text-muted-foreground hover:text-foreground",
                          nonProductionItem ? "text-left" : "ml-auto block"
                        )}
                      >
                        Pricing details
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className={cn("pt-1 text-[11px] text-muted-foreground", nonProductionItem ? "text-left" : "text-right")}>
                      {pricingDetailsSlot}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
                <div className={cn("h-5 flex items-center", nonProductionItem ? "justify-start" : "justify-end")}>
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
                  {!isCalculating && !calcError && !isPreviewPrice && <div className="text-[11px] text-transparent">—</div>}
                </div>
              </div>
            </div>

            {!nonProductionItem ? <Separator className="my-3" /> : null}

            {/* Options (left) + Artwork (right) */}
            <div className={cn("grid grid-cols-1 gap-3", !nonProductionItem && "lg:grid-cols-[1fr_360px]")}>
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
          </div>
        </div>
      )}
    </div>
  );
}
