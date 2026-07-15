import { describe, expect, test } from "@jest/globals";
import {
  dimensionsForProductPricing,
  productRequiresEnteredDimensions,
} from "../productMeasurementMode";

describe("product measurement mode", () => {
  test("quantity-only product pricing accepts omitted dimensions", () => {
    expect(productRequiresEnteredDimensions({ measurementMode: "quantity_only" }, {
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: { requiresDimensions: true },
    })).toBe(false);
    expect(dimensionsForProductPricing({ measurementMode: "quantity_only" }, undefined, undefined)).toEqual({ widthIn: 1, heightIn: 1 });
  });

  test("dimensions-required product rejects omitted dimensions instead of defaulting them", () => {
    expect(productRequiresEnteredDimensions({ measurementMode: "dimensions_required" }, {
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: { requiresDimensions: true },
    })).toBe(true);
    const dimensions = dimensionsForProductPricing({ measurementMode: "dimensions_required" }, undefined, undefined);
    expect(Number.isNaN(dimensions.widthIn)).toBe(true);
    expect(Number.isNaN(dimensions.heightIn)).toBe(true);
  });
});
