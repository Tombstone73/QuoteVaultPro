import { describe, expect, it } from "@jest/globals";
import { orderIntakePricingBlocker, orderIntakePricingFailure } from "../services/assistant/orderIntakePricing";

describe("order intake pricing failures", () => {
  it("preserves a canonical required-selection blocker without creating an action proposal", () => {
    const blocker = orderIntakePricingBlocker({
      code: "PBV2_PRICING_MATRIX_ERROR",
      message: "Select required options before pricing: Material.",
    });

    expect(blocker.response).toBe("Select required options before pricing: Material.");
    expect(blocker.card).toMatchObject({
      kind: "missing_information",
      title: "Order pricing information needed",
      details: { code: "ORDER_PRICING_INPUT_REQUIRED" },
    });
  });

  it("retains canonical required option keys when pricing provides them", () => {
    expect(orderIntakePricingFailure({
      code: "PBV2_PRICING_MATRIX_ERROR",
      message: "Select required options before pricing: Sides.",
      details: [{ optionGroup: "sides" }, { optionGroup: "thickness" }],
    })).toMatchObject({ code: "ORDER_PRICING_INPUT_REQUIRED", requiredSelectionKeys: ["sides", "thickness"] });
  });

  it("keeps option-rule rejections server-authored", () => {
    expect(orderIntakePricingFailure({
      code: "PBV2_OPTION_RULE_VALIDATION_FAILED",
      message: "Finish must be selected before pricing.",
    })).toEqual({
      code: "ORDER_PRICING_INPUT_REQUIRED",
      summary: "Finish must be selected before pricing.",
    });
  });

  it("fails closed for unexpected pricing errors", () => {
    expect(orderIntakePricingFailure(new Error("database details should not reach chat"))).toEqual({
      code: "ORDER_PRICING_UNAVAILABLE",
      summary: "This product cannot currently be priced for order entry. No order proposal was created.",
    });
  });
});
