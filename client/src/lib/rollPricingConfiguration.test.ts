import {
  formulaReferencesLinearFootRate,
  formulaReferencesRollLinearFeet,
  applyRollPricingFormulaVariable,
  mergeRollPricingFormulaVariables,
  shouldShowRollPricingConfiguration,
  validateRollPricingConfiguration,
} from "./rollPricingConfiguration";

describe("roll pricing configuration", () => {
  const rollFormula = "billed_linear_feet * linear_foot_rate";

  it("recognizes canonical roll formulas without matching partial identifiers", () => {
    expect(formulaReferencesRollLinearFeet(rollFormula)).toBe(true);
    expect(formulaReferencesRollLinearFeet("custom_billed_linear_feet_value")).toBe(false);
    expect(formulaReferencesLinearFootRate(rollFormula)).toBe(true);
  });

  it("shows existing roll configuration even before its formula is selected", () => {
    expect(shouldShowRollPricingConfiguration({
      formula: "total_sqft * base_price",
      formulaVariables: { printable_width: 54 },
    })).toBe(true);
    expect(shouldShowRollPricingConfiguration({
      formula: "total_sqft * base_price",
      formulaVariables: { allow_rotation: false },
    })).toBe(false);
  });

  it("requires explicit positive canonical roll dimensions and a non-negative sell rate", () => {
    expect(validateRollPricingConfiguration({
      formula: rollFormula,
      formulaVariables: {
        printable_width: "",
        billing_width_increment: 0,
        billing_length_increment: Number.NaN,
        linear_foot_rate: -1,
        piece_allowance_x: -0.01,
      },
    })).toEqual({
      printable_width: "Required and must be greater than 0.",
      billing_width_increment: "Required and must be greater than 0.",
      billing_length_increment: "Required and must be greater than 0.",
      linear_foot_rate: "Required and must be 0 or greater.",
      piece_allowance_x: "Must be 0 or greater.",
    });
  });

  it("allows optional production allowances and waste to remain unset", () => {
    expect(validateRollPricingConfiguration({
      formula: rollFormula,
      formulaVariables: {
        printable_width: 54,
        billing_width_increment: 12,
        billing_length_increment: 12,
        linear_foot_rate: 0,
      },
    })).toEqual({});
  });

  it("keeps metadata-backed roll variables when a product field is edited", () => {
    const merged = mergeRollPricingFormulaVariables({
      treeFormulaVariables: {
        printable_width: 54,
        billing_width_increment: 12,
        billing_length_increment: 12,
      },
      pricingProfileConfig: {
        allowRotation: true,
        formulaVariables: { linear_foot_rate: 9.5 },
      },
    });
    expect(merged).toEqual({
      printable_width: 54,
      billing_width_increment: 12,
      billing_length_increment: 12,
      linear_foot_rate: 9.5,
      allow_rotation: true,
    });
    expect(applyRollPricingFormulaVariable(merged, "linear_foot_rate", 11)).toEqual({
      printable_width: 54,
      billing_width_increment: 12,
      billing_length_increment: 12,
      linear_foot_rate: 11,
      allow_rotation: true,
    });
  });
});
