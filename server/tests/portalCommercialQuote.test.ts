import { describe, expect, jest, test } from "@jest/globals";
// Read-projection test only: fail if it tries to access any database method.
jest.unstable_mockModule("../db", () => ({ db: {}, hasQuoteAttachmentPagesTable: () => false, pool: {} }));
const { mapQuoteDetail, isPortalQuoteInCustomerScope } = await import("../services/portal.service");
const { emailService } = await import("../emailService");

describe("portal customer Quote commercial DTO", () => {
  test("Quote email document uses saved tax, fulfillment and charge without internal margin or notes", () => {
    const html = (emailService as any).generateQuoteEmailHTML({ quoteNumber: 1, createdAt: new Date(),
      shippingMethod: "ship", shippingCents: 2500, subtotal: "250.00", taxRate: 0.1, taxAmount: "18.75",
      totalPrice: "293.75", marginPercentage: 0.5, shippingInstructions: "PRIVATE",
      lineItems: [{ id: "line", productName: "Banner", quantity: 100, linePrice: "250.00" }] });
    for (const value of ["Fulfillment: Shipping", "Unit Price", "Line Total", "$2.50", "$250.00", "$18.75", "$25.00", "$293.75"]) expect(html).toContain(value);
    expect(html).not.toMatch(/Margin|PRIVATE|125\.00/);
  });
  test("exposes fulfillment and saved commercial charges without internal notes", () => {
    const dto = mapQuoteDetail({ id: "q", status: "active", shippingMethod: "deliver", shippingCents: 2500,
      discountAmount: "5.00", subtotal: "250.00", taxAmount: "18.75", totalPrice: "288.75",
      shippingInstructions: "PRIVATE", carrierAccountNumber: "INTERNAL" } as any, []);
    expect(dto).toMatchObject({ fulfillmentLabel: "Delivery", shippingLabel: "Delivery", shipping: 25, discount: 5, total: 288.75 });
    expect(JSON.stringify(dto)).not.toMatch(/PRIVATE|INTERNAL|shippingInstructions/);
  });
  test("rolls up using shared policy, retaining parent's fields/options and stored document totals", () => {
    const quote = { id: "q", quoteNumber: 1, organizationId: "org", customerId: "customer", status: "active", subtotal: "424.57", taxAmount: "10.00", totalPrice: "434.57" };
    const lines = [
      { id: "a", productName: "ACM", quantity: 2, width: 54.21, height: 47.5, linePrice: "220.44", displayOrder: 0, selectedOptions: [{ optionName: "Finish", value: "Matte" }] },
      { id: "a1", parentLineItemId: "a", productName: "Hidden vinyl", quantity: 10, width: 1, height: 1, linePrice: "108.00", displayOrder: 1 },
      { id: "b", productName: "Vinyl", quantity: 2, linePrice: "30.00", displayOrder: 2 },
      { id: "b1", parentLineItemId: "b", productName: "Hidden ACM", quantity: 3, linePrice: "66.13", displayOrder: 3 },
    ];
    const before = structuredClone(lines);
    const dto = mapQuoteDetail(quote as any, lines as any);
    expect(dto.lineItems.map((line) => [line.id, line.lineTotal])).toEqual([["a", 328.44], ["b", 96.13]]);
    expect(dto.lineItems[0]).toMatchObject({ name: "ACM", quantity: 2, dimensions: { width: 54.21, height: 47.5 }, displayOptions: ["Finish: Matte"] });
    expect(dto).toMatchObject({ itemCount: 2, subtotal: 424.57, tax: 10, total: 434.57 });
    expect(lines).toEqual(before);
    expect(isPortalQuoteInCustomerScope(quote as any, { organizationId: "other", customerId: "customer" })).toBe(false);
    expect(isPortalQuoteInCustomerScope(quote as any, { organizationId: "org", customerId: "other" })).toBe(false);
  });
});
