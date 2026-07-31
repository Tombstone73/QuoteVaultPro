export type CombinedRunSheetPlanInputItem = {
  lineItemId: string;
  quantity: number;
  width?: number | null;
  height?: number | null;
  productionLayout?: {
    sheetWidthIn?: number | null;
    sheetHeightIn?: number | null;
    sideCount?: number | null;
    piecesPerSheet?: number | null;
    orientation?: string | null;
  } | null;
  productionLayoutUnavailableReason?: string | null;
};

export type CombinedRunSheetPlanRecommendation = {
  canAutoPlan: boolean;
  reason: string | null;
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

const positiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const stableNumber = (value: unknown): string => {
  const parsed = positiveNumber(value);
  return parsed == null ? "missing" : parsed.toFixed(4);
};

export function buildCombinedRunSheetPlanRecommendation(
  items: CombinedRunSheetPlanInputItem[],
): CombinedRunSheetPlanRecommendation {
  const memberQuantities = items.map((item) => ({
    lineItemId: item.lineItemId,
    quantity: positiveNumber(item.quantity) ?? 0,
  }));
  const totalQuantity = memberQuantities.reduce((sum, item) => sum + item.quantity, 0);
  const empty = {
    totalQuantity,
    plannedSheetCount: null,
    nominalPiecesPerSheet: null,
    sheetWidth: null,
    sheetHeight: null,
    printPasses: null,
    fullSheets: null,
    partialSheetPieces: null,
    memberQuantities,
  };

  if (items.length === 0) {
    return { ...empty, canAutoPlan: false, reason: "Select jobs before planning the run." };
  }

  const missingLayout = items.find((item) => !item.productionLayout);
  if (missingLayout) {
    return {
      ...empty,
      canAutoPlan: false,
      reason: missingLayout.productionLayoutUnavailableReason
        ? "Canonical sheet layout is unavailable for one or more selected jobs."
        : "One or more selected jobs does not have a sheet-layout recommendation.",
    };
  }

  const first = items[0].productionLayout!;
  const piecesPerSheet = positiveNumber(first.piecesPerSheet);
  const sheetWidth = positiveNumber(first.sheetWidthIn);
  const sheetHeight = positiveNumber(first.sheetHeightIn);
  const sideCount = positiveNumber(first.sideCount) ?? 1;
  if (!piecesPerSheet || !sheetWidth || !sheetHeight || totalQuantity <= 0) {
    return { ...empty, canAutoPlan: false, reason: "The selected jobs are missing quantity or sheet-yield details." };
  }

  const compatibilityKey = [
    stableNumber(items[0].width),
    stableNumber(items[0].height),
    stableNumber(first.sheetWidthIn),
    stableNumber(first.sheetHeightIn),
    stableNumber(first.piecesPerSheet),
    stableNumber(first.sideCount ?? 1),
    String(first.orientation ?? "unknown"),
  ].join("|");
  const incompatible = items.some((item) => {
    const layout = item.productionLayout!;
    return [
      stableNumber(item.width),
      stableNumber(item.height),
      stableNumber(layout.sheetWidthIn),
      stableNumber(layout.sheetHeightIn),
      stableNumber(layout.piecesPerSheet),
      stableNumber(layout.sideCount ?? 1),
      String(layout.orientation ?? "unknown"),
    ].join("|") !== compatibilityKey;
  });
  if (incompatible) {
    return {
      ...empty,
      canAutoPlan: false,
      reason: "Mixed finished sizes or sheet-layout recommendations need separate runs or an explicit manual override.",
    };
  }

  const plannedSheetCount = Math.ceil(totalQuantity / piecesPerSheet);
  const fullSheets = Math.floor(totalQuantity / piecesPerSheet);
  const partialSheetPieces = totalQuantity % piecesPerSheet;

  return {
    canAutoPlan: true,
    reason: null,
    totalQuantity,
    plannedSheetCount,
    nominalPiecesPerSheet: piecesPerSheet,
    sheetWidth,
    sheetHeight,
    printPasses: plannedSheetCount * sideCount,
    fullSheets,
    partialSheetPieces,
    memberQuantities,
  };
}
