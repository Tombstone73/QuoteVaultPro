/**
 * The outbound Invoice projection intentionally derives all economic values
 * from the issued TitanOS invoice.  QuickBooks is not allowed to recompute a
 * different customer charge because a customer happens to be tax exempt there.
 */
export type CanonicalQuickBooksInvoice = Record<string, unknown>;

const cents = (value: unknown, fallback: unknown = 0): number => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.round(direct);
  const decimal = Number(fallback);
  return Number.isFinite(decimal) ? Math.round(decimal * 100) : 0;
};

export function canonicalQuickBooksInvoiceEconomics(invoice: CanonicalQuickBooksInvoice) {
  const shippingCents = Math.max(0, cents(invoice.shippingCents));
  const taxCents = Math.max(0, cents(invoice.taxCents, invoice.tax));
  const totalCents = Math.max(0, cents(invoice.totalCents, invoice.total));
  // This is deliberately derived from the invoice total, not from order
  // carrier cost or a fresh shipping calculation.
  const preTaxCents = Math.max(0, totalCents - taxCents);
  const merchandiseCents = Math.max(0, preTaxCents - shippingCents);
  return { shippingCents, taxCents, totalCents, preTaxCents, merchandiseCents };
}

export function buildQuickBooksInvoiceProjection(input: {
  invoice: CanonicalQuickBooksInvoice;
  qbCustomerId: string;
  docNumber: string;
  txnDate: string;
  dueDate?: string;
  productLines: any[];
}) {
  const economics = canonicalQuickBooksInvoiceEconomics(input.invoice);
  const lines = [...input.productLines];
  if (economics.shippingCents > 0) {
    lines.push({
      LineNum: lines.length + 1,
      Amount: Number((economics.shippingCents / 100).toFixed(2)),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { Qty: 1, UnitPrice: Number((economics.shippingCents / 100).toFixed(2)) },
      Description: 'Shipping',
    });
  }

  const payload: any = {
    CustomerRef: { value: input.qbCustomerId },
    DocNumber: input.docNumber,
    TxnDate: input.txnDate,
    Line: lines,
  };
  if (input.dueDate) payload.DueDate = input.dueDate;
  if (economics.taxCents > 0) {
    // Tax lines must live in TxnTaxDetail in QBO.  We explicitly carry the
    // canonical total and verify the response because QBO may otherwise
    // suppress tax from an exempt customer profile.
    payload.GlobalTaxCalculation = 'TaxExcluded';
    payload.TxnTaxDetail = { TotalTax: Number((economics.taxCents / 100).toFixed(2)) };
  }
  return { payload, economics };
}

function moneyCents(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

export function assertQuickBooksInvoiceIdentity(input: {
  qbInvoice: any;
  qbCustomerId: string;
  docNumber: string;
  qbInvoiceId?: string;
}): void {
  const returned = input.qbInvoice;
  const returnedId = String(returned?.Id ?? '');
  const returnedCustomerId = String(returned?.CustomerRef?.value ?? '');
  const returnedDocNumber = String(returned?.DocNumber ?? '');
  if (input.qbInvoiceId && returnedId !== input.qbInvoiceId) {
    throw new Error(`QuickBooks invoice reconciliation drift: expected linked invoice ${input.qbInvoiceId}, received ${returnedId || 'missing'}.`);
  }
  if (returnedCustomerId !== input.qbCustomerId) {
    throw new Error(`QuickBooks invoice reconciliation drift: expected customer ${input.qbCustomerId}, received ${returnedCustomerId || 'missing'}.`);
  }
  if (returnedDocNumber !== input.docNumber) {
    throw new Error(`QuickBooks invoice reconciliation drift: expected document number ${input.docNumber}, received ${returnedDocNumber || 'missing'}.`);
  }
}

/** Throws so queue/manual callers record a review-required failed sync. */
export function assertQuickBooksInvoiceEconomicParity(input: {
  invoice: CanonicalQuickBooksInvoice;
  qbInvoice: any;
  qbCustomerId: string;
  docNumber: string;
}): void {
  const expected = canonicalQuickBooksInvoiceEconomics(input.invoice);
  const returned = input.qbInvoice;
  const returnedTotal = moneyCents(returned?.TotalAmt);
  const returnedTax = moneyCents(returned?.TxnTaxDetail?.TotalTax ?? 0);
  assertQuickBooksInvoiceIdentity(input);
  if (returnedTotal === null || returnedTotal !== expected.totalCents) {
    throw new Error(`QuickBooks invoice economic drift: expected total ${expected.totalCents} cents, received ${returnedTotal ?? 'missing'} cents.`);
  }
  if (returnedTax === null || returnedTax !== expected.taxCents) {
    throw new Error(`QuickBooks invoice economic drift: expected tax ${expected.taxCents} cents, received ${returnedTax ?? 'missing'} cents.`);
  }
  const lines = Array.isArray(returned?.Line) ? returned.Line : [];
  const returnedPreTax = lines
    .filter((line: any) => String(line?.DetailType || '') === 'SalesItemLineDetail')
    .reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  if (returnedPreTax !== expected.preTaxCents) {
    throw new Error(`QuickBooks invoice economic drift: expected pre-tax line total ${expected.preTaxCents} cents, received ${returnedPreTax} cents.`);
  }
  const returnedShipping = lines
    .filter((line: any) => String(line?.Description || '').trim().toLowerCase() === 'shipping')
    .reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  if (returnedShipping !== expected.shippingCents) {
    throw new Error(`QuickBooks invoice economic drift: expected shipping ${expected.shippingCents} cents, received ${returnedShipping} cents.`);
  }
}
