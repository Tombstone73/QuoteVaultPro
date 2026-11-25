import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { resolveFulfillmentLineQuantity, summarizeFulfillmentOrderQuantities } from '@shared/fulfillmentReadiness';
import { fulfillmentReadyQuantityAdjustmentHttpSchema } from '../services/fulfillment/schemas';
import { executePhysicalReadinessAdjustment, previewPhysicalReadinessAdjustment } from '../services/assistant/physicalReadinessAdjustment';
import type { OrderFulfillmentNativeReadDetail } from '../services/assistant/orderFulfillmentReadinessRead';
import type { PhysicalReadinessAdjustmentReceipt } from '../services/assistant/physicalReadinessAdjustment';
import type { FulfillmentService } from '../services/fulfillment/service';
import type { canonicalFulfillmentOperations } from '../services/fulfillment/canonicalFulfillmentOperations';

// Real HTTP schema/routes + actual native service/role guard + real assistant
// adapter. Only persistence/auth middleware/read DTOs are synthetic. This is not
// PostgreSQL locking, transaction-isolation, or browser/provider verification.
const org = 'synthetic-org', orderId = '223d4ed0-2aa4-4dc0-b4b7-0191556bb230', user = 'synthetic-operator';
const key = '11111111-1111-4111-8111-111111111111';
const reason = 'Synthetic inspection confirmed these physical units';
const receipts = new Map<string, PhysicalReadinessAdjustmentReceipt>();
let ready: number, receiptReadFails: boolean;
const receiptQueries: Array<{ sql: string; params: unknown[] }> = [];
const select = jest.fn(() => {
  let params: unknown[] = [];
  const chain = { from: () => chain, where: (predicate: SQL) => {
    const query = new PgDialect().sqlToQuery(predicate); receiptQueries.push(query); params = query.params; return chain;
  }, limit: async () => {
    if (receiptReadFails) throw new Error('Synthetic receipt read unavailable');
    const stored = params[0] === org && params[1] === orderId && params[2] === 'FULFILLMENT_READY' ? receipts.get(String(params[3])) : null;
    return stored ? [{ payload: stored.payload }] : [];
  } };
  return chain;
});
jest.unstable_mockModule('../db', () => ({ db: { select }, pool: {},
  hasQuoteAttachmentPagesTable: () => false, hasPageCountStatusColumn: () => false, probeDatabaseSchema: async () => undefined }));
jest.unstable_mockModule('../storage', () => ({ storage: {} }));
jest.unstable_mockModule('../fulfillmentService', () => ({ updateOrderFulfillmentStatus: jest.fn(), sendShipmentEmail: jest.fn() }));
jest.unstable_mockModule('../tenantContext', () => ({ DEFAULT_ORGANIZATION_ID: 'synthetic-unused-default',
  getRequestOrganizationId: (req: { organizationId: string }) => req.organizationId }));
let service: FulfillmentService;
let native: typeof canonicalFulfillmentOperations;
let nativeAdjust: { mockClear(): unknown; mock: { calls: Parameters<typeof canonicalFulfillmentOperations.adjustReadyQuantities>[] } };

function detail(): OrderFulfillmentNativeReadDetail {
  const projection = resolveFulfillmentLineQuantity({ orderedQuantity: 10, readyWaitingQuantity: ready,
    workflowState: 'in_production', activeOwnerStationKey: 'print', activeOwnerStatus: 'in_progress' });
  return { ...summarizeFulfillmentOrderQuantities([projection]), orderId, orderNumber: 'SYNTHETIC-1', customerName: 'Synthetic',
    fulfillmentType: 'SHIP', status: 'IN_PRODUCTION', itemsRemaining: '10 units', readySince: null, shipTo: 'Synthetic',
    overdue: false, isArchived: false, productionJobs: [], customer: { name: 'Synthetic', email: null, phone: null },
    permissions: { canConfirmPhysicalReadiness: true, canRevertStatus: false, revertPermission: 'fulfillment.revert_status' },
    lineItems: [{ id: 'line-1', productName: 'Synthetic', description: null, productType: null, quantity: 10, size: null, materialName: null,
      optionSummary: [], finishing: { requirements: [], lamination: null },
      production: { ...projection, jobId: null, stationKey: 'print', stationLabel: 'Printing', completedAt: null,
        eligible: false, availableForAllocationQuantity: ready }, artwork: [],
      checklist: { id: '', checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } }],
    checklistComplete: false, checklistSummary: { total: 1, checked: 0, unchecked: 1 }, productionSummary: [],
    pickupTicket: null, operationalPickupDate: '2026-11-20', pickupHandoffs: [], shipments: [], events: [],
  };
}

const repositoryAdjust = jest.fn(async (organizationId: string, target: string,
  items: Array<{ orderLineItemId: string; quantityDelta: number }>, actor: string, note: string,
  options: { clientRequestId?: string; expectedReadyByLine?: Record<string, number>; requireProductionComplete?: boolean; stockConfirmation?: boolean } = {}) => {
  if (organizationId !== org || target !== orderId) return { ok: false, code: 'NOT_FOUND', message: 'Order not found' };
  // Deliberately reproduce native key-only dedup before CAS. The HTTP postcheck
  // must defend this even though persistence itself does not bind the payload.
  if (options.clientRequestId && receipts.has(options.clientRequestId)) return { ok: true };
  if (options.expectedReadyByLine && items.some(item => options.expectedReadyByLine![item.orderLineItemId] !== ready))
    return { ok: false, code: 'READINESS_CHANGED', message: 'Ready quantities changed after review' };
  const previous = ready, delta = items.reduce((total, item) => total + item.quantityDelta, 0);
  if (ready + delta > 10 || ready + delta < 0) return { ok: false, code: 'QTY_EXCEEDS_ORDER', message: 'Quantity exceeds bounds' };
  ready += delta;
  if (options.clientRequestId) receipts.set(options.clientRequestId, { id: 'synthetic-native-event', payload: {
    clientRequestId: options.clientRequestId, operatorUserId: actor, reason: note,
    source: options.stockConfirmation ? 'operator_stock_confirmation' : 'operator_physical_confirmation',
    adjustments: items.map(item => ({ ...item, previousReadyQuantity: previous, nextReadyQuantity: previous + item.quantityDelta })),
  } });
  return { ok: true };
});
const app = express(); app.use(express.json());
beforeAll(async () => {
  const { FulfillmentService } = await import('../services/fulfillment/service');
  native = (await import('../services/fulfillment/canonicalFulfillmentOperations')).canonicalFulfillmentOperations;
  const { registerFulfillmentRoutes } = await import('../routes/fulfillment.routes');
  service = new FulfillmentService({ dashboardRepo: { adjustReadyQuantities: repositoryAdjust } as never,
    shipmentRepo: {} as never, pickupRepo: {} as never, dbInstance: {} as never });
  nativeAdjust = jest.spyOn(native, 'adjustReadyQuantities').mockImplementation((...args) => service.adjustReadyQuantities(...args));
  jest.spyOn(service, 'getOrderDetail').mockImplementation(async () => detail() as Awaited<ReturnType<typeof service.getOrderDetail>>);
  registerFulfillmentRoutes(app, {
  isAuthenticated: (req: any, res: any, next: any) => {
    if (req.get('Test-Auth') !== 'staff') return res.sendStatus(401);
    req.user = { id: req.get('Test-Actor') || user }; next();
  },
  tenantContext: (req: any, _res: any, next: any) => { req.organizationId = req.get('Test-Org') || org; req.orgRole = req.get('Test-Role') || 'employee'; next(); },
  requireOrgOwnerAdmin: (_req: any, _res: any, next: any) => next(),
  });
});
const payload = () => ({ items: [{ orderLineItemId: 'line-1', quantityDelta: 2 }], reason,
  expectedReadyByLine: { 'line-1': 0 }, clientRequestId: key });
const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) => request(app)
  .post(`/api/fulfillment/orders/${orderId}/ready-quantities`).set({ 'Test-Auth': 'staff', ...headers }).send(body);

beforeEach(() => { ready = 0; receiptReadFails = false; receipts.clear(); receiptQueries.length = 0;
  repositoryAdjust.mockClear(); nativeAdjust.mockClear(); select.mockClear(); });

describe('reviewed human/native physical quantity parity', () => {
  test('keyed stock confirmation replays without a ready-pool snapshot but not as a physical correction', async () => {
    const stock = { action: 'confirm_stock', clientRequestId: key, items: payload().items };
    expect((await post(stock)).status).toBe(200);
    expect((await post(stock)).status).toBe(200);
    expect((await post({ ...payload(), reason: 'Physical stock confirmed in Fulfillment' })).body.code).toBe('READY_REQUEST_CONFLICT');
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });
  test('legacy no-options callers remain unkeyed additive native operations', async () => {
    const legacy = { items: payload().items, reason };
    expect(fulfillmentReadyQuantityAdjustmentHttpSchema.parse(legacy)).toEqual(legacy);
    expect((await post(legacy)).status).toBe(200); expect((await post(legacy)).status).toBe(200);
    expect(ready).toBe(4); expect(repositoryAdjust.mock.calls[0]).toHaveLength(5); expect(select).not.toHaveBeenCalled();
  });

  test('optional expected-ready without a retry UUID opts into CAS and does not enable production guard', async () => {
    const { clientRequestId: _key, ...body } = payload();
    expect((await post(body)).status).toBe(200);
    expect(repositoryAdjust.mock.calls[0][5]).toEqual({ clientRequestId: undefined, expectedReadyByLine: { 'line-1': 0 }, requireProductionComplete: undefined });
    expect((await post(body)).body.code).toBe('READINESS_CHANGED'); expect(ready).toBe(2);
  });

  test('reviewed HTTP preserves exact native inputs, replays one event, and scopes receipt read to tenant/order/key', async () => {
    expect((await post(payload())).status).toBe(200); expect((await post(payload())).status).toBe(200);
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
    expect(nativeAdjust.mock.calls[0][2]).toEqual(payload());
    for (const query of receiptQueries) {
      expect(query.params).toEqual([org, orderId, 'FULFILLMENT_READY', key]);
      expect(query.sql).toContain('"fulfillment_events"."organization_id"'); expect(query.sql).toContain('"fulfillment_events"."entity_id"');
    }
  });

  test('reviewed HTTP also preserves native negative quantity correction and its exact replay', async () => {
    ready = 3;
    const correction = { ...payload(), items: [{ orderLineItemId: 'line-1', quantityDelta: -1 }], expectedReadyByLine: { 'line-1': 3 } };
    expect((await post(correction)).status).toBe(200); expect((await post(correction)).status).toBe(200);
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });

  test('same UUID cannot silently acknowledge changed quantity, reason, expected value, line or actor', async () => {
    await post(payload());
    for (const body of [
      { ...payload(), items: [{ orderLineItemId: 'line-1', quantityDelta: 1 }] },
      { ...payload(), reason: 'Different physical inspection reason' },
      { ...payload(), expectedReadyByLine: { 'line-1': 2 } },
      { ...payload(), items: [{ orderLineItemId: 'other-line', quantityDelta: 2 }], expectedReadyByLine: { 'other-line': 0 } },
    ]) {
      const result = await post(body); expect(result.status).toBe(409); expect(result.body.code).toBe('READY_REQUEST_CONFLICT');
    }
    expect((await post(payload(), { 'Test-Actor': 'other-operator' })).body.code).toBe('READY_REQUEST_CONFLICT');
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });

  test('key reuse cannot downgrade away its expectation; mismatched, duplicate, extra, unbounded or unsafe inputs never reach native writes', async () => {
    const invalid = [
      { ...payload(), expectedReadyByLine: undefined }, { ...payload(), clientRequestId: 'not-uuid' },
      { ...payload(), expectedReadyByLine: {} }, { ...payload(), expectedReadyByLine: { 'other-line': 0 } },
      { ...payload(), expectedReadyByLine: { 'line-1': 0, 'other-line': 0 } },
      { ...payload(), expectedReadyByLine: { 'line-1': -1 } }, { ...payload(), expectedReadyByLine: { 'line-1': 0.5 } },
      { ...payload(), expectedReadyByLine: { 'line-1': 2147483648 } },
      { ...payload(), items: [...payload().items, ...payload().items] },
      { ...payload(), items: [{ orderLineItemId: 'line-1', quantityDelta: 2147483648 }] },
      { ...payload(), expectedReadyByLine: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`line-${i}`, 0])) },
      { ...payload(), requireProductionComplete: false }, { ...payload(), organizationId: 'foreign' },
    ];
    for (const body of invalid) expect((await post(body)).status).toBe(400);
    expect(nativeAdjust).not.toHaveBeenCalled(); expect(ready).toBe(0);
  });

  test('real native service authorization still precedes receipt access and no foreign tenant receives retry evidence', async () => {
    expect((await post(payload(), { 'Test-Role': 'member' })).status).toBe(403);
    expect((await post(payload(), { 'Test-Org': 'foreign-org' })).status).toBe(404);
    expect(select).not.toHaveBeenCalled(); expect(ready).toBe(0);
  });

  test('concurrent changed payloads with one key produce one success, one conflict and no second physical adjustment', async () => {
    const results = await Promise.all([post(payload()), post({ ...payload(), reason: 'Other concurrent inspection reason' })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(results.find(result => result.status === 409)!.body.code).toBe('READY_REQUEST_CONFLICT');
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });

  test('post-write receipt failure is explicitly unverified, and the exact same retry cannot add quantity', async () => {
    receiptReadFails = true;
    const unknown = await post(payload()); expect(unknown.status).toBe(503); expect(unknown.body.code).toBe('READY_OUTCOME_UNVERIFIED');
    expect(ready).toBe(2); receiptReadFails = false;
    expect((await post(payload())).status).toBe(200); expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });

  test('malformed durable evidence never becomes a successful HTTP acknowledgement', async () => {
    await post(payload()); receipts.get(key)!.payload.adjustments[0].nextReadyQuantity = Number.NaN;
    const result = await post(payload()); expect(result.status).toBe(503); expect(result.body.code).toBe('READY_OUTCOME_UNVERIFIED');
    expect(ready).toBe(2); expect(receipts.size).toBe(1);
  });

  test('human HTTP and assistant supply the same native CAS, and both reject equivalent stale reviewed quantity', async () => {
    const scope = { organizationId: org, userId: user, orderId };
    const dependencies = { verifyNativeReadAuthority: async () => ({ organizationId: org, userId: user, organizationRole: 'employee' }),
      readDetail: async () => detail(), adjustReadyQuantities: native.adjustReadyQuantities.bind(native),
      readReceipt: async (_org: string, _order: string, id: string) => receipts.get(id) ?? null };
    const preview = await previewPhysicalReadinessAdjustment(scope, { orderLineItemId: 'line-1', quantityDelta: 2, reason }, dependencies);
    expect((await post(payload())).status).toBe(200);
    const humanCall = structuredClone(nativeAdjust.mock.calls[0][2]);
    ready = 0; receipts.clear();
    await executePhysicalReadinessAdjustment(scope, preview, { clientRequestId: key }, dependencies);
    expect(nativeAdjust.mock.calls[1][2]).toEqual(humanCall);
    receipts.clear(); ready = 1;
    expect((await post(payload())).body.code).toBe('READINESS_CHANGED');
    await expect(executePhysicalReadinessAdjustment(scope, preview, { clientRequestId: key }, dependencies)).rejects.toMatchObject({ code: 'READINESS_CHANGED' });
    expect(ready).toBe(1); expect(receipts.size).toBe(0);
  });
});
