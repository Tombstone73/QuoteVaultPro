import { afterAll, afterEach, beforeEach, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { customers, auditLogs, organizations, users, userOrganizations } from '../../shared/schema';
import { mapQBCustomerToLocal } from '../lib/quickbooksCustomerMapping';
import { assessQuickBooksCustomerStates } from '../lib/quickbooksCustomerStateAssessment';
import { customerStateAssessmentColumns, repairQuickBooksCustomerStates } from '../services/quickbooksCustomerStateRepair';

const source = [{ Id: 'qb-test-1', Active: true,
  BillAddr: { Line1: '123 Synthetic Way', City: 'Testville', PostalCode: '46201', Country: 'US', CountrySubDivisionCode: 'IN' },
  ShipAddr: { Line1: '456 Synthetic Lane', City: 'Toronto', PostalCode: 'M5V 1A1', Country: 'CA', CountrySubDivisionCode: 'ON' },
}];
const secondPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, application_name: 'qb-state-test-holder' });
let org: string, otherOrg: string, actor: string, customerId: string;
beforeEach(async () => {
  org = `qb-state-test-${randomUUID()}`; otherOrg = `qb-state-test-${randomUUID()}`; actor = randomUUID(); customerId = randomUUID();
  await db.insert(organizations).values([{ id: org, name: 'Isolated state repair', slug: org }, { id: otherOrg, name: 'Other tenant', slug: otherOrg }]);
  await db.insert(users).values({ id: actor, role: 'admin', email: `${actor}@example.invalid` });
  await db.insert(userOrganizations).values({ userId: actor, organizationId: org, role: 'owner' });
  await db.insert(customers).values({ ...mapQBCustomerToLocal(source[0]), id: customerId, organizationId: org,
    companyName: 'Synthetic region recovery', status: 'active', billingState: null, shippingState: null, notes: 'Preserve staff notes' });
});
afterEach(async () => {
  await db.delete(organizations).where(eq(organizations.id, org));
  await db.delete(organizations).where(eq(organizations.id, otherOrg));
  await db.delete(users).where(eq(users.id, actor));
});
afterAll(async () => { await secondPool.end(); await pool.end(); });
async function current() { return db.select().from(customers).where(eq(customers.organizationId, org)); }
async function audits() { return db.select().from(auditLogs).where(eq(auditLogs.organizationId, org)); }
async function plan() {
  const rows = await db.select(customerStateAssessmentColumns).from(customers).where(eq(customers.organizationId, org));
  return assessQuickBooksCustomerStates(org, rows, source);
}
const apply = async (reviewedPlan: unknown, overrides: Partial<Parameters<typeof repairQuickBooksCustomerStates>[1]> = {}) =>
  repairQuickBooksCustomerStates(db, { organizationId: org, actorUserId: actor, reviewedPlan, source, expectedFields: 2, apply: true, ...overrides });

test('default preview is database-enforced read-only and has no customer/audit writes', async () => {
  const before = await current();
  const result = await apply(await plan(), { apply: false });
  expect(result).toMatchObject({ mode: 'DRY_RUN_READ_ONLY', updatedFields: 0, eligibleFields: 2 });
  expect(await current()).toEqual(before); expect(await audits()).toEqual([]);
});

test('verified states persist independently, preserve all other fields and IDs, and audit each change', async () => {
  const before = (await current())[0]; const result = await apply(await plan());
  const saved = (await current())[0];
  expect(result).toMatchObject({ updatedFields: 2, alreadyPresentFields: 0 });
  expect(result.readback).toEqual([{ customerId, field: 'billingState', value: 'IN' }, { customerId, field: 'shippingState', value: 'ON' }]);
  expect(saved).toMatchObject({ billingState: 'IN', shippingState: 'ON', externalAccountingId: 'qb-test-1', notes: 'Preserve staff notes' });
  const { billingState: _b, shippingState: _s, updatedAt: _u, ...original } = before;
  const { billingState: _bb, shippingState: _ss, updatedAt: _uu, ...persisted } = saved;
  expect(persisted).toEqual(original);
  expect(await audits()).toHaveLength(2);
});

test('idempotent replay writes nothing and does not duplicate history', async () => {
  const reviewed = await plan(); await apply(reviewed); const saved = await current();
  expect(await apply(reviewed)).toMatchObject({ updatedFields: 0, alreadyPresentFields: 2 });
  expect(await current()).toEqual(saved); expect(await audits()).toHaveLength(2);
  expect((await plan()).counts.proposedStateFields).toBe(0);
});

test.each<['billingState' | 'billingStreet1' | 'externalAccountingId', string, string]>([
  ['billingState', 'TX', 'STATE_ALREADY_SET'], ['billingStreet1', '999 Staff correction', 'STALE_PLAN'],
  ['externalAccountingId', 'changed-source', 'LINKAGE_CHANGED'],
])('preserves concurrent staff %s changes and rolls back the whole plan', async (field, value, error) => {
  const reviewed = await plan(); await db.update(customers).set({ [field]: value }).where(eq(customers.id, customerId));
  const before = await current();
  await expect(apply(reviewed)).rejects.toMatchObject({ code: `QB_STATE_REPAIR_${error}` });
  expect(await current()).toEqual(before); expect(await audits()).toEqual([]);
});

test('new overrides and duplicate linkage fail closed', async () => {
  const reviewed = await plan();
  await db.update(customers).set({ qbFieldOverrides: { billingState: true } }).where(eq(customers.id, customerId));
  await expect(apply(reviewed)).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_STALE_PLAN' });
  await db.update(customers).set({ qbFieldOverrides: null }).where(eq(customers.id, customerId));
  await db.insert(customers).values({ id: randomUUID(), organizationId: org, companyName: 'Duplicate source link', externalAccountingId: 'qb-test-1' });
  await expect(apply(reviewed)).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_STALE_PLAN' });
  expect((await current())[0].billingState).toBeNull(); expect(await audits()).toEqual([]);
});

test('fresh source change on the second address rolls back an earlier field update and its audit entry', async () => {
  const reviewed = await plan(); const before = await current();
  const changed = [{ ...source[0], ShipAddr: { ...source[0].ShipAddr, CountrySubDivisionCode: 'QC' } }];
  await expect(apply(reviewed, { source: changed })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_STALE_PLAN' });
  expect(await current()).toEqual(before); expect(await audits()).toEqual([]);
});

test('tenant scope, actor membership and reviewed counts cannot be bypassed', async () => {
  await db.insert(customers).values({ id: randomUUID(), organizationId: otherOrg, companyName: 'Other tenant same source ID', externalAccountingId: 'qb-test-1' });
  const reviewed = await plan();
  await expect(apply(reviewed, { organizationId: otherOrg })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_TENANT_MISMATCH' });
  await expect(apply(reviewed, { expectedFields: 1 })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_COUNT_MISMATCH' });
  await db.update(userOrganizations).set({ role: 'member' }).where(and(eq(userOrganizations.organizationId, org), eq(userOrganizations.userId, actor)));
  await expect(apply(reviewed)).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_ACTOR_FORBIDDEN' });
  expect((await current())[0].billingState).toBeNull(); expect(await audits()).toEqual([]);
  expect((await db.select().from(customers).where(eq(customers.organizationId, otherOrg)))[0].billingState).toBeNull();
});

test('an actual concurrent row edit is retained after the repair waits on PostgreSQL locking', async () => {
  const reviewed = await plan(); const holder = await secondPool.connect();
  let pending: ReturnType<typeof apply> | undefined;
  try {
    await holder.query('begin');
    await holder.query('update customers set billing_state = $1 where id = $2 and organization_id = $3', ['TX', customerId, org]);
    pending = apply(reviewed);
    const outcome = pending.then(() => null, error => error);
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const wait = await secondPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%for update%' and pid<>pg_backend_pid()");
      if (wait.rowCount) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    await holder.query('commit');
    const failure = await outcome;
    expect(failure?.cause?.code ?? failure?.code).toBe('40001');
    expect((await current())[0]).toMatchObject({ billingState: 'TX', shippingState: null });
    expect(await audits()).toEqual([]);
  } finally { await holder.query('rollback'); holder.release(); if (pending) await pending.catch(() => {}); }
});
