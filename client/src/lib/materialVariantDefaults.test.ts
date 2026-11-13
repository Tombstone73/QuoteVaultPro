import { describe, expect, test } from "@jest/globals";
import type { Material } from "@/hooks/useMaterials";
import { copyMaterialVariantSettings, mostRecentMaterialVariant } from "./materialVariantDefaults";

const cyan: Material = {
  id: "cyan", name: "Canon M5 Ink / Cyan", sku: "CANON-C", materialFamilyId: "family",
  color: "Cyan", variantValues: [{ dimensionId: "color", value: "Cyan" }],
  type: "liquid", materialForm: "liquid", category: "Ink", inventoryUnit: "milliliter",
  consumptionUnit: "milliliter", vendorCostUnit: "pack", inventoryUnitsPerPurchaseUnit: "2000",
  preferredVendorName: "Supplier", preferredVendorId: "vendor-1", vendorSku: "supplier-c",
  vendorProductUrl: "https://example.invalid/ink", vendorCostPerUnit: "350.00",
  costPerUnit: "0.1750", minimumPurchaseQuantity: "2", minStockAlert: "100",
  weightValue: "3", weightUnit: "lb", weightBasis: "each", thickness: "5", thicknessUnit: "mil",
  specsJson: { package: "box" }, vendorNotes: "Order by pack", aiParsingDescription: "Printer ink",
  stockQuantity: "450", vendorLastPriceCents: 31000, vendorLastPriceUpdatedAt: "2026-11-11",
  linkedProductIds: ["production-product"], isActive: true, createdAt: "2026-11-12T14:00:00Z",
  updatedAt: "2026-11-13T14:00:00Z",
};

describe("Material variant defaults", () => {
  test("copies vendor, purchasing, inventory unit and physical settings, including zero-valued costs", () => {
    expect(copyMaterialVariantSettings(cyan)).toMatchObject({
      materialForm: "liquid", category: "Ink", inventoryUnit: "milliliter", consumptionUnit: "milliliter",
      preferredVendorName: "Supplier", preferredVendorId: "vendor-1", vendorProductUrl: cyan.vendorProductUrl,
      vendorCostUnit: "pack", inventoryUnitsPerPurchaseUnit: 2000, vendorCostPerUnit: 350, costPerUnit: 0.175,
      minStockAlert: 100, minimumPurchaseQuantity: 2, weightValue: 3, weightUnit: "lb", weightBasis: "each",
      thickness: 5, thicknessUnit: "mil", specsJson: JSON.stringify(cyan.specsJson, null, 2),
      vendorNotes: "Order by pack", aiParsingDescription: "Printer ink",
    });
    expect(copyMaterialVariantSettings({ ...cyan, vendorCostPerUnit: "0" }).vendorCostPerUnit).toBe(0);
  });

  test("keeps identity, product links, stock and receipt history out of copied settings", () => {
    const copy = copyMaterialVariantSettings(cyan);
    for (const key of ["id", "name", "sku", "vendorSku", "color", "variantValues", "stockQuantity", "vendorLastPrice", "vendorLastPriceCents", "vendorLastPriceUpdatedAt", "linkedProductIds"]) {
      expect(copy).not.toHaveProperty(key);
    }
    expect(copyMaterialVariantSettings({ ...cyan, aiParsingDescriptionLinkedToDescription: true })).toMatchObject({
      aiParsingDescription: "", aiParsingDescriptionLinkedToDescription: true,
    });
  });

  test("selects the latest configured active sibling by creation time", () => {
    const magenta = { ...cyan, id: "magenta", createdAt: "2026-11-13T14:00:00Z" };
    const yellow = { ...magenta, id: "yellow", isActive: false, createdAt: "2026-11-14T14:00:00Z" };
    expect(mostRecentMaterialVariant([yellow, cyan, magenta])?.id).toBe("magenta");
    expect(mostRecentMaterialVariant([yellow])?.id).toBe("yellow");
    expect(mostRecentMaterialVariant([{ ...cyan, materialForm: null }])).toBeUndefined();
  });
});
