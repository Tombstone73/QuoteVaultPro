import { calculateSheetProductionLayout } from "./productionHydration";

export const COMBINED_RUN_SHEET_PLAN_CALCULATOR_VERSION = "combined-run-sheet-plan-v1";

export type CombinedRunSheetPlanInputItem = {
  lineItemId: string;
  quantity: number;
  width?: number | null;
  height?: number | null;
  productionLayout?: {
    sheetWidthIn?: number | null;
    sheetHeightIn?: number | null;
    allowRotation?: boolean | null;
    sideCount?: number | null;
    piecesPerSheet?: number | null;
    orientation?: string | null;
  } | null;
  productionLayoutUnavailableReason?: string | null;
};

export type CombinedRunSheetPlanInputs = {
  sheetWidth: number | null;
  sheetHeight: number | null;
  allowRotation: boolean;
  bleed: number;
  spacing: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
};

export type CombinedRunSheetPlanRecommendation = {
  canAutoPlan: boolean;
  reason: string | null;
  reasonCode: "none" | "empty" | "missing_layout" | "missing_inputs" | "mixed_size" | "item_too_large" | "layout_error";
  calculatorVersion: string;
  inputKey: string;
  inputs: CombinedRunSheetPlanInputs;
  totalQuantity: number;
  plannedSheetCount: number | null;
  nominalPiecesPerSheet: number | null;
  sheetWidth: number | null;
  sheetHeight: number | null;
  printPasses: number | null;
  fullSheets: number | null;
  partialSheetPieces: number | null;
  memberQuantities: Array<{ lineItemId: string; quantity: number }>;
};

export type CombinedRunSheetPlanSubmission = {
  inputs: CombinedRunSheetPlanInputs;
  calculated: Pick<CombinedRunSheetPlanRecommendation,
    "canAutoPlan" | "reason" | "reasonCode" | "inputKey" | "calculatorVersion" |
    "totalQuantity" | "plannedSheetCount" | "nominalPiecesPerSheet" | "sheetWidth" |
    "sheetHeight" | "printPasses" | "fullSheets" | "partialSheetPieces" | "memberQuantities">;
  manualOverride?: {
    enabled: boolean;
    plannedSheetCount?: number | null;
    nominalPiecesPerSheet?: number | null;
    reason?: string | null;
    inputKey?: string | null;
  } | null;
};

const positiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const nonNegativeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const stableNumber = (value: unknown): string => {
  const parsed = positiveNumber(value);
  return parsed == null ? "missing" : parsed.toFixed(4);
};

const stableNonNegative = (value: unknown): string => nonNegativeNumber(value).toFixed(4);

function normalizeInputs(inputs: Partial<CombinedRunSheetPlanInputs> | null | undefined, fallbackLayout?: CombinedRunSheetPlanInputItem["productionLayout"]): CombinedRunSheetPlanInputs {
  return {
    sheetWidth: positiveNumber(inputs?.sheetWidth) ?? positiveNumber(fallbackLayout?.sheetWidthIn),
    sheetHeight: positiveNumber(inputs?.sheetHeight) ?? positiveNumber(fallbackLayout?.sheetHeightIn),
    allowRotation: typeof inputs?.allowRotation === "boolean" ? inputs.allowRotation : Boolean(fallbackLayout?.allowRotation),
    bleed: nonNegativeNumber(inputs?.bleed),
    spacing: nonNegativeNumber(inputs?.spacing),
    marginTop: nonNegativeNumber(inputs?.marginTop),
    marginRight: nonNegativeNumber(inputs?.marginRight),
    marginBottom: nonNegativeNumber(inputs?.marginBottom),
    marginLeft: nonNegativeNumber(inputs?.marginLeft),
  };
}

function inputKey(inputs: CombinedRunSheetPlanInputs, items: CombinedRunSheetPlanInputItem[]) {
  return [
    COMBINED_RUN_SHEET_PLAN_CALCULATOR_VERSION,
    stableNumber(inputs.sheetWidth),
    stableNumber(inputs.sheetHeight),
    inputs.allowRotation ? "rotate" : "fixed",
    stableNonNegative(inputs.bleed),
    stableNonNegative(inputs.spacing),
    stableNonNegative(inputs.marginTop),
    stableNonNegative(inputs.marginRight),
    stableNonNegative(inputs.marginBottom),
    stableNonNegative(inputs.marginLeft),
    ...items.map((item) => [
      item.lineItemId,
      stableNumber(item.quantity),
      stableNumber(item.width),
      stableNumber(item.height),
      stableNumber(item.productionLayout?.sideCount ?? 1),
    ].join(":")),
  ].join("|");
}

export function buildCombinedRunSheetPlanRecommendation(
  items: CombinedRunSheetPlanInputItem[],
  requestedInputs?: Partial<CombinedRunSheetPlanInputs> | null,
): CombinedRunSheetPlanRecommendation {
  const memberQuantities = items.map((item) => ({
    lineItemId: item.lineItemId,
    quantity: positiveNumber(item.quantity) ?? 0,
  }));
  const totalQuantity = memberQuantities.reduce((sum, item) => sum + item.quantity, 0);
  const firstLayout = items[0]?.productionLayout ?? null;
  const inputs = normalizeInputs(requestedInputs, firstLayout);
  const key = inputKey(inputs, items);
  const empty = {
    calculatorVersion: COMBINED_RUN_SHEET_PLAN_CALCULATOR_VERSION,
    inputKey: key,
    inputs,
    totalQuantity,
    plannedSheetCount: null,
    nominalPiecesPerSheet: null,
    sheetWidth: inputs.sheetWidth,
    sheetHeight: inputs.sheetHeight,
    printPasses: null,
    fullSheets: null,
    partialSheetPieces: null,
    memberQuantities,
  };

  if (items.length === 0) {
    return { ...empty, canAutoPlan: false, reasonCode: "empty", reason: "Select jobs before planning the run." };
  }

  const notSheetJob = items.find((item) => item.productionLayoutUnavailableReason === "not_sheet_job");
  if (notSheetJob) {
    return {
      ...empty,
      canAutoPlan: false,
      reasonCode: "missing_layout",
      reason: "Automatic sheet layout is unavailable for one or more non-sheet jobs.",
    };
  }

  const missingLayout = items.find((item) => !item.productionLayout);
  if (missingLayout && (!inputs.sheetWidth || !inputs.sheetHeight)) {
    return {
      ...empty,
      canAutoPlan: false,
      reasonCode: "missing_layout",
      reason: missingLayout.productionLayoutUnavailableReason
        ? "Canonical sheet layout is unavailable for one or more selected jobs."
        : "One or more selected jobs does not have a sheet-layout recommendation.",
    };
  }

  const sheetWidth = positiveNumber(inputs.sheetWidth);
  const sheetHeight = positiveNumber(inputs.sheetHeight);
  if (!sheetWidth || !sheetHeight || totalQuantity <= 0) {
    return { ...empty, canAutoPlan: false, reasonCode: "missing_inputs", reason: "The selected jobs are missing quantity or sheet size details." };
  }

  const usableWidth = sheetWidth - inputs.marginLeft - inputs.marginRight;
  const usableHeight = sheetHeight - inputs.marginTop - inputs.marginBottom;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return { ...empty, canAutoPlan: false, reasonCode: "item_too_large", reason: "Usable sheet area must be larger than the selected margins." };
  }

  const first = items[0].productionLayout ?? null;
  const sideCount = positiveNumber(first?.sideCount) ?? 1;
  const compatibilityKey = [
    stableNumber(items[0].width),
    stableNumber(items[0].height),
    stableNumber(first?.sideCount ?? 1),
  ].join("|");
  const incompatible = items.some((item) => {
    const layout = item.productionLayout ?? null;
    return [
      stableNumber(item.width),
      stableNumber(item.height),
      stableNumber(layout?.sideCount ?? 1),
    ].join("|") !== compatibilityKey;
  });
  if (incompatible) {
    return {
      ...empty,
      canAutoPlan: false,
      reasonCode: "mixed_size",
      reason: "Mixed finished sizes or sheet-layout recommendations need separate runs or an explicit manual override.",
    };
  }

  const itemWidth = positiveNumber(items[0].width);
  const itemHeight = positiveNumber(items[0].height);
  if (!itemWidth || !itemHeight) {
    return { ...empty, canAutoPlan: false, reasonCode: "missing_inputs", reason: "The selected jobs are missing finished dimensions." };
  }

  const effectiveItemWidth = itemWidth + (inputs.bleed * 2) + inputs.spacing;
  const effectiveItemHeight = itemHeight + (inputs.bleed * 2) + inputs.spacing;
  const layout = calculateSheetProductionLayout({
    stationKey: "flatbed",
    materialType: "sheet",
    widthIn: effectiveItemWidth,
    heightIn: effectiveItemHeight,
    quantity: totalQuantity,
    sheetWidthIn: usableWidth,
    sheetHeightIn: usableHeight,
    allowRotation: inputs.allowRotation,
    sides: sideCount > 1 ? "Double-sided" : "Single-sided",
  });
  if (!layout) {
    return {
      ...empty,
      canAutoPlan: false,
      reasonCode: effectiveItemWidth > usableWidth || effectiveItemHeight > usableHeight ? "item_too_large" : "layout_error",
      reason: `Item does not fit the selected ${sheetWidth} x ${sheetHeight} sheet with current bleed, spacing, margin, and rotation settings.`,
    };
  }

  return {
    canAutoPlan: true,
    reason: null,
    reasonCode: "none",
    calculatorVersion: COMBINED_RUN_SHEET_PLAN_CALCULATOR_VERSION,
    inputKey: key,
    inputs,
    totalQuantity,
    plannedSheetCount: layout.sheetsToPrint,
    nominalPiecesPerSheet: layout.piecesPerSheet,
    sheetWidth,
    sheetHeight,
    printPasses: layout.printPasses,
    fullSheets: layout.fullSheets,
    partialSheetPieces: layout.partialSheetPieces,
    memberQuantities,
  };
}

export function snapshotCombinedRunSheetPlan(plan: CombinedRunSheetPlanRecommendation): CombinedRunSheetPlanSubmission["calculated"] {
  return {
    canAutoPlan: plan.canAutoPlan,
    reason: plan.reason,
    reasonCode: plan.reasonCode,
    inputKey: plan.inputKey,
    calculatorVersion: plan.calculatorVersion,
    totalQuantity: plan.totalQuantity,
    plannedSheetCount: plan.plannedSheetCount,
    nominalPiecesPerSheet: plan.nominalPiecesPerSheet,
    sheetWidth: plan.sheetWidth,
    sheetHeight: plan.sheetHeight,
    printPasses: plan.printPasses,
    fullSheets: plan.fullSheets,
    partialSheetPieces: plan.partialSheetPieces,
    memberQuantities: plan.memberQuantities,
  };
}
