import {
  calculateBundleChildTotalCents,
  getBillableBundleRoots,
  getCustomerVisibleBundleLines,
  parentBundlePricingUpdate,
} from "../services/lineItemBundles";
import { calculateQuoteAggregateTotals } from "../routes/helpers/quoteTotals.helpers";
import { isProductionEligibleBundleLineItem } from "../services/productionScheduling";
import { resolveOrderLineItemInvoicePricing } from "../lib/downstreamEffectivePricing";

describe("line item bundles", () => {
  const children = [
    { id: "child-a", lineItemRole: "child", parentLineItemId: "parent", linePrice: "12.50", isTaxableSnapshot: true },
    { id: "child-b", lineItemRole: "child", parentLineItemId: "parent", linePrice: "7.25", isTaxableSnapshot: true },
  ] as const;

  it("derives a parent total from its child totals", () => {
    expect(calculateBundleChildTotalCents([...children])).toBe(1975);
    expect(parentBundlePricingUpdate({ id: "parent", parentPriceMode: "sum_children" }, [...children]))
      .toMatchObject({ childCalculatedTotalCents: 1975, effectiveTotalCents: 1975, totalPrice: 19.75 });
  });

  it("preserves a manual parent price while retaining calculated child totals", () => {
    expect(parentBundlePricingUpdate({ id: "parent", parentPriceMode: "manual_override", linePrice: "25.00" }, [...children]))
      .toMatchObject({ childCalculatedTotalCents: 1975, effectiveTotalCents: 2500, totalPrice: 25 });
  });

  it("does not double count hidden children in quote totals", () => {
    const parent = { id: "parent", lineItemRole: "parent", linePrice: "19.75", isTaxableSnapshot: true };
    expect(getBillableBundleRoots([parent, ...children])).toEqual([parent]);
    expect(calculateQuoteAggregateTotals({ lineItems: [parent, ...children], taxRate: 0 })).toMatchObject({ subtotal: 19.75, totalPrice: 19.75 });
  });

  it("keeps a normal parent and linked existing child independently billable", () => {
    const parent = { id: "parent", lineItemRole: "standalone", linePrice: "123.00", isTaxableSnapshot: true };
    const child = {
      id: "child",
      lineItemRole: "child",
      parentLineItemId: "parent",
      linePrice: "57.00",
      isTaxableSnapshot: true,
      specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 5700, effectiveTotalCents: 5700 } },
    };

    expect(getBillableBundleRoots([parent, child]).map((line) => line.id)).toEqual(["parent", "child"]);
    expect(calculateQuoteAggregateTotals({ lineItems: [parent, child], taxRate: 0 }))
      .toMatchObject({ subtotal: 180, totalPrice: 180 });
    expect(child.linePrice).toBe("57.00");
  });

  it("preserves linked prices when unlinking or changing a normal parent", () => {
    const parentA = { id: "parent-a", lineItemRole: "standalone", linePrice: "123.00", isTaxableSnapshot: true };
    const parentB = { id: "parent-b", lineItemRole: "standalone", linePrice: "10.00", isTaxableSnapshot: true };
    const child = { id: "child", lineItemRole: "child", parentLineItemId: "parent-a", linePrice: "57.00", isTaxableSnapshot: true };

    const subtotal = (lines: any[]) => calculateQuoteAggregateTotals({ lineItems: lines, taxRate: 0 }).subtotal;
    expect(subtotal([parentA, parentB, child])).toBe(190);
    expect(subtotal([parentA, parentB, { ...child, parentLineItemId: "parent-b" }])).toBe(190);
    expect(subtotal([parentA, parentB, { ...child, parentLineItemId: null, lineItemRole: "standalone" }])).toBe(190);
    expect(child.linePrice).toBe("57.00");
  });

  it("includes multiple normal linked children once and keeps parent overrides intact", () => {
    const parent = {
      id: "parent",
      lineItemRole: "standalone",
      linePrice: "123.00",
      overridePriceCents: 12300,
      specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 12300, effectiveTotalCents: 12300 } },
    };
    const childA = { id: "child-a", lineItemRole: "child", parentLineItemId: "parent", linePrice: "57.00" };
    const childB = { id: "child-b", lineItemRole: "child", parentLineItemId: "parent", linePrice: "20.00" };

    expect(getBillableBundleRoots([parent, childA, childB]).map((line) => line.id)).toEqual(["parent", "child-a", "child-b"]);
    expect(calculateQuoteAggregateTotals({ lineItems: [parent, childA, childB], taxRate: 0 }))
      .toMatchObject({ subtotal: 200, totalPrice: 200 });
    expect(parent.linePrice).toBe("123.00");
  });

  it("builds downstream invoice pricing from each normal linked commercial line exactly once", () => {
    const parent = { id: "parent", lineItemRole: "standalone", quantity: 1, unitPrice: "123.00", totalPrice: "123.00" };
    const child = {
      id: "child",
      lineItemRole: "child",
      parentLineItemId: "parent",
      quantity: 1,
      unitPrice: "57.00",
      totalPrice: "57.00",
      specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 5700, effectiveTotalCents: 5700 } },
    };

    const invoiceCents = getBillableBundleRoots([parent, child])
      .reduce((total, line) => total + resolveOrderLineItemInvoicePricing(line).effectiveTotalCents, 0);
    expect(invoiceCents).toBe(18_000);
  });

  it("returns visible children for customer rendering without making them billable", () => {
    const parent = { id: "parent", lineItemRole: "parent", childDisplayMode: "visible_detail", linePrice: "19.75" };
    expect(getCustomerVisibleBundleLines([parent, ...children]).map((line) => line.id)).toEqual(["parent", "child-a", "child-b"]);
    expect(getBillableBundleRoots([parent, ...children]).map((line) => line.id)).toEqual(["parent"]);
  });

  it("keeps standalone behavior and never schedules a parent wrapper", () => {
    expect(getBillableBundleRoots([{ id: "standalone", linePrice: "8.00" }]).map((line) => line.id)).toEqual(["standalone"]);
    expect(isProductionEligibleBundleLineItem({ lineItemRole: "parent", requiresProductionJob: true, workflowIntent: "standard_production" })).toBe(false);
    expect(isProductionEligibleBundleLineItem({ lineItemRole: "child", requiresProductionJob: true, workflowIntent: "standard_production" })).toBe(true);
  });

  it("does not schedule a production-bypassed child or standalone line", () => {
    expect(isProductionEligibleBundleLineItem({ lineItemRole: "standalone", requiresProductionJob: true, workflowIntent: "standard_production", productionBypassed: true })).toBe(false);
    expect(isProductionEligibleBundleLineItem({ lineItemRole: "child", requiresProductionJob: true, workflowIntent: "standard_production", productionBypassed: true })).toBe(false);
  });
});
