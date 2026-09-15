import { describe, expect, test } from "@jest/globals";
import { buildFormulaEvaluationScope, buildFormulaScope } from "../formulaScope";
import { calculateRollMediaLayout } from "../rollMediaLayout";

const rollLayout = calculateRollMediaLayout({
  physicalRollWidthIn: 54,
  printableWidthIn: 54,
  finishedWidthIn: 10,
  finishedHeightIn: 10,
  quantity: 6,
  billingWidthIncrementIn: 12,
  billingLengthIncrementIn: 12,
});

function scopeWithRollLayout() {
  return buildFormulaScope({
    formula: "billed_linear_feet * linear_foot_rate",
    orderedWidthIn: 10,
    orderedHeightIn: 10,
    trimAllowanceX: 0,
    trimAllowanceY: 0,
    finishedWidthIn: 10,
    finishedHeightIn: 10,
    quantity: 6,
    baseRatePerSqft: 1,
    sqftPerItem: 100 / 144,
    totalSqft: 600 / 144,
    linearFeet: 10 / 12,
    rollLayout,
  });
}

describe("roll-consumption formula scope", () => {
  test("exposes consumed and billed linear feet only from canonical layout", () => {
    const scope = scopeWithRollLayout();

    expect(scope.linear_feet).toBeCloseTo(10 / 12, 8);
    expect(scope.consumed_linear_feet).toBe(rollLayout.actualConsumedLinearFeet);
    expect(scope.billed_linear_feet).toBe(2);
  });

  test("does not expose roll-consumption variables when layout is unavailable", () => {
    const scope = buildFormulaScope({
      formula: "billed_linear_feet * linear_foot_rate",
      orderedWidthIn: 10,
      orderedHeightIn: 10,
      trimAllowanceX: 0,
      trimAllowanceY: 0,
      finishedWidthIn: 10,
      finishedHeightIn: 10,
      quantity: 1,
      baseRatePerSqft: 1,
      sqftPerItem: 100 / 144,
      totalSqft: 100 / 144,
      linearFeet: 10 / 12,
    });

    expect(scope).not.toHaveProperty("consumed_linear_feet");
    expect(scope).not.toHaveProperty("billed_linear_feet");
  });

  test("formula variables and pricing matrices cannot override canonical roll values", () => {
    const evaluated = buildFormulaEvaluationScope({
      scope: scopeWithRollLayout(),
      formulaVariables: {
        consumed_linear_feet: 999,
        billed_linear_feet: 999,
        linear_foot_rate: 7,
      },
      pricingMatrixVariables: {
        consumed_linear_feet: 888,
        billed_linear_feet: 888,
        linear_foot_rate: 9,
      },
    });

    expect(evaluated.consumed_linear_feet).toBe(rollLayout.actualConsumedLinearFeet);
    expect(evaluated.billed_linear_feet).toBe(2);
    expect(evaluated.linear_foot_rate).toBe(9);
  });
});
