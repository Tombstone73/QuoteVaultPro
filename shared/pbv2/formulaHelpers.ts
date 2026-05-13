/**
 * Pure formula helper functions shared between the server evaluator (PricingService)
 * and the client-side formula tester (pricing-formulas settings page).
 *
 * All functions must be side-effect free and importable in both environments.
 */

/**
 * Calculates billable square footage for sheet or roll material consumption.
 *
 * Tests both normal (w×h) and rotated (h×w) piece orientations and picks
 * whichever uses less material. Applies the reusable-drop rule: when the
 * side strip remaining after pieces is narrower than usableDropMin it is
 * treated as waste and the full sheet width is charged; otherwise only the
 * occupied width is charged. Consumed length is rounded up to the nearest
 * billableLengthIncrement. Returns at least minimumBillableSqft.
 *
 * Throws an Error if the piece cannot physically fit the sheet in either
 * orientation — callers should surface this as a formula evaluation error.
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
  function computeOrientation(pieceW: number, pieceH: number): number {
    if (pieceW > sheetWidth || pieceH > sheetLength) return Infinity;
    const piecesAcross = Math.floor(sheetWidth / pieceW);
    if (piecesAcross === 0) return Infinity;
    const rowsNeeded = Math.ceil(q / piecesAcross);
    const consumedLength = rowsNeeded * pieceH;
    const inc = billableLengthIncrement > 0 ? billableLengthIncrement : 1;
    const billableLength = Math.ceil(consumedLength / inc) * inc;
    // Use the actual occupied width of the final row for the reusable-drop check.
    // When there are no full rows (fullRows===0) the job fits entirely in one partial
    // row; bill only for the pieces actually placed.  When at least one full row
    // exists, those rows set the dominant width.
    const fullRows = Math.floor(q / piecesAcross);
    const piecesInLastRow = q % piecesAcross;
    const occupiedWidth =
      piecesInLastRow > 0 && fullRows === 0
        ? piecesInLastRow * pieceW
        : piecesAcross * pieceW;
    const drop = sheetWidth - occupiedWidth;
    const effectiveWidth = drop >= usableDropMin ? occupiedWidth : sheetWidth;
    return (effectiveWidth * billableLength) / 144;
  }

  const normalSqft = computeOrientation(w, h);
  const rotatedSqft = computeOrientation(h, w);
  const best = Math.min(normalSqft, rotatedSqft);
  if (!Number.isFinite(best)) {
    throw new Error(
      `sheet_consumption_sqft: piece ${w}×${h} exceeds sheet ${sheetWidth}×${sheetLength} in both orientations`,
    );
  }
  return Math.max(best, minimumBillableSqft);
}

/**
 * Returns the evalScope additions that inject all custom formula helpers into
 * a mathjs evaluate() call.  Pass the result spread into the scope object:
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
