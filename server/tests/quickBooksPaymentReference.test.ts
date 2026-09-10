import { expect, test } from '@jest/globals';
import {
  QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH,
  assertQuickBooksDocumentNumber,
  buildQuickBooksPaymentPayload,
  formatQuickBooksPaymentReference,
  getExplicitPaymentReference,
  resolveQuickBooksPaymentReference,
} from '../lib/quickBooksPaymentReference';

test('uses the persisted provider-safe reference even when a payment has a short operator check reference', () => {
  const metadata = { reference: 'CHECK-2048' };
  expect(getExplicitPaymentReference(metadata)).toBe('CHECK-2048');
  expect(resolveQuickBooksPaymentReference({ canonicalReference: 'PMT-1000' }))
    .toEqual({ value: 'PMT-1000', source: 'canonical' });
});

test('uses the persisted PrintersHero reference for oversized legacy QVP UUID-style metadata', () => {
  const canonicalReference = formatQuickBooksPaymentReference(1000);
  const originalMetadata = { reference: 'QVP-18b63fad-9c8e-4d2f-a123-0b456789cdef' };
  expect(resolveQuickBooksPaymentReference({ canonicalReference }))
    .toEqual({ value: canonicalReference, source: 'canonical' });
  expect(getExplicitPaymentReference(originalMetadata)).toBe(originalMetadata.reference);
  expect(canonicalReference.length).toBeLessThanOrEqual(QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH);
});

test('generated payment references are short, readable, stable, and distinct', () => {
  const first = formatQuickBooksPaymentReference(1000);
  const second = formatQuickBooksPaymentReference(1001);
  expect(first).toBe('PMT-1000');
  expect(second).toBe('PMT-1001');
  expect(first).not.toBe(second);
  expect(first.length).toBeLessThanOrEqual(QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH);
  expect(first).not.toMatch(/QVP-[0-9a-f-]{8,}/i);
});

test('one payment keeps its canonical reference across retries while multiple payments remain distinct', () => {
  const firstPaymentReference = formatQuickBooksPaymentReference(20002);
  const samePaymentRetryReference = resolveQuickBooksPaymentReference({ canonicalReference: firstPaymentReference });
  const secondPaymentForSameInvoiceReference = formatQuickBooksPaymentReference(20003);

  expect(samePaymentRetryReference).toEqual({ value: firstPaymentReference, source: 'canonical' });
  expect(secondPaymentForSameInvoiceReference).not.toBe(firstPaymentReference);
});

test.each(['manual', 'stripe', 'eps'])('%s payment metadata cannot replace the canonical QuickBooks recovery key', (provider) => {
  const canonicalReference = formatQuickBooksPaymentReference(30001);
  expect(getExplicitPaymentReference({ provider, reference: 'CHECK-30001' })).toBe('CHECK-30001');
  expect(resolveQuickBooksPaymentReference({ canonicalReference }))
    .toEqual({ value: canonicalReference, source: 'canonical' });
});

test('the known long-reference payment builds a provider-valid $145.00 payload with its synced invoice link', () => {
  const paymentReference = formatQuickBooksPaymentReference(20002);
  const payload = buildQuickBooksPaymentPayload({
    qbCustomerId: 'qb-customer-20002',
    amount: 145,
    txnDate: '2026-09-10',
    paymentReference,
    privateNote: `PrintersHero payment ${paymentReference}`,
    qbInvoiceId: 'qb-invoice-20002',
  });

  const mockQuickBooksProvider = (candidate: typeof payload) => {
    if (candidate.PaymentRefNum.length > QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH) throw new Error('doc_num too long');
    if (candidate.TotalAmt !== candidate.Line[0].Amount) throw new Error('payment amount mismatch');
    if (candidate.Line[0].LinkedTxn[0]?.TxnType !== 'Invoice') throw new Error('missing invoice link');
    return { Payment: { Id: 'qb-payment-20002' } };
  };

  expect(mockQuickBooksProvider(payload)).toEqual({ Payment: { Id: 'qb-payment-20002' } });
  expect(payload).toMatchObject({
    TotalAmt: 145,
    PaymentRefNum: 'PMT-20002',
    Line: [{ Amount: 145, LinkedTxn: [{ TxnId: 'qb-invoice-20002', TxnType: 'Invoice' }] }],
  });
});

test('rejects an invalid persisted QBO document reference before API submission', () => {
  expect(() => assertQuickBooksDocumentNumber('X'.repeat(22), 'QuickBooks payment reference')).toThrow('21 characters or fewer');
});
