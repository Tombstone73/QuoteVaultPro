import { describe, expect, test } from "@jest/globals";
import { getStripeRefundEligibility, stripeRefundIdempotencyKey, validateStripeRefundAmount } from "../services/stripeRefund.service";

const original = {
  id: "payment-1",
  provider: "stripe",
  status: "succeeded",
  amountCents: 10_000,
  stripePaymentIntentId: "pi_123",
};

describe("Stripe refund initiation policy", () => {
  test("allows a full refund in cents", () => {
    const eligibility = getStripeRefundEligibility({ originalPayment: original, refundEffects: [] });
    expect(eligibility).toMatchObject({ ok: true, remainingCents: 10_000 });
    expect(validateStripeRefundAmount(10_000, eligibility.ok ? eligibility.remainingCents : 0)).toEqual({ ok: true, amountCents: 10_000 });
  });

  test("allows a partial refund and calculates cumulative successful refunds", () => {
    const eligibility = getStripeRefundEligibility({
      originalPayment: original,
      refundEffects: [{ status: "refunded", amountCents: 2_500, metadata: { stripeRefund: { originalPaymentId: "payment-1" } } }],
    });
    expect(eligibility).toMatchObject({ ok: true, alreadyRefundedCents: 2_500, remainingCents: 7_500 });
    expect(validateStripeRefundAmount(7_500, eligibility.ok ? eligibility.remainingCents : 0)).toEqual({ ok: true, amountCents: 7_500 });
  });

  test("reserves pending initiated refunds without adding a pending payment effect", () => {
    const eligibility = getStripeRefundEligibility({ originalPayment: original, refundEffects: [], pendingReservationCents: 8_000 });
    expect(eligibility).toMatchObject({ ok: true, pendingRefundCents: 8_000, remainingCents: 2_000 });
    expect(validateStripeRefundAmount(2_001, eligibility.ok ? eligibility.remainingCents : 0)).toMatchObject({ ok: false, code: "STRIPE_REFUND_AMOUNT_EXCEEDS_REMAINING" });
  });

  test("denies non-Stripe and unsettled payments", () => {
    expect(getStripeRefundEligibility({ originalPayment: { ...original, provider: "manual" }, refundEffects: [] })).toMatchObject({ ok: false, code: "STRIPE_REFUND_PROVIDER_INVALID" });
    expect(getStripeRefundEligibility({ originalPayment: { ...original, status: "pending" }, refundEffects: [] })).toMatchObject({ ok: false, code: "STRIPE_REFUND_PAYMENT_NOT_SETTLED" });
  });

  test("uses a stable payment-scoped Stripe idempotency key", () => {
    expect(stripeRefundIdempotencyKey({ originalPaymentId: "payment-1", requestId: "ui-request-1" })).toBe("stripe-refund:payment-1:ui-request-1");
  });
});
