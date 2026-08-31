import { describe, expect, test } from '@jest/globals';
import { getInvoiceFinancialPaymentEligibility } from '../paymentOrchestration';

describe('getInvoiceFinancialPaymentEligibility', () => {
  test('an order-backed receivable does not need a manual finalization before payment', () => {
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus: 'draft',
      remainingCents: 50_000,
    })).toEqual({ payable: true, blockedReason: null });
  });

  test('terms do not fabricate payment, and only current balance controls collection', () => {
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus: 'billed',
      remainingCents: 10_000,
    })).toEqual({ payable: true, blockedReason: null });
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus: 'paid',
      remainingCents: 0,
    })).toEqual({ payable: false, blockedReason: 'Invoice is already paid.' });
  });
});
