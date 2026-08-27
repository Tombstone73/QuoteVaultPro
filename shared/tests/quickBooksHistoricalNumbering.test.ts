import { describe, expect, test } from '@jest/globals';
import {
  findHistoricalQuickBooksNumberConflicts,
  resolveHistoricalQuickBooksInvoiceNumber,
} from '../quickBooksHistoricalNumbering';

describe('historical QuickBooks invoice numbering', () => {
  test('preserves numeric QuickBooks DocNumber as the human-facing invoice number', () => {
    expect(resolveHistoricalQuickBooksInvoiceNumber('15970')).toEqual({
      value: {
        sourceDocNumber: '15970',
        displayNumber: '15970',
        numberCore: 15970,
        invoiceNumber: 15970,
      },
    });
  });

  test('preserves non-numeric QuickBooks DocNumber without allocating a native number', () => {
    expect(resolveHistoricalQuickBooksInvoiceNumber('QB-OLD-17')).toEqual({
      value: {
        sourceDocNumber: 'QB-OLD-17',
        displayNumber: 'QB-OLD-17',
        numberCore: null,
        invoiceNumber: 0,
      },
    });
  });

  test('ten historical identities leave a native next Job Number unchanged', () => {
    const nextJobNumber = 20225;
    const identities = Array.from({ length: 10 }, (_, index) => resolveHistoricalQuickBooksInvoiceNumber(String(15970 + index)));

    expect(identities.every((identity) => 'value' in identity)).toBe(true);
    expect(nextJobNumber).toBe(20225);
  });

  test('detects both native number and duplicate QuickBooks DocNumber collisions', () => {
    const resolved = resolveHistoricalQuickBooksInvoiceNumber('15970');
    if ('error' in resolved) throw new Error(resolved.error);

    expect(findHistoricalQuickBooksNumberConflicts(resolved.value, [
      { entity: 'order', id: 'native-order', displayNumber: 'ORD-15970', numberCore: 15970, jobNumber: 15970 },
      { entity: 'invoice', id: 'duplicate-import', qbDocNumber: '15970', displayNumber: '15970', numberCore: 15970 },
    ])).toEqual([
      { kind: 'native_number_collision', entity: 'order', id: 'native-order' },
      { kind: 'duplicate_quickbooks_doc_number', entity: 'invoice', id: 'duplicate-import' },
    ]);
  });

  test('rejects missing or oversized source DocNumber without touching allocation state', () => {
    expect(resolveHistoricalQuickBooksInvoiceNumber(null)).toEqual({ error: 'QuickBooks historical invoice is missing DocNumber.' });
    expect(resolveHistoricalQuickBooksInvoiceNumber('x'.repeat(65))).toEqual({
      error: 'QuickBooks historical invoice DocNumber exceeds the 64-character display-number limit.',
    });
  });
});
