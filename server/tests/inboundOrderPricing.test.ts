import {
  getInboundPoPriceSuggestion,
  hasUsableInboundLinePrice,
  resolveInboundLineEffectivePricing,
} from "@shared/inboundOrderPricing";

describe("inbound order effective pricing", () => {
  test("uses the system-calculated total when there is no override", () => {
    expect(resolveInboundLineEffectivePricing({ systemPriceCents: 4500 }, 3)).toMatchObject({
      effectiveUnitPriceCents: 1500,
      effectiveTotalCents: 4500,
      hasPriceOverride: false,
    });
  });

  test("applies a unit price override using quote/order override semantics", () => {
    expect(resolveInboundLineEffectivePricing({
      systemPriceCents: 4500,
      priceOverrideMode: "override_unit_after_margin",
      priceOverrideValueCents: 2000,
      priceOverrideSource: "staff",
    }, 3)).toMatchObject({
      effectiveUnitPriceCents: 2000,
      effectiveTotalCents: 6000,
      hasPriceOverride: true,
    });
  });

  test("applies a total override without multiplying it by quantity", () => {
    expect(resolveInboundLineEffectivePricing({
      systemPriceCents: 4500,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 5000,
    }, 3)).toMatchObject({
      effectiveUnitPriceCents: 1667,
      effectiveTotalCents: 5000,
      hasPriceOverride: true,
    });
  });

  test("surfaces PO unit and total prices as suggestions without applying them", () => {
    expect(getInboundPoPriceSuggestion({
      comparisonType: "unit",
      poUnitPriceCents: 1750,
      poTotalPriceCents: 5000,
    })).toEqual({ mode: "override_unit_after_margin", valueCents: 1750 });
    expect(getInboundPoPriceSuggestion({
      comparisonType: "total",
      poUnitPriceCents: 1750,
      poTotalPriceCents: 5000,
    })).toEqual({ mode: "override_total_after_margin", valueCents: 5000 });
  });

  test("fails closed without a system price or valid manual override", () => {
    expect(hasUsableInboundLinePrice(null, 1)).toBe(false);
    expect(hasUsableInboundLinePrice({
      systemPriceCents: 0,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 0,
    }, 1)).toBe(false);
    expect(hasUsableInboundLinePrice({
      systemPriceCents: 0,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 2500,
    }, 1)).toBe(true);
  });
});
