import { describe, expect, test } from "@jest/globals";
import { bindCommercialQuantityToFormulaVariables } from "@shared/pbv2/commercialQuantityFormulaVariables";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

describe("commercial quantity formula binding", () => {
  const hourlyTree = { meta: { billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 } } };

  test.each([[1, 60], [0.25, 15], [1.25, 75], [2.5, 150]])("binds numeric hourly quantity %p", (quantity, total) => {
    const variables = bindCommercialQuantityToFormulaVariables({ treeJson: hourlyTree, quantity, existing: { hourly_rate: 60 } });
    expect(variables.hours).toBe(quantity);
    expect(variables.hours * variables.hourly_rate).toBe(total);
  });

  test("does not alias physical product quantity to hours", () => {
    expect(bindCommercialQuantityToFormulaVariables({ treeJson: { meta: {} }, quantity: 2.5, existing: { quantity: 2.5 } })).toEqual({ quantity: 2.5 });
  });

  test("uses the standard hours key for an hourly product whose legacy or unsaved tree lacks billing metadata", () => {
    expect(bindCommercialQuantityToFormulaVariables({
      treeJson: { meta: {} },
      quantity: 1,
      existing: { hourly_rate: 60 },
      pricingProfileKey: "hourly",
    })).toEqual({ hours: 1, hourly_rate: 60 });
  });

  test.each([[1, 60], [0.25, 15], [1.25, 75], [2.5, 150]])("evaluates zero-option hourly preview at %p hours", (quantity, total) => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: {
        schemaVersion: 2, rootNodeIds: [], nodes: {}, edges: [],
        meta: {
          pricingProfileKey: "hourly",
          pricingFormula: "hours * hourly_rate",
          pricingV2: { unitSystem: "imperial", tierBasis: "line_item_quantity", base: { perSqftCents: null, perPieceCents: null, minimumChargeCents: null } },
          billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 },
        },
      },
      widthIn: 0,
      heightIn: 0,
      quantity,
      measurementMode: "quantity_only",
      pricingProfileKey: "hourly",
      pricingProfileConfig: { formulaVariables: { hourly_rate: 60 } },
      debug: true,
    });
    expect(result.totalPrice).toBe(total);
    expect(result.debug?.variables?.hours).toBe(quantity);
    expect(result.debug?.variables?.hourly_rate).toBe(60);
  });
});
