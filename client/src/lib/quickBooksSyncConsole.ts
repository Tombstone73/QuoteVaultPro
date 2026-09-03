export const QUICKBOOKS_SYNC_PAGE_SIZES = [25, 50, 100] as const;

export type QuickBooksSyncPageSize = typeof QUICKBOOKS_SYNC_PAGE_SIZES[number];
export type QuickBooksSyncSortDirection = 'asc' | 'desc';
export type QuickBooksSyncSort =
  | 'record'
  | 'customer'
  | 'type'
  | 'state'
  | 'eligibility'
  | 'amount'
  | 'updatedAt';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function getQuickBooksSyncPageSizeStorageKey(userId: string | number, organizationId: string) {
  return `titanos:quickbooks:sync-console-page-size:v1:org_${organizationId}:user_${userId}`;
}

export function parseQuickBooksSyncPageSize(value: unknown): QuickBooksSyncPageSize {
  const parsed = Number(value);
  return QUICKBOOKS_SYNC_PAGE_SIZES.includes(parsed as QuickBooksSyncPageSize)
    ? parsed as QuickBooksSyncPageSize
    : 25;
}

export function readQuickBooksSyncPageSize(storageKey: string, storage: StorageLike = window.localStorage) {
  return parseQuickBooksSyncPageSize(storage.getItem(storageKey));
}

export function persistQuickBooksSyncPageSize(pageSize: QuickBooksSyncPageSize, storageKey: string, storage: StorageLike = window.localStorage) {
  storage.setItem(storageKey, String(pageSize));
}

export function getQuickBooksSyncTotalPages(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) return 0;
  return Math.ceil(totalCount / Math.max(1, pageSize));
}

export function getQuickBooksSyncPageRange(page: number, pageSize: number, totalCount: number) {
  if (totalCount <= 0) return { start: 0, end: 0 };
  const safePage = Math.max(1, page);
  return {
    start: (safePage - 1) * pageSize + 1,
    end: Math.min(safePage * pageSize, totalCount),
  };
}

export function nextQuickBooksSyncSort(
  currentSort: QuickBooksSyncSort,
  currentDirection: QuickBooksSyncSortDirection,
  requestedSort: QuickBooksSyncSort,
): { sortBy: QuickBooksSyncSort; sortDir: QuickBooksSyncSortDirection } {
  if (currentSort === requestedSort) {
    return { sortBy: requestedSort, sortDir: currentDirection === 'asc' ? 'desc' : 'asc' };
  }
  return {
    sortBy: requestedSort,
    sortDir: requestedSort === 'updatedAt' ? 'desc' : 'asc',
  };
}
