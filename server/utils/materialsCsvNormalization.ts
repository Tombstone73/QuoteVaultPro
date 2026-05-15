/**
 * materialsCsvNormalization.ts
 *
 * Pure CSV row normalization, validation, and payload building for the
 * materials bulk import/export workflow. No DB access — safe to unit-test.
 *
 * Extracted from materialsImportExport.routes.ts so these functions can be
 * tested independently of the Express/DB infrastructure.
 */

import { parseBool, parseNum } from "./csvImportUtils";
import {
  computeWeightOzPerBasis,
  MATERIAL_WEIGHT_UNITS,
  MATERIAL_WEIGHT_BASES,
} from "@shared/materialWeight";

export const VALID_TYPES: string[] = ["sheet", "roll", "ink", "consumable"];
export const VALID_UNITS: string[] = ["sheet", "sqft", "linear_ft", "ml", "ea"];
export const VALID_THICKNESS_UNITS: string[] = ["in", "mm", "mil", "gauge"];
export const VALID_WEIGHT_UNITS: string[] = [...MATERIAL_WEIGHT_UNITS];
export const VALID_WEIGHT_BASES: string[] = [...MATERIAL_WEIGHT_BASES];

export type NormalizedMaterialRow = {
  name: string;
  sku: string;
  type: string;
  unitOfMeasure: string;
  inventoryUnit: string | undefined;
  sellPriceUnit: string | undefined;
  wholesalePriceUnit: string | undefined;
  vendorCostUnit: string | undefined;
  consumptionUnit: string | undefined;
  category: string | undefined;
  color: string | undefined;
  width: number | undefined;
  height: number | undefined;
  thickness: number | undefined;
  thicknessUnit: string | undefined;
  costPerUnit: number | undefined;
  wholesaleBaseRate: number | undefined;
  wholesaleMinCharge: number | undefined;
  retailBaseRate: number | undefined;
  retailMinCharge: number | undefined;
  stockQuantity: number | undefined;
  minStockAlert: number | undefined;
  vendorSku: string | undefined;
  vendorCostPerUnit: number | undefined;
  rollLengthFt: number | undefined;
  costPerRoll: number | undefined;
  edgeWasteInPerSide: number | undefined;
  leadWasteFt: number | undefined;
  tailWasteFt: number | undefined;
  isActive: boolean | undefined;
  // Weight metadata — weight_oz_per_basis is intentionally NOT parsed from CSV;
  // the server always recomputes it from value+unit+basis.
  weightValue: number | undefined;
  weightUnit: string | undefined;
  weightBasis: string | undefined;
  // Import metadata (not stored in materials table)
  materialId: string | undefined;
  vendorName: string | undefined;
};

/** Normalise a single CSV row into a typed materials payload + metadata. */
export function normalizeRow(row: Record<string, string>): NormalizedMaterialRow {
  const unitOfMeasure = (row["unit_of_measure"] || "").trim().toLowerCase();
  const sellPriceUnit =
    (row["sell_price_unit"] || "").trim().toLowerCase() || unitOfMeasure || undefined;

  return {
    name: (row["material_name"] || "").trim(),
    sku: (row["sku"] || "").trim(),
    type: (row["material_type"] || "").trim().toLowerCase(),
    unitOfMeasure,
    inventoryUnit:
      (row["inventory_unit"] || "").trim().toLowerCase() || unitOfMeasure || undefined,
    sellPriceUnit,
    wholesalePriceUnit:
      (row["wholesale_price_unit"] || "").trim().toLowerCase() ||
      sellPriceUnit ||
      unitOfMeasure ||
      undefined,
    vendorCostUnit:
      (row["vendor_cost_unit"] || "").trim().toLowerCase() || unitOfMeasure || undefined,
    consumptionUnit:
      (row["consumption_unit"] || "").trim().toLowerCase() ||
      sellPriceUnit ||
      unitOfMeasure ||
      undefined,
    category: (row["category"] || "").trim() || undefined,
    color: (row["color"] || "").trim() || undefined,
    width: parseNum(row["width"]),
    height: parseNum(row["height"]),
    thickness: parseNum(row["thickness"]),
    thicknessUnit: (row["thickness_unit"] || "").trim().toLowerCase() || undefined,
    costPerUnit: parseNum(row["cost_per_unit"]),
    wholesaleBaseRate: parseNum(row["wholesale_base_rate"]),
    wholesaleMinCharge: parseNum(row["wholesale_min_charge"]),
    retailBaseRate: parseNum(row["retail_base_rate"]),
    retailMinCharge: parseNum(row["retail_min_charge"]),
    stockQuantity: parseNum(row["stock_quantity"]),
    minStockAlert: parseNum(row["reorder_point"]),
    vendorSku: (row["vendor_sku"] || "").trim() || undefined,
    vendorCostPerUnit: parseNum(row["vendor_cost_per_unit"]),
    rollLengthFt: parseNum(row["roll_length_ft"]),
    costPerRoll: parseNum(row["cost_per_roll"]),
    edgeWasteInPerSide: parseNum(row["edge_waste_in_per_side"]),
    leadWasteFt: parseNum(row["lead_waste_ft"]),
    tailWasteFt: parseNum(row["tail_waste_ft"]),
    isActive: parseBool(row["active"]) ?? true,
    // weight_oz_per_basis column is intentionally not read — server recomputes it.
    weightValue: parseNum(row["weight_value"]),
    weightUnit: (row["weight_unit"] || "").trim().toLowerCase() || undefined,
    weightBasis: (row["weight_basis"] || "").trim().toLowerCase() || undefined,
    // identity metadata
    materialId: (row["material_id"] || "").trim() || undefined,
    vendorName: (row["vendor_name"] || "").trim() || undefined,
  };
}

/** Validate a normalized row. Returns an array of human-readable error strings. */
export function validateNormalizedRow(n: NormalizedMaterialRow): string[] {
  const errors: string[] = [];

  if (!n.name) errors.push("material_name is required");
  if (!n.sku) errors.push("sku is required");
  if (!n.type) {
    errors.push("material_type is required");
  } else if (!VALID_TYPES.includes(n.type)) {
    errors.push(`material_type must be one of: ${VALID_TYPES.join(", ")} (got "${n.type}")`);
  }
  if (!n.unitOfMeasure) {
    errors.push("unit_of_measure is required");
  } else if (!VALID_UNITS.includes(n.unitOfMeasure)) {
    errors.push(`unit_of_measure must be one of: ${VALID_UNITS.join(", ")} (got "${n.unitOfMeasure}")`);
  }
  for (const [field, value] of [
    ["inventory_unit", n.inventoryUnit],
    ["sell_price_unit", n.sellPriceUnit],
    ["wholesale_price_unit", n.wholesalePriceUnit],
    ["vendor_cost_unit", n.vendorCostUnit],
    ["consumption_unit", n.consumptionUnit],
  ] as const) {
    if (value && !VALID_UNITS.includes(value)) {
      errors.push(`${field} must be one of: ${VALID_UNITS.join(", ")} (got "${value}")`);
    }
  }
  if (n.costPerUnit == null) {
    errors.push("cost_per_unit is required");
  } else if (n.costPerUnit < 0) {
    errors.push("cost_per_unit must be >= 0");
  }
  if (n.thicknessUnit && !VALID_THICKNESS_UNITS.includes(n.thicknessUnit)) {
    errors.push(`thickness_unit must be one of: ${VALID_THICKNESS_UNITS.join(", ")}`);
  }
  if (n.type === "roll" && n.width == null) {
    errors.push("width (roll_width) is required for roll materials");
  }
  if (n.wholesaleBaseRate != null && n.wholesaleBaseRate < 0) {
    errors.push("wholesale_base_rate must be >= 0");
  }
  if (n.retailBaseRate != null && n.retailBaseRate < 0) {
    errors.push("retail_base_rate must be >= 0");
  }
  if (n.stockQuantity != null && n.stockQuantity < 0) {
    errors.push("stock_quantity must be >= 0");
  }
  if (n.rollLengthFt != null && n.rollLengthFt <= 0) {
    errors.push("roll_length_ft must be > 0");
  }

  // Weight validation — all-blank is fine; partial configuration is rejected.
  const hasWeightValue = n.weightValue != null;
  const hasWeightUnit = !!n.weightUnit;
  const hasWeightBasis = !!n.weightBasis;
  const weightFieldCount = [hasWeightValue, hasWeightUnit, hasWeightBasis].filter(Boolean).length;

  if (weightFieldCount > 0 && weightFieldCount < 3) {
    errors.push(
      "weight fields must all be present or all be blank (weight_value, weight_unit, weight_basis)"
    );
  }
  if (hasWeightValue && n.weightValue! <= 0) {
    errors.push("weight_value must be > 0");
  }
  if (hasWeightUnit && !VALID_WEIGHT_UNITS.includes(n.weightUnit!)) {
    errors.push(
      `weight_unit must be one of: ${VALID_WEIGHT_UNITS.join(", ")} (got "${n.weightUnit}")`
    );
  }
  if (hasWeightBasis && !VALID_WEIGHT_BASES.includes(n.weightBasis!)) {
    errors.push(
      `weight_basis must be one of: ${VALID_WEIGHT_BASES.join(", ")} (got "${n.weightBasis}")`
    );
  }

  return errors;
}

/**
 * Build the DB insert/update payload from a normalized row + resolved vendor ID.
 *
 * Weight: canonical weight_oz_per_basis is always recomputed server-side from
 * weight_value + weight_unit + weight_basis. Any value the CSV supplied in the
 * weight_oz_per_basis column is silently ignored.
 */
export function buildMaterialPayload(
  n: NormalizedMaterialRow & { resolvedVendorId?: string | null; vendorWillBeCreated?: boolean },
  resolvedVendorId: string | null
): Record<string, any> {
  // Always recompute — never trust an imported canonical value.
  let weightOzPerBasis: string | null = null;
  if (n.weightValue != null && n.weightUnit && n.weightBasis) {
    const result = computeWeightOzPerBasis(n.weightValue, n.weightUnit, n.weightBasis);
    if (result.success && result.weightOzPerBasis != null) {
      weightOzPerBasis = String(result.weightOzPerBasis);
    }
  }

  return {
    name: n.name,
    sku: n.sku,
    type: n.type,
    unitOfMeasure: n.unitOfMeasure,
    inventoryUnit: n.inventoryUnit ?? n.unitOfMeasure,
    sellPriceUnit: n.sellPriceUnit ?? n.unitOfMeasure,
    wholesalePriceUnit: n.wholesalePriceUnit ?? n.sellPriceUnit ?? n.unitOfMeasure,
    vendorCostUnit: n.vendorCostUnit ?? n.unitOfMeasure,
    consumptionUnit: n.consumptionUnit ?? n.sellPriceUnit ?? n.unitOfMeasure,
    category: n.category ?? null,
    color: n.color ?? null,
    width: n.width ?? null,
    height: n.height ?? null,
    thickness: n.thickness ?? null,
    thicknessUnit: n.thicknessUnit ?? null,
    costPerUnit: String(n.costPerUnit!),
    wholesaleBaseRate: n.wholesaleBaseRate != null ? String(n.wholesaleBaseRate) : null,
    wholesaleMinCharge: n.wholesaleMinCharge != null ? String(n.wholesaleMinCharge) : null,
    retailBaseRate: n.retailBaseRate != null ? String(n.retailBaseRate) : null,
    retailMinCharge: n.retailMinCharge != null ? String(n.retailMinCharge) : null,
    stockQuantity: n.stockQuantity != null ? String(n.stockQuantity) : "0",
    minStockAlert: n.minStockAlert != null ? String(n.minStockAlert) : "0",
    isActive: n.isActive ?? true,
    preferredVendorId: resolvedVendorId,
    vendorSku: n.vendorSku ?? null,
    vendorCostPerUnit: n.vendorCostPerUnit != null ? String(n.vendorCostPerUnit) : null,
    rollLengthFt: n.rollLengthFt != null ? String(n.rollLengthFt) : null,
    costPerRoll: n.costPerRoll != null ? String(n.costPerRoll) : null,
    edgeWasteInPerSide: n.edgeWasteInPerSide != null ? String(n.edgeWasteInPerSide) : null,
    leadWasteFt: n.leadWasteFt != null ? String(n.leadWasteFt) : "0",
    tailWasteFt: n.tailWasteFt != null ? String(n.tailWasteFt) : "0",
    weightValue: n.weightValue != null ? String(n.weightValue) : null,
    weightUnit: n.weightUnit ?? null,
    weightBasis: n.weightBasis ?? null,
    weightOzPerBasis,
  };
}
