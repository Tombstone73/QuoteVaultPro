import { beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db } from '../db';
import { auditLogs, customerContactLinks, customerContacts, customerPortalAccess, customers, invoices, organizations, payments, userOrganizations, users } from '@shared/schema';
import { safeTestDatabaseUrl } from './helpers/safeTestDatabase';

const testUrl = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!testUrl || testUrl !== process.env.DATABASE_URL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(testUrl).hostname)) throw new Error('Disposable loopback PostgreSQL required.');

const runtime = jest.fn<(...args: unknown[]) => Promise<any>>();
jest.unstable_mockModule('../services/stripeRuntimeConfig.service', () => ({ resolveStripeRuntimeConfig: runtime }));
const { portalContext } = await import('../tenantContext');
const { registerDeveloperPortalImpersonationRoutes } = await import('../routes/developerPortalImpersonation.routes');
const { registerPortalRoutes } = await import('../routes/portal.routes');

const ids = { org: randomUUID(), otherOrg: randomUUID(), developer: randomUUID(), admin: randomUUID(), portalUser: randomUUID(), viewerUser: randomUUID(), customer: randomUUID(), otherCustomer: randomUUID(), contact: randomUUID(), viewerContact: randomUUID(), access: randomUUID(), viewerAccess: randomUUID(), invoice: randomUUID() };
let actorId = ids.developer;
let organizationId = ids.org;
let sessionState: Record<string, any>;

beforeAll(async () => {
  await db.insert(organizations).values([{ id: ids.org, name: 'Synthetic impersonation tenant', slug: ids.org }, { id: ids.otherOrg, name: 'Other tenant', slug: ids.otherOrg }]);
  await db.insert(users).values([
    { id: ids.developer, accountType: 'INTERNAL_USER', role: 'employee', isPlatformDeveloper: true },
    { id: ids.admin, accountType: 'INTERNAL_USER', role: 'admin', isPlatformAdmin: true },
    { id: ids.portalUser, accountType: 'PORTAL_CUSTOMER', role: 'customer', email: `${ids.portalUser}@example.invalid` },
    { id: ids.viewerUser, accountType: 'PORTAL_CUSTOMER', role: 'customer', email: `${ids.viewerUser}@example.invalid` },
  ]);
  await db.insert(userOrganizations).values([
    { userId: ids.developer, organizationId: ids.org, role: 'member' },
    { userId: ids.admin, organizationId: ids.org, role: 'admin' },
  ]);
  await db.insert(customers).values([{ id: ids.customer, organizationId: ids.org, companyName: 'Synthetic Anomaly Promotional' }, { id: ids.otherCustomer, organizationId: ids.otherOrg, companyName: 'Other Customer' }]);
  await db.insert(customerContacts).values([
    { id: ids.contact, organizationId: ids.org, customerId: ids.customer, firstName: 'Bill', lastName: 'Buyer', email: `${ids.portalUser}@example.invalid` },
    { id: ids.viewerContact, organizationId: ids.org, customerId: ids.customer, firstName: 'Vera', lastName: 'Viewer', email: `${ids.viewerUser}@example.invalid` },
  ]);
  await db.insert(customerContactLinks).values([
    { organizationId: ids.org, customerId: ids.customer, contactId: ids.contact, status: 'active' },
    { organizationId: ids.org, customerId: ids.customer, contactId: ids.viewerContact, status: 'active' },
  ]);
  await db.insert(customerPortalAccess).values([
    { id: ids.access, organizationId: ids.org, customerId: ids.customer, contactId: ids.contact, userId: ids.portalUser, email: `${ids.portalUser}@example.invalid`, status: 'ACTIVE', accessRole: 'BILLING' },
    { id: ids.viewerAccess, organizationId: ids.org, customerId: ids.customer, contactId: ids.viewerContact, userId: ids.viewerUser, email: `${ids.viewerUser}@example.invalid`, status: 'ACTIVE', accessRole: 'VIEWER' },
  ]);
  await db.insert(invoices).values({ id: ids.invoice, organizationId: ids.org, customerId: ids.customer, invoiceNumber: 20972, createdByUserId: ids.developer, status: 'billed', customerReleasedAt: new Date(), subtotal: '125.70', tax: '0.00', total: '125.70', subtotalCents: 12570, taxCents: 0, totalCents: 12570 });
});

beforeEach(async () => {
  actorId = ids.developer;
  organizationId = ids.org;
  sessionState = { save: (callback: (error?: Error) => void) => callback() };
  runtime.mockReset().mockResolvedValue({ ok: true, data: { provider: 'stripe', readyForPayments: true, connectedAccountId: 'acct_synthetic' } });
  await db.update(customerPortalAccess).set({ status: 'ACTIVE', accessRole: 'BILLING' }).where(eq(customerPortalAccess.id, ids.access));
  await db.update(customerContacts).set({ status: 'active' }).where(eq(customerContacts.id, ids.contact));
});

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: actorId, accountType: actorId === ids.portalUser ? 'PORTAL_CUSTOMER' : 'INTERNAL_USER', role: actorId === ids.portalUser ? 'customer' : 'employee' } as any;
    req.session = sessionState as any;
    req.isAuthenticated = () => true;
    next();
  });
  const middleware = {
    isAuthenticated: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.organizationId = organizationId; next(); },
  };
  registerDeveloperPortalImpersonationRoutes(server, middleware);
  registerPortalRoutes(server, { ...middleware, portalContext });
  server.post('/api/portal/proof/fake/action', (_req, res) => res.json({ mutated: true }));
  server.post('/api/guest/invoices/fake/payments/stripe/create-intent', (_req, res) => res.json({ mutated: true }));
  return server;
}

async function start(server: ReturnType<typeof app>, accessId = ids.access, customerId = ids.customer) {
  return request(server).post('/api/portal/impersonation/start').send({ accessId, customerId, returnTo: `/customers/${ids.customer}` });
}

test('exact active portal identity uses its current role, preserves staff session, and reports actual customer payment eligibility', async () => {
  const server = app();
  expect((await start(server)).status).toBe(200);
  const session = await request(server).get('/api/portal/me');
  expect(session.status).toBe(200);
  expect(session.body.data).toMatchObject({ userId: ids.portalUser, customerId: ids.customer, staffPreview: null, permissions: { canPayInvoices: true }, developerImpersonation: { accessId: ids.access, contactName: 'Bill Buyer', role: 'BILLING', readOnly: true } });
  expect(actorId).toBe(ids.developer);
  expect((await request(server).get('/api/portal/me')).body.data.userId).toBe(ids.portalUser);
  const invoice = await request(server).get(`/api/portal/invoices/${ids.invoice}`);
  expect(invoice.status).toBe(200);
  expect(invoice.body.data.paymentEligibility).toMatchObject({ payable: true });
  const diagnostic = await request(server).get(`/api/portal/invoices/${ids.invoice}/impersonation-diagnostics`);
  expect(diagnostic.status).toBe(200);
  expect(diagnostic.body.data).toMatchObject({ portalAccessId: ids.access, portalRole: 'BILLING', customerCanPayInvoices: true, customerCheckoutEligible: true, developerMayInitiatePayment: false });
  expect(await db.select().from(payments).where(eq(payments.invoiceId, ids.invoice))).toEqual([]);
  const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, ids.access), eq(auditLogs.actionType, 'DEVELOPER_PORTAL_IMPERSONATION_STARTED'))).limit(1);
  expect(audit.userId).toBe(ids.developer);
  expect(JSON.stringify(audit.newValues)).not.toContain('token');
});

test('a second contact at the same company is never substituted for the selected login', async () => {
  const server = app();
  expect((await start(server, ids.viewerAccess)).status).toBe(200);
  const session = await request(server).get('/api/portal/me');
  expect(session.body.data).toMatchObject({ userId: ids.viewerUser, customerId: ids.customer, permissions: { canPayInvoices: false }, developerImpersonation: { accessId: ids.viewerAccess, contactName: 'Vera Viewer', role: 'VIEWER' } });
  expect((await request(server).post('/api/portal/impersonation/start').send({ customerId: ids.customer, accessId: ids.access })).status).toBe(403);
  expect((await request(server).get('/api/portal/me')).body.data.userId).toBe(ids.viewerUser);
});

test('server blocks direct payment, proof, guest checkout and portal-access mutations before handlers run', async () => {
  const server = app();
  expect((await start(server)).status).toBe(200);
  for (const path of [
    `/api/portal/invoices/${ids.invoice}/payments/stripe/create-intent`,
    '/api/portal/proofs/fake/approve',
    '/api/portal/proof/fake/action',
    '/api/guest/invoices/fake/payments/stripe/create-intent',
    `/api/customer-portal-access/${ids.access}/suspend`,
  ]) {
    const response = await request(server).post(path).send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('IMPERSONATION_READ_ONLY');
  }
  const events = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, ids.access), eq(auditLogs.actionType, 'DEVELOPER_PORTAL_IMPERSONATION_MUTATION_BLOCKED')));
  expect(events.length).toBeGreaterThanOrEqual(5);
  expect(events.every(event => !JSON.stringify(event.newValues).includes('fake'))).toBe(true);
  expect(await db.select().from(payments).where(eq(payments.invoiceId, ids.invoice))).toEqual([]);
});

test('Developer authority, tenant, exact customer and account activation are required', async () => {
  const server = app();
  actorId = ids.admin;
  expect((await start(server)).status).toBe(403);
  const [deniedAudit] = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, ids.admin), eq(auditLogs.actionType, 'DEVELOPER_PORTAL_IMPERSONATION_DENIED'))).limit(1);
  expect(deniedAudit.newValues).toEqual({ reason: 'DEVELOPER_ACCESS_REQUIRED' });
  actorId = ids.portalUser;
  expect((await start(server)).status).toBe(403);
  actorId = ids.developer;
  expect((await start(server, ids.viewerAccess, ids.otherCustomer)).status).toBe(403);
  organizationId = ids.otherOrg;
  expect((await start(server)).status).toBe(403);
  organizationId = ids.org;
  await db.update(customerPortalAccess).set({ status: 'PENDING_INVITE' }).where(eq(customerPortalAccess.id, ids.access));
  expect((await start(server)).status).toBe(403);
  await db.update(customerPortalAccess).set({ status: 'ACTIVE' }).where(eq(customerPortalAccess.id, ids.access));
  await db.update(customerContacts).set({ status: 'archived' }).where(eq(customerContacts.id, ids.contact));
  expect((await start(server)).status).toBe(403);
  expect(sessionState.developerPortalImpersonation).toBeUndefined();
});

test('role changes take effect on refresh, and exit or expiration cannot regain customer access', async () => {
  const server = app();
  expect((await start(server)).status).toBe(200);
  await db.update(customerPortalAccess).set({ accessRole: 'VIEWER' }).where(eq(customerPortalAccess.id, ids.access));
  expect((await request(server).get('/api/portal/me')).body.data.permissions.canPayInvoices).toBe(false);
  expect((await request(server).get(`/api/portal/invoices/${ids.invoice}`)).body.data.paymentEligibility.payable).toBe(false);
  const ended = await request(server).post('/api/portal/impersonation/end').send({});
  expect(ended.status).toBe(200);
  expect(ended.body.data.returnTo).toBe(`/customers/${ids.customer}`);
  expect(sessionState.developerPortalImpersonation).toBeUndefined();
  expect((await request(server).get('/api/portal/me')).status).toBe(403);
  expect((await request(server).post('/api/portal/impersonation/end').send({})).status).toBe(403);
  expect((await start(server)).status).toBe(200);
  sessionState.developerPortalImpersonation.expiresAt = new Date(Date.now() - 1000).toISOString();
  const expired = await request(server).get('/api/portal/me');
  expect(expired.status).toBe(403);
  expect(expired.body.code).toBe('IMPERSONATION_EXPIRED');
  expect(sessionState.developerPortalImpersonation).toBeUndefined();
  expect((await request(server).get('/api/portal/me')).status).toBe(403);
  const actions = (await db.select({ actionType: auditLogs.actionType }).from(auditLogs).where(eq(auditLogs.entityId, ids.access))).map(row => row.actionType);
  expect(actions).toContain('DEVELOPER_PORTAL_IMPERSONATION_ENDED');
  expect(actions).toContain('DEVELOPER_PORTAL_IMPERSONATION_EXPIRED');
});

test('a normal portal login remains separate from developer impersonation', async () => {
  actorId = ids.portalUser;
  const session = await request(app()).get('/api/portal/me');
  expect(session.status).toBe(200);
  expect(session.body.data.developerImpersonation).toBeNull();
  expect(session.body.data.userId).toBe(ids.portalUser);
});
