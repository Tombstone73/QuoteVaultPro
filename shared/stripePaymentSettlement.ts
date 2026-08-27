export type StripePaymentSettlementRow = {
  stripePaymentIntentId?: string | null;
  status?: string | null;
};

/**
 * A refreshed payment list is authoritative only when it includes the exact
 * PaymentIntent that the browser just confirmed in Stripe.
 */
export function hasReconciledStripePayment(
  payments: readonly StripePaymentSettlementRow[],
  paymentIntentId: string,
): boolean {
  return payments.some((payment) => (
    payment.stripePaymentIntentId === paymentIntentId &&
    String(payment.status || '').toLowerCase() === 'succeeded'
  ));
}
