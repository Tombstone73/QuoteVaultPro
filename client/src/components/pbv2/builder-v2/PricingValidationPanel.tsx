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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { compareCanonicalGeometryPricing, detectsManualGeometryRebuild } from "@/lib/pbv2/pricing/geometryWarning";
import type { Finding } from "@shared/pbv2/findings";
import { pbv2TreeToEditorModel, type EditorModel } from "@/lib/pbv2/pbv2ViewModel";
import { resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";

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
    resultValue?: number;
    appliedAs?: "unitPrice" | "totalPrice" | "unknown";
    steps?: Array<{ label: string; value: number | string }>;
    errors?: Array<{ code: string; message: string; detail?: any }>;
    likelyMisconfiguredFormula?: boolean;
    preCeilSqftTotal?: number | null;
    postCeilSqftTotal?: number | null;
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
    };
    formulaEvaluatedTotal?: number | null;
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
    formulaResultType?: "final_dollars";
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
      billedSheetSqft?: number | null;
      mode?: "exact_flat_goods" | "sheet_equivalent" | "unavailable";
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
      computedSheetUsageMode?: "exact_flat_goods" | "sheet_equivalent" | "unavailable";
      fallbackToLineItemQuantity?: boolean;
      selectedTierMinQty?: number | null;
      selectedTierRate?: number | null;
      selectedTierSource?: "matrix_row" | "pbv2_product" | "pbv2_pricing_v2" | "none" | null;
      finalBaseRateUsed: number;
      warnings: Array<{ code: string; message: string; severity?: string; detail?: Record<string, unknown> }>;
      capturedAt?: string;
    };
    runtimeSelectionContext?: {
      selectedChoices?: Record<string, string>;
      resolvedChoices?: Record<string, unknown>;
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
  productPrimaryMaterialId?: string | null;
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
  try {
    const runtimeVisibility = resolveRuntimeVisibility(treeJson as any, selectedOptionValues);
    visibleNodeIds = new Set(runtimeVisibility.visibleNodeIds);
    visibleGroupIds = new Set(runtimeVisibility.visibleGroupIds);
  } catch {
    visibleNodeIds = null;
    visibleGroupIds = null;
  }

  return model.groups
    .filter((group) => !visibleGroupIds || visibleGroupIds.has(group.id))
    .map((group) => {
      const options: PreviewOption[] = group.optionIds
        .map((optionId) => {
          if (visibleNodeIds && !visibleNodeIds.has(optionId)) return null;
          const optionMeta = model?.options?.[optionId];
          const node = nodes?.[optionId] ?? null;
          const choicesRaw = Array.isArray(node?.choices) ? node.choices : [];
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

export function PricingValidationPanel({ treeJson, pricingV2Override, pricingFormulaOverride, manualFormulaText, pricingFormulaId, formulaSourceMode = "profile", pricingProfileKey, pricingProfileConfig, pricingMode = "basic", productPrimaryMaterialId, findings }: PricingValidationPanelProps) {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<NormalizedPreviewError | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const requestIdRef = useRef(0);

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");

  const treeForPreview = useMemo(() => {
    if (!treeJson || typeof treeJson !== "object") return treeJson;
    if (!pricingV2Override || typeof pricingV2Override !== "object") return treeJson;

    const tree = treeJson as Record<string, any>;
    const meta = tree.meta && typeof tree.meta === "object" ? tree.meta : {};

    return {
      ...tree,
      meta: {
        ...meta,
        pricingV2: pricingV2Override,
      },
    };
  }, [treeJson, pricingV2Override]);

  const previewGroups = useMemo(
    () => buildPreviewGroups(treeForPreview, previewState.selectedOptionValues),
    [treeForPreview, previewState.selectedOptionValues],
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

  const requestSignature = useMemo(
    () =>
      JSON.stringify({
        treeJson: treeForPreview,
        width: previewState.width,
        height: previewState.height,
        quantity: previewState.quantity,
        pricingFormulaOverride,
        manualFormulaText,
        pricingFormulaId,
        formulaSourceMode,
        pricingProfileKey,
        pricingProfileConfig,
        optionSelectionsJson: selectionPayload,
      }),
    [treeForPreview, previewState.width, previewState.height, previewState.quantity, pricingFormulaOverride, manualFormulaText, pricingFormulaId, formulaSourceMode, pricingProfileKey, pricingProfileConfig, selectionPayload],
  );

  const inputErrors = useMemo(() => {
    const next: Partial<Record<"width" | "height" | "quantity", string>> = {};
    if (!Number.isFinite(previewState.width) || previewState.width <= 0) {
      next.width = "Width must be greater than 0.";
    }
    if (!Number.isFinite(previewState.height) || previewState.height <= 0) {
      next.height = "Height must be greater than 0.";
    }
    if (!Number.isFinite(previewState.quantity) || previewState.quantity < 1 || !Number.isInteger(previewState.quantity)) {
      next.quantity = "Quantity must be an integer of 1 or more.";
    }
    return next;
  }, [previewState.width, previewState.height, previewState.quantity]);

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
    if (!Number.isFinite(previewState.width) || !Number.isFinite(previewState.height) || previewState.width <= 0 || previewState.height <= 0) {
      return undefined;
    }
    return (previewState.width * previewState.height) / 144;
  }, [previewState.width, previewState.height]);
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
    : previewState.width;
  const orderedHeight = typeof result?.derived?.orderedHeight === "number"
    ? result.derived.orderedHeight
    : previewState.height;
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
  const billedSqftPre = typeof formulaDebug?.preCeilSqftTotal === "number" ? formulaDebug.preCeilSqftTotal : null;
  const billedSqftPost = typeof formulaDebug?.postCeilSqftTotal === "number" ? formulaDebug.postCeilSqftTotal : null;
  const baseRateUsed = typeof formulaDebug?.baseRateUsed === "number" ? formulaDebug.baseRateUsed : null;
  const billedLineTotal = billedSqftPost != null && baseRateUsed != null
    ? billedSqftPost * baseRateUsed
    : null;
  const hasBilledSqftDebug = billedSqftPre != null && billedSqftPost != null;
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
    ? (previewState.quantity > 0 ? displayTotalPrice / previewState.quantity : result.unitPrice)
    : 0;
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
          body: JSON.stringify({
            treeJson: treeForPreview,
            width: previewState.width,
            height: previewState.height,
            quantity: previewState.quantity,
            pricingFormulaOverride,
            manualFormulaText,
            pricingFormulaId,
            formulaSourceMode,
            pricingProfileKey,
            pricingProfileConfig,
            productPrimaryMaterialId,
            debug: true,
            optionSelectionsJson: selectionPayload,
          }),
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
  }, [hasInputErrors, requestSignature, treeForPreview, previewState.width, previewState.height, previewState.quantity, pricingFormulaOverride, manualFormulaText, pricingFormulaId, formulaSourceMode, pricingProfileKey, pricingProfileConfig, selectionPayload]);

  return (
    <aside className="h-full w-full min-w-0 bg-card flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-w-0">
        <div className="p-4 space-y-4 min-w-0">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Pricing Preview Sandbox</h2>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Inputs</div>
                <div className="text-[11px] text-slate-500">Units: {previewState.unit === "in" ? "inches" : previewState.unit}</div>
              </div>

              <div className="grid grid-cols-3 gap-2 min-w-0">
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">Width ({previewState.unit})</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={previewState.width}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, width: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8"
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
                    className="bg-slate-950/60 border-slate-700/60 h-8"
                  />
                  {inputErrors.height ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.height}</div> : null}
                </div>
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={previewState.quantity}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8"
                  />
                  {inputErrors.quantity ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.quantity}</div> : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-2 min-w-0">
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
                <div className="space-y-1 text-sm text-slate-200">
                  {hasCanonicalGeometryWarning ? (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[11px] text-amber-200">
                      <div className="font-semibold">Formula does not use canonical finished geometry. Billing may ignore trim allowances.</div>
                      {typeof geometryComparison?.relativeDifference === "number" ? (
                        <div className="mt-1">Relative difference: {(geometryComparison.relativeDifference * 100).toFixed(2)}%</div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
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
                  </div>

                  {hasBilledSqftDebug ? (
                    <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
                      <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">BILLED (Pricing)</div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">total_sqft (finished)</span>
                        <span className="font-mono text-base text-slate-100">{typeof finishedTotalSqft === "number" ? finishedTotalSqft.toFixed(4) : "—"}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-slate-300">Formula dimension basis</span>
                        <span className="font-mono text-base text-slate-100">{formulaDimensionUsageLabel}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">Pre-ceil sqft total</span>
                        <span className="font-mono text-base text-slate-100">{billedSqftPre.toFixed(4)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-slate-300">Post-ceil billed sqft</span>
                        <span className="font-mono text-base text-slate-100">{billedSqftPost.toFixed(0)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-slate-300">Rate used (base_price / p)</span>
                        <span className="font-mono text-slate-100">{baseRateUsed != null ? currencyFormatter.format(baseRateUsed) : "—"}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {billedSqftPost.toFixed(0)} × {baseRateUsed != null ? currencyFormatter.format(baseRateUsed) : "—"} = {billedLineTotal != null ? currencyFormatter.format(billedLineTotal) : "—"}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 mb-2">Enable ceil debug to see billed sqft breakdown.</div>
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
                      <div className="flex items-center justify-between"><span>Unit price</span><span className="font-mono">{currencyFormatter.format(displayUnitPrice)}</span></div>
                      <div className="flex items-center justify-between"><span>Total price</span><span className="font-mono">{currencyFormatter.format(displayTotalPrice)}</span></div>
                      {formulaDebug?.pricing?.finalTotalSource ? (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Final source</span>
                          <span className="font-mono">{formulaDebug.pricing.finalTotalSource}</span>
                        </div>
                      ) : null}
                    </>
                  )}
                  {result.formulaUsed ? (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Formula: <span className="font-mono">{result.formulaUsed}</span></span>
                      {formulaDebug?.likelyMisconfiguredFormula ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
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
                    </div>
                  ) : null}

                </div>
              ) : (
                <div className="text-sm text-slate-400">Enter dimensions and quantity to preview pricing.</div>
              )}

              {formulaDebug ? (
                <Accordion type="single" collapsible className="mt-2 border-t border-slate-700/80 pt-2">
                  <AccordionItem value="formula-debug" className="border-b-0">
                    <AccordionTrigger className="py-1 text-xs text-slate-300 hover:no-underline">Formula Debug</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-xs text-slate-300">
                      <div><span className="text-slate-400">Formula used:</span> <span className="font-mono">{formulaDebug.formulaRaw || "—"}</span></div>
                      <div><span className="text-slate-400">Formula source mode:</span> <span className="font-mono">{formulaDebug.formulaSourceMode ?? "—"}</span></div>
                      <div><span className="text-slate-400">Resolved formula source:</span> <span className="font-mono">{formulaDebug.resolvedFormulaSource ?? "—"}</span></div>
                      <div><span className="text-slate-400">Resolved formula id:</span> <span className="font-mono">{formulaDebug.resolvedFormulaId ?? "—"}</span></div>
                      <div><span className="text-slate-400">Resolved formula name:</span> <span className="font-mono">{formulaDebug.resolvedFormulaName ?? "—"}</span></div>
                      <div><span className="text-slate-400">Resolved formula expression:</span> <span className="font-mono">{formulaDebug.resolvedFormulaExpression ?? "—"}</span></div>
                      <div><span className="text-slate-400">Manual formula present:</span> <span className="font-mono">{formulaDebug.manualFormulaPresent ? "true" : "false"}</span></div>
                      <div><span className="text-slate-400">Manual formula ignored:</span> <span className="font-mono">{formulaDebug.manualFormulaIgnored ? "true" : "false"}</span></div>
                      {formulaDebug.formulaResolved ? (
                        <div><span className="text-slate-400">Formula resolved:</span> <span className="font-mono">{formulaDebug.formulaResolved}</span></div>
                      ) : null}
                      <div><span className="text-slate-400">Result value:</span> <span className="font-mono">{typeof formulaDebug.resultValue === "number" ? String(formulaDebug.resultValue) : "—"}</span></div>
                      <div><span className="text-slate-400">Applied as:</span> <span className="font-mono">{formulaDebug.appliedAs ?? "unknown"}</span></div>
                      <div><span className="text-slate-400">Formula output type:</span> <span className="font-mono">{formulaDebug.formulaResultType ?? "—"}</span></div>
                      <div><span className="text-slate-400">Formula basis:</span> <span className="font-mono">{formulaDebug.quantityBasisUsed ?? "—"}</span></div>
                      <div><span className="text-slate-400">Selected rate:</span> <span className="font-mono">{typeof formulaDebug.selectedRate === "number" ? currencyFormatter.format(formulaDebug.selectedRate) : "—"}</span></div>
                      <div><span className="text-slate-400">Formula evaluated total:</span> <span className="font-mono">{typeof formulaDebug.formulaEvaluatedTotal === "number" ? currencyFormatter.format(formulaDebug.formulaEvaluatedTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">PBV2 base total:</span> <span className="font-mono">{typeof formulaDebug.pbv2BaseTotal === "number" ? currencyFormatter.format(formulaDebug.pbv2BaseTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">Final total source:</span> <span className="font-mono">{formulaDebug.finalTotalSource ?? "—"}</span></div>
                      <div><span className="text-slate-400">Final total:</span> <span className="font-mono">{typeof formulaDebug.finalTotal === "number" ? currencyFormatter.format(formulaDebug.finalTotal) : "—"}</span></div>
                      <div><span className="text-slate-400">Finished sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.finishedSqft === "number" ? formulaDebug.sheetYield.finishedSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Computed sheets:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.computedSheets === "number" ? formulaDebug.sheetYield.computedSheets.toFixed(4) : "—"}</span></div>
                      <div><span className="text-slate-400">Billed sheet sqft:</span> <span className="font-mono">{typeof formulaDebug.sheetYield?.billedSheetSqft === "number" ? formulaDebug.sheetYield.billedSheetSqft.toFixed(2) : "—"}</span></div>
                      <div><span className="text-slate-400">Selected tier basis:</span> <span className="font-mono">{tierResolution?.tierBasis ?? "—"}</span></div>
                      <div><span className="text-slate-400">Pre-ceil sqft:</span> <span className="font-mono">{typeof formulaDebug.preCeilSqftTotal === "number" ? formulaDebug.preCeilSqftTotal.toFixed(4) : "—"}</span></div>
                      <div><span className="text-slate-400">Post-ceil sqft:</span> <span className="font-mono">{typeof formulaDebug.postCeilSqftTotal === "number" ? formulaDebug.postCeilSqftTotal.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Base rate used (p):</span> <span className="font-mono">{typeof formulaDebug.baseRateUsed === "number" ? String(formulaDebug.baseRateUsed) : "—"}</span></div>
                      <div className="space-y-1">
                        <div className="text-slate-400">Variables</div>
                        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 max-h-32 overflow-y-auto">
                          {sortedDebugVariables.length === 0 ? (
                            <div className="text-slate-500">No variables</div>
                          ) : (
                            sortedDebugVariables.map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <span className="font-mono text-slate-400">{key}</span>
                                <span className="font-mono text-slate-200">{value == null ? "null" : String(value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {Array.isArray(formulaDebug.steps) && formulaDebug.steps.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-slate-400">Steps</div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2">
                            {formulaDebug.steps.map((step, idx) => (
                              <div key={`${step.label}-${idx}`} className="flex items-center justify-between gap-2">
                                <span>{step.label}</span>
                                <span className="font-mono">{String(step.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {hasRuntimeSelectionDebug ? (
                        <div className="space-y-2">
                          <div className="text-slate-400">Runtime Selection Context</div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 space-y-2">
                            <div>
                              <div className="text-slate-500 mb-1">Selected choices</div>
                              {selectedChoiceEntries.length === 0 ? (
                                <div className="font-mono text-slate-500">-</div>
                              ) : (
                                selectedChoiceEntries.map(([selectionKey, choiceValue]) => (
                                  <div key={selectionKey} className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-slate-400">{selectionKey}</span>
                                    <span className="font-mono text-slate-200">{choiceValue}</span>
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
                                  <div key={`pricing-override-${index}`} className="font-mono text-slate-200">
                                    {displayDebugValue(override.selectionKey)}:{displayDebugValue(override.choiceValue)} {displayDebugValue(override.mode)} {displayDebugValue(override.amount)} {displayDebugValue(override.unit)}
                                  </div>
                                ))
                              )}
                            </div>

                            {hiddenSelectionWarnings.length > 0 ? (
                              <div>
                                <div className="text-slate-500 mb-1">Hidden/stale selections</div>
                                {hiddenSelectionWarnings.map((warning, index) => (
                                  <div key={`hidden-selection-${index}`} className="font-mono text-amber-200">
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
                    </AccordionContent>
                  </AccordionItem>
                  {showTierResolutionDebug ? (
                    <AccordionItem value="tier-resolution" className="border-b-0">
                      <AccordionTrigger className="py-1 text-xs text-slate-300 hover:no-underline">
                        Quantity Tier Debug
                        {tierWarnings.length > 0 || tierResolution?.matrixBasePriceOverride || tierResolution?.matrixStaticBaseRateUsedAsFallback ? (
                          <Badge variant="outline" className="ml-2 border-amber-500/40 text-[10px] text-amber-300">
                            Warning
                          </Badge>
                        ) : null}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 text-xs text-slate-300">
                        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
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
                            <div className="text-slate-400">Final base rate used</div>
                            <div className="font-mono">{displayDebugCurrency(tierResolution?.finalBaseRateUsed)}</div>
                          </div>
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
                      </AccordionContent>
                    </AccordionItem>
                  ) : null}
                </Accordion>
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
                    const selectedValue = previewState.selectedOptionValues[option.selectionKey];
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
                          <div className="text-xs text-slate-400">{option.optionName}</div>
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
                          <div className="text-xs text-slate-400">{option.optionName}</div>
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
                        <div className="text-xs text-slate-400">{option.optionName}</div>
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
                {errors.map((finding, i) => (
                  <div key={`err-${i}`} className="p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-200">
                    <div className="font-semibold">{finding.code}</div>
                    <div>{finding.message}</div>
                  </div>
                ))}
                {warnings.map((finding, i) => (
                  <div key={`warn-${i}`} className="p-3 bg-amber-500/10 border border-amber-500/40 rounded text-sm text-amber-200">
                    <div className="font-semibold">{finding.code}</div>
                    <div>{finding.message}</div>
                  </div>
                ))}
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
      </ScrollArea>
    </aside>
  );
}
