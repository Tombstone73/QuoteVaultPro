import { planFulfillmentMethodChange } from "../services/fulfillment/methodChangePolicy";

const base = {
  currentMethod: "ship", targetMethod: "pickup" as const, shippingCents: 1250,
  draftShipments: [{ id: "draft-one", orderCount: 1 }],
  hasNetTerminalQuantity: false, fulfillmentStatus: "pending", canceled: false, pickupReady: false,
};

describe("Fulfillment method change policy", () => {
  test("voids single-order drafts and removes shipping charge for pickup", () => {
    expect(planFulfillmentMethodChange(base)).toEqual({
      allowed: true, unchanged: false, draftIdsToVoid: ["draft-one"],
      shippingCents: 0, shippingChargeChanged: true,
    });
  });

  test("preserves address-independent shipping charge when changing to Delivery", () => {
    expect(planFulfillmentMethodChange({ ...base, targetMethod: "deliver" })).toMatchObject({
      allowed: true, draftIdsToVoid: ["draft-one"], shippingCents: 1250,
      shippingChargeChanged: false,
    });
  });

  test("blocks combined drafts without voiding work belonging to another Order", () => {
    expect(planFulfillmentMethodChange({ ...base, draftShipments: [{ id: "combined", orderCount: 2 }] }))
      .toMatchObject({ allowed: false, code: "COMBINED_DRAFT" });
  });

  test("blocks terminal quantity even if reversal could later make the net quantity zero", () => {
    expect(planFulfillmentMethodChange({ ...base, hasNetTerminalQuantity: true }))
      .toMatchObject({ allowed: false, code: "FULFILLMENT_METHOD_TERMINAL" });
  });

  test("blocks ready pickup and canceled Orders", () => {
    expect(planFulfillmentMethodChange({ ...base, pickupReady: true }))
      .toMatchObject({ allowed: false, code: "PICKUP_READY" });
    expect(planFulfillmentMethodChange({ ...base, canceled: true }))
      .toMatchObject({ allowed: false, code: "ORDER_CANCELED" });
  });
});