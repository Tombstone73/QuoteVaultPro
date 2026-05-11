export type MaterialStockDeductionRiskLevel = "safe" | "risky" | "unknown";

export type MaterialStockDeductionDecision = {
  allowed: boolean;
  reason: string;
  materialUom: string | null;
  usageUom: string | null;
  riskLevel: MaterialStockDeductionRiskLevel;
};

export type MaterialStockDeductionMaterial = {
  type?: string | null;
  unitOfMeasure?: string | null;
  inventoryUnit?: string | null;
};

function normalizeUom(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "ft" || raw === "foot" || raw === "feet") return "linear_ft";
  if (raw === "each") return "ea";
  return raw;
}

export function canAutoDeductMaterialStock(
  material: MaterialStockDeductionMaterial | null | undefined,
  usageUom: string | null | undefined,
): MaterialStockDeductionDecision {
  const materialType = String(material?.type ?? "").trim().toLowerCase();
  const normalizedMaterialUom = normalizeUom(material?.inventoryUnit ?? material?.unitOfMeasure);
  const normalizedUsageUom = normalizeUom(usageUom);

  if (!normalizedMaterialUom || !normalizedUsageUom) {
    return {
      allowed: true,
      reason: "Material or usage unit is unavailable; preserving existing workflow and leaving stock mutation behavior unchanged.",
      materialUom: normalizedMaterialUom,
      usageUom: normalizedUsageUom,
      riskLevel: "unknown",
    };
  }

  if (normalizedMaterialUom === normalizedUsageUom) {
    return {
      allowed: true,
      reason: "Usage unit matches the material effective Inventory Unit.",
      materialUom: normalizedMaterialUom,
      usageUom: normalizedUsageUom,
      riskLevel: "safe",
    };
  }

  if (
    materialType === "sheet" &&
    ((normalizedMaterialUom === "ea" && normalizedUsageUom === "sheet") ||
      (normalizedMaterialUom === "sheet" && normalizedUsageUom === "ea"))
  ) {
    return {
      allowed: true,
      reason: "Sheet and each units are treated as aligned count units for sheet materials.",
      materialUom: normalizedMaterialUom,
      usageUom: normalizedUsageUom,
      riskLevel: "safe",
    };
  }

  if (materialType !== "roll" && materialType !== "sheet") {
    return {
      allowed: true,
      reason: "Unit mismatch is not guarded for non-roll and non-sheet materials in this phase.",
      materialUom: normalizedMaterialUom,
      usageUom: normalizedUsageUom,
      riskLevel: "unknown",
    };
  }

  // TODO(material-units): Add explicit conversion-factor architecture for roll sqft conversion,
  // sheet yield conversion, and partial depletion tracking before auto-depleting mismatched units.
  return {
    allowed: false,
    reason:
      "Manual inventory review required: roll/sheet stock deduction has mismatched usage and effective Inventory Units with no explicit conversion logic.",
    materialUom: normalizedMaterialUom,
    usageUom: normalizedUsageUom,
    riskLevel: "risky",
  };
}
