/**
 * Singleton Stripe.js client factory.
 * 
 * Ensures loadStripe() is called exactly once per (publishableKey + stripeAccount) pair
 * to prevent Elements from remounting during component re-renders.
 * 
 * CRITICAL: When creating PaymentIntents on a connected account, Stripe.js MUST be
 * initialized with the same stripeAccount context, otherwise Elements session requests
 * will fail with 400 Bad Request.
 */
import { loadStripe, Stripe } from '@stripe/stripe-js';

const cache = new Map<string, Promise<Stripe | null>>();

/**
 * Get or create a singleton Stripe.js instance.
 * 
 * @param publishableKey - Stripe publishable key (pk_test_... or pk_live_...)
 * @param stripeAccountId - Optional connected account ID (acct_...) for Stripe Connect
 * @returns Promise that resolves to Stripe instance, or null if no publishableKey
 */
export function getStripePromise(
  publishableKey: string | undefined,
  stripeAccountId?: string | null
): Promise<Stripe | null> | null {
  if (!publishableKey) return null;

  // Cache key includes both publishable key and account ID to prevent mismatch
  const cacheKey = `${publishableKey}::${stripeAccountId || 'platform'}`;

  if (!cache.has(cacheKey)) {
    const options = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    cache.set(cacheKey, loadStripe(publishableKey, options));
  }

  return cache.get(cacheKey)!;
}
