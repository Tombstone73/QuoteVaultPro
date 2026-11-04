import { describe, expect, test } from '@jest/globals';
import { productionJobMatchesSearch } from '@shared/productionQueueSearch';

describe('canonical production queue search', () => {
  const job = { id: 'job-20720', media: 'White vinyl', poNumber: 'PO-CUSTOMER-81', order: {
    orderNumber: '20720', displayNumber: 'SO-20720', numberCore: 20720, customerName: 'Authorized buyer',
    lineItems: { primary: { description: 'Window graphic', productFormalName: 'Roll vinyl' } },
    artwork: [{ fileName: 'Storefront.pdf' }],
  } };
  test.each(['', '20720', 'SO-20720', '2072', 'Authorized buyer', 'Window', 'Roll vinyl', 'White vinyl', 'PO-CUSTOMER-81', 'Storefront.pdf', 'job-20720'])(
    'matches the canonical identifiers: %s', search => expect(productionJobMatchesSearch(job, search)).toBe(true));
  test('unknown search excludes without mutating the record', () => {
    const before = JSON.stringify(job); expect(productionJobMatchesSearch(job, 'no-such-order')).toBe(false); expect(JSON.stringify(job)).toBe(before);
  });
  test('search covers the entire authorized response rather than the first display page', () => {
    const jobs = [...Array.from({ length: 125 }, (_, i) => ({ id: `job-${i}`, order: { orderNumber: String(30000+i) } })), job];
    expect(jobs.filter(value => productionJobMatchesSearch(value, '20720'))).toEqual([job]);
  });
});


test('legacy Order number without a stored display/core still uses canonical prefixed-number matching', () => {
  expect(productionJobMatchesSearch({order:{orderNumber:'20720'}},'ORD-20720')).toBe(true);
});
