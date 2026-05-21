import { describe, expect, it } from "@jest/globals";
import { deriveLineItemPricingDisplay, type LineItemPricingDisplayInput } from "./lineItemPricingDisplay";

const baseInput: LineItemPricingDisplayInput = {
  isActiveItem: true,
  isOverride: false,
  persistedTotal: 100,
  persistedPerEach: 100,
  computedTotal: 100,
  computedTotalQty: 1,
  isDirty: false,
  isCalculating: false,
  hasCalcError: false,
};

describe("deriveLineItemPricingDisplay", () => {
  it("shows persisted price when item is not the active/expanded one", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isActiveItem: false,
      computedTotal: 999,
      computedTotalQty: 5,
    });
    expect(result.displayTotal).toBe(100);
    expect(result.displayPerEach).toBe(100);
    expect(result.isPreviewPrice).toBe(false);
  });

  it("shows persisted price for an overridden line item", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isOverride: true,
      computedTotal: 250,
      computedTotalQty: 2,
      isDirty: true,
    });
    expect(result.displayTotal).toBe(100);
    expect(result.isPreviewPrice).toBe(false);
  });

  it("shows persisted price when no preview total exists", () => {
    const result = deriveLineItemPricingDisplay({ ...baseInput, computedTotal: null });
    expect(result.displayTotal).toBe(100);
    expect(result.displayPerEach).toBe(100);
    expect(result.isPreviewPrice).toBe(false);
  });

  it("derives per-each from the priced quantity, not the live draft quantity", () => {
    // Stale window: total was priced for qty 1 ($100); the debounced recalc for
    // the new qty has not landed yet. Per-each must stay $100/1, NOT $100/2.
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      computedTotal: 100,
      computedTotalQty: 1,
    });
    expect(result.displayTotal).toBe(100);
    expect(result.displayPerEach).toBe(100); // consistent pair — total not "locked" vs a halved per-each
  });

  it("updates total and per-each together once the preview recalculates", () => {
    // After the recalc lands for qty 2: total $200 priced for qty 2.
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      computedTotal: 200,
      computedTotalQty: 2,
    });
    expect(result.displayTotal).toBe(200);
    expect(result.displayPerEach).toBe(100);
    expect(result.isPreviewPrice).toBe(true);
  });

  it("marks the price as an unsaved preview when it differs from persisted", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      computedTotal: 175,
      computedTotalQty: 1,
    });
    expect(result.isPreviewPrice).toBe(true);
  });

  it("does not mark a preview when the price is unchanged from persisted", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      computedTotal: 100,
      computedTotalQty: 1,
    });
    expect(result.isPreviewPrice).toBe(false);
  });

  it("does not mark a preview while a calculation is in flight", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      isCalculating: true,
      computedTotal: 175,
      computedTotalQty: 1,
    });
    expect(result.isPreviewPrice).toBe(false);
  });

  it("does not mark a preview when the calculation failed", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      hasCalcError: true,
      computedTotal: 175,
      computedTotalQty: 1,
    });
    expect(result.isPreviewPrice).toBe(false);
  });

  it("falls back to persisted per-each when priced quantity is missing or zero", () => {
    const result = deriveLineItemPricingDisplay({
      ...baseInput,
      isDirty: true,
      computedTotal: 200,
      computedTotalQty: 0,
    });
    expect(result.displayTotal).toBe(200);
    expect(result.displayPerEach).toBe(100); // persisted per-each, never 200/0
  });
});
