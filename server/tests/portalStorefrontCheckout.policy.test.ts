import { canPortalPlaceOrder, isCurrentCartReview } from '../services/portalStorefrontCheckout.policy';

test.each(['BUYER', 'COMPANY_ADMIN'])('%s can submit outside staff preview', role => {
  expect(canPortalPlaceOrder(role, false)).toBe(true);
  expect(canPortalPlaceOrder(role, true)).toBe(false);
});

test.each(['VIEWER', 'BILLING', null, 'OWNER'])('%s cannot submit', role => {
  expect(canPortalPlaceOrder(role, false)).toBe(false);
});

test('checkout accepts only the reviewed version and matching token', () => {
  expect(isCurrentCartReview({ reviewToken: 'token', cartVersion: 2, savedToken: 'token', savedVersion: 2 })).toBe(true);
  expect(isCurrentCartReview({ reviewToken: 'token', cartVersion: 3, savedToken: 'token', savedVersion: 2 })).toBe(false);
  expect(isCurrentCartReview({ reviewToken: 'other', cartVersion: 2, savedToken: 'token', savedVersion: 2 })).toBe(false);
});
