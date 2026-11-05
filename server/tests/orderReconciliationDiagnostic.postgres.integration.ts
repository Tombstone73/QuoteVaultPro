import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import { registerOrderRoutes } from '../routes/orders.routes';
import { getOrderReconciliationDiagnostic } from '../services/orderReconciliationDiagnostic';
import {
  auditLogs, customers, fulfillmentAdministrativeReconciliations, fulfillmentEvents,
  invoices, orderLineItems, orders, organizations, products, productionEvents,
  productionJobs, productionRunMembers, productionRuns, users, userOrganizations,
} from '@shared/schema';

const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID();
let customer: string, product: string;
const app = express(); app.use(express.json());
const auth = (req: any, _res: any, next: () => void) => {
  req.organizationId = req.headers['x-tenant'] || org;
  req.orgRole = req.headers['x-role'] || 'owner'; req.user = { id: actor, role: req.orgRole }; next();
};
beforeAll(async () => {
  await db.insert(organizations).values([org, otherOrg].map(id => ({ id, name: 'Synthetic reconciliation', slug: id })));
  await db.insert(users).values({ id: actor, email: `${actor}@example.invalid`, role: 'owner' });
  await db.insert(userOrganizations).values({ userId: actor, organizationId: org, role: 'owner' });
  [{ id: customer }] = await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic only' }).returning();
  [{ id: product }] = await db.insert(products).values({ organizationId: org, name: 'Synthetic production', description: 'Isolated fixture', requiresProductionJob: true, isActive: true }).returning();
  await registerOrderRoutes(app, { isAuthenticated: auth, tenantContext: auth, isAdmin: auth, isAdminOrOwner: auth });
}, 120000);
afterAll(async () => { await pool.end(); });

async function fixture() {
  const [order] = await db.insert(orders).values({ organizationId: org, customerId: customer,
    createdByUserId: actor, orderNumber: `QA-${randomUUID()}`, poNumber: 'QA-152918', state: 'open', status: 'in_production', shippingMethod: 'ship' }).returning();
  const lines = await db.insert(orderLineItems).values(Array.from({ length: 3 }, (_, i) => ({ orderId: order.id,
    productId: product, description: `Synthetic component ${i}`, quantity: 10, unitPrice: '1', totalPrice: '10',
    workflowState: 'in_production' as const, status: 'in_production', requiresPrepress: false, requiresDesign: false, requiresProofApproval: false }))).returning();
  const [job] = await db.insert(productionJobs).values({ organizationId: org, orderId: order.id, lineItemId: lines[0]!.id,
    stationKey: 'flatbed', stepKey: 'queued', status: 'in_progress', startedAt: new Date() }).returning();
  const [invoice] = await db.insert(invoices).values({ organizationId: org, orderId: order.id, customerId: customer, createdByUserId: actor,
    invoiceNumber: Math.floor(Math.random() * 100000000), status: 'paid', total: '30', totalCents: 3000, balanceDue: '0', amountPaid: '30' }).returning();
  return { order, lines, job, invoice };
}
const get = (orderId: string) => request(app).get(`/api/orders/${orderId}/reconciliation-diagnostic`);
async function snapshot(orderId: string) {
  const result = await pool.query(`select jsonb_build_object(
    'order',(select to_jsonb(o) from orders o where id=$1),
    'lines',(select jsonb_agg(to_jsonb(l) order by id) from order_line_items l where order_id=$1),
    'jobs',(select jsonb_agg(to_jsonb(j) order by id) from production_jobs j where order_id=$1),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from production_events e where order_id=$1),
    'audits',(select jsonb_agg(to_jsonb(a) order by id) from audit_logs a where entity_id=$1),
    'invoices',(select jsonb_agg(to_jsonb(i) order by id) from invoices i where order_id=$1)
  ) as snapshot`, [orderId]);
  return result.rows[0].snapshot;
}

test('historical terminal owner with remaining obligations is reported without fabricating completion or modifying anything', async () => {
  const f = await fixture();
  const [old] = await db.insert(productionJobs).values({ organizationId: org, orderId: f.order.id, lineItemId: f.lines[1]!.id,
    stationKey: 'flatbed', stepKey: 'done', status: 'done', completedAt: new Date() }).returning();
  await db.insert(productionEvents).values({ organizationId: org, productionJobId: old.id, orderId: f.order.id,
    orderLineItemId: f.lines[1]!.id, actorUserId: actor, type: 'job_completed', payload: { synthetic: true } });
  const before = await snapshot(f.order.id);
  const response = await get(f.order.id).query({ expectedOrderNumber: f.order.orderNumber, expectedPoNumber: f.order.poNumber });
  expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data.canonicalPreview).toMatchObject({ remainingProductionQuantity: 30, remainingFulfillmentQuantity: 30, activeProductionJobCount: 1, productionBootstrapLineCount: 2 });
  expect(response.body.data.findings).toContainEqual(expect.objectContaining({ code: 'TERMINAL_HISTORY_WITH_REMAINING_OBLIGATION', lineItemId: f.lines[1]!.id, recordIds: [old.id] }));
  expect(response.body.data.resolvedOwners).toContainEqual(expect.objectContaining({ id: f.job.id }));
  expect(response.body.data.productionHistory).toHaveLength(1);
  expect(response.body.data).toMatchObject({ readOnly: true, mutationAvailable: false });
  expect(await snapshot(f.order.id)).toEqual(before);
  expect((await get(f.order.id)).body.data.snapshotToken).toBe(response.body.data.snapshotToken);
});

test('partial Combined Run quantity remains partial and active membership blocks historical repair', async () => {
  const f = await fixture();
  const [run] = await db.insert(productionRuns).values({ organizationId: org, runNumber: Math.floor(Math.random() * 100000000),
    stationKey: 'flatbed', status: 'in_production', createdByUserId: actor }).returning();
  await db.insert(productionRunMembers).values({ organizationId: org, productionRunId: run.id, productionJobId: f.job.id,
    orderLineItemId: f.lines[0]!.id, allocatedQuantity: 10, successfulQuantity: 4, remainingQuantity: 6 });
  const response = await get(f.order.id);
  expect(response.status).toBe(200);
  expect(response.body.data.quantities.find((line: { id: string }) => line.id === f.lines[0]!.id).projection.productionCompleteQuantity).toBe(4);
  expect(response.body.data.canonicalPreview.remainingProductionQuantity).toBe(26);
  expect(response.body.data.members[0].run.id).toBe(run.id);
  expect(response.body.data.findings).toContainEqual(expect.objectContaining({ code: 'ACTIVE_COMBINED_RUN', recordIds: [run.id] }));
});

test('complete lines plus fulfilled quantities need no repair; historical jobs remain visible', async () => {
  const f = await fixture();
  await db.update(productionJobs).set({ status: 'done', completedAt: new Date() }).where(eq(productionJobs.id, f.job.id));
  for (const line of f.lines) {
    await db.update(orderLineItems).set({ workflowState: 'completed', status: 'complete' }).where(eq(orderLineItems.id, line.id));
    await db.insert(fulfillmentAdministrativeReconciliations).values({ organizationId: org, orderId: f.order.id, lineItemId: line.id,
      reconciledQuantity: 10, reason: 'historical_backlog_cleanup', actorUserId: actor });
  }
  const response = await get(f.order.id);
  expect(response.status).toBe(200);
  expect(response.body.data.findings).toEqual([]);
  expect(response.body.data.jobs[0].id).toBe(f.job.id);
  expect(response.body.data.canonicalPreview).toMatchObject({ remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0 });
});

test('legacy closure evidence remains visible without offering repair or changing any state', async () => {
  const f = await fixture();
  await db.delete(productionJobs).where(eq(productionJobs.id, f.job.id));
  await db.update(orders).set({ state: 'production_complete', status: 'ready_for_shipment' }).where(eq(orders.id, f.order.id));
  await db.insert(fulfillmentEvents).values({ organizationId: org, entityType: 'ORDER', entityId: f.order.id,
    actorUserId: actor, eventType: 'FULFILLMENT_HISTORICAL_RECONCILED', payloadJson: {
      source: 'administrative_historical_reconciliation', shipmentOrPickupEvidenceCreated: false, billingAutomationSuppressed: true } });
  await db.insert(auditLogs).values({ organizationId: org, userId: actor, entityType: 'order', entityId: f.order.id,
    actionType: 'ORDER_HISTORICAL_FULFILLMENT_RECONCILED', description: 'Synthetic proven legacy closure' });
  const before = await snapshot(f.order.id);
  const response = await get(f.order.id);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ readOnly: true, mutationAvailable: false });
  expect(response.body.data.auditHistory).toContainEqual(expect.objectContaining({ actionType: 'ORDER_HISTORICAL_FULFILLMENT_RECONCILED' }));
  expect(response.body.data.fulfillmentHistory).toContainEqual(expect.objectContaining({ eventType: 'FULFILLMENT_HISTORICAL_RECONCILED' }));
  expect(response.body.data.canonicalPreview.remainingProductionQuantity).toBe(30);
  expect(response.body.data).not.toHaveProperty('repairPreview');
  expect(await snapshot(f.order.id)).toEqual(before);
});

test('ordinary unfinished production remains actionable work, never inferred historical completion', async () => {
  const f = await fixture(); const response = await get(f.order.id);
  expect(response.status).toBe(200); expect(response.body.data.findings).toEqual([]);
  expect(response.body.data.mutationAvailable).toBe(false);
  expect(response.body.data.obligations).toContainEqual(expect.objectContaining({ state: 'active_owner', lineItemId: f.lines[0]!.id }));
});

test('Owner permission, tenant isolation, identity guards, and no apply operation', async () => {
  const f = await fixture();
  for (const role of ['admin', 'staff', 'customer']) expect((await get(f.order.id).set('x-role', role)).status).toBe(403);
  expect((await get(f.order.id).set('x-tenant', otherOrg)).status).toBe(404);
  expect((await get(f.order.id).query({ expectedOrderNumber: 'different' })).status).toBe(404);
  expect((await get(f.order.id).query({ expectedPoNumber: 'different' })).status).toBe(404);
  expect((await get('20881')).status).toBe(400);
  expect((await request(app).post(`/api/orders/${f.order.id}/reconciliation-diagnostic`).send({ apply: true })).status).toBe(404);
});

test('unrelated same-tenant and foreign-tenant audit/evidence rows are not returned', async () => {
  const f = await fixture(), unrelated = await fixture();
  for (const organizationId of [org, otherOrg]) await db.insert(auditLogs).values({ organizationId,
    entityType: 'order', entityId: organizationId === org ? unrelated.order.id : f.order.id,
    actionType: 'PRIVATE_UNRELATED', description: 'Must not leak' });
  const response = await get(f.order.id);
  expect(response.status).toBe(200); expect(JSON.stringify(response.body)).not.toContain('PRIVATE_UNRELATED');
});

test('canonical reversal calculation remains scoped and preserves net allocations', async () => {
  const f = await fixture();
  await db.insert(fulfillmentAdministrativeReconciliations).values({ organizationId: org, orderId: f.order.id,
    lineItemId: f.lines[0]!.id, reconciledQuantity: 10, reason: 'historical_backlog_cleanup', actorUserId: actor });
  await db.insert(fulfillmentEvents).values({ organizationId: org, entityType: 'ORDER', entityId: f.order.id,
    eventType: 'ADMINISTRATIVE_FULFILLMENT_REOPENED', actorUserId: actor,
    payloadJson: { mode: 'administrative', items: [{ orderLineItemId: f.lines[0]!.id, quantity: 3 }] } });
  const response = await get(f.order.id);
  expect(response.status).toBe(200);
  expect(response.body.data.quantities.find((line: { id: string }) => line.id === f.lines[0]!.id).projection).toMatchObject({
    administrativelyReconciledQuantity: 7, remainingQuantity: 3 });
});

test('database read-only boundary rejects accidental writes and rolls back; a later diagnostic still succeeds', async () => {
  const f = await fixture(), before = await snapshot(f.order.id);
  const probe = {
    transaction: (callback: Parameters<typeof db.transaction>[0], config: Parameters<typeof db.transaction>[1]) => db.transaction(async tx => {
      const result = await callback(tx);
      await tx.update(orders).set({ status: 'must_not_persist' }).where(eq(orders.id, f.order.id));
      return result;
    }, config),
  } as unknown as typeof db;
  await expect(getOrderReconciliationDiagnostic({ organizationId: org, orderId: f.order.id }, probe)).rejects.toMatchObject({ code: '25006' });
  expect(await snapshot(f.order.id)).toEqual(before);
  expect((await get(f.order.id)).status).toBe(200);
});

test('all projections use one repeatable snapshot even if another connection updates the Order', async () => {
  const f = await fixture();
  const concurrent = {
    transaction: (callback: Parameters<typeof db.transaction>[0], config: Parameters<typeof db.transaction>[1]) => db.transaction(async tx => {
      await tx.execute(sql`select id from orders where id = ${f.order.id}`);
      await db.update(orders).set({ status: 'completed_on_other_connection' }).where(eq(orders.id, f.order.id));
      return callback(tx);
    }, config),
  } as unknown as typeof db;
  const report = await getOrderReconciliationDiagnostic({ organizationId: org, orderId: f.order.id }, concurrent);
  expect(report.order.status).toBe('in_production');
  expect(report.canonicalPreview.orderStatus).toBe('in_production');
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]!.status).toBe('completed_on_other_connection');
});

test('historical metadata never exports credentials or signed URL query tokens', async () => {
  const f = await fixture();
  await db.insert(auditLogs).values({ organizationId: org, entityId: f.order.id, entityType: 'order',
    actionType: 'SYNTHETIC_SECRET_METADATA', description: 'Synthetic redaction fixture',
    newValues: { accessToken: 'secret-marker-one', databaseUrl: 'postgresql://user:secret-marker-two@host/db',
      nested: { fileUrl: 'https://example.invalid/file?signature=secret-marker-three', note: 'Bearer secret-marker-four' } } });
  const response = await get(f.order.id);
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain('secret-marker');
  expect(response.body.data.auditHistory[0].newValues.accessToken).toBe('[redacted]');
  expect(response.body.data.snapshotToken).toMatch(/^[a-f0-9]{64}$/);
});
