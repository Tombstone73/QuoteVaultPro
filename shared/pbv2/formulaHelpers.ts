/**
 * Pure formula helper functions shared between the server evaluator (PricingService)
 * and the client-side formula tester (pricing-formulas settings page).
 *
 * All functions must be side-effect free and importable in both environments.
 *
 * Formula output contract:
 * - Pricing formulas must resolve to final dollars.
 * - Finished sqft pricing: `total_finished_sqft * base_price`
 * - Billed sheet sqft pricing: `billed_sheet_sqft * base_price`
 * - Sheet-count pricing: `computed_sheets * sheet_price`
 *
 * Helpers such as `sheet_consumption_sqft(...)` return intermediate geometry
 * quantities. They must be multiplied by an explicit rate in the formula.
 */

export type SheetYieldOrientation = "normal" | "rotated";
export type SheetYieldMethod = "layout_yield";

export type SheetYieldResult = {
  sheetUsageMethod: SheetYieldMethod;
  piecesPerSheet: number;
  orientationUsed: SheetYieldOrientation;
  fullSheets: number;
  partialSheetPieceCount: number;
  partialSheetFinishedSqft: number;
  partialSheetBillableSqft: number;
  totalSheetCount: number;
  sheetSqft: number;
  billedSheetSqft: number;
};

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`sheet_consumption_sqft: ${label} must be a positive number`);
  }
}

function orientationYield(pieceW: number, pieceH: number, sheetWidth: number, sheetLength: number) {
  if (pieceW > sheetWidth || pieceH > sheetLength) {
    return { piecesAcross: 0, rowsPerSheet: 0, piecesPerSheet: 0 };
  }

  const piecesAcross = Math.floor(sheetWidth / pieceW);
  const rowsPerSheet = Math.floor(sheetLength / pieceH);
  return { piecesAcross, rowsPerSheet, piecesPerSheet: piecesAcross * rowsPerSheet };
}

function billPartialSheetSqft(input: {
  pieceW: number;
  pieceH: number;
  partialPieces: number;
  sheetWidth: number;
  usableDropMin: number;
  billableLengthIncrement: number;
  minimumBillableSqft: number;
}): number {
  if (input.partialPieces <= 0) return 0;

  const piecesAcross = Math.floor(input.sheetWidth / input.pieceW);
  if (piecesAcross <= 0) return Infinity;

  const rowsNeeded = Math.ceil(input.partialPieces / piecesAcross);
  const consumedLength = rowsNeeded * input.pieceH;
  const increment = input.billableLengthIncrement > 0 ? input.billableLengthIncrement : 1;
  const billableLength = Math.ceil(consumedLength / increment) * increment;
  const fullRows = Math.floor(input.partialPieces / piecesAcross);
  const piecesInLastRow = input.partialPieces % piecesAcross;
  const occupiedWidth =
    piecesInLastRow > 0 && fullRows === 0
      ? piecesInLastRow * input.pieceW
      : piecesAcross * input.pieceW;
  const drop = input.sheetWidth - occupiedWidth;
  const effectiveWidth = drop >= input.usableDropMin ? occupiedWidth : input.sheetWidth;

  return Math.ceil(Math.max((effectiveWidth * billableLength) / 144, input.minimumBillableSqft));
}

/**
 * Calculates actual sheet yield for rectangular pieces on rectangular sheets.
 *
 * The current algorithm compares a single normal orientation with a single
 * rotated orientation and chooses the higher yield. Mixed-row nesting can be
 * added later as a separate method without returning sqft-equivalent counts.
 */
export function calculateSheetYield(
  w: number,
  h: number,
  q: number,
  sheetWidth: number,
  sheetLength: number,
  usableDropMin: number,
  billableLengthIncrement: number,
  minimumBillableSqft: number,
): SheetYieldResult {
  assertPositiveFinite(w, "piece width");
  assertPositiveFinite(h, "piece height");
  assertPositiveFinite(q, "quantity");
  assertPositiveFinite(sheetWidth, "sheet_width");
  assertPositiveFinite(sheetLength, "sheet_length");

  const normal = orientationYield(w, h, sheetWidth, sheetLength);
  const rotated = orientationYield(h, w, sheetWidth, sheetLength);
  const useRotated = rotated.piecesPerSheet > normal.piecesPerSheet;
  const chosen = useRotated ? rotated : normal;
  const pieceW = useRotated ? h : w;
  const pieceH = useRotated ? w : h;

  if (chosen.piecesPerSheet <= 0) {
    throw new Error(
      `sheet_consumption_sqft: piece ${w}x${h} exceeds sheet ${sheetWidth}x${sheetLength} in both orientations`,
    );
  }

  const quantity = Math.ceil(q);
  const fullSheets = Math.floor(quantity / chosen.piecesPerSheet);
  const partialSheetPieceCount = quantity % chosen.piecesPerSheet;
  const totalSheetCount = fullSheets + (partialSheetPieceCount > 0 ? 1 : 0);
  const sheetSqft = (sheetWidth * sheetLength) / 144;
  const partialSheetFinishedSqft = (partialSheetPieceCount * w * h) / 144;
  const partialSheetBillableSqft = billPartialSheetSqft({
    pieceW,
    pieceH,
    partialPieces: partialSheetPieceCount,
    sheetWidth,
    usableDropMin,
    billableLengthIncrement,
    minimumBillableSqft,
  });
  const billedSheetSqft = Math.ceil(fullSheets * sheetSqft + partialSheetBillableSqft);

  return {
    sheetUsageMethod: "layout_yield",
    piecesPerSheet: chosen.piecesPerSheet,
    orientationUsed: useRotated ? "rotated" : "normal",
    fullSheets,
    partialSheetPieceCount,
    partialSheetFinishedSqft,
    partialSheetBillableSqft,
    totalSheetCount,
    sheetSqft,
    billedSheetSqft,
  };
}

/**
 * Calculates billable square footage for sheet material using actual sheet yield.
 */
export function sheetConsumptionSqft(
  w: number,
  h: number,
  q: number,
  sheetWidth: number,
  sheetLength: number,
  usableDropMin: number,
  billableLengthIncrement: number,
  minimumBillableSqft: number,
): number {
  return calculateSheetYield(
    w,
    h,
    q,
    sheetWidth,
    sheetLength,
    usableDropMin,
    billableLengthIncrement,
    minimumBillableSqft,
  ).billedSheetSqft;
}

/**
 * Extracts formula-scoped variables from a formula's config object.
 * Returns `Record<string, number>` with only finite numeric values.
 * Safe to spread directly into a mathjs evalScope.
 */
export function extractFormulaVariables(
  config: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const raw = config?.variables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) result[k] = n;
    }
  }
  return result;
}

/**
 * Returns the evalScope additions that inject all custom formula helpers into
 * a mathjs evaluate() call. Pass the result spread into the scope object:
 *
 *   const scope = { ...buildFormulaScope(input), ...formulaHelperScope() };
 *
 * Keeping the helper map in one place ensures the client tester and the
 * server evaluator always expose the same set of functions.
 */
export function formulaHelperScope(): Record<string, (...args: unknown[]) => unknown> {
  return {
    sheet_consumption_sqft: (
      w: unknown,
      h: unknown,
      q: unknown,
      sheet_width: unknown,
      sheet_length: unknown,
      usable_drop_min: unknown,
      billable_length_increment: unknown,
      minimum_billable_sqft: unknown,
    ) =>
      sheetConsumptionSqft(
        Number(w),
        Number(h),
        Number(q),
        Number(sheet_width),
        Number(sheet_length),
        Number(usable_drop_min),
        Number(billable_length_increment),
        Number(minimum_billable_sqft),
      ),
  };
}
