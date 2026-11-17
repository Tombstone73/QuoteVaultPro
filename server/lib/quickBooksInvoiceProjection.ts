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
  const subtotalCents = Math.max(0, cents(invoice.subtotalCents, invoice.subtotal));
  const discountCents = Math.max(0, subtotalCents + shippingCents + taxCents - totalCents);
  // This is deliberately derived from the invoice total, not from order
  // carrier cost or a fresh shipping calculation.
  const preTaxCents = Math.max(0, totalCents - taxCents);
  const merchandiseCents = Math.max(0, preTaxCents - shippingCents);
  return { shippingCents, taxCents, totalCents, subtotalCents, discountCents, preTaxCents, merchandiseCents };
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
  if (economics.discountCents > 0) payload.DiscountAmt = Number((economics.discountCents / 100).toFixed(2));
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

/**
 * Fail before an external accounting write when the exact QBO payload cannot
 * represent the canonical local Invoice economics.  The response assertion
 * below remains necessary, but it is deliberately not the first guard.
 */
export function assertQuickBooksInvoiceProjectionParity(input: {
  invoice: CanonicalQuickBooksInvoice;
  productLines: any[];
  sourceCommercialLines: Array<{ id: string; description: string; amountCents: number }>;
  projection: { payload: any; economics: ReturnType<typeof canonicalQuickBooksInvoiceEconomics> };
}): void {
  const expected = input.projection.economics;
  const productLines = input.productLines ?? [];
  const projectedMerchandiseCents = productLines.reduce((sum, line) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  const payloadSalesLines = (Array.isArray(input.projection.payload?.Line) ? input.projection.payload.Line : [])
    .filter((line: any) => String(line?.DetailType || "") === "SalesItemLineDetail");
  const projectedSalesCents = payloadSalesLines.reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  const projectedTaxCents = moneyCents(input.projection.payload?.TxnTaxDetail?.TotalTax ?? 0) ?? 0;
  const expectedSalesCents = expected.discountCents > 0
    ? expected.subtotalCents + expected.shippingCents
    : expected.merchandiseCents + expected.shippingCents;
  const projectedDiscountCents = moneyCents(input.projection.payload?.DiscountAmt ?? 0) ?? 0;
  const projectedTotalCents = projectedSalesCents + projectedTaxCents - projectedDiscountCents;
  const sourceLinesMatchProjection = input.sourceCommercialLines.length === productLines.length
    && input.sourceCommercialLines.every((source, index) => {
      const projected = productLines[index];
      return String(projected?.Description ?? "") === source.description
        && (moneyCents(projected?.Amount) ?? null) === source.amountCents;
    });

  if (payloadSalesLines.length === 0
    || expected.discountCents > expected.subtotalCents + expected.shippingCents
    || projectedMerchandiseCents !== (expected.discountCents > 0 ? expected.subtotalCents : expected.merchandiseCents)
    || projectedSalesCents !== expectedSalesCents
    || projectedTaxCents !== expected.taxCents
    || projectedDiscountCents !== expected.discountCents
    || projectedTotalCents !== expected.totalCents
    || !sourceLinesMatchProjection) {
    const error: any = new Error(
      `QuickBooks invoice pre-send economic integrity failure: expected ${expected.totalCents} cents, projected ${projectedTotalCents} cents.`,
    );
    error.code = "QB_INVOICE_PRE_SEND_ECONOMIC_INTEGRITY_FAILURE";
    error.diagnostics = {
      expected,
      projectedMerchandiseCents,
      projectedSalesCents,
      projectedTaxCents,
      projectedDiscountCents,
      projectedTotalCents,
      productLineCount: productLines.length,
      payloadSalesLineCount: payloadSalesLines.length,
      sourceCommercialLineIds: input.sourceCommercialLines.map((line) => line.id),
      sourceLinesMatchProjection,
    };
    throw error;
  }
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

/** The simple full-discount update is only valid for an entirely unpaid linked Invoice. */
export function assertUnpaidQuickBooksInvoiceForZeroUpdate(input: {
  qbInvoice: any;
  localPaymentHistory: boolean;
  expectZeroBalance?: boolean;
}): void {
  const qb = input.qbInvoice;
  const totalCents = moneyCents(qb?.TotalAmt);
  const balanceCents = moneyCents(qb?.Balance);
  const appliedTransactions = Array.isArray(qb?.LinkedTxn)
    ? qb.LinkedTxn.filter((link: any) => ['payment', 'creditmemo', 'credit memo'].includes(String(link?.TxnType || '').trim().toLowerCase()))
    : [];
  if (input.localPaymentHistory || appliedTransactions.length > 0) {
    throw Object.assign(new Error('This Invoice has payment or credit applications. Review an accounting-safe adjustment before changing it to $0.'), { code: 'QB_ZERO_INVOICE_PAYMENT_REVIEW_REQUIRED' });
  }
  if (totalCents === null || balanceCents === null || (input.expectZeroBalance ? totalCents !== 0 || balanceCents !== 0 : balanceCents !== totalCents)) {
    throw Object.assign(new Error('QuickBooks Invoice amount or outstanding balance does not match the unpaid update path. Review the QuickBooks transaction before retrying.'), { code: 'QB_ZERO_INVOICE_BALANCE_REVIEW_REQUIRED' });
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
  const lines = Array.isArray(returned?.Line) ? returned.Line : [];
  const returnedDiscount = returned?.DiscountAmt != null
    ? moneyCents(returned.DiscountAmt)
    : lines.filter((line: any) => String(line?.DetailType || '') === 'DiscountLineDetail')
      .reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  assertQuickBooksInvoiceIdentity(input);
  if (returnedTotal === null || returnedTotal !== expected.totalCents) {
    throw new Error(`QuickBooks invoice economic drift: expected total ${expected.totalCents} cents, received ${returnedTotal ?? 'missing'} cents.`);
  }
  if (returnedTax === null || returnedTax !== expected.taxCents) {
    throw new Error(`QuickBooks invoice economic drift: expected tax ${expected.taxCents} cents, received ${returnedTax ?? 'missing'} cents.`);
  }
  if (returnedDiscount !== expected.discountCents) {
    throw new Error(`QuickBooks invoice economic drift: expected discount ${expected.discountCents} cents, received ${returnedDiscount ?? 'missing'} cents.`);
  }
  const returnedPreTax = lines
    .filter((line: any) => String(line?.DetailType || '') === 'SalesItemLineDetail')
    .reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  if (returnedPreTax - expected.discountCents !== expected.preTaxCents) {
    throw new Error(`QuickBooks invoice economic drift: expected pre-tax amount ${expected.preTaxCents} cents, received ${returnedPreTax - expected.discountCents} cents.`);
  }
  const returnedShipping = lines
    .filter((line: any) => String(line?.Description || '').trim().toLowerCase() === 'shipping')
    .reduce((sum: number, line: any) => sum + (moneyCents(line?.Amount) ?? 0), 0);
  if (returnedShipping !== expected.shippingCents) {
    throw new Error(`QuickBooks invoice economic drift: expected shipping ${expected.shippingCents} cents, received ${returnedShipping} cents.`);
  }
}
