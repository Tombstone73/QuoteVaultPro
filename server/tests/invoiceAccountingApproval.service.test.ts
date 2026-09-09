import { expect, test } from '@jest/globals';
import { accountingApprovalRevocationPatch, getInvoiceAccountingApprovalState, getInvoiceQuickBooksApprovalEligibility, isInvoiceApprovedForAccounting } from '../lib/invoiceAccountingApproval';

const currentInvoice = { invoiceVersion: 4, qbSyncStatus: 'pending' };

test('new and unsynced invoices require explicit accounting approval', () => {
  expect(getInvoiceAccountingApprovalState(currentInvoice)).toBe('not_approved');
  expect(isInvoiceApprovedForAccounting(currentInvoice)).toBe(false);
  expect(getInvoiceQuickBooksApprovalEligibility(currentInvoice)).toEqual({
    eligible: false,
    code: 'INVOICE_NOT_APPROVED',
    reason: 'Approve invoice for accounting before syncing.',
  });
});

test('approval is valid only for the approved invoice version', () => {
  const approved = { ...currentInvoice, accountingApprovedAt: new Date(), accountingApprovedByUserId: 'user-1', accountingApprovedVersion: 4 };
  expect(getInvoiceAccountingApprovalState(approved)).toBe('approved');
  expect(isInvoiceApprovedForAccounting(approved)).toBe(true);
  const changed = { ...approved, invoiceVersion: 5, accountingApprovalRevokedAt: new Date() };
  expect(getInvoiceAccountingApprovalState(changed)).toBe('needs_reapproval');
  expect(isInvoiceApprovedForAccounting(changed)).toBe(false);
  expect(getInvoiceQuickBooksApprovalEligibility(approved)).toEqual({ eligible: true });
  expect(accountingApprovalRevocationPatch(approved)).toMatchObject({
    accountingApprovedAt: null,
    accountingApprovedByUserId: null,
    qbSyncStatus: 'not_synced',
  });
});

test('legacy synchronized invoices remain valid until a future commercial change', () => {
  const legacy = { invoiceVersion: 3, qbSyncStatus: 'synced', qbInvoiceId: '123', lastQbSyncedVersion: 3 };
  expect(getInvoiceAccountingApprovalState(legacy)).toBe('legacy_synced');
  expect(isInvoiceApprovedForAccounting(legacy)).toBe(true);
  expect(getInvoiceQuickBooksApprovalEligibility(legacy)).toEqual({ eligible: true });
  expect(isInvoiceApprovedForAccounting({ ...legacy, invoiceVersion: 4, qbSyncStatus: 'needs_resync' })).toBe(false);
});
