import { calculateSheetYield, parseFormulaBoolean, type SheetYieldOrientation } from "./pbv2/formulaHelpers";
import { resolveSavedLineItemOptionSelections } from "./lineItemOptionSelections";

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

/** Explains that print passes are sheet impressions derived from sheets and sides. */
export function describeProductionPrintPasses(input: {
  sheetsToPrint: number;
  printPasses: number;
  sides?: unknown;
}): string {
  if (input.sides === "Double-sided") {
    return `Double-sided job: ${input.sheetsToPrint} sheets \u00d7 2 sides (front + back)`;
  }
  if (input.sides === "Single-sided") {
    return `Single-sided job: ${input.sheetsToPrint} sheet${input.sheetsToPrint === 1 ? "" : "s"}`;
  }
  return `${input.printPasses} sheet impression${input.printPasses === 1 ? "" : "s"}`;
}

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

const treeNodes = (lineItem: any): any[] => {
  const snapshot = asRecord(lineItem?.pbv2SnapshotJson);
  const tree = asRecord(snapshot?.treeJson);
  return Array.isArray(tree?.nodes) ? tree.nodes : Object.values(asRecord(tree?.nodes) ?? {});
};

const findSelectionNode = (lineItem: any, selectionKey: string): any | null => {
  const wanted = normalize(selectionKey);
  return treeNodes(lineItem).find((node) => [
    node?.input?.selectionKey,
    node?.selectionKey,
    node?.id,
    node?.key,
    node?.optionId,
  ].some((candidate) => normalize(candidate) === wanted)) ?? null;
};

const choiceLabelForValue = (node: any, value: unknown): string | undefined => {
  const choices = Array.isArray(node?.choices)
    ? node.choices
    : Array.isArray(node?.input?.choices)
      ? node.input.choices
      : [];
  const wanted = normalize(value);
  const choice = choices.find((candidate: any) => [candidate?.value, candidate?.id, candidate?.key]
    .some((entry) => normalize(entry) === wanted));
  const label = choice?.label ?? choice?.name ?? choice?.displayLabel;
  return typeof label === "string" ? label : undefined;
};

const readOptionCandidates = (lineItem: any): ProductionOption[] => {
  const selected: ProductionOption[] = [];
  const snapshot = asRecord(lineItem?.pbv2SnapshotJson);
  const selections = resolveSavedLineItemOptionSelections(lineItem, asRecord(snapshot?.treeJson) as any, {
    includeDefaults: Boolean(snapshot?.treeJson),
  }).selected;

  for (const [key, value] of Object.entries(selections)) {
    // Inbound/PBV2 selections are stored as `{ value, label }` entries. Read
    // their scalar value so production does not mistake the object itself for
    // an unknown option value during hydration.
    const entry = asRecord(value);
    const node = findSelectionNode(lineItem, key);
    const scalarValue = entry?.value ?? value;
    selected.push({
      optionId: key,
      optionName: String(node?.label ?? node?.name ?? key),
      value: scalarValue,
      selectedLabel: typeof entry?.label === "string"
        ? entry.label
        : choiceLabelForValue(node, scalarValue),
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

export function resolveArtworkSideIntent(lineItem: any): {
  useSameArtworkBothSides: boolean;
  sameArtworkFileId: string | null;
} {
  const specs = asRecord(lineItem?.specsJson);
  const assignment = asRecord(specs?.artworkSideAssignment);
  const rawFileId = assignment?.bothFileId ?? assignment?.sharedFileId ?? assignment?.frontFileId ?? assignment?.fileId;
  return {
    useSameArtworkBothSides: assignment?.useSameArtworkBothSides === true,
    sameArtworkFileId: typeof rawFileId === "string" && rawFileId.trim() ? rawFileId.trim() : null,
  };
}

export type ProductionArtworkSideReadiness<T extends ProductionArtworkAssignment> = {
  complete: boolean;
  warning: string | null;
  useSameArtworkBothSides: boolean;
  front: T | null;
  back: T | null;
  both: T | null;
  unassigned: T[];
};

/** Fail-closed readiness for explicit double-sided artwork assignment. */
export function resolveProductionArtworkSideReadiness<T extends ProductionArtworkAssignment>(input: {
  sides: ProductionSides;
  artwork: T[] | null | undefined;
  useSameArtworkBothSides?: boolean;
  sameArtworkFileId?: string | null;
}): ProductionArtworkSideReadiness<T> {
  const list = Array.isArray(input.artwork) ? input.artwork : [];
  const sideOf = (item: T) => normalize(item.side);
  const both = list.find((item) => sideOf(item) === "both") ?? null;
  const explicitFront = list.find((item) => sideOf(item) === "front") ?? null;
  const explicitBack = list.find((item) => sideOf(item) === "back") ?? null;
  const unassigned = list.filter((item) => !["front", "back", "both"].includes(sideOf(item)));
  const same = input.useSameArtworkBothSides === true;

  if (input.sides !== "Double-sided") {
    return {
      complete: true,
      warning: null,
      useSameArtworkBothSides: same,
      front: explicitFront ?? both,
      back: explicitBack ?? (same ? both ?? explicitFront : both),
      both,
      unassigned,
    };
  }

  if (same) {
    const selectedFromIntent = input.sameArtworkFileId
      ? list.find((item) => item.id === input.sameArtworkFileId || item.fileRecordId === input.sameArtworkFileId) ?? null
      : null;
    // A single artwork file plus explicit same-art intent is unambiguous. This
    // also repairs older records whose attachment side was never materialized.
    // Multiple files remain fail-closed until staff chooses one explicitly.
    const soleArtwork = list.length === 1 ? list[0] : null;
    const shared = both ?? explicitFront ?? selectedFromIntent ?? soleArtwork;
    return {
      complete: Boolean(shared),
      warning: shared
        ? null
        : list.length > 1
          ? "Choose which artwork file should be used on both sides."
          : "Choose artwork for both sides before completing prepress.",
      useSameArtworkBothSides: true,
      front: shared,
      back: shared,
      both: shared,
      unassigned,
    };
  }

  const front = explicitFront ?? both;
  const back = explicitBack ?? both;
  const missing = [!front ? "Front" : null, !back ? "Back" : null].filter(Boolean).join(" and ");
  return {
    complete: Boolean(front && back),
    warning: missing ? `${missing} artwork not assigned.` : null,
    useSameArtworkBothSides: false,
    front,
    back,
    both,
    unassigned,
  };
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
