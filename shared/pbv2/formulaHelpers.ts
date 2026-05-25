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

export type SheetYieldOrientation = "normal" | "rotated" | "mixed";
export type SheetYieldMethod = "layout_yield";
export type PartialSheetPolicy = "none" | "minimum_billable_sqft" | "measured_partial_sheet";

export type SheetYieldResult = {
  sheetUsageMethod: SheetYieldMethod;
  allowRotation: boolean;
  allowRotationSource?: string | null;
  normalPiecesPerSheet: number;
  rotatedPiecesPerSheet: number;
  mixedPiecesPerSheet: number;
  piecesPerSheet: number;
  orientationUsed: SheetYieldOrientation;
  mixedLayoutDescription?: string | null;
  fullSheets: number;
  partialSheetPieceCount: number;
  partialSheetFinishedSqft: number;
  partialSheetBillableSqft: number;
  partialSheetPolicy: PartialSheetPolicy;
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

function mixedRowYield(pieceW: number, pieceH: number, sheetWidth: number, sheetLength: number) {
  const normal = orientationYield(pieceW, pieceH, sheetWidth, sheetLength);
  const rotated = orientationYield(pieceH, pieceW, sheetWidth, sheetLength);
  let best = {
    piecesPerSheet: 0,
    normalRows: 0,
    rotatedRows: 0,
    normalPiecesAcross: normal.piecesAcross,
    rotatedPiecesAcross: rotated.piecesAcross,
    description: null as string | null,
  };

  if (normal.piecesAcross <= 0 && rotated.piecesAcross <= 0) return best;

  const maxNormalRows = pieceH > 0 ? Math.floor(sheetLength / pieceH) : 0;
  for (let normalRows = 0; normalRows <= maxNormalRows; normalRows += 1) {
    const usedLength = normalRows * pieceH;
    const remainingLength = sheetLength - usedLength;
    const rotatedRows = pieceW > 0 ? Math.floor(remainingLength / pieceW) : 0;
    const piecesPerSheet = normalRows * normal.piecesAcross + rotatedRows * rotated.piecesAcross;
    if (piecesPerSheet > best.piecesPerSheet) {
      best = {
        piecesPerSheet,
        normalRows,
        rotatedRows,
        normalPiecesAcross: normal.piecesAcross,
        rotatedPiecesAcross: rotated.piecesAcross,
        description: `${normalRows} normal row(s) x ${normal.piecesAcross}; ${rotatedRows} rotated row(s) x ${rotated.piecesAcross}`,
      };
    }
  }

  return best;
}

export function parseFormulaBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on", "allow", "allowed"].includes(normalized)) return true;
    if (["false", "no", "n", "0", "off", "deny", "denied", "disallow", "disallowed"].includes(normalized)) return false;
  }
  return null;
}

function billPartialSheet(input: {
  pieceW: number;
  pieceH: number;
  partialPieces: number;
  sheetWidth: number;
  usableDropMin: number;
  billableLengthIncrement: number;
  minimumBillableSqft: number;
}): { billableSqft: number; policy: PartialSheetPolicy } {
  if (input.partialPieces <= 0) return { billableSqft: 0, policy: "none" };

  const piecesAcross = Math.floor(input.sheetWidth / input.pieceW);
  if (piecesAcross <= 0) return { billableSqft: Infinity, policy: "measured_partial_sheet" };

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
  const measuredSqft = (effectiveWidth * billableLength) / 144;
  const policy = input.minimumBillableSqft > measuredSqft
    ? "minimum_billable_sqft"
    : "measured_partial_sheet";

  return {
    billableSqft: Math.ceil(Math.max(measuredSqft, input.minimumBillableSqft)),
    policy,
  };
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
  allowRotation: boolean | string | number | null | undefined = false,
  allowRotationSource?: string | null,
): SheetYieldResult {
  assertPositiveFinite(w, "piece width");
  assertPositiveFinite(h, "piece height");
  assertPositiveFinite(q, "quantity");
  assertPositiveFinite(sheetWidth, "sheet_width");
  assertPositiveFinite(sheetLength, "sheet_length");

  const normal = orientationYield(w, h, sheetWidth, sheetLength);
  const rotated = orientationYield(h, w, sheetWidth, sheetLength);
  const mixed = mixedRowYield(w, h, sheetWidth, sheetLength);
  const allowRotationResolved = parseFormulaBoolean(allowRotation) ?? false;
  let chosen = normal;
  let pieceW = w;
  let pieceH = h;
  let orientationUsed: SheetYieldOrientation = "normal";
  let mixedLayoutDescription: string | null = null;

  if (allowRotationResolved) {
    if (rotated.piecesPerSheet > chosen.piecesPerSheet) {
      chosen = rotated;
      pieceW = h;
      pieceH = w;
      orientationUsed = "rotated";
    }
    if (mixed.piecesPerSheet > chosen.piecesPerSheet) {
      chosen = {
        piecesAcross: normal.piecesAcross,
        rowsPerSheet: normal.rowsPerSheet,
        piecesPerSheet: mixed.piecesPerSheet,
      };
      pieceW = w;
      pieceH = h;
      orientationUsed = "mixed";
      mixedLayoutDescription = mixed.description;
    }
  }

  if (chosen.piecesPerSheet <= 0) {
    throw new Error(
      allowRotationResolved
        ? `sheet_consumption_sqft: piece ${w}x${h} exceeds sheet ${sheetWidth}x${sheetLength} in both orientations`
        : `sheet_consumption_sqft: piece ${w}x${h} exceeds sheet ${sheetWidth}x${sheetLength} without rotation`,
    );
  }

  const quantity = Math.ceil(q);
  const fullSheets = Math.floor(quantity / chosen.piecesPerSheet);
  const partialSheetPieceCount = quantity % chosen.piecesPerSheet;
  const totalSheetCount = fullSheets + (partialSheetPieceCount > 0 ? 1 : 0);
  const sheetSqft = (sheetWidth * sheetLength) / 144;
  const partialSheetFinishedSqft = (partialSheetPieceCount * w * h) / 144;
  const partialSheet = billPartialSheet({
    pieceW,
    pieceH,
    partialPieces: partialSheetPieceCount,
    sheetWidth,
    usableDropMin,
    billableLengthIncrement,
    minimumBillableSqft,
  });
  const partialSheetBillableSqft = partialSheet.billableSqft;
  const billedSheetSqft = Math.ceil(fullSheets * sheetSqft + partialSheetBillableSqft);

  return {
    sheetUsageMethod: "layout_yield",
    allowRotation: allowRotationResolved,
    allowRotationSource: allowRotationSource ?? null,
    normalPiecesPerSheet: normal.piecesPerSheet,
    rotatedPiecesPerSheet: rotated.piecesPerSheet,
    mixedPiecesPerSheet: mixed.piecesPerSheet,
    piecesPerSheet: chosen.piecesPerSheet,
    orientationUsed,
    mixedLayoutDescription,
    fullSheets,
    partialSheetPieceCount,
    partialSheetFinishedSqft,
    partialSheetBillableSqft,
    partialSheetPolicy: partialSheet.policy,
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
  allowRotation: boolean | string | number | null | undefined = false,
  allowRotationSource?: string | null,
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
    allowRotation,
    allowRotationSource,
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
      allow_rotation?: unknown,
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
        allow_rotation as string | number | boolean | null | undefined,
      ),
  };
}
