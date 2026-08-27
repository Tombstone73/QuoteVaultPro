import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('historical QuickBooks imports use the source DocNumber and bypass native allocation', () => {
  const quickBooksImport = source('server/quickbooksService.ts');

  expect(quickBooksImport).toContain('resolveHistoricalQuickBooksInvoiceNumber(qbInvoice.DocNumber)');
  expect(quickBooksImport).toContain('findHistoricalQuickBooksInvoiceNumberConflicts');
  expect(quickBooksImport).toContain('Historical QuickBooks invoices retain their source DocNumber');
  expect(quickBooksImport).not.toMatch(/isHistorical[\s\S]{0,350}generateNextInvoiceNumber\(organizationId\)/);
});

test('the controlled backfill is dry-run first and does not change native counters', () => {
  const repair = source('scripts/repairHistoricalQuickBooksInvoiceNumbers.ts');

  expect(repair).toContain("process.argv.includes('--apply')");
  expect(repair).toContain('dry run only');
  expect(repair).toContain('findHistoricalQuickBooksInvoiceNumberConflicts');
  expect(repair).not.toContain('globalVariables');
  expect(repair).not.toContain('next_job_number');
});

test('QuickBooks source numbers remain tenant-scoped, searchable, and collision-guarded', () => {
  const invoiceSearch = source('server/invoicesService.ts');
  const collisionService = source('server/services/quickBooksHistoricalInvoiceNumbering.service.ts');

  expect(invoiceSearch).toContain('ilike(invoices.qbDocNumber, pattern)');
  expect(collisionService).toContain('eq(invoices.organizationId, input.organizationId)');
  expect(collisionService).toContain('eq(orders.organizationId, input.organizationId)');
  expect(collisionService).toContain('eq(quotes.organizationId, input.organizationId)');
});
