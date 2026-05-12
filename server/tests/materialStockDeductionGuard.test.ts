import { describe, expect, test } from "@jest/globals";
import { canAutoDeductMaterialStock } from "../lib/materialStockDeductionGuard";

describe("material stock deduction guard", () => {
  test("allows aligned units", () => {
    expect(canAutoDeductMaterialStock({ type: "roll", unitOfMeasure: "sqft" }, "sqft")).toEqual(
      expect.objectContaining({ allowed: true, riskLevel: "safe" }),
    );
  });

  test("uses inventoryUnit as the effective stock unit when present", () => {
    expect(canAutoDeductMaterialStock({ type: "roll", unitOfMeasure: "sqft", inventoryUnit: "ea" }, "sqft")).toEqual(
      expect.objectContaining({ allowed: false, materialUom: "ea", usageUom: "sqft", riskLevel: "risky" }),
    );
  });

  test("treats ft and linear_ft as aligned aliases", () => {
    expect(canAutoDeductMaterialStock({ type: "roll", unitOfMeasure: "linear_ft" }, "ft")).toEqual(
      expect.objectContaining({ allowed: true, riskLevel: "safe" }),
    );
  });

  test("blocks ambiguous roll and sheet unit mismatches", () => {
    expect(canAutoDeductMaterialStock({ type: "roll", unitOfMeasure: "sheet" }, "sqft")).toEqual(
      expect.objectContaining({ allowed: false, riskLevel: "risky" }),
    );
    expect(canAutoDeductMaterialStock({ type: "sheet", unitOfMeasure: "sqft" }, "sheet")).toEqual(
      expect.objectContaining({ allowed: false, riskLevel: "risky" }),
    );
  });

  test("allows sheet and each as aligned count units for sheet materials", () => {
    expect(canAutoDeductMaterialStock({ type: "sheet", unitOfMeasure: "ea" }, "sheet")).toEqual(
      expect.objectContaining({ allowed: true, riskLevel: "safe" }),
    );
  });

  test("does not globally block mismatches for other material types", () => {
    expect(canAutoDeductMaterialStock({ type: "rigid", unitOfMeasure: "ea" }, "sqft")).toEqual(
      expect.objectContaining({ allowed: true, riskLevel: "unknown" }),
    );
  });
});
