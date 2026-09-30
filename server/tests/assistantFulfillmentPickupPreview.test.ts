import { describe, expect, it } from "@jest/globals";
import { FulfillmentOperationError, previewPendingFulfillmentPickup, resolveCanonicalPickupTarget } from "../services/assistant/fulfillmentOperationsService";

const detail = (overrides: Record<string, unknown> = {}) => ({
  orderId: "order_brainstorm_synthetic",
  orderNumber: "S-5000",
  fulfillmentType: "PICKUP",
  pickupTicket: { id: "ticket_synthetic", status: "DRAFT" },
  lineItems: [{
    id: "line_coroplast_synthetic",
    productName: "Coroplast signs",
    description: "Peterman Yard Signs",
    production: {
      orderedQuantity: 5000,
      // Canonical fulfillment has already netted +250, +1, -1 reversal, +350.
      pickedUpQuantity: 600,
      remainingQuantity: 4400,
    },
  }],
  ...overrides,
}) as any;

describe("Assistant governed fulfillment pickup preview", () => {
  it("uses the canonical synthetic line projection for a partial pickup", () => {
    const preview = previewPendingFulfillmentPickup(detail(), {
      orderId: "order_brainstorm_synthetic",
      fulfillmentOrderId: "order_brainstorm_synthetic",
      orderLineItemId: "line_coroplast_synthetic",
      quantity: 500,
    });

    expect(preview).toMatchObject({
      orderedQuantity: 5000,
      currentPickedUpQuantity: 600,
      requestedQuantity: 500,
      projectedPickedUpQuantity: 1100,
      projectedRemainingQuantity: 3900,
      pickupTicketId: "ticket_synthetic",
    });
  });

  it("binds an order-keyed fulfillment workspace to the same canonical target as the UI", () => {
    const target = resolveCanonicalPickupTarget({
      orderId: null,
      fulfillmentOrderId: "order_brainstorm_synthetic",
      orderLineItemId: "line_coroplast_synthetic",
    });
    expect(target).toEqual({
      orderId: "order_brainstorm_synthetic",
      orderLineItemId: "line_coroplast_synthetic",
      fulfillmentWorkspaceOrderId: "order_brainstorm_synthetic",
    });
    expect(previewPendingFulfillmentPickup(detail(), {
      orderId: null,
      fulfillmentOrderId: "order_brainstorm_synthetic",
      orderLineItemId: "line_coroplast_synthetic",
      quantity: 500,
    })).toMatchObject({ projectedPickedUpQuantity: 1100, projectedRemainingQuantity: 3900 });
  });

  it.each([
    ["missing order target", { orderId: null, fulfillmentOrderId: null, orderLineItemId: "line_coroplast_synthetic" }, "FULFILLMENT_TARGET_NOT_RESOLVABLE"],
    ["missing line target", { orderId: "order_brainstorm_synthetic", fulfillmentOrderId: null, orderLineItemId: null }, "FULFILLMENT_TARGET_NOT_RESOLVABLE"],
    ["conflicting workspace owner", { orderId: "order_brainstorm_synthetic", fulfillmentOrderId: "replacement_order", orderLineItemId: "line_coroplast_synthetic" }, "PICKUP_TARGET_MISMATCH"],
  ])("rejects %s before any fulfillment read or mutation", (_label, input, code) => {
    try {
      resolveCanonicalPickupTarget(input);
      throw new Error("Expected target resolution to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(FulfillmentOperationError);
      expect((error as FulfillmentOperationError).code).toBe(code);
    }
  });

  it("retains pickup eligibility independent of production-job status", () => {
    const preview = previewPendingFulfillmentPickup(detail({ lineItems: [{
      id: "line_coroplast_synthetic", productName: "Coroplast signs", description: "Peterman Yard Signs",
      production: { orderedQuantity: 5000, pickedUpQuantity: 600, remainingQuantity: 4400, status: "IN_PROGRESS" },
    }] }), {
      orderId: "order_brainstorm_synthetic", fulfillmentOrderId: "order_brainstorm_synthetic", orderLineItemId: "line_coroplast_synthetic", quantity: 500,
    });
    expect(preview.projectedPickedUpQuantity).toBe(1100);
  });

  it("keeps a missing canonical line distinct from an unresolvable target", () => {
    try {
      previewPendingFulfillmentPickup(detail(), {
        orderId: "order_brainstorm_synthetic",
        fulfillmentOrderId: "order_brainstorm_synthetic",
        orderLineItemId: "other_line",
        quantity: 500,
      });
      throw new Error("Expected missing line to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(FulfillmentOperationError);
      expect((error as FulfillmentOperationError).code).toBe("ORDER_LINE_NOT_FOUND");
    }
  });

  it.each([
    ["wrong fulfillment owner", { fulfillmentOrderId: "replacement_order" }],
    ["wrong order line", { orderLineItemId: "other_line" }],
    ["quantity over remaining", { quantity: 4401 }],
  ])("rejects %s without making an Assistant-side mutation", (_label, change) => {
    expect(() => previewPendingFulfillmentPickup(detail(), {
      orderId: "order_brainstorm_synthetic",
      fulfillmentOrderId: "order_brainstorm_synthetic",
      orderLineItemId: "line_coroplast_synthetic",
      quantity: 500,
      ...change,
    })).toThrow();
  });
});
