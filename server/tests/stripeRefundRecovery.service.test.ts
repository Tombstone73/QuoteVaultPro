import { describe, expect, test } from "@jest/globals";
import { StripeRefundRecoveryError, verifyStripeRefundRecoveryTruth } from "../services/stripeRefundRecoveryValidation";

const refundRequest = {
  id: "refund-request-1",
  organizationId: "org-1",
  invoiceId: "invoice-1",
  paymentId: "payment-1",
  stripeRefundId: "re_existing",
  amountCents: 200,
};
const payment = { id: "payment-1", stripePaymentIntentId: "pi_existing" };
const stripeAccountId = "acct_connected";

function processorRefund(overrides: Record<string, any> = {}) {
  return {
    id: "re_existing",
    payment_intent: "pi_existing",
    amount: 200,
    currency: "usd",
    status: "succeeded",
    created: 1_787_841_430,
    metadata: {
      organizationId: "org-1",
      invoiceId: "invoice-1",
      paymentId: "payment-1",
      stripeAccountId,
      refundRequestId: "refund-request-1",
    },
    ...overrides,
  };
}

function errorCode(overrides: Record<string, any>): string {
  try {
    verifyStripeRefundRecoveryTruth({ refundRequest, payment, stripeAccountId, refund: processorRefund(overrides) });
    return "NO_ERROR";
  } catch (error) {
    return error instanceof StripeRefundRecoveryError ? error.code : "UNEXPECTED";
  }
}

describe("Stripe processor-truth refund recovery validation", () => {
  test("accepts a succeeded existing Stripe refund without any Stripe mutation", () => {
    const verified = verifyStripeRefundRecoveryTruth({ refundRequest, payment, stripeAccountId, refund: processorRefund() });
    expect(verified.processorStatus).toBe("succeeded");
    expect(verified.occurredAt.toISOString()).toBe("2026-08-27T14:37:10.000Z");
  });

  test.each([
    ["refund id", { id: "re_other" }, "STRIPE_REFUND_PROCESSOR_ID_MISMATCH"],
    ["PaymentIntent", { payment_intent: "pi_other" }, "STRIPE_REFUND_PROCESSOR_PAYMENT_INTENT_MISMATCH"],
    ["amount", { amount: 201 }, "STRIPE_REFUND_PROCESSOR_AMOUNT_MISMATCH"],
    ["organization metadata", { metadata: { ...processorRefund().metadata, organizationId: "org-other" } }, "STRIPE_REFUND_PROCESSOR_ORGANIZATION_MISMATCH"],
    ["invoice metadata", { metadata: { ...processorRefund().metadata, invoiceId: "invoice-other" } }, "STRIPE_REFUND_PROCESSOR_INVOICE_MISMATCH"],
    ["payment metadata", { metadata: { ...processorRefund().metadata, paymentId: "payment-other" } }, "STRIPE_REFUND_PROCESSOR_PAYMENT_MISMATCH"],
    ["refund request metadata", { metadata: { ...processorRefund().metadata, refundRequestId: "request-other" } }, "STRIPE_REFUND_PROCESSOR_REQUEST_MISMATCH"],
    ["connected account metadata", { metadata: { ...processorRefund().metadata, stripeAccountId: "acct-other" } }, "STRIPE_REFUND_PROCESSOR_ACCOUNT_MISMATCH"],
    ["nonterminal processor status", { status: "pending" }, "STRIPE_REFUND_NOT_TERMINAL"],
  ])("fails closed on %s mismatch", (_label, overrides, expected) => {
    expect(errorCode(overrides)).toBe(expected);
  });

  test("accepts failed and canceled terminal processor states for canonical settlement", () => {
    expect(verifyStripeRefundRecoveryTruth({ refundRequest, payment, stripeAccountId, refund: processorRefund({ status: "failed" }) }).processorStatus).toBe("failed");
    expect(verifyStripeRefundRecoveryTruth({ refundRequest, payment, stripeAccountId, refund: processorRefund({ status: "canceled" }) }).processorStatus).toBe("canceled");
  });

  test("requires the durable processor refund and original PaymentIntent identities", () => {
    expect(() => verifyStripeRefundRecoveryTruth({ refundRequest: { ...refundRequest, stripeRefundId: null }, payment, stripeAccountId, refund: processorRefund() })).toThrow("Stripe refund id");
    expect(() => verifyStripeRefundRecoveryTruth({ refundRequest, payment: { ...payment, stripePaymentIntentId: null }, stripeAccountId, refund: processorRefund() })).toThrow("PaymentIntent");
  });
});
