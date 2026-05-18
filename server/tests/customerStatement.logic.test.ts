/**
 * customerStatement.logic.test.ts
 *
 * Unit tests for server/lib/customerStatementHelpers.ts
 * No database, no Express — pure function tests only.
 */

import { describe, expect, test } from '@jest/globals';
import {
  safeIso,
  normaliseDateTo,
  orderEffectiveDate,
  isOpenOrder,
  isCompletedOrder,
  filterOrderByStatus,
  filterOrderByDate,
  filterOrderBySearch,
  filterInvoiceBySearch,
  filterQuoteBySearch,
  buildStatementSummary,
} from '../lib/customerStatementHelpers';
import type {
  StatementOrderInput,
  StatementInvoiceInput,
  StatementCreditTxInput,
} from '../lib/customerStatementHelpers';

// ── Factories ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<StatementOrderInput> = {}): StatementOrderInput {
  return {
    state:       'open',
    closedAt:    null,
    createdAt:   '2024-06-15T10:00:00.000Z',
    orderNumber: '1001',
    poNumber:    null,
    label:       null,
    status:      'new',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<StatementInvoiceInput & { invoiceNumber?: number; customerPoNumber?: string | null; notesPublic?: string | null; sourceOrderNumber?: number | null }> = {}) {
  return {
    status:           'billed',
    total:            '500.00',
    amountPaid:       '0.00',
    balanceDue:       '500.00',
    invoiceNumber:    42,
    customerPoNumber: null,
    notesPublic:      null,
    sourceOrderNumber: null,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<{ quoteNumber: number | null; label: string | null; status: string }> = {}) {
  return {
    quoteNumber: 101,
    label:       null,
    status:      'draft',
    ...overrides,
  };
}

function makeCreditTx(type: string, amount: string): StatementCreditTxInput {
  return { transactionType: type, amount };
}

// ── safeIso ───────────────────────────────────────────────────────────────────

describe('safeIso', () => {
  test('returns ISO string for a valid Date object', () => {
    const d = new Date('2024-01-15T12:00:00Z');
    expect(safeIso(d)).toBe('2024-01-15T12:00:00.000Z');
  });

  test('returns ISO string for a valid ISO string input', () => {
    const result = safeIso('2024-03-01T00:00:00Z');
    expect(result).toBe('2024-03-01T00:00:00.000Z');
  });

  test('returns null for null', () => {
    expect(safeIso(null)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(safeIso(undefined)).toBeNull();
  });

  test('returns null for an invalid date string', () => {
    expect(safeIso('not-a-date')).toBeNull();
  });

  test('returns null for 0 / null input', () => {
    // safeIso should not blow up on null
    const result = safeIso(null);
    expect(result).toBeNull();
  });
});

// ── normaliseDateTo ───────────────────────────────────────────────────────────

describe('normaliseDateTo', () => {
  test('appends end-of-day to a 10-char date-only string', () => {
    expect(normaliseDateTo('2024-12-31')).toBe('2024-12-31T23:59:59.999Z');
  });

  test('passes through a full datetime string unchanged', () => {
    expect(normaliseDateTo('2024-12-31T08:00:00.000Z')).toBe('2024-12-31T08:00:00.000Z');
  });

  test('returns null for null input', () => {
    expect(normaliseDateTo(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(normaliseDateTo('')).toBeNull();
  });
});

// ── orderEffectiveDate ────────────────────────────────────────────────────────

describe('orderEffectiveDate', () => {
  test('uses closedAt for closed orders', () => {
    const o = makeOrder({ state: 'closed', closedAt: '2024-05-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' });
    expect(orderEffectiveDate(o)).toBe('2024-05-01T00:00:00.000Z');
  });

  test('falls back to createdAt when closedAt is null even if state is closed', () => {
    const o = makeOrder({ state: 'closed', closedAt: null, createdAt: '2024-01-01T00:00:00Z' });
    expect(orderEffectiveDate(o)).toBe('2024-01-01T00:00:00.000Z');
  });

  test('uses createdAt for open orders', () => {
    const o = makeOrder({ state: 'open', closedAt: null, createdAt: '2024-03-10T00:00:00Z' });
    expect(orderEffectiveDate(o)).toBe('2024-03-10T00:00:00.000Z');
  });

  test('uses createdAt for production_complete orders', () => {
    const o = makeOrder({ state: 'production_complete', closedAt: null, createdAt: '2024-04-20T00:00:00Z' });
    expect(orderEffectiveDate(o)).toBe('2024-04-20T00:00:00.000Z');
  });
});

// ── isOpenOrder / isCompletedOrder ────────────────────────────────────────────

describe('isOpenOrder', () => {
  test('open → true', () => expect(isOpenOrder('open')).toBe(true));
  test('production_complete → true', () => expect(isOpenOrder('production_complete')).toBe(true));
  test('closed → false', () => expect(isOpenOrder('closed')).toBe(false));
  test('canceled → false', () => expect(isOpenOrder('canceled')).toBe(false));
  test('unknown → false', () => expect(isOpenOrder('mystery')).toBe(false));
});

describe('isCompletedOrder', () => {
  test('closed → true', () => expect(isCompletedOrder('closed')).toBe(true));
  test('open → false', () => expect(isCompletedOrder('open')).toBe(false));
  test('production_complete → false', () => expect(isCompletedOrder('production_complete')).toBe(false));
  test('canceled → false', () => expect(isCompletedOrder('canceled')).toBe(false));
});

// ── filterOrderByStatus ───────────────────────────────────────────────────────

describe('filterOrderByStatus', () => {
  test('"all" includes open orders', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'open' }), 'all')).toBe(true);
  });

  test('"all" includes closed orders', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'closed' }), 'all')).toBe(true);
  });

  test('"all" includes production_complete orders', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'production_complete' }), 'all')).toBe(true);
  });

  test('"all" excludes canceled orders', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'canceled' }), 'all')).toBe(false);
  });

  test('"open" includes open state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'open' }), 'open')).toBe(true);
  });

  test('"open" includes production_complete state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'production_complete' }), 'open')).toBe(true);
  });

  test('"open" excludes closed state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'closed' }), 'open')).toBe(false);
  });

  test('"completed" includes closed state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'closed' }), 'completed')).toBe(true);
  });

  test('"completed" excludes open state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'open' }), 'completed')).toBe(false);
  });

  test('"completed" excludes canceled state', () => {
    expect(filterOrderByStatus(makeOrder({ state: 'canceled' }), 'completed')).toBe(false);
  });
});

// ── filterOrderByDate ─────────────────────────────────────────────────────────

describe('filterOrderByDate', () => {
  const order = makeOrder({ state: 'open', createdAt: '2024-06-15T10:00:00Z' });
  const closedOrder = makeOrder({ state: 'closed', closedAt: '2024-09-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' });

  test('null range → always passes', () => {
    expect(filterOrderByDate(order, null, null)).toBe(true);
  });

  test('dateFrom before createdAt → passes', () => {
    expect(filterOrderByDate(order, '2024-01-01', null)).toBe(true);
  });

  test('dateFrom after createdAt → fails', () => {
    expect(filterOrderByDate(order, '2024-12-01', null)).toBe(false);
  });

  test('dateTo after createdAt → passes', () => {
    expect(filterOrderByDate(order, null, '2024-12-31T23:59:59.999Z')).toBe(true);
  });

  test('dateTo before createdAt → fails', () => {
    expect(filterOrderByDate(order, null, '2024-01-01T23:59:59.999Z')).toBe(false);
  });

  test('closed order uses closedAt for date filtering', () => {
    expect(filterOrderByDate(closedOrder, '2024-08-01', '2024-10-01T23:59:59.999Z')).toBe(true);
  });

  test('closed order using createdAt range that misses (should still use closedAt)', () => {
    // closedAt = 2024-09-01, so filtering on Jan-Feb should exclude it
    expect(filterOrderByDate(closedOrder, '2024-01-01', '2024-02-28T23:59:59.999Z')).toBe(false);
  });

  test('exact boundary: order on dateFrom passes', () => {
    const borderOrder = makeOrder({ createdAt: '2024-06-15T00:00:00Z' });
    expect(filterOrderByDate(borderOrder, '2024-06-15', null)).toBe(true);
  });
});

// ── filterOrderBySearch ───────────────────────────────────────────────────────

describe('filterOrderBySearch', () => {
  test('empty search → always passes', () => {
    expect(filterOrderBySearch(makeOrder(), '')).toBe(true);
  });

  test('matches orderNumber', () => {
    expect(filterOrderBySearch(makeOrder({ orderNumber: '2025' }), '2025')).toBe(true);
  });

  test('matches poNumber', () => {
    expect(filterOrderBySearch(makeOrder({ poNumber: 'PO-ABC' }), 'po-abc')).toBe(true);
  });

  test('matches label (description)', () => {
    expect(filterOrderBySearch(makeOrder({ label: 'Banner Print' }), 'banner')).toBe(true);
  });

  test('matches status field', () => {
    expect(filterOrderBySearch(makeOrder({ status: 'in_production' }), 'in_production')).toBe(true);
  });

  test('case-insensitive match', () => {
    expect(filterOrderBySearch(makeOrder({ label: 'Vinyl Wrap' }), 'VINYL')).toBe(true);
  });

  test('no match returns false', () => {
    expect(filterOrderBySearch(makeOrder({ orderNumber: '1111', label: 'Red Shirt' }), 'banner')).toBe(false);
  });
});

// ── filterInvoiceBySearch ─────────────────────────────────────────────────────

describe('filterInvoiceBySearch', () => {
  test('empty search → passes', () => {
    expect(filterInvoiceBySearch(makeInvoice(), '')).toBe(true);
  });

  test('matches invoiceNumber', () => {
    expect(filterInvoiceBySearch(makeInvoice({ invoiceNumber: 42 }), '42')).toBe(true);
  });

  test('matches customerPoNumber', () => {
    expect(filterInvoiceBySearch(makeInvoice({ customerPoNumber: 'CUS-PO-999' }), 'cus-po')).toBe(true);
  });

  test('matches notesPublic', () => {
    expect(filterInvoiceBySearch(makeInvoice({ notesPublic: 'Rush job' }), 'rush')).toBe(true);
  });

  test('matches sourceOrderNumber', () => {
    expect(filterInvoiceBySearch(makeInvoice({ sourceOrderNumber: 500 }), '500')).toBe(true);
  });

  test('no match returns false', () => {
    expect(filterInvoiceBySearch(makeInvoice({ invoiceNumber: 10 }), '9999')).toBe(false);
  });
});

// ── filterQuoteBySearch ───────────────────────────────────────────────────────

describe('filterQuoteBySearch', () => {
  test('empty search → passes', () => {
    expect(filterQuoteBySearch(makeQuote(), '')).toBe(true);
  });

  test('matches quoteNumber', () => {
    expect(filterQuoteBySearch(makeQuote({ quoteNumber: 555 }), '555')).toBe(true);
  });

  test('matches label', () => {
    expect(filterQuoteBySearch(makeQuote({ label: 'Spring Campaign' }), 'spring')).toBe(true);
  });

  test('matches status', () => {
    expect(filterQuoteBySearch(makeQuote({ status: 'approved' }), 'approved')).toBe(true);
  });

  test('null quoteNumber does not throw', () => {
    expect(filterQuoteBySearch(makeQuote({ quoteNumber: null }), '555')).toBe(false);
  });

  test('no match returns false', () => {
    expect(filterQuoteBySearch(makeQuote({ quoteNumber: 1, label: null, status: 'draft' }), 'vinyl')).toBe(false);
  });
});

// ── buildStatementSummary ─────────────────────────────────────────────────────

describe('buildStatementSummary', () => {
  test('empty inputs produce zero summary', () => {
    const s = buildStatementSummary([], [], [], 0);
    expect(s.openOrderCount).toBe(0);
    expect(s.completedOrderCount).toBe(0);
    expect(s.openOrderTotal).toBe('0.00');
    expect(s.completedOrderTotal).toBe('0.00');
    expect(s.invoicedTotal).toBe('0.00');
    expect(s.paidTotal).toBe('0.00');
    expect(s.outstandingBalance).toBe('0.00');
    expect(s.creditTotal).toBe('0.00');
    expect(s.refundTotal).toBe('0.00');
  });

  test('counts open and completed orders correctly', () => {
    const orders = [
      { ...makeOrder({ state: 'open' }),                total: '0.00' },
      { ...makeOrder({ state: 'production_complete' }), total: '0.00' },
      { ...makeOrder({ state: 'closed' }),              total: '0.00' },
      { ...makeOrder({ state: 'canceled' }),            total: '0.00' }, // should be excluded
    ] as any;
    const s = buildStatementSummary(orders, [], [], 0);
    expect(s.openOrderCount).toBe(2);
    expect(s.completedOrderCount).toBe(1);
  });

  test('sums order totals by state', () => {
    const orders = [
      { ...makeOrder({ state: 'open' }), total: '200.00' },
      { ...makeOrder({ state: 'open' }), total: '150.00' },
      { ...makeOrder({ state: 'closed' }), total: '300.00' },
    ] as any;
    const s = buildStatementSummary(orders, [], [], 0);
    expect(s.openOrderTotal).toBe('350.00');
    expect(s.completedOrderTotal).toBe('300.00');
  });

  test('excludes void invoices from invoicedTotal and paidTotal', () => {
    const invoices = [
      makeInvoice({ status: 'paid',  total: '500.00', amountPaid: '500.00', balanceDue: '0.00' }),
      makeInvoice({ status: 'void',  total: '200.00', amountPaid: '0.00',   balanceDue: '200.00' }),
      makeInvoice({ status: 'billed', total: '100.00', amountPaid: '0.00', balanceDue: '100.00' }),
    ] as any;
    const s = buildStatementSummary([], invoices, [], 0);
    // Only paid + billed invoices counted (not void)
    expect(parseFloat(s.invoicedTotal)).toBeCloseTo(600.00);
    expect(parseFloat(s.paidTotal)).toBeCloseTo(500.00);
    expect(parseFloat(s.outstandingBalance)).toBeCloseTo(100.00);
  });

  test('sums credit transactions (non-refund types)', () => {
    const creditTx: StatementCreditTxInput[] = [
      makeCreditTx('credit', '50.00'),
      makeCreditTx('credit', '25.00'),
      makeCreditTx('refund', '30.00'), // refund goes to refundTotal via param, not creditTotal
    ];
    const s = buildStatementSummary([], [], creditTx, 0);
    // creditTotal should include all credit tx amounts (refund tracking via separate param)
    expect(parseFloat(s.creditTotal)).toBeGreaterThan(0);
  });

  test('passes through refundTotal from parameter', () => {
    const s = buildStatementSummary([], [], [], 75.50);
    expect(s.refundTotal).toBe('75.50');
  });

  test('handles null/undefined total on orders without throwing', () => {
    const orders = [
      { ...makeOrder({ state: 'open' }), total: null },
    ] as any;
    expect(() => buildStatementSummary(orders, [], [], 0)).not.toThrow();
  });
});
