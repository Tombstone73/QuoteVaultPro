import type { OptionNodeV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { resolveVisibleNodes } from "@shared/optionTreeV2Runtime";
import { getChoiceMaterialOverrideId } from "@shared/pbv2/materialAuthority";

type QuantityBasis = "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed";

type InventoryConsumption = {
  materialId: string;
  quantityBasis: QuantityBasis;
  multiplier?: number;
  wastePercent?: number;
  fixedQty?: number;
};

export type PlannedMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  basis: string;
  sources: Array<{ optionLabel: string; choiceLabel: string }>;
  uomMismatch?: { materialUom: string; impliedUom: string };
};

export type PlannedMaterialsResult = {
  materials: PlannedMaterial[];
  message?: string;
};

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSelectionValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "value" in (raw as any)) {
    return (raw as any).value;
  }
  return raw;
}

function clampWastePercent(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

function qtyForConsumption(
  basis: QuantityBasis,
  args: {
    widthIn: number;
    heightIn: number;
    quantity: number;
    multiplier: number;
    wastePercent: number;
    fixedQty?: number;
  }
): { qty: number; uom: "sqft" | "ft" | "each"; needsSize: boolean } {
  const wasteFactor = 1 + args.wastePercent / 100;

  if (basis === "area_sqft") {
    return {
      qty: ((args.widthIn * args.heightIn) / 144) * args.quantity * args.multiplier * wasteFactor,
      uom: "sqft",
      needsSize: true,
    };
  }

  if (basis === "perimeter_ft") {
    return {
      qty: ((2 * (args.widthIn + args.heightIn)) / 12) * args.quantity * args.multiplier * wasteFactor,
      uom: "ft",
      needsSize: true,
    };
  }

  if (basis === "linear_ft") {
    return {
      qty: (Math.max(args.widthIn, args.heightIn) / 12) * args.quantity * args.multiplier * wasteFactor,
      uom: "ft",
      needsSize: true,
    };
  }

  if (basis === "each") {
    return {
      qty: args.fixedQty != null ? args.fixedQty : args.quantity * args.multiplier,
      uom: "each",
      needsSize: false,
    };
  }

  return {
    qty: args.fixedQty ?? 0,
    uom: "each",
    needsSize: false,
  };
}

function asNodes(treeJson: OptionTreeV2): OptionNodeV2[] {
  const nodesRaw = treeJson?.nodes as any;
  if (!nodesRaw) return [];
  return Array.isArray(nodesRaw) ? nodesRaw : Object.values(nodesRaw);
}

export function computePlannedMaterialsForLineItem({
  lineItem,
  treeJson,
}: {
  lineItem: any;
  treeJson: OptionTreeV2 | null | undefined;
}): PlannedMaterialsResult {
  if (!lineItem || !treeJson || treeJson.schemaVersion !== 2) {
    return { materials: [] };
  }

  const optionSelections = lineItem.optionSelectionsJson as any;
  const selectedRaw =
    optionSelections && typeof optionSelections === "object" && optionSelections.selected && typeof optionSelections.selected === "object"
      ? optionSelections.selected
      : optionSelections && typeof optionSelections === "object"
        ? optionSelections
        : {};

  const selected: Record<string, { value?: unknown }> = {};
  for (const [key, value] of Object.entries(selectedRaw || {})) {
    selected[key] = { value: normalizeSelectionValue(value) };
  }

  let visibleNodeIds = new Set<string>();
  try {
    const visible = resolveVisibleNodes(treeJson, {
      schemaVersion: 2,
      selected,
    } as any);
    visibleNodeIds = new Set(visible);
  } catch {
    visibleNodeIds = new Set<string>();
  }

  const widthIn = toNumberOrNull(lineItem.width);
  const heightIn = toNumberOrNull(lineItem.height);
  const quantity = Math.max(0, toNumberOrNull(lineItem.quantity) ?? 0);

  let missingSizeForComputation = false;

  const byMaterial = new Map<string, PlannedMaterial>();

  for (const node of asNodes(treeJson)) {
    if (!node?.id) continue;
    if (visibleNodeIds.size > 0 && !visibleNodeIds.has(node.id)) continue;

    const selectionKey = (node.input as any)?.selectionKey || node.id;
    const selectedEntry = selected[selectionKey] ?? selected[node.id];
    const selectedValue = selectedEntry?.value;
    if (selectedValue == null || selectedValue === "") continue;

    const selectedValues = Array.isArray(selectedValue) ? selectedValue : [selectedValue];
    const choices = Array.isArray(node.choices) ? node.choices : [];

    for (const selectedChoiceValue of selectedValues) {
      const choice = choices.find((c: any) => String(c?.value) === String(selectedChoiceValue));
      if (!choice) continue;

      const entries = Array.isArray((choice as any).inventoryConsumption)
        ? ((choice as any).inventoryConsumption as InventoryConsumption[])
        : [];
      const resolvedChoiceMaterialId = getChoiceMaterialOverrideId(choice);

      for (const entry of entries) {
        const materialId = resolvedChoiceMaterialId ?? String(entry?.materialId || "").trim();
        if (!materialId) continue;

        const basis = entry.quantityBasis;
        if (!basis) continue;

        const multiplier = Number.isFinite(entry.multiplier as number) && (entry.multiplier as number) > 0
          ? Number(entry.multiplier)
          : 1;

        const wastePercent = clampWastePercent(entry.wastePercent);

        const needsSize = basis === "area_sqft" || basis === "perimeter_ft" || basis === "linear_ft";
        if (needsSize && (widthIn == null || heightIn == null || widthIn <= 0 || heightIn <= 0)) {
          missingSizeForComputation = true;
          continue;
        }

        if (basis === "fixed" && (entry.fixedQty == null || !Number.isFinite(entry.fixedQty))) {
          continue;
        }

        const computed = qtyForConsumption(basis, {
          widthIn: widthIn ?? 0,
          heightIn: heightIn ?? 0,
          quantity,
          multiplier,
          wastePercent,
          fixedQty: entry.fixedQty,
        });

        const qty = Number.isFinite(computed.qty) ? computed.qty : 0;
        if (qty <= 0) continue;

        const key = `${materialId}::${basis}::${computed.uom}`;
        const existing = byMaterial.get(key);
        const source = {
          optionLabel: String(node.label || selectionKey),
          choiceLabel: String((choice as any).label || (choice as any).value || selectedChoiceValue),
        };

        if (!existing) {
          byMaterial.set(key, {
            materialId,
            qty,
            uom: computed.uom,
            basis,
            sources: [source],
          });
        } else {
          existing.qty += qty;
          existing.sources.push(source);
        }
      }
    }
  }

  const materials = Array.from(byMaterial.values()).map((item) => {
    const roundedQty = item.uom === "each"
      ? Math.round(item.qty)
      : Math.round(item.qty * 100) / 100;
    return {
      ...item,
      qty: roundedQty,
    };
  });

  return {
    materials,
    message: missingSizeForComputation ? "Missing size for material calculation" : undefined,
  };
}
