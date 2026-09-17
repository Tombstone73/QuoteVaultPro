import { describe, expect, test } from '@jest/globals';
import { isNestedInvoiceLineItem, resolveInvoiceLinePresentation } from '../invoiceLinePresentation';

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

describe('invoice line presentation identity', () => {
  test('uses the product identity instead of a generated zero-dimension placeholder', () => {
    expect(resolveInvoiceLinePresentation({
      productName: 'Heavy Duty Yard Stakes',
      description: '0.00\" × 0.00\"',
      width: '0',
      height: '0',
    })).toEqual({
      primaryLabel: 'Heavy Duty Yard Stakes',
      secondaryLabel: null,
      dimensionsLabel: null,
    });
  });

  test('keeps meaningful descriptions and positive dimensions beneath the product name', () => {
    expect(resolveInvoiceLinePresentation({
      productName: 'ACM Panel',
      description: 'White, double sided',
      width: 24,
      height: 48,
    })).toEqual({
      primaryLabel: 'ACM Panel',
      secondaryLabel: 'White, double sided',
      dimensionsLabel: '24\" × 48\"',
    });
  });

  test('falls back to the stored description for standalone legacy lines', () => {
    expect(resolveInvoiceLinePresentation({ description: 'Installation service' }).primaryLabel).toBe('Installation service');
  });
});
