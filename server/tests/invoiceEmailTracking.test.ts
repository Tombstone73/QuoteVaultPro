import { describe, expect, test } from '@jest/globals';

import { deriveInvoiceEmailStatus } from '../invoicesService';

describe('invoice email tracking', () => {
  test('returns not_sent when there is no sent log', () => {
    expect(deriveInvoiceEmailStatus({ invoiceVersion: 1, lastSentVersion: null, lastSentAt: null })).toBe('not_sent');
  });

  test('returns sent_current when the customer-visible invoice revision matches the sent revision', () => {
    expect(deriveInvoiceEmailStatus({
      invoiceVersion: 4,
      lastSentVersion: 4,
      lastSentAt: new Date('2026-04-30T12:00:00Z'),
    })).toBe('sent_current');
  });

  test('treats a legacy successful send without a recorded sent revision as current', () => {
    expect(deriveInvoiceEmailStatus({
      invoiceVersion: 4,
      lastSentVersion: null,
      lastSentAt: new Date('2026-04-30T12:00:00Z'),
    })).toBe('sent_current');
  });

  test('returns sent_outdated when the customer-visible invoice revision changes after send', () => {
    expect(deriveInvoiceEmailStatus({
      invoiceVersion: 5,
      lastSentVersion: 4,
      lastSentAt: new Date('2026-04-30T12:00:00Z'),
    })).toBe('sent_outdated');
  });

  test('keeps a sent invoice current when accounting approval updates generic timestamps', () => {
    expect(deriveInvoiceEmailStatus({
      invoiceVersion: 4,
      lastSentVersion: 4,
      lastSentAt: new Date('2026-04-30T12:00:00Z'),
    })).toBe('sent_current');
  });

  test('marks a customer-visible invoice revision after send as outdated', () => {
    expect(deriveInvoiceEmailStatus({
      invoiceVersion: 5,
      lastSentVersion: 4,
      lastSentAt: new Date('2026-04-30T12:00:00Z'),
    })).toBe('sent_outdated');
  });
});
