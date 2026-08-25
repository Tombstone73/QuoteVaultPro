import { getStripeRefundSummary } from "./stripeRefundUi";

describe("getStripeRefundSummary", () => {
  it("uses immutable Stripe refund payment effects to calculate a remaining amount", () => {
    const summary = getStripeRefundSummary(
      { id: "payment-original", provider: "stripe", status: "succeeded", amountCents: 10_000 },
      [
        { id: "payment-original", provider: "stripe", status: "succeeded", amountCents: 10_000 },
        {
          id: "refund-one",
          provider: "stripe",
          status: "refunded",
          amountCents: 2_500,
          metadata: { stripeRefund: { originalPaymentId: "payment-original" } },
        },
        {
          id: "refund-other-payment",
          provider: "stripe",
          status: "refunded",
          amountCents: 3_000,
          metadata: { stripeRefund: { originalPaymentId: "another-payment" } },
        },
      ],
    );

    expect(summary).toEqual({
      originalAmountCents: 10_000,
      alreadyRefundedCents: 2_500,
      remainingRefundableCents: 7_500,
    });
  });

  it("never produces a negative remaining amount when historical effects exceed the original amount", () => {
    const summary = getStripeRefundSummary(
      { id: "payment-original", amountCents: 1_000 },
      [{ provider: "stripe", status: "refunded", amountCents: 1_500, metadata: JSON.stringify({ stripeRefund: { originalPaymentId: "payment-original" } }) }],
    );

    expect(summary.remainingRefundableCents).toBe(0);
  });
});
