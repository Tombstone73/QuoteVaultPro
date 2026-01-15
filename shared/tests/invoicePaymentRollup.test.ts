import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from '../rollups/invoicePaymentRollup';

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

  test('treats manual and stripe the same (status-based)', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [
        { id: 'p_manual_1', status: 'succeeded', amountCents: 400 },
        { id: 'p_stripe_1', status: 'succeeded', amountCents: 300 },
      ],
    });
    expect(r).toEqual({ amountPaidCents: 700, amountDueCents: 300, paymentStatus: 'partial' });
  });

  test('does not double-count duplicate payment ids', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 10000,
      payments: [
        { id: 'dup_1', status: 'succeeded', amountCents: 2000 },
        { id: 'dup_1', status: 'succeeded', amountCents: 2000 },
        { id: 'unique_2', status: 'succeeded', amountCents: 1000 },
      ],
    });
    expect(r).toEqual({ amountPaidCents: 3000, amountDueCents: 7000, paymentStatus: 'partial' });
  });

  test('status label: unpaid/partial/paid based on rollup', () => {
    const unpaid = computeInvoicePaymentRollup({ invoiceTotalCents: 1000, payments: [] });
    expect(getInvoicePaymentStatusLabel({ invoiceStatus: 'sent', rollup: unpaid })).toBe('Unpaid');

    const partial = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [{ id: 'p1', status: 'succeeded', amountCents: 250 }],
    });
    expect(getInvoicePaymentStatusLabel({ invoiceStatus: 'billed', rollup: partial })).toBe('Partially Paid');

    const paid = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [{ id: 'p2', status: 'succeeded', amountCents: 1000 }],
    });
    expect(getInvoicePaymentStatusLabel({ invoiceStatus: 'billed', rollup: paid })).toBe('Paid');
  });

  test('status label: respects draft/void invoice base status', () => {
    const rollup = computeInvoicePaymentRollup({ invoiceTotalCents: 1000, payments: [] });
    expect(getInvoicePaymentStatusLabel({ invoiceStatus: 'draft', rollup })).toBe('Draft');
    expect(getInvoicePaymentStatusLabel({ invoiceStatus: 'void', rollup })).toBe('Voided');
  });
});
