import {
  computeWeightOzPerBasis,
  normalizeMaterialWeightMetadata,
  normalizeWeightToOz,
} from "../materialWeight";

describe("material weight normalization", () => {
  test("1 lb converts to 16 oz", () => {
    expect(normalizeWeightToOz(1, "lb")).toMatchObject({
      success: true,
      weightOzPerBasis: 16,
    });
  });

  test("16 oz remains 16 oz", () => {
    expect(normalizeWeightToOz(16, "oz")).toMatchObject({
      success: true,
      weightOzPerBasis: 16,
    });
  });

  test("453.592 g converts to approximately 16 oz", () => {
    const result = normalizeWeightToOz(453.592, "g");
    expect(result.success).toBe(true);
    expect(result.weightOzPerBasis).toBeCloseTo(16, 3);
  });

  test("0.453592 kg converts to approximately 16 oz", () => {
    const result = normalizeWeightToOz(0.453592, "kg");
    expect(result.success).toBe(true);
    expect(result.weightOzPerBasis).toBeCloseTo(16, 3);
  });

  test("blank and null inputs return unsuccessful results without throwing", () => {
    expect(() => normalizeWeightToOz("", "oz")).not.toThrow();
    expect(() => normalizeWeightToOz(null, "oz")).not.toThrow();
    expect(normalizeWeightToOz("", "oz").success).toBe(false);
    expect(normalizeWeightToOz(null, "oz").success).toBe(false);
  });

  test("negative input is invalid", () => {
    expect(normalizeWeightToOz(-1, "oz")).toMatchObject({
      success: false,
      errorCode: "MATERIAL_WEIGHT_INVALID_VALUE",
    });
  });

  test("missing basis is invalid when value and unit exist", () => {
    expect(computeWeightOzPerBasis(1, "lb", undefined)).toMatchObject({
      success: false,
      errorCode: "MATERIAL_WEIGHT_INVALID_BASIS",
    });
  });

  test("complete value, unit, and basis returns canonical oz per basis", () => {
    expect(normalizeMaterialWeightMetadata({
      weightValue: "0.32",
      weightUnit: "lb",
      weightBasis: "sqft",
    })).toMatchObject({
      success: true,
      weightOzPerBasis: 5.12,
    });
  });
});
