import { describe, expect, test } from '@jest/globals';
import {
  normalizeInvoiceAccountingDisplay,
  normalizeQuickBooksLineItemsSnapshot,
  resolveInvoicePdfFinancialSummary,
} from '../invoiceAccountingDisplay';

describe('normalizeInvoiceAccountingDisplay', () => {
  test('TitanOS billed invoice with no payments ignores stale zero balance due', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: null,
      total: '44.00',
      totalCents: 4400,
      amountPaid: '0.00',
      balanceDue: '0.00',
      status: 'billed',
      payments: [],
    });

    expect(normalized.displayPaid).toBe(0);
    expect(normalized.displayRemaining).toBe(44);
    expect(normalized.displayStatus).toBe('Billed');
    expect(normalized.paymentStatusLabel).toBe('Unpaid');
    expect(normalized.isFullyPaid).toBe(false);
  });

  test('TitanOS partial and full payments drive remaining balance and paid label', () => {
    const partial = normalizeInvoiceAccountingDisplay({
      importSource: null,
      total: '100.00',
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '0.00',
      status: 'billed',
      payments: [{ id: 'p1', status: 'succeeded', amountCents: 2500 }],
    });

    expect(partial.displayPaid).toBe(25);
    expect(partial.displayRemaining).toBe(75);
    expect(partial.displayStatus).toBe('Partially Paid');
    expect(partial.isFullyPaid).toBe(false);

    const paid = normalizeInvoiceAccountingDisplay({
      importSource: null,
      total: '100.00',
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '0.00',
      status: 'billed',
      payments: [{ id: 'p2', status: 'succeeded', amountCents: 10000 }],
    });

    expect(paid.displayPaid).toBe(100);
    expect(paid.displayRemaining).toBe(0);
    expect(paid.displayStatus).toBe('Paid');
    expect(paid.isFullyPaid).toBe(true);
  });

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

  test('open imported invoice subtracts unreconciled local payments from QuickBooks snapshot', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: 'quickbooks',
      isHistorical: false,
      total: '100.00',
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '100.00',
      qbImportBalanceDue: '100.00',
      status: 'billed',
      payments: [
        { id: 'pay_pending', status: 'succeeded', amountCents: 2500, syncStatus: 'pending' },
        { id: 'pay_synced', status: 'succeeded', amountCents: 1500, syncStatus: 'synced', externalAccountingId: 'qb_pay_1' },
      ],
    });

    expect(normalized.displayPaid).toBe(40);
    expect(normalized.displayRemaining).toBe(60);
    expect(normalized.displayStatus).toBe('Partially Paid');
    expect(normalized.importedQuickBooksPaymentSummary.pendingSyncCents).toBe(2500);
    expect(normalized.importedQuickBooksPaymentSummary.syncedUnreconciledCents).toBe(1500);
    expect(normalized.importedQuickBooksPaymentSummary.unreconciledCents).toBe(4000);
  });

  test('reconciled imported payments stop reducing remaining balance twice', () => {
    const normalized = normalizeInvoiceAccountingDisplay({
      importSource: 'quickbooks',
      isHistorical: false,
      total: '100.00',
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '60.00',
      qbImportBalanceDue: '60.00',
      status: 'billed',
      payments: [
        {
          id: 'pay_reconciled',
          status: 'succeeded',
          amountCents: 4000,
          syncStatus: 'synced',
          externalAccountingId: 'qb_pay_1',
          qbReconciledAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(normalized.displayPaid).toBe(40);
    expect(normalized.displayRemaining).toBe(60);
    expect(normalized.importedQuickBooksPaymentSummary.reconciledCents).toBe(4000);
    expect(normalized.importedQuickBooksPaymentSummary.unreconciledCents).toBe(0);
  });
});

describe('resolveInvoicePdfFinancialSummary', () => {
  test.each([
    ['native unpaid', { totalCents: 10000, status: 'billed', payments: [] }, { totalCents: 10000, amountPaidCents: 0, amountDueCents: 10000, statusLabel: 'Unpaid' }],
    ['native partial', { totalCents: 10000, status: 'billed', payments: [{ status: 'succeeded', amountCents: 6000 }] }, { totalCents: 10000, amountPaidCents: 6000, amountDueCents: 4000, statusLabel: 'Partially Paid' }],
    ['native paid', { totalCents: 10000, status: 'paid', payments: [{ status: 'captured', amountCents: 10000 }] }, { totalCents: 10000, amountPaidCents: 10000, amountDueCents: 0, statusLabel: 'Paid' }],
    ['imported QuickBooks unpaid', { totalCents: 10000, status: 'billed', importSource: 'quickbooks', qbImportBalanceDue: '100.00' }, { totalCents: 10000, amountPaidCents: 0, amountDueCents: 10000, statusLabel: 'Unpaid' }],
    ['imported QuickBooks partial', { totalCents: 10000, status: 'billed', importSource: 'quickbooks', qbImportBalanceDue: '40.00' }, { totalCents: 10000, amountPaidCents: 6000, amountDueCents: 4000, statusLabel: 'Partially Paid' }],
    ['historical QuickBooks paid without local payments', { totalCents: 6000, status: 'paid', importSource: 'quickbooks', isHistorical: true, qbImportBalanceDue: '0.00', payments: [] }, { totalCents: 6000, amountPaidCents: 6000, amountDueCents: 0, statusLabel: 'Paid' }],
    ['native refund', { totalCents: 750, status: 'paid', payments: [{ status: 'succeeded', amountCents: 750 }, { status: 'refunded', amountCents: 200 }] }, { totalCents: 750, amountPaidCents: 550, amountDueCents: 200, statusLabel: 'Partially Paid' }],
  ])('%s keeps every PDF field on the canonical financial projection', (_name, invoice, expected) => {
    expect(resolveInvoicePdfFinancialSummary(invoice)).toEqual(expected);
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
    expect(normalized.lines[0]).toMatchObject({ description: 'Install labor', quantity: 2, unitPrice: 40, amount: 80 });
    expect(normalized.lines[1]).toMatchObject({ description: 'Garden Rocks', quantity: 1, unitPrice: 23.55, amount: 23.55 });
  });

  test('fails softly when snapshot is malformed', () => {
    const normalized = normalizeQuickBooksLineItemsSnapshot({ bad: true });

    expect(normalized.lines).toEqual([]);
    expect(normalized.unavailableMessage).toBe('Line details unavailable from QuickBooks snapshot');
  });

  test('handles enriched QBInvoiceLineItemDetail format with parsedDetails', () => {
    const normalized = normalizeQuickBooksLineItemsSnapshot([
      {
        lineNum: 1,
        description: 'Foam Board\n2 Sides\n24 x 36\nartwork_proof.pdf',
        amount: 350,
        qty: 1,
        unitPrice: 350,
        itemRef: { qbId: '42', name: 'Foam Board' },
        serviceDate: '2025-03-10',
        suggestedProductName: 'Foam Board',
        parsedDetails: {
          productName: 'Foam Board',
          sides: '2-sided',
          quantity: null,
          measurementUnit: null,
          width: 24,
          height: 36,
          artFileName: 'artwork_proof.pdf',
          rawDescription: 'Foam Board\n2 Sides\n24 x 36\nartwork_proof.pdf',
        },
      },
    ]);

    expect(normalized.unavailableMessage).toBeNull();
    expect(normalized.lines).toHaveLength(1);
    const line = normalized.lines[0];
    expect(line.lineNum).toBe(1);
    expect(line.suggestedProductName).toBe('Foam Board');
    expect(line.parsedWidth).toBe(24);
    expect(line.parsedHeight).toBe(36);
    expect(line.parsedSides).toBe('2-sided');
    expect(line.parsedArtFileName).toBe('artwork_proof.pdf');
    expect(line.rawDescription).toBe('Foam Board\n2 Sides\n24 x 36\nartwork_proof.pdf');
    expect(line.quantity).toBe(1);
    expect(line.unitPrice).toBe(350);
    expect(line.amount).toBe(350);
  });
});
