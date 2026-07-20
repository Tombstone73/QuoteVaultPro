import { describe, expect, it } from "@jest/globals";
import { skipsRequiredPrintOptionValidation } from "@shared/productPricingValidation";
import { resolveSelectionsForProductPricing } from "../services/pricing/PricingService";

describe("skipsRequiredPrintOptionValidation", () => {
  it("skips print-option requirements for service workflow products", () => {
    expect(skipsRequiredPrintOptionValidation({ workflowIntent: "service_fee", pricingProfileKey: "qty_only" })).toBe(true);
  });

  it("skips print-option requirements for fee profiles and service products", () => {
    expect(skipsRequiredPrintOptionValidation({ pricingProfileKey: "fee" })).toBe(true);
    expect(skipsRequiredPrintOptionValidation({ isService: true })).toBe(true);
  });

  it("preserves required print-option validation for production products", () => {
    expect(skipsRequiredPrintOptionValidation({ workflowIntent: "standard_production", pricingProfileKey: "flat_goods" })).toBe(false);
  });

  it("does not make a print pricing matrix fatal for a service/fee line", () => {
    const resolution = resolveSelectionsForProductPricing(
      { workflowIntent: "service_fee", pricingProfileKey: "qty_only" },
      {
        pricingMatrix: {
          dimensions: ["print_sides"],
          rows: [{ when: { print_sides: "single_sided" }, variables: { base_price: 100 } }],
        },
      },
      {},
    );

    expect(resolution.selected).toEqual({});
    expect(resolution.pricingMatrixResolution.errors).toEqual([]);
  });

  it("still rejects missing pricing-matrix options for production products", () => {
    expect(() => resolveSelectionsForProductPricing(
      { workflowIntent: "standard_production", pricingProfileKey: "flat_goods" },
      {
        pricingMatrix: {
          dimensions: ["print_sides"],
          rows: [{ when: { print_sides: "single_sided" }, variables: { base_price: 100 } }],
        },
      },
      {},
    )).toThrow("Select required options before pricing: print_sides");
  });
});
