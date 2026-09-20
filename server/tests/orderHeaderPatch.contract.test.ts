import { updateOrderSchema } from "@shared/schema";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  effectiveOrderFulfillmentMethod,
  fulfillmentMethodSemanticallyChanged,
  normalizeOrderPatchFulfillmentMethod,
  normalizeOrderPatchShipping,
  orderChangesRequireOrderBackedInvoiceSynchronization,
} from "../services/orders/orderHeaderUpdatePolicy";

describe("V1 Order header PATCH contract", () => {
  const orderId = "8ed91da0-5d50-4c82-b6f0-5c65a9d50a13";

  test.each([
    ["PO only", { poNumber: "PO-2026-104" }, { poNumber: "PO-2026-104" }],
    ["due date only", { dueDate: "2026-08-31T00:00:00.000Z" }, { dueDate: "2026-08-31T00:00:00.000Z" }],
    [
      "PO and due date together",
      { poNumber: "PO-2026-104", dueDate: "2026-08-31T00:00:00.000Z" },
      { poNumber: "PO-2026-104", dueDate: "2026-08-31T00:00:00.000Z" },
    ],
    ["clear both values", { poNumber: null, dueDate: null }, { poNumber: null, dueDate: null }],
  ])("accepts and preserves %s payload", (_name, payload, expected) => {
    const parsed = updateOrderSchema.parse({ id: orderId, ...payload });

    expect(parsed).toMatchObject(expected);
    expect(Object.keys(parsed).sort()).toEqual(["id", ...Object.keys(expected)].sort());
    expect(orderChangesRequireOrderBackedInvoiceSynchronization(parsed)).toBe(false);
  });

  test("keeps draft-invoice synchronization for financial and identity changes", () => {
    expect(orderChangesRequireOrderBackedInvoiceSynchronization({ customerId: "customer-1" } as any)).toBe(true);
    expect(orderChangesRequireOrderBackedInvoiceSynchronization({ shippingCents: 1_250 } as any)).toBe(true);
    expect(orderChangesRequireOrderBackedInvoiceSynchronization({ tax: 12.5 } as any)).toBe(true);
  });

  test("does not inject shipping cents into a header-only pickup-order patch", () => {
    expect(normalizeOrderPatchShipping({ poNumber: "PO-20139", dueDate: "2026-08-21T12:00:00.000Z" }, "pickup")).toEqual({});
    expect(normalizeOrderPatchShipping({ shippingMethod: "pickup" }, "ship")).toEqual({ shippingCents: 0 });
    expect(normalizeOrderPatchShipping({ shippingCents: 500 }, "pickup")).toEqual({ shippingCents: 0 });
  });

  test("treats legacy fulfillment aliases as an unchanged method, not a terminal fulfillment transition", () => {
    expect(fulfillmentMethodSemanticallyChanged("shipping", "ship")).toBe(false);
    expect(fulfillmentMethodSemanticallyChanged("delivery", "deliver")).toBe(false);
    expect(fulfillmentMethodSemanticallyChanged(null, "ship")).toBe(false);
    expect(normalizeOrderPatchFulfillmentMethod({ shippingMethod: "ship" }, "shipping")).toEqual({ unchanged: true });
    expect(normalizeOrderPatchFulfillmentMethod({ shippingMethod: "deliver" }, "delivery")).toEqual({ unchanged: true });
    expect(normalizeOrderPatchFulfillmentMethod({ shippingCents: 2_500 }, "shipping")).toEqual({ unchanged: true });
  });

  test("uses the same legacy method projection as Order Detail before the route decides whether to invoke the terminal guard", () => {
    // Close Job Override deliberately permits Delivered without a Shipment.
    // The Order header route must see this as an unchanged fulfillment intent
    // when staff saves a commercial shipping-price correction.
    expect(effectiveOrderFulfillmentMethod("delivery")).toBe("deliver");
    expect(normalizeOrderPatchFulfillmentMethod({ shippingCents: 1_725 }, "delivery")).toEqual({ unchanged: true });
    expect(normalizeOrderPatchFulfillmentMethod({ shippingMethod: "deliver", shippingCents: 1_725 }, "delivery")).toEqual({ unchanged: true });
  });

  test("keeps actual Ship, Pickup, and Delivery transitions distinct", () => {
    expect(fulfillmentMethodSemanticallyChanged("ship", "pickup")).toBe(true);
    expect(fulfillmentMethodSemanticallyChanged("pickup", "delivery")).toBe(true);
    expect(normalizeOrderPatchFulfillmentMethod({ shippingMethod: "delivery" }, "ship")).toEqual({
      shippingMethod: "deliver",
      unchanged: false,
    });
  });

  test("does not treat a commercial shipping-price correction as a fulfillment-method transition", () => {
    const persistedCloseOverrideOrder = { shippingMethod: "ship", fulfillmentStatus: "delivered", shipmentCount: 0 };

    expect(normalizeOrderPatchFulfillmentMethod({ shippingCents: 2_000 }, persistedCloseOverrideOrder.shippingMethod))
      .toEqual({ unchanged: true });
    expect(normalizeOrderPatchFulfillmentMethod({ shippingMethod: "ship", shippingCents: 2_000 }, persistedCloseOverrideOrder.shippingMethod))
      .toEqual({ unchanged: true });
  });

  test("invokes the terminal fulfillment guard from the Order PATCH route only for a semantic method change", () => {
    const routes = readFileSync(path.resolve(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
    const fulfillmentService = readFileSync(path.resolve(process.cwd(), "server/services/fulfillment/service.ts"), "utf8");

    expect(routes).toContain("const fulfillmentMethodPatch = normalizeOrderPatchFulfillmentMethod(req.body, existingOrder.shippingMethod);");
    expect(routes).toContain("if (!fulfillmentMethodPatch.unchanged) {");
    expect(routes).toContain("assertFulfillmentMethodChangeAllowed(organizationId, req.params.id, req.body.shippingMethod)");
    expect(fulfillmentService).toContain("Completed fulfillment cannot be changed from this Order edit. Use the supported fulfillment correction workflow.");
  });
});
