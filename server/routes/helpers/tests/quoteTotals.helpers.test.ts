import { calculateQuoteAggregateTotals } from "../quoteTotals.helpers";

describe("calculateQuoteAggregateTotals", () => {
  test("uses current PBV2 line prices for quote subtotal and total", () => {
    expect(
      calculateQuoteAggregateTotals({
        lineItems: [
          { linePrice: "44.00", status: "active", isTaxableSnapshot: true },
          { linePrice: "999.00", status: "canceled", isTaxableSnapshot: true },
        ],
        taxRate: 0,
      }),
    ).toEqual({
      subtotal: 44,
      taxableSubtotal: 44,
      taxAmount: 0,
      totalPrice: 44,
    });
  });

  test("keeps discount, tax, and shipping in the aggregate total", () => {
    expect(
      calculateQuoteAggregateTotals({
        lineItems: [{ linePrice: 100, status: "active", isTaxableSnapshot: true }],
        discountAmount: 10,
        taxRate: 0.07,
        shippingCents: 500,
      }),
    ).toEqual({
      subtotal: 100,
      taxableSubtotal: 90,
      taxAmount: 6.3,
      totalPrice: 101.3,
    });
  });
});
