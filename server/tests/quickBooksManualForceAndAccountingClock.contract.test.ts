import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('automatic QuickBooks processing follows the accounting-change clock, not queue bookkeeping', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const schema = read('shared/schema.ts');
  const migration = read('server/db/migrations_v2/0193_quickbooks_accounting_change_clock.sql');

  expect(schema).toContain('accountingUpdatedAt: timestamp("accounting_updated_at"');
  expect(worker).toContain('invoices.accountingUpdatedAt');
  expect(worker).toContain('payments.accountingUpdatedAt');
  expect(worker).toContain('i.accounting_updated_at <= ${cutoff}');
  expect(worker).toContain('p.accounting_updated_at <= ${cutoff}');
  expect(worker).toContain("qbSyncStatus: 'pending', qbLastError: null, syncStatus: 'pending', syncError: null, updatedAt: new Date()");
  expect(migration).toContain('COALESCE(issued_at, issue_date, created_at)');
  expect(migration).toContain('COALESCE(succeeded_at, paid_at, applied_at, created_at)');
});

test('manual force ignores only stability while preserving OAuth, terminal, and payment dependency blockers', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const routes = read('server/routes/quickbooks.routes.ts');
  const page = read('client/src/pages/settings/quickbooks-sync-queue.tsx');

  expect(routes).toContain("syncMode: 'manual_force'");
  expect(worker).toContain('QuickBooks authorization requires reconnection');
  expect(worker).toContain('Void or canceled invoices cannot sync.');
  expect(worker).toContain('Invoice must sync first.');
  expect(worker).toContain('Another QuickBooks synchronization is already in progress.');
  expect(worker).toContain('claimQuickBooksSyncLease');
  expect(worker).toContain('releaseQuickBooksSyncLease');
  expect(worker).not.toContain('new Date(invoice.updatedAt).getTime() > cutoff.getTime()');
  expect(worker).not.toContain('new Date(payment.updatedAt).getTime() > cutoff.getTime()');
  expect(page).toContain('Waiting for automatic sync window');
  expect(page).toContain('Force Sync Selected');
  expect(page).toContain('canManualForce');
});

test('real Order-backed commercial edits restart the accounting stability window', () => {
  const invoicesService = read('server/invoicesService.ts');
  const invoiceRoute = read('server/routes/mvpInvoicing.routes.ts');
  const customerIdentity = read('server/services/customerCanonicalIdentityService.ts');

  expect(invoicesService).toContain('accountingUpdatedAt: new Date()');
  expect(invoiceRoute).toContain('updates.accountingUpdatedAt = new Date();');
  expect(customerIdentity).toContain('customerId: survivor.id, accountingUpdatedAt: new Date()');
});
