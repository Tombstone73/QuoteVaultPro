export type RollMediaOrientation = "normal" | "rotated";

export type RollMediaLayoutInput = {
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
  physicalRollWidthIn?: number | null;
  printableWidthIn?: number | null;
  edgeWasteInPerSide?: number | null;
  productionAllowanceXIn?: number | null;
  productionAllowanceYIn?: number | null;
  registrationWasteIn?: number | null;
  billingWidthIncrementIn: number;
  billingLengthIncrementIn: number;
  allowRotation?: boolean | string | number | null;
  materialId?: string | null;
  materialName?: string | null;
};

export type RollMediaLayoutResult = {
  orientation: RollMediaOrientation;
  finishedWidthIn: number;
  finishedHeightIn: number;
  productionWidthIn: number;
  productionLengthIn: number;
  physicalRollWidthIn: number | null;
  printableWidthIn: number;
  edgeWasteInPerSide: number | null;
  piecesAcross: number;
  rowsRequired: number;
  occupiedProductionWidthIn: number;
  unusedPrintableWidthIn: number;
  rawBillingLengthIn: number;
  billingPanelWidthIn: number;
  billingLengthIn: number;
  billableSqft: number;
  registrationWasteIn: number;
  actualConsumedLengthIn: number;
  actualConsumedLinearFeet: number;
  allowRotation: boolean;
  materialId: string | null;
  materialName: string | null;
};

export type RollMediaLayoutFailureCode =
  | "INVALID_QUANTITY"
  | "INVALID_DIMENSIONS"
  | "PRINTABLE_WIDTH_MISSING"
  | "INVALID_BILLING_INCREMENT"
  | "NO_USABLE_PRINTABLE_WIDTH"
  | "PRODUCTION_WIDTH_EXCEEDS_PRINTABLE_WIDTH";

export class RollMediaLayoutError extends Error {
  code: RollMediaLayoutFailureCode;

  constructor(code: RollMediaLayoutFailureCode, message: string) {
    super(message);
    this.name = "RollMediaLayoutError";
    this.code = code;
  }
}

const finitePositive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const finiteNonNegative = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const round6 = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;

const parseRollLayoutBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
};

export function deriveRollPrintableWidth(input: {
  physicalRollWidthIn?: number | string | null;
  edgeWasteInPerSide?: number | string | null;
  printableWidthIn?: number | string | null;
}): number | null {
  const explicitPrintable = finitePositive(input.printableWidthIn);
  if (explicitPrintable) return explicitPrintable;

  const physicalWidth = finitePositive(input.physicalRollWidthIn);
  if (!physicalWidth) return null;
  const edgeWaste = finiteNonNegative(input.edgeWasteInPerSide, 0);
  const printable = physicalWidth - edgeWaste * 2;
  return Number.isFinite(printable) && printable > 0 ? printable : null;
}

function calculateOrientation(input: RollMediaLayoutInput, orientation: RollMediaOrientation): RollMediaLayoutResult {
  const quantity = Math.ceil(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RollMediaLayoutError("INVALID_QUANTITY", "Roll nesting quantity must be greater than zero.");
  }

  const finishedWidth = finitePositive(input.finishedWidthIn);
  const finishedHeight = finitePositive(input.finishedHeightIn);
  if (!finishedWidth || !finishedHeight) {
    throw new RollMediaLayoutError("INVALID_DIMENSIONS", "Roll nesting requires positive finished width and height.");
  }

  const billingWidthIncrement = finitePositive(input.billingWidthIncrementIn);
  const billingLengthIncrement = finitePositive(input.billingLengthIncrementIn);
  if (!billingWidthIncrement || !billingLengthIncrement) {
    throw new RollMediaLayoutError("INVALID_BILLING_INCREMENT", "Roll nesting billing increments must be greater than zero.");
  }

  const physicalRollWidth = finitePositive(input.physicalRollWidthIn);
  const edgeWaste = input.edgeWasteInPerSide == null ? null : finiteNonNegative(input.edgeWasteInPerSide, 0);
  const printableWidth = deriveRollPrintableWidth({
    physicalRollWidthIn: physicalRollWidth,
    edgeWasteInPerSide: edgeWaste,
    printableWidthIn: input.printableWidthIn,
  });
  if (!printableWidth) {
    throw new RollMediaLayoutError("PRINTABLE_WIDTH_MISSING", "Roll nesting requires a positive printable width.");
  }

  const productionAllowanceX = finiteNonNegative(input.productionAllowanceXIn, 0);
  const productionAllowanceY = finiteNonNegative(input.productionAllowanceYIn, 0);
  const registrationWaste = finiteNonNegative(input.registrationWasteIn, 0);
  const widthForOrientation = orientation === "rotated" ? finishedHeight : finishedWidth;
  const lengthForOrientation = orientation === "rotated" ? finishedWidth : finishedHeight;
  const productionWidth = widthForOrientation + productionAllowanceX;
  const productionLength = lengthForOrientation + productionAllowanceY;
  if (productionWidth <= 0 || productionLength <= 0) {
    throw new RollMediaLayoutError("INVALID_DIMENSIONS", "Roll nesting production dimensions must be greater than zero.");
  }

  if (printableWidth <= 0) {
    throw new RollMediaLayoutError("NO_USABLE_PRINTABLE_WIDTH", "Roll material geometry leaves no usable printable width.");
  }
  if (productionWidth > printableWidth) {
    throw new RollMediaLayoutError(
      "PRODUCTION_WIDTH_EXCEEDS_PRINTABLE_WIDTH",
      `Roll nesting production width ${productionWidth} exceeds printable width ${printableWidth}.`,
    );
  }

  const piecesAcross = Math.floor(printableWidth / productionWidth);
  if (piecesAcross <= 0) {
    throw new RollMediaLayoutError("PRODUCTION_WIDTH_EXCEEDS_PRINTABLE_WIDTH", "Roll nesting produced zero pieces across.");
  }

  const rowsRequired = Math.ceil(quantity / piecesAcross);
  const piecesInFirstRow = Math.min(quantity, piecesAcross);
  const occupiedProductionWidthIn = piecesInFirstRow * productionWidth;
  const rawBillingLengthIn = rowsRequired * lengthForOrientation;
  const billingPanelWidthIn = Math.ceil(occupiedProductionWidthIn / billingWidthIncrement) * billingWidthIncrement;
  const billingLengthIn = Math.ceil(rawBillingLengthIn / billingLengthIncrement) * billingLengthIncrement;
  const actualConsumedLengthIn = rowsRequired * productionLength + registrationWaste;

  return {
    orientation,
    finishedWidthIn: finishedWidth,
    finishedHeightIn: finishedHeight,
    productionWidthIn: round6(productionWidth),
    productionLengthIn: round6(productionLength),
    physicalRollWidthIn: physicalRollWidth,
    printableWidthIn: round6(printableWidth),
    edgeWasteInPerSide: edgeWaste,
    piecesAcross,
    rowsRequired,
    occupiedProductionWidthIn: round6(occupiedProductionWidthIn),
    unusedPrintableWidthIn: round6(printableWidth - occupiedProductionWidthIn),
    rawBillingLengthIn: round6(rawBillingLengthIn),
    billingPanelWidthIn: round6(billingPanelWidthIn),
    billingLengthIn: round6(billingLengthIn),
    billableSqft: round6((billingPanelWidthIn * billingLengthIn) / 144),
    registrationWasteIn: round6(registrationWaste),
    actualConsumedLengthIn: round6(actualConsumedLengthIn),
    actualConsumedLinearFeet: round6(actualConsumedLengthIn / 12),
    allowRotation: parseRollLayoutBoolean(input.allowRotation) ?? false,
    materialId: typeof input.materialId === "string" && input.materialId.trim() ? input.materialId.trim() : null,
    materialName: typeof input.materialName === "string" && input.materialName.trim() ? input.materialName.trim() : null,
  };
}

export function calculateRollMediaLayout(input: RollMediaLayoutInput): RollMediaLayoutResult {
  let normal: RollMediaLayoutResult | null = null;
  let normalError: unknown = null;
  try {
    normal = calculateOrientation(input, "normal");
  } catch (error) {
    normalError = error;
  }
  if (!(parseRollLayoutBoolean(input.allowRotation) ?? false)) {
    if (normal) return normal;
    throw normalError;
  }

  let rotated: RollMediaLayoutResult | null = null;
  try {
    rotated = calculateOrientation(input, "rotated");
  } catch {
    rotated = null;
  }

  if (!normal && rotated) return rotated;
  if (!normal && !rotated) throw normalError;
  if (!rotated) return normal;
  if (rotated.actualConsumedLengthIn < normal.actualConsumedLengthIn) return rotated;
  if (rotated.actualConsumedLengthIn > normal.actualConsumedLengthIn) return normal;
  if (rotated.billableSqft < normal.billableSqft) return rotated;
  return normal;
}

export function rollNestingBillableSqft(
  finishedWidthIn: number,
  finishedHeightIn: number,
  quantity: number,
  printableWidthIn: number,
  productionAllowanceXIn: number,
  productionAllowanceYIn: number,
  billingWidthIncrementIn: number,
  billingLengthIncrementIn: number,
  allowRotation?: boolean | string | number | null,
): number {
  try {
    return calculateRollMediaLayout({
      finishedWidthIn,
      finishedHeightIn,
      quantity,
      printableWidthIn,
      productionAllowanceXIn,
      productionAllowanceYIn,
      registrationWasteIn: 0,
      billingWidthIncrementIn,
      billingLengthIncrementIn,
      allowRotation,
    }).billableSqft;
  } catch (error) {
    if (!(error instanceof RollMediaLayoutError) || error.code !== "PRODUCTION_WIDTH_EXCEEDS_PRINTABLE_WIDTH") {
      throw error;
    }
    // A panel layout is not calculated here. Keep the existing area-rate
    // formula usable for the valid finished size and let the order snapshot
    // carry the explicit operational panel/seam warning.
    return (finishedWidthIn * finishedHeightIn * Math.ceil(quantity)) / 144;
  }
}
