import type { MaterialFormValues } from "@/components/MaterialForm";
import type { Material } from "@/hooks/useMaterials";
import { normalizeMaterialUnit } from "@shared/materialUnits";
import { normalizeMaterialPurchaseUnit } from "@shared/materialVendorCost";

export function mostRecentMaterialVariant(variants: Material[]) {
  const ordered = [...variants].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || right.id.localeCompare(left.id));
  return ordered.find((variant) => variant.isActive && variant.materialForm) ?? ordered.find((variant) => variant.materialForm);
}

function decimal(value: string | null | undefined) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function copyMaterialVariantSettings(source: Material): Partial<MaterialFormValues> {
  return {
    materialForm: source.materialForm ?? "sheet",
    category: source.category ?? "",
    inventoryUnit: normalizeMaterialUnit(source.inventoryUnit) ?? "sheet",
    consumptionUnit: normalizeMaterialUnit(source.consumptionUnit) ?? "sheet",
    vendorCostUnit: normalizeMaterialPurchaseUnit(source.vendorCostUnit) ?? undefined,
    inventoryUnitsPerPurchaseUnit: decimal(source.inventoryUnitsPerPurchaseUnit) ?? 1,
    minimumPurchaseQuantity: decimal(source.minimumPurchaseQuantity) ?? 1,
    preferredVendorId: source.preferredVendorId ?? null,
    preferredVendorName: source.preferredVendorName ?? "",
    vendorProductUrl: source.vendorProductUrl ?? "",
    vendorCostPerUnit: decimal(source.vendorCostPerUnit),
    costPerUnit: decimal(source.costPerUnit) ?? 0,
    minStockAlert: decimal(source.minStockAlert) ?? 0,
    weightValue: decimal(source.weightValue),
    weightUnit: source.weightUnit ?? undefined,
    weightBasis: source.weightBasis ?? undefined,
    width: decimal(source.width),
    height: decimal(source.height),
    thickness: decimal(source.thickness),
    thicknessUnit: source.thicknessUnit as MaterialFormValues["thicknessUnit"],
    rollLengthFt: decimal(source.rollLengthFt),
    costPerRoll: decimal(source.costPerRoll),
    edgeWasteInPerSide: decimal(source.edgeWasteInPerSide),
    leadWasteFt: decimal(source.leadWasteFt),
    tailWasteFt: decimal(source.tailWasteFt),
    vendorNotes: source.vendorNotes ?? "",
    specsJson: source.specsJson ? JSON.stringify(source.specsJson, null, 2) : "",
    aiParsingDescription: source.aiParsingDescriptionLinkedToDescription ? "" : source.aiParsingDescription ?? "",
    aiParsingDescriptionLinkedToDescription: Boolean(source.aiParsingDescriptionLinkedToDescription),
  };
}
