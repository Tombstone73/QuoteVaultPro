import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'client/src/pages/settings/quickbooks-sync-queue.tsx'), 'utf8');

test('top and bottom pagination controls share the same canonical state', () => {
  expect(source).toContain("renderPagination('top')");
  expect(source).toContain("renderPagination('bottom')");
  expect(source).toContain('Page {page} of {displayedPageCount}');
  expect(source).toContain('setPageSize(parseQuickBooksSyncPageSize(value)); setPage(1);');
});

test('search, tab, detailed filters, and sorting reset page one', () => {
  expect(source).toContain('setSearch(event.target.value); setPage(1);');
  expect(source).toContain('const changeView = (next: QueueView) => { setView(next); setPage(1); };');
  expect(source).toContain("setTypeFilter(value); setPage(1);");
  expect(source).toContain("setEligibilityFilter(value); setPage(1);");
  expect(source).toContain("setErrorFilter(value); setPage(1);");
  expect(source).toContain('setSortDir(next.sortDir);');
  expect(source).toContain('setPage(1);');
});

test('selection remains explicit and is not mutated by paging or filtering', () => {
  expect(source).toContain('const [selected, setSelected] = useState<Map<string, QueueItem>>(new Map());');
  expect(source).toContain('for (const item of items.filter((item) => item.eligible))');
  expect(source).toContain('const changeView = (next: QueueView) => { setView(next); setPage(1); };');
  expect(source).toContain('Queue Selected ({selectedQueueable.length})');
  expect(source).toContain('Force Sync Selected ({selectedForceable.length})');
});

test('server query receives all canonical sort, filter, search, and page state', () => {
  expect(source).toContain('new URLSearchParams({ page: String(page), pageSize: String(pageSize), view, search, type: typeFilter, eligibility: eligibilityFilter, error: errorFilter, sortBy, sortDir })');
});
