import { readFileSync } from "node:fs";
import { applyLineItemEditPriceOverride, resolveLineItemEffectivePricing } from "@shared/lineItemPriceOverrides";
import { resolveQuoteLineItemOverrideModeChange } from "./quoteLineItemPriceOverrideUiState";

describe("New Order direct Unit Price editing", () => {
  test("calculated $6.00 x 20 stays automatic until edited", () => {
    const automatic = resolveLineItemEffectivePricing({ baseCalculatedTotalCents: 12_000, quantity: 20, override: null });
    expect(automatic).toMatchObject({ hasPriceOverride: false, effectiveUnitPriceCents: 600, effectiveTotalCents: 12_000 });
  });

  test("typing $5.50 uses the same canonical Unit Override value and payload meaning as selecting it", () => {
    const direct = applyLineItemEditPriceOverride({
      baseCalculatedTotalCents: 12_000, quantity: 20,
      mode: "override_unit_after_margin", valueCents: 550,
    });
    const selector = resolveQuoteLineItemOverrideModeChange({
      baseCalculatedTotalCents: 12_000, quantity: 20,
      mode: "override_unit_after_margin", rawValue: "5.50",
    });
    expect(direct).toMatchObject({
      hasPriceOverride: true, priceOverrideMode: "override_unit_after_margin",
      priceOverrideValueCents: 550, effectiveUnitPriceCents: 550, effectiveTotalCents: 11_000,
    });
    expect(selector?.pricing).toEqual(direct);
    expect(selector?.valueCents).toBe(550);
  });

  test("Total Override and later quantity changes retain the established semantics", () => {
    const total = applyLineItemEditPriceOverride({ baseCalculatedTotalCents: 12_000, quantity: 20, mode: "override_total_after_margin", valueCents: 11_000 });
    expect(total).toMatchObject({ priceOverrideMode: "override_total_after_margin", effectiveTotalCents: 11_000, effectiveUnitPriceCents: 550 });
    const unitAtNewQuantity = applyLineItemEditPriceOverride({ baseCalculatedTotalCents: 15_000, quantity: 25, mode: "override_unit_after_margin", valueCents: 550 });
    expect(unitAtNewQuantity).toMatchObject({ priceOverrideValueCents: 550, effectiveUnitPriceCents: 550, effectiveTotalCents: 13_750 });
    const cleared = resolveLineItemEffectivePricing({ baseCalculatedTotalCents: 12_000, quantity: 20, override: null });
    expect(cleared).toMatchObject({ hasPriceOverride: false, effectiveUnitPriceCents: 600, effectiveTotalCents: 12_000 });
  });

  test("only the Order path binds direct Unit Price edits to the existing override save path", () => {
    const source = readFileSync("client/src/features/quotes/editor/components/LineItemsSection.tsx", "utf8");
    expect(source).toContain('onUnitPriceClick={createTarget !== "order" || readOnly ? undefined');
    expect(source).toContain('const mode: LineItemPriceOverrideMode = "override_unit_after_margin"');
    expect(source).toContain('priceOverrideValueCents: nextValueCents');
    expect(source).toContain('await refreshQuotePricingAfterOverrideChange({');
    expect(source).toContain('readOnly || (createTarget === "order" && unitOverrideSelected)');
  });
});
