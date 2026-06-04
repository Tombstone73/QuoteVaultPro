import { describe, expect, test } from "@jest/globals";
import { generateQuotePdfBytes, getQuotePdfEligibility } from "../lib/quotePdf";

const validDraftQuote = {
  id: "quote_1",
  quoteNumber: 1001,
  status: "draft",
  customerName: "Acme Print Buyer",
  subtotal: "25.00",
  taxAmount: "0.00",
  totalPrice: "25.00",
  lineItems: [
    {
      id: "line_1",
      productId: "product_1",
      productName: "Banner",
      width: "24",
      height: "36",
      quantity: 1,
      linePrice: "25.00",
      status: "active",
    },
  ],
};

describe("quote PDF generation", () => {
  test("allows a saved draft quote with valid line items", async () => {
    expect(getQuotePdfEligibility(validDraftQuote).eligible).toBe(true);

    const bytes = await generateQuotePdfBytes({
      quote: validDraftQuote,
      organization: { name: "Titan Graphics", settings: { currency: "USD" } },
    });

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("does not require quote status to be sent", () => {
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "draft" }).eligible).toBe(true);
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "pending" }).eligible).toBe(true);
  });

  test("blocks unsaved and invalid quotes", () => {
    expect(getQuotePdfEligibility({ ...validDraftQuote, id: null }).eligible).toBe(false);
    expect(getQuotePdfEligibility({ ...validDraftQuote, lineItems: [] }).eligible).toBe(false);
    expect(
      getQuotePdfEligibility({
        ...validDraftQuote,
        lineItems: [{ ...validDraftQuote.lineItems[0], status: "draft" }],
      }).eligible,
    ).toBe(false);
  });
});
