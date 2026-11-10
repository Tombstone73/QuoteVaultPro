import { beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customers, customerContacts, customerContactLinks, customerPortalAccess, organizations, users, userOrganizations } from '@shared/schema';
import { changeCustomerPortalRole, createCustomerPortalAccess, getActivePortalContext } from '../services/customerPortalAccessService';
import { portalRoleAllows } from '@shared/portalPermissions';
import { safeTestDatabaseUrl } from './helpers/safeTestDatabase';

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

test('new primary billing defaults, secondary least privilege, explicit choices and existing identities', async () => {
  for (const fixture of [
    { primary: true, billing: true, explicit: undefined, expected: 'BILLING' },
    { primary: true, billing: false, explicit: undefined, expected: 'VIEWER' },
    { primary: false, billing: true, explicit: undefined, expected: 'VIEWER' },
    { primary: true, billing: true, explicit: 'VIEWER' as const, expected: 'VIEWER' },
  ]) {
    const [customer] = await db.insert(customers).values({ organizationId: ids.org, companyName: 'Synthetic Default' }).returning();
    const [contact] = await db.insert(customerContacts).values({ organizationId: ids.org, customerId: customer.id, firstName: 'Default', lastName: 'Fixture', email: `${randomUUID()}@example.invalid` }).returning();
    await db.insert(customerContactLinks).values({ organizationId: ids.org, customerId: customer.id, contactId: contact.id, isPrimary: fixture.primary, isBilling: fixture.billing });
    const input = { organizationId: ids.org, customerId: customer.id, contactId: contact.id, actorUserId: ids.actor, sendEmail: false };
    const access = await createCustomerPortalAccess({ ...input, accessRole: fixture.explicit });
    expect(access.accessRole).toBe(fixture.expected);
    await db.update(customerContactLinks).set({ isPrimary: true, isBilling: true }).where(eq(customerContactLinks.contactId, contact.id));
    expect((await createCustomerPortalAccess(input)).accessRole).toBe(fixture.expected);
  }
});
