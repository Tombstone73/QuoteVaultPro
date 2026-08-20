import { updateOrderSchema } from "@shared/schema";
import { normalizeOrderPatchShipping, orderChangesRequireDraftInvoiceSynchronization } from "../services/orders/orderHeaderUpdatePolicy";

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
    expect(orderChangesRequireDraftInvoiceSynchronization(parsed)).toBe(false);
  });

  test("keeps draft-invoice synchronization for financial and identity changes", () => {
    expect(orderChangesRequireDraftInvoiceSynchronization({ customerId: "customer-1" } as any)).toBe(true);
    expect(orderChangesRequireDraftInvoiceSynchronization({ shippingCents: 1_250 } as any)).toBe(true);
    expect(orderChangesRequireDraftInvoiceSynchronization({ tax: 12.5 } as any)).toBe(true);
  });

  test("does not inject shipping cents into a header-only pickup-order patch", () => {
    expect(normalizeOrderPatchShipping({ poNumber: "PO-20139", dueDate: "2026-08-21T12:00:00.000Z" }, "pickup")).toEqual({});
    expect(normalizeOrderPatchShipping({ shippingMethod: "pickup" }, "ship")).toEqual({ shippingCents: 0 });
    expect(normalizeOrderPatchShipping({ shippingCents: 500 }, "pickup")).toEqual({ shippingCents: 0 });
  });
});
