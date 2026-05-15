import { describe, expect, test } from "@jest/globals";
import { formatMaterialWeightStatus } from "./materialWeightDisplay";

describe("formatMaterialWeightStatus", () => {
  test("displays configured material weight cleanly", () => {
    expect(formatMaterialWeightStatus({
      weightValue: "0.42",
      weightUnit: "lb",
      weightBasis: "sqft",
      weightOzPerBasis: "6.72",
    })).toBe("Weight configured: 0.42 lb / sqft");
  });

  test("displays not configured for missing material weight", () => {
    expect(formatMaterialWeightStatus({
      weightValue: null,
      weightUnit: null,
      weightBasis: null,
      weightOzPerBasis: null,
    })).toBe("Weight not configured");
  });

  test("formats linear foot basis for operators", () => {
    expect(formatMaterialWeightStatus({
      weightValue: 2,
      weightUnit: "oz",
      weightBasis: "linear_ft",
      weightOzPerBasis: 2,
    })).toBe("Weight configured: 2 oz / linear ft");
  });
});
