import { expect, test } from '@jest/globals';
import {
  QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH,
  assertQuickBooksDocumentNumber,
  formatQuickBooksPaymentReference,
  resolveQuickBooksPaymentReference,
} from '../lib/quickBooksPaymentReference';

test('uses a short operator-entered check or transaction reference unchanged', () => {
  expect(resolveQuickBooksPaymentReference({ metadata: { reference: 'CHECK-2048' }, canonicalReference: 'PMT-1000' }))
    .toEqual({ value: 'CHECK-2048', source: 'explicit' });
});

test('uses the persisted PrintersHero reference when a manual reference is absent or too long', () => {
  const canonicalReference = formatQuickBooksPaymentReference(1000);
  const originalMetadata = { reference: 'A very long customer check reference that QuickBooks cannot accept' };
  expect(resolveQuickBooksPaymentReference({ metadata: {}, canonicalReference }))
    .toEqual({ value: canonicalReference, source: 'canonical' });
  expect(resolveQuickBooksPaymentReference({ metadata: originalMetadata, canonicalReference }))
    .toEqual({ value: canonicalReference, source: 'canonical' });
  expect(originalMetadata.reference).toBe('A very long customer check reference that QuickBooks cannot accept');
});

test('generated payment references are short, readable, stable, and distinct', () => {
  const first = formatQuickBooksPaymentReference(1000);
  const second = formatQuickBooksPaymentReference(1001);
  expect(first).toBe('PMT-1000');
  expect(second).toBe('PMT-1001');
  expect(first).not.toBe(second);
  expect(first.length).toBeLessThanOrEqual(QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH);
  expect(first).not.toMatch(/QVP-[0-9a-f-]{8,}/i);
});

test('rejects an invalid persisted QBO document reference before API submission', () => {
  expect(() => assertQuickBooksDocumentNumber('X'.repeat(22), 'QuickBooks payment reference')).toThrow('21 characters or fewer');
});
