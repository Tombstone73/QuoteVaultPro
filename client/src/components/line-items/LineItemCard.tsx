import { ReactNode, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, GripVertical, Loader2, Minus, Plus, Save, Check, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LineItemCard - Shared presentational component for Quote and Order line items.
 * 
 * Provides:
 * - Collapsed 3-row summary with description preview + "Internal" badge
 * - Expanded 2-column layout (options left, artwork + description + production notes right)
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
  sizeLabel: string; // e.g., "24\" × 36\""
  qtyLabel: string; // e.g., "Qty 100"
  unitPriceLabel: string; // e.g., "$2.50/ea"
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

  // Thumbnail
  thumbnail?: ReactNode;

  // Drag handle (for edit mode)
  dragHandleProps?: {
    attributes?: Record<string, any>;
    listeners?: Record<string, any>;
    disabled?: boolean;
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
  editingPrice?: boolean;
  priceEditText?: string;
  onPriceClick?: () => void;
  onPriceChange?: (value: string) => void;
  onPriceBlur?: () => void;
  onPriceKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onUndoOverride?: () => void;

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
  onRequiresDesignChange?: (value: boolean) => void;
  onRequiresPrepressChange?: (value: boolean) => void;
  topAnchorRef?: (node: HTMLDivElement | null) => void;

  // Expanded view - Options slot (left column)
  optionsSlot?: ReactNode;

  // Expanded view - Artwork slot (right column, above description)
  artworkSlot?: ReactNode;
  detailsSide?: "left" | "right";
  collapseSecondaryDetails?: boolean;
  compactExpandedLayout?: boolean;

  // Actions
  isDirty?: boolean;
  isSaving?: boolean;
  isSaved?: boolean;
  onSave?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;

  // Mode
  readOnly?: boolean;
};

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

export function LineItemCard({
  id,
  itemKey,
  contentId,
  isExpanded,
  onToggleExpand,
  title,
  sizeLabel,
  qtyLabel,
  unitPriceLabel,
  totalLabel,
  badges,
  descriptionPreview,
  showNoteLabel = true,
  optionChips = [],
  overflowCount = 0,
  summaryFooter,
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
  editingPrice = false,
  priceEditText = "",
  onPriceClick,
  onPriceChange,
  onPriceBlur,
  onPriceKeyDown,
  onUndoOverride,
  isCalculating = false,
  calcError = null,
  description,
  productionNotes,
  onDescriptionChange,
  onProductionNotesChange,
  requiresDesign = false,
  requiresPrepress = null,
  requiresProofApproval = false,
  onRequiresDesignChange,
  onRequiresPrepressChange,
  topAnchorRef,
  optionsSlot,
  artworkSlot,
  detailsSide = "left",
  collapseSecondaryDetails = false,
  compactExpandedLayout = false,
  isDirty = false,
  isSaving = false,
  isSaved = false,
  onSave,
  onDuplicate,
  onRemove,
  readOnly = false,
}: LineItemCardProps) {
  const hasNote = Boolean(descriptionPreview) && showNoteLabel;
  const hasOverride = Boolean(priceOverride != null);
  const hasProductionNotes = Boolean(productionNotes && productionNotes.trim());
  const dragDisabled = Boolean(dragHandleProps?.disabled);
  const detailsOnRight = detailsSide === "right";
  const [secondaryDetailsOpen, setSecondaryDetailsOpen] = useState(false);

  useEffect(() => {
    if (!isExpanded) {
      setSecondaryDetailsOpen(false);
    }
  }, [isExpanded]);

  const secondaryDetailsSummary = useMemo(() => {
    const parts: string[] = [];
    if (artworkSlot) parts.push("Artwork");
    if (description.trim()) parts.push("Description");
    if (hasProductionNotes) parts.push("Notes");
    if (!readOnly || requiresDesign || requiresPrepress !== null || requiresProofApproval) parts.push("Setup");
    return parts.length > 0 ? parts.join(" · ") : "Artwork, notes, and setup";
  }, [artworkSlot, description, hasProductionNotes, readOnly, requiresDesign, requiresPrepress, requiresProofApproval]);

  const detailsFields = (
    <>
      <div className="mt-3 space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange?.(e.target.value)}
          placeholder="Add custom description for this line item..."
          className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          disabled={readOnly}
        />
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          Production Notes (internal)
          <span className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded">
            Staff only
          </span>
        </label>
        <textarea
          value={productionNotes}
          onChange={(e) => onProductionNotesChange?.(e.target.value)}
          placeholder="Internal production notes (not shown to customers)..."
          className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          disabled={readOnly}
        />
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          Routing Intent
          <span className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded">
            Staff only
          </span>
        </label>
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
          <label className="flex items-center gap-2 text-sm select-none text-muted-foreground">
            <input
              type="checkbox"
              checked={requiresProofApproval === true}
              disabled
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Proof Approval
          </label>
        </div>
        {requiresPrepress === null && (
          <p className="text-xs text-muted-foreground">Prepress routing not explicitly set — will default to product type / org setting on conversion.</p>
        )}
      </div>
    </>
  );

  const actionsRow = (
    <>
      {!readOnly && (onSave || onDuplicate || onRemove) && (
        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-sm">
          <div className="flex items-center gap-2">
            {onSave && isDirty && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-8"
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
                className="h-8"
                onClick={onDuplicate}
              >
                Duplicate Item
              </Button>
            )}
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                onClick={onRemove}
              >
                Remove Item
              </Button>
            )}
          </div>
          {isDirty && (
            <div className="text-xs text-amber-600">Unsaved</div>
          )}
        </div>
      )}
    </>
  );

  const secondaryDetailsContent = (
    <>
      {artworkSlot}
      {detailsFields}
    </>
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

  return (
    <div
      id={`line-item-${id}`}
      tabIndex={-1}
      className={cn("rounded-lg border border-border/40 bg-background/30 focus:outline-none", isExpanded && "bg-background/40 border-border/60")}
    >
      {/* Collapsed Summary Row - Enterprise Dense Layout */}
      <button
        type="button"
        className="w-full text-left p-2.5 hover:bg-muted/20 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-lg"
        onClick={onToggleExpand}
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
              onPointerDown={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          
          {/* Left Zone: Product + Size + Qty */}
          <div className="flex items-center gap-2 min-w-0">
            {thumbnail}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
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
                Overridden
              </span>
            )}
            {hasProductionNotes && (
              <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">Internal</span>
            )}
          </div>
        )}
      </button>

      {/* Expanded Editor - When Expanded (edit mode OR view mode) */}
      {isExpanded && (
        <div id={contentId} className="px-3 pb-3">
          <div className={cn("rounded-md border border-border/40 bg-muted/20 p-3", !compactExpandedLayout && "min-h-[400px]")}>
            <div
              id={`line-item-top-anchor-${id}`}
              ref={topAnchorRef}
              tabIndex={-1}
              className="h-0 w-full overflow-hidden outline-none"
            />
            {/* Top editing row */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted-foreground">Width</div>
                    <Input
                      value={width}
                      onChange={(e) => onWidthChange?.(e.target.value)}
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
                    onClick={onQuantityDecrement}
                    disabled={readOnly}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    value={String(quantity)}
                    onChange={(e) => onQuantityChange?.(Number.parseInt(e.target.value || "1", 10) || 1)}
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
                    onClick={onQuantityIncrement}
                    disabled={readOnly}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="ml-auto text-right min-h-[60px]">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="flex items-center gap-2 justify-end">
                  {editingPrice ? (
                    <Input
                      type="text"
                      value={priceEditText}
                      onChange={(e) => onPriceChange?.(e.target.value)}
                      onBlur={onPriceBlur}
                      onKeyDown={onPriceKeyDown}
                      autoFocus
                      className="font-mono text-lg font-bold h-auto px-2 py-1 text-right w-32"
                    />
                  ) : (
                    <div 
                      className={`font-mono text-lg font-bold ${!readOnly && onPriceClick ? 'cursor-pointer hover:bg-accent/50 px-2 py-1 rounded transition-colors' : ''}`}
                      onClick={onPriceClick}
                    >
                      {formatMoney(priceOverride != null ? priceOverride : price)}
                    </div>
                  )}
                  {priceOverride != null && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-medium">
                        Override
                      </span>
                      {!readOnly && onUndoOverride && (
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
                <div className="h-5 flex items-center justify-end">
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
                  {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
                </div>
              </div>
            </div>

            <Separator className="my-3" />

            {/* Options (left) + Artwork (right) */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
              {detailsOnRight ? (
                <>
                  <div className="min-w-0">
                    {optionsSlot}
                  </div>

                  <div className="min-w-0 lg:w-[360px] lg:shrink-0">
                    {secondaryDetailsPanel}
                    {actionsRow}
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    {optionsSlot}
                    {collapseSecondaryDetails ? secondaryDetailsPanel : detailsFields}
                    {actionsRow}
                  </div>

                  <div className="min-w-0 lg:w-[360px] lg:shrink-0">
                    {!collapseSecondaryDetails ? artworkSlot : null}
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
