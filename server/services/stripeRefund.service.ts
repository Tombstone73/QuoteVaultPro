/**
 * Server-side policy helpers for Stripe refund initiation.  Amounts are
 * intentionally represented exclusively as integer cents at this boundary.
 * The webhook reconciliation service remains the authority that records a
 * successful refund as a negative payment effect.
 */

export type RefundablePaymentEffect = {
  status?: string | null;
  amountCents?: number | null;
  metadata?: Record<string, any> | null;
};

export type StripeRefundEligibility =
  | { ok: true; originalAmountCents: number; alreadyRefundedCents: number; pendingRefundCents: number; remainingCents: number }
  | { ok: false; code: string; error: string };

function nonNegativeIntegerCents(value: unknown): number | null {
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

function isRefundForPayment(effect: RefundablePaymentEffect, originalPaymentId: string): boolean {
  return String(effect?.metadata?.stripeRefund?.originalPaymentId || "") === originalPaymentId;
}

/**
 * Computes the amount that can still be initiated safely. Pending requests
 * reserve their amount until Stripe sends their terminal refund event; this
 * prevents concurrent requests from overshooting the original charge.
 */
export function getStripeRefundEligibility(input: {
  originalPayment: { id: string; provider?: string | null; status?: string | null; amountCents?: number | null; stripePaymentIntentId?: string | null };
  refundEffects: RefundablePaymentEffect[];
  pendingReservationCents?: number;
}): StripeRefundEligibility {
  const original = input.originalPayment;
  if (String(original.provider || "").toLowerCase() !== "stripe") {
    return { ok: false, code: "STRIPE_REFUND_PROVIDER_INVALID", error: "Only Stripe payments can be refunded through Stripe." };
  }
  if (!['succeeded', 'captured'].includes(String(original.status || '').toLowerCase())) {
    return { ok: false, code: "STRIPE_REFUND_PAYMENT_NOT_SETTLED", error: "Only successful Stripe payments can be refunded." };
  }
  if (!String(original.stripePaymentIntentId || '').trim()) {
    return { ok: false, code: "STRIPE_REFUND_PAYMENT_INTENT_MISSING", error: "The original Stripe payment reference is missing." };
  }

  const originalAmountCents = nonNegativeIntegerCents(original.amountCents);
  if (!originalAmountCents || originalAmountCents <= 0) {
    return { ok: false, code: "STRIPE_REFUND_AMOUNT_INVALID", error: "The original Stripe payment amount is invalid." };
  }

  let alreadyRefundedCents = 0;
  let pendingRefundCents = Math.max(0, Number.isSafeInteger(input.pendingReservationCents) ? Number(input.pendingReservationCents) : 0);
  for (const effect of input.refundEffects || []) {
    if (!isRefundForPayment(effect, String(original.id))) continue;
    const amountCents = nonNegativeIntegerCents(effect.amountCents);
    if (!amountCents || amountCents <= 0) continue;
    const status = String(effect.status || '').toLowerCase();
    if (status === 'refunded') alreadyRefundedCents += amountCents;
  }

  const reservedCents = Math.min(originalAmountCents, alreadyRefundedCents + pendingRefundCents);
  return {
    ok: true,
    originalAmountCents,
    alreadyRefundedCents,
    pendingRefundCents,
    remainingCents: Math.max(0, originalAmountCents - reservedCents),
  };
}

export function validateStripeRefundAmount(amountCents: unknown, remainingCents: number): { ok: true; amountCents: number } | { ok: false; code: string; error: string } {
  const cents = nonNegativeIntegerCents(amountCents);
  if (!cents || cents <= 0) {
    return { ok: false, code: "STRIPE_REFUND_AMOUNT_REQUIRED", error: "Refund amount must be greater than zero cents." };
  }
  if (cents > remainingCents) {
    return { ok: false, code: "STRIPE_REFUND_AMOUNT_EXCEEDS_REMAINING", error: "Refund amount exceeds the remaining refundable amount." };
  }
  return { ok: true, amountCents: cents };
}

export function stripeRefundIdempotencyKey(input: { originalPaymentId: string; requestId: string }): string {
  return `stripe-refund:${input.originalPaymentId}:${input.requestId}`;
}
