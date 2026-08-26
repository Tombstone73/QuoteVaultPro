export type MediaFitStatus = "fits_single_piece" | "paneling_required" | "invalid" | "unknown";
export type MediaFitMediaType = "sheet" | "roll";

export type MediaFitSnapshot = {
  status: MediaFitStatus;
  mediaType: MediaFitMediaType | null;
  finishedWidthIn: number | null;
  finishedHeightIn: number | null;
  sheetWidthIn: number | null;
  sheetHeightIn: number | null;
  printableWidthIn: number | null;
  allowRotation: boolean;
  fittingOrientation: "normal" | "rotated" | null;
};

export type MediaFitInput = {
  finishedWidthIn?: unknown;
  finishedHeightIn?: unknown;
  mediaType?: unknown;
  sheetWidthIn?: unknown;
  sheetHeightIn?: unknown;
  printableWidthIn?: unknown;
  allowRotation?: unknown;
  productionAllowanceXIn?: unknown;
};

const finitePositive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const finiteNonNegative = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function resolveMediaType(value: unknown): MediaFitMediaType | null {
  return value === "sheet" || value === "roll" ? value : null;
}

/**
 * Classifies one finished item against the configured single-piece media.
 * It deliberately says nothing about panel layout, quantity, artwork tiling,
 * or price: a paneling-required result is an operational warning, not a plan.
 */
export function assessMediaFit(input: MediaFitInput): MediaFitSnapshot {
  const finishedWidthIn = finitePositive(input.finishedWidthIn);
  const finishedHeightIn = finitePositive(input.finishedHeightIn);
  const mediaType = resolveMediaType(input.mediaType);
  const sheetWidthIn = finitePositive(input.sheetWidthIn);
  const sheetHeightIn = finitePositive(input.sheetHeightIn);
  const printableWidthIn = finitePositive(input.printableWidthIn);
  const allowRotation = input.allowRotation === true || input.allowRotation === 1 || input.allowRotation === "true" || input.allowRotation === "1";

  const base: Omit<MediaFitSnapshot, "status" | "fittingOrientation"> = {
    mediaType,
    finishedWidthIn,
    finishedHeightIn,
    sheetWidthIn,
    sheetHeightIn,
    printableWidthIn,
    allowRotation,
  };

  if (!finishedWidthIn || !finishedHeightIn) {
    return { ...base, status: "invalid", fittingOrientation: null };
  }

  if (mediaType === "sheet") {
    if (!sheetWidthIn || !sheetHeightIn) return { ...base, status: "unknown", fittingOrientation: null };
    if (finishedWidthIn <= sheetWidthIn && finishedHeightIn <= sheetHeightIn) {
      return { ...base, status: "fits_single_piece", fittingOrientation: "normal" };
    }
    if (allowRotation && finishedWidthIn <= sheetHeightIn && finishedHeightIn <= sheetWidthIn) {
      return { ...base, status: "fits_single_piece", fittingOrientation: "rotated" };
    }
    return { ...base, status: "paneling_required", fittingOrientation: null };
  }

  if (mediaType === "roll") {
    if (!printableWidthIn) return { ...base, status: "unknown", fittingOrientation: null };
    const crossRollAllowance = finiteNonNegative(input.productionAllowanceXIn);
    if (finishedWidthIn + crossRollAllowance <= printableWidthIn) {
      return { ...base, status: "fits_single_piece", fittingOrientation: "normal" };
    }
    if (allowRotation && finishedHeightIn + crossRollAllowance <= printableWidthIn) {
      return { ...base, status: "fits_single_piece", fittingOrientation: "rotated" };
    }
    return { ...base, status: "paneling_required", fittingOrientation: null };
  }

  return { ...base, status: "unknown", fittingOrientation: null };
}

export function getMediaFitWarning(snapshot: unknown): { title: string; description: string } | null {
  const value = snapshot && typeof snapshot === "object" ? snapshot as Partial<MediaFitSnapshot> : null;
  if (value?.status !== "paneling_required") return null;

  const finished = Number(value.finishedWidthIn) > 0 && Number(value.finishedHeightIn) > 0
    ? `Finished: ${value.finishedWidthIn} × ${value.finishedHeightIn} in`
    : null;
  const available = value.mediaType === "roll" && Number(value.printableWidthIn) > 0
    ? `Available printable width: ${value.printableWidthIn} in`
    : value.mediaType === "sheet" && Number(value.sheetWidthIn) > 0 && Number(value.sheetHeightIn) > 0
      ? `Available sheet: ${value.sheetWidthIn} × ${value.sheetHeightIn} in`
      : null;

  return {
    title: "OVERSIZED FOR MEDIA",
    description: [
      "This finished size exceeds the available single-piece media size. Production will require multiple panels/seams.",
      finished,
      available,
    ].filter(Boolean).join(" "),
  };
}
