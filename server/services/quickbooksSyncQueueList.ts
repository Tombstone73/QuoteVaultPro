import type { QuickBooksSyncQueueView } from './quickbooksSyncQueueState';

export type QuickBooksSyncQueueSort = 'record' | 'customer' | 'type' | 'state' | 'eligibility' | 'amount' | 'updatedAt' | 'createdAt';
export type QuickBooksSyncQueueTypeFilter = 'all' | 'invoice' | 'payment';
export type QuickBooksSyncQueueEligibilityFilter = 'all' | 'queueable' | 'syncable' | 'blocked';
export type QuickBooksSyncQueueErrorFilter = 'all' | 'has_error' | 'no_error';

export type QuickBooksSyncQueueListFilters = {
  type?: QuickBooksSyncQueueTypeFilter;
  state?: QuickBooksSyncQueueView;
  eligibility?: QuickBooksSyncQueueEligibilityFilter;
  error?: QuickBooksSyncQueueErrorFilter;
  sortBy?: QuickBooksSyncQueueSort;
  sortDir?: 'asc' | 'desc';
};

export function normalizeQuickBooksSyncQueueListFilters(input: QuickBooksSyncQueueListFilters) {
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(String(value) as T) ? String(value) as T : fallback;
  return {
    type: oneOf(input.type, ['all', 'invoice', 'payment'] as const, 'all'),
    state: oneOf(input.state, ['all', 'unsynced', 'queued', 'failed', 'synced'] as const, 'all'),
    eligibility: oneOf(input.eligibility, ['all', 'queueable', 'syncable', 'blocked'] as const, 'all'),
    error: oneOf(input.error, ['all', 'has_error', 'no_error'] as const, 'all'),
    sortBy: oneOf(input.sortBy, ['record', 'customer', 'type', 'state', 'eligibility', 'amount', 'updatedAt', 'createdAt'] as const, 'updatedAt'),
    sortDir: oneOf(input.sortDir, ['asc', 'desc'] as const, 'desc'),
  };
}

export function getQuickBooksSyncQueueTotalPages(totalCount: number, pageSize: number) {
  if (totalCount <= 0) return 0;
  return Math.ceil(totalCount / Math.max(1, pageSize));
}
