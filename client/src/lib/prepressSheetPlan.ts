export type PrepressSheetPlanLayout = {
  sheetWidthIn?: number | null;
  sheetHeightIn?: number | null;
  allowRotation?: boolean | null;
  sideCount?: number | null;
  normalPiecesPerSheet?: number | null;
  rotatedPiecesPerSheet?: number | null;
  mixedPiecesPerSheet?: number | null;
  piecesPerSheet?: number | null;
  fullSheets?: number | null;
  partialSheetPieces?: number | null;
  sheetsToPrint?: number | null;
  totalSheetCount?: number | null;
  printPasses?: number | null;
  orientation?: "normal" | "rotated" | "mixed" | string | null;
  mixedLayoutDescription?: string | null;
};

export type PrepressSheetPlanDisplay = {
  primary: string;
  secondary: string;
  impressions: string;
  sheetSize: string;
  layoutDetails: string[];
};

const finitePositive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const formatCount = (value: number, singular: string, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`;

const formatInches = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");

const orientationLabel = (orientation: unknown): string => {
  if (orientation === "mixed") return "Mixed orientation";
  if (orientation === "rotated") return "Rotated orientation";
  if (orientation === "normal") return "Normal orientation";
  return "Orientation unavailable";
};

export function buildPrepressSheetPlanDisplay(input: {
  layout: PrepressSheetPlanLayout | null | undefined;
  quantity?: number | null;
}): PrepressSheetPlanDisplay | null {
  const layout = input.layout;
  if (!layout) return null;

  const sheets = finitePositive(layout.sheetsToPrint ?? layout.totalSheetCount);
  const piecesPerSheet = finitePositive(layout.piecesPerSheet);
  const quantity = finitePositive(input.quantity);
  const printPasses = finitePositive(layout.printPasses);
  const sideCount = finitePositive(layout.sideCount) ?? 1;
  const sheetWidth = finitePositive(layout.sheetWidthIn);
  const sheetHeight = finitePositive(layout.sheetHeightIn);
  if (!sheets || !piecesPerSheet || !printPasses || !sheetWidth || !sheetHeight) return null;

  const fullSheets = finiteNonNegative(layout.fullSheets) ?? Math.floor((quantity ?? 0) / piecesPerSheet);
  const partialPieces = finiteNonNegative(layout.partialSheetPieces) ?? 0;
  const partialLabel = partialPieces > 0
    ? `${formatCount(fullSheets, "full sheet")} + 1 partial (${formatCount(partialPieces, "piece")})`
    : `${formatCount(fullSheets, "full sheet")} + no partial`;
  const rotationLabel = layout.allowRotation ? "Rotation allowed" : "Rotation disabled";

  const layoutDetails = [
    `${formatInches(sheetWidth)} x ${formatInches(sheetHeight)} sheet`,
    `${formatCount(finitePositive(layout.normalPiecesPerSheet) ?? piecesPerSheet, "normal piece")} per sheet`,
  ];
  const rotated = finitePositive(layout.rotatedPiecesPerSheet);
  if (rotated) layoutDetails.push(`${formatCount(rotated, "rotated piece")} per sheet`);
  const mixed = finitePositive(layout.mixedPiecesPerSheet);
  if (mixed) layoutDetails.push(`${formatCount(mixed, "mixed-layout piece")} per sheet`);
  if (layout.mixedLayoutDescription) layoutDetails.push(layout.mixedLayoutDescription);

  return {
    primary: `${formatCount(sheets, "sheet")} - ${piecesPerSheet}-up${quantity ? ` - ${formatCount(quantity, "piece")}` : ""}`,
    secondary: `${partialLabel} - ${orientationLabel(layout.orientation)} - ${rotationLabel}`,
    impressions: sideCount > 1
      ? `${formatCount(printPasses, "sheet impression")} / ${formatCount(sideCount, "side")}`
      : `${formatCount(printPasses, "sheet impression")} / single-sided`,
    sheetSize: `${formatInches(sheetWidth)} x ${formatInches(sheetHeight)}`,
    layoutDetails,
  };
}

export function formatPrepressSheetPlanUnavailableReason(reason: unknown): string | null {
  if (reason === "missing_dimensions") return "Missing finished size or quantity.";
  if (reason === "missing_sheet_configuration") return "Missing sheet size configuration.";
  if (reason === "layout_error") return "The finished size does not fit the configured sheet.";
  return null;
}
