import { describe, expect, test } from "@jest/globals";
import { getPricingFormulaSelectionValues } from "../pricingFormulaSelection";

describe("pricing formula library selection", () => {
  test("copies the selected library expression into the effective pricing formula", () => {
    const values = getPricingFormulaSelectionValues(
      [
        {
          id: "formula_4x8",
          expression: "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3) * base_price",
          pricingProfileKey: "default",
          config: { formulaVariables: { sheet_width: 48 } },
        },
      ],
      "formula_4x8",
    );

    expect(values.pricingFormulaId).toBe("formula_4x8");
    expect(values.pricingFormula).toBe("sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3) * base_price");
    expect(values.pricingProfileKey).toBe("default");
    expect(values.pricingProfileConfig).toEqual({ formulaVariables: { sheet_width: 48 } });
  });

  test("does not clear custom formula text when no library formula is selected", () => {
    expect(getPricingFormulaSelectionValues([], "__none__")).toEqual({ pricingFormulaId: null });
  });
});
