import { assertQuickBooksInvoiceEconomicParity, assertQuickBooksInvoiceIdentity, assertQuickBooksInvoiceProjectionParity, assertUnpaidQuickBooksInvoiceForZeroUpdate, buildQuickBooksInvoiceProjection } from '../lib/quickBooksInvoiceProjection';
import { firstApprovalInvoiceDate } from '../lib/invoiceDocumentDate';

const invoice = { subtotalCents: 40000, shippingCents: 2500, taxCents: 4250, totalCents: 46750 };
const productLines = [{ LineNum: 1, Amount: 400, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: 1, UnitPrice: 400 }, Description: 'Product' }];

describe('QuickBooks canonical invoice projection', () => {
  it('uses the persisted first-approval business date for TxnDate', () => {
    const documentDate = firstApprovalInvoiceDate(new Date('2026-10-09T03:30:00.000Z'), 'America/New_York');
    const result = buildQuickBooksInvoiceProjection({
      invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1',
      txnDate: documentDate.toISOString().slice(0, 10), productLines,
    });
    expect(result.payload.TxnDate).toBe('2026-10-08');
  });

  it('adds the canonical customer shipping charge exactly once and carries canonical tax', () => {
    const result = buildQuickBooksInvoiceProjection({ invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines });
    expect(result.payload.Line).toHaveLength(2);
    expect(result.payload.Line[1]).toMatchObject({ Description: 'Shipping', Amount: 25, SalesItemLineDetail: { Qty: 1, UnitPrice: 25 } });
    expect(result.payload.TxnTaxDetail).toEqual({ TotalTax: 42.5 });
  });

  it('does not invent shipping and fails closed on QBO economic drift', () => {
    expect(buildQuickBooksInvoiceProjection({ invoice: { ...invoice, shippingCents: 0, totalCents: 44250 }, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines }).payload.Line).toEqual(productLines);
    expect(() => assertQuickBooksInvoiceEconomicParity({ invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1', qbInvoice: { CustomerRef: { value: 'customer-1' }, DocNumber: 'INV-1', TotalAmt: 467.5, TxnTaxDetail: { TotalTax: 0 }, Line: [{ Description: 'Product', Amount: 400, DetailType: 'SalesItemLineDetail' }, { Description: 'Shipping', Amount: 25, DetailType: 'SalesItemLineDetail' }] } })).toThrow('expected tax 4250');
    expect(() => assertQuickBooksInvoiceEconomicParity({ invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1', qbInvoice: { CustomerRef: { value: 'customer-1' }, DocNumber: 'INV-1', TotalAmt: 467.5, TxnTaxDetail: { TotalTax: 42.5 }, Line: [{ Description: 'Product', Amount: 400, DetailType: 'SalesItemLineDetail' }, { Description: 'Shipping', Amount: 25, DetailType: 'SalesItemLineDetail' }] } })).not.toThrow();
  });

  it('fails locally before a QuickBooks request when product lines contradict the canonical invoice', () => {
    const projection = buildQuickBooksInvoiceProjection({ invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines: [{ ...productLines[0], Amount: 432.1 }] });
    expect(() => assertQuickBooksInvoiceProjectionParity({ invoice, productLines: projection.payload.Line.slice(0, 1), sourceCommercialLines: [{ id: 'line-1', description: 'Product', amountCents: 43_210 }], projection })).toThrow('pre-send economic integrity failure');
  });

  it('uses only the canonical per-invoice customer shipping allocation, never carrier cost', () => {
    const result = buildQuickBooksInvoiceProjection({
      invoice: { ...invoice, shippingCents: 1800, carrierCostCents: 99_999, totalCents: 46050 },
      qbCustomerId: 'customer-1',
      docNumber: 'INV-1',
      txnDate: '2026-09-22',
      productLines,
    });
    expect(result.payload.Line).toHaveLength(2);
    expect(result.payload.Line[1]).toMatchObject({ Description: 'Shipping', Amount: 18 });
    expect(result.payload.Line).not.toEqual(expect.arrayContaining([expect.objectContaining({ Amount: 999.99 })]));
  });

  it('keeps taxed invoice economics independent from customer tax-exempt metadata and identical for update payloads', () => {
    const create = buildQuickBooksInvoiceProjection({
      invoice: { ...invoice, customerTaxExempt: true },
      qbCustomerId: 'customer-1',
      docNumber: 'INV-1',
      txnDate: '2026-09-22',
      productLines,
    });
    const update = { ...create.payload, Id: 'linked-invoice', SyncToken: '7' };
    expect(create.payload.TxnTaxDetail).toEqual({ TotalTax: 42.5 });
    expect(update).toMatchObject({ ...create.payload, Id: 'linked-invoice', SyncToken: '7' });
  });

  it('rejects a returned document with the wrong linked customer or number', () => {
    const response = { CustomerRef: { value: 'other-customer' }, DocNumber: 'INV-1', TotalAmt: 467.5, TxnTaxDetail: { TotalTax: 42.5 }, Line: [{ Description: 'Product', Amount: 400, DetailType: 'SalesItemLineDetail' }, { Description: 'Shipping', Amount: 25, DetailType: 'SalesItemLineDetail' }] };
    expect(() => assertQuickBooksInvoiceEconomicParity({ invoice, qbCustomerId: 'customer-1', docNumber: 'INV-1', qbInvoice: response })).toThrow('expected customer customer-1');
  });

  it('preflights the existing linked invoice identity before an update', () => {
    expect(() => assertQuickBooksInvoiceIdentity({ qbInvoice: { Id: 'unexpected', CustomerRef: { value: 'customer-1' }, DocNumber: 'INV-1' }, qbInvoiceId: 'linked-invoice', qbCustomerId: 'customer-1', docNumber: 'INV-1' })).toThrow('expected linked invoice linked-invoice');
  });

  it('represents a full Order discount on the existing invoice with its original sales line and an exact $0 total', () => {
    const discounted = { subtotalCents: 40000, shippingCents: 0, taxCents: 0, totalCents: 0 };
    const projection = buildQuickBooksInvoiceProjection({ invoice: discounted, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines });
    expect(projection.payload).toMatchObject({ DiscountAmt: 400, Line: productLines });
    expect(() => assertQuickBooksInvoiceProjectionParity({ invoice: discounted, productLines, sourceCommercialLines: [{ id: 'line-1', description: 'Product', amountCents: 40000 }], projection })).not.toThrow();
    const qb = { Id: 'linked-invoice', CustomerRef: { value: 'customer-1' }, DocNumber: 'INV-1', TotalAmt: 0, Balance: 0, DiscountAmt: 400, Line: productLines };
    expect(() => assertQuickBooksInvoiceEconomicParity({ invoice: discounted, qbInvoice: qb, qbCustomerId: 'customer-1', docNumber: 'INV-1' })).not.toThrow();
    expect(() => assertUnpaidQuickBooksInvoiceForZeroUpdate({ qbInvoice: qb, localPaymentHistory: false, expectZeroBalance: true })).not.toThrow();
  });

  it('rejects an empty zero-dollar payload and a discount larger than its charges before an external write', () => {
    const discounted = { subtotalCents: 40000, shippingCents: 0, taxCents: 0, totalCents: 0 };
    const empty = buildQuickBooksInvoiceProjection({ invoice: discounted, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines: [] });
    expect(() => assertQuickBooksInvoiceProjectionParity({ invoice: discounted, productLines: [], sourceCommercialLines: [], projection: empty })).toThrow('pre-send economic integrity failure');
    const staleTax = { subtotalCents: 40000, shippingCents: 0, taxCents: 100, totalCents: 0 };
    const invalid = buildQuickBooksInvoiceProjection({ invoice: staleTax, qbCustomerId: 'customer-1', docNumber: 'INV-1', txnDate: '2026-09-22', productLines });
    expect(() => assertQuickBooksInvoiceProjectionParity({ invoice: staleTax, productLines, sourceCommercialLines: [{ id: 'line-1', description: 'Product', amountCents: 40000 }], projection: invalid })).toThrow('pre-send economic integrity failure');
  });

  it('blocks local payments, QuickBooks applications, and mismatched balances on the simple unpaid update path', () => {
    const qb = { TotalAmt: 400, Balance: 400, LinkedTxn: [] };
    expect(() => assertUnpaidQuickBooksInvoiceForZeroUpdate({ qbInvoice: qb, localPaymentHistory: false })).not.toThrow();
    expect(() => assertUnpaidQuickBooksInvoiceForZeroUpdate({ qbInvoice: qb, localPaymentHistory: true })).toThrow('payment or credit applications');
    expect(() => assertUnpaidQuickBooksInvoiceForZeroUpdate({ qbInvoice: { ...qb, LinkedTxn: [{ TxnType: 'Payment', TxnId: 'payment-1' }] }, localPaymentHistory: false })).toThrow('payment or credit applications');
    expect(() => assertUnpaidQuickBooksInvoiceForZeroUpdate({ qbInvoice: { ...qb, Balance: 300 }, localPaymentHistory: false })).toThrow('outstanding balance');
  });
});
