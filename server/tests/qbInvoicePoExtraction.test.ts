import { describe, expect, test } from '@jest/globals';
import { extractQBInvoiceCustomerPo } from '../quickbooksService';

// Helper to build a minimal QB invoice object with optional PO-relevant fields
function makeQBInvoice(overrides: {
  CustomField?: any[];
  PrivateNote?: string;
  CustomerMemo?: string | { value: string };
  Line?: any[];
} = {}) {
  return {
    Id: '100',
    DocNumber: '1001',
    TxnDate: '2025-01-15',
    TotalAmt: 500,
    Balance: 500,
    ...overrides,
  };
}

describe('extractQBInvoiceCustomerPo', () => {
  // ==================== A. CustomField ====================

  describe('CustomField extraction', () => {
    test('matches field named "PO Number"', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: 'PO-2025-001' }],
      }));
      expect(result).toEqual({ poNumber: 'PO-2025-001', source: 'custom_field' });
    });

    test('matches field named "Customer PO" (case-insensitive)', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'CUSTOMER PO', StringValue: 'CP-987' }],
      }));
      expect(result).toEqual({ poNumber: 'CP-987', source: 'custom_field' });
    });

    test('matches field named "Customer PO Number"', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Customer PO Number', StringValue: 'ABC-456' }],
      }));
      expect(result).toEqual({ poNumber: 'ABC-456', source: 'custom_field' });
    });

    test('matches field named "Purchase Order"', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Purchase Order', StringValue: '77890' }],
      }));
      expect(result).toEqual({ poNumber: '77890', source: 'custom_field' });
    });

    test('matches field named "Purchase Order Number"', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Purchase Order Number', StringValue: 'ACME-PO-2025' }],
      }));
      expect(result).toEqual({ poNumber: 'ACME-PO-2025', source: 'custom_field' });
    });

    test('matches field named "p.o." (dot notation, lower)', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'p.o.', StringValue: '111' }],
      }));
      expect(result).toEqual({ poNumber: '111', source: 'custom_field' });
    });

    test('skips custom field with empty StringValue', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: '' }],
        PrivateNote: 'PO: 12345',
      }));
      // Should fall through to PrivateNote
      expect(result).toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('ignores unrelated custom field names', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Sales Rep', StringValue: 'Alice' }],
      }));
      expect(result).toEqual({ poNumber: null, source: null });
    });

    test('custom field takes precedence over PrivateNote', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: 'CF-111' }],
        PrivateNote: 'PO: PN-222',
      }));
      expect(result).toEqual({ poNumber: 'CF-111', source: 'custom_field' });
    });
  });

  // ==================== B. PrivateNote ====================

  describe('PrivateNote extraction', () => {
    test('extracts "PO: 12345"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PO: 12345' })))
        .toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('extracts "P.O. 12345"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'P.O. 12345' })))
        .toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('extracts "PO# 12345"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PO# 12345' })))
        .toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('extracts "PO#ABC-999"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PO#ABC-999' })))
        .toEqual({ poNumber: 'ABC-999', source: 'private_note' });
    });

    test('extracts alphanumeric value with hyphens', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'Customer PO: ACME-2025-047' })))
        .toEqual({ poNumber: 'ACME-2025-047', source: 'private_note' });
    });

    test('does not extract from note with no PO label', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'Rush job. Ship by Friday. Call 555-1234.' })))
        .toEqual({ poNumber: null, source: null });
    });

    test('does not extract random standalone number', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'Ref 98765 approved.' })))
        .toEqual({ poNumber: null, source: null });
    });
  });

  // ==================== C. CustomerMemo ====================

  describe('CustomerMemo extraction', () => {
    test('extracts from CustomerMemo string value object', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ CustomerMemo: { value: 'Purchase Order: ABC-987' } })))
        .toEqual({ poNumber: 'ABC-987', source: 'customer_memo' });
    });

    test('extracts from CustomerMemo plain string', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ CustomerMemo: 'PO: XYZ-001' })))
        .toEqual({ poNumber: 'XYZ-001', source: 'customer_memo' });
    });

    test('does not extract from generic memo text', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ CustomerMemo: 'Thank you for your business!' })))
        .toEqual({ poNumber: null, source: null });
    });

    test('PrivateNote takes precedence over CustomerMemo', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        PrivateNote: 'PO: PN-100',
        CustomerMemo: { value: 'PO: CM-200' },
      }));
      expect(result).toEqual({ poNumber: 'PN-100', source: 'private_note' });
    });
  });

  // ==================== D. Line description fallback ====================

  describe('Line description fallback', () => {
    test('extracts from line Description with explicit PO label', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [{ Description: 'PO: LINE-777' }],
      }));
      expect(result).toEqual({ poNumber: 'LINE-777', source: 'line_description' });
    });

    test('does not extract from unlabelled line description', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [{ Description: 'Wide format banner 24x36' }],
      }));
      expect(result).toEqual({ poNumber: null, source: null });
    });

    test('does not extract from line with only numbers and no PO label', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [{ Description: 'Item qty 10 at $25.00' }],
      }));
      expect(result).toEqual({ poNumber: null, source: null });
    });
  });

  // ==================== E. Nothing found ====================

  describe('no PO found', () => {
    test('returns null/null when no fields present', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice()))
        .toEqual({ poNumber: null, source: null });
    });

    test('returns null/null for invoice with only amount fields', () => {
      expect(extractQBInvoiceCustomerPo({ Id: '1', TotalAmt: 100, Balance: 100 }))
        .toEqual({ poNumber: null, source: null });
    });
  });

  // ==================== Edge cases ====================

  describe('edge cases', () => {
    test('truncates value longer than 100 chars from custom field', () => {
      const longValue = 'A'.repeat(150);
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: longValue }],
      }));
      expect(result.poNumber).toHaveLength(100);
      expect(result.source).toBe('custom_field');
    });

    test('does not extract value when separator is missing from PrivateNote', () => {
      // "PURCHASE" followed by unrelated text — no separator
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PURCHASING DEPARTMENT NOTE' })))
        .toEqual({ poNumber: null, source: null });
    });

    test('handles null/undefined fields gracefully', () => {
      expect(() => extractQBInvoiceCustomerPo({
        Id: '1',
        CustomField: null,
        PrivateNote: null,
        CustomerMemo: null,
        Line: null,
      })).not.toThrow();
    });
  });
});
