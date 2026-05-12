import { describe, expect, test } from '@jest/globals';
import { extractQBInvoiceCustomerPo } from '../quickbooksService';

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

  // ==================== A. CustomField PO ========================

  describe('A — CustomField with PO name', () => {
    test('matches "PO Number"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: 'PO-2025-001' }],
      }))).toEqual({ poNumber: 'PO-2025-001', source: 'custom_field' });
    });

    test('matches "Customer PO" case-insensitively', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'CUSTOMER PO', StringValue: 'CP-987' }],
      }))).toEqual({ poNumber: 'CP-987', source: 'custom_field' });
    });

    test('matches "Purchase Order Number"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Purchase Order Number', StringValue: 'ACME-PO-2025' }],
      }))).toEqual({ poNumber: 'ACME-PO-2025', source: 'custom_field' });
    });

    test('skips empty StringValue and falls through', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: '' }],
        PrivateNote: 'PO: 12345',
      }))).toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('CustomField PO beats line descriptions', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: 'CF-PO-111' }],
        Line: [{ Description: 'Custom Design' }, { Description: 'Rock Fountain' }],
      }))).toEqual({ poNumber: 'CF-PO-111', source: 'custom_field' });
    });
  });

  // ==================== B/C/D. Explicit PO in text fields ========

  describe('B–D — explicit PO pattern in text fields', () => {
    test('B — PrivateNote "PO: 12345"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PO: 12345' })))
        .toEqual({ poNumber: '12345', source: 'private_note' });
    });

    test('B — PrivateNote "PO# ABC-999"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ PrivateNote: 'PO# ABC-999' })))
        .toEqual({ poNumber: 'ABC-999', source: 'private_note' });
    });

    test('C — CustomerMemo "Purchase Order: ABC-987"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({ CustomerMemo: { value: 'Purchase Order: ABC-987' } })))
        .toEqual({ poNumber: 'ABC-987', source: 'customer_memo' });
    });

    test('D — Line description "PO: LINE-777"', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [{ Description: 'PO: LINE-777' }],
      }))).toEqual({ poNumber: 'LINE-777', source: 'line_description' });
    });

    test('explicit PO in line description beats generic line description fallback', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: 'PO: REAL-001' },
          { Description: 'Custom Design' },
          { Description: 'Rock Fountain' },
        ],
      }))).toEqual({ poNumber: 'REAL-001', source: 'line_description' });
    });
  });

  // ==================== E. Reference CustomField =================

  describe('E — CustomField with reference name', () => {
    test('"Job Description" custom field beats line descriptions', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Job Description', StringValue: 'North Campus Renovation' }],
        Line: [{ Description: 'Custom Design' }, { Description: 'Rock Fountain' }],
      }))).toEqual({ poNumber: 'North Campus Renovation', source: 'custom_field_reference' });
    });

    test('"Project Name" custom field', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Project Name', StringValue: 'Acme HQ Lobby' }],
      }))).toEqual({ poNumber: 'Acme HQ Lobby', source: 'custom_field_reference' });
    });

    test('"Ref #" custom field', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'Ref #', StringValue: 'REF-2025-007' }],
      }))).toEqual({ poNumber: 'REF-2025-007', source: 'custom_field_reference' });
    });

    test('PO custom field beats reference custom field when both present', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [
          { Name: 'Job Description', StringValue: 'Lobby Install' },
          { Name: 'PO Number', StringValue: 'PO-WINNER' },
        ],
      }))).toEqual({ poNumber: 'PO-WINNER', source: 'custom_field' });
    });
  });

  // ==================== F. CustomerMemo (non-boilerplate) ========

  describe('F — CustomerMemo non-boilerplate fallback', () => {
    test('generic memo "Thank you for your business and have a great day!" is rejected', () => {
      // Should fall through to line descriptions or null
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomerMemo: { value: 'Thank you for your business and have a great day!' },
      }));
      expect(result.source).not.toBe('customer_memo');
    });

    test('"Thank you for choosing us" is rejected', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomerMemo: 'Thank you for choosing us. Please remit payment.',
      }));
      expect(result.source).not.toBe('customer_memo');
    });

    test('useful short memo is used when no PO found', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomerMemo: { value: 'Rooftop signage installation Q3' },
      }));
      expect(result).toEqual({ poNumber: 'Rooftop signage installation Q3', source: 'customer_memo' });
    });
  });

  // ==================== H. Line description fallback =============

  describe('H — meaningful line description fallback', () => {
    test('sandbox invoice: Custom Design / Installation / Rock Fountain / Garden Rocks', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomerMemo: { value: 'Thank you for your business and have a great day!' },
        Line: [
          { Description: 'Custom Design' },
          { Description: 'Installation of landscape design' },
          { Description: 'Rock Fountain' },
          { Description: 'Garden Rocks' },
        ],
      }));
      expect(result.source).toBe('line_description');
      expect(result.poNumber).toBe('Custom Design / Installation of landscape design / Rock Fountain / Garden Rocks');
    });

    test('duplicate line descriptions are removed', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: 'Banner printing' },
          { Description: 'Banner printing' },
          { Description: 'Installation' },
        ],
      }));
      expect(result.poNumber).toBe('Banner printing / Installation');
    });

    test('empty line descriptions are ignored', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: '' },
          { Description: '   ' },
          { Description: 'Sign Installation' },
        ],
      }));
      expect(result.poNumber).toBe('Sign Installation');
    });

    test('numeric-only line descriptions are ignored', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: '12345' },
          { Description: '99.00' },
          { Description: 'Vehicle Wrap' },
        ],
      }));
      expect(result.poNumber).toBe('Vehicle Wrap');
    });

    test('at most 5 line descriptions are included', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: 'Alpha' },
          { Description: 'Beta' },
          { Description: 'Gamma' },
          { Description: 'Delta' },
          { Description: 'Epsilon' },
          { Description: 'Zeta should be excluded' },
        ],
      }));
      expect(result.poNumber?.includes('Zeta')).toBe(false);
      expect(result.source).toBe('line_description');
    });

    test('long joined result is capped to 100 chars', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: 'Very long line description number one for testing purposes here' },
          { Description: 'Another quite lengthy description that adds more text to the join' },
          { Description: 'Third line adds even more text to push this beyond one hundred' },
        ],
      }));
      expect(result.poNumber).not.toBeNull();
      expect(result.poNumber!.length).toBeLessThanOrEqual(100);
    });

    test('returns null when all lines are numeric or empty', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        Line: [
          { Description: '' },
          { Description: '100' },
          { Description: '25.00' },
        ],
      }));
      expect(result).toEqual({ poNumber: null, source: null });
    });
  });

  // ==================== I. Nothing found ========================

  describe('I — nothing found', () => {
    test('returns null/null when no fields present', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice()))
        .toEqual({ poNumber: null, source: null });
    });

    test('returns null/null when memo is generic and no lines', () => {
      expect(extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomerMemo: { value: 'Thank you for your business and have a great day!' },
      }))).toEqual({ poNumber: null, source: null });
    });
  });

  // ==================== Edge cases ==============================

  describe('edge cases', () => {
    test('truncates custom field value longer than 100 chars', () => {
      const result = extractQBInvoiceCustomerPo(makeQBInvoice({
        CustomField: [{ Name: 'PO Number', StringValue: 'A'.repeat(150) }],
      }));
      expect(result.poNumber).toHaveLength(100);
      expect(result.source).toBe('custom_field');
    });

    test('handles null/undefined fields without throwing', () => {
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
