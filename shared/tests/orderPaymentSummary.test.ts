import { describe, expect, test } from '@jest/globals';
import { deriveOrderPaymentSummary } from '../orderPaymentSummary';

test('unapproved imported invoice is accounting review, not paid or customer debt', () => {
  expect(deriveOrderPaymentSummary([{ status: 'billed', importSource: 'quickbooks', totalCents: 13000, payments: [] }]))
    .toMatchObject({ status: 'review_required', remainingCents: 0 });
});
import type { InvoiceAccountingDisplayInput } from '../invoiceAccountingDisplay';

const invoice = (totalCents = 13000, paidCents = 0, overrides: InvoiceAccountingDisplayInput = {}) => ({
  status: 'billed', totalCents,
  payments: paidCents ? [{ id: 'payment', status: 'succeeded', amountCents: paidCents }] : [],
  ...overrides,
});

describe('canonical Order payment summary', () => {
  test.each([
    ['no Invoice', [], 'not_invoiced', 0, 0],
    ['unpaid', [invoice()], 'unpaid', 0, 13000],
    ['partial', [invoice(13000, 5000)], 'partial', 5000, 8000],
    ['paid', [invoice(13000, 13000)], 'paid', 13000, 0],
    ['all paid', [invoice(50000, 50000), invoice(10000, 10000)], 'paid', 60000, 0],
    ['base paid plus additional unpaid', [invoice(50000, 50000), invoice(10000)], 'partial', 50000, 10000],
    ['multiple unpaid', [invoice(50000), invoice(10000)], 'unpaid', 0, 60000],
    ['zero dollar follows Invoice Unpaid label', [invoice(0, 0, { status: 'paid' })], 'unpaid', 0, 0],
    ['legacy draft remains a receivable', [invoice(10000, 0, { status: 'draft' })], 'unpaid', 0, 10000],
    ['overpayment does not erase another balance', [invoice(10000, 20000), invoice(5000)], 'partial', 20000, 5000],
    ['credit with no remaining debt', [invoice(10000, 12000)], 'credit', 12000, 0],
  ] as const)('%s', (_name, invoices, status, paidCents, remainingCents) => {
    expect(deriveOrderPaymentSummary(invoices)).toMatchObject({ status, paidCents, remainingCents });
  });

  test('20222-style legacy Unpaid never overrides canonical Paid, including QB imports', () => {
    const order = { orderNumber: '20222', paymentStatus: 'unpaid' };
    for (const associatedInvoice of [invoice(13000, 13000), invoice(13000, 0, {
      importSource: 'quickbooks', historicalArState: 'historical_closed', qbImportBalanceDue: '0.00', status: 'paid',
    })]) {
      const projected = { ...order, paymentSummary: deriveOrderPaymentSummary([associatedInvoice]) };
      expect(projected.paymentSummary).toMatchObject({ label: 'Paid', paidCents: 13000, remainingCents: 0 });
    }
  });

  test.each(['void', 'voided', 'canceled', 'cancelled'])('excludes canonical cancellation alias %s', (status) => {
    expect(deriveOrderPaymentSummary([invoice(99900, 0, { status }), invoice(13000, 13000)]))
      .toMatchObject({ status: 'paid', totalCents: 13000, invoiceCount: 1 });
    expect(deriveOrderPaymentSummary([invoice(99900, 0, { status })]).status).toBe('not_invoiced');
  });

  test('fresh projection moves both directions after payment and reversal', () => {
    expect(deriveOrderPaymentSummary([invoice()]).status).toBe('unpaid');
    expect(deriveOrderPaymentSummary([invoice(13000, 13000)]).status).toBe('paid');
    expect(deriveOrderPaymentSummary([invoice(13000, 0, { status: 'paid', payments: [
      { id: 'capture', status: 'succeeded', amountCents: 13000 },
      { id: 'refund', status: 'refunded', amountCents: 13000 },
    ] })])).toMatchObject({ status: 'unpaid', remainingCents: 13000 });
  });

  test.each([{ customerId: 'customer', contactId: null }, { customerId: null, contactId: 'contact' }])(
    'ownership does not affect settlement: %j', (owner) => {
      expect(deriveOrderPaymentSummary([{ ...invoice(13000, 13000), ...owner }]).status).toBe('paid');
    },
  );
});
