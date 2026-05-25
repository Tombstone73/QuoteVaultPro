import { describe, expect, test } from "@jest/globals";
import { setPricingMatrixDimension } from "../pricingMatrixDraft";

describe("PBV2 pricing matrix draft updates", () => {
  test("clicking Sides and Thickness adds both selected dimensions", () => {
    const withSides = setPricingMatrixDimension({ dimensions: [], rows: [] }, "sides", true);
    const withThickness = setPricingMatrixDimension(withSides, "thickness", true);

    expect(withThickness.dimensions).toEqual(["sides", "thickness"]);
    expect(withThickness.rows).toEqual([]);
  });

  test("re-clicking an already selected dimension does not duplicate it", () => {
    const next = setPricingMatrixDimension({ dimensions: ["sides"], rows: [] }, "sides", true);

    expect(next.dimensions).toEqual(["sides"]);
  });

  test("deselecting a dimension preserves rows for the editor repair path", () => {
    const rows = [{ id: "row", when: { sides: "double" }, variables: { base_price: 100 } }];
    const next = setPricingMatrixDimension({ dimensions: ["sides", "thickness"], rows }, "sides", false);

    expect(next.dimensions).toEqual(["thickness"]);
    expect(next.rows).toBe(rows);
  });
});
