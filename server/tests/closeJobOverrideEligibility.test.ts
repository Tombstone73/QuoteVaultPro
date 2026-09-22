import { canCloseJobOverrideFromCanonicalObligations } from "../services/fulfillment/closeJobOverrideEligibility";

describe("Close Job Override eligibility projection", () => {
  test("allows remaining production work even when a parent status looks terminal", () => {
    expect(canCloseJobOverrideFromCanonicalObligations({
      canceled: false,
      remainingProductionQuantity: 1,
      remainingFulfillmentQuantity: 0,
    })).toBe(true);
  });

  test("allows remaining administrative fulfillment work", () => {
    expect(canCloseJobOverrideFromCanonicalObligations({
      canceled: false,
      remainingProductionQuantity: 0,
      remainingFulfillmentQuantity: 3,
    })).toBe(true);
  });

  test("hides the action after all canonical obligations are reconciled", () => {
    expect(canCloseJobOverrideFromCanonicalObligations({
      canceled: false,
      remainingProductionQuantity: 0,
      remainingFulfillmentQuantity: 0,
    })).toBe(false);
  });

  test("never exposes the action for cancelled work", () => {
    expect(canCloseJobOverrideFromCanonicalObligations({
      canceled: true,
      remainingProductionQuantity: 1,
      remainingFulfillmentQuantity: 1,
    })).toBe(false);
  });
});
