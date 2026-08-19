import type { OptionNodeV2, OptionTreeV2 } from "../optionTreeV2";
import { resolveVisibleNodes } from "../optionTreeV2Runtime";

/**
 * The production-compatible subset of PBV2 choice inventory consumption.  This
 * is deliberately separate from price impacts: it answers physical expected
 * use, never customer price.
 */
export type InventoryConsumptionBasis = "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed";

export type InventoryConsumptionEntry = Readonly<{
  /** Stable within the immutable PBV2 tree version. */
  sourceId: string;
  materialId: string;
  quantityBasis: InventoryConsumptionBasis;
  quantity: number;
  uom: "sqft" | "ft" | "each";
  selectionKey: string;
  selectionValue: string | number | boolean;
  optionLabel: string;
  choiceLabel: string;
}>;

type InventoryConsumption = Readonly<{
  materialId: string;
  quantityBasis: InventoryConsumptionBasis;
  multiplier?: number;
  wastePercent?: number;
  fixedQty?: number;
}>;

export type PlannedMaterial = Readonly<{
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  basis: InventoryConsumptionBasis;
  sources: ReadonlyArray<Readonly<{ optionLabel: string; choiceLabel: string }>>;
}>;

export type PlannedMaterialsResult = Readonly<{
  materials: readonly PlannedMaterial[];
  message?: string;
}>;

const asNodes = (treeJson: OptionTreeV2): OptionNodeV2[] => {
  const nodes = treeJson?.nodes as unknown;
  return Array.isArray(nodes) ? nodes : nodes && typeof nodes === "object" ? Object.values(nodes) as OptionNodeV2[] : [];
};
const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const selectionValue = (value: unknown): unknown => value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
const selectionKey = (node: OptionNodeV2): string => String((node.input as { selectionKey?: unknown } | undefined)?.selectionKey ?? node.id);
const validBasis = (value: unknown): value is InventoryConsumptionBasis => ["area_sqft", "perimeter_ft", "linear_ft", "each", "fixed"].includes(String(value));
const clampWaste = (value: unknown): number => Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
const roundForLegacyPlanning = (quantity: number, uom: "sqft" | "ft" | "each") => uom === "each" ? Math.round(quantity) : Math.round(quantity * 100) / 100;

const quantityFor = (entry: InventoryConsumption, dimensions: Readonly<{ widthIn: number; heightIn: number }>, quantity: number): Readonly<{ quantity: number; uom: "sqft" | "ft" | "each"; needsSize: boolean }> => {
  const multiplier = Number.isFinite(entry.multiplier) && Number(entry.multiplier) > 0 ? Number(entry.multiplier) : 1;
  const waste = 1 + clampWaste(entry.wastePercent) / 100;
  switch (entry.quantityBasis) {
    case "area_sqft": return { quantity: (dimensions.widthIn * dimensions.heightIn / 144) * quantity * multiplier * waste, uom: "sqft", needsSize: true };
    case "perimeter_ft": return { quantity: (2 * (dimensions.widthIn + dimensions.heightIn) / 12) * quantity * multiplier * waste, uom: "ft", needsSize: true };
    case "linear_ft": return { quantity: (Math.max(dimensions.widthIn, dimensions.heightIn) / 12) * quantity * multiplier * waste, uom: "ft", needsSize: true };
    case "each": return { quantity: entry.fixedQty != null ? entry.fixedQty : quantity * multiplier, uom: "each", needsSize: false };
    case "fixed": return { quantity: entry.fixedQty ?? 0, uom: "each", needsSize: false };
  }
};

/**
 * Resolves the established choice.inventoryConsumption contract against the
 * selected, visible PBV2 configuration.  It intentionally preserves V1's
 * quantity rounding (whole each; two decimals for dimensional quantities).
 */
export const resolvePbv2InventoryConsumption = (input: Readonly<{
  tree: OptionTreeV2;
  selections: Readonly<Record<string, unknown>>;
  widthIn?: unknown;
  heightIn?: unknown;
  quantity: unknown;
}>): Readonly<{ entries: readonly InventoryConsumptionEntry[]; missingSize: boolean }> => {
  const selected: Record<string, { value?: unknown }> = {};
  for (const [key, value] of Object.entries(input.selections ?? {})) selected[key] = { value: selectionValue(value) };
  let visible = new Set<string>();
  try { visible = new Set(resolveVisibleNodes(input.tree, { schemaVersion: 2, selected } as never)); } catch { /* Compatibility: V1 planning tolerates a stale visibility graph. */ }
  const widthIn = numberOrNull(input.widthIn), heightIn = numberOrNull(input.heightIn), quantity = Math.max(0, numberOrNull(input.quantity) ?? 0);
  const out: InventoryConsumptionEntry[] = [];
  let missingSize = false;

  for (const node of asNodes(input.tree)) {
    if (!node?.id || (visible.size > 0 && !visible.has(node.id))) continue;
    const key = selectionKey(node);
    const raw = selected[key]?.value ?? selected[node.id]?.value;
    if (raw == null || raw === "") continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
      const choice = (node.choices ?? []).find((candidate) => String(candidate.value) === String(value));
      if (!choice) continue;
      const consumptions = Array.isArray((choice as { inventoryConsumption?: unknown }).inventoryConsumption)
        ? (choice as { inventoryConsumption: unknown[] }).inventoryConsumption : [];
      for (const [index, rawEntry] of consumptions.entries()) {
        const entry = rawEntry as Partial<InventoryConsumption>;
        if (!entry || !String(entry.materialId ?? "").trim() || !validBasis(entry.quantityBasis)) continue;
        const needsSize = entry.quantityBasis === "area_sqft" || entry.quantityBasis === "perimeter_ft" || entry.quantityBasis === "linear_ft";
        if (needsSize && (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0)) { missingSize = true; continue; }
        if (entry.quantityBasis === "fixed" && (!Number.isFinite(entry.fixedQty) || Number(entry.fixedQty) <= 0)) continue;
        const calculated = quantityFor(entry as InventoryConsumption, { widthIn: widthIn ?? 0, heightIn: heightIn ?? 0 }, quantity);
        const resolved = roundForLegacyPlanning(calculated.quantity, calculated.uom);
        if (!Number.isFinite(resolved) || resolved <= 0) continue;
        out.push(Object.freeze({
          sourceId: `${node.id}:${String(choice.value)}:${index}`,
          materialId: String(entry.materialId).trim(), quantityBasis: entry.quantityBasis, quantity: resolved, uom: calculated.uom,
          selectionKey: key, selectionValue: value, optionLabel: String(node.label || key), choiceLabel: String(choice.label || choice.value),
        }));
      }
    }
  }
  return Object.freeze({ entries: Object.freeze(out.sort((left, right) => left.sourceId.localeCompare(right.sourceId))), missingSize });
};

/** Existing Prepress-compatible aggregation API. */
export const computePlannedMaterialsForLineItem = (input: Readonly<{ lineItem: { width?: unknown; height?: unknown; quantity?: unknown; optionSelectionsJson?: unknown }; treeJson: OptionTreeV2 | null | undefined }>): PlannedMaterialsResult => {
  if (!input.lineItem || !input.treeJson || input.treeJson.schemaVersion !== 2) return { materials: [] };
  const raw = input.lineItem.optionSelectionsJson;
  const selections = raw && typeof raw === "object" && "selected" in raw && (raw as { selected?: unknown }).selected && typeof (raw as { selected?: unknown }).selected === "object"
    ? (raw as { selected: Record<string, unknown> }).selected : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const resolved = resolvePbv2InventoryConsumption({ tree: input.treeJson, selections, widthIn: input.lineItem.width, heightIn: input.lineItem.height, quantity: input.lineItem.quantity });
  const grouped = new Map<string, PlannedMaterial>();
  for (const entry of resolved.entries) {
    const key = `${entry.materialId}:${entry.quantityBasis}:${entry.uom}`;
    const prior = grouped.get(key);
    const source = { optionLabel: entry.optionLabel, choiceLabel: entry.choiceLabel };
    grouped.set(key, prior ? { ...prior, qty: prior.qty + entry.quantity, sources: [...prior.sources, source] } : { materialId: entry.materialId, qty: entry.quantity, uom: entry.uom, basis: entry.quantityBasis, sources: [source] });
  }
  return { materials: [...grouped.values()].map((entry) => ({ ...entry, qty: roundForLegacyPlanning(entry.qty, entry.uom) })), ...(resolved.missingSize ? { message: "Missing size for material calculation" } : {}) };
};
