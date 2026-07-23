import {
  calculateBundleChildTotalCents,
  getBillableBundleRoots,
  getCustomerVisibleBundleLines,
  parentBundlePricingUpdate,
} from "../services/lineItemBundles";
import { calculateQuoteAggregateTotals } from "../routes/helpers/quoteTotals.helpers";
import { isProductionEligibleBundleLineItem } from "../services/productionScheduling";

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
