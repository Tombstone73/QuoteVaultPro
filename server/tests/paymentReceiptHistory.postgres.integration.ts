import { randomUUID } from 'node:crypto';
import https from 'node:https';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customerAccountCreditApplicationBatches, customerAccountCreditApplications, customerAccountCredits, customerContacts, customerPaymentBatches, customers, invoiceEmailLogs, invoiceReminderLogs, invoiceReminderSettings, invoices, organizations, payments, userOrganizations, users } from '@shared/schema';
import { readPaymentReceiptHistory, listPaymentReceipts } from '../services/paymentReceiptHistoryService';
import { tenantContext as productionTenantContext } from '../tenantContext';

jest.unstable_mockModule('sharp',()=>({default:()=>{throw new Error('No image processing in payment-history tests');}}));
let org:string, customer:string, actor:string, app:express.Express;
const orgs:string[]=[];
const additionalUsers: string[] = [];
const date = new Date('2026-06-15T14:30:00.000Z');
beforeAll(async()=>{
 actor=(await db.insert(users).values({email:randomUUID()+'@example.invalid',role:'admin'}).returning())[0].id;
 app=express();app.use(express.json());
 const isAuthenticated: express.RequestHandler = (req, res, next) => {
  res.append('X-Fixture-Middleware', 'auth');
  if (req.get('X-Fixture-Auth') === 'anonymous') {
   res.status(401).json({ message: 'Unauthorized' });
   return;
  }
  req.user = { id: req.get('X-Fixture-User') || actor };
  next();
 };
 const tenantContext: express.RequestHandler = (req, res, next) => {
  res.append('X-Fixture-Middleware', 'tenant');
  if (req.get('X-Fixture-Membership') === 'true') {
   return productionTenantContext(req, res, next);
  }
  if (req.get('X-Fixture-Tenant') !== 'missing') req.organizationId = org;
  Object.assign(req, { orgRole: 'admin', actorOrgRole: 'admin' });
  next();
 };
 const requireOrgOwnerAdmin: express.RequestHandler = (req, res, next) => {
  res.append('X-Fixture-Middleware', 'owner-admin');
  if (!['owner', 'admin'].includes(req.orgRole ?? '')) {
   res.status(403).json({ message: 'Access denied. Organization Owner or Admin role required.' });
   return;
  }
  next();
 };
 const {registerMvpInvoicingRoutes}=await import('../routes/mvpInvoicing.routes');
 await registerMvpInvoicingRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });
 const {registerCustomerRelationsRoutes}=await import('../routes/customerRelations.routes');
 registerCustomerRelationsRoutes(app, { isAuthenticated, tenantContext, isAdmin: requireOrgOwnerAdmin });
},180000);
beforeEach(async()=>{
 org=(await db.insert(organizations).values({name:'Synthetic payment receipt history',slug:'receipt-'+randomUUID()}).returning())[0].id;orgs.push(org);
 customer=(await db.insert(customers).values({organizationId:org,companyName:'Receipt Test Customer'}).returning())[0].id;
});
afterAll(async()=>{
 if(orgs.length)await db.delete(payments).where(inArray(payments.organizationId,orgs));
 for(const id of orgs){
  await db.delete(payments).where(eq(payments.organizationId,id));await db.delete(customerAccountCreditApplications).where(eq(customerAccountCreditApplications.organizationId,id));
  await db.delete(customerAccountCreditApplicationBatches).where(eq(customerAccountCreditApplicationBatches.organizationId,id));await db.delete(customerAccountCredits).where(eq(customerAccountCredits.organizationId,id));
  await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,id));await db.delete(auditLogs).where(eq(auditLogs.organizationId,id));
  await db.delete(invoices).where(eq(invoices.organizationId,id));await db.delete(customerContacts).where(eq(customerContacts.organizationId,id));await db.delete(customers).where(eq(customers.organizationId,id));await db.delete(organizations).where(eq(organizations.id,id));
 }
 if(actor)await db.delete(users).where(eq(users.id,actor));
 if (additionalUsers.length) await db.delete(users).where(inArray(users.id, additionalUsers));
});
async function invoice(label:string, owner=customer, organizationId=org){return (await db.insert(invoices).values({organizationId,customerId:owner,invoiceNumber:Math.floor(Math.random()*1e9),displayNumber:label,createdByUserId:actor,status:'billed',subtotal:'1000',tax:'0',total:'1000',subtotalCents:100000,totalCents:100000,taxCents:0}).returning())[0];}
async function payment(invoiceId:string,cents:number,extra:Partial<typeof payments.$inferInsert>={}){return (await db.insert(payments).values({organizationId:org,invoiceId,amount:(cents/100).toFixed(2),amountCents:cents,method:'other',provider:'manual',status:'succeeded',paidAt:date,appliedAt:date,notes:'Cash App',...extra}).returning())[0];}
async function batch(amount=50000,extra:Partial<typeof customerPaymentBatches.$inferInsert>={}){return (await db.insert(customerPaymentBatches).values({organizationId:org,customerId:customer,amountCents:amount,method:'other',allocationMode:'custom',status:'succeeded',provider:'manual',idempotencyKey:randomUUID(),reference:'CashApp-500-REF',appliedAt:date,...extra}).returning())[0];}
async function grouped(){const b=await batch();const inv=await Promise.all(['INV-A','INV-B','INV-C'].map(label=>invoice(label)));const p=await Promise.all(inv.map((row,i)=>payment(row.id,[20000,17500,12500][i],{customerPaymentBatchId:b.id})));return {b,inv,p};}
const read=(extra:Partial<Parameters<typeof readPaymentReceiptHistory>[0]>={})=>readPaymentReceiptHistory({organizationId:org,customerId:customer,...extra});
async function snapshot(){return {p:await db.select().from(payments).where(eq(payments.organizationId,org)),b:await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId,org)),i:await db.select().from(invoices).where(eq(invoices.organizationId,org)),a:await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org))};}

test('mounted payment GETs preserve distinct receipt and invoice history without financial or provider side effects', async () => {
 const { b, inv, p } = await grouped();
 const target = inv[0];
 const [named] = await db.insert(users).values({
  email: randomUUID() + '@example.invalid', firstName: 'Synthetic', lastName: 'Collector', role: 'admin',
 }).returning();
 additionalUsers.push(named.id);
 const original = new Date('2026-06-10T12:00:00Z');
 await db.update(payments).set({ createdByUserId: actor, createdAt: original }).where(eq(payments.id, p[0].id));
 const recorded = await payment(target.id, 3000, {
  provider: 'stripe', status: 'pending', paidAt: null, quickbooksPaymentReference: 'historic-reference',
  createdByUserId: named.id, createdAt: new Date('2026-06-11T12:00:00Z'),
 });
 const refund = await payment(target.id, 1000, {
  provider: 'stripe', status: 'refunded', refundedAt: date, createdAt: new Date('2026-06-12T12:00:00Z'),
 });
 await payment(target.id, 500, {
  provider: 'stripe', status: 'pending', paidAt: null, createdAt: new Date('2026-06-13T12:00:00Z'),
 });
 const before = await snapshot();
 const outbound = jest.fn(() => { throw new Error('Provider transport forbidden in payment-history tests'); });
 const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(outbound);
 const httpsRequest = jest.spyOn(https, 'request').mockImplementation(outbound);
 try {
  const receipts = await request(app).get('/api/payments').query({ search: b.reference });
  expect(receipts.status).toBe(200);
  expect(receipts.headers['x-fixture-middleware']).toBe('auth, tenant');
  expect(receipts.body).toEqual({ success: true, data: expect.objectContaining({
   rows: [expect.objectContaining({ batchId: b.id, amountCents: 50000, allocatedCents: 50000 })],
   summary: { totalPayments: 1, totalCollectedCents: 50000 },
   pagination: { page: 1, pageSize: 50, totalCount: 1, totalPages: 1 }, datePreset: 'all',
  }) });
  expect(receipts.body.data.rows[0].allocations.map((row: {paymentId: string}) => row.paymentId)).toEqual(p.map(row => row.id));

  const history = await request(app).get(`/api/invoices/${target.id}/payments`);
  expect(history.status).toBe(200);
  expect(history.headers['x-fixture-middleware']).toBe('auth, tenant');
  expect(history.body).toEqual({ success: true, data: [
   expect.objectContaining({ id: refund.id, invoiceId: target.id, status: 'refunded', createdBy: null }),
   expect.objectContaining({ id: recorded.id, invoiceId: target.id, status: 'pending',
    createdBy: { id: named.id, name: 'Synthetic Collector', email: named.email } }),
   expect.objectContaining({ id: p[0].id, invoiceId: target.id, customerPaymentBatchId: b.id,
    createdBy: { id: actor, name: expect.any(String), email: expect.any(String) } }),
  ] });
  expect(history.body.data[2].createdBy.name).toBe(history.body.data[2].createdBy.email);
  expect(await snapshot()).toEqual(before);
  expect(outbound).not.toHaveBeenCalled();
 } finally {
  httpsRequest.mockRestore();
  fetch.mockRestore();
 }
});

test('mounted organization history preserves tenant timezone, date, method, sorting and paging', async () => {
 await db.update(organizations).set({ settings: { timezone: 'America/Los_Angeles' } }).where(eq(organizations.id, org));
 const target = await invoice('INV-TIMEZONE');
 const cashAt = (cents: number, timestamp: string) =>
  payment(target.id, cents, { method: 'cash', paidAt: new Date(timestamp), appliedAt: new Date(timestamp) });
 const early = await cashAt(4000, '2026-06-15T07:00:00Z');
 const late = await cashAt(1500, '2026-06-16T06:59:59Z');
 const beforeDay = await cashAt(500, '2026-06-15T06:59:59Z');
 const afterDay = await cashAt(700, '2026-06-16T07:00:00Z');
 const differentMethod = await payment(target.id, 900);

 const defaults = await request(app).get('/api/payments').query({ sortBy: 'unknown', page: 0, pageSize: 0 });
 expect(defaults.status).toBe(200);
 expect(defaults.body.data.pagination).toEqual({ page: 1, pageSize: 50, totalCount: 5, totalPages: 1 });
 expect(defaults.body.data.rows.map((row: {paymentId: string}) => row.paymentId))
  .toEqual([afterDay.id, late.id, differentMethod.id, early.id, beforeDay.id]);

 const query = { datePreset: 'custom', dateFrom: '2026-06-15', dateTo: '2026-06-15', method: ' cash ',
  customerId: customer, sortBy: 'amount', sortDir: 'asc', pageSize: 1 };
 const first = await request(app).get('/api/payments').query(query);
 expect(first.status).toBe(200);
 expect(first.body).toEqual({ success: true, data: {
  timezone: 'America/Los_Angeles', datePreset: 'custom',
  rows: [expect.objectContaining({ paymentId: late.id })],
  summary: { totalPayments: 2, totalCollectedCents: 5500 },
  pagination: { page: 1, pageSize: 1, totalCount: 2, totalPages: 2 },
 } });
 const second = await request(app).get('/api/payments').query({ ...query, page: 2 });
 expect(second.status).toBe(200);
 expect(second.body.data.rows).toEqual([expect.objectContaining({ paymentId: early.id })]);

 const capped = await request(app).get('/api/payments').query({ pageSize: 201 });
 expect(capped.body.data.pagination.pageSize).toBe(200);
});

test('mounted history keeps authentication, tenant fallback, validation and error envelopes', async () => {
 const target = await invoice('INV-LOCAL');
 const paths = ['/api/payments', `/api/invoices/${target.id}/payments`];
 for (const path of paths) {
  const denied = await request(app).get(path).set('X-Fixture-Auth', 'anonymous');
  expect(denied.status).toBe(401);
  expect(denied.headers['x-fixture-middleware']).toBe('auth');
  expect(denied.body).toEqual({ message: 'Unauthorized' });
  const missingScope = await request(app).get(path).set('X-Fixture-Tenant', 'missing');
  expect(missingScope.status).toBe(500);
  expect(missingScope.headers['x-fixture-middleware']).toBe('auth, tenant');
  expect(missingScope.body).toEqual(path === '/api/payments'
   ? { success: false, error: 'Missing organization context' } : { error: 'Missing organization context' });
  const fallback = await request(app).get(path).set('X-Fixture-Tenant', 'missing').set('X-Organization-Id', org);
  expect(fallback.status).toBe(200);
 }
 for (const [param, error] of [['method', 'Invalid payment method'], ['datePreset', 'Invalid payment date preset']]) {
  const invalid = await request(app).get('/api/payments').query({ [param]: 'unsupported' });
  expect(invalid.status).toBe(400);
  expect(invalid.body).toEqual({ success: false, error });
 }
 const failingQuery = jest.spyOn(db, 'select');
 try {
  failingQuery.mockImplementationOnce(() => { throw new Error('Synthetic history failure'); });
  const failedReceipts = await request(app).get('/api/payments');
  expect(failedReceipts.status).toBe(500);
  expect(failedReceipts.body).toEqual({ success: false, error: 'Failed to fetch payments' });
  failingQuery.mockImplementationOnce(() => { throw new Error('Synthetic history failure'); });
  const failedHistory = await request(app).get(paths[1]);
  expect(failedHistory.status).toBe(500);
  expect(failedHistory.body).toEqual({ error: 'Synthetic history failure' });
 } finally {
  failingQuery.mockRestore();
 }
});

test('the actual registrar preserves payment history position and matches static reminder GETs before Invoice detail', () => {
 const registrations = (app._router.stack as Array<{
  route?: { path: string; methods: Record<string, boolean> };
 }>).flatMap(layer => layer.route ? [layer.route] : []);
 const index = (verb: string, path: string) => registrations.findIndex(route => route.methods[verb] && route.path === path);
 const confirmation = index('post', '/api/invoices/:id/payments/stripe/confirm');
 expect(confirmation).toBeGreaterThanOrEqual(0);
 expect(index('get', '/api/payments')).toBe(confirmation + 1);
 expect(index('get', '/api/invoices/:id/payments')).toBe(confirmation + 2);
 expect(index('get', '/api/invoices/:id/pdf')).toBe(confirmation + 3);
 const detail = index('get', '/api/invoices/:id');
 expect(detail).toBeGreaterThan(confirmation + 3);
 expect(index('get', '/api/invoices/reminder-settings')).toBe(detail - 2);
 expect(index('get', '/api/invoices/reminder-preview')).toBe(detail - 1);
 expect(index('put', '/api/invoices/reminder-settings')).toBeGreaterThan(detail);
});

test('mounted reminder GETs return tenant settings and overdue preview without financial or delivery side effects', async () => {
 const target = await invoice('INV-LOCAL-REMINDER');
 const foreign = (await db.insert(organizations).values({ name: 'Foreign reminder tenant', slug: randomUUID() }).returning())[0];
 orgs.push(foreign.id);
 const owner = (await db.insert(customers).values({ organizationId: foreign.id, companyName: 'Foreign customer' }).returning())[0];
 const foreignInvoice = await invoice('INV-FOREIGN-REMINDER', owner.id, foreign.id);
 await db.update(invoices).set({ dueDate: new Date('2020-01-01T00:00:00Z'), balanceDue: '75.00' })
  .where(inArray(invoices.id, [target.id, foreignInvoice.id]));
 await db.insert(userOrganizations).values({ organizationId: org, userId: actor, role: 'admin' });
 await db.insert(invoiceReminderSettings).values({ organizationId: foreign.id, enabled: false, maxReminders: 99 });
 const access = { 'X-Fixture-Membership': 'true', 'X-Organization-Id': org };

 const empty = await request(app).get('/api/invoices/reminder-settings').set(access);
 expect(empty.status).toBe(200);
 expect(empty.body).toEqual({ success: true, data: null });
 const invalid = await request(app).put('/api/invoices/reminder-settings').set(access).send({ enabled: 'invalid' });
 expect(invalid.status).toBe(400);
 expect(invalid.body).toMatchObject({ success: false, error: 'Invalid settings payload' });
 const input = { enabled: true, firstReminderDaysAfterDue: 3, repeatIntervalDays: 7, maxReminders: 5 };
 const updated = await request(app).put('/api/invoices/reminder-settings').set(access).send({ ...input, organizationId: foreign.id });
 expect(updated.status).toBe(200);
 expect(updated.body).toMatchObject({ success: true, data: { organizationId: org, ...input } });
 expect(updated.headers['x-fixture-middleware']).toBe('auth, tenant, owner-admin');
 const readReminderState = async () => ({
  ...(await snapshot()),
  settings: await db.select().from(invoiceReminderSettings).where(inArray(invoiceReminderSettings.organizationId, [org, foreign.id])),
  reminderLogs: await db.select().from(invoiceReminderLogs).where(eq(invoiceReminderLogs.organizationId, org)),
  emailLogs: await db.select().from(invoiceEmailLogs).where(eq(invoiceEmailLogs.invoiceId, target.id)),
 });
 const before = await readReminderState();
 expect(before.settings.find(row => row.organizationId === foreign.id)).toMatchObject({ enabled: false, maxReminders: 99 });

 const outbound = jest.fn(() => { throw new Error('Provider transport forbidden in reminder route tests'); });
 const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(outbound);
 const httpsRequest = jest.spyOn(https, 'request').mockImplementation(outbound);
 try {
  const settings = await request(app).get('/api/invoices/reminder-settings').set(access);
  expect(settings.status).toBe(200);
  expect(settings.body).toEqual(updated.body);
  expect(settings.headers['x-fixture-middleware']).toBe('auth, tenant, owner-admin');
  const preview = await request(app).get('/api/invoices/reminder-preview').set(access);
  expect(preview.status).toBe(200);
  expect(preview.body).toEqual({ success: true, data: {
   settings: updated.body.data, blocked: [],
   eligible: [expect.objectContaining({ invoiceId: target.id, balanceDueCents: 7500, status: 'eligible' })],
  } });
  expect(preview.headers['x-fixture-middleware']).toBe('auth, tenant, owner-admin');
  const history = await request(app).get(`/api/invoices/${target.id}/reminder-history`).set(access);
  expect(history.status).toBe(200);
  expect(history.body).toEqual({ success: true, data: [] });
  expect(await readReminderState()).toEqual(before);
  expect(outbound).not.toHaveBeenCalled();
 } finally {
  httpsRequest.mockRestore();
  fetch.mockRestore();
 }
});

test('mounted reminder routes retain auth and tenant-role gates while Invoice detail retains its own contract', async () => {
 const target = await invoice('INV-DETAIL-PARITY');
 const [member] = await db.insert(users).values({ email: randomUUID() + '@example.invalid', role: 'admin' }).returning();
 additionalUsers.push(member.id);
 await db.insert(userOrganizations).values([
  { organizationId: org, userId: actor, role: 'owner' },
  { organizationId: org, userId: member.id, role: 'member' },
 ]);
 const [foreign] = await db.insert(organizations).values({ name: 'Non-member reminder tenant', slug: randomUUID() }).returning();
 orgs.push(foreign.id);
 const access = { 'X-Fixture-Membership': 'true', 'X-Organization-Id': org };
 for (const path of ['/api/invoices/reminder-settings', '/api/invoices/reminder-preview']) {
  const anonymous = await request(app).get(path).set(access).set('X-Fixture-Auth', 'anonymous');
  expect(anonymous.status).toBe(401);
  expect(anonymous.body).toEqual({ message: 'Unauthorized' });
  expect(anonymous.headers['x-fixture-middleware']).toBe('auth');
  const denied = await request(app).get(path).set(access).set('X-Fixture-User', member.id);
  expect(denied.status).toBe(403);
  expect(denied.body).toEqual({ message: 'Access denied. Organization Owner or Admin role required.' });
  expect(denied.headers['x-fixture-middleware']).toBe('auth, tenant, owner-admin');
  const foreignTenant = await request(app).get(path).set(access).set('X-Organization-Id', foreign.id);
  expect(foreignTenant.status).toBe(403);
  expect(foreignTenant.body).toEqual({ message: 'Forbidden - No access to this organization' });
  expect(foreignTenant.headers['x-fixture-middleware']).toBe('auth, tenant');
  const asOwner = await request(app).get(path).set(access);
  expect(asOwner.status).toBe(200);
 }
 const detail = await request(app).get(`/api/invoices/${target.id}`).set(access).set('X-Fixture-User', member.id);
 expect(detail.status).toBe(200);
 expect(detail.body).toMatchObject({ success: true, data: { invoice: { id: target.id } } });
 expect(detail.headers['x-fixture-middleware']).toBe('auth, tenant');
 const missing = await request(app).get(`/api/invoices/${randomUUID()}`).set(access);
 expect(missing.status).toBe(404);
 expect(missing.body).toEqual({ error: 'Invoice not found' });
});

test('mounted reminder service failures retain their specific 500 envelopes', async () => {
 const query = jest.spyOn(db, 'select');
 try {
  for (const [path, error] of [
   ['/api/invoices/reminder-settings', 'Failed to fetch reminder settings'],
   ['/api/invoices/reminder-preview', 'Failed to generate reminder preview'],
  ]) {
   query.mockImplementationOnce(() => { throw new Error('Synthetic reminder service failure'); });
   const failed = await request(app).get(path);
   expect(failed.status).toBe(500);
   expect(failed.body).toEqual({ success: false, error });
  }
 } finally {
  query.mockRestore();
 }
});

test('Cash App $500 receipt expands to $200/$175/$125 allocations without double counting or writes',async()=>{
 const {b,inv,p}=await grouped(),before=await snapshot();const result=await read();
 expect(result.summary).toEqual({totalPayments:1,totalCollectedCents:50000});expect(result.rows).toHaveLength(1);
 expect(result.rows[0]).toMatchObject({batchId:b.id,amountCents:50000,allocatedCents:50000,unappliedCents:0,reference:'CashApp-500-REF',appliedAt:date.toISOString()});
 expect(result.rows[0].allocations.map(a=>a.paymentId).sort()).toEqual(p.map(p=>p.id).sort());expect(result.rows[0].allocations.map(a=>a.invoiceId).sort()).toEqual(inv.map(i=>i.id).sort());
 expect(await snapshot()).toEqual(before);
 const response=await request(app).get('/api/customers/'+customer+'/transactions?type=payment');expect(response.status).toBe(200);expect(response.body.rows).toHaveLength(1);expect(response.body.rows[0].receipt.allocations).toHaveLength(3);expect(response.body.summary.paidTotal).toBe('500.00');
 const global=await request(app).get('/api/payments');expect(global.status).toBe(200);expect(global.body.data.summary.totalPayments).toBe(1);
});
test('one invoice payment retains its actual payment ID and canonical invoice link',async()=>{const i=await invoice('INV-SINGLE'),p=await payment(i.id,20000);const r=await read();expect(r.rows[0]).toMatchObject({paymentId:p.id,batchId:null,amountCents:20000,unappliedCents:0,allocations:[{invoiceId:i.id,invoiceNumber:'INV-SINGLE'}]});});
test('receipt filtering and pagination operate on whole groups, not matching allocations',async()=>{
 await grouped();for(const query of ['500','500.00','$500.00','Cash App','CashApp-500-REF','INV-B','2026-06-15','Receipt Test Customer']){const r=await read({search:query,pageSize:1});expect(r.summary.totalPayments).toBe(1);expect(r.rows[0].allocations).toHaveLength(3);}
 await payment((await invoice('LEGACY')).id,1000);const first=await read({pageSize:1}),second=await read({pageSize:1,page:2});expect(first.pagination.totalCount).toBe(2);expect(first.rows[0].id).not.toBe(second.rows[0].id);expect((await read({search:'not present'})).rows).toEqual([]);
});
test('partial allocation and no-allocation receipt show retained unapplied funds',async()=>{const b=await batch();await payment((await invoice('PARTIAL')).id,20000,{customerPaymentBatchId:b.id});expect((await read()).rows[0]).toMatchObject({allocatedCents:20000,unappliedCents:30000});const empty=await batch(10000);expect((await read()).rows.find(r=>r.batchId===empty.id)).toMatchObject({amountCents:10000,unappliedCents:10000,allocations:[]});});
test('refunds and voids keep original amounts and statuses, without becoming available cash',async()=>{
 const {b,p}=await grouped();await db.update(payments).set({status:'refunded',refundedAt:date}).where(eq(payments.id,p[2].id));let r=await read();expect(r.rows[0]).toMatchObject({batchId:b.id,amountCents:50000,allocatedCents:37500,refundedCents:12500,unappliedCents:0});expect(r.summary.totalCollectedCents).toBe(37500);const filtered=await request(app).get('/api/customers/'+customer+'/transactions?type=refund');expect(filtered.body.rows).toHaveLength(1);expect(filtered.body.rows[0].receipt.refundedCents).toBe(12500);
 await payment((await invoice('VOID')).id,10000,{status:'voided'});await payment((await invoice('REFUND')).id,1000,{status:'refunded'});r=await read();expect(r.rows.some(r=>r.status==='voided')).toBe(true);expect(r.summary.totalCollectedCents).toBe(36500);
});
test('Stripe batch and standalone settled Stripe payments are financial history; pending attempts are not',async()=>{const b=await batch(10000,{provider:'stripe',stripePaymentIntentId:'pi_'+randomUUID(),method:'credit_card'});await payment((await invoice('STRIPE')).id,10000,{customerPaymentBatchId:b.id,provider:'stripe',method:'credit_card'});await payment((await invoice('PENDING')).id,5000,{provider:'stripe',status:'pending',paidAt:null});const single=await payment((await invoice('SINGLE-STRIPE')).id,3000,{provider:'stripe',method:'credit_card',stripePaymentIntentId:'pi_'+randomUUID()});const r=await read();expect(r.rows).toHaveLength(2);expect(r.rows.find(row=>row.batchId===b.id)?.reference).toBe(b.reference);expect(r.rows.find(row=>row.paymentId===single.id)?.provider).toBe('stripe');expect(r.summary.totalCollectedCents).toBe(13000);});
test('matching historical dates, amounts, references and notes do not invent a common receipt',async()=>{const a=await invoice('OLD-A'),b=await invoice('OLD-B');await payment(a.id,20000,{metadata:{reference:'same-reference'}});await payment(b.id,20000,{metadata:{reference:'same-reference'}});const r=await read();expect(r.rows).toHaveLength(2);expect(r.rows.every(r=>r.batchId===null)).toBe(true);expect(r.summary.totalCollectedCents).toBe(40000);});
test('customer and tenant mismatches are never grouped or exposed through another customer',async()=>{const b=await batch(),other=(await db.insert(customers).values({organizationId:org,companyName:'Other Customer'}).returning())[0];await payment((await invoice('WRONG-OWNER',other.id)).id,50000,{customerPaymentBatchId:b.id});expect((await read()).rows).toHaveLength(0);const separate=await read({customerId:other.id});expect(separate.rows).toHaveLength(1);expect(separate.rows[0].batchId).toBeNull();expect(separate.rows[0].linkageWarning).toContain('could not be verified');const foreign=await read({organizationId:randomUUID(),customerId:other.id});expect(foreign.rows).toHaveLength(0);});
test('customer advances are received once; their later applications and reversals do not add receipts',async()=>{
 const advance=(await db.insert(customerAccountCredits).values({organizationId:org,customerId:customer,sourceType:'customer_advance',originalAmountCents:50000,receivedMethod:'other',receivedAt:date,reference:'Advance-CashApp',idempotencyKey:randomUUID()}).returning())[0];
 const ab=(await db.insert(customerAccountCreditApplicationBatches).values({organizationId:org,customerId:customer,allocationMode:'custom',idempotencyKey:randomUUID(),appliedAt:date}).returning())[0];
 const i=await invoice('ADVANCE-INV');const a=(await db.insert(customerAccountCreditApplications).values({organizationId:org,customerId:customer,customerAccountCreditId:advance.id,applicationBatchId:ab.id,invoiceId:i.id,amountCents:20000,appliedAt:date}).returning())[0];await payment(i.id,20000,{customerAccountCreditApplicationId:a.id,provider:'customer_credit'});
 let r=await read();expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({creditId:advance.id,amountCents:50000,allocatedCents:20000,unappliedCents:30000});expect(r.summary.totalCollectedCents).toBe(50000);
 const response=await request(app).get('/api/customers/'+customer+'/transactions');expect(response.body.rows.filter((r:any)=>r.type==='payment'||r.type==='credit')).toHaveLength(1);
 await db.update(payments).set({status:'canceled'}).where(eq(payments.customerAccountCreditApplicationId,a.id));await db.update(customerAccountCreditApplications).set({status:'reversed'}).where(eq(customerAccountCreditApplications.id,a.id));r=await read();expect(r.rows[0].unappliedCents).toBe(50000);expect(r.rows[0].allocations[0].status).toBe('canceled');expect(r.summary.totalCollectedCents).toBe(50000);
});
test('organization date/method filters and stable receipt sorting are preserved',async()=>{await grouped();expect((await listPaymentReceipts({organizationId:org,datePreset:'custom',dateFrom:'2026-06-15',dateTo:'2026-06-15',method:'other',sortBy:'amount'})).rows).toHaveLength(1);expect((await listPaymentReceipts({organizationId:org,datePreset:'custom',dateFrom:'2026-06-16',dateTo:'2026-06-16'})).rows).toHaveLength(0);expect((await read({method:'cash'})).rows).toHaveLength(0);});


test('audited tendered amount and returned change are distinct from unapplied funds',async()=>{
 const b=await batch(40000);await payment((await invoice('CHANGE')).id,40000,{customerPaymentBatchId:b.id});
 await db.insert(auditLogs).values({organizationId:org,userId:actor,entityType:'customer_payment_batch',entityId:b.id,actionType:'customer_payment_allocated',description:'Synthetic tendered money audit',newValues:{amountCents:40000,tenderedAmountCents:50000,changeDueCents:10000}});
 const r=await read();expect(r.rows[0]).toMatchObject({amountCents:50000,retainedCents:40000,allocatedCents:40000,unappliedCents:0});expect(r.summary.totalCollectedCents).toBe(40000);
});
test('invalid audited tender values cannot rewrite the original receipt or break history',async()=>{
 const b=await batch();await db.insert(auditLogs).values({organizationId:org,userId:actor,entityType:'customer_payment_batch',entityId:b.id,actionType:'customer_payment_allocated',description:'Synthetic tendered money audit',newValues:{amountCents:50000,tenderedAmountCents:'not a number',changeDueCents:0}});
 expect((await read()).rows[0].amountCents).toBe(50000);
});


test('foreign-tenant allocation linkage fails closed without exposing another tenant invoice',async()=>{
 const b=await batch();const foreign=(await db.insert(organizations).values({name:'Synthetic foreign payment tenant',slug:'foreign-receipt-'+randomUUID()}).returning())[0];orgs.push(foreign.id);
 const owner=(await db.insert(customers).values({organizationId:foreign.id,companyName:'Foreign receipt customer'}).returning())[0];const inv=await invoice('FOREIGN-PRIVATE-INVOICE',owner.id,foreign.id);
 await payment(inv.id,50000,{organizationId:foreign.id,customerPaymentBatchId:b.id});
 expect((await read()).rows).toEqual([]);
 const other=await read({organizationId:foreign.id,customerId:owner.id});expect(other.rows).toHaveLength(1);expect(other.rows[0].batchId).toBeNull();expect(other.rows[0].reference).not.toBe(b.reference);expect(other.rows[0].allocations[0].invoiceId).toBe(inv.id);
 const response=await request(app).get('/api/customers/'+owner.id+'/transactions');expect(response.status).toBe(404);
 const global = await request(app).get('/api/payments').set('X-Organization-Id', foreign.id);
 expect(global.status).toBe(200);
 expect(global.body.data.rows).toEqual([]);
 for (const id of [inv.id, randomUUID()]) {
  const history = await request(app).get('/api/invoices/' + id + '/payments').set('X-Organization-Id', foreign.id);
  expect(history.status).toBe(404);
  expect(history.body).toEqual({ error: 'Invoice not found' });
 }
});
