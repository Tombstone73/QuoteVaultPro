
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { organizations, users, customers, products, orders, orderLineItems, productionJobs, productionEvents, auditLogs, stations } from '../../shared/schema';

jest.unstable_mockModule('sharp', () => ({ default: () => { throw new Error('Image processing is outside this test'); } }));
let organizationId = '', userId = '', customerId = '', productId = '';
let app: express.Express;
beforeAll(async () => {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({ name: 'Workflow test', slug: 'workflow-test-' + suffix, settings: { preferences: { proofing: { policy: 'manual_requested_only' } } } } as any).returning();
  organizationId = org.id;
  await db.insert(stations).values(['prepress', 'design', 'flatbed', 'roll'].map((key, index) => ({ id: randomUUID(), organizationId, key, name: key, sort: index, active: true })));
  const [user] = await db.insert(users).values({ email: 'workflow-' + suffix + '@example.test', firstName: 'Workflow', lastName: 'Test', role: 'admin' }).returning(); userId = user.id;
  const [customer] = await db.insert(customers).values({ organizationId, companyName: 'QA Workflow Customer', email: suffix + '@example.test' }).returning(); customerId = customer.id;
  const [product] = await db.insert(products).values({ organizationId, name: 'QA Product', description: 'Synthetic', requiresProofApproval: true } as any).returning(); productId = product.id;
  app = express(); app.use(express.json());
  const pass = (req: any, _res: any, next: any) => { req.organizationId = organizationId; req.orgRole = 'admin'; req.user = { id: userId }; next(); };
  const { registerOrderRoutes } = await import('../routes/orders.routes');
  await registerOrderRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdmin: pass, isAdminOrOwner: pass });
}, 120000);
afterAll(async () => {
  if (organizationId) {
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
test('active production rejects added proof and preserves owner and history', async () => {
  const { order, line } = await fixture();
  const [job] = await db.insert(productionJobs).values({ organizationId, orderId: order.id, lineItemId: line.id, stationKey: 'flatbed', stepKey: 'queued', status: 'queued' }).returning();
  const response = await patch(line.id, { requiresProofApproval: true, expectedUpdatedAt: line.updatedAt.toISOString() });
  expect(response.status).toBe(409); expect(response.body.message).toContain('Return for Correction');
  const [saved] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, line.id));
  expect(saved.requiresProofApproval).toBe(false);
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
