import { afterAll, beforeEach, expect, jest, test } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { customers, fulfillmentEvents, invoices, orders, organizations, shipmentOrders, shipmentPackages, shipments,
  upsLabelPurchases, upsPackageLabels, upsShipmentRateQuotes, users } from '@shared/schema';

const realConnection = await import('../services/ups/upsConnection');
const credentials = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../services/ups/upsConnection', () => ({
  ...realConnection, upsRateCredentials: credentials, upsEnvironmentMode: () => 'live',
}));
const { registerFulfillmentRoutes } = await import('../routes/fulfillment.routes');
const { ShipmentRepo } = await import('../services/fulfillment/repository');
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
let org: string, actor: string, shipmentId: string, purchaseId: string, orderId: string;
let app: express.Express;
const tracks = ['1ZTEST000000000001', '1ZTEST000000000002'];
const bytes = Buffer.from('original GIF label evidence');
function application(organizationId = org, authorized = true) {
  const instance = express(); instance.use(express.json());
  registerFulfillmentRoutes(instance, {
    isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: actor }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = organizationId; next(); },
    requireOrgOwnerAdmin: (_req: any, res: any, next: any) => authorized ? next() : res.status(403).json({ success: false }),
  }); return instance;
}
const endpoint = () => `/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchaseId}/void`;
const externalEndpoint = () => endpoint().replace(/void$/, 'external-cancellation');
const response = (codes = ['1', '1']) => ({ VoidShipmentResponse: {
  Response: { ResponseStatus: { Code: '1' } }, SummaryResult: { Status: { Code: '1' } },
  PackageLevelResults: codes.map((code, i) => ({ TrackingNumber: tracks[i], Status: { Code: code } })),
} });
const carrier = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const purchase = async () => (await db.select().from(upsLabelPurchases).where(eq(upsLabelPurchases.id, purchaseId)))[0];
const shipment = async () => (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
const postVoid = () => request(app).post(endpoint());
const labelRows = () => db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId, purchaseId));

beforeEach(async () => {
  org = `ups-void-${randomUUID()}`; actor = randomUUID(); shipmentId = randomUUID(); purchaseId = randomUUID(); orderId = randomUUID();
  credentials.mockReset(); credentials.mockResolvedValue({ row: { mode: 'live' }, baseUrl: 'https://ups.invalid', token: 'synthetic', accountNumber: 'TEST' });
  fetchMock.mockReset(); fetchMock.mockResolvedValue(carrier(response())); globalThis.fetch = fetchMock;
  await db.insert(organizations).values({ id: org, name: 'UPS isolated QA', slug: org });
  await db.insert(users).values({ id: actor, email: `${actor}@example.invalid`, role: 'admin' });
  const [customer] = await db.insert(customers).values({ organizationId: org, companyName: 'UPS QA buyer' }).returning();
  await db.insert(orders).values({ id: orderId, organizationId: org, orderNumber: `QA-${randomUUID()}`, customerId: customer.id,
    status: 'completed', shippingMethod: 'ship', createdByUserId: actor, shippingCents: 1700 });
  await db.insert(invoices).values({ organizationId: org, orderId, customerId: customer.id, invoiceNumber: 1, createdByUserId: actor, status: 'paid', totalCents: 50000, total: '500.00', amountPaid: '500.00', balanceDue: '0.00' });
  await db.insert(shipments).values({ id: shipmentId, organizationId: org, orderId, primaryOrderId: orderId,
    status: 'SHIPPED', scope: 'SINGLE_ORDER', carrier: 'UPS', trackingNumber: tracks[0], carrierShipmentId: tracks[0], createdByUserId: actor });
  await db.insert(shipmentOrders).values({ organizationId: org, shipmentId, orderId });
  const [quote] = await db.insert(upsShipmentRateQuotes).values({ organizationId: org, shipmentId, environment: 'live',
    requestFingerprint: 'a'.repeat(64), rates: [], expiresAt: new Date(Date.now() + 60000) }).returning();
  await db.insert(upsLabelPurchases).values({ id: purchaseId, organizationId: org, shipmentId, quoteId: quote.id, environment: 'live',
    status: 'PURCHASED', serviceCode: '03', serviceName: 'UPS Ground', estimateCents: 1700, estimateCurrency: 'USD', carrierCostCents: 1600,
    carrierCurrency: 'USD', providerShipmentId: tracks[0], providerTransactionId: randomUUID().replaceAll('-', ''), requestFingerprint: 'a'.repeat(64),
    providerEvidence: { originalPurchase: 'preserved' }, createdByUserId: actor, purchasedAt: new Date() });
  for (let i = 0; i < 2; i++) {
    const [pkg] = await db.insert(shipmentPackages).values({ organizationId: org, shipmentId, ordinal: i + 1, packageReference: `BOX-${i + 1}` }).returning();
    await db.insert(upsPackageLabels).values({ organizationId: org, purchaseId, packageId: pkg.id, providerResultOrdinal: i + 1,
      trackingNumber: tracks[i], labelFormat: 'GIF', labelBytes: bytes, labelSha256: createHash('sha256').update(bytes).digest('hex') });
  }
  app = application();
});
afterAll(async () => { globalThis.fetch = originalFetch; await pool.end(); });

test('route → canonical void → durable readback preserves shipped state, original labels, Order, Invoice and audit', async () => {
  const before = await shipment(); const labels = await labelRows();
  const beforeOrder = await db.select().from(orders).where(eq(orders.id, orderId));
  const beforeInvoice = await db.select().from(invoices).where(eq(invoices.organizationId, org));
  const result = await postVoid(); expect(result.status).toBe(200); expect(result.body.data.status).toBe('VOID_ACCEPTED');
  expect(await shipment()).toEqual(before); expect(await labelRows()).toEqual(labels);
  const stored = await request(app).get(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchaseId}/labels/${labels[0].id}/image`);
  expect(stored.status).toBe(200); expect(Buffer.from(stored.body)).toEqual(bytes);
  expect((await request(application('other')).get(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchaseId}/labels/${labels[0].id}/image`)).status).toBe(404);
  expect(await db.select().from(orders).where(eq(orders.id, orderId))).toEqual(beforeOrder);
  expect(await db.select().from(invoices).where(eq(invoices.organizationId, org))).toEqual(beforeInvoice);
  const saved = await purchase(); expect(saved.voidAcceptedAt).toBeInstanceOf(Date);
  expect(saved.providerEvidence).toMatchObject({ originalPurchase: 'preserved', voidResult: { outcome: 'ACCEPTED', packages: [
    { trackingNumber: tracks[0], code: '1' }, { trackingNumber: tracks[1], code: '1' }] } });
  const history = await request(app).get(`/api/fulfillment/shipments/${shipmentId}/ups-labels`);
  expect(history.body.data[0]).toMatchObject({ status: 'VOID_ACCEPTED', labels: expect.arrayContaining([expect.objectContaining({ trackingNumber: tracks[0] })]) });
  const events = await db.select().from(fulfillmentEvents).where(eq(fulfillmentEvents.organizationId, org));
  expect(events.map(event => (event.payloadJson as any).action)).toEqual(['ups_label_void_requested', 'ups_label_void_accepted']);
  expect(fetchMock.mock.calls[0][0]).toContain(`/api/shipments/v2409/void/cancel/${tracks[0]}`);
});
test('already-voided provider result and repeated clicks cannot call UPS twice', async () => {
  expect((await postVoid()).status).toBe(200); credentials.mockRejectedValue(new Error('Disconnected'));
  expect((await postVoid()).status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('ineligible labels retain confirmed purchase and can be deliberately retried after correction', async () => {
  fetchMock.mockResolvedValueOnce(carrier({ response: { errors: [{ code: '190100' }] } }, 400));
  expect((await postVoid()).body.code).toBe('UPS_VOID_REJECTED'); expect((await purchase()).status).toBe('PURCHASED');
  expect((await postVoid()).status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(2);
});
test('timeout remains uncertain; no retry, local reversal or replacement unlock without UPS reconciliation', async () => {
  fetchMock.mockRejectedValueOnce(new DOMException('Synthetic timeout', 'TimeoutError'));
  expect((await postVoid()).body.code).toBe('UPS_VOID_UNCERTAIN'); expect((await purchase()).voidAcceptedAt).toBeNull();
  expect((await postVoid()).status).toBe(409); expect(fetchMock).toHaveBeenCalledTimes(1);
  const result = await new ShipmentRepo().reverseTerminalFulfillment(org, { sourceType: 'SHIPMENT', sourceId: shipmentId,
    reason: 'QA', items: [{ orderLineItemId: randomUUID(), quantity: 1 }], actorUserId: actor });
  expect(result).toMatchObject({ ok: false, code: 'UPS_VOID_UNRESOLVED' });
  expect((await request(app).post(externalEndpoint()).send({ reason: 'Unknown still' })).body.code).toBe('UPS_VOID_RECONCILIATION_REQUIRED');
});
test('partial multi-package void records exact results and requires confirmation of every UPS tracking identity', async () => {
  fetchMock.mockResolvedValueOnce(carrier(response(['1', '0'])));
  expect((await postVoid()).body.code).toBe('UPS_VOID_UNCERTAIN'); expect((await purchase()).status).toBe('VOID_UNCERTAIN');
  const input = { reason: 'Confirmed with UPS support', reference: 'QA-confirmation', confirmedTrackingNumbers: [tracks[0]] };
  expect((await request(app).post(externalEndpoint()).send(input)).status).toBe(409);
  expect((await request(app).post(externalEndpoint()).send({ ...input, confirmedTrackingNumbers: tracks })).status).toBe(200);
  expect((await purchase()).status).toBe('EXTERNAL_CANCEL_REPORTED'); expect((await purchase()).voidAcceptedAt).toBeNull();
  expect((await shipment()).status).toBe('SHIPPED'); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('concurrent duplicate clicks serialize before the one external call', async () => {
  let release!: (response: Response) => void; let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  fetchMock.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const first = postVoid().then(result => result); await began;
  try { expect((await postVoid()).status).toBe(409); expect(fetchMock).toHaveBeenCalledTimes(1); }
  finally { release(carrier(response())); }
  expect((await first).status).toBe(200);
});
test('tenant, shipment identity, environment and existing owner/admin permission are enforced', async () => {
  expect((await request(application(org, false)).post(endpoint())).status).toBe(403);
  expect((await request(application('other-tenant')).post(endpoint())).status).toBe(404);
  expect((await request(app).post(endpoint().replace(shipmentId, randomUUID()))).status).toBe(404);
  credentials.mockResolvedValue({ row: { mode: 'test' } }); expect((await postVoid()).body.code).toBe('UPS_VOID_ENVIRONMENT_MISMATCH');
  expect(fetchMock).not.toHaveBeenCalled(); expect((await purchase()).status).toBe('PURCHASED');
});
test('a late or partial response never unlocks the purchase; a crash-stuck attempt requires elapsed time and UPS confirmation', async () => {
  await db.update(upsLabelPurchases).set({ status: 'VOID_REQUESTING', voidRequestedAt: new Date() }).where(eq(upsLabelPurchases.id, purchaseId));
  const input = { reason: 'Verified all with UPS', reference: 'QA-confirmation', confirmedTrackingNumbers: tracks };
  expect((await request(app).post(externalEndpoint()).send(input)).body.code).toBe('UPS_VOID_IN_PROGRESS');
  await db.update(upsLabelPurchases).set({ voidRequestedAt: new Date(Date.now() - 180000) }).where(eq(upsLabelPurchases.id, purchaseId));
  expect((await request(app).post(externalEndpoint()).send(input)).status).toBe(200); expect(fetchMock).not.toHaveBeenCalled();
});
test('failed audit persistence cannot falsely commit accepted void', async () => {
  await db.execute(sql`create function qa_reject_ups_void_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end; $$`);
  await db.execute(sql`create trigger qa_reject_ups_void_event before insert on fulfillment_events for each row when (new.payload_json->>'action'='ups_label_void_accepted') execute function qa_reject_ups_void_event()`);
  try { expect((await postVoid()).body.code).toBe('UPS_VOID_UNCERTAIN'); expect((await purchase()).status).toBe('VOID_UNCERTAIN'); expect((await purchase()).voidAcceptedAt).toBeNull();
    expect((await purchase()).providerEvidence).toMatchObject({ voidResult: { outcome: 'ACCEPTED' } }); }
  finally { await db.execute(sql`drop trigger qa_reject_ups_void_event on fulfillment_events`); await db.execute(sql`drop function qa_reject_ups_void_event()`); }
});
test('confirmed draft void permits canonical draft correction and a new purchase identity without changing historical labels', async () => {
  await db.update(shipments).set({ status: 'DRAFT' }).where(eq(shipments.id, shipmentId));
  const repo = new ShipmentRepo();
  await expect(db.transaction(tx => repo.lockDraftShipment(org, shipmentId, tx))).rejects.toMatchObject({ code: 'UPS_LABEL_LOCKED' });
  await postVoid(); await expect(db.transaction(tx => repo.lockDraftShipment(org, shipmentId, tx))).resolves.toMatchObject({ status: 'DRAFT' });
  const old = await purchase(); const labels = await labelRows();
  await db.insert(upsLabelPurchases).values({ ...old, id: randomUUID(), status: 'REQUESTING', providerTransactionId: randomUUID().replaceAll('-', ''),
    providerShipmentId: null, voidAcceptedAt: null, voidRequestedAt: null, providerEvidence: null });
  expect(await labelRows()).toEqual(labels); expect((await purchase()).status).toBe('VOID_ACCEPTED');
});


test('late carrier completion cannot overwrite a newer explicit UPS reconciliation', async () => {
  let release!: (value: Response) => void; let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  fetchMock.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const first = postVoid().then(result => result); await began;
  try {
    const reversal = await new ShipmentRepo().reverseTerminalFulfillment(org, { sourceType: 'SHIPMENT', sourceId: shipmentId,
      reason: 'QA', items: [{ orderLineItemId: randomUUID(), quantity: 1 }], actorUserId: actor });
    expect(reversal).toMatchObject({ code: 'UPS_VOID_UNRESOLVED' });
    // Simulate elapsed process time without waiting or touching deployed records.
    await db.update(upsLabelPurchases).set({ voidRequestedAt: new Date(Date.now() - 180000) }).where(eq(upsLabelPurchases.id, purchaseId));
    expect((await request(app).post(externalEndpoint()).send({ reason: 'UPS confirmed all voided', reference: 'UPS-QA-verified', confirmedTrackingNumbers: tracks })).status).toBe(200);
  } finally { release(carrier(response())); }
  expect((await first).body.code).toBe('UPS_VOID_UNCERTAIN');
  expect((await purchase()).status).toBe('EXTERNAL_CANCEL_REPORTED'); expect((await purchase()).voidAcceptedAt).toBeNull();
});
