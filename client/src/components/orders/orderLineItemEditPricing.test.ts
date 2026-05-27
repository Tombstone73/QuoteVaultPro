import { describe, expect, it } from "@jest/globals";
import {
  applyLineItemEditPriceOverride,
  hydrateLineItemEditPricingState,
} from "@shared/lineItemPriceOverrides";
import { shouldApplyOrderLineItemPreviewResult } from "./orderLineItemEditState";

describe("order line item edit pricing state", () => {
  it("hydrates a saved $15 item as $15 without letting stale legacy cents win", () => {
    const state = hydrateLineItemEditPricingState({
      id: "li-1",
      quantity: 1,
      totalPrice: "15.00",
      baseCalculatedTotalCents: 1500,
      effectiveTotalCents: 1500,
      hasPriceOverride: false,
      overridePriceCents: 16000,
    });

    expect(state.baseCalculatedTotalCents).toBe(1500);
    expect(state.effectiveTotalCents).toBe(1500);
    expect(state.hasPriceOverride).toBe(false);
    expect(state.priceOverrideMode).toBeNull();
  });

  it("applies a total override immediately as the live effective total", () => {
    const next = applyLineItemEditPriceOverride({
      baseCalculatedTotalCents: 1500,
      quantity: 1,
      mode: "override_total_after_margin",
      valueCents: 1980,
    });

    expect(next.hasPriceOverride).toBe(true);
    expect(next.effectiveTotalCents).toBe(1980);
    expect(next.effectiveUnitPriceCents).toBe(1980);
  });

  it("applies a unit override immediately against quantity", () => {
    const next = applyLineItemEditPriceOverride({
      baseCalculatedTotalCents: 1500,
      quantity: 2,
      mode: "override_unit_after_margin",
      valueCents: 1980,
    });

    expect(next.effectiveTotalCents).toBe(3960);
    expect(next.effectiveUnitPriceCents).toBe(1980);
  });

  it("keeps a total override fixed when quantity changes", () => {
    const next = applyLineItemEditPriceOverride({
      baseCalculatedTotalCents: 1500,
      quantity: 2,
      mode: "override_total_after_margin",
      valueCents: 1980,
    });

    expect(next.effectiveTotalCents).toBe(1980);
    expect(next.effectiveUnitPriceCents).toBe(990);
  });

  it("hydrates persisted override metadata as the edit source of truth", () => {
    const state = hydrateLineItemEditPricingState({
      id: "li-2",
      quantity: 2,
      totalPrice: "39.60",
      baseCalculatedTotalCents: 1500,
      effectiveTotalCents: 3960,
      hasPriceOverride: true,
      priceOverrideMode: "override_unit_after_margin",
      priceOverrideValueCents: 1980,
    });

    expect(state.hasPriceOverride).toBe(true);
    expect(state.priceOverrideMode).toBe("override_unit_after_margin");
    expect(state.priceOverrideValueCents).toBe(1980);
    expect(state.effectiveTotalCents).toBe(3960);
  });

  it("ignores a delayed preview response when the edit draft is not dirty by user", () => {
    const gate = shouldApplyOrderLineItemPreviewResult({
      requestId: 1,
      latestRequestId: 1,
      requestFingerprint: "saved-15",
      currentFingerprint: "saved-15",
      isDirtyByUser: false,
      requestedBecauseOfUserChange: false,
      hasPendingManualOverride: false,
    });

    expect(gate.apply).toBe(false);
    expect(gate.reasonIgnored).toBe("not_dirty_by_user");
  });

  it("ignores a delayed preview response with a stale fingerprint", () => {
    const gate = shouldApplyOrderLineItemPreviewResult({
      requestId: 2,
      latestRequestId: 2,
      requestFingerprint: "qty-1",
      currentFingerprint: "qty-2",
      isDirtyByUser: true,
      requestedBecauseOfUserChange: true,
      hasPendingManualOverride: false,
    });

    expect(gate.apply).toBe(false);
    expect(gate.reasonIgnored).toBe("stale_fingerprint");
  });

  it("applies preview only after an explicit user pricing-driving change", () => {
    const gate = shouldApplyOrderLineItemPreviewResult({
      requestId: 3,
      latestRequestId: 3,
      requestFingerprint: "qty-2",
      currentFingerprint: "qty-2",
      isDirtyByUser: true,
      requestedBecauseOfUserChange: true,
      hasPendingManualOverride: false,
    });

    expect(gate.apply).toBe(true);
  });

  it("does not let a preview overwrite a pending manual override", () => {
    const gate = shouldApplyOrderLineItemPreviewResult({
      requestId: 4,
      latestRequestId: 4,
      requestFingerprint: "override-1980",
      currentFingerprint: "override-1980",
      isDirtyByUser: true,
      requestedBecauseOfUserChange: true,
      hasPendingManualOverride: true,
    });

    expect(gate.apply).toBe(false);
    expect(gate.reasonIgnored).toBe("manual_override_active");
  });
});
