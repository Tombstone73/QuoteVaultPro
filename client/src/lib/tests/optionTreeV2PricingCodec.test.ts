import { describe, expect, test } from "@jest/globals";

import { decodePricingImpact, encodePricingImpact } from "../optionTreeV2PricingCodec";

describe("optionTreeV2PricingCodec", () => {
  test("round-trip: each", () => {
    const encoded = encodePricingImpact({
      mode: "addFlat",
      amountCents: 1234,
      displayUnit: "each",
      taxable: true,
    });
    expect(encoded).toEqual({ mode: "addFlat", amountCents: 1234 });

    const decoded = decodePricingImpact(encoded!);
    expect(decoded.displayUnit).toBe("each");
    expect(decoded.amountCents).toBe(1234);
  });

  test("round-trip: per_qty", () => {
    const encoded = encodePricingImpact({
      mode: "addPerQty",
      amountCents: 25,
      displayUnit: "per_qty",
      taxable: true,
    });
    expect(encoded).toEqual({ mode: "addPerQty", amountCents: 25 });

    const decoded = decodePricingImpact(encoded!);
    expect(decoded.displayUnit).toBe("per_qty");
    expect(decoded.amountCents).toBe(25);
  });

  test("encode/decode: per_sqft preserves amountCents", () => {
    const encoded = encodePricingImpact({
      mode: "addPerSqft",
      amountCents: 999,
      displayUnit: "per_sqft",
      taxable: true,
    });
    expect(encoded).toEqual({ mode: "addPerSqft", amountCents: 999 });

    const decoded = decodePricingImpact(encoded!);
    expect(decoded.displayUnit).toBe("per_sqft");
    expect(decoded.amountCents).toBe(999);
  });

  test("round-trip: percent", () => {
    const encoded = encodePricingImpact({
      mode: "percentOfBase",
      amountCents: 15,
      displayUnit: "percent",
      taxable: true,
    });
    expect(encoded).toEqual({ mode: "percentOfBase", percent: 15 });

    const decoded = decodePricingImpact(encoded!);
    expect(decoded.displayUnit).toBe("percent");
    expect(decoded.amountCents).toBe(15);
  });

  test("round-trip: multiplier", () => {
    const encoded = encodePricingImpact({
      mode: "multiplier",
      amountCents: 1.25,
      displayUnit: "multiplier",
      taxable: true,
    });
    expect(encoded).toEqual({ mode: "multiplier", factor: 1.25 });

    const decoded = decodePricingImpact(encoded!);
    expect(decoded.displayUnit).toBe("multiplier");
    expect(decoded.amountCents).toBe(1.25);
  });
});
