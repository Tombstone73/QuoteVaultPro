import { describe, expect, jest, test } from "@jest/globals";
// Read-projection test only: fail if it tries to access any database method.
jest.unstable_mockModule("../db", () => ({ db: {}, hasQuoteAttachmentPagesTable: () => false, pool: {} }));
const { mapQuoteDetail, isPortalQuoteInCustomerScope } = await import("../services/portal.service");

describe("portal customer Quote commercial DTO", () => {
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
