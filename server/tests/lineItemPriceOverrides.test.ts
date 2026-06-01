import { describe, expect, test } from "@jest/globals";

import {
  buildQuoteLineItemPriceOverridePersistencePatch,
  getPersistedBaseCalculatedTotalCents,
  haveLineItemPricingDriversChanged,
  mergePricingIntoSpecsJson,
  resolvePersistedLineItemPricing,
} from "../lib/lineItemPricingPersistence";

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

  test("default legacy overridePriceCents zero does not activate an override", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 888,
      quantity: 3,
      body: {
        priceOverride: null,
        overridePriceCents: 0,
      },
      legacyOverridePriceCents: 0,
    });

    expect(pricing.hasPriceOverride).toBe(false);
    expect(pricing.priceOverrideMode).toBeNull();
    expect(pricing.effectiveTotalCents).toBe(888);
  });

  test("explicit zero override metadata is preserved", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 888,
      quantity: 3,
      body: {
        priceOverride: {
          mode: "override_total_after_margin",
          valueCents: 0,
        },
        overridePriceCents: 0,
      },
    });

    expect(pricing.hasPriceOverride).toBe(true);
    expect(pricing.priceOverrideMode).toBe("override_total_after_margin");
    expect(pricing.priceOverrideValueCents).toBe(0);
    expect(pricing.effectiveTotalCents).toBe(0);
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

  test("saving total override preserves persisted base when pricing drivers are unchanged", () => {
    const existingLineItem = {
      productId: "product-1",
      productVariantId: null,
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 1500 } },
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingPreviewPayload = {
      productId: "product-1",
      productVariantId: null,
      width: 12,
      height: 12,
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 16000 } },
    };

    expect(haveLineItemPricingDriversChanged({
      existingLineItem,
      incomingUpdate: incomingPreviewPayload,
    })).toBe(false);

    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: getPersistedBaseCalculatedTotalCents(existingLineItem),
      quantity: incomingPreviewPayload.quantity,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
        overridePriceCents: 1980,
      },
      specsJson: existingLineItem.specsJson,
    });

    expect(pricing.baseCalculatedTotalCents).toBe(1500);
    expect(pricing.effectiveTotalCents).toBe(1980);
  });

  test("saving unit override preserves persisted base when pricing drivers are unchanged", () => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 2,
      body: {
        priceOverrideMode: "override_unit_after_margin",
        priceOverrideValueCents: 1980,
        overridePriceCents: 3960,
      },
    });

    expect(pricing.baseCalculatedTotalCents).toBe(1500);
    expect(pricing.effectiveUnitPriceCents).toBe(1980);
    expect(pricing.effectiveTotalCents).toBe(3960);
  });

  test("removing override returns to persisted base when pricing drivers are unchanged", () => {
    const original = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });
    const specsJson = mergePricingIntoSpecsJson({ specsJson: {}, pricing: original });

    const cleared = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      body: {
        priceOverrideMode: null,
        priceOverrideValueCents: null,
        overridePriceCents: null,
      },
      specsJson,
      legacyOverridePriceCents: 1980,
    });

    expect(cleared.hasPriceOverride).toBe(false);
    expect(cleared.effectiveTotalCents).toBe(1500);
  });

  test("client preview base is ignored when pricing drivers are unchanged", () => {
    const existingLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { size: "small" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 1500 } },
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingUpdate = {
      productId: "product-1",
      width: 12,
      height: 12,
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { size: "small" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 16000 } },
    };

    expect(haveLineItemPricingDriversChanged({ existingLineItem, incomingUpdate })).toBe(false);
    expect(getPersistedBaseCalculatedTotalCents(existingLineItem)).toBe(1500);
  });

  test("pricing driver change allows server recomputed base before applying override", () => {
    const existingLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { size: "small" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 1500 } },
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingUpdate = {
      productId: "product-1",
      width: 24,
      height: 12,
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { size: "small" } },
    };

    expect(haveLineItemPricingDriversChanged({ existingLineItem, incomingUpdate })).toBe(true);

    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: 3000,
      quantity: incomingUpdate.quantity,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });

    expect(pricing.baseCalculatedTotalCents).toBe(3000);
    expect(pricing.effectiveTotalCents).toBe(1980);
  });

  test("legacy selected option changes count as pricing driver changes", () => {
    const existingLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: null,
      selectedOptions: [{ optionId: "finish", value: "matte" }],
      pbv2SnapshotJson: null,
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingUpdate = {
      productId: "product-1",
      width: 12,
      height: 12,
      quantity: 1,
      optionSelectionsJson: null,
      selectedOptions: [{ optionId: "finish", value: "gloss" }],
    };

    expect(haveLineItemPricingDriversChanged({ existingLineItem, incomingUpdate })).toBe(true);
  });

  test("preview snapshot changes alone do not count as pricing driver changes", () => {
    const existingLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2TreeVersionId: "tree-1",
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 1500 } },
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingUpdate = {
      productId: "product-1",
      width: 12,
      height: 12,
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2SnapshotJson: { treeVersionId: "tree-2", pricing: { totalCents: 16000 } },
    };

    expect(haveLineItemPricingDriversChanged({ existingLineItem, incomingUpdate })).toBe(false);
  });

  test("older original base metadata can repair a corrupted override base", () => {
    const corruptedLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 16000 } },
      totalPrice: "19.80",
      specsJson: {
        priceOverride: {
          mode: "override_total_after_margin",
          valueCents: 1980,
          originalBaseCalculatedTotalCents: 1500,
          baseCalculatedTotalCents: 16000,
          effectiveTotalCents: 1980,
        },
      },
    };

    expect(getPersistedBaseCalculatedTotalCents(corruptedLineItem)).toBe(1500);
  });

  test("preview payload cannot introduce corrupted base when override metadata is merged", () => {
    const existingLineItem = {
      productId: "product-1",
      width: "12",
      height: "12",
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 1500 } },
      totalPrice: "15.00",
      specsJson: {},
    };
    const incomingUpdate = {
      productId: "product-1",
      width: 12,
      height: 12,
      quantity: 1,
      optionSelectionsJson: { schemaVersion: 2, selected: { material: "vinyl" } },
      pbv2SnapshotJson: { treeVersionId: "tree-1", pricing: { totalCents: 16000 } },
    };

    const baseCalculatedTotalCents = haveLineItemPricingDriversChanged({ existingLineItem, incomingUpdate })
      ? Number(incomingUpdate.pbv2SnapshotJson.pricing.totalCents)
      : getPersistedBaseCalculatedTotalCents(existingLineItem);
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents,
      quantity: incomingUpdate.quantity,
      body: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 1980,
      },
    });
    const specsJson = mergePricingIntoSpecsJson({ specsJson: {}, pricing });

    expect((specsJson as any)?.priceOverride?.baseCalculatedTotalCents).toBe(1500);
    expect((specsJson as any)?.priceOverride?.effectiveTotalCents).toBe(1980);
  });

  test("quote line item PATCH total override persists metadata without writing legacy priceOverride column", () => {
    const patch = buildQuoteLineItemPriceOverridePersistencePatch({
      existingLineItem: {
        quantity: 3,
        linePrice: "8.88",
        pbv2SnapshotJson: { pricing: { totalCents: 888 } },
        specsJson: {},
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 8.88 },
      },
      incomingUpdate: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 4000,
        overridePriceCents: 4000,
      },
      appliedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(patch.linePrice).toBe(40);
    expect(patch.overridePriceCents).toBe(4000);
    expect(patch.formulaLinePrice).toBe(8.88);
    expect(patch.priceBreakdown.total).toBe(40);
    expect((patch.specsJson as any).priceOverride).toEqual(expect.objectContaining({
      mode: "override_total_after_margin",
      valueCents: 4000,
      baseCalculatedTotalCents: 888,
      effectiveTotalCents: 4000,
    }));
    expect(patch).not.toHaveProperty("priceOverride");
  });

  test("quote line item PATCH unit override multiplies by quantity", () => {
    const patch = buildQuoteLineItemPriceOverridePersistencePatch({
      existingLineItem: {
        quantity: 3,
        linePrice: "8.88",
        pbv2SnapshotJson: { pricing: { totalCents: 888 } },
        specsJson: {},
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 8.88 },
      },
      incomingUpdate: {
        priceOverrideMode: "override_unit_after_margin",
        priceOverrideValueCents: 1000,
        overridePriceCents: 3000,
      },
    });

    expect(patch.linePrice).toBe(30);
    expect(patch.overridePriceCents).toBe(3000);
    expect((patch.specsJson as any).priceOverride).toEqual(expect.objectContaining({
      mode: "override_unit_after_margin",
      valueCents: 1000,
      effectiveUnitPriceCents: 1000,
      effectiveTotalCents: 3000,
    }));
  });

  test("quote line item PATCH supports explicit zero total override", () => {
    const patch = buildQuoteLineItemPriceOverridePersistencePatch({
      existingLineItem: {
        quantity: 3,
        linePrice: "8.88",
        pbv2SnapshotJson: { pricing: { totalCents: 888 } },
        specsJson: {},
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 8.88 },
      },
      incomingUpdate: {
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 0,
        overridePriceCents: 0,
      },
    });

    expect(patch.linePrice).toBe(0);
    expect(patch.overridePriceCents).toBe(0);
    expect((patch.specsJson as any).priceOverride).toEqual(expect.objectContaining({
      mode: "override_total_after_margin",
      valueCents: 0,
      effectiveTotalCents: 0,
    }));
  });

  test("quote line item PATCH revert clears metadata and restores calculated line total", () => {
    const patch = buildQuoteLineItemPriceOverridePersistencePatch({
      existingLineItem: {
        quantity: 3,
        linePrice: "40.00",
        pbv2SnapshotJson: { pricing: { totalCents: 888 } },
        specsJson: {
          priceOverride: {
            mode: "override_total_after_margin",
            valueCents: 4000,
            baseCalculatedTotalCents: 888,
            effectiveTotalCents: 4000,
          },
        },
        overridePriceCents: 4000,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 40 },
      },
      incomingUpdate: {
        priceOverride: null,
        priceOverrideMode: null,
        priceOverrideValueCents: null,
        overridePriceCents: null,
      },
    });

    expect(patch.linePrice).toBe(8.88);
    expect(patch.overridePriceCents).toBeNull();
    expect(patch.formulaLinePrice).toBeNull();
    expect((patch.specsJson as any)?.priceOverride).toBeUndefined();
  });
});
