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

  test("keeps golden PBV2 repriced line values as quote aggregate source of truth", () => {
    expect(
      calculateQuoteAggregateTotals({
        lineItems: [
          { linePrice: "44.00", status: "active", isTaxableSnapshot: true },
          { linePrice: "329.60", status: "active", isTaxableSnapshot: true },
          { linePrice: "999.00", status: "canceled", isTaxableSnapshot: true },
        ],
        taxRate: 0,
      }),
    ).toEqual({
      subtotal: 373.6,
      taxableSubtotal: 373.6,
      taxAmount: 0,
      totalPrice: 373.6,
    });
  });

  test("uses effective totals for mixed unit and total overrides", () => {
    const override = (
      mode: "override_unit_after_margin" | "override_total_after_margin",
      valueCents: number,
      baseCalculatedTotalCents: number,
    ) => ({
      priceOverride: {
        schemaVersion: 1,
        mode,
        valueCents,
        valuePercent: null,
        baseCalculatedTotalCents,
      },
    });

    expect(
      calculateQuoteAggregateTotals({
        lineItems: [
          {
            linePrice: "100.00",
            quantity: 2,
            pbv2SnapshotJson: { pricing: { totalCents: 10000 } },
            specsJson: override("override_unit_after_margin", 9000, 10000),
            status: "active",
            isTaxableSnapshot: true,
          },
          {
            linePrice: "80.00",
            quantity: 1,
            pbv2SnapshotJson: { pricing: { totalCents: 8000 } },
            specsJson: override("override_total_after_margin", 4000, 8000),
            status: "active",
            isTaxableSnapshot: true,
          },
          {
            linePrice: "20.00",
            quantity: 2,
            pbv2SnapshotJson: { pricing: { totalCents: 2000 } },
            specsJson: override("override_unit_after_margin", 1100, 2000),
            status: "active",
            isTaxableSnapshot: true,
          },
          {
            linePrice: "0.00",
            quantity: 25,
            pbv2SnapshotJson: { pricing: { totalCents: 0 } },
            specsJson: override("override_unit_after_margin", 100, 0),
            status: "active",
            isTaxableSnapshot: true,
          },
          {
            linePrice: "999.00",
            quantity: 1,
            status: "canceled",
            isTaxableSnapshot: true,
          },
        ],
        taxRate: 0,
      }),
    ).toEqual({
      subtotal: 267,
      taxableSubtotal: 267,
      taxAmount: 0,
      totalPrice: 267,
    });
  });
});
