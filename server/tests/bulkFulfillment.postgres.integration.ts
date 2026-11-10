import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customers, fulfillmentEvents, fulfillmentReadyQuantities, orderLineItems, orders, organizations, pickupHandoffItems, pickupHandoffs,
  products, shipmentItems, shipments, userOrganizations, users } from '@shared/schema';
import type { BulkFulfillmentAction, BulkFulfillmentSelection } from '@shared/bulkFulfillment';

// Preserve canonical quantity/production/ledger services. Only downstream billing
// and auto-close are isolated; these tests cannot create financial records/mail.
const billing = jest.fn<any>(async () => ({ status: 'skipped_existing_invoice', message: 'Synthetic policy', policy: 'manual', trigger: 'picked_up_or_shipped' }));
jest.unstable_mockModule('../services/billingInvoiceAutomation', () => ({ billingInvoiceAutomationService: { ensureOrderBackedInvoiceForOrderTrigger: billing } }));
jest.unstable_mockModule('../services/orderAutoCloseService', () => ({ reconcileOrderAutoCloseFailSoft: jest.fn<any>(async () => ({})) }));
const { bulkFulfillmentOperations: bulk } = await import('../services/fulfillment/bulkOperations');
const { canonicalFulfillmentOperations: canonical } = await import('../services/fulfillment/canonicalFulfillmentOperations');
const { registerBulkFulfillmentRoutes } = await import('../routes/bulkFulfillment.routes');
let org: string, actor: string, employee: string, member: string, customer: string, product: string;
beforeAll(async () => {
  const suffix = randomUUID();
  [org] = (await db.insert(organizations).values({ name: 'Synthetic bulk fulfillment', slug: 'bulk-' + suffix }).returning()).map(row => row.id);
  const staff = await db.insert(users).values(['admin', 'employee', 'member'].map((role, index) => ({ email: `${index}-${suffix}@example.invalid`, role: role === 'member' ? 'employee' : role }))).returning();
  [actor, employee, member] = staff.map(row => row.id);
  await db.insert(userOrganizations).values([{ organizationId: org, userId: actor, role: 'admin' }, { organizationId: org, userId: employee, role: 'manager' }, { organizationId: org, userId: member, role: 'member' }]);
  [customer] = (await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic recipient' }).returning()).map(row => row.id);
  [product] = (await db.insert(products).values({ organizationId: org, name: 'Physical QA product', description: 'Synthetic physical product for disposable tests', requiresProductionJob: true }).returning()).map(row => row.id);
});
afterAll(async () => { if (org) await db.delete(organizations).where(eq(organizations.id, org)); for (const id of [actor, employee, member]) if (id) await db.delete(users).where(eq(users.id, id)); });
async function fixture(method: 'pickup' | 'ship' = 'pickup', quantity = 10, ready = 0, complete = true, count = 1) {
  const [order] = await db.insert(orders).values({ organizationId: org, customerId: customer, createdByUserId: actor, orderNumber: 'BULK-' + randomUUID(),
    state: complete ? 'production_complete' : 'open', status: complete ? 'ready_for_shipment' : 'in_production', fulfillmentStatus: 'pending', routingTarget: 'fulfillment', shippingMethod: method,
    shipToName: 'Synthetic recipient', shipToAddress1: '100 Test Road', shipToCity: 'Carmel', shipToState: 'IN', shipToPostalCode: '46032', shipToCountry: 'US' }).returning();
  const lines = await db.insert(orderLineItems).values(Array.from({ length: count }, (_, index) => ({ orderId: order.id, productId: product, description: `Physical line ${index + 1}`,
    quantity, unitPrice: '1', totalPrice: String(quantity), workflowState: complete ? 'completed' : 'ready_for_production', status: complete ? 'complete' : 'in_production' }))).returning();
  if (ready) await db.insert(fulfillmentReadyQuantities).values(lines.map(line => ({ organizationId: org, orderId: order.id, orderLineItemId: line.id, readyWaitingQuantity: ready, updatedByUserId: actor })));
  return { order, lines };
}
const select = (f: Awaited<ReturnType<typeof fixture>>, line?: number, quantity?: number): BulkFulfillmentSelection[number] => ({ orderId: f.order.id, ...(line === undefined ? {} : { items: [{ orderLineItemId: f.lines[line].id, quantity }] }) });
async function command(action: BulkFulfillmentAction, selection: BulkFulfillmentSelection, extra: Record<string, unknown> = {}) {
  const preview = await bulk.preview(org, actor, { action, selection });
  return { action, selection, previewToken: preview.previewToken, confirmed: true, requestId: randomUUID(), reason: 'Synthetic operator confirmation for regression testing.', ...extra };
}
const queue = (showArchived = false) => canonical.listQueue(org, { type: 'all', status: 'all', showArchived, overdueOnly: false, page: 1, pageSize: 200, sortBy: 'createdAt', sortDirection: 'asc' });
const handoffs = async (f: Awaited<ReturnType<typeof fixture>>) => db.select().from(pickupHandoffs).where(eq(pickupHandoffs.orderId, f.order.id));
async function draft(f: Awaited<ReturnType<typeof fixture>>, quantity = 10) {
  const created = await canonical.createShipment(org, { scope: 'SINGLE_ORDER', orderIds: [f.order.id], actorUserId: actor });
  const id = created!.id;
  let saved = (await canonical.getShipment(org, id))!;
  if (!saved.packages.length) await canonical.createShipmentPackage(org, id, { weightLbs: 1, dims: { length: 10, width: 10, height: 2 } }, actor);
  saved = (await canonical.getShipment(org, id))!;
  const destination = { name: 'Synthetic recipient', company: null, address1: '100 Test Road', address2: null, city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: null, email: null };
  await canonical.patchShipment(org, id, { carrier: 'Freight', trackingNumber: 'STAFF-REFERENCE', shippingContext: { version: 1, source: 'staff', sourceOrderId: f.order.id, destination, blindShipping: false, blindSender: null },
    shipmentItems: [{ orderId: f.order.id, orderLineItemId: f.lines[0].id, quantity, packageId: saved.packages[0].id }] }, actor);
  return id;
}

test('bulk readiness uses canonical completed production and is idempotent under simultaneous retries', async () => {
  const f = await fixture(), input = await command('ready', [select(f)]);
  const results = await Promise.allSettled([bulk.execute(org, actor, input), bulk.execute(org, actor, input)]);
  expect(results.some(row => row.status === 'fulfilled')).toBe(true);
  expect((await bulk.execute(org, actor, input)).results[0]).toMatchObject({ status: 'succeeded', replayed: true });
  const [ready] = await db.select().from(fulfillmentReadyQuantities).where(eq(fulfillmentReadyQuantities.orderId, f.order.id));
  expect(ready.readyWaitingQuantity).toBe(10);
  expect(await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, f.order.id), eq(fulfillmentEvents.eventType, 'FULFILLMENT_READY')))).toHaveLength(1);
  const blocked = await fixture('pickup', 10, 0, false);
  expect(await bulk.preview(org, actor, { action: 'ready', selection: [select(blocked)] })).toMatchObject({ eligibleCount: 0, skippedCount: 1 });
  expect(await db.select().from(fulfillmentReadyQuantities).where(eq(fulfillmentReadyQuantities.orderId, blocked.order.id))).toHaveLength(0);
});
test('individual line partial pickups consume only ready units and remain active until every physical line is complete', async () => {
  const f = await fixture('pickup', 10, 4, true, 2);
  const input = await command('picked_up', [select(f, 0, 2)]);
  expect((await bulk.execute(org, actor, input)).results[0].status).toBe('succeeded');
  await bulk.execute(org, actor, input);
  expect(await handoffs(f)).toHaveLength(1);
  const context = await bulk.context(org, actor, f.order.id);
  expect(context.lines.find(line => line.orderLineItemId === f.lines[0].id)).toMatchObject({ pickedUpQuantity: 2, readyQuantity: 2, remainingQuantity: 8 });
  expect(context.lines.find(line => line.orderLineItemId === f.lines[1].id)).toMatchObject({ pickedUpQuantity: 0, readyQuantity: 4 });
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(true);
  expect(await bulk.preview(org, actor, { action: 'archive', selection: [select(f)] })).toMatchObject({ eligibleCount: 0 });
});
test('bulk pickup reports mixed types/skips, clears completed orders to searchable history, and archives only completed work', async () => {
  const pickup = await fixture('pickup', 3, 3), shipping = await fixture('ship', 3, 3);
  const selection = [select(pickup), select(shipping)], preview = await bulk.preview(org, actor, { action: 'picked_up', selection });
  expect(preview).toMatchObject({ eligibleCount: 1, skippedCount: 1 });
  const input = await command('picked_up', selection);
  expect((await bulk.execute(org, actor, input)).results.map(row => row.status)).toEqual(['succeeded', 'skipped']);
  expect((await queue()).rows.some(row => row.orderId === pickup.order.id)).toBe(false);
  expect((await queue(true)).rows.find(row => row.orderId === pickup.order.id)).toMatchObject({ isHistorical: true, status: 'PICKED_UP' });
  const archive = await command('archive', [select(pickup)]);
  expect((await bulk.execute(org, actor, archive)).results[0].status).toBe('succeeded');
  await bulk.execute(org, actor, archive);
  expect(await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, pickup.order.id), eq(fulfillmentEvents.eventType, 'FULFILLMENT_COMPLETED_ARCHIVED')))).toHaveLength(1);
  expect(await handoffs(shipping)).toHaveLength(0);
});
test('shipping requires a valid saved shipment; partial shipping preserves exact package allocations and tracking', async () => {
  const f = await fixture('ship', 10, 10);
  expect((await bulk.preview(org, actor, { action: 'shipped', selection: [select(f)] })).eligibleCount).toBe(0);
  const id = await draft(f, 4);
  const [before] = await db.select().from(shipments).where(eq(shipments.id, id));
  const allocations = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, id));
  const input = await command('shipped', [select(f)]);
  expect((await bulk.execute(org, actor, input)).results[0]).toMatchObject({ status: 'succeeded' });
  await bulk.execute(org, actor, input);
  const [saved] = await db.select().from(shipments).where(eq(shipments.id, id));
  expect(saved).toMatchObject({ status: 'SHIPPED', trackingNumber: before.trackingNumber, carrier: 'Freight' });
  expect(saved.documentSnapshot).toBeTruthy();
  expect(await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, id))).toEqual(allocations);
  expect((await bulk.context(org, actor, f.order.id)).lines[0]).toMatchObject({ shippedQuantity: 4, readyQuantity: 6, remainingQuantity: 6 });
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(true);
});
test('fully dispatched shipping stays active until staff-confirmed delivery, with partial deliveries and no fabricated scans', async () => {
  const f = await fixture('ship', 5, 5), id = await draft(f, 5);
  await bulk.execute(org, actor, await command('shipped', [select(f)]));
  expect((await queue()).rows.find(row => row.orderId === f.order.id)).toMatchObject({ isHistorical: false, pendingDeliveryQuantity: 5 });
  const partial = await command('delivered', [select(f, 0, 2)]);
  await bulk.execute(org, actor, partial); await bulk.execute(org, actor, partial);
  expect((await bulk.context(org, actor, f.order.id)).lines[0]).toMatchObject({ deliveredQuantity: 2, pendingDeliveryQuantity: 3 });
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(true);
  expect((await bulk.preview(org, actor, { action: 'archive', selection: [select(f)] })).eligibleCount).toBe(0);
  await bulk.execute(org, actor, await command('delivered', [select(f)]));
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(false);
  expect((await queue(true)).rows.find(row => row.orderId === f.order.id)).toMatchObject({ status: 'DELIVERED', isHistorical: true, deliveredQuantity: 5, pendingDeliveryQuantity: 0 });
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, id));
  expect(shipment).toMatchObject({ status: 'SHIPPED', carrierLastStatus: null, deliveredAt: null });
  expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.order.id), eq(auditLogs.actionType, 'fulfillment_delivery_confirmed')))).toHaveLength(2);
});
test('a failed order does not undo successful units and replay never creates another handoff', async () => {
  const good = await fixture('pickup', 2, 2), bad = await fixture('pickup', 2, 2);
  const original = canonical.recordPickupHandoff.bind(canonical);
  const spy = jest.spyOn(canonical, 'recordPickupHandoff').mockImplementation(async (...args) => {
    const [ticket] = await db.select().from((await import('@shared/schema')).pickupTickets).where(eq((await import('@shared/schema')).pickupTickets.id, args[1]));
    if (ticket.orderId === bad.order.id) throw new Error('Synthetic per-order failure');
    return original(...args);
  });
  try {
    const input = await command('picked_up', [select(good), select(bad)]), result = await bulk.execute(org, actor, input);
    expect(result.results.map(row => row.status)).toEqual(['succeeded', 'failed']);
    await bulk.execute(org, actor, input);
    expect(await handoffs(good)).toHaveLength(1); expect(await handoffs(bad)).toHaveLength(0);
  } finally { spy.mockRestore(); }
});
test('stale previews, duplicate requests with changed payloads, tenant scope, and viewer authority fail closed', async () => {
  const f = await fixture('pickup', 10, 10), input = await command('picked_up', [select(f)]);
  await db.update(fulfillmentReadyQuantities).set({ readyWaitingQuantity: 8 }).where(eq(fulfillmentReadyQuantities.orderId, f.order.id));
  await expect(bulk.execute(org, actor, input)).rejects.toMatchObject({ code: 'BULK_PREVIEW_STALE' });
  expect(await handoffs(f)).toHaveLength(0);
  await expect(bulk.preview(org, member, { action: 'picked_up', selection: [select(f)] })).rejects.toMatchObject({ status: 403 });
  await expect(bulk.preview(randomUUID(), actor, { action: 'picked_up', selection: [select(f)] })).rejects.toMatchObject({ status: 403 });
  const app = express(); app.use(express.json());
  registerBulkFulfillmentRoutes(app, { isAuthenticated: (req: any, _res, next) => { req.user = { id: member }; next(); }, tenantContext: (req: any, _res, next) => { req.organizationId = org; req.orgRole = 'admin'; next(); } });
  expect((await request(app).post('/api/fulfillment/bulk/preview').send({ action: 'picked_up', selection: [select(f)], actorOrgRole: 'admin' })).status).toBe(400);
  expect((await request(app).post('/api/fulfillment/bulk/preview').send({ action: 'picked_up', selection: [select(f)] })).status).toBe(403);
  const valid = await command('picked_up', [select(f, 0, 2)]); await bulk.execute(org, actor, valid);
  await expect(bulk.execute(org, actor, { ...valid, reason: 'Changed reason on an existing request.' })).rejects.toMatchObject({ code: 'BULK_REQUEST_CONFLICT' });
});
test('historical reconciliation is separately confirmed, admin-only, and cannot override unfinished production', async () => {
  const f = await fixture('pickup', 4, 0), incomplete = await fixture('pickup', 4, 0, false);
  expect((await bulk.preview(org, actor, { action: 'legacy', selection: [select(incomplete)] })).eligibleCount).toBe(0);
  const input = await command('legacy', [select(f)], { legacyConfirmed: true });
  await expect(bulk.execute(org, employee, input)).rejects.toMatchObject({ status: 403 });
  await expect(bulk.execute(org, actor, { ...input, legacyConfirmed: false })).rejects.toMatchObject({ status: 403 });
  const result = await bulk.execute(org, actor, input);
  expect(result.results[0]).toMatchObject({ status: 'succeeded' });
  expect(await handoffs(f)).toHaveLength(0);
  expect(await db.select().from(shipmentItems).where(eq(shipmentItems.orderId, f.order.id))).toHaveLength(0);
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(false);
});

test('interrupted batch receipts recover canonical mutations without repeating physical or historical work', async () => {
  for (const action of ['ready', 'picked_up', 'shipped', 'delivered', 'archive', 'legacy'] as const) {
    const f = await fixture(action === 'shipped' || action === 'delivered' ? 'ship' : 'pickup', 3, action === 'ready' || action === 'legacy' ? 0 : 3);
    if (action === 'shipped' || action === 'delivered') {
      await draft(f, 3);
      if (action === 'delivered') await bulk.execute(org, actor, await command('shipped', [select(f)]));
    }
    if (action === 'archive') await bulk.execute(org, actor, await command('picked_up', [select(f)]));
    const input = await command(action, [select(f)], action === 'legacy' ? { legacyConfirmed: true } : {});
    expect((await bulk.execute(org, actor, input)).results[0].status).toBe('succeeded');
    const [receipt] = await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, org), eq(fulfillmentEvents.eventType, 'FULFILLMENT_BULK_OPERATION'), sql`${fulfillmentEvents.payloadJson}->>'requestId' = ${input.requestId}`));
    const before = await db.select().from(fulfillmentEvents).where(eq(fulfillmentEvents.entityId, f.order.id));
    const billingBefore = billing.mock.calls.length;
    await db.update(fulfillmentEvents).set({ payloadJson: { ...receipt.payloadJson, results: [], complete: false, leaseUntil: '2000-01-01T00:00:00Z' } }).where(eq(fulfillmentEvents.id, receipt.id));
    expect((await bulk.execute(org, actor, input)).results[0]).toMatchObject({ status: 'succeeded' });
    expect(await db.select().from(fulfillmentEvents).where(eq(fulfillmentEvents.entityId, f.order.id))).toHaveLength(before.length);
    expect(await handoffs(f)).toHaveLength(action === 'picked_up' || action === 'archive' ? 1 : 0);
    if (action === 'shipped' || action === 'picked_up') expect(billing.mock.calls.length).toBe(billingBefore + 1);
  }
});

test('a completed individual line can be archived while its sibling stays in the active queue', async () => {
  const f = await fixture('pickup', 3, 3, true, 2);
  await bulk.execute(org, actor, await command('picked_up', [select(f, 0)]));
  expect((await bulk.execute(org, actor, await command('archive', [select(f, 0)]))).results[0].status).toBe('succeeded');
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(true);
  expect((await canonical.getBulkOrderContext(org, f.order.id, 'admin')).physical.find(line => line.id === f.lines[1].id)?.projection.remainingQuantity).toBe(3);
});

test('simultaneous distinct bulk requests cannot both consume the same reviewed pickup quantity', async () => {
  const f = await fixture('pickup', 10, 4), first = await command('picked_up', [select(f, 0, 2)]);
  const outcomes = await Promise.allSettled([bulk.execute(org, actor, first), bulk.execute(org, actor, { ...first, requestId: randomUUID() })]);
  expect(outcomes.filter(result => result.status === 'fulfilled' && result.value.results[0].status === 'succeeded')).toHaveLength(1);
  expect(await handoffs(f)).toHaveLength(1);
  const context = await canonical.getBulkOrderContext(org, f.order.id, 'admin');
  expect(context.physical[0].projection).toMatchObject({ pickedUpQuantity: 2, readyWaitingQuantity: 2, remainingQuantity: 8 });
});

test('partial delivery of a split line confirms only its explicitly chosen source shipment', async () => {
  const f = await fixture('ship', 10, 10), first = await draft(f, 4);
  await bulk.execute(org, actor, await command('shipped', [select(f)]));
  const second = await draft(f, 6);
  await bulk.execute(org, actor, await command('shipped', [select(f)]));
  expect((await bulk.preview(org, actor, { action: 'delivered', selection: [select(f, 0, 2)] })).eligibleCount).toBe(0);
  const selection = [{ orderId: f.order.id, items: [{ orderLineItemId: f.lines[0].id, quantity: 2, shipmentId: second }] }];
  const input = await command('delivered', selection);
  expect((await bulk.execute(org, actor, input)).results[0].status).toBe('succeeded');
  await bulk.execute(org, actor, input);
  const progress = await canonical.getDeliveryProgress(org, [f.order.id]);
  expect(progress.find(row => row.shipmentId === first)).toMatchObject({ deliveredQuantity: 0, pendingDeliveryQuantity: 4 });
  expect(progress.find(row => row.shipmentId === second)).toMatchObject({ deliveredQuantity: 2, pendingDeliveryQuantity: 4 });
  expect((await queue()).rows.some(row => row.orderId === f.order.id)).toBe(true);
  const invalid = [{ orderId: f.order.id, items: [{ orderLineItemId: f.lines[0].id, quantity: 1, shipmentId: randomUUID() }] }];
  expect((await bulk.preview(org, actor, { action: 'delivered', selection: invalid })).eligibleCount).toBe(0);
});
