import { calculateNormalizedMaterialCost } from "@shared/materialVendorCost";

/** Translate human purchase language into the existing canonical Material
 * fields. Liter is never persisted as a new inventory or purchase unit. */
export function normalizeAssistantMaterialUnitInput(input: Record<string, unknown>): Record<string, unknown> {
  const candidate = { ...input } as Record<string, unknown>;
  const purchaseUnit = String(candidate.purchaseUnit ?? candidate.vendorCostUnit ?? "").trim().toLowerCase();
  if (candidate.materialForm === "liquid" && ["liter", "liters", "litre", "litres", "l"].includes(purchaseUnit)) {
    const purchaseCost = Number(candidate.vendorCostPerUnit ?? candidate.costPerPurchaseUnit);
    if (Number.isFinite(purchaseCost) && purchaseCost >= 0) {
      candidate.vendorCostPerUnit = purchaseCost;
      candidate.vendorCostUnit = "milliliter";
      candidate.inventoryUnitsPerPurchaseUnit = 1000;
      candidate.costPerUnit = calculateNormalizedMaterialCost({ materialForm: "liquid", inventoryUnit: "milliliter", vendorCostPerUnit: purchaseCost, inventoryUnitsPerPurchaseUnit: 1000 }) ?? purchaseCost / 1000;
    }
    candidate.inventoryUnit = "milliliter";
    candidate.consumptionUnit = "milliliter";
  }
  delete candidate.purchaseUnit;
  delete candidate.costPerPurchaseUnit;
  return candidate;
}
