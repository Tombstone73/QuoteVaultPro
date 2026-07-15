export const MATERIAL_FORMS = ["roll", "sheet", "liquid", "each", "bulk_weight"] as const;
export type MaterialForm = (typeof MATERIAL_FORMS)[number];

export const MATERIAL_INVENTORY_UNITS = [
  "square_foot",
  "linear_foot",
  "sheet",
  "each",
  "milliliter",
  "pound",
] as const;
export type MaterialInventoryUnit = (typeof MATERIAL_INVENTORY_UNITS)[number];

const UNIT_ALIASES: Record<string, MaterialInventoryUnit> = {
  sqft: "square_foot",
  square_foot: "square_foot",
  square_feet: "square_foot",
  linear_ft: "linear_foot",
  linear_foot: "linear_foot",
  linear_feet: "linear_foot",
  ft: "linear_foot",
  foot: "linear_foot",
  feet: "linear_foot",
  sheet: "sheet",
  ea: "each",
  each: "each",
  ml: "milliliter",
  milliliter: "milliliter",
  milliliters: "milliliter",
  lb: "pound",
  lbs: "pound",
  pound: "pound",
  pounds: "pound",
};

export function normalizeMaterialUnit(value: unknown): MaterialInventoryUnit | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return UNIT_ALIASES[raw] ?? null;
}

export function isMaterialForm(value: unknown): value is MaterialForm {
  return typeof value === "string" && (MATERIAL_FORMS as readonly string[]).includes(value);
}

export type RollGeometryInput = {
  width?: string | number | null;
  rollLengthFt?: string | number | null;
  edgeWasteInPerSide?: string | number | null;
  leadWasteFt?: string | number | null;
  tailWasteFt?: string | number | null;
};

export type RollUsableCapacity = {
  usableWidthInches: number;
  usableLengthFeet: number;
  usableSquareFeet: number;
};

function finiteNumber(value: unknown, defaultValue?: number): number | null {
  if (value === null || value === undefined || value === "") return defaultValue ?? null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Roll edge waste is stored as a per-side value. Null means no configured waste,
 * matching the existing schema defaults for lead and tail waste.
 */
export function calculateUsableRollCapacity(input: RollGeometryInput):
  | { ok: true; value: RollUsableCapacity }
  | { ok: false; code: "missing_width" | "missing_length" | "invalid_waste" | "non_positive_capacity"; message: string } {
  const width = finiteNumber(input.width);
  const length = finiteNumber(input.rollLengthFt);
  const edgePerSide = finiteNumber(input.edgeWasteInPerSide, 0);
  const lead = finiteNumber(input.leadWasteFt, 0);
  const tail = finiteNumber(input.tailWasteFt, 0);

  if (width === null || width <= 0) return { ok: false, code: "missing_width", message: "Roll width must be greater than zero." };
  if (length === null || length <= 0) return { ok: false, code: "missing_length", message: "Roll length must be greater than zero." };
  if (edgePerSide === null || lead === null || tail === null || edgePerSide < 0 || lead < 0 || tail < 0) {
    return { ok: false, code: "invalid_waste", message: "Roll waste values must be finite, non-negative numbers." };
  }

  const usableWidthInches = width - edgePerSide * 2;
  const usableLengthFeet = length - lead - tail;
  const usableSquareFeet = (usableWidthInches / 12) * usableLengthFeet;
  if (!Number.isFinite(usableWidthInches) || !Number.isFinite(usableLengthFeet) || !Number.isFinite(usableSquareFeet) || usableWidthInches <= 0 || usableLengthFeet <= 0 || usableSquareFeet <= 0) {
    return { ok: false, code: "non_positive_capacity", message: "Roll dimensions and waste leave no usable inventory capacity." };
  }

  return { ok: true, value: { usableWidthInches, usableLengthFeet, usableSquareFeet } };
}

export function roundMaterialQuantity(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : 0;
}
