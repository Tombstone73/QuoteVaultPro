import {
  calculateNormalizedMaterialCost,
  normalizeMaterialPurchaseUnit,
} from "../materialVendorCost";

describe("material vendor purchase cost normalization", () => {
  it("normalizes a vendor lot price into the inventory-sheet cost", () => {
    expect(calculateNormalizedMaterialCost({
      materialForm: "sheet",
      inventoryUnit: "sheet",
      vendorCostPerUnit: "403.65",
      inventoryUnitsPerPurchaseUnit: "15",
    })).toBeCloseTo(26.91, 8);
  });

  it("uses one inventory unit for legacy records without a conversion", () => {
    expect(calculateNormalizedMaterialCost({ materialForm: "each", vendorCostPerUnit: "4.25" })).toBe(4.25);
  });

  it("derives roll cost from usable inventory capacity", () => {
    expect(calculateNormalizedMaterialCost({
      materialForm: "roll",
      inventoryUnit: "square_foot",
      costPerRoll: "240",
      width: "48",
      rollLengthFt: "100",
    })).toBeCloseTo(0.6, 8);
  });

  it("fails closed for invalid conversion quantities and incomplete roll geometry", () => {
    expect(calculateNormalizedMaterialCost({ materialForm: "sheet", vendorCostPerUnit: "20", inventoryUnitsPerPurchaseUnit: "0" })).toBeNull();
    expect(calculateNormalizedMaterialCost({ materialForm: "roll", inventoryUnit: "square_foot", costPerRoll: "20" })).toBeNull();
  });

  it("accepts purchase-only units without reusing inventory-unit validation", () => {
    expect(normalizeMaterialPurchaseUnit("lot")).toBe("lot");
    expect(normalizeMaterialPurchaseUnit("pack")).toBe("pack");
    expect(normalizeMaterialPurchaseUnit("ea")).toBe("each");
  });
});
