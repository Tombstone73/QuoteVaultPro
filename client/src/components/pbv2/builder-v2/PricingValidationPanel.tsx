import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircleIcon, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import {
  normalizePreviewError,
  buildClientPreviewError,
  buildUnexpectedPreviewError,
  categorizePreviewDetails,
  findMissingRequiredSelections,
  enrichPreviewDetails,
  buildPreviewErrorSummary,
  PBV2_PREVIEW_CLIENT_VALIDATION,
  type NormalizedPreviewError,
  type PreviewErrorDetail,
  type RequiredSelectionGroup,
} from "@/lib/pbv2/pricing/previewError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { compareCanonicalGeometryPricing, detectsManualGeometryRebuild } from "@/lib/pbv2/pricing/geometryWarning";
import type { Finding } from "@shared/pbv2/findings";
import { pbv2TreeToEditorModel, type EditorModel } from "@/lib/pbv2/pbv2ViewModel";
import { resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";
import { filterPbv2ChoicesForRuntime } from "@shared/pbv2OrderEntryRuntime";
import { getPbv2FixedDimensions } from "@shared/pbv2/fixedDimensions";
import { presentPbv2FindingForOperator } from "@shared/pbv2/validationPresentation";

export type PricingPreviewState = {
  width: number;
  height: number;
  quantity: number;
  selectedOptionValues: Record<string, string | string[] | boolean | number>;
  unit: "in";
};

type PricingPreviewResponse = {
  unitPrice: number;
  totalPrice: number;
  formulaUsed?: string;
  breakdown?: {
    basePrice: number;
    optionsPrice: number;
    total: number;
  };
  derived?: {
    sqft?: number;
    totalSqft?: number;
    linearFeet?: number;
    orderedWidth?: number;
    orderedHeight?: number;
    trimAllowanceX?: number;
    trimAllowanceY?: number;
    finishedWidth?: number;
    finishedHeight?: number;
  };
  errors?: string[];
  debug?: {
    pricingSystem?: "pbv2";
    formulaRaw: string;
    formulaResolved?: string;
    variables: Record<string, number | string | boolean | null>;
    variableSources?: Record<string, string>;
    resultValue?: number;
    appliedAs?: "unitPrice" | "totalPrice" | "unknown";
    steps?: Array<{ label: string; value: number | string }>;
    errors?: Array<{ code: string; message: string; detail?: any }>;
    likelyMisconfiguredFormula?: boolean;
    lastCeilInput?: number | null;
    lastCeilResult?: number | null;
    optionPriceContributions?: Array<{
      optionId: string;
      selectionKey?: string;
      optionLabel: string;
      choiceValue?: string;
      choiceLabel?: string;
      amountCents: number;
    }>;
    rawSqftPerItem?: number;
    rawTotalSqft?: number;
    baseRateUsed?: number | null;
    inputs?: {
      widthIn: number;
      heightIn: number;
      quantity: number;
      ordered_width?: number;
      ordered_height?: number;
      trim_allowance_x?: number;
      trim_allowance_y?: number;
      finished_width?: number;
      finished_height?: number;
    };
    derived?: {
      sqft: number;
      totalSqft: number;
      linearFeet: number;
      ordered_width?: number;
      ordered_height?: number;
      trim_allowance_x?: number;
      trim_allowance_y?: number;
      finished_width?: number;
      finished_height?: number;
    };
    pricing?: {
      basePrice: number;
      optionsPrice: number;
      unitPrice: number;
      totalPrice: number;
      formulaEvaluatedTotal?: number | null;
      rawBasePrice?: number | null;
      evaluatedFormulaTotalRaw?: number | null;
      evaluatedFormulaTotalRounded?: number | null;
      roundingAppliedAt?: "final_currency_total" | "not_applicable";
      pbv2BaseTotal?: number;
      finalTotalSource?: "formula" | "pbv2_base" | "manual_override";
      finalTotal?: number;
      formulaSourceMode?: "library" | "manual" | "profile";
      resolvedFormulaSource?: "library" | "manual" | "tree_meta" | "product" | "profile" | "none";
      resolvedFormulaId?: string | null;
      resolvedFormulaName?: string | null;
      resolvedFormulaExpression?: string;
      manualFormulaPresent?: boolean;
      manualFormulaIgnored?: boolean;
      variableSources?: Record<string, string>;
    };
    formulaEvaluatedTotal?: number | null;
    rawBasePrice?: number | null;
    evaluatedFormulaTotalRaw?: number | null;
    evaluatedFormulaTotalRounded?: number | null;
    roundingAppliedAt?: "final_currency_total" | "not_applicable";
    pbv2BaseTotal?: number;
    finalTotalSource?: "formula" | "pbv2_base" | "manual_override";
    finalTotal?: number;
    formulaSourceMode?: "library" | "manual" | "profile";
    resolvedFormulaSource?: "library" | "manual" | "tree_meta" | "product" | "profile" | "none";
    resolvedFormulaId?: string | null;
    resolvedFormulaName?: string | null;
    resolvedFormulaExpression?: string;
    manualFormulaPresent?: boolean;
    manualFormulaIgnored?: boolean;
    formulaOutputMeaning?: "final_price" | "billable" | "generic";
    formulaOutputMeaningSource?: string;
    formulaOutputMeaningRaw?: unknown;
    normalizedFormulaOutputMeaning?: "final_price" | "billable" | "generic";
    formulaResultType?: "final_dollars" | "billable_quantity";
    quantityBasisUsed?: string;
    selectedRate?: number | null;
    finalFormulaTotal?: number | null;
    sheetYield?: {
      finishedSqft: number;
      totalFinishedSqft: number;
      computedSheets?: number | null;
      billedSheets?: number | null;
      sheetCount?: number | null;
      sheetSqft?: number | null;
      consumedSqft?: number | null;
      billedSheetSqft?: number | null;
      fullLayoutBillableSqft?: number | null;
      lastSheetPieceCount?: number | null;
      lastSheetOccupiedWidth?: number | null;
      lastSheetConsumedLength?: number | null;
      lastSheetBillableWidth?: number | null;
      lastSheetBillableLength?: number | null;
      leftoverDropWidth?: number | null;
      leftoverDropLength?: number | null;
      widthDropUsable?: boolean | null;
      lengthDropUsable?: boolean | null;
      dropUsable?: boolean | null;
      mode?: "exact_flat_goods" | "layout_yield" | "sheet_equivalent" | "unavailable";
      sheetUsageMethod?: string | null;
      allowRotation?: boolean | null;
      allowRotationSource?: string | null;
      normalPiecesPerSheet?: number | null;
      rotatedPiecesPerSheet?: number | null;
      mixedPiecesPerSheet?: number | null;
      mixedLayoutDescription?: string | null;
      piecesPerSheet?: number | null;
      orientationUsed?: string | null;
      fullSheets?: number | null;
      partialSheetPieceCount?: number | null;
      partialSheetFinishedSqft?: number | null;
      partialSheetBillableSqft?: number | null;
      partialSheetPolicy?: string | null;
      totalSheetCount?: number | null;
      available?: boolean;
    };
    tierResolution?: {
      quantity: number;
      enabled: boolean;
      source: "matrix_row" | "pbv2_product" | "pbv2_pricing_v2" | "none";
      matchedTierId: string | null;
      matchedTierLabel: string | null;
      originalBaseRate: number;
      tierBaseRate: number | null;
      effectiveBaseRateBeforeMatrix: number;
      matrixBasePriceOverride: boolean;
      matrixRowId?: string | null;
      matrixStaticBaseRate?: number | null;
      matrixBasePriceRaw?: number | null;
      matrixBasePriceIgnoredBecauseTierMatched?: boolean;
      matrixStaticBaseRateUsedAsFallback?: boolean;
      productTierFallbackUsed?: boolean;
      tierBasis?: "line_item_quantity" | "computed_sheet_usage";
      tierBasisValue?: number;
      tierBasisResolvedFrom?: "matrix_row" | "product" | "default";
      lineItemQuantity?: number;
      rawItemQuantity?: number;
      tierSelectionQuantity?: number;
      computedSheetUsage?: number | null;
      computedSheetUsageAvailable?: boolean;
      computedSheetUsageMode?: "exact_flat_goods" | "layout_yield" | "sheet_equivalent" | "unavailable";
      sheetUsageMethod?: string | null;
      allowRotation?: boolean | null;
      allowRotationSource?: string | null;
      normalPiecesPerSheet?: number | null;
      rotatedPiecesPerSheet?: number | null;
      mixedPiecesPerSheet?: number | null;
      mixedLayoutDescription?: string | null;
      piecesPerSheet?: number | null;
      orientationUsed?: string | null;
      fullSheets?: number | null;
      partialSheetPieceCount?: number | null;
      partialSheetFinishedSqft?: number | null;
      partialSheetBillableSqft?: number | null;
      partialSheetPolicy?: string | null;
      totalSheetCount?: number | null;
      tierSheetWidth?: number | null;
      tierSheetLength?: number | null;
      tierUsableDropMin?: number | null;
      tierBillableLengthIncrement?: number | null;
      tierMinimumBillableSqft?: number | null;
      tierVariableSources?: Record<string, string>;
      computedSheetUsageUnavailableReason?: string | null;
      fallbackToLineItemQuantity?: boolean;
      selectedTierMinQty?: number | null;
      selectedTierRate?: number | null;
      selectedTierSource?: "matrix_row" | "pbv2_product" | "pbv2_pricing_v2" | "none" | null;
      selectedTierRateAppliedToBasePrice?: boolean;
      basePriceFinal?: number;
      basePriceSource?: string;
      finalBaseRateUsed: number;
      warnings: Array<{ code: string; message: string; severity?: string; detail?: Record<string, unknown> }>;
      capturedAt?: string;
    };
    runtimeSelectionContext?: {
      selectedChoices?: Record<string, string>;
      resolvedChoices?: Record<string, {
        selectionKey?: string;
        optionLabel?: string;
        choiceValue?: string;
        choiceLabel?: string;
      }>;
      appliedPricingOverrides?: Array<Record<string, unknown>>;
      hiddenSelectionWarnings?: Array<{ selectionKey?: string; choiceValue?: string; reason?: string }>;
    };
    weight?: {
      baseWeightInput?: number | string | null;
      baseWeightSource?: "meta.baseWeightOz" | "shippingConfig.baseWeight" | "none";
      baseWeightOz?: number | null;
      shippingConfigBaseWeight?: number | string | null;
      shippingConfigWeightUnit?: string | null;
      shippingConfigWeightBasis?: string | null;
      selectedWeightFields?: Array<{ label: string; oz: number }>;
      computedShippingWeightOz?: number | null;
      resolvedWeightSource?: "choice_material" | "product_primary_material" | "product_fallback" | "missing";
      sourceLabel?: string;
      materialId?: string;
      materialName?: string;
      materialSku?: string | null;
      weightValue?: number | null;
      weightUnit?: string | null;
      weightBasis?: string | null;
      weightOzPerBasis?: number | null;
      basisQuantity?: number | null;
      warnings?: Array<{ code: string; message: string }>;
      warningCode?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  };
};

type PricingPreviewApiResponse = {
  success?: boolean;
  data?: PricingPreviewResponse;
  debug?: PricingPreviewResponse["debug"];
  message?: string;
  errors?: Array<{ code?: string; message?: string; detail?: any }>;
};

type PreviewOption = {
  optionId: string;
  selectionKey: string;
  optionName: string;
  inputType: string;
  choices: Array<{ value: string; label: string }>;
};

type PreviewGroup = {
  groupId: string;
  groupName: string;
  isMultiSelect: boolean;
  isRequired: boolean;
  options: PreviewOption[];
};

const FREEFORM_INPUT_TYPES = new Set(["text", "textarea", "number", "numeric", "dimension"]);

interface PricingValidationPanelProps {
  treeJson: unknown | null;
  pricingV2Override?: unknown;
  pricingFormulaOverride?: string | null;
  manualFormulaText?: string | null;
  pricingFormulaId?: string | null;
  formulaSourceMode?: "library" | "manual" | "profile";
  pricingProfileKey?: string | null;
  pricingProfileConfig?: unknown;
  pricingMode?: "basic" | "advanced";
  measurementMode?: "dimensions_required" | "quantity_only";
  allowZeroPrice?: boolean;
  productPrimaryMaterialId?: string | null;
  materialNamesById?: Record<string, string>;
  findings: Finding[];
}

function toNodesRecord(treeJson: any): Record<string, any> {
  if (!treeJson || typeof treeJson !== "object") return {};
  const nodesRaw = (treeJson as any).nodes;
  if (!nodesRaw) return {};
  if (!Array.isArray(nodesRaw)) return nodesRaw as Record<string, any>;
  return nodesRaw.reduce((acc: Record<string, any>, node: any) => {
    if (node?.id) acc[node.id] = node;
    return acc;
  }, {});
}

function buildPreviewGroups(treeJson: unknown | null, selectedOptionValues: Record<string, unknown> = {}): PreviewGroup[] {
  if (!treeJson || typeof treeJson !== "object") return [];

  let model: EditorModel | null = null;
  try {
    model = pbv2TreeToEditorModel(treeJson as any);
  } catch {
    return [];
  }
  if (!model) return [];

  const nodes = toNodesRecord(treeJson);
  let visibleNodeIds: Set<string> | null = null;
  let visibleGroupIds: Set<string> | null = null;
  let visibleChoiceIds: Set<string> | null = null;
  try {
    const runtimeVisibility = resolveRuntimeVisibility(treeJson as any, selectedOptionValues);
    visibleNodeIds = new Set(runtimeVisibility.visibleNodeIds);
    visibleGroupIds = new Set(runtimeVisibility.visibleGroupIds);
    visibleChoiceIds = new Set(runtimeVisibility.visibleChoiceIds);
  } catch {
    visibleNodeIds = null;
    visibleGroupIds = null;
    visibleChoiceIds = null;
  }

  return model.groups
    .filter((group) => !visibleGroupIds || visibleGroupIds.has(group.id))
    .map((group) => {
      const options: PreviewOption[] = group.optionIds
        .map((optionId) => {
          if (visibleNodeIds && !visibleNodeIds.has(optionId)) return null;
          const optionMeta = model?.options?.[optionId];
          const node = nodes?.[optionId] ?? null;
          const choicesRaw = Array.isArray(node?.choices)
            ? filterPbv2ChoicesForRuntime(optionId, node.choices, visibleChoiceIds)
            : [];
          const mappedChoices: Array<{ value: string; label: string }> = choicesRaw.map((choice: any) => ({
              value: String(choice?.value ?? ""),
              label: String(choice?.label ?? choice?.value ?? ""),
            }));
          const choices = mappedChoices.filter((choice: { value: string; label: string }) => choice.value.length > 0);

          const inputType = String(node?.input?.type ?? "select");
          // Keep choice-driven options (select/dropdown/multiselect) AND recently
          // added freeform option types (text/numeric) so every option type is
          // represented correctly in the preview payload.
          if (choices.length === 0 && !FREEFORM_INPUT_TYPES.has(inputType)) return null;

          return {
            optionId,
            selectionKey: String(node?.input?.selectionKey ?? node?.key ?? optionId),
            optionName: optionMeta?.name || String(node?.label || "Option"),
            inputType,
            choices,
          };
        })
        .filter((option): option is PreviewOption => Boolean(option));

      return {
        groupId: group.id,
        groupName: group.name,
        isMultiSelect: group.isMultiSelect,
        isRequired: Boolean(group.isRequired),
        options,
      };
    })
    .filter((group) => group.options.length > 0);
}

function PreviewDebugList({ label, details }: { label: string; details: PreviewErrorDetail[] }) {
  if (details.length === 0) return null;
  return (
    <div>
      <span className="text-red-300/70">{label}:</span>
      <ul className="ml-3 mt-0.5 list-disc space-y-0.5">
        {details.map((detail, idx) => (
          <li key={`${label}-${idx}`}>
            {detail.path ? <span className="font-mono">{detail.path}</span> : null}
            {detail.path ? " — " : null}
            {detail.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Expandable red error banner for the Pricing Preview Sandbox. Keeps the generic
 * summary visible, and reveals enriched, human-readable validation issues (with
 * raw technical paths tucked under per-issue "Technical details") plus debug
 * sections on demand — so the user sees which option/choice is broken without
 * reading node IDs.
 */
function PreviewErrorBanner({
  error,
  expanded,
  onToggleExpanded,
  missingRequiredDetails,
  pricingConfigHint,
  treeJson,
}: {
  error: NormalizedPreviewError;
  expanded: boolean;
  onToggleExpanded: () => void;
  missingRequiredDetails: PreviewErrorDetail[];
  pricingConfigHint: string | null;
  treeJson: unknown;
}) {
  const debug = categorizePreviewDetails(error.details);
  const hasStructuredDetails = error.details.length > 0;
  const missingSelections = [...debug.missingSelections, ...missingRequiredDetails];
  // Resolve raw node IDs / choice indexes to readable option + choice labels.
  const enrichedDetails = useMemo(
    () => enrichPreviewDetails(error.details, treeJson),
    [error.details, treeJson],
  );
  const issuesSummary = useMemo(
    () => buildPreviewErrorSummary(enrichedDetails),
    [enrichedDetails],
  );
  const payloadStatus =
    error.errorCode === PBV2_PREVIEW_CLIENT_VALIDATION
      ? "Blocked before submit (no API call made)"
      : error.kind === "validation_error_with_details"
        ? "Rejected with validation details"
        : error.kind === "unexpected_error"
          ? "Unexpected failure"
          : "Rejected";
  const hasDebugData =
    missingSelections.length > 0 ||
    debug.missingVariables.length > 0 ||
    debug.invalidNumericInputs.length > 0;

  return (
    <div className="space-y-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
      <div className="font-semibold">{error.message}</div>
      {issuesSummary ? <div className="text-xs text-red-200/90">{issuesSummary}</div> : null}
      {pricingConfigHint ? <div className="text-xs text-red-200/90">{pricingConfigHint}</div> : null}
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs font-medium text-red-100/90 hover:text-red-50"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded ? (
        <div className="space-y-2 rounded border border-red-500/30 bg-red-950/40 p-2 text-xs">
          {error.errorCode ? (
            <div>
              <span className="text-red-300/70">Error code: </span>
              <span className="font-mono">{error.errorCode}</span>
            </div>
          ) : null}

          {hasStructuredDetails ? (
            <div className="space-y-1.5">
              <div className="text-red-300/70">Validation issues ({enrichedDetails.length})</div>
              {enrichedDetails.map((detail, idx) => (
                <div
                  key={`preview-detail-${idx}`}
                  className="space-y-1 rounded border border-red-500/30 bg-red-950/50 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-red-100">{detail.displayLocation}</div>
                    <Badge
                      variant="outline"
                      className="flex-shrink-0 border-red-500/40 bg-red-500/10 text-[10px] text-red-200"
                    >
                      {detail.category}
                    </Badge>
                  </div>
                  <div className="text-red-100/90">{detail.friendlyMessage}</div>
                  {detail.suggestedFix ? (
                    <div className="text-red-200/80">
                      <span className="text-red-300/70">Fix: </span>
                      {detail.suggestedFix}
                    </div>
                  ) : null}
                  <details className="text-[11px] text-red-300/70">
                    <summary className="cursor-pointer select-none">Technical details</summary>
                    <div className="mt-1 space-y-0.5">
                      <div>
                        <span className="text-red-300/60">Path: </span>
                        <span className="font-mono break-all">{detail.technicalPath || "(none)"}</span>
                      </div>
                      {detail.expected ? (
                        <div>
                          <span className="text-red-300/60">Expected: </span>
                          <span className="font-mono">{detail.expected}</span>
                        </div>
                      ) : null}
                      {detail.received !== undefined ? (
                        <div>
                          <span className="text-red-300/60">Received: </span>
                          <span className="font-mono">
                            {detail.received === null ? "null" : detail.received}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-red-200/80">
              {error.rawMessage} No field-level details were returned.
            </div>
          )}

          <div className="space-y-1 border-t border-red-500/30 pt-1.5">
            <div className="text-red-300/70">Debug</div>
            <div>
              <span className="text-red-300/70">Payload status: </span>
              {payloadStatus}
            </div>
            {hasDebugData ? (
              <>
                <PreviewDebugList label="Missing required selections" details={missingSelections} />
                <PreviewDebugList label="Missing formula variables" details={debug.missingVariables} />
                <PreviewDebugList label="Invalid numeric inputs" details={debug.invalidNumericInputs} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PricingValidationPanel({ treeJson, pricingV2Override, pricingFormulaOverride, manualFormulaText, pricingFormulaId, formulaSourceMode = "profile", pricingProfileKey, pricingProfileConfig, pricingMode = "basic", measurementMode, allowZeroPrice = false, productPrimaryMaterialId, materialNamesById, findings }: PricingValidationPanelProps) {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const [previewState, setPreviewState] = useState<PricingPreviewState>({
    width: 24,
    height: 36,
    quantity: 1,
    selectedOptionValues: {},
    unit: "in",
  });
  const [result, setResult] = useState<PricingPreviewResponse | null>(null);
  const [formulaDebug, setFormulaDebug] = useState<PricingPreviewResponse["debug"] | null>(null);
  const effectiveRuntimeSelectionValues = useMemo(
    () => formulaDebug?.runtimeSelectionContext?.selectedChoices ?? {},
    [formulaDebug?.runtimeSelectionContext?.selectedChoices],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<NormalizedPreviewError | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [openFormulaDebug, setOpenFormulaDebug] = useState(false);
  const [openQuantityTierDebug, setOpenQuantityTierDebug] = useState(false);
  const requestIdRef = useRef(0);

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");
  const treeMeta = treeJson && typeof treeJson === "object" ? (treeJson as any).meta : null;
  const treePricingV2 = treeMeta && typeof treeMeta === "object" ? treeMeta.pricingV2 : null;
  // Persisted Product measurement mode is the same authority used by Order
  // and Quote runtime. PBV2 metadata is only a draft/legacy fallback.
  const quantityOnly = measurementMode
    ? measurementMode === "quantity_only"
    : treeMeta?.pricingProfileKey === "qty_only"
      || treePricingV2?.optionMatrixPricingUnit === "per_piece";
  const feeService = pricingProfileKey === "fee";
  const nonDimensionalPricing = quantityOnly || feeService;

  const treeForPreview = useMemo(() => {
    if (!treeJson || typeof treeJson !== "object") return treeJson;

    const tree = treeJson as Record<string, any>;
    const meta = tree.meta && typeof tree.meta === "object" ? tree.meta : {};

    return {
      ...tree,
      meta: {
        ...meta,
        ...(pricingV2Override && typeof pricingV2Override === "object" ? { pricingV2: pricingV2Override } : {}),
        ...(nonDimensionalPricing ? {
          requiresDimensions: false,
          fixedDimensions: undefined,
          geometry: { ...(meta.geometry || {}), trimAllowance: 0, trimAllowanceX: 0, trimAllowanceY: 0 },
        } : {}),
      },
    };
  }, [treeJson, pricingV2Override, nonDimensionalPricing]);

  const fixedDimensions = useMemo(() => getPbv2FixedDimensions(treeForPreview), [treeForPreview]);
  const hourlyBillingUnit = useMemo(() => {
    const billingUnit = (treeForPreview as any)?.meta?.billingUnit;
    if (billingUnit?.kind === "hour") return billingUnit;
    // Existing products and unsaved edits may have selected the Hourly profile
    // before their draft tree is hydrated with billingUnit metadata.
    return pricingProfileKey === "hourly"
      ? { kind: "hour", selectionKey: "hours", step: 0.25 }
      : null;
  }, [treeForPreview, pricingProfileKey]);
  const previewWidth = nonDimensionalPricing ? 0 : (fixedDimensions?.widthIn ?? previewState.width);
  const previewHeight = nonDimensionalPricing ? 0 : (fixedDimensions?.heightIn ?? previewState.height);

  useEffect(() => {
    if (nonDimensionalPricing || !fixedDimensions) return;
    setPreviewState((prev) => {
      if (prev.width === fixedDimensions.widthIn && prev.height === fixedDimensions.heightIn) return prev;
      return { ...prev, width: fixedDimensions.widthIn, height: fixedDimensions.heightIn };
    });
  }, [fixedDimensions?.widthIn, fixedDimensions?.heightIn, nonDimensionalPricing]);

  const previewGroups = useMemo(
    () => buildPreviewGroups(treeForPreview, { ...effectiveRuntimeSelectionValues, ...previewState.selectedOptionValues }),
    [treeForPreview, effectiveRuntimeSelectionValues, previewState.selectedOptionValues],
  );
  const previewSelectionKeys = useMemo(
    () => new Set(previewGroups.flatMap((group) => group.options.map((option) => option.selectionKey))),
    [previewGroups],
  );
  const previewOptionIdToSelectionKey = useMemo(() => {
    const next = new Map<string, string>();
    previewGroups.forEach((group) => {
      group.options.forEach((option) => {
        next.set(option.optionId, option.selectionKey);
      });
    });
    return next;
  }, [previewGroups]);

  const selectionPayload = useMemo(() => {
    const selected: Record<string, { value: string | string[] | boolean | number }> = {};
    for (const [selectionKey, value] of Object.entries(previewState.selectedOptionValues)) {
      if (!previewSelectionKeys.has(selectionKey)) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "string" && value.length === 0) continue;
      selected[selectionKey] = { value };
    }
    return selected;
  }, [previewSelectionKeys, previewState.selectedOptionValues]);

  // This signature is the complete request identity. Response-derived runtime
  // selections may rebuild the display-only visibility groups, but must not
  // schedule another request when the outbound payload is unchanged.
  const requestSignature = useMemo(
    () =>
      JSON.stringify({
        treeJson: treeForPreview,
        ...(nonDimensionalPricing ? {} : { width: previewWidth, height: previewHeight }),
        quantity: previewState.quantity,
        pricingFormulaOverride,
        manualFormulaText,
        pricingFormulaId,
        formulaSourceMode,
        pricingProfileKey,
        pricingProfileConfig,
        measurementMode,
        productPrimaryMaterialId,
        debug: true,
        optionSelectionsJson: selectionPayload,
      }),
    [treeForPreview, nonDimensionalPricing, previewWidth, previewHeight, previewState.quantity, pricingFormulaOverride, manualFormulaText, pricingFormulaId, formulaSourceMode, pricingProfileKey, pricingProfileConfig, measurementMode, productPrimaryMaterialId, selectionPayload],
  );

  const inputErrors = useMemo(() => {
    const next: Partial<Record<"width" | "height" | "quantity", string>> = {};
    if (!nonDimensionalPricing && (!Number.isFinite(previewWidth) || previewWidth <= 0)) {
      next.width = "Width must be greater than 0.";
    }
    if (!nonDimensionalPricing && (!Number.isFinite(previewHeight) || previewHeight <= 0)) {
      next.height = "Height must be greater than 0.";
    }
    const hourlyStep = Number(hourlyBillingUnit?.step ?? 0.25);
    const hasValidHourlyIncrement = hourlyBillingUnit
      ? Number.isFinite(previewState.quantity) && previewState.quantity >= hourlyStep && Math.abs((previewState.quantity / hourlyStep) - Math.round(previewState.quantity / hourlyStep)) < 0.000001
      : false;
    if (hourlyBillingUnit ? !hasValidHourlyIncrement : (!Number.isFinite(previewState.quantity) || previewState.quantity < 1 || !Number.isInteger(previewState.quantity))) {
      next.quantity = hourlyBillingUnit ? `Billable hours must use ${hourlyStep}-hour increments.` : "Quantity must be an integer of 1 or more.";
    }
    return next;
  }, [previewWidth, previewHeight, previewState.quantity, nonDimensionalPricing, hourlyBillingUnit]);

  const hasInputErrors = Boolean(inputErrors.width || inputErrors.height || inputErrors.quantity);

  // Client-side guard: if numeric inputs are invalid, surface the same expandable
  // error UI without making a failed API call.
  const numericInputError = useMemo<NormalizedPreviewError | null>(() => {
    if (!hasInputErrors) return null;
    const details: PreviewErrorDetail[] = [];
    if (inputErrors.width) details.push({ path: "width", message: inputErrors.width, expected: "a number greater than 0" });
    if (inputErrors.height) details.push({ path: "height", message: inputErrors.height, expected: "a number greater than 0" });
    if (inputErrors.quantity) details.push({ path: "quantity", message: inputErrors.quantity, expected: "a whole number of 1 or more" });
    return buildClientPreviewError("Fix preview inputs before pricing.", details);
  }, [hasInputErrors, inputErrors.width, inputErrors.height, inputErrors.quantity]);

  const requiredSelectionGroups = useMemo<RequiredSelectionGroup[]>(
    () =>
      previewGroups.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
        isRequired: group.isRequired,
        selectionKeys: group.options.map((option) => option.selectionKey),
      })),
    [previewGroups],
  );

  // Non-blocking diagnostics: required option groups with no sandbox selection.
  // The backend applies tree defaults, so this never blocks the preview call —
  // it only enriches the expandable error details when a failure occurs.
  const missingRequiredDetails = useMemo(
    () => findMissingRequiredSelections(requiredSelectionGroups, previewState.selectedOptionValues),
    [requiredSelectionGroups, previewState.selectedOptionValues],
  );

  // Numeric guard takes precedence (no API call); otherwise show the API error.
  const activePreviewError = numericInputError ?? previewError;

  const apiErrors = useMemo(() => {
    const resultErrors = Array.isArray(result?.errors) ? result.errors.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
    return [...responseErrors, ...resultErrors];
  }, [responseErrors, result]);
  const hasApiErrors = apiErrors.length > 0;
  const pricingConfigHint = useMemo(() => {
    const haystack = `${error ?? ""} ${apiErrors.join(" ")}`.toLowerCase();
    if (
      haystack.includes("base pricing configuration required") ||
      haystack.includes("meta.pricingv2") ||
      haystack.includes("base pricing")
    ) {
      return "Set Base Pricing Model (rate per sq ft or per piece) to enable preview.";
    }
    return null;
  }, [error, apiErrors]);
  const calculatedSqftPerItem = useMemo(() => {
    if (!Number.isFinite(previewWidth) || !Number.isFinite(previewHeight) || previewWidth <= 0 || previewHeight <= 0) {
      return undefined;
    }
    return (previewWidth * previewHeight) / 144;
  }, [previewWidth, previewHeight]);
  const configuredTrimAllowances = useMemo(() => {
    const geometry = (treeForPreview as any)?.meta?.geometry;
    const legacy = Number(geometry?.trimAllowance ?? 0);
    const normalizedLegacy = Number.isFinite(legacy) && legacy >= 0 ? legacy : 0;
    const xRaw = Number(geometry?.trimAllowanceX);
    const yRaw = Number(geometry?.trimAllowanceY);
    const trimAllowanceX = Number.isFinite(xRaw) && xRaw >= 0 ? xRaw : normalizedLegacy;
    const trimAllowanceY = Number.isFinite(yRaw) && yRaw >= 0 ? yRaw : normalizedLegacy;
    return { trimAllowanceX, trimAllowanceY };
  }, [treeForPreview]);
  const orderedWidth = typeof result?.derived?.orderedWidth === "number"
    ? result.derived.orderedWidth
    : previewWidth;
  const orderedHeight = typeof result?.derived?.orderedHeight === "number"
    ? result.derived.orderedHeight
    : previewHeight;
  const trimAllowanceX = typeof result?.derived?.trimAllowanceX === "number"
    ? result.derived.trimAllowanceX
    : (typeof formulaDebug?.derived?.trim_allowance_x === "number" ? formulaDebug.derived.trim_allowance_x : configuredTrimAllowances.trimAllowanceX);
  const trimAllowanceY = typeof result?.derived?.trimAllowanceY === "number"
    ? result.derived.trimAllowanceY
    : (typeof formulaDebug?.derived?.trim_allowance_y === "number" ? formulaDebug.derived.trim_allowance_y : configuredTrimAllowances.trimAllowanceY);
  const finishedWidth = typeof result?.derived?.finishedWidth === "number"
    ? result.derived.finishedWidth
    : (typeof formulaDebug?.derived?.finished_width === "number" ? formulaDebug.derived.finished_width : orderedWidth + trimAllowanceX);
  const finishedHeight = typeof result?.derived?.finishedHeight === "number"
    ? result.derived.finishedHeight
    : (typeof formulaDebug?.derived?.finished_height === "number" ? formulaDebug.derived.finished_height : orderedHeight + trimAllowanceY);
  const finishedSqftPerItem = typeof result?.derived?.sqft === "number"
    ? result.derived.sqft
    : ((finishedWidth > 0 && finishedHeight > 0) ? (finishedWidth * finishedHeight) / 144 : calculatedSqftPerItem);
  const finishedTotalSqft = typeof result?.derived?.totalSqft === "number"
    ? result.derived.totalSqft
    : (typeof finishedSqftPerItem === "number" ? finishedSqftPerItem * previewState.quantity : undefined);
  const lastCeilInput = typeof formulaDebug?.lastCeilInput === "number" ? formulaDebug.lastCeilInput : null;
  const lastCeilResult = typeof formulaDebug?.lastCeilResult === "number" ? formulaDebug.lastCeilResult : null;
  const baseRateUsed = typeof formulaDebug?.baseRateUsed === "number" ? formulaDebug.baseRateUsed : null;
  const hasLastCeilDebug = lastCeilInput != null && lastCeilResult != null;
  const activeFormulaText = String(formulaDebug?.resolvedFormulaExpression || result?.formulaUsed || formulaDebug?.formulaRaw || pricingFormulaOverride || "");
  const hasActiveTrimAllowance = trimAllowanceX > 0 || trimAllowanceY > 0;
  const hasManualGeometryRebuild = detectsManualGeometryRebuild(activeFormulaText, hasActiveTrimAllowance);
  const geometryComparisonScope = useMemo(() => {
    const fromDebug = formulaDebug?.variables && typeof formulaDebug.variables === "object" ? formulaDebug.variables : {};
    const scope: Record<string, unknown> = { ...fromDebug };
    scope.q = previewState.quantity;
    scope.quantity = previewState.quantity;
    scope.ordered_width = orderedWidth;
    scope.ordered_height = orderedHeight;
    scope.width = orderedWidth;
    scope.height = orderedHeight;
    scope.w = orderedWidth;
    scope.h = orderedHeight;
    scope.finished_width = finishedWidth;
    scope.finished_height = finishedHeight;
    scope.fw = finishedWidth;
    scope.fh = finishedHeight;
    if (typeof finishedSqftPerItem === "number") {
      scope.sqft = finishedSqftPerItem;
    }
    if (typeof finishedTotalSqft === "number") {
      scope.total_sqft = finishedTotalSqft;
    }
    if (typeof baseRateUsed === "number") {
      scope.p = baseRateUsed;
      scope.base_price = baseRateUsed;
    }
    return scope;
  }, [formulaDebug?.variables, previewState.quantity, orderedWidth, orderedHeight, finishedWidth, finishedHeight, finishedSqftPerItem, finishedTotalSqft, baseRateUsed]);
  const geometryComparison = useMemo(() => {
    if (!hasManualGeometryRebuild) return null;
    if (!activeFormulaText.trim()) return null;
    return compareCanonicalGeometryPricing(activeFormulaText, geometryComparisonScope, formulaDebug?.appliedAs, previewState.quantity);
  }, [hasManualGeometryRebuild, activeFormulaText, geometryComparisonScope, formulaDebug?.appliedAs, previewState.quantity]);
  const hasCanonicalGeometryWarning =
    pricingMode === "advanced" &&
    hasActiveTrimAllowance &&
    hasManualGeometryRebuild &&
    typeof geometryComparison?.relativeDifference === "number" &&
    geometryComparison.relativeDifference > 0.01;
  const formulaDimensionUsageLabel = hasManualGeometryRebuild ? "Manual geometry rebuild detected" : "Canonical geometry vars";
  const formulaDebugErrors = useMemo(() => {
    const errorsFromDebug = Array.isArray(formulaDebug?.errors) ? formulaDebug.errors : [];
    const normalized = errorsFromDebug
      .map((entry) => ({
        code: String(entry?.code ?? "PBV2_FORMULA_ERROR"),
        message: String(entry?.message ?? "Formula evaluation error"),
      }))
      .filter((entry) => entry.message.trim().length > 0);

    if (typeof formulaDebug?.resultValue === "number" && !Number.isFinite(formulaDebug.resultValue)) {
      normalized.push({
        code: "PBV2_FORMULA_NON_FINITE",
        message: "Formula result is NaN or Infinity.",
      });
    }

    return normalized;
  }, [formulaDebug]);
  const hasFormulaDebugErrors = formulaDebugErrors.length > 0;
  const formulaPricingDebug = formulaDebug?.pricing ?? null;
  const formulaAuthoritativeTotal = formulaPricingDebug?.finalTotalSource === "formula" && typeof formulaPricingDebug.finalTotal === "number"
    ? formulaPricingDebug.finalTotal + (typeof formulaPricingDebug.optionsPrice === "number" ? formulaPricingDebug.optionsPrice : 0)
    : null;
  const displayTotalPrice = result
    ? formulaAuthoritativeTotal ?? result.totalPrice
    : 0;
  const displayUnitPrice = result
    ? (feeService ? displayTotalPrice : (previewState.quantity > 0 ? displayTotalPrice / previewState.quantity : result.unitPrice))
    : 0;
  const quantityOnlyPriceMissing = nonDimensionalPricing && !allowZeroPrice && Boolean(result) && displayTotalPrice === 0;
  const displayBasePrice = result?.breakdown
    ? (formulaPricingDebug?.finalTotalSource === "formula" && typeof formulaPricingDebug.finalTotal === "number"
      ? formulaPricingDebug.finalTotal
      : result.breakdown.basePrice)
    : 0;
  const finalTotalDisplayMismatch = Boolean(
    result &&
    formulaAuthoritativeTotal != null &&
    Math.abs(result.totalPrice - formulaAuthoritativeTotal) > 0.005,
  );
  const sortedDebugVariables = useMemo(() => {
    const source = formulaDebug?.variables ?? {};
    const entries = Object.entries(source);
    const priority = ["w", "h", "q", "sqft", "p"];
    const score = (key: string) => {
      const idx = priority.indexOf(key);
      return idx === -1 ? 100 : idx;
    };
    return entries.sort((a, b) => {
      const diff = score(a[0]) - score(b[0]);
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    });
  }, [formulaDebug]);
  const previewMeta = (treeForPreview as any)?.meta && typeof (treeForPreview as any).meta === "object" ? (treeForPreview as any).meta : {};
  const previewShippingConfig = previewMeta?.shippingConfig && typeof previewMeta.shippingConfig === "object" ? previewMeta.shippingConfig : null;
  const weightDebug = result?.debug?.weight ?? formulaDebug?.weight ?? null;
  const tierResolution = result?.debug?.tierResolution ?? formulaDebug?.tierResolution ?? null;
  const tierWarnings = Array.isArray(tierResolution?.warnings) ? tierResolution.warnings : [];
  const matchedTierDisplay = tierResolution?.matchedTierLabel || tierResolution?.matchedTierId || null;
  const tierSourceDisplay = tierResolution?.source === "matrix_row"
    ? "Matrix row"
    : tierResolution?.source === "pbv2_product" || tierResolution?.source === "pbv2_pricing_v2"
      ? "PBV2 product"
      : "None";
  const tierBasisDisplay = tierResolution?.tierBasis === "computed_sheet_usage" ? "Computed Sheet Usage" : "Line Item Quantity";
  const tierBasisResolvedFromDisplay = tierResolution?.tierBasisResolvedFrom === "matrix_row"
    ? "Matrix row"
    : tierResolution?.tierBasisResolvedFrom === "product"
      ? "Product"
      : "Default";
  const computedSheetUsageModeDisplay = tierResolution?.computedSheetUsageMode === "exact_flat_goods"
    ? "Exact flat-goods nesting"
    : tierResolution?.computedSheetUsageMode === "layout_yield"
      ? "Layout yield"
    : tierResolution?.computedSheetUsageMode === "sheet_equivalent"
      ? "Sheet-equivalent"
      : "Unavailable";
  const showTierResolutionDebug = Boolean(
    tierResolution &&
      (tierResolution.enabled ||
        tierWarnings.length > 0 ||
        tierResolution.matrixBasePriceOverride ||
        tierResolution.matrixStaticBaseRateUsedAsFallback ||
        tierResolution.productTierFallbackUsed ||
        tierResolution.fallbackToLineItemQuantity ||
        tierResolution.source !== "none"),
  );
  const weightFinding = findings.find((finding) => finding.code === "PBV2_W_WEIGHT_MISSING" || finding.code === "PBV2_E_WEIGHT_NEGATIVE") ?? null;
  const shouldShowWeightDebug = Boolean(weightDebug || previewShippingConfig || previewMeta?.baseWeightOz != null || weightFinding);
  const selectedWeightFields = Array.isArray(weightDebug?.selectedWeightFields) ? weightDebug.selectedWeightFields : [];
  const weightWarnings = Array.isArray(weightDebug?.warnings) ? weightDebug.warnings : [];
  const fallbackUsed = weightDebug?.resolvedWeightSource === "product_fallback";
  const runtimeSelectionDebug = formulaDebug?.runtimeSelectionContext ?? null;
  const selectedChoiceEntries = Object.entries(runtimeSelectionDebug?.selectedChoices ?? {});
  const resolvedRuntimeChoices = Object.values(runtimeSelectionDebug?.resolvedChoices ?? {});
  const optionPriceContributionBySelectionKey = new Map(
    (formulaDebug?.optionPriceContributions ?? [])
      .filter((entry) => typeof entry.selectionKey === "string" && entry.selectionKey.length > 0)
      .map((entry) => [entry.selectionKey as string, entry.amountCents]),
  );
  const appliedPricingOverrides = Array.isArray(runtimeSelectionDebug?.appliedPricingOverrides)
    ? runtimeSelectionDebug.appliedPricingOverrides
    : [];
  const hiddenSelectionWarnings = Array.isArray(runtimeSelectionDebug?.hiddenSelectionWarnings)
    ? runtimeSelectionDebug.hiddenSelectionWarnings
    : [];
  const hasRuntimeSelectionDebug = Boolean(
    runtimeSelectionDebug &&
      (selectedChoiceEntries.length > 0 || appliedPricingOverrides.length > 0 || hiddenSelectionWarnings.length > 0),
  );

  const displayDebugValue = (value: unknown) => {
    if (value === null || typeof value === "undefined") return "—";
    if (typeof value === "string") return value.trim().length > 0 ? value : "—";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    return String(value);
  };

  const displayDebugCurrency = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return currencyFormatter.format(value);
  };

  const displayWeightOz = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${value.toFixed(2)} oz`;
  };
  const displayWeightWarning = (warning: { code: string; message: string }) => {
    switch (warning.code) {
      case "PBV2_W_MATERIAL_WEIGHT_MISSING":
        return fallbackUsed
          ? "Selected material has no configured weight. Product fallback weight was used."
          : "Selected material has no configured weight.";
      case "PBV2_W_MATERIAL_REFERENCE_MISSING":
        return fallbackUsed
          ? "Selected material could not be found. Product fallback weight was used."
          : "Selected material could not be found.";
      case "PBV2_W_WEIGHT_MISSING":
        return "No usable weight source is configured for this product.";
      case "PBV2_W_MULTIPLE_MATERIAL_OVERRIDES":
        return "Multiple selected choices resolve materials. Product primary material or fallback weight was used.";
      default:
        return warning.message || warning.code;
    }
  };

  useEffect(() => {
    if (previewGroups.length === 0) return;

    setPreviewState((prev) => {
      const currentEntries = Object.entries(prev.selectedOptionValues);
      if (currentEntries.length === 0) return prev;

      const nextSelected: PricingPreviewState["selectedOptionValues"] = {};
      let changed = false;

      for (const [key, value] of currentEntries) {
        if (previewSelectionKeys.has(key)) {
          nextSelected[key] = value;
        }
      }

      for (const [key, value] of currentEntries) {
        if (previewSelectionKeys.has(key)) continue;
        const selectionKey = previewOptionIdToSelectionKey.get(key);
        if (selectionKey && !Object.prototype.hasOwnProperty.call(nextSelected, selectionKey)) {
          nextSelected[selectionKey] = value;
        }
        changed = true;
      }

      if (!changed) return prev;
      return { ...prev, selectedOptionValues: nextSelected };
    });
  }, [previewGroups.length, previewOptionIdToSelectionKey, previewSelectionKeys]);

  useEffect(() => {
    if (!treeForPreview || typeof treeForPreview !== "object") {
      setLoading(false);
      setResult(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      setPreviewError(null);
      setError("No PBV2 tree loaded.");
      return;
    }

    if (hasInputErrors) {
      // Numeric inputs are guarded client-side: skip the API call entirely.
      // The expandable error banner is derived from `numericInputError`.
      setLoading(false);
      setResult(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      setPreviewError(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      setPreviewError(null);
      try {
        const res = await fetch("/api/pbv2/pricing-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: requestSignature,
        });

        const json = (await res.json().catch(() => ({}))) as PricingPreviewApiResponse;
        if (requestId !== requestIdRef.current) return;
        if (!res.ok || json?.success === false) {
          setResult(null);
          setFormulaDebug((json?.debug ?? null) as PricingPreviewResponse["debug"] | null);
          const structuredErrors = Array.isArray(json?.errors)
            ? json.errors
                .map((entry: any) => (typeof entry?.message === "string" ? entry.message : null))
                .filter((entry: string | null): entry is string => Boolean(entry))
            : [];
          setResponseErrors(structuredErrors);
          setPreviewError(normalizePreviewError(json, res.status, "Pricing evaluation failed."));
          setError(typeof json?.message === "string" ? json.message : "Pricing evaluation failed.");
          return;
        }

        const data = (json?.data ?? null) as PricingPreviewResponse | null;
        setResponseErrors([]);
        setPreviewError(null);
        setFormulaDebug(data?.debug ?? null);
        setResult(data);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        setResult(null);
        setFormulaDebug(null);
        setResponseErrors([]);
        const unexpectedMessage = typeof e?.message === "string" ? e.message : "Pricing evaluation failed.";
        setPreviewError(buildUnexpectedPreviewError(unexpectedMessage));
        setError(unexpectedMessage);
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hasInputErrors, requestSignature]);

  return (
    <aside data-testid="pricing-validation-panel" className="h-auto w-full min-w-0 max-w-full overflow-visible bg-card">
      <div className="h-auto min-w-0 max-w-full space-y-4 overflow-visible p-4 [overflow-wrap:anywhere]">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Pricing Preview Sandbox</h2>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-3 min-w-0 max-w-full overflow-hidden">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="text-xs text-slate-400 uppercase tracking-wide min-w-0">Inputs</div>
                <div className="text-[11px] text-slate-500 shrink-0">Units: {hourlyBillingUnit ? "hours" : previewState.unit === "in" ? "inches" : previewState.unit}</div>
              </div>

              <div className={nonDimensionalPricing ? "grid grid-cols-1 gap-2 min-w-0 max-w-full" : fixedDimensions ? "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2 min-w-0 max-w-full" : "grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 min-w-0 max-w-full"}>
                {nonDimensionalPricing ? null : fixedDimensions ? (
                  <div className="min-w-0">
                    <Label className="text-xs text-slate-400">Fixed Size</Label>
                    <div className="flex h-8 items-center rounded-md border border-slate-700/60 bg-slate-950/40 px-2 font-mono text-sm text-slate-200">
                      {fixedDimensions.label ?? `${previewWidth}" x ${previewHeight}"`}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <Label className="text-xs text-slate-400">Width ({previewState.unit})</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={previewState.width}
                        onChange={(e) => setPreviewState((prev) => ({ ...prev, width: Number(e.target.value) }))}
                        className="bg-slate-950/60 border-slate-700/60 h-8 w-full min-w-0"
                      />
                      {inputErrors.width ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.width}</div> : null}
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs text-slate-400">Height ({previewState.unit})</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={previewState.height}
                        onChange={(e) => setPreviewState((prev) => ({ ...prev, height: Number(e.target.value) }))}
                        className="bg-slate-950/60 border-slate-700/60 h-8 w-full min-w-0"
                      />
                      {inputErrors.height ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.height}</div> : null}
                    </div>
                  </>
                )}
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">{hourlyBillingUnit ? "Billable Hours" : "Quantity"}</Label>
                  <Input
                    type="number"
                    min={hourlyBillingUnit ? hourlyBillingUnit.step ?? 0.25 : 1}
                    step={hourlyBillingUnit ? hourlyBillingUnit.step ?? 0.25 : 1}
                    value={previewState.quantity}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8 w-full min-w-0"
                  />
                  {inputErrors.quantity ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.quantity}</div> : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-2 min-w-0 max-w-full overflow-hidden">
              <div className="text-xs text-slate-400 uppercase tracking-wide">Output</div>
              {loading ? (
                <div className="text-sm text-slate-300">Calculating…</div>
              ) : activePreviewError ? (
                <PreviewErrorBanner
                  error={activePreviewError}
                  expanded={showErrorDetails}
                  onToggleExpanded={() => setShowErrorDetails((prev) => !prev)}
                  missingRequiredDetails={missingRequiredDetails}
                  pricingConfigHint={pricingConfigHint}
                  treeJson={treeForPreview}
                />
              ) : error ? (
                <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  <div className="font-semibold">{error}</div>
                  {pricingConfigHint ? <div>{pricingConfigHint}</div> : null}
                </div>
              ) : hasApiErrors ? (
                <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  <div className="font-semibold">Pricing evaluation errors</div>
                  {apiErrors.map((entry, idx) => (
                    <div key={`${entry}-${idx}`}>{entry}</div>
                  ))}
                </div>
              ) : result ? (
                <div className="space-y-1 text-sm text-slate-200 min-w-0 max-w-full overflow-hidden">
                  {hasCanonicalGeometryWarning ? (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[11px] text-amber-200">
                      <div className="font-semibold">Formula does not use canonical finished geometry. Billing may ignore trim allowances.</div>
                      {typeof geometryComparison?.relativeDifference === "number" ? (
                        <div className="mt-1">Relative difference: {(geometryComparison.relativeDifference * 100).toFixed(2)}%</div>
                      ) : null}
                    </div>
                  ) : null}

                  {!nonDimensionalPricing ? <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
                    <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Finished Size Rule</div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">Ordered size</span>
                      <span className="font-mono text-base text-slate-100">{orderedWidth.toFixed(2)} × {orderedHeight.toFixed(2)} in</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-slate-300">Trim allowance</span>
                      <span className="font-mono text-base text-slate-100">+{trimAllowanceX.toFixed(2)} (W), +{trimAllowanceY.toFixed(2)} (H)</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-slate-300">Finished size</span>
                      <span className="font-mono text-base text-slate-100">{finishedWidth.toFixed(2)} × {finishedHeight.toFixed(2)} in</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-slate-300">Sqft per item (finished)</span>
                      <span className="font-mono text-base text-slate-100">{typeof finishedSqftPerItem === "number" ? finishedSqftPerItem.toFixed(4) : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-slate-300">Total sqft (finished)</span>
                      <span className="font-mono text-base text-slate-100">{typeof finishedTotalSqft === "number" ? finishedTotalSqft.toFixed(4) : "—"}</span>
                    </div>
                  </div> : null}

                  {hasLastCeilDebug ? (
                    <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
                      <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">FORMULA CEIL DEBUG</div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">total_sqft (finished)</span>
                        <span className="font-mono text-base text-slate-100">{typeof finishedTotalSqft === "number" ? finishedTotalSqft.toFixed(4) : "—"}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-slate-300">Formula dimension basis</span>
                        <span className="font-mono text-base text-slate-100">{formulaDimensionUsageLabel}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">Last ceil() input</span>
                        <span className="font-mono text-base text-slate-100">{lastCeilInput.toFixed(4)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-slate-300">Last ceil() result</span>
                        <span className="font-mono text-base text-slate-100">{lastCeilResult.toFixed(0)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 mb-2">No ceil() call was evaluated by this formula.</div>
                  )}

                  {hasFormulaDebugErrors ? (
                    <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                      <div className="font-semibold">Formula Debug Errors</div>
                      {formulaDebugErrors.map((entry, idx) => (
                        <div key={`formula-debug-inline-${idx}`}>{entry.code}: {entry.message}</div>
                      ))}
                    </div>
                  ) : (
                    <>
                      {finalTotalDisplayMismatch ? (
                        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                          PBV2_E_FINAL_TOTAL_MISMATCH: API total was {currencyFormatter.format(result.totalPrice)} but formula final total is {currencyFormatter.format(formulaAuthoritativeTotal ?? result.totalPrice)}.
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between"><span>{feeService ? "Flat fee" : "Unit price"}</span><span className="font-mono">{currencyFormatter.format(displayUnitPrice)}</span></div>
                      <div className="flex items-center justify-between"><span>Total price</span><span className="font-mono">{currencyFormatter.format(displayTotalPrice)}</span></div>
                      {quantityOnlyPriceMissing ? (
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">Price not configured. Set Rate per piece or explicitly allow a $0.00 price.</div>
                      ) : null}
                      {formulaDebug?.pricing?.finalTotalSource ? (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Final source</span>
                          <span className="font-mono">{formulaDebug.pricing.finalTotalSource}</span>
                        </div>
                      ) : null}
                    </>
                  )}
                  {result.formulaUsed ? (
                    <div className="flex flex-wrap items-start gap-2 text-[11px] text-slate-400 min-w-0 max-w-full">
                      <span className="min-w-0 break-words">Formula: <span className="font-mono break-all">{result.formulaUsed}</span></span>
                      {formulaDebug?.likelyMisconfiguredFormula ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300 shrink-0">
                          Check formula output
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {typeof result.derived?.sqft === "number" || typeof result.derived?.linearFeet === "number" ? (
                    <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 space-y-1">
                      <div className="uppercase tracking-wide">Derived</div>
                      <div className="flex items-center justify-between"><span>sqft</span><span className="font-mono">{typeof result.derived?.sqft === "number" ? result.derived.sqft.toFixed(2) : "—"}</span></div>
                      <div className="flex items-center justify-between"><span>total_sqft</span><span className="font-mono">{typeof result.derived?.totalSqft === "number" ? result.derived.totalSqft.toFixed(2) : "—"}</span></div>
                      <div className="flex items-center justify-between"><span>linear_feet</span><span className="font-mono">{typeof result.derived?.linearFeet === "number" ? result.derived.linearFeet.toFixed(2) : "—"}</span></div>
                    </div>
                  ) : null}
                  {result.breakdown ? (
                    <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 space-y-1">
                      <div className="flex items-center justify-between"><span>Base</span><span className="font-mono">{currencyFormatter.format(displayBasePrice)}</span></div>
                      <div className="flex items-center justify-between"><span>Options</span><span className="font-mono">{currencyFormatter.format(result.breakdown.optionsPrice)}</span></div>
                      {resolvedRuntimeChoices.length > 0 ? (
                        <div className="space-y-1 border-t border-slate-700/60 pt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Effective choices</div>
                          {resolvedRuntimeChoices.map((choice, index) => {
                            const selectionKey = choice.selectionKey ?? "";
                            const contributionCents = selectionKey ? optionPriceContributionBySelectionKey.get(selectionKey) : undefined;
                            const isDefault = selectionKey.length > 0 && !Object.prototype.hasOwnProperty.call(previewState.selectedOptionValues, selectionKey);
                            return (
                              <div key={`${selectionKey}-${choice.choiceValue ?? index}`} className="flex items-center justify-between gap-2 text-slate-300">
                                <span className="min-w-0 truncate">
                                  {choice.optionLabel ?? selectionKey}: {choice.choiceLabel ?? choice.choiceValue ?? "—"}
                                  {isDefault ? <span className="ml-1 text-sky-300">(default)</span> : null}
                                </span>
                                <span className="font-mono shrink-0 text-slate-200">
                                  {typeof contributionCents === "number" && contributionCents !== 0
                                    ? currencyFormatter.format(contributionCents / 100)
                                    : "No price change"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                </div>
              ) : (
                <div className="text-sm text-slate-400">Enter dimensions and quantity to preview pricing.</div>
              )}

              {formulaDebug ? (
                <div className="mt-2 space-y-1 border-t border-slate-700/80 pt-2">
                  <section className="min-w-0">
                    <button
                      type="button"
                      aria-expanded={openFormulaDebug}
                      aria-controls="pbv2-formula-debug-content"
                      className="flex w-full min-w-0 items-center justify-between gap-2 py-1 text-left text-xs text-slate-300 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => setOpenFormulaDebug((open) => !open)}
                    >
                      <span className="font-medium">Formula Debug</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${openFormulaDebug ? "rotate-180" : ""}`} />
                    </button>
                    {openFormulaDebug ? (
                      <div id="pbv2-formula-debug-content" className="space-y-2 pb-4 pt-0 text-xs text-slate-300 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]">
                      {nonDimensionalPricing ? (
                        <div className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-sky-100">
                          {feeService
                            ? "Fee / Service pricing ignores quantity, width, height, square footage, sheet yield, and base-price formulas. Flat Fee Amount is charged once per line item."
                            : "Quantity-only pricing ignores width, height, square footage, sheet yield, and base-price formulas. The only base rate is Rate per piece."}
                        </div>
                      ) : null}
                      <div className="min-w-0"><span className="text-slate-400">Formula used:</span> <span className="font-mono break-all">{formulaDebug.formulaRaw || "—"}</span></div>
                      <div><span className="text-slate-400">Formula source mode:</span> <span className="font-mono">{formulaDebug.formulaSourceMode ?? "—"}</span></div>
                      <div><span className="text-slate-400">Resolved formula source:</span> <span className="font-mono">{formulaDebug.resolvedFormulaSource ?? "—"}</span></div>
                      <div className="min-w-0"><span className="text-slate-400">Resolved formula id:</span> <span className="font-mono break-all">{formulaDebug.resolvedFormulaId ?? "—"}</span></div>
                      <div className="min-w-0"><span className="text-slate-400">Resolved formula name:</span> <span className="font-mono break-words">{formulaDebug.resolvedFormulaName ?? "—"}</span></div>
                      <div className="min-w-0"><span className="text-slate-400">Resolved formula expression:</span> <span className="font-mono break-all">{formulaDebug.resolvedFormulaExpression ?? "—"}</span></div>
                      <div><span className="text-slate-400">Manual formula present:</span> <span className="font-mono">{formulaDebug.manualFormulaPresent ? "true" : "false"}</span></div>
                      <div><span className="text-slate-400">Manual formula ignored:</span> <span className="font-mono">{formulaDebug.manualFormulaIgnored ? "true" : "false"}</span></div>
                      {!nonDimensionalPricing ? ["sheet_width", "sheet_length", "usable_drop_min", "billable_length_increment", "minimum_billable_sqft"].map((key) => (
                        <div key={key}>
                          <span className="text-slate-400">{key}:</span>{" "}
                          <span className="font-mono">{String(formulaDebug.variables?.[key] ?? "—")}</span>
                          <span className="text-slate-500"> via </span>
                          <span className="font-mono">{formulaDebug.variableSources?.[key] ?? "—"}</span>
                        </div>
                      )) : null}
                      {formulaDebug.formulaResolved ? (
                        <div className="min-w-0"><span className="text-slate-400">Formula resolved:</span> <span className="font-mono break-all">{formulaDebug.formulaResolved}</span></div>
                      ) : null}
                      <div><span className="text-slate-400">Result value:</span> <span className="font-mono">{typeof formulaDebug.resultValue === "number" ? String(formulaDebug.resultValue) : "—"}</span></div>
                      <div><span className="text-slate-400">Applied as:</span> <span className="font-mono">{formulaDebug.appliedAs ?? "unknown"}</span></div>
                      <div><span className="text-slate-400">Output meaning:</span> <span className="font-mono">{formulaDebug.normalizedFormulaOutputMeaning ?? formulaDebug.formulaOutputMeaning ?? "—"}</span></div>
                      <div><span className="text-slate-400">Output meaning source:</span> <span className="font-mono break-all">{formulaDebug.formulaOutputMeaningSource ?? "—"}</span></div>
                      <div><span className="text-slate-400">Output meaning raw:</span> <span className="font-mono break-all">{formulaDebug.formulaOutputMeaningRaw == null ? "—" : String(formulaDebug.formulaOutputMeaningRaw)}</span></div>
                      <div><span className="text-slate-400">Formula output type:</span> <span className="font-mono">{formulaDebug.formulaResultType ?? "—"}</span></div>
                      <div><span className="text-slate-400">Formula basis:</span> <span className="font-mono">{formulaDebug.quantityBasisUsed ?? "—"}</span></div>
                      <div><span className="text-slate-400">Selected rate:</span> <span className="font-mono">{typeof formulaDebug.selectedRate === "number" ? currencyFormatter.format(formulaDebug.selectedRate) : "—"}</span></div>
                      <div><span className="text-slate-400">Formula evaluated total:</span> <span className="font-mono">{typeof formulaDebug.formulaEvaluatedTotal === "number" ? currencyFormatter.format(formulaDebug.formulaEvaluatedTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">Raw base price:</span> <span className="font-mono">{typeof formulaDebug.rawBasePrice === "number" ? String(formulaDebug.rawBasePrice) : "—"}</span></div>
                      <div><span className="text-slate-400">Evaluated formula total raw:</span> <span className="font-mono">{typeof formulaDebug.evaluatedFormulaTotalRaw === "number" ? String(formulaDebug.evaluatedFormulaTotalRaw) : "—"}</span></div>
                      <div><span className="text-slate-400">Evaluated formula total rounded:</span> <span className="font-mono">{typeof formulaDebug.evaluatedFormulaTotalRounded === "number" ? currencyFormatter.format(formulaDebug.evaluatedFormulaTotalRounded) : "—"}</span></div>
                      <div><span className="text-slate-400">Rounding applied at:</span> <span className="font-mono">{formulaDebug.roundingAppliedAt ?? "—"}</span></div>
                      <div><span className="text-slate-400">PBV2 base total:</span> <span className="font-mono">{typeof formulaDebug.pbv2BaseTotal === "number" ? currencyFormatter.format(formulaDebug.pbv2BaseTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">Final total source:</span> <span className="font-mono">{formulaDebug.finalTotalSource ?? "—"}</span></div>
                      <div><span className="text-slate-400">Final total:</span> <span className="font-mono">{typeof formulaDebug.finalTotal === "number" ? currencyFormatter.format(formulaDebug.finalTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">Finished sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.finishedSqft === "number" ? formulaDebug.sheetYield.finishedSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Computed sheets:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.computedSheets === "number" ? formulaDebug.sheetYield.computedSheets.toFixed(4) : "—"}</span></div>
                      <div><span className="text-slate-400">Sheet usage method:</span> <span className="font-mono">{formulaDebug.sheetYield?.sheetUsageMethod ?? formulaDebug.sheetYield?.mode ?? "—"}</span></div>
                      <div><span className="text-slate-400">Allow rotation:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.allowRotation === "boolean" ? String(formulaDebug.sheetYield.allowRotation) : "—"}</span></div>
                      <div><span className="text-slate-400">Allow rotation source:</span> <span className="font-mono break-all">{formulaDebug.sheetYield?.allowRotationSource ?? formulaDebug.variableSources?.allow_rotation ?? "—"}</span></div>
                      <div><span className="text-slate-400">Normal pieces per sheet:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.normalPiecesPerSheet === "number" ? formulaDebug.sheetYield.normalPiecesPerSheet.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Rotated pieces per sheet:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.rotatedPiecesPerSheet === "number" ? formulaDebug.sheetYield.rotatedPiecesPerSheet.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Mixed pieces per sheet:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.mixedPiecesPerSheet === "number" ? formulaDebug.sheetYield.mixedPiecesPerSheet.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Pieces per sheet:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.piecesPerSheet === "number" ? formulaDebug.sheetYield.piecesPerSheet.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Orientation:</span> <span className="font-mono">{formulaDebug.sheetYield?.orientationUsed ?? "—"}</span></div>
                      <div><span className="text-slate-400">Mixed layout:</span> <span className="font-mono break-all">{formulaDebug.sheetYield?.mixedLayoutDescription ?? "—"}</span></div>
                      <div><span className="text-slate-400">Full sheets:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.fullSheets === "number" ? formulaDebug.sheetYield.fullSheets.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Partial sheet pieces:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.partialSheetPieceCount === "number" ? formulaDebug.sheetYield.partialSheetPieceCount.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Partial sheet finished sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.partialSheetFinishedSqft === "number" ? formulaDebug.sheetYield.partialSheetFinishedSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Partial sheet billable sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.partialSheetBillableSqft === "number" ? formulaDebug.sheetYield.partialSheetBillableSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Partial sheet policy:</span> <span className="font-mono">{formulaDebug.sheetYield?.partialSheetPolicy ?? "—"}</span></div>
                      <div><span className="text-slate-400">Total sheet count:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.totalSheetCount === "number" ? formulaDebug.sheetYield.totalSheetCount.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Consumed sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.consumedSqft === "number" ? formulaDebug.sheetYield.consumedSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Billed sheet sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.billedSheetSqft === "number" ? formulaDebug.sheetYield.billedSheetSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Last sheet occupied:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.lastSheetOccupiedWidth === "number" && typeof formulaDebug.sheetYield?.lastSheetConsumedLength === "number" ? `${formulaDebug.sheetYield.lastSheetOccupiedWidth.toFixed(2)} × ${formulaDebug.sheetYield.lastSheetConsumedLength.toFixed(2)} in` : "—"}</span></div>
                      <div><span className="text-slate-400">Billable footprint:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.lastSheetBillableWidth === "number" && typeof formulaDebug.sheetYield?.lastSheetBillableLength === "number" ? `${formulaDebug.sheetYield.lastSheetBillableWidth.toFixed(2)} × ${formulaDebug.sheetYield.lastSheetBillableLength.toFixed(2)} in` : "—"}</span></div>
                      <div><span className="text-slate-400">Remaining drop:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.leftoverDropWidth === "number" && typeof formulaDebug.sheetYield?.leftoverDropLength === "number" ? `width ${formulaDebug.sheetYield.leftoverDropWidth.toFixed(2)} in · length ${formulaDebug.sheetYield.leftoverDropLength.toFixed(2)} in` : "—"}</span></div>
                      <div><span className="text-slate-400">Usable drop:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.dropUsable === "boolean" ? `${formulaDebug.sheetYield.dropUsable ? "Yes" : "No"} (width: ${formulaDebug.sheetYield.widthDropUsable ? "usable" : "not usable"}; length: ${formulaDebug.sheetYield.lengthDropUsable ? "usable" : "not usable"})` : "—"}</span></div>
                      <div><span className="text-slate-400">Final price basis:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.billedSheetSqft === "number" && typeof formulaDebug.baseRateUsed === "number" ? `${formulaDebug.sheetYield.billedSheetSqft.toFixed(2)} billable sqft × ${currencyFormatter.format(formulaDebug.baseRateUsed)}/sqft` : "—"}</span></div>
                      <div><span className="text-slate-400">Selected tier basis:</span> <span className="font-mono">{tierResolution?.tierBasis ?? "—"}</span></div>
                      <div><span className="text-slate-400">Last ceil() input:</span> <span className="font-mono">{typeof formulaDebug.lastCeilInput === "number" ? formulaDebug.lastCeilInput.toFixed(4) : "—"}</span></div>
                      <div><span className="text-slate-400">Last ceil() result:</span> <span className="font-mono">{typeof formulaDebug.lastCeilResult === "number" ? formulaDebug.lastCeilResult.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Base rate used (p):</span> <span className="font-mono">{typeof formulaDebug.baseRateUsed === "number" ? String(formulaDebug.baseRateUsed) : "—"}</span></div>
                      <div className="space-y-1">
                        <div className="text-slate-400">Variables</div>
                        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 max-h-32 max-w-full overflow-y-auto overflow-x-hidden">
                          {sortedDebugVariables.length === 0 ? (
                            <div className="text-slate-500">No variables</div>
                          ) : (
                            sortedDebugVariables.map(([key, value]) => (
                              <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 min-w-0">
                                <span className="font-mono text-slate-400 min-w-0 break-all">{key}</span>
                                <span className="font-mono text-slate-200 min-w-0 break-all text-right">{value == null ? "null" : String(value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {Array.isArray(formulaDebug.steps) && formulaDebug.steps.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-slate-400">Steps</div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 max-w-full overflow-hidden">
                            {formulaDebug.steps.map((step, idx) => (
                              <div key={`${step.label}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 min-w-0">
                                <span className="min-w-0 break-words">{step.label}</span>
                                <span className="font-mono min-w-0 break-all text-right">{String(step.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {hasRuntimeSelectionDebug ? (
                        <div className="space-y-2">
                          <div className="text-slate-400">Runtime Selection Context</div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 space-y-2 max-w-full overflow-hidden">
                            <div>
                              <div className="text-slate-500 mb-1">Selected choices</div>
                              {selectedChoiceEntries.length === 0 ? (
                                <div className="font-mono text-slate-500">-</div>
                              ) : (
                                selectedChoiceEntries.map(([selectionKey, choiceValue]) => (
                                  <div key={selectionKey} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 min-w-0">
                                    <span className="font-mono text-slate-400 min-w-0 break-all">{selectionKey}</span>
                                    <span className="font-mono text-slate-200 min-w-0 break-all text-right">{choiceValue}</span>
                                  </div>
                                ))
                              )}
                            </div>

                            <div>
                              <div className="text-slate-500 mb-1">Applied pricing overrides</div>
                              {appliedPricingOverrides.length === 0 ? (
                                <div className="font-mono text-slate-500">-</div>
                              ) : (
                                appliedPricingOverrides.map((override, index) => (
                                  <div key={`pricing-override-${index}`} className="font-mono text-slate-200 min-w-0 break-all">
                                    {displayDebugValue(override.selectionKey)}:{displayDebugValue(override.choiceValue)} {displayDebugValue(override.mode)} {displayDebugValue(override.amount)} {displayDebugValue(override.unit)}
                                  </div>
                                ))
                              )}
                            </div>

                            {hiddenSelectionWarnings.length > 0 ? (
                              <div>
                                <div className="text-slate-500 mb-1">Hidden/stale selections</div>
                                {hiddenSelectionWarnings.map((warning, index) => (
                                  <div key={`hidden-selection-${index}`} className="font-mono text-amber-200 min-w-0 break-all">
                                    {displayDebugValue(warning.selectionKey)}:{displayDebugValue(warning.choiceValue)} {displayDebugValue(warning.reason)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {hasFormulaDebugErrors ? (
                        <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200">
                          {formulaDebugErrors.map((entry, idx) => (
                            <div key={`formula-debug-acc-${idx}`}>{entry.code}: {entry.message}</div>
                          ))}
                        </div>
                      ) : null}
                      </div>
                    ) : null}
                  </section>
                  {showTierResolutionDebug ? (
                    <section className="min-w-0">
                      <button
                        type="button"
                        aria-expanded={openQuantityTierDebug}
                        aria-controls="pbv2-quantity-tier-debug-content"
                        className="flex w-full min-w-0 items-center justify-between gap-2 py-1 text-left text-xs text-slate-300 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => setOpenQuantityTierDebug((open) => !open)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-medium">Quantity Tier Debug</span>
                          {tierWarnings.length > 0 || tierResolution?.matrixBasePriceOverride || tierResolution?.matrixStaticBaseRateUsedAsFallback ? (
                            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-300">
                              Warning
                            </Badge>
                          ) : null}
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${openQuantityTierDebug ? "rotate-180" : ""}`} />
                      </button>
                      {openQuantityTierDebug ? (
                        <div id="pbv2-quantity-tier-debug-content" className="space-y-2 pb-4 pt-0 text-xs text-slate-300 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]">
                        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 max-w-full overflow-hidden">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 min-w-0">
                            <div className="text-slate-400">Tier source</div>
                            <div className="font-mono">{tierSourceDisplay}</div>
                            <div className="text-slate-400">Tier basis</div>
                            <div className="font-mono">{tierBasisDisplay}</div>
                            <div className="text-slate-400">Basis value</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierBasisValue)}</div>
                            <div className="text-slate-400">Basis resolved from</div>
                            <div className="font-mono">{tierBasisResolvedFromDisplay}</div>
                            <div className="text-slate-400">Line item quantity</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.lineItemQuantity ?? tierResolution?.quantity)}</div>
                            <div className="text-slate-400">Computed sheet usage</div>
                            <div className="font-mono">{tierResolution?.computedSheetUsageAvailable ? displayDebugValue(tierResolution?.computedSheetUsage) : "Unavailable"}</div>
                            <div className="text-slate-400">Sheet usage mode</div>
                            <div className="font-mono">{computedSheetUsageModeDisplay}</div>
                            <div className="text-slate-400">Sheet usage method</div>
                            <div className="font-mono">{tierResolution?.sheetUsageMethod ?? "—"}</div>
                            <div className="text-slate-400">Allow rotation</div>
                            <div className="font-mono">{typeof tierResolution?.allowRotation === "boolean" ? String(tierResolution.allowRotation) : "—"}</div>
                            <div className="text-slate-400">Allow rotation source</div>
                            <div className="font-mono break-all">{tierResolution?.allowRotationSource ?? tierResolution?.tierVariableSources?.allow_rotation ?? "—"}</div>
                            <div className="text-slate-400">Normal pieces per sheet</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.normalPiecesPerSheet)}</div>
                            <div className="text-slate-400">Rotated pieces per sheet</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.rotatedPiecesPerSheet)}</div>
                            <div className="text-slate-400">Mixed pieces per sheet</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.mixedPiecesPerSheet)}</div>
                            <div className="text-slate-400">Pieces per sheet</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.piecesPerSheet)}</div>
                            <div className="text-slate-400">Orientation used</div>
                            <div className="font-mono">{tierResolution?.orientationUsed ?? "—"}</div>
                            <div className="text-slate-400">Mixed layout</div>
                            <div className="font-mono break-all">{tierResolution?.mixedLayoutDescription ?? "—"}</div>
                            <div className="text-slate-400">Full sheets</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.fullSheets)}</div>
                            <div className="text-slate-400">Partial sheet pieces</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.partialSheetPieceCount)}</div>
                            <div className="text-slate-400">Partial finished sqft</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.partialSheetFinishedSqft)}</div>
                            <div className="text-slate-400">Partial billable sqft</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.partialSheetBillableSqft)}</div>
                            <div className="text-slate-400">Partial sheet policy</div>
                            <div className="font-mono break-all">{tierResolution?.partialSheetPolicy ?? "—"}</div>
                            <div className="text-slate-400">Total sheet count</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.totalSheetCount)}</div>
                            <div className="text-slate-400">Tier sheet width</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierSheetWidth)}</div>
                            <div className="text-slate-400">Tier sheet length</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierSheetLength)}</div>
                            <div className="text-slate-400">Tier usable drop min</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierUsableDropMin)}</div>
                            <div className="text-slate-400">Tier billable increment</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierBillableLengthIncrement)}</div>
                            <div className="text-slate-400">Tier minimum billable sqft</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.tierMinimumBillableSqft)}</div>
                            <div className="text-slate-400">Sheet usage unavailable reason</div>
                            <div className="font-mono break-all">{tierResolution?.computedSheetUsageUnavailableReason ?? "None"}</div>
                            <div className="text-slate-400">Fallback to line item quantity</div>
                            <div className={tierResolution?.fallbackToLineItemQuantity ? "font-mono text-amber-200" : "font-mono"}>
                              {tierResolution?.fallbackToLineItemQuantity ? "Yes" : "No"}
                            </div>
                            <div className="text-slate-400">Matrix row</div>
                            <div className="font-mono">{tierResolution?.matrixRowId ?? "None"}</div>
                            <div className="text-slate-400">Original base rate</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.originalBaseRate)}</div>
                            <div className="text-slate-400">Quantity</div>
                            <div className="font-mono">{displayDebugValue(tierResolution?.quantity)}</div>
                            <div className="text-slate-400">Matched tier</div>
                            <div className="font-mono">{matchedTierDisplay ?? (tierResolution?.enabled ? "No matched tier" : "No quantity tier applied")}</div>
                            <div className="text-slate-400">Selected tier rate</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.selectedTierRate)}</div>
                            <div className="text-slate-400">Tier rate applied to base_price</div>
                            <div className={tierResolution?.selectedTierRateAppliedToBasePrice ? "font-mono text-emerald-200" : "font-mono"}>
                              {tierResolution?.selectedTierRateAppliedToBasePrice ? "Yes" : "No"}
                            </div>
                            <div className="text-slate-400">Matrix base_price raw</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.matrixBasePriceRaw)}</div>
                            <div className="text-slate-400">Matrix base_price ignored</div>
                            <div className={tierResolution?.matrixBasePriceIgnoredBecauseTierMatched ? "font-mono text-emerald-200" : "font-mono"}>
                              {tierResolution?.matrixBasePriceIgnoredBecauseTierMatched ? "Yes" : "No"}
                            </div>
                            <div className="text-slate-400">Tier-adjusted base rate</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.tierBaseRate ?? tierResolution?.effectiveBaseRateBeforeMatrix)}</div>
                            <div className="text-slate-400">Matrix base_price override</div>
                            <div className={tierResolution?.matrixBasePriceOverride ? "font-mono text-amber-200" : "font-mono"}>
                              {tierResolution?.matrixBasePriceOverride ? "Yes" : "No"}
                            </div>
                            <div className="text-slate-400">Static base_price fallback</div>
                            <div className={tierResolution?.matrixStaticBaseRateUsedAsFallback ? "font-mono text-amber-200" : "font-mono"}>
                              {tierResolution?.matrixStaticBaseRateUsedAsFallback
                                ? `Yes (${displayDebugCurrency(tierResolution?.matrixStaticBaseRate)})`
                                : "No"}
                            </div>
                            <div className="text-slate-400">Product tier fallback</div>
                            <div className="font-mono">{tierResolution?.productTierFallbackUsed ? "Yes" : "No"}</div>
                            <div className="text-slate-400">Base price source</div>
                            <div className="font-mono break-all">{tierResolution?.basePriceSource ?? previewMeta?.basePriceSource ?? "Unknown"}</div>
                            <div className="text-slate-400">Base price final</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.basePriceFinal ?? tierResolution?.finalBaseRateUsed)}</div>
                            <div className="text-slate-400">Final base rate used</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.finalBaseRateUsed)}</div>
                          </div>
                          {tierResolution?.tierVariableSources && Object.keys(tierResolution.tierVariableSources).length > 0 ? (
                            <div className="mt-2 rounded border border-slate-700/70 bg-slate-950/50 p-2">
                              <div className="mb-1 text-slate-400">Tier variable sources</div>
                              <div className="space-y-1">
                                {Object.entries(tierResolution.tierVariableSources).map(([key, source]) => (
                                  <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                                    <span className="min-w-0 break-all font-mono">{key}</span>
                                    <span className="min-w-0 break-all text-right font-mono text-slate-400">{source}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {tierResolution?.matrixBasePriceOverride ? (
                          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                            Matrix base_price explicitly overrode the tier-resolved base rate.
                          </div>
                        ) : null}

                        {tierWarnings.length > 0 ? (
                          <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                            {tierWarnings.map((warning, idx) => (
                              <div key={`tier-warning-${warning.code}-${idx}`}>
                                <span className="font-mono">{warning.code}</span>
                                {warning.severity ? <span className="font-mono"> [{warning.severity}]</span> : null}
                                {warning.message ? <span>: {warning.message}</span> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {shouldShowWeightDebug ? (
                <div className="mt-3 rounded border border-slate-700/70 bg-slate-900/40 p-3 text-xs text-slate-300 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Weight Debug</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="text-slate-400">Fallback weight input</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.baseWeightInput ?? previewShippingConfig?.baseWeight ?? previewMeta?.baseWeightOz ?? null)}</div>
                    <div className="text-slate-400">Fallback canonical</div>
                    <div className="font-mono">{displayWeightOz(weightDebug?.baseWeightOz ?? (typeof previewMeta?.baseWeightOz === "number" ? previewMeta.baseWeightOz : null))}</div>
                    <div className="text-slate-400">Fallback source value</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.shippingConfigBaseWeight ?? previewShippingConfig?.baseWeight ?? null)}</div>
                    <div className="text-slate-400">Fallback unit</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.shippingConfigWeightUnit ?? previewShippingConfig?.weightUnit ?? null)}</div>
                    <div className="text-slate-400">Fallback basis</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.shippingConfigWeightBasis ?? previewShippingConfig?.weightBasis ?? null)}</div>
                    <div className="text-slate-400">Weight source</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.sourceLabel ?? weightDebug?.resolvedWeightSource ?? null)}</div>
                    <div className="text-slate-400">Material</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.materialName ?? weightDebug?.materialId ?? null)}</div>
                    <div className="text-slate-400">Basis</div>
                    <div className="font-mono">
                      {weightDebug?.weightValue != null && weightDebug?.weightUnit && weightDebug?.weightBasis
                        ? `${weightDebug.weightValue} ${weightDebug.weightUnit} / ${weightDebug.weightBasis}`
                        : displayDebugValue(null)}
                    </div>
                    <div className="text-slate-400">Basis quantity</div>
                    <div className="font-mono">{displayDebugValue(weightDebug?.basisQuantity ?? null)}</div>
                    <div className="text-slate-400">Computed weight</div>
                    <div className="font-mono">{displayWeightOz(weightDebug?.computedShippingWeightOz ?? null)}</div>
                    <div className="text-slate-400">Fallback used</div>
                    <div className="font-mono">{fallbackUsed ? "Yes" : "No"}</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-slate-400">Option weight fields</div>
                    {selectedWeightFields.length === 0 ? (
                      <div className="font-mono">—</div>
                    ) : (
                      <div className="rounded border border-slate-700/70 bg-slate-950/40 p-2 space-y-1">
                        {selectedWeightFields.map((entry, index) => (
                          <div key={`${entry.label}-${index}`} className="flex items-center justify-between gap-2">
                            <span>{entry.label}</span>
                            <span className="font-mono">{displayWeightOz(entry.oz)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {weightWarnings.length > 0 ? (
                    <div className="rounded border border-amber-800/50 bg-amber-950/20 p-2 space-y-1">
                      {weightWarnings.map((warning, index) => (
                        <div key={`${warning.code}-${index}`} className="text-amber-200">
                          {displayWeightWarning(warning)}
                        </div>
                      ))}
                      <details className="text-[11px] text-amber-300/80">
                        <summary>Debug codes</summary>
                        <div className="mt-1 space-y-1">
                          {weightWarnings.map((warning, index) => (
                            <div key={`${warning.code}-detail-${index}`} className="font-mono">{warning.code}</div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : null}
                  {weightDebug?.errorMessage ? <div className="text-red-300">{weightDebug.errorMessage}</div> : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Options</div>
            {previewGroups.length === 0 ? (
              <div className="text-sm text-slate-400">No selectable options found in this draft tree.</div>
            ) : (
              previewGroups.map((group) => (
                <div key={group.groupId} className="rounded-md border border-slate-700 bg-slate-800/30 p-3 space-y-2 min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{group.groupName}</div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {group.isRequired ? (
                        <Badge variant="outline" className="text-[10px] border-red-500/40 bg-red-500/10 text-red-300">
                          Required
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-300">
                        {group.isMultiSelect ? "Multi" : "Single"}
                      </Badge>
                    </div>
                  </div>

                  {group.options.map((option) => {
                    const explicitSelectedValue = previewState.selectedOptionValues[option.selectionKey];
                    const selectedValue = explicitSelectedValue ?? effectiveRuntimeSelectionValues[option.selectionKey];
                    const hasEffectiveDefault = !Object.prototype.hasOwnProperty.call(previewState.selectedOptionValues, option.selectionKey)
                      && typeof effectiveRuntimeSelectionValues[option.selectionKey] === "string";
                    const isFreeform = FREEFORM_INPUT_TYPES.has(option.inputType);
                    const isMulti = !isFreeform && (option.inputType === "multiselect" || group.isMultiSelect);

                    // Freeform option types (text / numeric) carry no choices: render
                    // a matching input so their value is included in the payload.
                    if (isFreeform) {
                      const isTextarea = option.inputType === "textarea";
                      const isNumeric = option.inputType !== "text" && option.inputType !== "textarea";
                      const freeformValue = typeof selectedValue === "string" ? selectedValue : "";
                      const commitFreeformValue = (nextValue: string) => {
                        setPreviewState((prev) => {
                          const nextSelected = { ...prev.selectedOptionValues };
                          if (nextValue.trim().length === 0) delete nextSelected[option.selectionKey];
                          else nextSelected[option.selectionKey] = nextValue;
                          return { ...prev, selectedOptionValues: nextSelected };
                        });
                      };
                      return (
                        <div key={option.optionId} className="space-y-1 min-w-0">
                          <div className="text-xs text-slate-400">{option.optionName}{hasEffectiveDefault ? <span className="ml-1 text-sky-300">(default)</span> : null}</div>
                          {isTextarea ? (
                            <Textarea
                              value={freeformValue}
                              placeholder="Enter notes"
                              onChange={(e) => commitFreeformValue(e.target.value)}
                              className="min-h-[60px] bg-slate-950/60 border-slate-700/60 text-xs min-w-0"
                            />
                          ) : (
                            <Input
                              type={isNumeric ? "number" : "text"}
                              step={isNumeric ? "any" : undefined}
                              value={freeformValue}
                              placeholder={isNumeric ? "Enter a value" : "Enter text"}
                              onChange={(e) => commitFreeformValue(e.target.value)}
                              className="h-8 bg-slate-950/60 border-slate-700/60 text-xs min-w-0"
                            />
                          )}
                        </div>
                      );
                    }

                    if (isMulti) {
                      const selectedArray = Array.isArray(selectedValue) ? selectedValue : [];
                      return (
                        <div key={option.optionId} className="space-y-1.5 min-w-0">
                          <div className="text-xs text-slate-400">{option.optionName}{hasEffectiveDefault ? <span className="ml-1 text-sky-300">(default)</span> : null}</div>
                          <div className="space-y-1">
                            {option.choices.map((choice) => {
                              const checked = selectedArray.includes(choice.value);
                              return (
                                <label key={choice.value} className="flex items-center gap-2 text-xs text-slate-200 min-w-0">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(next) => {
                                      setPreviewState((prev) => {
                                        const current = Array.isArray(prev.selectedOptionValues[option.selectionKey])
                                          ? ([...(prev.selectedOptionValues[option.selectionKey] as string[])] as string[])
                                          : [];
                                        const updated = next
                                          ? Array.from(new Set([...current, choice.value]))
                                          : current.filter((v) => v !== choice.value);
                                        const nextSelected = { ...prev.selectedOptionValues };
                                        if (updated.length === 0) delete nextSelected[option.selectionKey];
                                        else nextSelected[option.selectionKey] = updated;
                                        return { ...prev, selectedOptionValues: nextSelected };
                                      });
                                    }}
                                  />
                                  <span className="truncate">{choice.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={option.optionId} className="space-y-1 min-w-0">
                        <div className="text-xs text-slate-400">{option.optionName}{hasEffectiveDefault ? <span className="ml-1 text-sky-300">(default)</span> : null}</div>
                        <Select
                          value={typeof selectedValue === "string" ? selectedValue : "__none__"}
                          onValueChange={(value) => {
                            setPreviewState((prev) => {
                              const nextSelected = { ...prev.selectedOptionValues };
                              if (value === "__none__") delete nextSelected[option.selectionKey];
                              else nextSelected[option.selectionKey] = value;
                              return { ...prev, selectedOptionValues: nextSelected };
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 bg-slate-950/60 border-slate-700/60 text-xs min-w-0">
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— None —</SelectItem>
                            {option.choices.map((choice) => (
                              <SelectItem key={choice.value} value={choice.value}>
                                {choice.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Validation</h3>
            </div>

            {findings.length === 0 ? (
              <div className="flex items-start gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-emerald-300 text-sm">No validation findings.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {errors.map((finding) => {
                  const presentation = presentPbv2FindingForOperator(finding, (materialId) => materialNamesById?.[materialId]);
                  return (
                    <div key={`err-${finding.code}-${finding.path}-${finding.entityId ?? ""}`} className="p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-200">
                      <div className="font-semibold">{presentation.title}</div>
                      <div>{presentation.message}</div>
                      <details className="mt-2 text-xs text-red-200/80">
                        <summary className="cursor-pointer">Show technical details</summary>
                        <code className="block mt-1 break-all">{finding.code}</code>
                      </details>
                    </div>
                  );
                })}
                {warnings.map((finding) => {
                  const presentation = presentPbv2FindingForOperator(finding, (materialId) => materialNamesById?.[materialId]);
                  return (
                    <div key={`warn-${finding.code}-${finding.path}-${finding.entityId ?? ""}`} className="p-3 bg-amber-500/10 border border-amber-500/40 rounded text-sm text-amber-200">
                      <div className="font-semibold">{presentation.title}</div>
                      <div>{presentation.message}</div>
                      <details className="mt-2 text-xs text-amber-200/80">
                        <summary className="cursor-pointer">Show technical details</summary>
                        <code className="block mt-1 break-all">{finding.code}</code>
                      </details>
                    </div>
                  );
                })}
                {errors.length === 0 && warnings.length === 0 ? (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/40 rounded text-sm text-blue-200 flex items-center gap-2">
                    <AlertCircleIcon className="h-4 w-4" />
                    Findings present, but no errors/warnings.
                  </div>
                ) : null}
              </div>
            )}
          </div>
      </div>
    </aside>
  );
}
