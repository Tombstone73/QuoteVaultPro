import { calculateUsableRollCapacity } from "./materialUnits";

export const MATERIAL_PURCHASE_UNITS = [
  "each",
  "sheet",
  "roll",
  "pack",
  "case",
  "lot",
  "pound",
  "milliliter",
  "linear_foot",
  "square_foot",
] as const;

export type MaterialPurchaseUnit = (typeof MATERIAL_PURCHASE_UNITS)[number];

const purchaseUnitAliases: Record<string, MaterialPurchaseUnit> = {
  ea: "each",
  each: "each",
  sheet: "sheet",
  roll: "roll",
  pack: "pack",
  pkg: "pack",
  case: "case",
  lot: "lot",
  lb: "pound",
  pound: "pound",
  ml: "milliliter",
  milliliter: "milliliter",
  linear_ft: "linear_foot",
  linear_foot: "linear_foot",
  sqft: "square_foot",
  square_foot: "square_foot",
};

export function normalizeMaterialPurchaseUnit(value: unknown): MaterialPurchaseUnit | null {
  return purchaseUnitAliases[String(value ?? "").trim().toLowerCase()] ?? null;
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type MaterialVendorCostShape = {
  materialForm?: string | null;
  inventoryUnit?: string | null;
  vendorCostPerUnit?: string | number | null;
  inventoryUnitsPerPurchaseUnit?: string | number | null;
  costPerRoll?: string | number | null;
  width?: string | number | null;
  rollLengthFt?: string | number | null;
  edgeWasteInPerSide?: string | number | null;
  leadWasteFt?: string | number | null;
  tailWasteFt?: string | number | null;
};

/**
 * Returns the procurement-derived cost for one inventory unit.  The generic
 * purchase path is price / inventory-units-per-purchase-unit; rolls retain
 * their established usable-capacity calculation.
 */
export function calculateNormalizedMaterialCost(input: MaterialVendorCostShape): number | null {
  if (input.materialForm === "roll") {
    const rollCost = finitePositive(input.costPerRoll);
    const capacity = calculateUsableRollCapacity(input);
    if (!rollCost || !capacity.ok) return null;
    const units = input.inventoryUnit === "linear_foot"
      ? capacity.value.usableLengthFeet
      : capacity.value.usableSquareFeet;
    return units > 0 ? rollCost / units : null;
  }

  const purchasePrice = finitePositive(input.vendorCostPerUnit);
  if (!purchasePrice) return null;
  const conversionWasProvided = input.inventoryUnitsPerPurchaseUnit !== undefined && input.inventoryUnitsPerPurchaseUnit !== null && input.inventoryUnitsPerPurchaseUnit !== "";
  const containedUnits = finitePositive(input.inventoryUnitsPerPurchaseUnit);
  if (conversionWasProvided && !containedUnits) return null;
  return purchasePrice / (containedUnits ?? 1);
}

export function formatNormalizedMaterialCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Material cost must be a finite non-negative number.");
  return value.toFixed(4);
}
