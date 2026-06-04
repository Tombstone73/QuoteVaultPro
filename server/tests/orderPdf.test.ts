import { describe, expect, test } from "@jest/globals";
import { generateOrderPdfBytes, getOrderPdfEligibility } from "../lib/orderPdf";

const validOrder = {
  id: "order_1",
  orderNumber: "ORD-10023",
  displayNumber: "ORD-10023",
  poNumber: "PO-77",
  shippingMethod: "pickup",
  subtotal: "25.00",
  taxAmount: "0.00",
  total: "25.00",
  lineItems: [
    {
      id: "line_1",
      productId: "product_1",
      product: { name: "Banner" },
      width: "24",
      height: "36",
      quantity: 1,
      totalPrice: "25.00",
      status: "new",
      selectedOptions: [{ optionName: "Grommets", value: "Corners", setupCost: 0, calculatedCost: 0 }],
      materialUsageJson: [{ materialName: "13oz Vinyl", quantityUsed: 6, unitOfMeasure: "sqft" }],
    },
  ],
};

describe("order PDF generation", () => {
  test("allows a saved order with valid saved line items", async () => {
    expect(getOrderPdfEligibility(validOrder).eligible).toBe(true);

    const bytes = await generateOrderPdfBytes({
      order: validOrder,
      organization: { name: "Titan Graphics", settings: { currency: "USD" } },
    });

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("blocks unsaved and invalid orders", () => {
    expect(getOrderPdfEligibility({ ...validOrder, id: null }).eligible).toBe(false);
    expect(getOrderPdfEligibility({ ...validOrder, lineItems: [] }).eligible).toBe(false);
    expect(
      getOrderPdfEligibility({
        ...validOrder,
        lineItems: [{ ...validOrder.lineItems[0], status: "draft" }],
      }).eligible,
    ).toBe(false);
    expect(
      getOrderPdfEligibility({
        ...validOrder,
        lineItems: [{ ...validOrder.lineItems[0], id: null }],
      }).eligible,
    ).toBe(false);
  });

  test("excludes canceled line items from eligibility", () => {
    const eligibility = getOrderPdfEligibility({
      ...validOrder,
      lineItems: [
        { ...validOrder.lineItems[0], id: "canceled", status: "canceled" },
        { ...validOrder.lineItems[0], id: "active", status: "in_production" },
      ],
    });

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.lineItems).toHaveLength(1);
    expect(eligibility.lineItems[0].id).toBe("active");
  });
});
