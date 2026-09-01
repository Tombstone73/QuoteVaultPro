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

  test('a partial payment or reopened balance remains payable', () => {
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus: 'partially_paid',
      remainingCents: 5_500,
    })).toEqual({ payable: true, blockedReason: null });
    // A refund can reopen a balance even when the persisted label remains paid.
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus: 'paid',
      remainingCents: 250,
    })).toEqual({ payable: true, blockedReason: null });
  });

  test.each([
    ['void', 'Void invoices cannot accept payment.'],
    ['voided', 'Void invoices cannot accept payment.'],
    ['canceled', 'Canceled invoices cannot accept payment.'],
    ['cancelled', 'Canceled invoices cannot accept payment.'],
  ])('%s invoices are never payable', (invoiceStatus, blockedReason) => {
    expect(getInvoiceFinancialPaymentEligibility({
      invoiceStatus,
      remainingCents: 10_000,
    })).toEqual({ payable: false, blockedReason });
  });
});
