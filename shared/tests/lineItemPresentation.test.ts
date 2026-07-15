import { describe, expect, test } from "@jest/globals";
import { formatLineItemMeasurementLabel, shouldDisplayLineItemDimensions } from "../lineItemPresentation";

describe("line-item measurement presentation", () => {
  test("quantity-only items never render legacy neutral 1 x 1 dimensions", () => {
    const product = { measurementMode: "quantity_only" as const };
    expect(shouldDisplayLineItemDimensions(product)).toBe(false);
    expect(formatLineItemMeasurementLabel(product, 1, 1)).toBe("Quantity only");
  });

  test("dimension-required items retain their finished-size display", () => {
    const product = { measurementMode: "dimensions_required" as const };
    expect(shouldDisplayLineItemDimensions(product)).toBe(true);
    expect(formatLineItemMeasurementLabel(product, 24, 18)).toBe('24" × 18"');
  });
});
