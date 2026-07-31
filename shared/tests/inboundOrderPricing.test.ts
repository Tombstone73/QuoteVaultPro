import { describe, expect, test } from "@jest/globals";

import {
  hasUsableInboundLinePrice,
  preserveInboundPricingResolution,
  resolveInboundLineEffectivePricing,
} from "../inboundOrderPricing";

describe("inbound order pricing review helpers", () => {
  test("preserves a staff override while replacing stale system pricing", () => {
    const previous = {
      status: "not_available" as const,
      message: "Pricing needs recalculation.",
      acknowledged: false,
      resolution: null,
      resolutionNote: null,
      poPriceCents: null,
      poUnitPriceCents: null,
      poExtendedPriceCents: null,
      poTotalPriceCents: null,
      comparisonType: null,
      systemPriceCents: null,
      systemUnitPriceCents: null,
      differenceCents: null,
      priceOverrideMode: "override_total_after_margin" as const,
      priceOverrideValueCents: 5000,
      priceOverrideSource: "staff" as const,
    };
    const next = {
      ...previous,
      message: null,
      systemPriceCents: 4200,
      systemUnitPriceCents: 2100,
      priceOverrideMode: null,
      priceOverrideValueCents: null,
      priceOverrideSource: null,
    };

    const preserved = preserveInboundPricingResolution(previous, next, 2);

    expect(preserved).toMatchObject({
      systemPriceCents: 4200,
      systemUnitPriceCents: 2100,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 5000,
      priceOverrideSource: "staff",
      effectiveTotalCents: 5000,
      effectiveUnitPriceCents: 2500,
    });
  });

  test("does not treat failed system pricing as a usable zero-dollar price", () => {
    const review = {
      systemPriceCents: null,
      systemUnitPriceCents: null,
      priceOverrideMode: null,
      priceOverrideValueCents: null,
    };

    expect(resolveInboundLineEffectivePricing(review, 3).effectiveTotalCents).toBe(0);
    expect(hasUsableInboundLinePrice(review, 3)).toBe(false);
  });
});
