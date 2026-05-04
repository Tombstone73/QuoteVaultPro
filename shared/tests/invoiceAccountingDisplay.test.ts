import { describe, expect, test } from '@jest/globals';
import {
  normalizeInvoiceAccountingDisplay,
  normalizeQuickBooksLineItemsSnapshot,
} from '../invoiceAccountingDisplay';

describe('normalizeInvoiceAccountingDisplay', () => {
  test('historical imported paid invoice derives paid from total minus zero balance', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: 'quickbooks',
      isHistorical: true,
      total: '103.55',
      totalCents: 10355,
      amountPaid: '0.00',
      balanceDue: '0.00',
      qbImportBalanceDue: '0.00',
      status: 'paid',
    });

    expect(normalized.displayPaid).toBe(103.55);
    expect(normalized.displayRemaining).toBe(0);
    expect(normalized.displayStatus).toBe('Paid Historical');
    expect(normalized.isImportedFromQuickBooks).toBe(true);
    expect(normalized.isHistorical).toBe(true);
  });

  test('open imported unpaid invoice uses QuickBooks balance as remaining', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: 'quickbooks',
      isHistorical: false,
      total: '954.75',
      totalCents: 95475,
      amountPaid: '0.00',
      balanceDue: '954.75',
      qbImportBalanceDue: '954.75',
      status: 'billed',
    });

    expect(normalized.displayPaid).toBe(0);
    expect(normalized.displayRemaining).toBe(954.75);
    expect(normalized.displayStatus).toBe('Unpaid');
  });

  test('open imported partial invoice derives paid from total minus QuickBooks balance', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: 'quickbooks',
      isHistorical: false,
      total: '100.00',
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '25.00',
      qbImportBalanceDue: '25.00',
      status: 'billed',
    });

    expect(normalized.displayPaid).toBe(75);
    expect(normalized.displayRemaining).toBe(25);
    expect(normalized.displayStatus).toBe('Partially Paid');
  });
});

describe('normalizeQuickBooksLineItemsSnapshot', () => {
  test('renders line descriptions from description or item name fallback', () => {
    const normalized = normalizeQuickBooksLineItemsSnapshot([
      {
        Amount: 80,
        Description: 'Install labor',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { Qty: 2, UnitPrice: 40 },
      },
      {
        Amount: 23.55,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: 23.55,
          ItemRef: { name: 'Garden Rocks' },
        },
      },
    ]);

    expect(normalized.unavailableMessage).toBeNull();
    expect(normalized.lines).toEqual([
      { description: 'Install labor', quantity: 2, unitPrice: 40, amount: 80 },
      { description: 'Garden Rocks', quantity: 1, unitPrice: 23.55, amount: 23.55 },
    ]);
  });

  test('fails softly when snapshot is malformed', () => {
    const normalized = normalizeQuickBooksLineItemsSnapshot({ bad: true });

    expect(normalized.lines).toEqual([]);
    expect(normalized.unavailableMessage).toBe('Line details unavailable from QuickBooks snapshot');
  });
});