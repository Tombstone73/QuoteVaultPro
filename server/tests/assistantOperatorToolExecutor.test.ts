import { describe, expect, test } from "@jest/globals";
import { normalizeTrustedPricingReadArguments, normalizeTrustedProductReadArguments } from "../services/assistant/operatorPricingArguments";

const currentProductContext = {
  context: { entityType: "product", entityId: "product_translucent" },
  task: { entityReferences: [] },
} as any;

describe("trusted Operator pricing argument projection", () => {
  test("binds the current trusted product and projects a square-foot selection request", () => {
    expect(normalizeTrustedPricingReadArguments({
      squareFeet: 10,
      selections: [{ optionGroup: "Layer", value: "3 layer" }, { optionGroup: "Contour cutting", value: "Yes" }],
      unsupportedProviderField: "ignored",
    }, currentProductContext)).toEqual({
      productId: "product_translucent",
      width: 10,
      height: 1,
      unit: "ft",
      optionSelections: { Layer: "3 layer", "Contour cutting": "Yes" },
    });
  });

  test("keeps an explicit product reference and native tool fields unchanged", () => {
    expect(normalizeTrustedPricingReadArguments({ productId: "product_other", quantity: 2, width: 2, height: 3, unit: "ft" }, currentProductContext))
      .toEqual({ productId: "product_other", quantity: 2, width: 2, height: 3, unit: "ft" });
  });

  test("gives an explicit current-turn Product query precedence over retained identity", () => {
    expect(normalizeTrustedProductReadArguments({ productId: "product_translucent", query: "Rigid Product" }, currentProductContext))
      .toEqual({ query: "Rigid Product" });
    expect(normalizeTrustedPricingReadArguments({ productId: "product_translucent", query: "Rigid Product", quantity: 2 }, currentProductContext))
      .toEqual({ query: "Rigid Product", quantity: 2 });
  });

  test("binds retained Product identity only when the current turn supplies none", () => {
    expect(normalizeTrustedProductReadArguments({}, currentProductContext)).toEqual({ productId: "product_translucent" });
  });
});
