import { describe, expect, test } from "@jest/globals";

import { mergePricingIntoSpecsJson, resolvePersistedLineItemPricing } from "../lib/lineItemPricingPersistence";

describe("line item price override effective pricing", () => {
  test("creating with total override saves overridden total", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });

    expect(pricing.baseCalculatedTotalCents).toBe(1500);
    expect(pricing.effectiveTotalCents).toBe(1980);
    expect(pricing.effectiveUnitPriceCents).toBe(1980);
    expect(pricing.hasPriceOverride).toBe(true);
  });

  test("creating with unit override multiplies unit override by quantity", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 3,
      body: {
        priceOverrideMode: "override_unit_after_margin",
        priceOverrideValueCents: 660,
      },
    });

    expect(pricing.effectiveUnitPriceCents).toBe(660);
    expect(pricing.effectiveTotalCents).toBe(1980);
  });

  test("editing an existing overridden item preserves override metadata", () => {
    const original = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });
    const specsJson = mergePricingIntoSpecsJson({ specsJson: {}, pricing: original });

    const preserved = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      specsJson,
      legacyOverridePriceCents: 1980,
    });

    expect(preserved.priceOverrideMode).toBe("override_total_after_margin");
    expect(preserved.priceOverrideValueCents).toBe(1980);
    expect(preserved.effectiveTotalCents).toBe(1980);
  });

  test("changing quantity with unit override recalculates effective total", () => {
    const original = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 3,
      body: {
        priceOverrideMode: "override_unit_after_margin",
        priceOverrideValueCents: 660,
      },
    });
    const specsJson = mergePricingIntoSpecsJson({ specsJson: {}, pricing: original });

    const repriced = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 2400,
      quantity: 4,
      specsJson,
    });

    expect(repriced.effectiveUnitPriceCents).toBe(660);
    expect(repriced.effectiveTotalCents).toBe(2640);
  });

  test("changing quantity with total override keeps total fixed", () => {
    const original = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });
    const specsJson = mergePricingIntoSpecsJson({ specsJson: {}, pricing: original });

    const repriced = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 4500,
      quantity: 3,
      specsJson,
    });

    expect(repriced.effectiveTotalCents).toBe(1980);
    expect(repriced.effectiveUnitPriceCents).toBe(660);
  });

  test("removing override ignores legacy override cents", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: null,
      },
      specsJson: {
        priceOverride: {
          mode: "override_total_after_margin",
          valueCents: 1980,
        },
      },
      legacyOverridePriceCents: 1980,
    });

    expect(pricing.hasPriceOverride).toBe(false);
    expect(pricing.effectiveTotalCents).toBe(1500);
  });

  test("order subtotal uses effective totals", () => {
    const calculated = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
    });
    const overridden = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });

    const subtotalCents = [calculated, overridden].reduce((sum, item) => sum + item.effectiveTotalCents, 0);

    expect(subtotalCents).toBe(3480);
  });
});
