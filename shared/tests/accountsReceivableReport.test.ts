import { describe, expect, test } from '@jest/globals';
import { getAccountsReceivableAging, isAccountsReceivableRowOverdue, pageAccountsReceivableRows, qualifiesForAccountsReceivable, summarizeAccountsReceivable, type AccountsReceivableRow } from '../accountsReceivableReport';

const row = (overrides: Partial<AccountsReceivableRow> = {}): AccountsReceivableRow => ({
  id: 'invoice-1', customerId: 'customer-1', customerName: 'Acme', contactName: null, invoiceNumber: 'INV-1', orderId: null, orderNumber: null, jobName: null, purchaseOrderNumber: null, issueDate: '2026-09-01', dueDate: '2026-09-16', daysPastDue: 0, agingBucket: 'current', invoiceStatus: 'Unpaid', approvalStatus: 'Approved', sendStatus: 'Never Sent', terms: 'net_30', totalCents: 10000, paidCents: 0, remainingCents: 10000, lastSentAt: null, qbSyncStatus: 'not_synced', jobStatus: 'no linked order', ...overrides,
});

describe('Accounts Receivable aging', () => {
  test.each([
    ['2026-09-16', 'current', 0], ['2026-09-15', '1-30', 1], ['2026-08-17', '1-30', 30], ['2026-08-16', '31-60', 31], ['2026-07-18', '31-60', 60], ['2026-07-17', '61-90', 61], ['2026-06-17', '90+', 91],
  ] as const)('classifies due date %s as %s', (dueDate, agingBucket, daysPastDue) => {
    expect(getAccountsReceivableAging(dueDate, '2026-09-16')).toEqual({ agingBucket, daysPastDue });
  });

  test('keeps missing due dates separate without inventing a date', () => {
    expect(getAccountsReceivableAging(null, '2026-09-16')).toEqual({ agingBucket: 'no_due_date', daysPastDue: null });
  });

  test('marks only dates before the organization business date as overdue', () => {
    expect(isAccountsReceivableRowOverdue(row({ dueDate: '2026-09-15', daysPastDue: 1 }))).toBe(true);
    expect(isAccountsReceivableRowOverdue(row({ dueDate: '2026-09-16', daysPastDue: 0 }))).toBe(false);
    expect(isAccountsReceivableRowOverdue(row({ dueDate: '2026-09-17', daysPastDue: 0 }))).toBe(false);
    expect(isAccountsReceivableRowOverdue(row({ dueDate: null, daysPastDue: null, agingBucket: 'no_due_date' }))).toBe(false);
  });

  test('reconciles full-dataset outstanding and aging totals independently of page rows', () => {
    const summary = summarizeAccountsReceivable([
      row({ id: 'current', remainingCents: 10000, agingBucket: 'current', daysPastDue: 0 }),
      row({ id: 'overdue', remainingCents: 2500, agingBucket: '1-30', daysPastDue: 5 }),
      row({ id: 'no-date', remainingCents: 500, agingBucket: 'no_due_date', daysPastDue: null }),
    ]);
    expect(summary).toMatchObject({ totalOutstandingCents: 13000, invoiceCount: 3, overdueOutstandingCents: 2500, overdueInvoiceCount: 1 });
    expect(Object.values(summary.agingCents).reduce((total, cents) => total + cents, 0)).toBe(summary.totalOutstandingCents);
  });

  test('keeps a 73-invoice tab/report total stable while browser pages remain bounded', () => {
    const rows = Array.from({ length: 73 }, (_, index) => row({ id: `invoice-${index + 1}` }));
    expect(summarizeAccountsReceivable(rows).invoiceCount).toBe(73);
    expect(pageAccountsReceivableRows(rows, 1, 50)).toHaveLength(50);
    expect(pageAccountsReceivableRows(rows, 2, 50)).toHaveLength(23);
    expect(summarizeAccountsReceivable(rows).invoiceCount).toBe(73);
  });

  test('reports an empty customer result as zero', () => {
    expect(summarizeAccountsReceivable([])).toMatchObject({ totalOutstandingCents: 0, invoiceCount: 0, overdueOutstandingCents: 0, overdueInvoiceCount: 0 });
  });
});

describe('Accounts Receivable financial inclusion', () => {
  const approvedOutstanding = { accountingApproval: 'approved', invoiceWorkflowStatus: 'billed', remainingCents: 100, creditCents: 0, displayStatus: 'Unpaid' };

  test('includes approved unpaid and partially paid receivables without send or fulfillment gates', () => {
    expect(qualifiesForAccountsReceivable(approvedOutstanding)).toBe(true);
    expect(qualifiesForAccountsReceivable({ ...approvedOutstanding, displayStatus: 'Partially Paid' })).toBe(true);
  });

  test.each([
    [{ ...approvedOutstanding, accountingApproval: 'pending' }],
    [{ ...approvedOutstanding, accountingApproval: 'needs_reapproval' }],
    [{ ...approvedOutstanding, remainingCents: 0, displayStatus: 'Paid' }],
    [{ ...approvedOutstanding, creditCents: 100, displayStatus: 'Credit / Refund Due' }],
    [{ ...approvedOutstanding, invoiceWorkflowStatus: 'void' }],
    [{ ...approvedOutstanding, displayStatus: 'Paid Historical' }],
  ])('excludes a non-current outstanding record: %o', (input) => {
    expect(qualifiesForAccountsReceivable(input)).toBe(false);
  });
});
