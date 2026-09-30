import { describe, expect, it } from "@jest/globals";
import { previewPendingFulfillmentPickup } from "../services/assistant/fulfillmentOperationsService";

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

  it("retains pickup eligibility independent of production-job status", () => {
    const preview = previewPendingFulfillmentPickup(detail({ lineItems: [{
      id: "line_coroplast_synthetic", productName: "Coroplast signs", description: "Peterman Yard Signs",
      production: { orderedQuantity: 5000, pickedUpQuantity: 600, remainingQuantity: 4400, status: "IN_PROGRESS" },
    }] }), {
      orderId: "order_brainstorm_synthetic", fulfillmentOrderId: "order_brainstorm_synthetic", orderLineItemId: "line_coroplast_synthetic", quantity: 500,
    });
    expect(preview.projectedPickedUpQuantity).toBe(1100);
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
