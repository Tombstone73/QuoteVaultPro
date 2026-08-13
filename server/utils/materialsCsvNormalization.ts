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
import { calculateUsableRollCapacity, MATERIAL_FORMS, MATERIAL_INVENTORY_UNITS, normalizeMaterialUnit } from "@shared/materialUnits";
import { normalizeMaterialPurchaseUnit } from "@shared/materialVendorCost";

export const VALID_TYPES: string[] = [...MATERIAL_FORMS];
export const VALID_UNITS: string[] = [...MATERIAL_INVENTORY_UNITS];
export const VALID_THICKNESS_UNITS: string[] = ["in", "mm", "mil", "gauge"];
export const VALID_WEIGHT_UNITS: string[] = [...MATERIAL_WEIGHT_UNITS];
export const VALID_WEIGHT_BASES: string[] = [...MATERIAL_WEIGHT_BASES];

export type NormalizedMaterialRow = {
  name: string;
  sku: string;
  materialForm: string;
  inventoryUnit: string | undefined;
  vendorCostUnit: string | undefined;
  consumptionUnit: string | undefined;
  category: string | undefined;
  color: string | undefined;
  width: number | undefined;
  height: number | undefined;
  thickness: number | undefined;
  thicknessUnit: string | undefined;
  costPerUnit: number | undefined;
  stockQuantity: number | undefined;
  minStockAlert: number | undefined;
  vendorSku: string | undefined;
  vendorCostPerUnit: number | undefined;
  inventoryUnitsPerPurchaseUnit: number | undefined;
  minimumPurchaseQuantity: number | undefined;
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
  const normalize = (value: string | undefined) => normalizeMaterialUnit(value) ?? undefined;

  return {
    name: (row["material_name"] || "").trim(),
    sku: (row["sku"] || "").trim(),
    materialForm: (row["material_form"] || "").trim().toLowerCase(),
    inventoryUnit: normalize(row["inventory_unit"]),
    vendorCostUnit: normalizeMaterialPurchaseUnit(row["vendor_cost_unit"]) ?? undefined,
    consumptionUnit: normalize(row["consumption_unit"]),
    category: (row["category"] || "").trim() || undefined,
    color: (row["color"] || "").trim() || undefined,
    width: parseNum(row["width"]),
    height: parseNum(row["height"]),
    thickness: parseNum(row["thickness"]),
    thicknessUnit: (row["thickness_unit"] || "").trim().toLowerCase() || undefined,
    costPerUnit: parseNum(row["cost_per_unit"]),
    stockQuantity: parseNum(row["stock_quantity"]),
    minStockAlert: parseNum(row["reorder_point"]),
    vendorSku: (row["vendor_sku"] || "").trim() || undefined,
    vendorCostPerUnit: parseNum(row["vendor_cost_per_unit"]),
    inventoryUnitsPerPurchaseUnit: parseNum(row["inventory_units_per_purchase_unit"]),
    minimumPurchaseQuantity: parseNum(row["minimum_purchase_quantity"]),
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
  if (!n.materialForm) {
    errors.push("material_form is required");
  } else if (!VALID_TYPES.includes(n.materialForm)) {
    errors.push(`material_form must be one of: ${VALID_TYPES.join(", ")} (got "${n.materialForm}")`);
  }
  for (const [field, value] of [
    ["inventory_unit", n.inventoryUnit],
    ["consumption_unit", n.consumptionUnit],
  ] as const) {
    if (!value || !VALID_UNITS.includes(value)) {
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
  if (n.materialForm === "roll" && n.inventoryUnit !== "square_foot" && n.inventoryUnit !== "linear_foot") {
    errors.push("inventory_unit must be square_foot or linear_foot for roll materials");
  }
  if (n.materialForm === "roll" && n.consumptionUnit !== "square_foot" && n.consumptionUnit !== "linear_foot") {
    errors.push("consumption_unit must be square_foot or linear_foot for roll materials");
  }
  if (n.materialForm === "liquid" && (n.inventoryUnit !== "milliliter" || n.consumptionUnit !== "milliliter")) {
    errors.push("liquid materials must use milliliter inventory and consumption units");
  }
  if (n.materialForm === "each" && (n.inventoryUnit !== "each" || n.consumptionUnit !== "each")) {
    errors.push("each materials must use each inventory and consumption units");
  }
  if (n.materialForm === "bulk_weight" && (n.inventoryUnit !== "pound" || n.consumptionUnit !== "pound")) {
    errors.push("bulk_weight materials must use pound inventory and consumption units");
  }
  if (n.materialForm === "sheet" && !(["sheet", "square_foot"].includes(n.inventoryUnit || "") && ["sheet", "square_foot"].includes(n.consumptionUnit || ""))) {
    errors.push("sheet materials must use sheet or square_foot inventory and consumption units");
  }
  if (n.materialForm === "roll" && n.width == null) {
    errors.push("width (roll_width) is required for roll materials");
  }
  if (n.stockQuantity != null && n.stockQuantity < 0) {
    errors.push("stock_quantity must be >= 0");
  }
  if (n.rollLengthFt != null && n.rollLengthFt <= 0) {
    errors.push("roll_length_ft must be > 0");
  }
  if (n.inventoryUnitsPerPurchaseUnit != null && n.inventoryUnitsPerPurchaseUnit <= 0) {
    errors.push("inventory_units_per_purchase_unit must be > 0");
  }
  if (n.minimumPurchaseQuantity != null && n.minimumPurchaseQuantity <= 0) {
    errors.push("minimum_purchase_quantity must be > 0");
  }
  if (n.materialForm === "roll") {
    const capacity = calculateUsableRollCapacity(n);
    if (!capacity.ok) errors.push(capacity.message);
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
    type: n.materialForm,
    materialForm: n.materialForm,
    inventoryUnit: n.inventoryUnit,
    vendorCostUnit: n.vendorCostUnit ?? null,
    consumptionUnit: n.consumptionUnit,
    category: n.category ?? null,
    color: n.color ?? null,
    width: n.width ?? null,
    height: n.height ?? null,
    thickness: n.thickness ?? null,
    thicknessUnit: n.thicknessUnit ?? null,
    costPerUnit: String(n.costPerUnit!),
    stockQuantity: n.stockQuantity != null ? String(n.stockQuantity) : "0",
    minStockAlert: n.minStockAlert != null ? String(n.minStockAlert) : "0",
    isActive: n.isActive ?? true,
    preferredVendorId: resolvedVendorId,
    vendorSku: n.vendorSku ?? null,
    vendorCostPerUnit: n.vendorCostPerUnit != null ? String(n.vendorCostPerUnit) : null,
    inventoryUnitsPerPurchaseUnit: n.inventoryUnitsPerPurchaseUnit != null ? String(n.inventoryUnitsPerPurchaseUnit) : null,
    minimumPurchaseQuantity: n.minimumPurchaseQuantity != null ? String(n.minimumPurchaseQuantity) : null,
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
