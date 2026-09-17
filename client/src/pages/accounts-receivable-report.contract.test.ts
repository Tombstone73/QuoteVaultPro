import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const page = fs.readFileSync(path.join(process.cwd(), 'client/src/pages/accounts-receivable-report.tsx'), 'utf8');

test('A/R report uses the full application content width and a local horizontal scroll container', () => {
  expect(page).toContain('w-full max-w-none px-4 py-4 sm:px-6 lg:px-8');
  expect(page).toContain('data-testid="accounts-receivable-table-scroll"');
  expect(page).toContain('w-full overflow-x-auto rounded-lg border');
  expect(page).toContain('min-w-full table-fixed');
});

test('A/R report renders saved visible columns with resizing, canonical sorting, and unchanged full exports', () => {
  expect(page).toContain('columns.filter((column) => column.enabled)');
  expect(page).toContain('cursor-col-resize');
  expect(page).toContain('setPage(1)');
  expect(page).toContain('getArReportPreferenceStorageKey');
  expect(page).toContain('accounts-receivable/export/${format}?${query(filters, sortBy, sortDir, 1)}');
  expect(page).toContain('<ColumnConfigModal');
  expect(page).toContain('ROUTES.customers.detail');
  expect(page).toContain('ROUTES.invoices.detail');
  expect(page).toContain('ROUTES.orders.detail');
});
