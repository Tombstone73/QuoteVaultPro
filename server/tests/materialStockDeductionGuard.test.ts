import { describe, expect, test } from "@jest/globals";
import { canAutoDeductMaterialStock } from "../lib/materialStockDeductionGuard";

const roll = { materialForm: "roll", inventoryUnit: "square_foot", consumptionUnit: "linear_foot", width: 48, rollLengthFt: 100 };

describe("material stock deduction guard", () => {
  test("converts roll linear-foot usage into canonical square-foot inventory", () => {
    expect(canAutoDeductMaterialStock(roll, "linear_foot", 3)).toEqual(expect.objectContaining({ allowed: true, convertedQuantity: 12, materialUom: "square_foot" }));
  });

  test("blocks missing roll width and unknown units", () => {
    expect(canAutoDeductMaterialStock({ ...roll, width: null }, "linear_foot", 3)).toEqual(expect.objectContaining({ allowed: false }));
    expect(canAutoDeductMaterialStock(roll, "mystery_unit", 3)).toEqual(expect.objectContaining({ allowed: false, riskLevel: "unknown" }));
  });

  test("allows sheet and each as whole-sheet count semantics", () => {
    expect(canAutoDeductMaterialStock({ materialForm: "sheet", inventoryUnit: "sheet", consumptionUnit: "sheet" }, "each", 2)).toEqual(expect.objectContaining({ allowed: true, convertedQuantity: 2 }));
  });
});
