import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import type { ManualPackageTracking } from '@shared/shipmentTracking';
import { renderShippingDocumentHtml } from '@shared/shippingDocumentRendering';
import { db, pool } from '../db';
import { companySettings, customers, fulfillmentEvents, fulfillmentReadyQuantities, invoices, orderLineItems, orders,
  organizations, payments, productionJobs, products, shipments, shipmentTrackingStates, upsLabelPurchases,
  upsPackageLabels, upsShipmentRateQuotes, users } from '@shared/schema';

const realConnection = await import('../services/ups/upsConnection');
jest.unstable_mockModule('../services/ups/upsConnection', () => ({ ...realConnection, upsEnvironmentMode: () => 'live',
  upsRateCredentials: async () => ({ row: { mode: 'live' }, baseUrl: 'https://ups.invalid', token: 'synthetic', accountNumber: 'TEST' }),
}));
const billing = jest.fn(async () => ({ status: 'skipped_existing_invoice', message: 'Synthetic billing', policy: 'manual' }));
const autoClose = jest.fn(async () => ({}));
jest.unstable_mockModule('../services/billingInvoiceAutomation', () => ({ billingInvoiceAutomationService: { ensureOrderBackedInvoiceForOrderTrigger: billing } }));
jest.unstable_mockModule('../services/orderAutoCloseService', () => ({ reconcileOrderAutoCloseFailSoft: autoClose }));

const { canonicalFulfillmentOperations: fulfillment } = await import('../services/fulfillment/canonicalFulfillmentOperations');
const { ShipmentRepo } = await import('../services/fulfillment/repository');
const { registerFulfillmentRoutes } = await import('../routes/fulfillment.routes');
const { buyUpsLabel, verifyUpsPackageLabelMapping, voidUpsLabel, readUpsLabelArchive } = await import('../services/ups/upsLabels');
const { resolveUpsShippingContext, upsShippingFingerprint } = await import('../services/ups/upsRates');
const { loadShipmentTrackingSources, loadPortalShipments } = await import('../services/shipmentTrackingService');
const { buildFulfillmentSummary } = await import('../services/portal.service');
const { emailService } = await import('../emailService');
const image = readFileSync('server/tests/fixtures/shipping-labels/portrait.gif').toString('base64');
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn<typeof fetch>();
let org: string, actor: string, customerId: string, productId: string;
let trackingMode: 'M' | 'MV' | 'I' | 'D' | 'error' | 'missing';
let purchased: string[];
let nextTracking = 100;
const measurements = { weightLbs: 2, dims: { length: 12, width: 8, height: 4 } };
const reason = 'All packages stayed in the shop and need new boxes.';
const confirmation = { reason, confirmedNotHandedToCarrier: true };
const endpoint = (id: string) => `/api/fulfillment/shipments/${id}/reopen-for-shipping`;

beforeAll(async () => {
  [org] = (await db.insert(organizations).values({ name: 'Synthetic shipment repacking', slug: `repack-${randomUUID()}` }).returning()).map(row => row.id);
  [actor] = (await db.insert(users).values({ email: `${randomUUID()}@example.invalid`, role: 'admin' }).returning()).map(row => row.id);
  [customerId] = (await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic recipient', email: 'recipient@example.invalid' }).returning()).map(row => row.id);
  [productId] = (await db.insert(products).values({ organizationId: org, name: 'Synthetic rigid print', description: 'Physical test print', requiresProductionJob: true }).returning()).map(row => row.id);
  await db.insert(companySettings).values({ organizationId: org, companyName: 'Synthetic origin', phone: '3175550101',
    physicalAddress: { line1: '100 Test Avenue', city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US' } });
});
beforeEach(() => {
  trackingMode = 'MV';
  purchased = [];
  billing.mockClear(); autoClose.mockClear();
  mockFetch.mockReset().mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/ship') && init?.method === 'POST') {
      const boxes = JSON.parse(String(init.body)).ShipmentRequest.Shipment.Package;
      const numbers = boxes.map(() => `1Z9000000000${String(++nextTracking).padStart(6, '0')}`);
      purchased.push(...numbers);
      return Response.json({ ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: numbers[0],
        ShipmentCharges: { TotalCharges: { MonetaryValue: '18.00', CurrencyCode: 'USD' } },
        PackageResults: numbers.map((tracking: string) => ({ TrackingNumber: tracking, ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: image } })),
      } } });
    }
    if (path.includes('/void/cancel/') && init?.method === 'DELETE') {
      return Response.json({ VoidShipmentResponse: { Response: { ResponseStatus: { Code: '1' } },
        SummaryResult: { Status: { Code: '1' } }, PackageLevelResults: [{ TrackingNumber: path.split('/').at(-1), Status: { Code: '1' } }] } });
    }
    if (path.includes('/track/v1/details/')) {
      if (trackingMode === 'error') throw new Error('Synthetic carrier outage');
      const activity = trackingMode === 'missing' ? [] : [{ gmtDate: '20251010', gmtTime: '130000', status: { type: trackingMode } }];
      return Response.json({ trackResponse: { shipment: [{ package: [{ trackingNumber: path.split('/').at(-1), activity }] }] } });
    }
    throw new Error(`Unexpected outbound request: ${path}`);
  });
  globalThis.fetch = mockFetch;
});
afterAll(async () => { globalThis.fetch = originalFetch; await pool.end(); });

function app(tenant = org, role = 'admin') {
  const instance = express();
  instance.use(express.json());
  registerFulfillmentRoutes(instance, {
    isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: actor }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = tenant; req.orgRole = role; next(); },
    requireOrgOwnerAdmin: (req: any, res: any, next: any) => {
      if (role !== 'admin') return res.status(403).json({ success: false });
      req.actorOrgRole = role; next();
    },
  });
  return instance;
}

async function purchase(shipmentId: string) {
  const detail = await resolveUpsShippingContext(org, shipmentId);
  const [quote] = await db.insert(upsShipmentRateQuotes).values({ organizationId: org, shipmentId, environment: 'live',
    requestFingerprint: upsShippingFingerprint({ ...detail, accountNumber: 'TEST', shipDate: null }),
    rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '18.00', negotiated: false, estimatedArrival: null }],
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  return buyUpsLabel(org, shipmentId, { quoteId: quote.id, optionId: '0' }, actor);
}

async function fixture(originalQuantity = 10) {
  const [order] = await db.insert(orders).values({ organizationId: org, orderNumber: `REPACK-${randomUUID()}`, customerId,
    createdByUserId: actor, state: 'production_complete', status: 'ready_for_shipment', shippingMethod: 'ship',
    productionCompletedAt: new Date().toISOString(), shippingChargeDecision: 'free',
    shipToName: 'Synthetic recipient', shipToAddress1: '200 Test Road', shipToCity: 'Carmel', shipToState: 'IN', shipToPostalCode: '46032', shipToCountry: 'US' }).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId: order.id, productId, quantity: 10, description: 'Synthetic rigid print',
    unitPrice: '5', totalPrice: '50', workflowState: 'completed', status: 'complete' }).returning();
  const [job] = await db.insert(productionJobs).values({ organizationId: org, orderId: order.id, lineItemId: line.id, status: 'done',
    completedAt: new Date(), restoreUntil: new Date(Date.now() + 86_400_000) }).returning();
  await db.insert(fulfillmentReadyQuantities).values({ organizationId: org, orderId: order.id, orderLineItemId: line.id, readyWaitingQuantity: 10 });
  const [invoice] = await db.insert(invoices).values({ organizationId: org, orderId: order.id, customerId, invoiceNumber: nextTracking,
    createdByUserId: actor, status: 'paid', totalCents: 5000, total: '50.00', amountPaid: '50.00', balanceDue: '0.00' }).returning();
  const [payment] = await db.insert(payments).values({ organizationId: org, invoiceId: invoice.id, amount: '50.00', amountCents: 5000 }).returning();
  const draft = await makeDraft(order.id, line.id, originalQuantity);
  const bought = await purchase(draft.id);
  await fulfillment.markShipmentShipped(org, draft.id, actor);
  return { order, line, job, invoice, payment, shipmentId: draft.id, purchaseId: bought.attemptId, tracking: bought.labels[0].trackingNumber };
}

async function makeDraft(orderId: string, lineId: string, quantity: number) {
  const created = await fulfillment.createShipment(org, { scope: 'SINGLE_ORDER', orderIds: [orderId], actorUserId: actor });
  const draft = (await fulfillment.getShipment(org, created!.id))!;
  const box = draft.packages[0] ?? await fulfillment.createShipmentPackage(org, draft.id, { ...measurements, actorUserId: actor });
  await fulfillment.patchShipment(org, draft.id, { carrier: 'Freight', packages: [{ id: box.id, ...measurements }],
    shipmentItems: [{ orderId, orderLineItemId: lineId, quantity, packageId: box.id }], actorUserId: actor });
  return draft;
}

const savedShipment = (id: string) => fulfillment.getShipment(org, id);
const postReopen = (id: string) => request(app()).post(endpoint(id)).send(confirmation);
const reversalEvents = (id: string) => db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, id), eq(fulfillmentEvents.eventType, 'SHIPMENT_REVERSED')));

test('void, reopen, repack into two boxes, buy and map new labels, then ship while preserving financial closure and history', async () => {
  const f = await fixture();
  await db.update(orders).set({ state: 'closed', status: 'completed', canonicalState: 'completed', routingTarget: null }).where(eq(orders.id, f.order.id));
  const original = (await savedShipment(f.shipmentId))!;
  const oldLabels = await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, f.purchaseId));
  expect((await request(app()).get(endpoint(f.shipmentId))).body.data).toMatchObject({ eligible: false });
  await voidUpsLabel(org, f.purchaseId, actor);
  expect((await savedShipment(f.shipmentId))!.status).toBe('SHIPPED');
  expect((await request(app()).get(endpoint(f.shipmentId))).body.data).toMatchObject({ eligible: true, quantity: 10, packageCount: 1 });

  const reopened = await postReopen(f.shipmentId);
  expect(reopened.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ replayed: false }) }));
  const id = reopened.body.data.replacementShipmentId;
  const retired = (await savedShipment(f.shipmentId))!;
  expect(retired).toMatchObject({ status: 'VOIDED', shippedAt: original.shippedAt, trackingNumber: f.tracking, carrier: 'UPS', documentSnapshot: original.documentSnapshot });
  expect(retired.items).toEqual(original.items);
  expect(retired.packages).toEqual(original.packages);
  expect((await fulfillment.getShipmentDocument(org, f.shipmentId, 'packing_slip')).basis).toBe('shipped');
  expect((await loadShipmentTrackingSources(org, [f.shipmentId]))[0].trackingPackages).toEqual([]);

  const draft = (await savedShipment(id))!;
  expect(draft).toMatchObject({ status: 'DRAFT', repackSourceId: f.shipmentId, trackingNumber: null, items: [expect.objectContaining({ quantity: 10 })] });
  expect(draft.packages[0].id).not.toBe(original.packages[0].id);
  expect((await fulfillment.getHistoricalFulfillmentReconciliationPreview(org, f.order.id)).canCloseJobOverride).toBe(false);
  await expect(fulfillment.reconcileHistoricalFulfillment(org, { orderId: f.order.id, actorUserId: actor, reason: 'completed_outside_printershero' }))
    .rejects.toMatchObject({ code: 'REPACK_DRAFT_REQUIRED' });
  expect((await fulfillment.listQueue(org, { type: 'ship', status: 'all', showArchived: false, overdueOnly: false,
    page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'asc' })).rows.find(row => row.orderId === f.order.id)).toMatchObject({ shipmentId: id, remainingQuantity: 10 });

  await expect(fulfillment.deleteShipmentPackage(org, id, draft.packages[0].id, actor)).rejects.toMatchObject({ code: 'PACKAGE_HAS_ALLOCATIONS' });
  await fulfillment.patchShipment(org, id, { shipmentItems: [], actorUserId: actor });
  await fulfillment.deleteShipmentPackage(org, id, draft.packages[0].id, actor);
  expect((await new ShipmentRepo().listDraftReservationQuantities(org, [f.line.id])).get(f.line.id)).toBe(10);
  const a = await fulfillment.createShipmentPackage(org, id, { ...measurements, actorUserId: actor });
  const b = await fulfillment.createShipmentPackage(org, id, { ...measurements, actorUserId: actor });
  const allocations = [a, b].map((pkg, index) => ({ orderId: f.order.id, orderLineItemId: f.line.id, quantity: index ? 6 : 4, packageId: pkg.id }));
  await fulfillment.patchShipment(org, id, { shipmentItems: allocations, actorUserId: actor });
  await expect(fulfillment.markShipmentShipped(org, id, actor)).rejects.toMatchObject({ code: 'REPACK_LABELS_REQUIRED' });
  const replacement = await purchase(id);
  expect(replacement.labels.map(label => label.trackingNumber)).toEqual(purchased.slice(1));
  const labels = await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, replacement.attemptId)).orderBy(upsPackageLabels.providerResultOrdinal);
  await verifyUpsPackageLabelMapping(org, id, replacement.attemptId, actor, labels.map((label, index) => ({ labelId: label.id, packageId: [a.id, b.id][index] })));
  const billingCalls = billing.mock.calls.length, closeCalls = autoClose.mock.calls.length;
  await fulfillment.markShipmentShipped(org, id, actor);
  expect((await savedShipment(id))!.status).toBe('SHIPPED');
  expect((await fulfillment.getBulkOrderContext(org, f.order.id, 'admin')).physical[0].projection).toMatchObject({ orderedQuantity: 10, productionCompleteQuantity: 10, shippedQuantity: 10, remainingQuantity: 0 });
  expect(await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, f.purchaseId))).toEqual(oldLabels);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId, f.order.id))).toEqual([f.job]);
  expect(await db.select().from(invoices).where(eq(invoices.id, f.invoice.id))).toEqual([f.invoice]);
  expect(await db.select().from(payments).where(eq(payments.id, f.payment.id))).toEqual([f.payment]);
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]).toMatchObject({ state: 'closed', status: 'completed', fulfillmentStatus: 'shipped' });
  expect(billing).toHaveBeenCalledTimes(billingCalls); expect(autoClose).toHaveBeenCalledTimes(closeCalls);
  expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
});

test('concurrent confirmations and subsequent retries point to one replacement and one reversal', async () => {
  const f = await fixture(); await voidUpsLabel(org, f.purchaseId, actor);
  const results = await Promise.all([postReopen(f.shipmentId), postReopen(f.shipmentId)]);
  expect(results.map(result => ({ status: result.status, code: result.body.code, message: result.body.message }))).toEqual([{ status: 200 }, { status: 200 }]);
  expect(new Set(results.map(result => result.body.data.replacementShipmentId)).size).toBe(1);
  expect(results.map(result => result.body.data.replayed).sort()).toEqual([false, true]);
  const carrierCalls = mockFetch.mock.calls.length;
  expect((await postReopen(f.shipmentId)).body.data).toMatchObject({ replayed: true, replacementShipmentId: results[0].body.data.replacementShipmentId });
  expect(mockFetch).toHaveBeenCalledTimes(carrierCalls);
  expect(await reversalEvents(f.shipmentId)).toHaveLength(1);
});

test('carrier acceptance, delivery, missing tracking, API failures and pending voids fail without reversal', async () => {
  const f = await fixture();
  expect((await postReopen(f.shipmentId)).body.code).toBe('REPACK_LABELS_ACTIVE');
  await voidUpsLabel(org, f.purchaseId, actor);
  for (const [mode, code] of [['I', 'CARRIER_ALREADY_ACCEPTED'], ['D', 'CARRIER_ALREADY_ACCEPTED'],
    ['error', 'CARRIER_VERIFICATION_UNAVAILABLE'], ['missing', 'CARRIER_VERIFICATION_UNAVAILABLE']] as const) {
    trackingMode = mode;
    expect((await postReopen(f.shipmentId)).body.code).toBe(code);
  }
  await db.insert(shipmentTrackingStates).values({ organizationId: org, shipmentId: f.shipmentId, carrier: 'UPS', trackingNumber: f.tracking, status: 'delivered', deliveredAt: new Date() });
  trackingMode = 'M';
  const calls = mockFetch.mock.calls.length;
  expect((await postReopen(f.shipmentId)).body.code).toBe('CARRIER_ALREADY_ACCEPTED');
  expect(mockFetch).toHaveBeenCalledTimes(calls);
  expect(await reversalEvents(f.shipmentId)).toEqual([]);
  expect((await savedShipment(f.shipmentId))!.status).toBe('SHIPPED');
});

test('confirmation, tenant access, authority and original-label evidence are required', async () => {
  const f = await fixture(); await voidUpsLabel(org, f.purchaseId, actor);
  const calls = mockFetch.mock.calls.length;
  expect((await request(app()).post(endpoint(f.shipmentId)).send({ reason })).status).toBe(400);
  expect((await request(app(org, 'member')).post(endpoint(f.shipmentId)).send(confirmation)).status).toBe(403);
  expect((await request(app(randomUUID())).post(endpoint(f.shipmentId)).send(confirmation)).status).toBe(404);
  await db.delete(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, f.purchaseId));
  expect((await postReopen(f.shipmentId)).body.code).toBe('REPACK_LABEL_EVIDENCE_MISSING');
  expect(mockFetch).toHaveBeenCalledTimes(calls);
});

test('reopening one partial shipment retains another delivered shipment and its quantities', async () => {
  const f = await fixture(4);
  const delivered = await makeDraft(f.order.id, f.line.id, 6);
  await fulfillment.markShipmentShipped(org, delivered.id, actor);
  await db.update(shipments).set({ deliveredAt: new Date() }).where(eq(shipments.id, delivered.id));
  const unrelated = (await savedShipment(delivered.id))!;
  await voidUpsLabel(org, f.purchaseId, actor);
  const result = await postReopen(f.shipmentId);
  expect(result.body).toEqual(expect.objectContaining({ success: true }));
  expect(await db.select({ status: shipments.status, deliveredAt: shipments.deliveredAt }).from(shipments).where(eq(shipments.id, delivered.id))).toEqual([{ status: 'SHIPPED', deliveredAt: unrelated.deliveredAt }]);
  expect((await savedShipment(delivered.id))!.items).toEqual(unrelated.items);
  expect((await fulfillment.getBulkOrderContext(org, f.order.id, 'admin')).physical[0].projection).toMatchObject({ shippedQuantity: 6, remainingQuantity: 4, readyWaitingQuantity: 4 });
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].fulfillmentStatus).toBe('packed');
  expect((await savedShipment(result.body.data.replacementShipmentId))!.items[0].quantity).toBe(4);
});

test('a failed audit write rolls back the original status, draft and quantity changes', async () => {
  const f = await fixture(); await voidUpsLabel(org, f.purchaseId, actor);
  await db.execute(sql`create function qa_reject_repack() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end; $$`);
  await db.execute(sql`create trigger qa_reject_repack before insert on fulfillment_events for each row when (new.payload_json->>'sourceRetired' = 'true') execute function qa_reject_repack()`);
  try {
    expect((await postReopen(f.shipmentId)).status).toBe(500);
    expect(await db.select({ status: shipments.status }).from(shipments).where(eq(shipments.primaryOrderId, f.order.id))).toEqual([{ status: 'SHIPPED' }]);
    expect((await fulfillment.getBulkOrderContext(org, f.order.id, 'admin')).physical[0].projection).toMatchObject({ shippedQuantity: 10, remainingQuantity: 0, readyWaitingQuantity: 0 });
  } finally {
    await db.execute(sql`drop trigger qa_reject_repack on fulfillment_events`);
    await db.execute(sql`drop function qa_reject_repack()`);
  }
});

async function allocateBoxes(shipmentId: string, orderId: string, lineId: string, quantities: number[]) {
  const draft = (await savedShipment(shipmentId))!;
  const boxes = [...draft.packages];
  for (let index = boxes.length; index < quantities.length; index++) {
    boxes.push(await fulfillment.createShipmentPackage(org, shipmentId, { ...measurements, actorUserId: actor }));
  }
  await fulfillment.patchShipment(org, shipmentId, { shipmentItems: quantities.map((quantity, index) => ({
    orderId, orderLineItemId: lineId, quantity, packageId: boxes[index].id,
  })), actorUserId: actor });
  return boxes;
}

const trackingPath = (id: string) => `/api/fulfillment/shipments/${id}/package-tracking`;
const saveTracking = async (id: string, packages: ManualPackageTracking[]) => {
  const before = (await savedShipment(id))!;
  return request(app()).patch(trackingPath(id)).send({ packages, clientRequestId: randomUUID(), expectedUpdatedAt: before.updatedAt.toISOString() });
};

test('the reversed UPS shipment stays historical while two external boxes ship and reach the portal', async () => {
  const f = await fixture();
  await db.update(orders).set({ state: 'closed', status: 'completed', canonicalState: 'completed', routingTarget: null }).where(eq(orders.id, f.order.id));
  await voidUpsLabel(org, f.purchaseId, actor);
  const reopened = await postReopen(f.shipmentId);
  expect(reopened.status).toBe(200);
  const id = reopened.body.data.replacementShipmentId;
  const boxes = await allocateBoxes(id, f.order.id, f.line.id, [4, 6]);
  const outbound = mockFetch.mock.calls.length;
  expect((await saveTracking(id, [{ packageId: boxes[0].id, carrier: 'UPS', trackingNumber: f.tracking }])).body.code).toBe('DUPLICATE_PACKAGE_TRACKING');
  const numbers = ['1ZEXTERNALBOX00001', '1ZEXTERNALBOX00002'];
  const saved = await saveTracking(id, boxes.map((box, i) => ({ packageId: box.id, carrier: 'UPS', trackingNumber: numbers[i] })));
  expect(saved.status).toBe(200);
  expect(saved.body.data.reversal).toMatchObject({ originalShipmentId: f.shipmentId, replacementShipmentId: id });
  expect((await savedShipment(id))!.trackingPackages.map(track => [track.packageId, track.trackingNumber, track.source, track.status])).toEqual(
    boxes.map((box, i) => [box.id, numbers[i], 'manual', 'unavailable']),
  );
  const portal = async () => {
    const [order] = await db.select().from(orders).where(eq(orders.id, f.order.id));
    return buildFulfillmentSummary(order, (await loadPortalShipments(org, customerId, [f.order.id])).get(f.order.id) ?? [], null);
  };
  expect((await portal()).trackingPackages).toEqual([]);
  expect((await request(app()).post(`/api/fulfillment/shipments/${id}/mark-shipped`)).status).toBe(200);
  expect((await request(app()).post(`/api/fulfillment/shipments/${id}/mark-shipped`)).status).toBeGreaterThanOrEqual(400);
  expect(mockFetch).toHaveBeenCalledTimes(outbound);
  expect((await portal()).trackingPackages!.map(track => track.trackingNumber)).toEqual(numbers);
  expect((await portal()).trackingNumber).toBeNull();
  const email = jest.spyOn(emailService, 'sendEmail').mockResolvedValue('synthetic-message');
  try {
    const notification = `/api/orders/${f.order.id}/send-shipping-email`;
    expect((await request(app()).post(notification).send({ shipmentId: f.shipmentId })).status).toBe(409);
    expect(email).not.toHaveBeenCalled();
    expect((await request(app()).post(notification).send({ shipmentId: id })).status).toBe(200);
    expect(email).toHaveBeenCalledTimes(1);
    const content = email.mock.calls[0][1].html;
    for (const number of numbers) expect(content).toContain(number);
    expect(content).not.toContain(f.tracking);
    expect(content).toContain('<td>10</td>');
  } finally { email.mockRestore(); }
  expect((await savedShipment(f.shipmentId))!).toMatchObject({ status: 'VOIDED', trackingNumber: f.tracking, trackingPackages: [] });
  const document = await fulfillment.getShipmentDocument(org, id, 'shipment_manifest');
  expect(document.packages.map(box => [box.id, box.trackingNumber, box.lines[0].quantity])).toEqual(boxes.map((box, i) => [box.id, numbers[i], i ? 6 : 4]));
  const ticket = renderShippingDocumentHtml(document, 'package_ticket', { packageId: boxes[1].id });
  expect(ticket).toContain(numbers[1]); expect(ticket).not.toContain(numbers[0]);
  expect((await fulfillment.getShipmentDocument(org, f.shipmentId, 'shipment_manifest')).historical).toBe(true);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId, f.order.id))).toEqual([f.job]);
  expect(await db.select().from(invoices).where(eq(invoices.id, f.invoice.id))).toEqual([f.invoice]);
  expect(await db.select().from(payments).where(eq(payments.id, f.payment.id))).toEqual([f.payment]);
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].state).toBe('closed');
});

test('three manual boxes preserve package identity, partial shipments and a single audited correction', async () => {
  const f = await fixture(4);
  const draft = await makeDraft(f.order.id, f.line.id, 6);
  const boxes = await allocateBoxes(draft.id, f.order.id, f.line.id, [2, 2, 2]);
  const packages: ManualPackageTracking[] = boxes.map((box, i) => ({ packageId: box.id, carrier: i === 2 ? 'FedEx' : 'UPS', trackingNumber: `EXTERNAL30000${i}` }));
  const version = (await savedShipment(draft.id))!.updatedAt.toISOString();
  const body = { clientRequestId: randomUUID(), expectedUpdatedAt: version, packages };
  expect((await request(app(randomUUID())).patch(trackingPath(draft.id)).send(body)).status).toBe(404);
  expect((await saveTracking(draft.id, [{ ...packages[0], packageId: randomUUID() }])).body.code).toBe('INVALID_PACKAGE');
  expect((await saveTracking(draft.id, [packages[0], { ...packages[1], trackingNumber: packages[0].trackingNumber }])).body.code).toBe('DUPLICATE_PACKAGE_TRACKING');
  expect((await request(app()).patch(trackingPath(draft.id)).send(body)).status).toBe(200);
  expect((await request(app()).patch(trackingPath(draft.id)).send(body)).status).toBe(200);
  const correction = [{ ...packages[0], trackingNumber: 'CORRECTED001' }];
  expect((await request(app()).patch(trackingPath(draft.id)).send({ ...body, clientRequestId: randomUUID(), packages: correction })).body.code).toBe('DRAFT_STALE');
  expect((await saveTracking(draft.id, correction)).status).toBe(200);
  const updates = await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, draft.id), sql`${fulfillmentEvents.payloadJson}->>'action' = 'manual_package_tracking_changed'`));
  expect(updates).toHaveLength(2);
  expect(updates.map(event => event.payloadJson)).toContainEqual(expect.objectContaining({ packages: [expect.objectContaining({ before: { carrier: 'UPS', trackingNumber: packages[0].trackingNumber }, after: { carrier: 'UPS', trackingNumber: correction[0].trackingNumber } })] }));
  await fulfillment.markShipmentShipped(org, draft.id, actor);
  expect((await savedShipment(draft.id))!.trackingPackages.map(track => track.trackingNumber)).toEqual([correction[0].trackingNumber, packages[1].trackingNumber, packages[2].trackingNumber]);
  expect((await savedShipment(f.shipmentId))!.trackingPackages[0].trackingNumber).toBe(f.tracking);
});

test('single external box dispatches after allocation without contacting UPS', async () => {
  const f = await fixture(4);
  const draft = await makeDraft(f.order.id, f.line.id, 6);
  const [box] = (await savedShipment(draft.id))!.packages;
  const number = '1ZEXTERNALSINGLE01';
  const outbound = mockFetch.mock.calls.length;
  await fulfillment.patchShipment(org, draft.id, { shipmentItems: [], actorUserId: actor });
  expect((await saveTracking(draft.id, [{ packageId: box.id, carrier: 'UPS', trackingNumber: number }])).status).toBe(200);
  expect((await request(app()).post(`/api/fulfillment/shipments/${draft.id}/mark-shipped`)).status).toBeGreaterThanOrEqual(400);
  await allocateBoxes(draft.id, f.order.id, f.line.id, [6]);
  expect((await request(app()).post(`/api/fulfillment/shipments/${draft.id}/mark-shipped`)).status).toBe(200);
  expect((await savedShipment(draft.id))!).toMatchObject({ trackingNumber: number, trackingPackages: [{ trackingNumber: number, source: 'manual' }] });
  expect(mockFetch).toHaveBeenCalledTimes(outbound);
});

test('one manual box and two purchased boxes can ship together with canonical UPS mapping and archive', async () => {
  const f = await fixture(); await voidUpsLabel(org, f.purchaseId, actor);
  const reopened = await postReopen(f.shipmentId);
  expect(reopened.status).toBe(200);
  const id = reopened.body.data.replacementShipmentId;
  const boxes = await allocateBoxes(id, f.order.id, f.line.id, [3, 3, 4]);
  const manual = { packageId: boxes[0].id, carrier: 'FedEx', trackingNumber: '998877665544' } as const;
  expect((await saveTracking(id, [manual])).status).toBe(200);
  const bought = await purchase(id);
  expect(bought.labels).toHaveLength(2);
  const labels = await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, bought.attemptId)).orderBy(upsPackageLabels.providerResultOrdinal);
  await expect(verifyUpsPackageLabelMapping(org, id, bought.attemptId, actor,
    labels.map((label, i) => ({ labelId: label.id, packageId: boxes[i].id })))).rejects.toMatchObject({ code: 'UPS_MAPPING_INCOMPLETE' });
  await verifyUpsPackageLabelMapping(org, id, bought.attemptId, actor, labels.map((label, i) => ({ labelId: label.id, packageId: boxes[i + 1].id })));
  expect((await readUpsLabelArchive(org, id, bought.attemptId)).map(label => label.packageId)).toEqual(boxes.slice(1).map(box => box.id));
  expect((await saveTracking(id, [{ ...manual, trackingNumber: '998877665545' }])).status).toBe(200);
  expect((await saveTracking(id, [{ ...manual, packageId: boxes[1].id }])).body.code).toBe('UPS_LABEL_LOCKED');
  await fulfillment.markShipmentShipped(org, id, actor);
  expect((await savedShipment(id))!.trackingPackages.map(track => [track.packageId, track.source])).toEqual(boxes.map((box, i) => [box.id, i ? 'purchased' : 'manual']));
});
