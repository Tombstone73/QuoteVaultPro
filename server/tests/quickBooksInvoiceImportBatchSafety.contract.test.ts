import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('invoice preview is scope-filtered and bounded before it reaches the browser', () => {
  const service = read('server/quickbooksService.ts');
  const routes = read('server/routes/quickbooks.routes.ts');

  expect(routes).toContain("scope must be one of: open_ar, historical, all_unsynced");
  expect(routes).toContain("pageSize must be one of: 50, 100, 200");
  expect(routes).toContain('fetchQBInvoicePreviewPage');
  expect(service).toContain("WHERE Balance > '0'");
  expect(service).toContain("WHERE Balance <= '0'");
  expect(service).toContain('STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}');
  expect(service).toContain('const rows = allRows.filter((row) => !row.alreadyImported);');
  expect(service).not.toContain('fetchQBInvoicesForPreview');
});

test('preview selection starts empty and all selection/import actions are page-bounded', () => {
  const page = read('client/src/pages/settings/integrations.tsx');

  expect(page).toContain("const [invoicePreviewScope, setInvoicePreviewScope] = useState<QBInvoicePreviewScope>('open_ar')");
  expect(page).toContain('setSelectedQBIds(new Set());');
  expect(page).not.toContain('Auto-select all importable');
  expect(page).toContain('Select eligible on this page');
  expect(page).toContain('Import Selected ({selectedQBIds.size})');
  expect(page).toContain('Import this batch');
  expect(page).toContain("new Set(invoicePreview.filter(r => r.canImport && !r.alreadyImported).map(r => r.qbInvoiceId))");
});

test('the import endpoint accepts no more than 100 explicit QuickBooks IDs', () => {
  const routes = read('server/routes/quickbooks.routes.ts');

  expect(routes).toContain('invoicesArray.length > 100');
  expect(routes).toContain('rawIds.length > 100');
  expect(routes).toContain('uniqueIds.length > 100');
  expect(routes).toContain('importQBInvoicesByIds(organizationId, uniqueIds');
});

test('canonical source IDs, historical numbering, and financial snapshots remain on the existing importer path', () => {
  const service = read('server/quickbooksService.ts');

  expect(service).toContain('eq(invoices.qbInvoiceId, qbInvoice.Id)');
  expect(service).toContain('eq(invoices.externalAccountingId, qbInvoice.Id)');
  expect(service).toContain('resolveHistoricalQuickBooksInvoiceNumber(qbInvoice.DocNumber)');
  expect(service).toContain('generateNextInvoiceNumber(organizationId)');
  expect(service).toContain('qbImportBalanceDue: balance.toFixed(2)');
});
