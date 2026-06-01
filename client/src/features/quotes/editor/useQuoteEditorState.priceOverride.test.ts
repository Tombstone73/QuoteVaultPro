import { describe, expect, it } from "@jest/globals";

import { buildQuoteLineItemSavePayload } from "./quoteLineItemSavePayload";
import type { QuoteLineItemDraft } from "./types";

function pricedLineItem(overrides: Partial<QuoteLineItemDraft> = {}): QuoteLineItemDraft {
  return {
    id: "li-1",
    productId: "product-1",
    productName: "Product",
    variantId: null,
    variantName: null,
    productType: "wide_roll",
    width: 12,
    height: 12,
    quantity: 3,
    specsJson: {},
    selectedOptions: [],
    linePrice: 52.5,
    priceOverridden: false,
    overriddenPrice: null,
    formulaLinePrice: 52.5,
    priceBreakdown: { basePrice: 52.5, optionsPrice: 0, total: 52.5, formula: "" },
    displayOrder: 0,
    status: "active",
    ...overrides,
  } as QuoteLineItemDraft;
}

describe("quote line item save payload price override metadata", () => {
  it("strips default zero override cents when no explicit override metadata exists", () => {
    const payload = buildQuoteLineItemSavePayload(pricedLineItem({
      priceOverride: null,
      overridePriceCents: 0,
    }));

    expect(payload.priceOverride).toBeNull();
    expect(payload.priceOverrideMode).toBeNull();
    expect(payload.priceOverrideValueCents).toBeNull();
    expect(payload.overridePriceCents).toBeNull();
  });

  it("sends explicit total override metadata, including intentional zero", () => {
    const payload = buildQuoteLineItemSavePayload(pricedLineItem(), {
      linePrice: 0,
      priceOverride: {
        mode: "override_total_after_margin",
        valueCents: 0,
      },
      overridePriceCents: 0,
    } as Partial<QuoteLineItemDraft>);

    expect(payload.priceOverride).toEqual({
      mode: "override_total_after_margin",
      valueCents: 0,
    });
    expect(payload.priceOverrideMode).toBe("override_total_after_margin");
    expect(payload.priceOverrideValueCents).toBe(0);
    expect(payload.overridePriceCents).toBe(0);
  });

  it("sends explicit unit override metadata with effective total cents", () => {
    const payload = buildQuoteLineItemSavePayload(pricedLineItem(), {
      linePrice: 30,
      priceOverride: {
        mode: "override_unit_after_margin",
        valueCents: 1000,
      },
      overridePriceCents: 3000,
    } as Partial<QuoteLineItemDraft>);

    expect(payload.priceOverrideMode).toBe("override_unit_after_margin");
    expect(payload.priceOverrideValueCents).toBe(1000);
    expect(payload.overridePriceCents).toBe(3000);
  });

  it("clears stale override metadata when reverting to calculated pricing", () => {
    const payload = buildQuoteLineItemSavePayload(pricedLineItem({
      priceOverride: {
        mode: "override_total_after_margin",
        valueCents: 4000,
      },
      overridePriceCents: 4000,
    }), {
      linePrice: 52.5,
      priceOverride: null,
      overridePriceCents: null,
    });

    expect(payload.priceOverride).toBeNull();
    expect(payload.priceOverrideMode).toBeNull();
    expect(payload.priceOverrideValueCents).toBeNull();
    expect(payload.overridePriceCents).toBeNull();
  });
});
