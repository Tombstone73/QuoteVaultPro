import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { computeInvoicePaymentRollup } from '../../shared/rollups/invoicePaymentRollup';
import { isFinancialPaymentHistory } from '../../shared/financialPaymentHistory';

let tables: Record<string, any[]>;
const rollup = jest.fn<any>();
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function matches(row: any, condition: any) {
  if (!condition) return true;
  const { sql, params } = new PgDialect().sqlToQuery(condition);
  for (const m of sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)) {
    if (row[camel(m[1])] !== params[Number(m[2]) - 1]) return false;
  }
  for (const m of sql.matchAll(/"\w+"\."(\w+)" in \(([^)]+)\)/g)) {
    const allowed = [...m[2].matchAll(/\$(\d+)/g)].map(n => params[Number(n[1]) - 1]);
    if (!allowed.includes(row[camel(m[1])])) return false;
  }
  return true;
}
const db: any = {
  execute: async () => ({}),
  transaction: async (fn: any) => { const before = structuredClone(tables); try { return await fn(db); } catch (e) { tables = before; throw e; } },
  select: () => {
    let name: string, predicate: any;
    const result = () => (tables[name] || []).filter(row => matches(row, predicate));
    const q: any = { from: (t: any) => { name = getTableName(t); return q; }, where: (p: any) => { predicate = p; return q; },
      orderBy: () => q, limit: async (n: number) => result().slice(0, n), then: (ok: any, bad: any) => Promise.resolve(result()).then(ok, bad) };
    return q;
  },
  insert: (t: any) => ({ values: (value: any) => {
    const name = getTableName(t); let conflict = false, ran = false; let inserted: any[] = [];
    const run = () => {
      if (ran) return inserted; ran = true;
      const rows = tables[name] ||= [];
      if (conflict && rows.some(row => row.eventId === value.eventId)) return [];
      inserted = [{ id: `${name}-${rows.length}`, ...value }]; rows.push(...inserted); return inserted;
    };
    const q: any = { onConflictDoNothing: () => { conflict = true; return q; }, returning: async () => run(), then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad) };
    return q;
  } }),
  update: (t: any) => ({ set: (value: any) => ({ where: (p: any) => {
    const rows = (tables[getTableName(t)] || []).filter(row => matches(row, p));
    rows.forEach(row => Object.assign(row, value));
    return { returning: async () => rows, then: (ok: any, bad: any) => Promise.resolve(rows).then(ok, bad) };
  } }) }),
};
jest.unstable_mockModule('../db', () => ({ db }));
jest.unstable_mockModule('../invoicesService', () => ({ reconcileInvoicePaymentStateInTransaction: rollup }));
jest.unstable_mockModule('../services/stripeCustomerPaymentBatchFinalization.service', () => ({ finalizeStripeCustomerPaymentBatch: jest.fn() }));
const { captureAndApply } = await import('../services/stripePaymentReconciliationService');
const observation = (eventId: string, type = 'payment_intent.succeeded') => ({ eventId, type, organizationId: 'org', invoiceId: 'invoice', paymentIntentId: 'pi',
  paymentAttemptId: 'attempt', stripeAccountId: 'acct', amountCents: 12500, currency: 'usd', occurredAt: new Date('2026-10-01T12:00:00Z') });
beforeEach(() => {
  tables = { payments: [], payment_webhook_events: [], invoices: [{ id: 'invoice', organizationId: 'org', orderId: null }], integration_connections: [{ provider: 'stripe', externalAccountId: 'acct', organizationId: 'org' }],
    stripe_payment_attempts: [{ id: 'attempt', organizationId: 'org', invoiceId: 'invoice', stripePaymentIntentId: 'pi', stripeAccountId: 'acct', status: 'pending', amountCents: 12500, currency: 'USD', channel: 'portal', metadata: { customerId: 'customer' }, createdByUserId: 'user' }] };
  rollup.mockReset().mockResolvedValue({ updated: { id: 'invoice' } });
});
test.each(['payment_intent.payment_failed', 'payment_intent.canceled', 'payment_intent.created'])('%s never inserts financial history or recalculates the invoice', async type => {
  await captureAndApply({ ...observation(type, type), amountCents: 0 });
  expect(tables.payments).toEqual([]); expect(rollup).not.toHaveBeenCalled();
  expect(tables.stripe_payment_attempts[0].status).toBe(type.endsWith('payment_failed') ? 'failed' : type.endsWith('canceled') ? 'canceled' : 'pending');
});
test('signed success and browser confirmation materialize one effect and roll up exactly once', async () => {
  await captureAndApply(observation('webhook'));
  await captureAndApply(observation('webhook'));
  await captureAndApply(observation('browser'));
  expect(tables.payments).toHaveLength(1); expect(rollup).toHaveBeenCalledTimes(1);
  expect(tables.payments[0]).toMatchObject({ status: 'succeeded', syncStatus: 'pending', amountCents: 12500, stripePaymentIntentId: 'pi', createdByUserId: 'user',
    paidAt: new Date('2026-10-01T12:00:00Z'), succeededAt: new Date('2026-10-01T12:00:00Z'), metadata: { stripePaymentAttemptId: 'attempt', customerId: 'customer' } });
  expect(tables.stripe_payment_attempts[0].paymentId).toBe(tables.payments[0].id);
});
test('late failed/canceled delivery cannot undo collected money or its succeeded attempt', async () => {
  await captureAndApply(observation('success'));
  await captureAndApply({ ...observation('failure', 'payment_intent.payment_failed'), amountCents: 0 });
  await captureAndApply({ ...observation('cancel', 'payment_intent.canceled'), amountCents: 0 });
  expect(tables.payments[0].status).toBe('succeeded'); expect(tables.stripe_payment_attempts[0].status).toBe('succeeded'); expect(rollup).toHaveBeenCalledTimes(1);
});
test.each([{ stripeAccountId: 'wrong' }, { invoiceId: 'wrong' }, { amountCents: 12499 }, { currency: 'EUR' }])('conflicting success fails closed: %p', async change => {
  await expect(captureAndApply({ ...observation('conflict'), ...change })).rejects.toThrow();
  expect(tables.payments).toEqual([]); expect(rollup).not.toHaveBeenCalled();
});
test('decline without a financial row can subsequently settle the same intent', async () => {
  await captureAndApply({ ...observation('decline', 'payment_intent.payment_failed'), amountCents: 0 });
  await captureAndApply(observation('success'));
  expect(tables.payments).toHaveLength(1); expect(tables.stripe_payment_attempts[0].status).toBe('succeeded');
});
test('successful partial refund stays immutable, capped, and idempotent', async () => {
  await captureAndApply(observation('success'));
  const refund = { ...observation('refund', 'refund.updated'), refundId: 're_1', refundStatus: 'succeeded', refundAmountCents: 2500 };
  await captureAndApply(refund); await captureAndApply({ ...refund, eventId: 'refund-repeat' });
  expect(tables.payments.map(p => [p.status, p.amountCents])).toEqual([['succeeded', 12500], ['refunded', 2500]]);
  expect(rollup).toHaveBeenCalledTimes(2);
  expect(computeInvoicePaymentRollup({ invoiceTotalCents: 12500, payments: tables.payments }).amountPaidCents).toBe(10000);
});
test('payment history excludes unfunded Stripe artifacts but preserves financial evidence', () => {
  for (const status of ['pending', 'failed', 'canceled']) expect(isFinancialPaymentHistory({ provider: 'stripe', status })).toBe(false);
  for (const status of ['succeeded', 'captured', 'refunded']) expect(isFinancialPaymentHistory({ provider: 'stripe', status })).toBe(true);
  expect(isFinancialPaymentHistory({ provider: 'stripe', status: 'pending', externalAccountingId: 'qb' })).toBe(true);
});

test('legacy failed artifact becomes QB eligible only after verified success', async () => {
  tables.payments.push({ id: 'legacy', organizationId: 'org', invoiceId: 'invoice', provider: 'stripe', status: 'failed', syncStatus: 'skipped', stripePaymentIntentId: 'pi', amountCents: 12500, currency: 'USD', metadata: { stripeAccountId: 'acct' } });
  await captureAndApply(observation('settle-legacy'));
  expect(tables.payments).toHaveLength(1);
  expect(tables.payments[0]).toMatchObject({ status: 'succeeded', syncStatus: 'pending' });
  expect(rollup).toHaveBeenCalledTimes(1);
});
