import { describe, expect, test } from "@jest/globals";
import { getFulfillmentOrderDetailPath } from "@/lib/fulfillmentOrderNavigation";

describe("fulfillment order navigation", () => {
  test("uses the order-detail route for an order-number link", () => {
    expect(getFulfillmentOrderDetailPath("order-20002")).toBe("/orders/order-20002");
  });
});
