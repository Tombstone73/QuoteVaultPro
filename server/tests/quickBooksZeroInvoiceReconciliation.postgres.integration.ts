import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { auditLogs, customers, invoiceLineItems, invoices, oauthConnections, organizations, payments, products, users } from '@shared/schema';
import { enqueueSelectedQuickBooksSyncForOrg, getQuickBooksSyncQueueCountsForOrg, listQuickBooksSyncQueueItemsForOrg, runSelectedQuickBooksSyncForOrg } from '../services/quickbooksSyncQueueWorker';

const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID();
let customerId: string, productId: string;
const originalFetch = globalThis.fetch;
const savedEnv = new Map<string, string | undefined>();
const requests: Array<{ method: string; path: string; body: any }> = [];
let provider: (method: string, path: string, body: any) => Promise<Response>;

const qbInvoice = (invoice: { id: string; displayNumber: string | null }, total: number, balance = total, extras: Record<string, unknown> = {}) => ({
  Id: invoice.id, SyncToken: total === 0 ? '2' : '1', DocNumber: invoice.displayNumber, CustomerRef: { value: 'qb-customer' },
  TotalAmt: total, Balance: balance, DiscountAmt: total === 0 ? 400 : 0,
  Line: [{ LineNum: 1, Amount: 400, DetailType: 'SalesItemLineDetail', Description: 'Synthetic print', SalesItemLineDetail: { Qty: 1, UnitPrice: 400 } }],
  ...extras,
});

beforeAll(async () => {
  for (const [key, value] of Object.entries({ QUICKBOOKS_CLIENT_ID: 'synthetic-client', QUICKBOOKS_CLIENT_SECRET: 'synthetic-secret', QUICKBOOKS_REDIRECT_URI: 'http://127.0.0.1/test', QUICKBOOKS_ENVIRONMENT: 'sandbox' })) {
    savedEnv.set(key, process.env[key]); process.env[key] = value;
  }
  await db.insert(organizations).values([{ id: org, name: 'Synthetic QB zero reconciliation', slug: org }, { id: otherOrg, name: 'Other tenant', slug: otherOrg }]);
  await db.insert(users).values({ id: actor, email: `${actor}@example.invalid`, role: 'admin' });
  [customerId] = (await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic customer', externalAccountingId: 'qb-customer' }).returning({ id: customers.id })).map(row => row.id);
  [productId] = (await db.insert(products).values({ organizationId: org, name: 'Synthetic print', description: 'Synthetic', requiresProductionJob: true }).returning({ id: products.id })).map(row => row.id);
  await db.insert(oauthConnections).values({ organizationId: org, provider: 'quickbooks', companyId: 'synthetic-company', accessToken: 'synthetic-token', refreshToken: 'synthetic-refresh', expiresAt: new Date(Date.now() + 3_600_000) });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init?.method || 'GET', path: url.pathname, body });
    return provider(init?.method || 'GET', url.pathname, body);
  };
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await pool.end();
});

async function fixture(options: { linked?: boolean; approved?: boolean; totalCents?: number; qbStatus?: string } = {}) {
  const id = randomUUID(), linked = options.linked ?? true, approved = options.approved ?? true;
  const invoiceNumber = Math.floor(Math.random() * 1_000_000_000);
  const [invoice] = await db.insert(invoices).values({
    id, organizationId: org, customerId, createdByUserId: actor, invoiceNumber, displayNumber: String(invoiceNumber),
    status: 'billed', subtotal: '400.00', subtotalCents: 40000, total: ((options.totalCents ?? 0) / 100).toFixed(2), totalCents: options.totalCents ?? 0,
    tax: '0.00', taxCents: 0, shippingCents: 0, balanceDue: ((options.totalCents ?? 0) / 100).toFixed(2), amountPaid: '0.00',
    qbInvoiceId: linked ? id : null, externalAccountingId: linked ? id : null, qbSyncStatus: options.qbStatus ?? (linked ? 'needs_resync' : 'not_synced'),
    invoiceVersion: 2, lastQbSyncedVersion: linked ? 1 : null, syncedAt: linked ? new Date('2026-01-01T00:00:00Z') : null,
    accountingApprovedAt: approved ? new Date() : null, accountingApprovedVersion: approved ? 2 : 1,
    accountingApprovalRevokedAt: approved ? null : new Date(),
  } as any).returning();
  await db.insert(invoiceLineItems).values({ invoiceId: id, productId, description: 'Synthetic print', quantity: 1, unitPrice: '400.00', totalPrice: '400.00', unitPriceCents: 40000, lineTotalCents: 40000 });
  return invoice;
}
const list = (search = '') => listQuickBooksSyncQueueItemsForOrg({ organizationId: org, page: 1, pageSize: 100, search });
const force = (id: string) => runSelectedQuickBooksSyncForOrg({ organizationId: org, items: [{ id, resourceType: 'invoice' }], syncMode: 'manual_force', actor: { userId: actor, userName: 'Synthetic tester' } });

test('linked $0 revisions remain visible while waiting for approval; new unsynced $0 policy is unchanged', async () => {
  const linked = await fixture({ approved: false });
  const fresh = await fixture({ linked: false, approved: false });
  const item = (await list()).items.find(row => row.id === linked.id);
  expect(item).toMatchObject({ id: linked.id, amountCents: 0, qbInvoiceId: linked.id, queueState: 'unsynced', eligible: false, ineligibleReason: expect.stringContaining('Waiting for Approval') });
  expect((await list()).items.find(row => row.id === fresh.id)).toBeUndefined();
  expect((await getQuickBooksSyncQueueCountsForOrg({ organizationId: org })).invoices.unsynced).toBe(1);
  expect((await listQuickBooksSyncQueueItemsForOrg({ organizationId: otherOrg, page: 1, pageSize: 100 })).items).toEqual([]);
  expect(requests).toHaveLength(0);
});

test('approved linked $0 revision updates the existing QuickBooks ID and verifies its unpaid readback', async () => {
  const invoice = await fixture();
  const before = (await list()).items.find(row => row.id === invoice.id);
  expect(before).toMatchObject({ id: invoice.id, qbInvoiceId: invoice.id, amountCents: 0, eligibility: 'queueable', eligible: true });
  expect((await enqueueSelectedQuickBooksSyncForOrg({ organizationId: org, items: [{ id: invoice.id, resourceType: 'invoice' }] })).queued).toBe(1);
  requests.length = 0;
  let reads = 0;
  provider = async (method, path, body) => {
    if (method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)) return Response.json({ Invoice: qbInvoice(invoice, ++reads === 1 ? 400 : 0) });
    if (method === 'POST' && path.endsWith('/invoice')) return Response.json({ Invoice: qbInvoice(invoice, 0) });
    throw new Error(`Unexpected QuickBooks request ${method} ${path}`);
  };
  expect((await force(invoice.id)).synced).toBe(1);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(requests.find(request => request.method === 'POST')?.body).toMatchObject({ Id: invoice.id, SyncToken: '1', DiscountAmt: 400, Line: [expect.objectContaining({ Amount: 400 })] });
  expect(requests.filter(request => request.method === 'GET')).toHaveLength(2);
  const [saved] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
  expect(saved).toMatchObject({ qbInvoiceId: invoice.id, qbSyncStatus: 'synced', lastQbSyncedVersion: 2, totalCents: 0, balanceDue: '0.00' });
  const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, org), eq(auditLogs.entityId, invoice.id), eq(auditLogs.actionType, 'quickbooks_manual_force_sync')));
  expect(audit.newValues).toMatchObject({ previousQbInvoiceId: invoice.id, previousQbSyncedVersion: 1, qbInvoiceId: invoice.id, verifiedQuickBooks: { totalCents: 0, balanceCents: 0, syncToken: '2' } });
  expect(await db.select().from(payments).where(and(eq(payments.organizationId, org), eq(payments.invoiceId, invoice.id)))).toEqual([]);
  requests.length = 0;
  expect((await force(invoice.id)).skipped).toBe(1);
  expect(requests).toHaveLength(0);
});

test('a post-update readback failure stays pending and a verification retry performs no second write', async () => {
  const invoice = await fixture({ qbStatus: 'pending' });
  requests.length = 0;
  let reads = 0;
  provider = async (method, path) => {
    if (method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)) {
      if (++reads === 1) return Response.json({ Invoice: qbInvoice(invoice, 400) });
      return Response.json({ Fault: { Error: [{ Message: 'Synthetic readback outage' }] } }, { status: 503 });
    }
    if (method === 'POST' && path.endsWith('/invoice')) return Response.json({ Invoice: qbInvoice(invoice, 0) });
    throw new Error(`Unexpected QuickBooks request ${method} ${path}`);
  };
  expect((await force(invoice.id)).failed).toBe(1);
  expect((await db.select({ status: invoices.qbSyncStatus }).from(invoices).where(eq(invoices.id, invoice.id)))[0].status).toBe('verification_pending');
  expect((await list()).items.find(row => row.id === invoice.id)).toMatchObject({ queueState: 'failed', syncStatus: 'verification_pending', canManualForce: true });
  requests.length = 0;
  provider = async (method, path) => method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)
    ? Response.json({ Invoice: qbInvoice(invoice, 0) })
    : Promise.reject(new Error(`Unexpected QuickBooks write ${method} ${path}`));
  expect((await force(invoice.id)).synced).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('GET');
});

test('linked $0 update rejects QuickBooks payment applications without changing local money', async () => {
  const invoice = await fixture({ qbStatus: 'pending' });
  requests.length = 0;
  provider = async (method, path) => method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)
    ? Response.json({ Invoice: qbInvoice(invoice, 400, 300, { LinkedTxn: [{ TxnType: 'Payment', TxnId: 'payment-1' }] }) })
    : Promise.reject(new Error(`Unexpected QuickBooks write ${method} ${path}`));
  expect((await force(invoice.id)).failed).toBe(1);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
  expect((await db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ totalCents: 0, amountPaid: '0.00', balanceDue: '0.00', qbInvoiceId: invoice.id });
});

test('a new unlinked $0 invoice does not create a QuickBooks transaction', async () => {
  const invoice = await fixture({ linked: false, approved: true, qbStatus: 'pending' });
  requests.length = 0;
  expect((await force(invoice.id)).failed).toBe(1);
  expect(requests).toHaveLength(0);
  expect((await db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ totalCents: 0, qbInvoiceId: null, qbSyncStatus: 'failed' });
});

test('local payment history blocks the simple zero-dollar update before a QuickBooks request', async () => {
  const invoice = await fixture({ qbStatus: 'pending' });
  await db.insert(payments).values({ organizationId: org, invoiceId: invoice.id, provider: 'manual', method: 'check', status: 'succeeded', amount: '1.00', amountCents: 100 });
  requests.length = 0;
  expect((await force(invoice.id)).failed).toBe(1);
  expect(requests).toHaveLength(0);
  expect((await db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ totalCents: 0, qbInvoiceId: invoice.id });
});

test('QuickBooks rejection leaves the original linked invoice and local amount intact', async () => {
  const invoice = await fixture({ qbStatus: 'pending' });
  requests.length = 0;
  provider = async (method, path) => {
    if (method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)) return Response.json({ Invoice: qbInvoice(invoice, 400) });
    if (method === 'POST' && path.endsWith('/invoice')) return Response.json({ Fault: { Error: [{ Message: 'Accounting period closed' }] } }, { status: 400 });
    throw new Error(`Unexpected QuickBooks request ${method} ${path}`);
  };
  expect((await force(invoice.id)).failed).toBe(1);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(requests.filter(request => request.method === 'GET')).toHaveLength(1);
  expect((await db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ totalCents: 0, qbInvoiceId: invoice.id, qbSyncStatus: 'failed' });
});

test('an ordinary positive linked invoice still updates without a discount', async () => {
  const invoice = await fixture({ qbStatus: 'pending', totalCents: 40000 });
  requests.length = 0;
  provider = async (method, path) => {
    if (method === 'GET' && path.endsWith(`/invoice/${invoice.id}`)) return Response.json({ Invoice: qbInvoice(invoice, 400) });
    if (method === 'POST' && path.endsWith('/invoice')) return Response.json({ Invoice: qbInvoice(invoice, 400) });
    throw new Error(`Unexpected QuickBooks request ${method} ${path}`);
  };
  expect((await force(invoice.id)).synced).toBe(1);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(requests.find(request => request.method === 'POST')?.body).toMatchObject({ Id: invoice.id, SyncToken: '1' });
  expect(requests.find(request => request.method === 'POST')?.body.DiscountAmt).toBeUndefined();
  expect((await db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ totalCents: 40000, qbInvoiceId: invoice.id, qbSyncStatus: 'synced' });
});
