import { describe, expect, it } from "@jest/globals";
import { buildQuoteCalculatePayload } from "./quoteCalculatePayload";

const baseInput = {
  productId: "prod-1",
  variantId: null as string | null,
  widthNum: 24,
  heightNum: 36,
  qtyNum: 3,
  isPbv2Mode: true,
  optionSelectionsV2Selected: { thickness: "3mm" } as Record<string, unknown>,
  optionSelectionsV1: {} as Record<string, unknown>,
  customerId: "cust-1" as string | null,
};

describe("buildQuoteCalculatePayload", () => {
  it("sends the current draft quantity, not a persisted quantity", () => {
    const payload = buildQuoteCalculatePayload({ ...baseInput, qtyNum: 6 });
    expect(payload.quantity).toBe(6);
  });

  it("sends the current draft width and height", () => {
    const payload = buildQuoteCalculatePayload({ ...baseInput, widthNum: 12, heightNum: 18 });
    expect(payload.width).toBe(12);
    expect(payload.height).toBe(18);
  });

  it("sends updated PBV2 option selections (e.g. thickness 6mm)", () => {
    const payload = buildQuoteCalculatePayload({
      ...baseInput,
      optionSelectionsV2Selected: { thickness: "6mm", sides: "single" },
    });
    expect(payload.optionSelectionsJson).toEqual({ thickness: "6mm", sides: "single" });
    // Legacy v1 selections must not be sent for a PBV2 product.
    expect(payload.selectedOptions).toBeUndefined();
  });

  it("sends legacy selectedOptions for a non-PBV2 product", () => {
    const payload = buildQuoteCalculatePayload({
      ...baseInput,
      isPbv2Mode: false,
      optionSelectionsV1: { laminate: "matte" },
    });
    expect(payload.selectedOptions).toEqual({ laminate: "matte" });
    expect(payload.optionSelectionsJson).toBeUndefined();
  });

  it("omits an empty variantId", () => {
    expect(buildQuoteCalculatePayload({ ...baseInput, variantId: null }).variantId).toBeUndefined();
    expect(buildQuoteCalculatePayload({ ...baseInput, variantId: "" }).variantId).toBeUndefined();
    expect(buildQuoteCalculatePayload({ ...baseInput, variantId: "var-9" }).variantId).toBe("var-9");
  });

  it("passes productId and customerId through", () => {
    const payload = buildQuoteCalculatePayload({ ...baseInput, productId: "prod-x", customerId: "cust-x" });
    expect(payload.productId).toBe("prod-x");
    expect(payload.customerId).toBe("cust-x");
  });

  it("defaults a missing PBV2 selection map to an empty object", () => {
    const payload = buildQuoteCalculatePayload({
      ...baseInput,
      optionSelectionsV2Selected: undefined as unknown as Record<string, unknown>,
    });
    expect(payload.optionSelectionsJson).toEqual({});
  });
});
