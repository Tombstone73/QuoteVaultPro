import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName, sql } from 'drizzle-orm';

let invoice: any; let payment: any; let batch: any; let context: any;
const writes = jest.fn();
const query = () => {
  let rows: any[] = [];
  const q: any = { from: (table: any) => { rows = ({ invoices: [invoice], payments: [payment], customer_payment_batches: batch ? [batch] : [] } as any)[getTableName(table)] ?? []; return q; },
    where: () => q, limit: async () => rows };
  return q;
};
jest.unstable_mockModule('../db', () => ({ db: { select: query, update: writes, insert: writes, execute: writes }, pool: {} }));
jest.unstable_mockModule('../services/invoiceCustomerProjection', () => ({ canonicalInvoiceCustomerId: sql`null`, getCanonicalInvoiceCustomerContext: async () => context }));
jest.unstable_mockModule('../services/billingOwnershipReview.service', () => ({
  withBillingOwnershipSyncGuard: async (_org: string, _invoice: string, work: any) => work(), assertBillingOwnershipReconciled: async () => {},
  BillingOwnershipReviewError: class extends Error {}, requireBillingOwnershipReviewer: () => {}, getBillingOwnershipReview: async () => null,
}));
const service = await import('../quickbooksService');
beforeEach(() => {
  writes.mockReset();
  invoice = { id: 'invoice', organizationId: 'org', customerId: 'old', contactId: null, status: 'billed',
    invoiceVersion: 1, accountingApprovedVersion: 1, accountingApprovedAt: new Date(), accountingApprovalRevokedAt: null, qbInvoiceId: 'qb-invoice' };
  payment = { id: 'payment', organizationId: 'org', invoiceId: 'invoice', status: 'succeeded', customerPaymentBatchId: 'batch', amountCents: 8500 };
  batch = { id: 'batch', organizationId: 'org', customerId: 'new' };
  context = { storedCustomerId: 'old', resolvedCustomerId: 'new', customer: { id: 'new' } };
});
test('QuickBooks Invoice export rejects read-projection/stored-owner divergence before any local or provider write', async () => {
  await expect(service.syncSingleInvoiceToQuickBooksForOrganization('org', 'invoice')).rejects.toThrow('billing ownership differ');
  expect(writes).not.toHaveBeenCalled();
});
test('QuickBooks payment export cannot hide a stale Invoice behind the current Order', async () => {
  await expect(service.syncSinglePaymentToQuickBooksForOrganization('org', 'payment')).rejects.toThrow('billing ownership differ');
  expect(writes).not.toHaveBeenCalled();
});
test.each(['wrong-owner', 'missing'])('QuickBooks payment export rejects %s batch lineage', async scenario => {
  context.storedCustomerId = 'new'; invoice.customerId = 'new';
  batch = scenario === 'missing' ? null : { ...batch, customerId: 'old' };
  await expect(service.syncSinglePaymentToQuickBooksForOrganization('org', 'payment')).rejects.toThrow('batch and Invoice billing ownership differ');
  expect(writes).not.toHaveBeenCalled();
});
