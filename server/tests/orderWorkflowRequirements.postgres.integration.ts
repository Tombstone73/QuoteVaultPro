
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { organizations, users, customers, products, orders, orderLineItems, productionJobs, productionEvents, auditLogs, stations, prepressSessions, productionRuns, productionRunMembers, lineItemFiles } from '../../shared/schema';

jest.unstable_mockModule('sharp', () => ({ default: () => { throw new Error('Image processing is outside this test'); } }));
let organizationId = '', userId = '', customerId = '', productId = '';
let app: express.Express;
beforeAll(async () => {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({ name: 'Workflow test', slug: 'workflow-test-' + suffix, settings: { preferences: { proofing: { policy: 'manual_requested_only' } } } } as any).returning();
  organizationId = org.id;
  await db.insert(stations).values(['prepress', 'design', 'flatbed', 'roll'].map((key, index) => ({ id: randomUUID(), organizationId, key, name: key, sort: index, active: true })));
  const [user] = await db.insert(users).values({ email: 'workflow-' + suffix + '@example.test', firstName: 'Workflow', lastName: 'Test', role: 'admin' }).returning(); userId = user.id;
  const [customer] = await db.insert(customers).values({ organizationId, companyName: 'QA Workflow Customer', email: suffix + '@example.test', creditLimit: '100000', creditLimitConfiguredAt: new Date() }).returning(); customerId = customer.id;
  const [product] = await db.insert(products).values({ organizationId, name: 'QA Product', description: 'Synthetic', requiresProofApproval: true } as any).returning(); productId = product.id;
  app = express(); app.use(express.json());
  const pass = (req: any, _res: any, next: any) => { req.organizationId = organizationId; req.orgRole = req.headers['x-test-role'] || 'admin'; req.user = { id: userId }; next(); };
  const { registerOrderRoutes } = await import('../routes/orders.routes');
  await registerOrderRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdmin: pass, isAdminOrOwner: pass });
  const { registerPrepressQueueRoutes } = await import('../routes/prepress.routes');
  registerPrepressQueueRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdminOrOwner: pass, assertInternalUser: () => true });
}, 120000);
afterAll(async () => {
  if (organizationId) {
    await db.delete(productionRunMembers).where(eq(productionRunMembers.organizationId, organizationId));
    await db.delete(productionRuns).where(eq(productionRuns.organizationId, organizationId));
    await db.delete(lineItemFiles).where(eq(lineItemFiles.organizationId, organizationId));
    await db.delete(prepressSessions).where(eq(prepressSessions.organizationId, organizationId));
    await db.delete(productionEvents).where(eq(productionEvents.organizationId, organizationId));
    await db.delete(productionJobs).where(eq(productionJobs.organizationId, organizationId));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, organizationId));
    await db.delete(orders).where(eq(orders.organizationId, organizationId));
    await db.delete(products).where(eq(products.organizationId, organizationId));
    await db.delete(customers).where(eq(customers.organizationId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
});
async function fixture() {
  const [order] = await db.insert(orders).values({ organizationId, customerId, createdByUserId: userId, orderNumber: 'QA-' + randomUUID(), state: 'open' } as any).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId: order.id, productId, description: 'QA line', quantity: 1, unitPrice: '10', totalPrice: '10',
    workflowState: 'new', status: 'new', requiresDesign: false, requiresPrepress: false, requiresProofApproval: false } as any).returning();
  return { order, line };
}
async function patch(id: string, data: any) { return request(app).patch('/api/order-line-items/' + id).send(data); }
test('explicit proof request in manual policy persists and creates the canonical proofing obligation', async () => {
  const { order, line } = await fixture();
  const response = await patch(line.id, { requiresProofApproval: true, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(200); expect(response.body.requiresProofApproval).toBe(true);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresProofApproval).toBe(true); expect(saved.workflowState).toBe('awaiting_proof_approval');
  const readback = await request(app).get('/api/orders/' + order.id);
  expect(readback.status).toBe(200);
  expect(readback.body.lineItems.find((item: any) => item.id === line.id)?.requiresProofApproval).toBe(true);
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(jobs).toHaveLength(1); expect(jobs[0].stationKey).toBe('prepress');
  const { listProofingQueue } = await import('../services/proofingService');
  const queue = await listProofingQueue(db, { organizationId });
  expect(queue.rows.some((item: any) => item.lineItemId === line.id)).toBe(true);
  const replay = await patch(line.id, { requiresProofApproval: true, expectedUpdatedAt: saved.updatedAt.toISOString() });
  expect(replay.status).toBe(200);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toHaveLength(1);
});
test('adding independent proof requirement preserves physical ownership and closes the proof gate', async () => {
  const { order, line } = await fixture();
  const [job] = await db.insert(productionJobs).values({ organizationId, orderId: order.id, lineItemId: line.id, stationKey: 'flatbed', stepKey: 'queued', status: 'queued' }).returning();
  const response = await patch(line.id, { requiresProofApproval: true, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresProofApproval).toBe(true);
  const { resolveLineItemProofReleaseGate } = await import('../services/proofGateService');
  expect((await resolveLineItemProofReleaseGate(db, { organizationId, lineItemId: line.id })).allowed).toBe(false);
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(jobs).toHaveLength(1); expect(jobs[0].id).toBe(job.id); expect(jobs[0].status).toBe('queued');
});
test('concurrent editors cannot overwrite a newer line requirement', async () => {
  const { line } = await fixture(), version = line.updatedAt.toISOString();
  const responses = await Promise.all([
    patch(line.id, { requiresDesign: true, expectedUpdatedAt: version }),
    patch(line.id, { requiresPrepress: true, expectedUpdatedAt: version }),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect([saved.requiresDesign, saved.requiresPrepress].filter(Boolean)).toHaveLength(1);
});

test.each([
  ['requiresDesign', 'needs_design', 'design'],
  ['requiresPrepress', 'ready_for_prepress', 'prepress'],
] as const)('saving %s persists and assigns the expected stage', async (field, state, station) => {
  const { line } = await fixture();
  const response = await patch(line.id, { [field]: true, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved[field]).toBe(true); expect(saved.workflowState).toBe(state);
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(jobs).toHaveLength(1); expect(jobs[0].stationKey).toBe(station);
});
test('disabling proof is persisted on an ownerless line where allowed', async () => {
  const { line } = await fixture();
  await db.update(orderLineItems).set({ requiresProofApproval: true, requiresPrepress: true }).where(eq(orderLineItems.id, line.id));
  const [before] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  const response = await patch(line.id, { requiresProofApproval: false, expectedUpdatedAt: before.updatedAt.toISOString() });
  expect({ status: response.status, body: response.body }).toEqual(expect.objectContaining({ status: 200 }));
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresProofApproval).toBe(false);
});

test('editing Prepress preserves an omitted explicit Proof requirement in manual policy', async () => {
  const { line } = await fixture();
  await db.update(orderLineItems).set({ requiresProofApproval: true }).where(eq(orderLineItems.id, line.id));
  const [before] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  const response = await patch(line.id, { requiresPrepress: true, expectedUpdatedAt: before.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresProofApproval).toBe(true);
  expect(saved.requiresPrepress).toBe(true);
});

async function prepressFixture() {
  const { order, line } = await fixture();
  const response = await patch(line.id, { requiresPrepress: true, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(saved.workflowState).toBe('ready_for_prepress'); expect(job.stationKey).toBe('prepress');
  return { order, line: saved, job };
}

test('unstarted Prepress withdrawal atomically retires ownership, routes, leaves queue, and survives authoritative readback and replay', async () => {
  const { order, line, job } = await prepressFixture();
  const { resolvePrepressQueueEligibility } = await import('../services/prepressQueueEligibility');
  expect((await resolvePrepressQueueEligibility(db, { organizationId })).lineItemIds).toContain(line.id);
  const response = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect({ status: response.status, message: response.body.message }).toEqual({ status: 200, message: undefined });
  expect(response.body.requiresPrepress).toBe(false);
  expect(response.body.workflowState).toBe('ready_for_production');
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(jobs).toHaveLength(2);
  expect(jobs.find(j => j.id === job.id)).toMatchObject({ status: 'canceled', completedAt: null, startedAt: null, totalSeconds: 0 });
  const successor = jobs.find(j => j.id !== job.id)!;
  expect(successor).toMatchObject({ stationKey: 'roll', stepKey: 'queued', status: 'queued', completedAt: null });
  expect((await resolvePrepressQueueEligibility(db, { organizationId })).lineItemIds).not.toContain(line.id);
  const readback = await request(app).get('/api/orders/' + order.id);
  expect(readback.status).toBe(200);
  expect(readback.body.lineItems.find((item: any) => item.id === line.id)).toMatchObject({
    requiresPrepress: false, workflowState: 'ready_for_production', activeOwnerJobId: successor.id, activeOwnerStationKey: 'roll', activeOwnerStepKey: 'queued',
  });
  expect(response.body.withdrawalWorkflow).toMatchObject({ activeOwnerJobId: successor.id, toState: 'ready_for_production' });
  const eventsBefore = await db.select().from(productionEvents).where(eq(productionEvents.productionJobId, job.id));
  expect(eventsBefore.some(e => (e.payload as any)?.outcome === 'canceled')).toBe(true);
  expect(eventsBefore.some(e => e.type === 'complete')).toBe(false);
  const stale = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(stale.status).toBe(409);
  const replay = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: response.body.updatedAt });
  expect(replay.status).toBe(200);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toEqual(jobs);
  expect(await db.select().from(productionEvents).where(eq(productionEvents.productionJobId, job.id))).toEqual(eventsBefore);
  const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, line.id));
  const withdrawals = audits.filter(a => (a.newValues as any)?.eventType === 'prepress_requirement_withdrawn');
  expect(withdrawals).toHaveLength(1);
  expect(withdrawals[0].oldValues).toMatchObject({ job: { id: job.id, status: 'queued', completedAt: null } });
  expect(withdrawals[0].newValues).toMatchObject({ ownerOutcome: 'canceled', requiresPrepress: false });
});

test.each(['session', 'time', 'note', 'file', 'material', 'run', 'production', 'in_prepress'] as const)('%s activity blocks withdrawal and rolls back the requirement', async kind => {
  const { order, line, job } = await prepressFixture();
  if (kind === 'in_prepress') await db.update(orderLineItems).set({ workflowState: 'in_prepress' }).where(eq(orderLineItems.id, line.id));
  if (kind === 'session') await db.insert(prepressSessions).values({ organizationId, orderId: order.id, lineItemId: line.id, startedByUserId: userId, lockOwnerUserId: userId });
  if (kind === 'time') await db.update(productionJobs).set({ totalSeconds: 12, startedAt: new Date() }).where(eq(productionJobs.id, job.id));
  if (kind === 'note') await db.insert(productionEvents).values({ organizationId, productionJobId: job.id, type: 'note', payload: { note: 'Adjusted artwork' } });
  if (kind === 'file') await db.insert(lineItemFiles).values({ organizationId, orderId: order.id, lineItemId: line.id, role: 'final', storagePath: 'synthetic/final.pdf', originalFilename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1, createdByUserId: userId });
  if (kind === 'material') await db.update(orderLineItems).set({ specsJson: { materialOverrides: [{ op: 'ambiguous' }] } }).where(eq(orderLineItems.id, line.id));
  if (kind === 'run') {
    const [run] = await db.insert(productionRuns).values({ organizationId, orderId: order.id, runNumber: 1, stationKey: 'flatbed', status: 'draft' }).returning();
    await db.insert(productionRunMembers).values({ organizationId, productionRunId: run.id, productionJobId: job.id, orderLineItemId: line.id, allocatedQuantity: 1 });
  }
  if (kind === 'production') await db.update(productionJobs).set({ stationKey: 'flatbed', stepKey: 'queued' }).where(eq(productionJobs.id, job.id));
  const beforeJobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  const response = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect({ status: response.status, code: response.body.code }).toEqual({ status: 409, code: 'PREPRESS_WITHDRAWAL_BLOCKED' });
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresPrepress).toBe(true); expect(saved.workflowState).toBe(kind === 'in_prepress' ? 'in_prepress' : 'ready_for_prepress');
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toEqual(beforeJobs);
});

test('independent Proof requirement retains proof ownership without completing Prepress', async () => {
  const { line, job } = await prepressFixture();
  await db.update(orderLineItems).set({ requiresProofApproval: true }).where(eq(orderLineItems.id, line.id));
  const response = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ requiresPrepress: false, requiresProofApproval: true, workflowState: 'awaiting_proof_approval' });
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id));
  expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ id: job.id, status: 'queued', completedAt: null });
  const { resolvePrepressQueueEligibility } = await import('../services/prepressQueueEligibility');
  expect((await resolvePrepressQueueEligibility(db, { organizationId })).lineItemIds).not.toContain(line.id);
});

test('withdrawal and session start serialize: exactly one operation wins', async () => {
  const { line, job } = await prepressFixture();
  const results = await Promise.all([
    patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() }),
    request(app).post('/api/prepress/session/start').send({ lineItemId: line.id }),
  ]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  const sessions = await db.select().from(prepressSessions).where(eq(prepressSessions.lineItemId, line.id));
  const [prior] = await db.select().from(productionJobs).where(eq(productionJobs.id, job.id));
  if (results[0].status === 200) {
    expect(saved.requiresPrepress).toBe(false); expect(sessions).toHaveLength(0); expect(prior.status).toBe('canceled');
  } else {
    expect(saved.requiresPrepress).toBe(true); expect(saved.workflowState).toBe('in_prepress');
    expect(sessions).toHaveLength(1); expect(prior.status).toBe('queued');
  }
});

test('ordinary staff cannot withdraw through the admin/owner Order save route', async () => {
  const { line, job } = await prepressFixture();
  const response = await request(app).patch('/api/order-line-items/' + line.id).set('x-test-role', 'employee')
    .send({ requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(403);
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresPrepress).toBe(true);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toEqual([job]);
});

test('activity cannot be hidden by clearing specs in the same withdrawal request', async () => {
  const { line } = await prepressFixture();
  await db.update(orderLineItems).set({ specsJson: { materialOverrides: [{ op: 'ambiguous' }] } }).where(eq(orderLineItems.id, line.id));
  const response = await patch(line.id, { requiresPrepress: false, specsJson: {}, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(409); expect(response.body.code).toBe('PREPRESS_WITHDRAWAL_BLOCKED');
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresPrepress).toBe(true); expect(saved.specsJson).toEqual({ materialOverrides: [{ op: 'ambiguous' }] });
});

test('production credit rejection rolls back requirement, ownership, and withdrawal audit together', async () => {
  const { line, job } = await prepressFixture();
  await db.update(customers).set({ creditLimit: '0' }).where(eq(customers.id, customerId));
  try {
    const response = await patch(line.id, { requiresPrepress: false, expectedUpdatedAt: line.updatedAt.toISOString() });
    expect(response.status).toBe(409); expect(response.body.message).toContain('Payment required');
    const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
    expect(saved.requiresPrepress).toBe(true); expect(saved.workflowState).toBe('ready_for_prepress');
    expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toEqual([job]);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, line.id));
    expect(audits.some(a => (a.newValues as any)?.eventType === 'prepress_requirement_withdrawn')).toBe(false);
  } finally {
    await db.update(customers).set({ creditLimit: '100000' }).where(eq(customers.id, customerId));
  }
});
