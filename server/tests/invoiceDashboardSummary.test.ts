import { describe, expect, test } from '@jest/globals';
import { normalizeInvoiceDashboardSummaryAggregates } from '../lib/invoiceDashboardSummary';

describe('invoice dashboard aggregate normalization', () => {
  test('reads the first row from Drizzle aggregate result arrays instead of normalizing the array object to zero', () => {
    expect(normalizeInvoiceDashboardSummaryAggregates(
      [{ totalInvoices: '178', totalOutstandingCents: '123456', overdueCount: '12' }],
      [{ paidThisMonthCents: '7890' }],
    )).toEqual({
      totalInvoices: 178,
      totalOutstandingCents: 123456,
      overdueCount: 12,
      paidThisMonthCents: 7890,
    });
  });

  test('fails closed only when the aggregate result contains no row', () => {
    expect(normalizeInvoiceDashboardSummaryAggregates([], [])).toEqual({
      totalInvoices: 0,
      totalOutstandingCents: 0,
      overdueCount: 0,
      paidThisMonthCents: 0,
    });
  });
});
