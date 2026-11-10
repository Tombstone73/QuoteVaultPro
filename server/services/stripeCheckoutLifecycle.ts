/** Application inactivity, independent of Stripe's hosted Session expiry. */
export const STRIPE_CHECKOUT_INACTIVITY_MS = 2 * 60 * 1000;

export function checkoutInactive(row: { createdAt: Date | string; metadata?: unknown; providerEvidence?: unknown }, now = Date.now()) {
  const evidence = (row.metadata ?? row.providerEvidence ?? {}) as Record<string, unknown>;
  const recordedActivity = Date.parse(String(evidence.checkoutLastActivityAt));
  const activity = Number.isFinite(recordedActivity) ? recordedActivity : new Date(row.createdAt).getTime();
  return Number.isFinite(activity) && now - activity >= STRIPE_CHECKOUT_INACTIVITY_MS;
}

/** requires_action can mean a submitted bank/3DS payment. Never time it out. */
export function isUnsubmittedStripeCheckout(intent: { status: string; amount_received: number; amount_capturable?: number; confirmation_method?: string }) {
  return intent.amount_received === 0 && !intent.amount_capturable &&
    (intent.status === "requires_payment_method" || (intent.status === "requires_confirmation" && intent.confirmation_method !== "manual"));
}
