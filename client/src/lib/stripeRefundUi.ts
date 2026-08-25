export type StripeRefundPayment = {
  id?: string | null;
  provider?: string | null;
  status?: string | null;
  amountCents?: number | null;
  metadata?: unknown;
};

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (metadata && typeof metadata === "object") return metadata as Record<string, unknown>;
  if (typeof metadata !== "string") return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function getStripeRefundOriginalPaymentId(payment: StripeRefundPayment): string | null {
  const metadata = parseMetadata(payment.metadata);
  const stripeRefund = metadata?.stripeRefund;
  if (!stripeRefund || typeof stripeRefund !== "object") return null;
  const originalPaymentId = (stripeRefund as Record<string, unknown>).originalPaymentId;
  return typeof originalPaymentId === "string" && originalPaymentId.trim() ? originalPaymentId : null;
}

/**
 * Mirrors the immutable negative-payment-effect model used by Stripe webhook
 * reconciliation. Server-side validation remains authoritative for refunds.
 */
export function getStripeRefundSummary(
  originalPayment: StripeRefundPayment,
  allPayments: StripeRefundPayment[],
): { originalAmountCents: number; alreadyRefundedCents: number; remainingRefundableCents: number } {
  const originalAmountCents = Math.max(0, Math.round(Number(originalPayment.amountCents || 0)));
  const originalPaymentId = String(originalPayment.id || "");
  const alreadyRefundedCents = allPayments.reduce((total, payment) => {
    if (
      String(payment.provider || "").toLowerCase() !== "stripe" ||
      String(payment.status || "").toLowerCase() !== "refunded" ||
      getStripeRefundOriginalPaymentId(payment) !== originalPaymentId
    ) return total;
    return total + Math.max(0, Math.round(Number(payment.amountCents || 0)));
  }, 0);

  return {
    originalAmountCents,
    alreadyRefundedCents,
    remainingRefundableCents: Math.max(0, originalAmountCents - alreadyRefundedCents),
  };
}
