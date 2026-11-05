import { expect, test } from '@jest/globals';
import {
  getQuickBooksSyncQueueTotalPages,
  normalizeQuickBooksSyncQueueListFilters,
} from '../services/quickbooksSyncQueueList';

test('normalizes supported QuickBooks queue filters and sorting', () => {
  expect(normalizeQuickBooksSyncQueueListFilters({
    type: 'invoice',
    eligibility: 'syncable',
    error: 'has_error',
    sortBy: 'customer',
    sortDir: 'asc',
  })).toEqual({
    paymentMethod: 'all',
    type: 'invoice',
    eligibility: 'syncable',
    error: 'has_error',
    sortBy: 'customer',
    sortDir: 'asc',
  });
});

test('invalid sort and filter inputs fail closed to deterministic defaults', () => {
  expect(normalizeQuickBooksSyncQueueListFilters({
    type: 'vendor' as any,
    eligibility: 'anything' as any,
    error: 'maybe' as any,
    sortBy: 'drop table' as any,
    sortDir: 'sideways' as any,
    paymentMethod: 'processor-guessed' as any,
  })).toEqual({
    paymentMethod: 'all',
    type: 'all',
    eligibility: 'all',
    error: 'all',
    sortBy: 'updatedAt',
    sortDir: 'desc',
  });
});

test.each(['all', 'cash', 'check', 'credit_card', 'ach', 'other', 'unknown'] as const)('accepts the %s recorded-method filter', paymentMethod => {
  expect(normalizeQuickBooksSyncQueueListFilters({ paymentMethod }).paymentMethod).toBe(paymentMethod);
});

test.each([
  [234, 50, 5],
  [234, 25, 10],
  [234, 100, 3],
  [0, 50, 0],
])('calculates %i matching records at %i per page as %i pages', (total, pageSize, expected) => {
  expect(getQuickBooksSyncQueueTotalPages(total, pageSize)).toBe(expected);
});
