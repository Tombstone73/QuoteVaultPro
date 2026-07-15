import { convertReservationInputToBaseQty, type UomConversionMaterial } from "../../shared/uomConversions";
import { normalizeMaterialUnit, roundMaterialQuantity } from "../../shared/materialUnits";

export type MaterialStockDeductionRiskLevel = "safe" | "risky" | "unknown";

export type MaterialStockDeductionDecision = {
  allowed: boolean;
  reason: string;
  materialUom: string | null;
  usageUom: string | null;
  convertedQuantity?: number;
  riskLevel: MaterialStockDeductionRiskLevel;
};

export type MaterialStockDeductionMaterial = UomConversionMaterial & {
  materialForm?: string | null;
};

export function canAutoDeductMaterialStock(
  material: MaterialStockDeductionMaterial | null | undefined,
  usageUom: string | null | undefined,
  quantity = 1,
): MaterialStockDeductionDecision {
  const inventoryUnit = normalizeMaterialUnit(material?.inventoryUnit);
  const normalizedUsage = normalizeMaterialUnit(usageUom);
  if (!material?.materialForm || !inventoryUnit || !normalizedUsage) {
    return {
      allowed: false,
      reason: "Automatic inventory deduction requires a material form, inventory unit, and recognized usage unit.",
      materialUom: inventoryUnit,
      usageUom: normalizedUsage,
      riskLevel: "unknown",
    };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { allowed: false, reason: "Automatic inventory deduction requires a positive quantity.", materialUom: inventoryUnit, usageUom: normalizedUsage, riskLevel: "unknown" };
  }

  if (material.materialForm === "roll") {
    const conversion = convertReservationInputToBaseQty({ material, inputUom: normalizedUsage, inputQuantity: quantity });
    if (!conversion.ok) {
      return { allowed: false, reason: conversion.message, materialUom: inventoryUnit, usageUom: normalizedUsage, riskLevel: "risky" };
    }
    return {
      allowed: true,
      reason: normalizedUsage === inventoryUnit ? "Roll usage is already in the configured inventory unit." : "Roll linear-foot usage was converted using usable roll width.",
      materialUom: inventoryUnit,
      usageUom: normalizedUsage,
      convertedQuantity: conversion.convertedQty,
      riskLevel: "safe",
    };
  }

  const sheetCountMatch = material.materialForm === "sheet" && ((inventoryUnit === "sheet" && normalizedUsage === "each") || (inventoryUnit === "each" && normalizedUsage === "sheet"));
  if (inventoryUnit === normalizedUsage || sheetCountMatch) {
    return { allowed: true, reason: "Usage unit matches the configured inventory quantity semantics.", materialUom: inventoryUnit, usageUom: normalizedUsage, convertedQuantity: roundMaterialQuantity(quantity), riskLevel: "safe" };
  }

  return {
    allowed: false,
    reason: "Automatic inventory deduction is blocked because the usage unit cannot be converted to the configured inventory unit.",
    materialUom: inventoryUnit,
    usageUom: normalizedUsage,
    riskLevel: "risky",
  };
}
