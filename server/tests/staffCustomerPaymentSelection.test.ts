import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

let rows: Record<string, any[]>;
let failPaymentNumber = 0;
let paymentInserts = 0;
let locks: string[];
const dialect = new PgDialect();
function matches(row: any, condition: any, table: string) {
  if (!condition) return true;
  const { sql, params } = dialect.sqlToQuery(condition);
  const name = (column: string) => column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const match of sql.matchAll(/"([^"]+)"\."([^"]+)" = \$(\d+)/g)) {
    if (match[1] === table && row[name(match[2])] !== params[Number(match[3]) - 1]) return false;
  }
  for (const match of sql.matchAll(/"([^"]+)"\."([^"]+)" in \(([^)]+)\)/g)) {
    const values = [...match[3].matchAll(/\$(\d+)/g)].map(x => params[Number(x[1]) - 1]);
    if (match[1] === table && !values.includes(row[name(match[2])])) return false;
  }
  return true;
}
const query = (projection?: any) => {
  let table = ''; let condition: any; let joined = false;
  const result = () => (rows[table] || []).filter(row => matches(row, condition, table)).map(row => joined
    ? { invoice: structuredClone(row), order: structuredClone(rows.orders.find(order => order.id === row.orderId && order.organizationId === row.organizationId) ?? null) }
    : structuredClone(row));
  const q: any = { from: (t: any) => { table = getTableName(t); return q; }, leftJoin: () => { joined = true; return q; },
    where: (c: any) => { condition = c; return q; }, orderBy: () => q, for: () => q,
    limit: async (n: number) => result().slice(0, n), then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject) };
  return q;
};
const tx: any = {
  select: query,
  execute: async (statement: any) => { const parsed = dialect.sqlToQuery(statement); locks.push(...parsed.params.map(String)); return { rows: [] }; },
  insert: (table: any) => ({ values: (value: any) => {
    const name = getTableName(table);
    const run = async () => {
      if (name === 'payments' && ++paymentInserts === failPaymentNumber) throw new Error('simulated allocation failure');
      const row = { id: `${name}-${rows[name].length + 1}`, ...structuredClone(value) }; rows[name].push(row); return [structuredClone(row)];
    };
    return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
  } }),
  update: (table: any) => ({ set: (patch: any) => ({ where: (condition: any) => {
    const run = async () => { const name = getTableName(table); const touched = rows[name].filter(row => matches(row, condition, name)); touched.forEach(row => Object.assign(row, structuredClone(patch))); return touched; };
    return { returning: run, then: (resolve: any, reject: any) => run().then(resolve, reject) };
  } }) }),
};
const db = { transaction: async (fn: any) => { const before = structuredClone(rows); try { return await fn(tx); } catch (error) { rows = before; throw error; } } };
jest.unstable_mockModule('../db', () => ({ db }));
jest.unstable_mockModule('../lib/stripe', () => ({ getStripeClient: jest.fn() }));
jest.unstable_mockModule('../services/workflowStatusPillService', () => ({ applyWorkflowStatusPillFailSoft: jest.fn() }));
jest.unstable_mockModule('../services/orderAutoCloseService', () => ({ reconcileOrderAutoCloseFailSoft: jest.fn() }));
let preview: typeof import('../services/billing/customerPaymentOperations').previewCustomerPayment;
let record: typeof import('../services/billing/customerPaymentOperations').recordCustomerPayment;
beforeAll(async () => { const service = await import('../services/billing/customerPaymentOperations'); preview = service.previewCustomerPayment; record = service.recordCustomerPayment; });
beforeEach(() => {
  paymentInserts = 0; failPaymentNumber = 0; locks = [];
  rows = { invoices: ['a','b','c','d','e'].map((id, index) => ({ id, organizationId: 'org', customerId: 'customer', contactId: null,
    invoiceNumber: id.toUpperCase(), totalCents: [5000,10000,6000,25000,7500][index], status: ['paid','billed','paid','billed','billed'][index],
    dueDate: `2026-01-0${index + 1}`, issueDate: '2025-12-01', currency: 'USD' })),
    payments: [{ id: 'old-a', organizationId: 'org', invoiceId: 'a', amountCents: 5000, status: 'succeeded' }, { id: 'old-c', organizationId: 'org', invoiceId: 'c', amountCents: 6000, status: 'succeeded' }],
    orders: [], customer_payment_batches: [], audit_logs: [] };
});
const input = (overrides: any = {}) => ({ staffSelection: true, organizationId: 'org', actorUserId: 'staff', invoiceIds: ['e','c','d','b','a'], amountCents: 30000,
  allocationMode: 'oldest_first' as const, method: 'check', appliedAt: new Date('2026-09-28'), idempotencyKey: 'request-1', expectedCustomerId: 'customer', ...overrides });

describe('staff selected versus payable customer payment (mocked transaction)', () => {
  test('paid and stale-status zero balances are excluded using ledger truth, preserving canonical oldest-first order', async () => {
    rows.invoices[0].status = 'billed';
    const result = await preview(input());
    expect(result).toMatchObject({ selectedCount: 5, eligibleCount: 3, excludedCount: 2, totalOutstandingCents: 42500,
      allocations: [{ invoiceId: 'b', amountCents: 10000 }, { invoiceId: 'd', amountCents: 20000 }] });
    expect(rows.customer_payment_batches).toHaveLength(0);
  });
  test('partial payment uses canonical child rows, leaves later and excluded invoices unchanged', async () => {
    const before = structuredClone(rows.invoices);
    const result = await record(input());
    expect(result.payments.map((p: any) => [p.invoiceId,p.amountCents])).toEqual([['b',10000],['d',20000]]);
    expect(rows.invoices[1]).toMatchObject({ status: 'paid', amountPaid: '100.00', balanceDue: '0.00' });
    expect(rows.invoices[3]).toMatchObject({ status: 'partially_paid', amountPaid: '200.00', balanceDue: '50.00' });
    for (const index of [0,2,4]) expect(rows.invoices[index]).toEqual(before[index]);
    for (const payment of result.payments) expect(payment).toMatchObject({ customerPaymentBatchId: result.batch.id, providerIdempotencyKey: `customer-batch:${result.batch.id}:invoice:${payment.invoiceId}`, provider: 'manual', status: 'succeeded', syncStatus: 'skipped', metadata: { source: 'customer_payment_batch' } });
    expect(result.batch.amountCents).toBe(30000);
    expect(locks).toEqual(expect.arrayContaining(['invoice-payment-context:org:b','payment:org:b','invoice-rollup:b','customer-payment-key:org:request-1']));
  });
  test('overpayment records only eligible balances and reports change, without artificial credits', async () => {
    const result = await record(input({ amountCents: 50000 }));
    expect(result).toMatchObject({ appliedAmountCents: 42500, changeDueCents: 7500, batch: { amountCents: 42500 } });
    expect(result.payments.map((p: any) => p.amountCents)).toEqual([10000,25000,7500]);
    expect(rows.audit_logs[0].newValues).toMatchObject({ tenderedAmountCents: 50000, amountCents: 42500, changeDueCents: 7500 });
  });
  test('all paid gives a useful preview and a no-write posting result', async () => {
    expect(await preview(input({ invoiceIds: ['a','c'] }))).toMatchObject({ eligibleCount: 0, excludedCount: 2, allocations: [], message: 'No selected invoices have an open balance.' });
    await expect(record(input({ invoiceIds: ['a','c'] }))).rejects.toMatchObject({ code: 'NO_PAYABLE_BALANCE' });
    expect(rows.customer_payment_batches).toHaveLength(0);
  });
  test.each(['void','voided','canceled','cancelled'])('%s is excluded even with remaining ledger balance', async status => {
    rows.invoices[1].status = status;
    expect(await preview(input())).toMatchObject({ eligibleCount: 2, excludedCount: 3, totalOutstandingCents: 32500 });
  });
  test('cancelled Order and imported QB invoice remain non-payable', async () => {
    rows.invoices[1].orderId = 'cancelled-order'; rows.orders.push({ id: 'cancelled-order', organizationId: 'org', customerId: 'customer', status: 'canceled' });
    rows.invoices[3].importSource = 'quickbooks';
    expect(await preview(input())).toMatchObject({ eligibleCount: 1, excludedCount: 4, totalOutstandingCents: 7500 });
  });
  test('posting recomputes a newly settled invoice, reducing applied money and increasing change', async () => {
    const initial = await preview(input({ amountCents: 50000 }));
    rows.payments.push({ id: 'external-b', organizationId: 'org', invoiceId: 'b', amountCents: 10000, status: 'succeeded' });
    const result = await record(input({ amountCents: 50000, expectedRemainingCents: Object.fromEntries(initial.invoices.map(x => [x.invoiceId,x.remainingCents])) }));
    expect(result).toMatchObject({ appliedAmountCents: 32500, changeDueCents: 17500 });
    expect(result.payments.map((p: any) => p.invoiceId)).toEqual(['d','e']);
  });
  test('posting re-reads partially changed balances instead of applying the old preview', async () => {
    rows.payments.push({ id: 'partial-b', organizationId: 'org', invoiceId: 'b', amountCents: 5000, status: 'succeeded' });
    const result = await record(input({ expectedRemainingCents: { b: 10000, d: 25000, e: 7500 } }));
    expect(result.payments.map((p: any) => [p.invoiceId,p.amountCents])).toEqual([['b',5000],['d',25000]]);
  });
  test.each(['a','b'])('mixed Customers block even if the other Customer is paid (%s)', async id => {
    rows.invoices.find(x => x.id === id).customerId = 'other';
    await expect(preview(input())).rejects.toMatchObject({ code: 'CUSTOMER_MISMATCH' });
    await expect(record(input())).rejects.toMatchObject({ code: 'CUSTOMER_MISMATCH' });
    expect(rows.customer_payment_batches).toHaveLength(0);
  });
  test('missing/foreign invoice and changed Customer fail closed', async () => {
    await expect(record(input({ expectedCustomerId: 'old-owner' }))).rejects.toMatchObject({ code: 'CUSTOMER_MISMATCH' });
    rows.invoices[0].organizationId = 'other-org';
    await expect(record(input())).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
  });
  test('same request replays its batch without posting or reallocating twice', async () => {
    const first = await record(input()); const replay = await record(input());
    expect(replay).toMatchObject({ reused: true, batch: { id: first.batch.id }, appliedAmountCents: 30000 });
    expect(rows.customer_payment_batches).toHaveLength(1); expect(rows.payments).toHaveLength(4); expect(rows.audit_logs).toHaveLength(1);
  });
  test('failure after one allocation rolls back the batch and every child payment', async () => {
    const before = structuredClone(rows); failPaymentNumber = 2;
    await expect(record(input())).rejects.toThrow('simulated allocation failure'); expect(rows).toEqual(before);
  });
  test('custom allocations do not silently redistribute if an invoice became paid', async () => {
    const customAllocations = [{ invoiceId: 'b', amountCents: 10000 }, { invoiceId: 'd', amountCents: 20000 }, { invoiceId: 'e', amountCents: 0 }];
    rows.payments.push({ id: 'settled-b', organizationId: 'org', invoiceId: 'b', amountCents: 10000, status: 'succeeded' });
    await expect(record(input({ allocationMode: 'custom', customAllocations }))).rejects.toMatchObject({ code: 'PAYMENT_ALLOCATION_STALE' });
    expect(rows.customer_payment_batches).toHaveLength(0);
  });
  test('canonical reversal/refund ledger records reopen only their own allocations', async () => {
    const payment = await record(input());
    rows.payments.find(row => row.id === payment.payments[0].id).status = 'voided';
    rows.payments.push({ id: 'refund-d', organizationId: 'org', invoiceId: 'd', status: 'refunded', amountCents: 5000 });
    expect(await preview(input())).toMatchObject({ totalOutstandingCents: 27500, eligibleCount: 3 });
    expect(rows.invoices[1].status).toBe('paid'); // stale label does not prevent repayment after a reversal
  });
  test('provider finalization keeps strict eligibility and overpayment rejection', async () => {
    await expect(record(input({ provider: 'stripe' }))).rejects.toMatchObject({ code: 'INVOICE_NOT_PAYABLE' });
    await expect(record(input({ staffSelection: false, provider: 'stripe', invoiceIds: ['b'], amountCents: 10001 }))).rejects.toMatchObject({ code: 'OVERPAYMENT_NOT_ALLOWED' });
    expect(rows.customer_payment_batches).toHaveLength(0);
  });
});
