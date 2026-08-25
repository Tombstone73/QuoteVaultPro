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

  test('a webhook-confirmed partial refund reopens only the refunded invoice balance', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 10_000,
      payments: [
        { id: 'stripe_payment_1', status: 'succeeded', amountCents: 10_000 },
        // Refunds are immutable negative payment effects; the original
        // successful collection remains in the ledger unchanged.
        { id: 'stripe_refund_1', status: 'refunded', amountCents: 2_500 },
      ],
    });

    expect(r).toEqual({ amountPaidCents: 7_500, amountDueCents: 2_500, paymentStatus: 'partial' });
  });

  test('multiple webhook-confirmed partial refunds compose as negative payment effects', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 10_000,
      payments: [
        { id: 'stripe_payment_1', status: 'succeeded', amountCents: 10_000 },
        { id: 'stripe_refund_1', status: 'refunded', amountCents: 3_000 },
        { id: 'stripe_refund_2', status: 'refunded', amountCents: 2_000 },
      ],
    });

    expect(r).toEqual({ amountPaidCents: 5_000, amountDueCents: 5_000, paymentStatus: 'partial' });
  });

  test('does not apply a pending refund before webhook reconciliation succeeds', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 10_000,
      payments: [
        { id: 'stripe_payment_1', status: 'succeeded', amountCents: 10_000 },
        { id: 'stripe_refund_pending', status: 'pending', amountCents: 2_500 },
      ],
    });

    expect(r).toEqual({ amountPaidCents: 10_000, amountDueCents: 0, paymentStatus: 'paid' });
  });

  test('does not double-apply a replayed refund effect with the same local id', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 10_000,
      payments: [
        { id: 'stripe_payment_1', status: 'succeeded', amountCents: 10_000 },
        { id: 'stripe_refund_1', status: 'refunded', amountCents: 2_500 },
        { id: 'stripe_refund_1', status: 'refunded', amountCents: 2_500 },
      ],
    });

    expect(r).toEqual({ amountPaidCents: 7_500, amountDueCents: 2_500, paymentStatus: 'partial' });
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

  test('does not mark an invoice paid from EPS hosted PTK creation alone', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 2500,
      payments: [{ id: 'p_eps_hosted_pending', status: 'pending', amountCents: 2500 }],
    });
    expect(r).toEqual({ amountPaidCents: 0, amountDueCents: 2500, paymentStatus: 'unpaid' });
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

  test('treats captured provider payments as paid financial history', () => {
    const r = computeInvoicePaymentRollup({
      invoiceTotalCents: 1000,
      payments: [{ id: 'p_eps_capture_1', status: 'captured', amountCents: 1000 }],
    });
    expect(r).toEqual({ amountPaidCents: 1000, amountDueCents: 0, paymentStatus: 'paid' });
  });

  test('approved manual EPS hosted result marks paid only through captured ledger state', () => {
    const pending = computeInvoicePaymentRollup({
      invoiceTotalCents: 2500,
      payments: [{ id: 'p_eps_hosted_1', status: 'pending', amountCents: 2500 }],
    });
    expect(pending).toEqual({ amountPaidCents: 0, amountDueCents: 2500, paymentStatus: 'unpaid' });

    const captured = computeInvoicePaymentRollup({
      invoiceTotalCents: 2500,
      payments: [{ id: 'p_eps_hosted_1', status: 'captured', amountCents: 2500 }],
    });
    expect(captured).toEqual({ amountPaidCents: 2500, amountDueCents: 0, paymentStatus: 'paid' });
  });

  test('failed and canceled EPS hosted results do not mark invoice paid', () => {
    for (const status of ['failed', 'canceled'] as const) {
      const r = computeInvoicePaymentRollup({
        invoiceTotalCents: 2500,
        payments: [{ id: `p_eps_${status}`, status, amountCents: 2500 }],
      });
      expect(r).toEqual({ amountPaidCents: 0, amountDueCents: 2500, paymentStatus: 'unpaid' });
    }
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
