import { describe, expect, test } from '@jest/globals';
import { isNestedInvoiceLineItem } from '../invoiceLinePresentation';

describe('invoice line presentation hierarchy', () => {
  const parent = { id: 'parent', description: 'Substance 2755 - Sign Vinyl' };
  const child = { id: 'child', parentLineItemId: 'parent', description: 'ACM / Dibond / Max Metal / Aluminum Composite Material' };

  test('identifies a persisted parent/child invoice relationship for customer-facing nesting', () => {
    expect(isNestedInvoiceLineItem(parent, [parent, child])).toBe(false);
    expect(isNestedInvoiceLineItem(child, [parent, child])).toBe(true);
  });

  test('does not fabricate a hierarchy for legacy or orphaned invoice rows', () => {
    expect(isNestedInvoiceLineItem({ id: 'legacy', parentLineItemId: null }, [parent])).toBe(false);
    expect(isNestedInvoiceLineItem({ id: 'orphan', parentLineItemId: 'missing-parent' }, [parent])).toBe(false);
  });
});
