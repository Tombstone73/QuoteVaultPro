import { calculateSheetYield, parseFormulaBoolean, type SheetYieldOrientation } from "./pbv2/formulaHelpers";

export type ProductionSides = "Single-sided" | "Double-sided" | "Unknown";

export type ProductionOption = {
  optionId?: string;
  optionName?: string;
  optionLabel?: string;
  label?: string;
  value?: unknown;
  selectedLabel?: string;
};

export type ProductionArtworkAssignment = {
  id?: string | null;
  fileRecordId?: string | null;
  side?: string | null;
};

export type SheetProductionLayout = {
  sheetWidthIn: number;
  sheetHeightIn: number;
  piecesPerSheet: number;
  sheetsToPrint: number;
  printPasses: number;
  orientation: SheetYieldOrientation;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const finitePositive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalize = (value: unknown): string => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[\s_-]+/g, " ");

const readOptionCandidates = (lineItem: any): ProductionOption[] => {
  const snapshot = asRecord(lineItem?.pbv2SnapshotJson);
  const selected = [
    ...(Array.isArray(lineItem?.selectedOptions) ? lineItem.selectedOptions : []),
    ...(Array.isArray(snapshot?.selectedOptions) ? snapshot.selectedOptions as ProductionOption[] : []),
  ];

  const selections = asRecord(lineItem?.optionSelectionsJson)?.selected
    ?? asRecord(lineItem?.optionSelectionsJson)
    ?? asRecord(snapshot?.selections);
  if (!selections) return selected;

  for (const [key, value] of Object.entries(selections)) {
    // Inbound/PBV2 selections are stored as `{ value, label }` entries. Read
    // their scalar value so production does not mistake the object itself for
    // an unknown option value during hydration.
    const entry = asRecord(value);
    selected.push({
      optionId: key,
      optionName: key,
      value: entry?.value ?? value,
      selectedLabel: typeof entry?.label === "string" ? entry.label : undefined,
    });
  }
  return selected;
};

/** Resolves the ordered print-side choice without making an artwork-count guess. */
export function resolveProductionSides(lineItem: any): ProductionSides {
  for (const option of readOptionCandidates(lineItem)) {
    const label = normalize(option.optionName ?? option.optionLabel ?? option.label ?? option.optionId);
    const value = normalize(option.selectedLabel ?? option.value);
    const looksLikeSides = /\b(side|sides|print sides|printed sides)\b/.test(label)
      || /\b(single sided|double sided|one sided|two sided|1 sided|2 sided|1s|2s|ss|ds)\b/.test(value);
    if (!looksLikeSides) continue;
    if (/\b(double|two|2 sided|2s|ds)\b/.test(value)) return "Double-sided";
    if (/\b(single|one|1 sided|1s|ss)\b/.test(value)) return "Single-sided";
  }
  return "Unknown";
}

/**
 * Calculates flat-sheet workload from the ordered finished size and the configured
 * PBV2/product sheet. It deliberately returns null when the source is incomplete,
 * rather than assuming a sheet or a layout.
 */
export function calculateSheetProductionLayout(input: {
  stationKey?: unknown;
  materialType?: unknown;
  widthIn?: unknown;
  heightIn?: unknown;
  quantity?: unknown;
  sheetWidthIn?: unknown;
  sheetHeightIn?: unknown;
  allowRotation?: unknown;
  sides?: ProductionSides;
}): SheetProductionLayout | null {
  const station = normalize(input.stationKey);
  const materialType = normalize(input.materialType);
  if (station !== "flatbed" || materialType === "roll") return null;

  const width = finitePositive(input.widthIn);
  const height = finitePositive(input.heightIn);
  const quantity = finitePositive(input.quantity);
  const sheetWidth = finitePositive(input.sheetWidthIn);
  const sheetHeight = finitePositive(input.sheetHeightIn);
  if (!width || !height || !quantity || !sheetWidth || !sheetHeight) return null;

  let sheetYield;
  try {
    // Reuse PBV2's canonical yield logic. Billing-specific values do not affect
    // finished sheet count, but keep this production calculation deterministic.
    sheetYield = calculateSheetYield(
      width, height, quantity, sheetWidth, sheetHeight,
      0, 1, 0, parseFormulaBoolean(input.allowRotation) ?? false,
      "production configuration",
    );
  } catch {
    return null;
  }
  const piecesPerSheet = sheetYield.piecesPerSheet;
  const sheetsToPrint = sheetYield.totalSheetCount;
  const sideCount = input.sides === "Double-sided" ? 2 : 1;
  return {
    sheetWidthIn: sheetWidth,
    sheetHeightIn: sheetHeight,
    piecesPerSheet,
    sheetsToPrint,
    printPasses: sheetsToPrint * sideCount,
    orientation: sheetYield.orientationUsed,
  };
}

/** Selects the snapshot configuration first so production stays tied to what was ordered. */
export function resolveSheetConfiguration(input: {
  pbv2SnapshotJson?: unknown;
  pricingProfileConfig?: unknown;
  sheetWidth?: unknown;
  sheetHeight?: unknown;
  materialType?: unknown;
}): { sheetWidthIn: number | null; sheetHeightIn: number | null; materialType: string | null; allowRotation: unknown } {
  const snapshot = asRecord(input.pbv2SnapshotJson);
  const snapshotMeta = asRecord(asRecord(snapshot?.treeJson)?.meta);
  const snapshotConfig = asRecord(snapshotMeta?.pricingProfileConfig);
  const productConfig = asRecord(input.pricingProfileConfig);
  const config = snapshotConfig ?? productConfig;
  const formulaVariables = asRecord(config?.formulaVariables);

  return {
    sheetWidthIn: finitePositive(config?.sheetWidth ?? formulaVariables?.sheet_width ?? input.sheetWidth),
    sheetHeightIn: finitePositive(config?.sheetHeight ?? formulaVariables?.sheet_length ?? formulaVariables?.sheet_height ?? input.sheetHeight),
    materialType: String(config?.materialType ?? input.materialType ?? "").trim() || null,
    allowRotation: config?.allowRotation ?? formulaVariables?.allow_rotation ?? false,
  };
}

export function resolveProductionPreviewUrl(art: {
  thumbnailUrl?: unknown;
  thumbUrl?: unknown;
  thumbKey?: unknown;
  previewUrl?: unknown;
  previewKey?: unknown;
  fileUrl?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
} | null | undefined): string | undefined {
  if (!art) return undefined;
  const thumbnail = String(art.thumbnailUrl ?? "").trim();
  if (thumbnail) return thumbnail;
  const thumbUrl = String(art.thumbUrl ?? "").trim();
  if (thumbUrl) return thumbUrl;
  const thumbKey = String(art.thumbKey ?? "").trim();
  if (thumbKey) return thumbKey.startsWith("/") ? thumbKey : `/objects/${thumbKey.replace(/^\/+/, "")}`;
  // A preview derivative is an image representation (including PDF page
  // previews). Use it only after an explicit thumbnail/thumbnail key.
  const previewUrl = String(art.previewUrl ?? "").trim();
  if (previewUrl) return previewUrl;
  const previewKey = String(art.previewKey ?? "").trim();
  if (previewKey) return previewKey.startsWith("/") ? previewKey : `/objects/${previewKey.replace(/^\/+/, "")}`;
  const fileUrl = String(art.fileUrl ?? "").trim();
  const imageByMime = String(art.mimeType ?? "").toLowerCase().startsWith("image/");
  const imageByName = /\.(avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:\?|$)/i.test(String(art.fileName ?? fileUrl));
  return fileUrl && (imageByMime || imageByName) ? fileUrl : undefined;
}

/**
 * Resolves Front and Back strictly from explicit side metadata. It deliberately
 * never uses attachment order as an assignment signal. `both` supports an
 * in-flight inbound draft before it is materialized as separate front/back
 * order attachment mappings.
 */
export function resolveProductionArtworkSides<T extends ProductionArtworkAssignment>(artwork: T[] | null | undefined): {
  front: T | null;
  back: T | null;
  unassigned: T[];
  isSameArtwork: boolean;
} {
  const list = Array.isArray(artwork) ? artwork : [];
  const sideOf = (item: T) => normalize(item.side);
  const both = list.filter((item) => sideOf(item) === "both");
  const front = list.find((item) => sideOf(item) === "front") ?? both[0] ?? null;
  const back = list.find((item) => sideOf(item) === "back") ?? both[0] ?? null;
  const unassigned = list.filter((item) => !["front", "back", "both"].includes(sideOf(item)));
  const isSameArtwork = Boolean(
    front && back && (
      front === back ||
      (front.fileRecordId && front.fileRecordId === back.fileRecordId) ||
      (front.id && front.id === back.id)
    ),
  );
  return { front, back, unassigned, isSameArtwork };
}
