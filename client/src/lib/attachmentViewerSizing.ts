export type PdfFitMode = "page" | "width" | "custom";

export function resolvePdfViewportScale(input: {
  pageWidth: number;
  pageHeight: number;
  stageWidth: number;
  stageHeight: number;
  fitMode: PdfFitMode;
  customScale: number;
  padding?: number;
}): number {
  const padding = Math.max(0, input.padding ?? 32);
  const pageWidth = Math.max(input.pageWidth, 1);
  const pageHeight = Math.max(input.pageHeight, 1);
  const availableWidth = Math.max(input.stageWidth - padding, 120);
  const availableHeight = Math.max(input.stageHeight - padding, 120);
  const fitWidthScale = availableWidth / pageWidth;
  const fitPageScale = Math.min(fitWidthScale, availableHeight / pageHeight);
  const requestedScale = input.fitMode === "width"
    ? fitWidthScale
    : input.fitMode === "page"
      ? fitPageScale
      : input.customScale;

  return Math.min(4, Math.max(0.4, requestedScale));
}

