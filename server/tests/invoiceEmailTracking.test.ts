import { describe, expect, test } from '@jest/globals';

import { deriveInvoiceEmailStatus } from '../invoicesService';

describe('invoice email tracking', () => {
  test('returns not_sent when there is no sent log', () => {
    expect(deriveInvoiceEmailStatus(new Date('2026-04-30T12:00:00Z'), null)).toBe('not_sent');
  });

  test('returns sent when invoice has not changed since last send', () => {
    expect(
      deriveInvoiceEmailStatus(
        new Date('2026-04-30T12:00:00Z'),
        new Date('2026-04-30T12:00:00Z'),
      ),
    ).toBe('sent');
  });

  test('returns outdated when invoice changed after last send', () => {
    expect(
      deriveInvoiceEmailStatus(
        new Date('2026-04-30T12:00:01Z'),
        new Date('2026-04-30T12:00:00Z'),
      ),
    ).toBe('outdated');
  });
});