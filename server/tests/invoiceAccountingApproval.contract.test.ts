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

test('QuickBooks, Force Sync, and payments retain the accounting approval gate', () => {
  const qbService = read('server/quickbooksService.ts');
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const routes = read('server/routes/mvpInvoicing.routes.ts');
  expect(qbService).toContain('Approve invoice for accounting before syncing.');
  expect(qbService).toContain('Approve the invoice for accounting before syncing its payment.');
  expect(worker).toContain('Awaiting accounting approval.');
  expect(worker).toContain("if (!isInvoiceApprovedForAccounting(invoice as any))");
  expect(worker).toContain("if (!isInvoiceApprovedForAccounting(payment as any))");
  expect(routes).toContain('/api/invoices/:id/approve-for-accounting');
  expect(routes).toContain('/api/invoices/accounting-approval/bulk');
});

test('invoice UI exposes approval list/detail controls and server-side filter', () => {
  const list = read('client/src/pages/invoices.tsx');
  const detail = read('client/src/pages/invoice-detail.tsx');
  const invoiceService = read('server/invoicesService.ts');
  expect(list).toContain('Approve Selected');
  expect(list).toContain('All accounting approvals');
  expect(detail).toContain('Accounting Approval');
  expect(detail).toContain('Approved for Accounting');
  expect(invoiceService).toContain("columnFilters.accountingApproval === 'approved'");
});
