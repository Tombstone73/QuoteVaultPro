import { expect, test } from '@jest/globals';
import { checkoutInactive, isUnsubmittedStripeCheckout } from '../services/stripeCheckoutLifecycle';

test('inactivity is exactly two minutes since user activity, with legacy creation fallback', () => {
  const now = Date.now(), createdAt = new Date(now - 3600000);
  expect(checkoutInactive({ createdAt, metadata: { checkoutLastActivityAt: new Date(now - 119999).toISOString() } }, now)).toBe(false);
  expect(checkoutInactive({ createdAt, metadata: { checkoutLastActivityAt: new Date(now - 120000).toISOString() } }, now)).toBe(true);
  expect(checkoutInactive({ createdAt }, now)).toBe(true);
  expect(checkoutInactive({ createdAt, metadata: { checkoutLastActivityAt: 'invalid' } }, now)).toBe(true);
  expect(checkoutInactive({ createdAt, providerEvidence: { checkoutLastActivityAt: new Date(now).toISOString() } }, now)).toBe(false);
});
test.each(['processing', 'requires_capture', 'requires_action', 'succeeded', 'canceled'])('%s never qualifies as an abandoned unsubmitted form', status => {
  expect(isUnsubmittedStripeCheckout({ status, amount_received: 0 })).toBe(false);
});
test('funds, authorizations, and manual confirmation cannot be retired as inactivity', () => {
  expect(isUnsubmittedStripeCheckout({ status: 'requires_payment_method', amount_received: 1 })).toBe(false);
  expect(isUnsubmittedStripeCheckout({ status: 'requires_confirmation', amount_received: 0, amount_capturable: 1 })).toBe(false);
  expect(isUnsubmittedStripeCheckout({ status: 'requires_confirmation', amount_received: 0, confirmation_method: 'manual' })).toBe(false);
  expect(isUnsubmittedStripeCheckout({ status: 'requires_payment_method', amount_received: 0 })).toBe(true);
  expect(isUnsubmittedStripeCheckout({ status: 'requires_confirmation', amount_received: 0, confirmation_method: 'automatic' })).toBe(true);
});
