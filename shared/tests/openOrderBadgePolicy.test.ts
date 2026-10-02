import { isCanonicalOpenOrder } from '../openOrderBadgePolicy';

test('V1 Orders Open bucket follows lifecycle state and excludes Complete display status', () => {
  for (const statusPillValue of ['New', 'Needs Review', 'Waiting on Artwork', 'Design Needed', 'Proof Sent', 'Approved', 'Prepress', 'In Production', 'Fulfillment', 'On Hold', 'Ready to Ship', 'Shipped', 'Invoiced', 'Picked Up', 'Paid']) {
    expect(isCanonicalOpenOrder({ state: 'open', statusPillValue })).toBe(true);
  }
  expect(isCanonicalOpenOrder({ state: 'open', statusPillKey: 'complete' })).toBe(false);
  expect(isCanonicalOpenOrder({ state: 'open', statusPillValue: 'Complete' })).toBe(false);
});

test.each(['production_complete', 'closed', 'canceled'])('excludes %s lifecycle buckets', (state) => {
  expect(isCanonicalOpenOrder({ state, statusPillValue: 'New' })).toBe(false);
});
