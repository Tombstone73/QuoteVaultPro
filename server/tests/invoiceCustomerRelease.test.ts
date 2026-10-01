import { getInvoiceCustomerReleaseEligibility, isInvoiceCustomerVisible } from '../lib/invoiceCustomerRelease';
import { getInvoiceCustomerPaymentEligibility } from '../lib/invoiceCustomerPaymentEligibility';
import { getInvoiceQuickBooksApprovalEligibility, accountingApprovalRevocationPatch } from '../lib/invoiceAccountingApproval';

const internal = { status: 'draft', customerId: 'customer', invoiceVersion: 2, accountingApprovedAt: null };
const released = { ...internal, customerReleasedAt: new Date() };
const approved = { ...internal, accountingApprovedAt: new Date(), accountingApprovedVersion: 2 };

test('release enables draft customer access and payment without QuickBooks approval', () => {
  expect(isInvoiceCustomerVisible(internal)).toBe(false);
  expect(getInvoiceCustomerPaymentEligibility(internal, 5000).payable).toBe(false);
  expect(isInvoiceCustomerVisible(released)).toBe(true);
  expect(getInvoiceCustomerPaymentEligibility(released, 5000).payable).toBe(true);
  expect(getInvoiceQuickBooksApprovalEligibility(released).eligible).toBe(false);
  expect(getInvoiceQuickBooksApprovalEligibility({ ...approved, customerReleasedAt: released.customerReleasedAt }).eligible).toBe(true);
});

test('approved and version-matched legacy synced invoices remain visible without backfill', () => {
  expect(isInvoiceCustomerVisible(approved)).toBe(true);
  expect(isInvoiceCustomerVisible({ ...internal, status: 'billed', qbSyncStatus: 'synced', qbInvoiceId: 'qb', lastQbSyncedVersion: 2 })).toBe(true);
  expect(isInvoiceCustomerVisible({ ...approved, invoiceVersion: 3 })).toBe(false);
  expect(isInvoiceCustomerVisible({ ...released, ...accountingApprovalRevocationPatch(approved), invoiceVersion: 3 })).toBe(true);
});

test.each(['billed', 'sent', 'partially_paid', 'paid', 'open', 'finalized'])('%s is not release authority by itself', status => {
  expect(isInvoiceCustomerVisible({ ...internal, status })).toBe(false);
  expect(isInvoiceCustomerVisible({ ...released, status })).toBe(true);
});

test.each(['void', 'voided', 'canceled', 'cancelled'])('release cannot make %s payable or releasable', status => {
  expect(getInvoiceCustomerReleaseEligibility({ ...internal, status }).eligible).toBe(false);
  expect(getInvoiceCustomerPaymentEligibility({ ...released, status }, 5000).payable).toBe(false);
});

test('paid and partially paid balance rules, imported history, and ownership guards remain separate', () => {
  expect(getInvoiceCustomerPaymentEligibility(released, 0).payable).toBe(false);
  expect(getInvoiceCustomerPaymentEligibility({ ...released, status: 'partially_paid' }, 2000).payable).toBe(true);
  const imported = { ...internal, status: 'paid', importSource: 'quickbooks' };
  expect(isInvoiceCustomerVisible(imported)).toBe(true);
  expect(getInvoiceCustomerPaymentEligibility(imported, 5000).payable).toBe(false);
  expect(getInvoiceCustomerReleaseEligibility(imported).eligible).toBe(false);
  expect(getInvoiceCustomerReleaseEligibility({ ...internal, customerId: null }).eligible).toBe(false);
});
