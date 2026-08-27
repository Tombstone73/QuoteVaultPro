import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('selected QuickBooks queue sync accepts explicit bounded canonical ids', () => {
  const routes = read('server/routes/quickbooks.routes.ts');
  expect(routes).toContain("/api/integrations/quickbooks/queue/sync-selected");
  expect(routes).toContain("z.array(z.object({ id: z.string().min(1), resourceType: z.enum(['invoice', 'payment']) })).min(1).max(100)");
  expect(routes).toContain('runSelectedQuickBooksSyncForOrg');
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

test('queue list uses canonical ids and selection remains page-scoped by default', () => {
  const page = read('client/src/pages/settings/quickbooks-sync-queue.tsx');
  const settings = read('client/src/pages/settings/integrations.tsx');
  expect(page).toContain('const keyOf');
  expect(page).toContain('Select all eligible on this page');
  expect(page).toContain('Sync Selected (');
  expect(settings).toContain('Open Sync Queue');
});
