import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "../optionTreeV2";
import {
  dimensionsForProductPricing,
  productRequiresEnteredDimensions,
  resolveProductMeasurement,
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

  test("Fee / Service pricing is non-dimensional even if an older product lacks the measurement flag", () => {
    expect(productRequiresEnteredDimensions({ pricingProfileKey: "fee" })).toBe(false);
    expect(dimensionsForProductPricing({ pricingProfileKey: "fee" }, undefined, undefined)).toEqual({ widthIn: 1, heightIn: 1 });
  });
});

describe("selected product measurement for order-line saves", () => {
  const tree = (meta: NonNullable<OptionTreeV2["meta"]>): OptionTreeV2 => ({
    schemaVersion: 2 as const, rootNodeIds: [], nodes: {}, meta,
  });

  test("a new quantity-entry tree removes the old dimension requirement", () => {
    const oldProduct = { measurementMode: "dimensions_required" as const };
    const selectedProduct = { measurementMode: "dimensions_required" as const };
    expect(resolveProductMeasurement(oldProduct, tree({ requiresDimensions: true }), 24, 18).requiresEnteredDimensions).toBe(true);
    expect(resolveProductMeasurement(selectedProduct, tree({ requiresDimensions: false }), null, null)).toEqual({
      requiresEnteredDimensions: false,
      physicalDimensions: { widthIn: 0, heightIn: 0 },
      pricingDimensions: { widthIn: 1, heightIn: 1 },
    });
  });

  test("fixed physical size comes from the selected tree even for quantity-only entry", () => {
    const dimensions = resolveProductMeasurement(
      { measurementMode: "quantity_only" },
      tree({ requiresDimensions: false, fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" } }),
      null, null,
    );
    expect(dimensions).toEqual({
      requiresEnteredDimensions: false,
      physicalDimensions: { widthIn: 24, heightIn: 18 },
      pricingDimensions: { widthIn: 24, heightIn: 18 },
    });
  });

  test("switching back to entered dimensions rejects missing or nonpositive input", () => {
    const product = { measurementMode: "dimensions_required" as const };
    const requiredTree = tree({ requiresDimensions: true });
    for (const [width, height] of [[undefined, undefined], [0, 18], [24, -1]]) {
      const { pricingDimensions } = resolveProductMeasurement(product, requiredTree, width, height);
      expect(Number.isFinite(pricingDimensions.widthIn) && pricingDimensions.widthIn > 0 &&
        Number.isFinite(pricingDimensions.heightIn) && pricingDimensions.heightIn > 0).toBe(false);
    }
    expect(resolveProductMeasurement(product, requiredTree, 24, 18).physicalDimensions).toEqual({ widthIn: 24, heightIn: 18 });
  });
});
