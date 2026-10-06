import { describe, expect, test } from '@jest/globals';
import { approvedHistoricalArBalanceCents, resolveHistoricalArState } from '../historicalArAuthority';
import { normalizeInvoiceAccountingDisplay } from '../invoiceAccountingDisplay';

describe('historical import A/R authority', () => {
  test('closed imported invoice with no local Payment remains zero due', () => {
    const invoice = { importSource: 'quickbooks', historicalArState: 'historical_closed', totalCents: 4400,
      balanceDue: '44.00', qbImportBalanceDue: '44.00', status: 'billed', payments: [] };
    expect(resolveHistoricalArState(invoice)).toBe('historical_closed');
    expect(normalizeInvoiceAccountingDisplay(invoice).remainingCents).toBe(0);
    expect(normalizeInvoiceAccountingDisplay({ ...invoice, payments: undefined }).remainingCents).toBe(0);
  });

  test('open A/R needs source balance and explicit approval evidence', () => {
    const candidate = { importSource: 'infoflow', historicalArState: 'historical_open_ar_reconciled',
      historicalArSourceBalanceCents: 4400, totalCents: 10000, status: 'billed', customerId: 'customer-1', externalAccountingId: 'legacy-1' };
    expect(resolveHistoricalArState(candidate)).toBe('historical_review_required');
    const approved = { ...candidate, historicalArApprovedAt: '2026-01-01', historicalArApprovedByUserId: 'reviewer',
      historicalArApprovalEvidence: { sourceInvoiceId: 'legacy-1', customerId: 'customer-1', originalCents: 10000,
        remainingCents: 4400, sourceStatus: 'open', sourceDate: '2025-01-01', paymentEvidence: 'source-ledger' } };
    expect(approvedHistoricalArBalanceCents(approved)).toBe(4400);
    expect(normalizeInvoiceAccountingDisplay({ ...approved, payments: [] }).remainingCents).toBe(4400);
    expect(resolveHistoricalArState({ ...approved, customerId: 'different-customer' })).toBe('historical_review_required');
    expect(resolveHistoricalArState({ ...approved, historicalArSourceBalanceCents: 4500 })).toBe('historical_review_required');
  });

  test('ambiguous import cannot become customer debt while native invoice still uses Payments', () => {
    const fields = { totalCents: 4400, balanceDue: '44.00', status: 'billed' };
    expect(normalizeInvoiceAccountingDisplay({ ...fields, importSource: 'legacy', payments: [] }).remainingCents).toBe(0);
    expect(normalizeInvoiceAccountingDisplay({ ...fields, importSource: 'legacy', payments: [] }).displayStatus).toBe('Historical Review Required');
    expect(normalizeInvoiceAccountingDisplay({ ...fields, importSource: 'legacy', payments: [] }).isFullyPaid).toBe(false);
    expect(normalizeInvoiceAccountingDisplay({ ...fields, payments: [] }).remainingCents).toBe(4400);
    expect(normalizeInvoiceAccountingDisplay({ ...fields, payments: [{ status: 'succeeded', amountCents: 4400 }] }).remainingCents).toBe(0);
  });
});
