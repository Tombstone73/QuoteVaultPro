/**
 * Physical-dimension rules shared by inbound review pricing and artwork
 * comparison. Inbound drafts retain the entered numbers and unit; these
 * helpers derive inch-based facts for consumers that require them.
 */
export type InboundPhysicalDimensions = {
  actualWidthIn: number;
  actualHeightIn: number;
};

export type InboundBillableDimensions = InboundPhysicalDimensions & {
  billableWidthIn: number;
  billableHeightIn: number;
  billableSquareFeet: number;
};

const UNIT_TO_INCHES: Record<string, number> = {
  in: 1,
  inch: 1,
  inches: 1,
  '"': 1,
  ft: 12,
  foot: 12,
  feet: 12,
  "'": 12,
  mm: 1 / 25.4,
  cm: 1 / 2.54,
};

function numericDimension(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

/**
 * Historical inbound drafts did not always persist a unit. Treat a missing or
 * unknown unit as legacy inches rather than reinterpret stored dimensions.
 */
export function normalizeInboundDimensionsToInches(input: {
  width: unknown;
  height: unknown;
  unit?: unknown;
}): InboundPhysicalDimensions {
  const unit = String(input.unit ?? "in").trim().toLowerCase();
  const multiplier = UNIT_TO_INCHES[unit] ?? 1;
  return {
    actualWidthIn: numericDimension(input.width) * multiplier,
    actualHeightIn: numericDimension(input.height) * multiplier,
  };
}

/**
 * PrintersHero whole-foot billing rounds each physical dimension up before
 * calculating area. It intentionally does not mutate the actual dimensions.
 */
export function wholeFootBillableDimensions(input: InboundPhysicalDimensions): InboundBillableDimensions {
  const billableWidthIn = Number.isFinite(input.actualWidthIn) && input.actualWidthIn > 0
    ? Math.ceil(input.actualWidthIn / 12) * 12
    : input.actualWidthIn;
  const billableHeightIn = Number.isFinite(input.actualHeightIn) && input.actualHeightIn > 0
    ? Math.ceil(input.actualHeightIn / 12) * 12
    : input.actualHeightIn;
  return {
    ...input,
    billableWidthIn,
    billableHeightIn,
    billableSquareFeet: Number.isFinite(billableWidthIn) && Number.isFinite(billableHeightIn)
      ? (billableWidthIn * billableHeightIn) / 144
      : Number.NaN,
  };
}

/** PDF page metadata is inches; accept equivalent orientation within a small metadata tolerance. */
export function inboundDimensionsMatchPdf(input: {
  enteredWidth: unknown;
  enteredHeight: unknown;
  enteredUnit?: unknown;
  pdfWidthIn: unknown;
  pdfHeightIn: unknown;
  toleranceIn?: number;
}): boolean {
  const { actualWidthIn, actualHeightIn } = normalizeInboundDimensionsToInches({
    width: input.enteredWidth,
    height: input.enteredHeight,
    unit: input.enteredUnit,
  });
  const pdfWidthIn = numericDimension(input.pdfWidthIn);
  const pdfHeightIn = numericDimension(input.pdfHeightIn);
  const toleranceIn = input.toleranceIn ?? 0.01;
  if (![actualWidthIn, actualHeightIn, pdfWidthIn, pdfHeightIn].every(Number.isFinite)) return false;
  const matches = (left: number, right: number) => Math.abs(left - right) <= toleranceIn;
  return (matches(actualWidthIn, pdfWidthIn) && matches(actualHeightIn, pdfHeightIn))
    || (matches(actualWidthIn, pdfHeightIn) && matches(actualHeightIn, pdfWidthIn));
}
