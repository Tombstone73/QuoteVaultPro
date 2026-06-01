import { describe, expect, it } from "@jest/globals";

import type { QuoteLineItemDraft } from "../types";
import { resolveQuoteLineItemOverrideUiState } from "./quoteLineItemPriceOverrideUiState";

function pricedLineItem(overrides: Partial<QuoteLineItemDraft> = {}): QuoteLineItemDraft {
  return {
    id: "quote-li-1",
    productId: "product-1",
    productName: "Saved Product",
    variantId: null,
    variantName: null,
    productType: "wide_roll",
    width: 1,
    height: 1,
    quantity: 3,
    specsJson: {},
    selectedOptions: [],
    linePrice: 8.88,
    priceOverridden: false,
    overriddenPrice: null,
    formulaLinePrice: 8.88,
    priceBreakdown: { total: 8.88, basePrice: 8.88, optionsPrice: 0, formula: "" },
    displayOrder: 0,
    status: "active",
    pbv2SnapshotJson: {
      pricing: {
        totalCents: 888,
      },
    },
    ...overrides,
  } as QuoteLineItemDraft;
}

describe("quote line item price override hydration", () => {
  it("keeps a calculated saved line item out of override mode when overridePriceCents defaults to zero", () => {
    const state = resolveQuoteLineItemOverrideUiState(
      pricedLineItem({
        priceOverride: null,
        overridePriceCents: 0,
      }),
    );

    expect(state.hasOverride).toBe(false);
    expect(state.persistedOverrideMode).toBeNull();
    expect(state.selectValue).toBe("__none");
    expect(state.overrideValueCents).toBeNull();
  });

  it("hydrates an explicit total override, including an intentional zero override", () => {
    const state = resolveQuoteLineItemOverrideUiState(
      pricedLineItem({
        priceOverride: {
          mode: "override_total_after_margin",
          valueCents: 0,
        },
        overridePriceCents: 0,
      }),
    );

    expect(state.hasOverride).toBe(true);
    expect(state.persistedOverrideMode).toBe("override_total_after_margin");
    expect(state.selectValue).toBe("override_total_after_margin");
    expect(state.overrideValueCents).toBe(0);
  });

  it("hydrates an explicit unit override", () => {
    const state = resolveQuoteLineItemOverrideUiState(
      pricedLineItem({
        priceOverride: {
          mode: "override_unit_after_margin",
          valueCents: 296,
        },
        overridePriceCents: 888,
      }),
    );

    expect(state.hasOverride).toBe(true);
    expect(state.persistedOverrideMode).toBe("override_unit_after_margin");
    expect(state.selectValue).toBe("override_unit_after_margin");
    expect(state.overrideValueCents).toBe(296);
  });
});
