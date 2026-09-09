import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('accounting approval is persisted, audited, and version-specific', () => {
  const schema = read('shared/schema.ts');
  const service = read('server/services/invoiceAccountingApproval.service.ts');
  const invoicesService = read('server/invoicesService.ts');
  const migration = read('server/db/migrations_v2/0195_invoice_accounting_approval.sql');
  expect(schema).toContain('accountingApprovedVersion: integer("accounting_approved_version")');
  expect(schema).toContain('accountingApprovalRevokedAt: timestamp("accounting_approval_revoked_at"');
  expect(service).toContain("actionType: 'invoice_accounting_approved'");
  expect(invoicesService).toContain("actionType: 'invoice_accounting_approval_revoked'");
  expect(migration).toContain('accounting_approved_by_user_id');
});

test('QuickBooks, Force Sync, and payments retain the canonical accounting approval gate', () => {
  const qbService = read('server/quickbooksService.ts');
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const routes = read('server/routes/mvpInvoicing.routes.ts');
  expect(qbService).toContain('Approve invoice for accounting before syncing.');
  expect(qbService).toContain('getInvoiceQuickBooksApprovalEligibility');
  expect(qbService).toContain('Approve the invoice for accounting before syncing its payment.');
  expect(worker).toContain('getInvoiceQuickBooksApprovalEligibility');
  expect(worker).toContain("if (!isInvoiceApprovedForAccounting(payment as any))");
  expect(routes).toContain('/api/invoices/:id/approve-for-accounting');
  expect(routes).toContain('/api/invoices/accounting-approval/bulk');
});

test('unapproved invoices never have visible or executable QuickBooks queue work', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const invoicesService = read('server/invoicesService.ts');
  const approval = read('server/lib/invoiceAccountingApproval.ts');
  const approvalService = read('server/services/invoiceAccountingApproval.service.ts');
  const quickBooksPreferences = read('shared/quickBooksPreferences.ts');
  const invoiceDetail = read('client/src/pages/invoice-detail.tsx');

  expect(invoicesService).toContain("qbSyncStatus: 'not_synced' as any");
  expect(approval).toContain("code: 'INVOICE_NOT_APPROVED'");
  expect(worker).toContain('dequeueUnapprovedInitialInvoiceSyncs');
  expect(worker).toContain("actionType: 'quickbooks_invoice_queue_dequeued_unapproved'");
  expect(worker).toContain("eq(invoices.qbSyncStatus, 'pending')");
  expect(worker).toContain("qbSyncStatus: 'not_synced'");
  expect(worker).toContain("i.qb_sync_status = 'synced'");
  expect(worker).toContain('i.accounting_approved_at is not null');
  expect(worker).toContain("p.external_accounting_id is not null");
  expect(invoiceDetail).toContain("qbSyncStatusRaw === 'pending' && accountingApprovalState === 'approved'");
  expect(approvalService).toContain('autoQueueApprovedInvoices');
  expect(quickBooksPreferences).toContain('autoQueueApprovedInvoices: true');
});

test('invoice UI exposes approval list/detail controls and server-side filter', () => {
  const list = read('client/src/pages/invoices.tsx');
  const detail = read('client/src/pages/invoice-detail.tsx');
  const invoiceService = read('server/invoicesService.ts');
  expect(list).toContain('Approve Selected');
  expect(list).toContain('handleApproveInvoice');
  expect(list).toContain("await approveInvoices.mutateAsync([invoice.id])");
  expect(list).toContain('>Approved</TitanTableHead>');
  expect(list).toContain('All accounting approvals');
  expect(detail).toContain('Accounting Approval');
  expect(detail).toContain('Approved for Accounting');
  expect(invoiceService).toContain("columnFilters.accountingApproval === 'approved'");
});
