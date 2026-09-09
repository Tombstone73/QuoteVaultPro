import { expect, test } from '@jest/globals';
import { resolveQuickBooksPreferencesFromOrgPreferences } from '../quickBooksPreferences';

test('QuickBooks auto queue defaults to the legacy automatic mode and supports explicit manual mode', () => {
  expect(resolveQuickBooksPreferencesFromOrgPreferences({})).toEqual({
    syncPolicy: 'queue_only',
    autoQueueApprovedInvoices: true,
  });
  expect(resolveQuickBooksPreferencesFromOrgPreferences({
    quickBooks: { autoQueueApprovedInvoices: false },
  }).autoQueueApprovedInvoices).toBe(false);
});
