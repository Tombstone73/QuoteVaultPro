export const MATERIAL_WEIGHT_UNITS = ["oz", "lb", "g", "kg"] as const;
export const MATERIAL_WEIGHT_BASES = ["each", "sqft", "sheet", "linear_ft", "roll"] as const;

export type MaterialWeightUnit = (typeof MATERIAL_WEIGHT_UNITS)[number];
export type MaterialWeightBasis = (typeof MATERIAL_WEIGHT_BASES)[number];

export type MaterialWeightNormalizationResult = {
  success: boolean;
  weightOzPerBasis?: number;
  errorCode?: string;
  message?: string;
};

const OZ_PER_GRAM = 0.03527396195;
const OZ_PER_KG = 35.27396195;

function parsePositiveWeight(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return "invalid";
  if (parsed <= 0) return "invalid";
  return parsed;
}

export function isMaterialWeightUnit(value: unknown): value is MaterialWeightUnit {
  return typeof value === "string" && (MATERIAL_WEIGHT_UNITS as readonly string[]).includes(value);
}

export function isMaterialWeightBasis(value: unknown): value is MaterialWeightBasis {
  return typeof value === "string" && (MATERIAL_WEIGHT_BASES as readonly string[]).includes(value);
}

export function normalizeWeightToOz(value: unknown, unit: unknown): MaterialWeightNormalizationResult {
  const parsed = parsePositiveWeight(value);
  if (parsed === null) {
    return {
      success: false,
      errorCode: "MATERIAL_WEIGHT_EMPTY",
      message: "Weight value is empty.",
    };
  }
  if (parsed === "invalid") {
    return {
      success: false,
      errorCode: "MATERIAL_WEIGHT_INVALID_VALUE",
      message: "Weight value must be a positive number.",
    };
  }
  if (!isMaterialWeightUnit(unit)) {
    return {
      success: false,
      errorCode: "MATERIAL_WEIGHT_INVALID_UNIT",
      message: "Weight unit must be one of oz, lb, g, or kg.",
    };
  }

  const weightOzPerBasis =
    unit === "lb" ? parsed * 16 :
    unit === "g" ? parsed * OZ_PER_GRAM :
    unit === "kg" ? parsed * OZ_PER_KG :
    parsed;

  return { success: true, weightOzPerBasis };
}

export function computeWeightOzPerBasis(
  value: unknown,
  unit: unknown,
  basis: unknown
): MaterialWeightNormalizationResult {
  if (!isMaterialWeightBasis(basis)) {
    return {
      success: false,
      errorCode: "MATERIAL_WEIGHT_INVALID_BASIS",
      message: "Weight basis must be one of each, sqft, sheet, linear_ft, or roll.",
    };
  }

  return normalizeWeightToOz(value, unit);
}

export function normalizeMaterialWeightMetadata(input: {
  weightValue?: unknown;
  weightUnit?: unknown;
  weightBasis?: unknown;
}): MaterialWeightNormalizationResult {
  const value = input.weightValue;
  if (value === null || value === undefined || value === "") {
    return {
      success: false,
      errorCode: "MATERIAL_WEIGHT_EMPTY",
      message: "Material weight is not configured.",
    };
  }

  return computeWeightOzPerBasis(value, input.weightUnit, input.weightBasis);
}
