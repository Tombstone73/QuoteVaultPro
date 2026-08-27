export class StripeRefundRecoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

function requiredText(value: unknown, code: string, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new StripeRefundRecoveryError(code, message);
  return text;
}

function same(value: unknown, expected: string, code: string, message: string): void {
  if (String(value || "").trim() !== expected) throw new StripeRefundRecoveryError(code, message);
}

function statusOf(refund: any): string {
  return String(refund?.status || "").trim().toLowerCase();
}

/** Validate a Stripe Refund read under a trusted connected-account context. */
export function verifyStripeRefundRecoveryTruth(input: {
  refundRequest: any;
  payment: any;
  stripeAccountId: string;
  refund: any;
}): { processorStatus: "succeeded" | "failed" | "canceled"; occurredAt: Date } {
  const { refundRequest, payment, stripeAccountId, refund } = input;
  const refundId = requiredText(refundRequest?.stripeRefundId, "STRIPE_REFUND_PROCESSOR_ID_MISSING", "The durable refund request has no Stripe refund id.");
  const paymentIntentId = requiredText(payment?.stripePaymentIntentId, "STRIPE_REFUND_PAYMENT_INTENT_MISSING", "The original payment has no Stripe PaymentIntent id.");
  const metadata = refund?.metadata && typeof refund.metadata === "object" ? refund.metadata : {};

  same(refund?.id, refundId, "STRIPE_REFUND_PROCESSOR_ID_MISMATCH", "Stripe refund id does not match the durable refund request.");
  same(refund?.payment_intent, paymentIntentId, "STRIPE_REFUND_PROCESSOR_PAYMENT_INTENT_MISMATCH", "Stripe refund PaymentIntent does not match the original payment.");
  if (Number(refund?.amount) !== Number(refundRequest?.amountCents)) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_PROCESSOR_AMOUNT_MISMATCH", "Stripe refund amount does not match the durable refund request.");
  }
  same(metadata.organizationId, String(refundRequest.organizationId), "STRIPE_REFUND_PROCESSOR_ORGANIZATION_MISMATCH", "Stripe refund organization metadata does not match the current tenant.");
  same(metadata.invoiceId, String(refundRequest.invoiceId), "STRIPE_REFUND_PROCESSOR_INVOICE_MISMATCH", "Stripe refund invoice metadata does not match the durable refund request.");
  same(metadata.paymentId, String(payment.id), "STRIPE_REFUND_PROCESSOR_PAYMENT_MISMATCH", "Stripe refund payment metadata does not match the original payment.");
  same(metadata.stripeAccountId, stripeAccountId, "STRIPE_REFUND_PROCESSOR_ACCOUNT_MISMATCH", "Stripe refund connected-account metadata does not match the trusted account.");
  same(metadata.refundRequestId, String(refundRequest.id), "STRIPE_REFUND_PROCESSOR_REQUEST_MISMATCH", "Stripe refund request metadata does not match the durable refund request.");

  const processorStatus = statusOf(refund);
  if (!["succeeded", "failed", "canceled"].includes(processorStatus)) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_NOT_TERMINAL", "Stripe refund is not terminal and cannot be reconciled yet.");
  }

  const createdSeconds = Number(refund?.created);
  return {
    processorStatus: processorStatus as "succeeded" | "failed" | "canceled",
    occurredAt: Number.isFinite(createdSeconds) && createdSeconds > 0 ? new Date(createdSeconds * 1000) : new Date(),
  };
}
