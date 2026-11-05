import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from '@jest/globals';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import { auditLogs, customerPaymentBatches, customers, invoices, organizations, payments, users } from '@shared/schema';
import { listQuickBooksSyncQueueItemsForOrg } from '../services/quickbooksSyncQueueWorker';
import { registerQuickBooksRoutes } from '../routes/quickbooks.routes';

let org: string, customer: string, actor: string;
const app = express(); app.use(express.json());
beforeAll(async () => {
  [{ id: actor }] = await db.insert(users).values({ email: `${randomUUID()}@example.invalid`, role: 'admin' }).returning();
  const auth = (req: any, _res: any, next: () => void) => { req.organizationId = req.headers['x-test-org'] || org; req.orgRole = 'admin'; req.user = { id: actor }; next(); };
  registerQuickBooksRoutes(app, { isAuthenticated: auth, tenantContext: auth, isAdminOrOwner: auth });
}, 120000);
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizations).values({ name: 'Isolated QB methods', slug: randomUUID() }).returning();
  [{ id: customer }] = await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic accounting customer' }).returning();
});
afterAll(async () => { await pool.end(); });
async function invoice(label = 'QA Invoice') {
  return (await db.insert(invoices).values({ organizationId: org, customerId: customer, createdByUserId: actor,
    invoiceNumber: Math.floor(Math.random() * 1000000000), displayNumber: `${label}-${randomUUID()}`, status: 'billed', total: '1000', totalCents: 100000,
    qbSyncStatus: 'synced', qbInvoiceId: `QB-${randomUUID()}`, invoiceVersion: 1, accountingApprovedVersion: 1,
    accountingApprovedAt: new Date('2026-01-01'), accountingUpdatedAt: new Date('2026-01-01') }).returning())[0]!;
}
async function payment(method: string, extra: Partial<typeof payments.$inferInsert> = {}, label = 'QA Invoice') {
  const inv = await invoice(label);
  return (await db.insert(payments).values({ organizationId: org, invoiceId: inv.id, amount: '20', amountCents: 2000,
    method, provider: 'manual', status: 'succeeded', syncStatus: 'not_synced', accountingUpdatedAt: new Date('2026-01-01'), ...extra }).returning())[0]!;
}
async function receipt(method: string) {
  return (await db.insert(customerPaymentBatches).values({ organizationId: org, customerId: customer, amountCents: 6000,
    method, appliedAt: new Date('2026-01-01'), provider: 'manual', allocationMode: 'custom', status: 'succeeded', idempotencyKey: randomUUID(), reference: 'Receipt-QA-123' }).returning())[0]!;
}
const list = (extra: Partial<Parameters<typeof listQuickBooksSyncQueueItemsForOrg>[0]> = {}) => listQuickBooksSyncQueueItemsForOrg({ organizationId: org, page: 1, pageSize: 25, filters: { type: 'payment' }, ...extra });

test.each(['cash', 'check', 'credit_card', 'ach', 'bank_transfer', 'wire', 'other'])('projects recorded %s without using provider or sync state', async method => {
  const p = await payment(method, { provider: method === 'cash' ? 'stripe' : 'manual', metadata: { reference: 'Check-or-transaction-QA' } });
  const result = await list(); expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ id: p.id, paymentMethods: [method], paymentReference: 'Check-or-transaction-QA', receiptId: null });
});

test('blank and unrecognized historical methods remain Unknown despite processor and invoice state', async () => {
  const a = await payment('', { provider: 'eps' }), b = await payment('unrecorded_legacy', { provider: 'stripe', syncStatus: 'synced' });
  const result = await list({ filters: { paymentMethod: 'unknown' } });
  expect(result.items.map(row => row.id).sort()).toEqual([a.id, b.id].sort());
  expect(result.items.every(row => row.paymentMethods.join() === 'unknown')).toBe(true);
});

test('a grouped receipt uses its actual header method/reference while retaining every allocation ID and amount', async () => {
  const b = await receipt('check'); const allocations = [];
  for (const method of ['cash', 'other', 'credit_card']) allocations.push(await payment(method, { customerPaymentBatchId: b.id }));
  const result = await list({ filters: { paymentMethod: 'check' }, pageSize: 1 });
  expect(result.totalCount).toBe(3); expect(result.totalPages).toBe(3);
  const all = await list(); expect(all.items.map(row => row.id).sort()).toEqual(allocations.map(row => row.id).sort());
  expect(all.items.every(row => row.receiptId === b.id && row.paymentMethods.join() === 'check' && row.paymentReference === 'Receipt-QA-123' && row.amountCents === 2000)).toBe(true);
  expect((await list({ filters: { paymentMethod: 'cash' } })).totalCount).toBe(0);
});

test('multiple explicitly recorded allocation methods under a missing header remain visible together through each matching filter', async () => {
  const b = await receipt(''); await payment('cash', { customerPaymentBatchId: b.id }); await payment('check', { customerPaymentBatchId: b.id });
  for (const paymentMethod of ['cash', 'check'] as const) {
    const result = await list({ filters: { paymentMethod } }); expect(result.totalCount).toBe(2);
    expect(result.items.every(row => row.paymentMethods.join() === 'cash,check')).toBe(true);
  }
});

test('a missing receipt header is not inferred from just one allocation method', async () => {
  const b = await receipt(''); await payment('cash', { customerPaymentBatchId: b.id });
  expect((await list({ filters: { paymentMethod: 'unknown' } })).totalCount).toBe(1);
  expect((await list({ filters: { paymentMethod: 'cash' } })).totalCount).toBe(0);
});

test('method, sync state, search and paging apply before SQL LIMIT and count the complete dataset', async () => {
  const wanted = [];
  for (let index = 0; index < 28; index++) wanted.push(await payment('check', { syncStatus: index < 26 ? 'failed' : 'pending', metadata: { reference: `target-ref-${index}` } }));
  await payment('cash', { syncStatus: 'failed', metadata: { reference: 'target-ref-cash' } });
  const first = await list({ view: 'failed', search: 'target-ref', filters: { paymentMethod: 'check' } });
  const second = await list({ page: 2, view: 'failed', search: 'target-ref', filters: { paymentMethod: 'check' } });
  expect(first.totalCount).toBe(26); expect(first.totalPages).toBe(2); expect(first.items).toHaveLength(25); expect(second.items).toHaveLength(1);
  expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(26);
  expect((await list({ search: 'not-present', filters: { paymentMethod: 'check' } })).totalCount).toBe(0);
  expect((await list({ filters: { type: 'invoice', paymentMethod: 'unknown' } })).totalCount).toBe(0);
});

test('ACH includes recorded bank transfer and Other includes explicit Wire without processor inference', async () => {
  await payment('bank_transfer'); await payment('ach'); await payment('wire'); await payment('other');
  expect((await list({ filters: { paymentMethod: 'ach' } })).totalCount).toBe(2);
  expect((await list({ filters: { paymentMethod: 'other' } })).totalCount).toBe(2);
});

test('a mismatched receipt customer does not supply its method or private reference', async () => {
  const [other] = await db.insert(customers).values({ organizationId: org, companyName: 'Other isolated customer' }).returning();
  const b = await receipt('check'); await db.update(customerPaymentBatches).set({ customerId: other.id }).where(eq(customerPaymentBatches.id, b.id));
  await payment('cash', { customerPaymentBatchId: b.id });
  const result = await list({ filters: { paymentMethod: 'unknown' } });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ paymentMethods: ['unknown'], paymentReference: null, eligible: false });
});

test('foreign-tenant receipt linkage cannot leak a method or reference', async () => {
  const b = await receipt('check');
  const [foreign] = await db.insert(organizations).values({ name: 'Foreign fixture', slug: randomUUID() }).returning();
  await db.update(customerPaymentBatches).set({ organizationId: foreign.id }).where(eq(customerPaymentBatches.id, b.id));
  await payment('cash', { customerPaymentBatchId: b.id });
  const result = await list({ filters: { paymentMethod: 'unknown' } });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ paymentMethods: ['unknown'], paymentReference: null, eligible: false });
});

test('actual route forwards the validated filter and remains tenant scoped, read only, and batched', async () => {
  const p = await payment('check'); await payment('cash');
  const before = { payments: await db.select().from(payments).where(eq(payments.organizationId, org)), invoices: await db.select().from(invoices).where(eq(invoices.organizationId, org)), audits: await db.select().from(auditLogs).where(eq(auditLogs.organizationId, org)) };
  const logs: string[] = []; const logger = { logQuery: (query: string) => logs.push(query) };
  const session = (db as any)._.session; const previous = session.logger, previousOptions = session.options.logger;
  session.logger = logger; session.options.logger = logger;
  let response: request.Response;
  try { response = await request(app).get('/api/integrations/quickbooks/queue/items?paymentMethod=check&pageSize=1'); }
  finally { session.logger = previous; session.options.logger = previousOptions; }
  expect(response.status).toBe(200); expect(response.body.data.items.map((row: { id: string }) => row.id)).toEqual([p.id]);
  expect(response.body.data.totalCount).toBe(1); expect(logs).toHaveLength(2);
  expect((await request(app).get('/api/integrations/quickbooks/queue/items?paymentMethod=check').set('x-test-org', randomUUID())).body.data.items).toEqual([]);
  expect({ payments: await db.select().from(payments).where(eq(payments.organizationId, org)), invoices: await db.select().from(invoices).where(eq(invoices.organizationId, org)), audits: await db.select().from(auditLogs).where(eq(auditLogs.organizationId, org)) }).toEqual(before);
});
