import {
  getQuickBooksSyncPageRange,
  getQuickBooksSyncPageSizeStorageKey,
  getQuickBooksSyncTotalPages,
  nextQuickBooksSyncSort,
  parseQuickBooksSyncPageSize,
  persistQuickBooksSyncPageSize,
  readQuickBooksSyncPageSize,
} from './quickBooksSyncConsole';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test('234 records paginate into stable 25, 50, and 100 row page counts and ranges', () => {
  expect(getQuickBooksSyncTotalPages(234, 50)).toBe(5);
  expect(getQuickBooksSyncPageRange(1, 50, 234)).toEqual({ start: 1, end: 50 });
  expect(getQuickBooksSyncPageRange(2, 50, 234)).toEqual({ start: 51, end: 100 });
  expect(getQuickBooksSyncPageRange(5, 50, 234)).toEqual({ start: 201, end: 234 });
  expect(getQuickBooksSyncTotalPages(234, 25)).toBe(10);
  expect(getQuickBooksSyncTotalPages(234, 100)).toBe(3);
});

test('page size accepts only the canonical options', () => {
  expect(parseQuickBooksSyncPageSize('25')).toBe(25);
  expect(parseQuickBooksSyncPageSize('50')).toBe(50);
  expect(parseQuickBooksSyncPageSize('100')).toBe(100);
  expect(parseQuickBooksSyncPageSize('234')).toBe(25);
});

test('page-size preference is persisted per organization and user', () => {
  const storage = createStorage();
  const key = getQuickBooksSyncPageSizeStorageKey('user-1', 'org-1');
  expect(key).toBe('titanos:quickbooks:sync-console-page-size:v1:org_org-1:user_user-1');
  persistQuickBooksSyncPageSize(50, key, storage);
  expect(readQuickBooksSyncPageSize(key, storage)).toBe(50);
  expect(readQuickBooksSyncPageSize(getQuickBooksSyncPageSizeStorageKey('user-1', 'org-2'), storage)).toBe(25);
});

test('sorting toggles direction and new date sorts default descending', () => {
  expect(nextQuickBooksSyncSort('record', 'asc', 'record')).toEqual({ sortBy: 'record', sortDir: 'desc' });
  expect(nextQuickBooksSyncSort('record', 'desc', 'customer')).toEqual({ sortBy: 'customer', sortDir: 'asc' });
  expect(nextQuickBooksSyncSort('record', 'asc', 'updatedAt')).toEqual({ sortBy: 'updatedAt', sortDir: 'desc' });
});
