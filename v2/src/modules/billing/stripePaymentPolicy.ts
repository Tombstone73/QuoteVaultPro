import { V2ApplicationError } from "../../errors/applicationError.js";

/**
 * Stripe's minimum is currency-specific. V2 currently accepts USD card
 * payments, for which Stripe rejects PaymentIntents below fifty cents. Keep
 * that provider limit ahead of durable provider-operation creation.
 */
export const minimumStripeCardPaymentCents = (currency: string): number | null =>
  currency.trim().toUpperCase() === "USD" ? 50 : null;

export const assertStripeCardPaymentMinimum = (amountCents: number, currency: string): void => {
  const minimum = minimumStripeCardPaymentCents(currency);
  if (minimum !== null && amountCents < minimum) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Card payments in USD must be at least $0.50. Record or collect the remaining balance by another supported method.");
  }
};

/** A 4xx rejection before Stripe returns an object is definitive, unlike a network timeout. */
export const stripeRejectedBeforeCreation = (cause: unknown): boolean => {
  const status = Number((cause as { statusCode?: unknown; raw?: { statusCode?: unknown } } | undefined)?.statusCode
    ?? (cause as { raw?: { statusCode?: unknown } } | undefined)?.raw?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 409 && status !== 429;
};
