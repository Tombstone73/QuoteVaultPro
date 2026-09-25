import { getInvoiceCustomerPaymentEligibility as eligibility } from '../lib/invoiceCustomerPaymentEligibility';
import { getInvoiceFinancialPaymentEligibility } from '../../shared/paymentOrchestration';

const invoice = { status: 'billed', invoiceVersion: 3, accountingApprovedAt: null, accountingApprovedVersion: null };
const approved = { ...invoice, accountingApprovedAt: new Date(), accountingApprovedVersion: 3 };

test('20544 remains a receivable but cannot be paid by a customer before approval', () => {
  expect(eligibility(invoice, 25000)).toEqual({ payable: false, blockedReason: 'Awaiting approval' });
  expect(getInvoiceFinancialPaymentEligibility({ invoiceStatus: invoice.status, remainingCents: 25000 }).payable).toBe(true);
});
test('approval on refresh opens payment; revoked or outdated approval closes it', () => {
  expect(eligibility(approved, 25000).payable).toBe(true);
  expect(eligibility({ ...approved, invoiceVersion: 4 }, 25000).payable).toBe(false);
  expect(eligibility({ ...approved, accountingApprovalRevokedAt: new Date() }, 25000).payable).toBe(false);
});
test.each(['void', 'voided', 'canceled', 'cancelled'])('approval cannot make %s payable', status => {
  expect(eligibility({ ...approved, status }, 25000).payable).toBe(false);
});
test('paid, historical and imported invoices retain existing financial restrictions', () => {
  expect(eligibility(approved, 0).payable).toBe(false);
  expect(eligibility({ ...approved, isHistorical: true }, 25000).payable).toBe(false);
  expect(eligibility({ ...approved, importSource: 'quickbooks' }, 25000).payable).toBe(false);
});
test('only the canonical version-matched legacy approval exception is accepted', () => {
  const legacy = { ...invoice, qbSyncStatus: 'synced', qbInvoiceId: 'qb', lastQbSyncedVersion: 3 };
  expect(eligibility(legacy, 25000).payable).toBe(true);
  expect(eligibility({ ...legacy, lastQbSyncedVersion: 2 }, 25000).payable).toBe(false);
});
