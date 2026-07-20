import { describe, expect, it } from "@jest/globals";
import {
  buildQuoteLineItemPricingFingerprint,
  shouldRequestQuoteLineItemPricingPreview,
} from "./quoteLineItemPricingPreview";

describe("quote line item pricing preview gate", () => {
  const fingerprint = buildQuoteLineItemPricingFingerprint({
    productId: "product-1",
    width: 24,
    height: 18,
    quantity: 50,
    selections: { sides: { value: "double_sided" } },
  });

  it("does not price a saved line merely because it was expanded", () => {
    expect(shouldRequestQuoteLineItemPricingPreview({
      fingerprint,
      lastRequestedFingerprint: "",
      pricingInputsMatchSaved: true,
      optionsValid: true,
    })).toBe(false);
  });

  it("requests once for changed pricing inputs and suppresses an identical rerender", () => {
    expect(shouldRequestQuoteLineItemPricingPreview({
      fingerprint,
      lastRequestedFingerprint: "",
      pricingInputsMatchSaved: false,
      optionsValid: true,
    })).toBe(true);
    expect(shouldRequestQuoteLineItemPricingPreview({
      fingerprint,
      lastRequestedFingerprint: fingerprint,
      pricingInputsMatchSaved: false,
      optionsValid: true,
    })).toBe(false);
  });

  it("uses stable option content rather than object identity", () => {
    const second = buildQuoteLineItemPricingFingerprint({
      productId: "product-1",
      width: 24,
      height: 18,
      quantity: 50,
      selections: { sides: { value: "double_sided" } },
    });
    expect(second).toBe(fingerprint);
  });
});
