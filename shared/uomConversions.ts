export const MATERIAL_UOMS = ["sheet", "sqft", "linear_ft", "ml", "ea"] as const;
export type MaterialUom = (typeof MATERIAL_UOMS)[number];

export type UomConversionMaterial = {
  type?: string | null;
  unitOfMeasure: string;
  width?: string | number | null;
};

export type UomConversionResult =
  | {
      ok: true;
      baseUom: MaterialUom;
      inputUom: MaterialUom;
      convertedQty: number;
    }
  | {
      ok: false;
      baseUom: MaterialUom | null;
      inputUom: string;
      message: string;
      code: "invalid_uom" | "missing_width" | "unsupported_conversion" | "invalid_quantity";
    };

function isMaterialUom(value: unknown): value is MaterialUom {
  return typeof value === "string" && (MATERIAL_UOMS as readonly string[]).includes(value);
}

export function round2dp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function getMaterialBaseUom(material: UomConversionMaterial): MaterialUom | null {
  const base = material?.unitOfMeasure;
  return isMaterialUom(base) ? base : null;
}

export function getAllowedInputUomsForMaterial(material: UomConversionMaterial): MaterialUom[] {
  const baseUom = getMaterialBaseUom(material);
  if (!baseUom) return [];

  // Enterprise default: only allow sqft <-> linear_ft conversions when width is present.
  // For sheet/ml/ea there are no conversions.
  const widthIn = typeof material.width === "number" ? material.width : Number(String(material.width ?? ""));
  const hasWidth = Number.isFinite(widthIn) && widthIn > 0;

  if (baseUom === "sqft") return hasWidth ? ["sqft", "linear_ft"] : ["sqft"];
  if (baseUom === "linear_ft") return hasWidth ? ["linear_ft", "sqft"] : ["linear_ft"];

  return [baseUom];
}

export function convertReservationInputToBaseQty(args: {
  material: UomConversionMaterial;
  inputUom?: string | null;
  inputQuantity: number;
}): UomConversionResult {
  const baseUom = getMaterialBaseUom(args.material);
  if (!baseUom) {
    return {
      ok: false,
      baseUom: null,
      inputUom: String(args.inputUom ?? ""),
      message: "Invalid material unit of measure",
      code: "invalid_uom",
    };
  }

  const qty = args.inputQuantity;
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      ok: false,
      baseUom,
      inputUom: String(args.inputUom ?? baseUom),
      message: "Quantity must be > 0",
      code: "invalid_quantity",
    };
  }

  const inputUom = String(args.inputUom ?? baseUom);
  if (!isMaterialUom(inputUom)) {
    return {
      ok: false,
      baseUom,
      inputUom,
      message: "Invalid input unit",
      code: "invalid_uom",
    };
  }

  if (inputUom === baseUom) {
    return { ok: true, baseUom, inputUom, convertedQty: round2dp(qty) };
  }

  const widthIn = typeof args.material.width === "number" ? args.material.width : Number(String(args.material.width ?? ""));
  const widthFactor = Number.isFinite(widthIn) && widthIn > 0 ? widthIn / 12 : NaN;

  if (!Number.isFinite(widthFactor) || widthFactor <= 0) {
    return {
      ok: false,
      baseUom,
      inputUom,
      message: "Cannot convert without material width. Add width on the material to enable this unit.",
      code: "missing_width",
    };
  }

  // Only supported conversion: sqft <-> linear_ft (requires width).
  if (baseUom === "sqft" && inputUom === "linear_ft") {
    return { ok: true, baseUom, inputUom, convertedQty: round2dp(qty * widthFactor) };
  }

  if (baseUom === "linear_ft" && inputUom === "sqft") {
    return { ok: true, baseUom, inputUom, convertedQty: round2dp(qty / widthFactor) };
  }

  return {
    ok: false,
    baseUom,
    inputUom,
    message: "Unsupported unit conversion",
    code: "unsupported_conversion",
  };
}
