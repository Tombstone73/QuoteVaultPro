import { describe, expect, test } from "@jest/globals";

import {
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
});
