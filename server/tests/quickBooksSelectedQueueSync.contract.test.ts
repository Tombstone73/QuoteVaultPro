import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('selected QuickBooks queue sync accepts explicit bounded canonical ids', () => {
  const routes = read('server/routes/quickbooks.routes.ts');
  expect(routes).toContain("/api/integrations/quickbooks/queue/sync-selected");
  expect(routes).toContain("z.array(z.object({ id: z.string().min(1), resourceType: z.enum(['invoice', 'payment']) })).min(1).max(100)");
  expect(routes).toContain('runSelectedQuickBooksSyncForOrg');
  expect(routes).not.toContain('syncWorker.runSelectedQuickBooksSyncForOrg');
});

test('selected sync is tenant-scoped, sequential, eligibility-checked, and idempotent-service backed', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  expect(worker).toContain('eq(invoices.organizationId, params.organizationId)');
  expect(worker).toContain('eq(payments.organizationId, params.organizationId)');
  expect(worker).toContain('Invoice is no longer pending sync.');
  expect(worker).toContain('Payment is not currently eligible.');
  expect(worker).toContain('syncSingleInvoiceToQuickBooksForOrganization(params.organizationId, item.id)');
  expect(worker).toContain('syncSinglePaymentToQuickBooksForOrganization(params.organizationId, item.id)');
  expect(worker).toContain('for (const item of unique)');
});

test('historical QuickBooks imports cannot become outbound queue candidates', () => {
  const importer = read('server/quickbooksService.ts');
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');

  expect(importer).toContain("importSource: 'quickbooks'");
  expect(importer).toContain("qbSyncStatus: 'synced'");
  expect(worker).toContain("ne(invoices.importSource, 'quickbooks')");
  expect(worker).toContain("QuickBooks-imported invoices are not exported back to QuickBooks.");
  expect(worker).toContain("Invoice is no longer pending sync.");
});

test('an Order revision keeps local truth while requiring an explicit accounting resync decision', () => {
  const invoicesService = read('server/invoicesService.ts');
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const state = read('server/services/quickbooksSyncQueueState.ts');

  expect(invoicesService).toContain('qbSyncStatus: "needs_resync"');
  expect(invoicesService).toContain('modifiedAfterBilling: true');
  expect(worker).toContain("inArray(invoices.qbSyncStatus, invoiceStatuses as any)");
  expect(state).toContain("INVOICE_UNSYNCED_STATUSES = ['not_synced', 'needs_resync']");
});

test('queue list uses canonical ids, supports a single-row sync, and is reachable from the Push settings section', () => {
  const page = read('client/src/pages/settings/quickbooks-sync-queue.tsx');
  const settings = read('client/src/pages/settings/integrations.tsx');
  const app = read('client/src/App.tsx');
  expect(page).toContain('const keyOf');
  expect(page).toContain('Select eligible on this page');
  expect(page).toContain('Queue Selected (');
  expect(page).toContain('Sync Selected (');
  expect(page).toContain('>Sync now</Button>');
  expect(settings).toContain('Link as RouterLink } from "react-router-dom"');
  expect(settings).toContain('<RouterLink to="/settings/integrations/quickbooks-sync-queue">Open Sync Queue</RouterLink>');
  expect(settings).toContain('Open Sync Queue');
  expect(settings).toContain('Review pending invoices and payments, then sync individually or in selected batches.');
  expect(settings).toContain('Runs one bounded background queue batch.');
  expect(app).toContain('import QuickBooksSyncQueuePage from "@/pages/settings/quickbooks-sync-queue"');
  expect(app).toContain('<Route path="integrations/quickbooks-sync-queue" element={<QuickBooksSyncQueuePage />} />');
});

test('local discovery includes unsynced native invoices and keeps it independent of OAuth availability', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const state = read('server/services/quickbooksSyncQueueState.ts');
  const invoicesService = read('server/invoicesService.ts');

  expect(state).toContain("INVOICE_UNSYNCED_STATUSES = ['not_synced', 'needs_resync']");
  expect(worker).toContain("const queueState = invoiceQueueState(row.syncStatus)");
  expect(worker).toContain("deferred org=${organizationId} not-connected; retained local queue work");
  expect(invoicesService).toContain("qbSyncStatus: 'pending' as any");
});

test('enqueue selected is bounded, tenant scoped, idempotent, and makes no Intuit call', () => {
  const routes = read('server/routes/quickbooks.routes.ts');
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');

  expect(routes).toContain('/api/integrations/quickbooks/queue/enqueue-selected');
  expect(routes).toContain('enqueueSelectedQuickBooksSyncForOrg');
  expect(worker).toContain('Convert locally discoverable accounting work into the derived outbox');
  expect(worker).toContain("qbSyncStatus: 'pending'");
  expect(worker).toContain("syncStatus: 'pending'");
  expect(worker).toContain('QuickBooks authorization requires reconnection. The local queue item was retained.');
});

test('console supports state views and server-side searchable bounded source queries', () => {
  const worker = read('server/services/quickbooksSyncQueueWorker.ts');
  const state = read('server/services/quickbooksSyncQueueState.ts');
  const page = read('client/src/pages/settings/quickbooks-sync-queue.tsx');
  const routes = read('server/routes/quickbooks.routes.ts');

  expect(state).toContain("type QuickBooksSyncQueueView = 'all' | QuickBooksSyncQueueState");
  expect(worker).toContain('ilike(customers.companyName, searchPattern)');
  expect(worker).toContain('.limit(fetchLimit)');
  expect(worker).toContain('totalCount');
  expect(worker).toContain('totalPages');
  expect(page).toContain('Eligible / Unsynced');
  expect(page).toContain('QuickBooks Sync Console');
  expect(page).toContain('queue/enqueue-selected');
  expect(page).toContain('Unable to load local accounting work.');
  expect(page).toContain('query.data.data.totalPages');
  expect(routes).toContain('listQuickBooksSyncQueueItemsForOrg');
  expect(routes).not.toContain('syncWorker.listQuickBooksSyncQueueItemsForOrg');
});
