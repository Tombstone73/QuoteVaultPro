import { isFulfillmentQueueEligibleOrder } from "../services/fulfillment/eligibility";

describe("fulfillment queue eligibility", () => {
  test("allows production-complete ship orders routed to fulfillment", () => {
    expect(isFulfillmentQueueEligibleOrder({
      state: "production_complete",
      status: "ready_for_shipment",
      routingTarget: "fulfillment",
      shippingMethod: "ship",
      canceledAt: null,
    })).toBe(true);
  });

  test("allows production-complete pickup orders", () => {
    expect(isFulfillmentQueueEligibleOrder({
      state: "production_complete",
      status: "ready_for_pickup",
      routingTarget: null,
      shippingMethod: "pickup",
      canceledAt: null,
    })).toBe(true);
  });

  test("blocks dashboard/list mismatches for ready canonical orders that are not production-complete", () => {
    expect(isFulfillmentQueueEligibleOrder({
      state: "open",
      status: "ready_for_shipment",
      routingTarget: "fulfillment",
      shippingMethod: "ship",
      canceledAt: null,
    })).toBe(false);
  });

  test("blocks cancelled orders", () => {
    expect(isFulfillmentQueueEligibleOrder({
      state: "production_complete",
      status: "canceled",
      routingTarget: "fulfillment",
      shippingMethod: "ship",
      canceledAt: null,
    })).toBe(false);
  });
});
