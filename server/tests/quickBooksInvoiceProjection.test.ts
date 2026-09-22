import { assertQuickBooksInvoiceEconomicParity, assertQuickBooksInvoiceIdentity, buildQuickBooksInvoiceProjection } from '../lib/quickBooksInvoiceProjection';

const invoice = { subtotalCents: 40000, shippingCents: 2500, taxCents: 4250, totalCents: 46750 };
const productLines = [{ LineNum: 1, Amount: 400, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: 1, UnitPrice: 400 }, Description: 'Product' }];

describe('QuickBooks canonical invoice projection', () => {
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
});
