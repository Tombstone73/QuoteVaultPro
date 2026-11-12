import { beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db } from '../db';
import { auditLogs, customers, customerContacts, customerContactLinks, customerPortalAccess, organizations, users, userOrganizations } from '@shared/schema';
import { changeCustomerPortalRole, createCustomerPortalAccess, getActivePortalContext, resolveInvoiceEmailPortalDestination } from '../services/customerPortalAccessService';
import { portalRoleAllows } from '@shared/portalPermissions';
import { safeTestDatabaseUrl } from './helpers/safeTestDatabase';
import { registerCustomerRoutes } from '../routes/customers.routes';
import { registerCustomerRelationsRoutes } from '../routes/customerRelations.routes';
import { storage } from '../storage';

const url = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!url || url !== process.env.DATABASE_URL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Disposable loopback PostgreSQL required.');
const ids = { org: randomUUID(), otherOrg: randomUUID(), actor: randomUUID(), member: randomUUID(), portalUser: randomUUID(), customer: randomUUID(), contact: randomUUID(), access: randomUUID() };
beforeAll(async () => {
  await db.insert(organizations).values([{ id: ids.org, name: 'Synthetic portal roles', slug: ids.org }, { id: ids.otherOrg, name: 'Other tenant', slug: ids.otherOrg }]);
  await db.insert(users).values([{ id: ids.actor, role: 'admin' }, { id: ids.member, role: 'employee' }, { id: ids.portalUser, role: 'customer', accountType: 'PORTAL_CUSTOMER' }]);
  await db.insert(userOrganizations).values([{ userId: ids.actor, organizationId: ids.org, role: 'admin' }, { userId: ids.member, organizationId: ids.org, role: 'member' }]);
  await db.insert(customers).values({ id: ids.customer, organizationId: ids.org, companyName: 'Synthetic Customer' });
  await db.insert(customerContacts).values({ id: ids.contact, organizationId: ids.org, customerId: ids.customer, firstName: 'Synthetic', lastName: 'Billing', email: 'synthetic@example.invalid' });
  await db.insert(customerContactLinks).values({ organizationId: ids.org, customerId: ids.customer, contactId: ids.contact, isPrimary: true, isBilling: true });
  await db.insert(customerPortalAccess).values({ id: ids.access, organizationId: ids.org, customerId: ids.customer, contactId: ids.contact, userId: ids.portalUser, email: 'synthetic@example.invalid', status: 'ACTIVE', accessRole: 'VIEWER' });
});
const change = (patch: Record<string, unknown> = {}) => changeCustomerPortalRole({ organizationId: ids.org, customerId: ids.customer, accessId: ids.access, actorUserId: ids.actor, expectedRole: 'VIEWER', role: 'BILLING', ...patch } as any);

test('role change persists atomically with audit, refreshes active requests, and leaves notification flags alone', async () => {
  const before = await db.select().from(customerContactLinks).where(eq(customerContactLinks.contactId, ids.contact));
  expect(portalRoleAllows((await getActivePortalContext(ids.portalUser))!.access.accessRole, 'payment')).toBe(false);
  await change();
  expect(portalRoleAllows((await getActivePortalContext(ids.portalUser))!.access.accessRole, 'payment')).toBe(true);
  const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, ids.access), eq(auditLogs.actionType, 'PORTAL_ACCESS_ROLE_CHANGED')));
  expect(audit.userId).toBe(ids.actor);
  expect(audit.oldValues).toMatchObject({ accessRole: 'VIEWER' });
  expect(audit.newValues).toMatchObject({ customerId: ids.customer, previousRole: 'VIEWER', newRole: 'BILLING' });
  expect(audit.createdAt).toBeTruthy();
  expect(await db.select().from(customerContactLinks).where(eq(customerContactLinks.contactId, ids.contact))).toEqual(before);
  await expect(change()).rejects.toMatchObject({ status: 409 });
});

test('unauthorized, portal, cross-tenant/customer, and invalid role changes fail closed', async () => {
  await expect(change({ actorUserId: ids.member })).rejects.toMatchObject({ status: 403 });
  await expect(change({ actorUserId: ids.portalUser })).rejects.toMatchObject({ status: 403 });
  await expect(change({ organizationId: ids.otherOrg })).rejects.toMatchObject({ status: 403 });
  await expect(change({ customerId: randomUUID() })).rejects.toMatchObject({ status: 404 });
  await expect(change({ role: 'SUPER_ADMIN' })).rejects.toMatchObject({ status: 400 });
  expect((await getActivePortalContext(ids.portalUser))!.access.accessRole).toBe('BILLING');
});

const app = (organizationId = ids.org, role = 'admin') => {
  const app = express();
  app.use(express.json());
  const middleware = {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { user: { id: role === 'admin' ? ids.actor : ids.member } }); next();
    },
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { organizationId, orgRole: role }); next();
    },
    isAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
  registerCustomerRoutes(app, middleware);
  registerCustomerRelationsRoutes(app, middleware);
  return app;
};
const contactData = () => ({ firstName: 'Default', lastName: 'Fixture', email: `${randomUUID()}@example.invalid` });
const company = async (organizationId = ids.org) => (await db.insert(customers).values({ organizationId, companyName: `Synthetic ${randomUUID()}` }).returning())[0];
const linkRoles = async (customerId: string) => (await db.select().from(customerContactLinks).where(eq(customerContactLinks.customerId, customerId)))
  .map(row => [row.contactId, row.portalAccessRole] as const);
const grant = (customerId: string, contactId: string, organizationId = ids.org) => createCustomerPortalAccess({ organizationId, customerId, contactId, actorUserId: ids.actor, sendEmail: false });

test('company detail and Contacts assign Admin, Buyer, Buyer using pending and unprovisioned contacts', async () => {
  const customer = await company();
  const http = request(app());
  const path = `/api/customers/${customer.id}/contacts`;
  const first = await http.post(path).send(contactData());
  expect(first.status).toBe(200);
  expect(await db.select().from(customerPortalAccess).where(eq(customerPortalAccess.customerId, customer.id))).toEqual([]);
  expect((await grant(customer.id, first.body.id))).toMatchObject({ accessRole: 'COMPANY_ADMIN', status: 'PENDING_INVITE' });
  const second = await http.post('/api/contacts').send({ ...contactData(), customerId: customer.id });
  const third = await http.post(path).send(contactData());
  expect([second.status, third.status]).toEqual([200, 200]);
  expect(new Map(await linkRoles(customer.id))).toEqual(new Map([[first.body.id, 'COMPANY_ADMIN'], [second.body.id, 'BUYER'], [third.body.id, 'BUYER']]));
  expect((await grant(customer.id, third.body.id)).accessRole).toBe('BUYER');
  expect((await grant(customer.id, first.body.id)).accessRole).toBe('COMPANY_ADMIN');
});

test.each(['COMPANY_ADMIN', 'VIEWER', 'BUYER'] as const)('preserves explicit %s for later provisioning', async role => {
  const customer = await company();
  const http = request(app());
  if (role === 'COMPANY_ADMIN') await http.post(`/api/customers/${customer.id}/contacts`).send(contactData());
  const contact = await http.post(`/api/customers/${customer.id}/contacts`).send({ ...contactData(), portalAccessRole: role });
  expect(contact.status).toBe(200);
  expect((await grant(customer.id, contact.body.id)).accessRole).toBe(role);
});

test('customer onboarding stores an explicit role, and unlinked Contacts create neither a link nor access', async () => {
  const http = request(app());
  const created = await http.post('/api/customers').send({ companyName: `New ${randomUUID()}`, primaryContact: { ...contactData(), portalAccessRole: 'VIEWER' } });
  expect(created.status).toBe(200);
  const [[primaryId, role]] = await linkRoles(created.body.id);
  expect(role).toBe('VIEWER');
  expect(await db.select().from(customerPortalAccess).where(eq(customerPortalAccess.contactId, primaryId))).toEqual([]);
  const standalone = await http.post('/api/contacts').send(contactData());
  expect(standalone.status).toBe(200);
  expect(await db.select().from(customerContactLinks).where(eq(customerContactLinks.contactId, standalone.body.id))).toEqual([]);
  expect(await db.select().from(customerPortalAccess).where(eq(customerPortalAccess.contactId, standalone.body.id))).toEqual([]);
});

test('concurrent additions through the route and shared repository produce exactly one first-contact role', async () => {
  const customer = await company();
  const [viaRoute, viaRepo] = await Promise.all([
    request(app()).post(`/api/customers/${customer.id}/contacts`).send(contactData()),
    storage.createCustomerContactForOrganization(ids.org, customer.id, contactData()),
  ]);
  expect(viaRoute.status).toBe(200);
  const saved = new Map(await linkRoles(customer.id));
  expect([saved.get(viaRoute.body.id), saved.get(viaRepo.id)].sort()).toEqual(['BUYER', 'COMPANY_ADMIN']);
  const later = await grant(customer.id, saved.get(viaRepo.id) === 'COMPANY_ADMIN' ? viaRepo.id : viaRoute.body.id);
  expect(later.accessRole).toBe('COMPANY_ADMIN');
});

test('raw import links count existing contacts and cannot borrow the first-contact default across companies', async () => {
  const first = await company();
  const second = await company();
  const foreign = await company(ids.otherOrg);
  const [contact] = await db.insert(customerContacts).values({ ...contactData(), organizationId: ids.org, customerId: null }).returning();
  await db.insert(customerContactLinks).values({ organizationId: ids.org, customerId: first.id, contactId: contact.id });
  expect(await linkRoles(first.id)).toEqual([[contact.id, 'COMPANY_ADMIN']]);
  const http = request(app());
  const localFirst = await http.post(`/api/customers/${second.id}/contacts`).send(contactData());
  expect(await linkRoles(second.id)).toEqual([[localFirst.body.id, 'COMPANY_ADMIN']]);
  expect((await http.post(`/api/customers/${foreign.id}/contacts`).send(contactData())).status).toBe(404);
  expect((await request(app(ids.org, 'member')).post(`/api/customers/${second.id}/contacts`).send({ ...contactData(), portalAccessRole: 'COMPANY_ADMIN' })).status).toBe(403);
  await expect(grant(second.id, contact.id)).rejects.toMatchObject({ status: 404 });
  await expect(grant(first.id, contact.id, ids.otherOrg)).rejects.toMatchObject({ status: 404 });
  expect((await grant(first.id, contact.id)).accessRole).toBe('COMPANY_ADMIN');
});

test('legacy links resolve by current count and provisioning preserves the role of an existing invitation', async () => {
  const customer = await company();
  const a = await storage.createCustomerContactForOrganization(ids.org, customer.id, contactData());
  await db.update(customerContactLinks).set({ portalAccessRole: null }).where(eq(customerContactLinks.contactId, a.id));
  expect((await grant(customer.id, a.id)).accessRole).toBe('COMPANY_ADMIN');
  const b = await storage.createCustomerContactForOrganization(ids.org, customer.id, contactData());
  await db.update(customerContactLinks).set({ portalAccessRole: null }).where(eq(customerContactLinks.contactId, b.id));
  expect((await grant(customer.id, b.id)).accessRole).toBe('BUYER');
  const refreshed = await createCustomerPortalAccess({ organizationId: ids.org, customerId: customer.id, contactId: a.id, accessRole: 'VIEWER', sendEmail: false });
  expect(refreshed.accessRole).toBe('COMPANY_ADMIN');
});

test('invoice portal setup honors a saved explicit role and leaves existing company access scoped', async () => {
  const customer = await company();
  const fields = contactData();
  const contact = await storage.createCustomerContactForOrganization(ids.org, customer.id, fields, { portalAccessRole: 'VIEWER' });
  const other = await company();
  await storage.createCustomerContactLinkForOrganization(ids.org, other.id, contact.id);
  const resolve = (customerId: string) => resolveInvoiceEmailPortalDestination({ organizationId: ids.org, customerId, recipientEmail: fields.email, actorUserId: ids.actor });
  expect((await resolve(customer.id))?.kind).toBe('setup');
  expect(await resolve(other.id)).toBeNull();
  const accesses = await db.select().from(customerPortalAccess).where(eq(customerPortalAccess.contactId, contact.id));
  expect(accesses).toHaveLength(1);
  expect(accesses[0]).toMatchObject({ customerId: customer.id, accessRole: 'VIEWER', status: 'PENDING_INVITE' });
});
