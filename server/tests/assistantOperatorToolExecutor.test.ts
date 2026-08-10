import { describe, expect, test } from "@jest/globals";
import { normalizeTrustedPricingReadArguments } from "../services/assistant/operatorPricingArguments";

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
});
