import { describe, expect, test } from '@jest/globals';

import { deriveInvoiceEmailStatus } from '../invoicesService';

describe('invoice email tracking', () => {
  test('returns not_sent when there is no sent log', () => {
    expect(deriveInvoiceEmailStatus(new Date('2026-04-30T12:00:00Z'), null)).toBe('not_sent');
  });

  test('returns sent_current when invoice has not changed since last send', () => {
    expect(
      deriveInvoiceEmailStatus(
        new Date('2026-04-30T12:00:00Z'),
        new Date('2026-04-30T12:00:00Z'),
      ),
    ).toBe('sent_current');
  });

  test('returns sent_current when invoice updatedAt is before last send', () => {
    expect(
      deriveInvoiceEmailStatus(
        new Date('2026-04-29T10:00:00Z'),
        new Date('2026-04-30T12:00:00Z'),
      ),
    ).toBe('sent_current');
  });

  test('returns sent_outdated when invoice changed after last send', () => {
    expect(
      deriveInvoiceEmailStatus(
        new Date('2026-04-30T12:00:01Z'),
        new Date('2026-04-30T12:00:00Z'),
      ),
    ).toBe('sent_outdated');
  });

  test('returns not_sent when updatedAt is null and lastSentAt is null', () => {
    expect(deriveInvoiceEmailStatus(null, null)).toBe('not_sent');
  });

  test('returns sent_current when updatedAt is null and invoice was sent', () => {
    // null updatedAt treated as 0 ms — always <= any sent time
    expect(
      deriveInvoiceEmailStatus(null, new Date('2026-04-30T12:00:00Z')),
    ).toBe('sent_current');
  });
});
