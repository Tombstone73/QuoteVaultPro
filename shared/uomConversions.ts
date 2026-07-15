import {
  calculateUsableRollCapacity,
  normalizeMaterialUnit,
  roundMaterialQuantity,
  type MaterialInventoryUnit,
  type RollGeometryInput,
} from "./materialUnits";

export const MATERIAL_UOMS = ["square_foot", "linear_foot", "sheet", "each", "milliliter", "pound"] as const;
export type MaterialUom = (typeof MATERIAL_UOMS)[number];

export type UomConversionMaterial = RollGeometryInput & {
  materialForm?: string | null;
  inventoryUnit?: string | null;
  consumptionUnit?: string | null;
};

export type UomConversionResult =
  | { ok: true; baseUom: MaterialUom; inputUom: MaterialUom; convertedQty: number }
  | {
      ok: false;
      baseUom: MaterialUom | null;
      inputUom: string;
      message: string;
      code: "invalid_uom" | "missing_width" | "unsupported_conversion" | "invalid_quantity";
    };

export function getMaterialBaseUom(material: UomConversionMaterial): MaterialUom | null {
  return normalizeMaterialUnit(material?.inventoryUnit) as MaterialUom | null;
}

export function getAllowedInputUomsForMaterial(material: UomConversionMaterial): MaterialUom[] {
  const baseUom = getMaterialBaseUom(material);
  if (!baseUom) return [];
  return material.materialForm === "roll" && baseUom === "square_foot"
    ? ["square_foot", "linear_foot"]
    : [baseUom];
}

export function convertReservationInputToBaseQty(args: {
  material: UomConversionMaterial;
  inputUom?: string | null;
  inputQuantity: number;
}): UomConversionResult {
  const baseUom = getMaterialBaseUom(args.material);
  const normalizedInput = normalizeMaterialUnit(args.inputUom ?? baseUom);
  if (!baseUom || !normalizedInput) {
    return {
      ok: false,
      baseUom,
      inputUom: String(args.inputUom ?? ""),
      message: "A configured inventory unit and a recognized input unit are required.",
      code: "invalid_uom",
    };
  }
  if (!Number.isFinite(args.inputQuantity) || args.inputQuantity <= 0) {
    return { ok: false, baseUom, inputUom: normalizedInput, message: "Quantity must be greater than zero.", code: "invalid_quantity" };
  }
  if (normalizedInput === baseUom) {
    return { ok: true, baseUom, inputUom: normalizedInput, convertedQty: roundMaterialQuantity(args.inputQuantity) };
  }
  if (args.material.materialForm !== "roll" || baseUom !== "square_foot" || normalizedInput !== "linear_foot") {
    return { ok: false, baseUom, inputUom: normalizedInput, message: "This material does not have a configured conversion for those units.", code: "unsupported_conversion" };
  }
  const capacity = calculateUsableRollCapacity(args.material);
  if (!capacity.ok) {
    return { ok: false, baseUom, inputUom: normalizedInput, message: capacity.message, code: "missing_width" };
  }
  return {
    ok: true,
    baseUom,
    inputUom: normalizedInput,
    convertedQty: roundMaterialQuantity(args.inputQuantity * (capacity.value.usableWidthInches / 12)),
  };
}
