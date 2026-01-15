import { computeInvoicePaymentRollup } from '../rollups/invoicePaymentRollup';

describe('computeInvoicePaymentRollup', () => {
  test('unpaid', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [],
    });
    expect(r).toEqual({ amountPaidCents: 0, amountDueCents: 1000, paymentStatus: 'unpaid' });
  });

  test('partial', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [{ status: 'succeeded', amountCents: 250 }],
    });
    expect(r).toEqual({ amountPaidCents: 250, amountDueCents: 750, paymentStatus: 'partial' });
  });

  test('paid', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [{ status: 'succeeded', amountCents: 1000 }],
    });
    expect(r).toEqual({ amountPaidCents: 1000, amountDueCents: 0, paymentStatus: 'paid' });
  });

  test('multiple payments clamp to invoice total', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [
        { status: 'succeeded', amountCents: 600 },
        { status: 'succeeded', amountCents: 600 },
      ],
    });
    expect(r).toEqual({ amountPaidCents: 1000, amountDueCents: 0, paymentStatus: 'paid' });
  });

  test('succeeded then refunded (full refund)', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [
        { status: 'succeeded', amountCents: 1000 },
        { status: 'refunded', amountCents: 1000 },
      ],
    });
    expect(r).toEqual({ amountPaidCents: 0, amountDueCents: 1000, paymentStatus: 'refunded' });
  });

  test('ignores pending and voided payments', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [
        { status: 'succeeded', amountCents: 250 },
        { status: 'pending', amountCents: 500 },
        { status: 'voided', amountCents: 500 },
      ],
    });
    expect(r).toEqual({ amountPaidCents: 250, amountDueCents: 750, paymentStatus: 'partial' });
  });
});
