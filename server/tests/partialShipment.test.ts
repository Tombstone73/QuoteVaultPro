import { afterEach, expect, jest, test } from '@jest/globals';
import { shipments, shipmentItems, orders, fulfillmentEvents } from '@shared/schema';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { orderShippingContext } from '../services/fulfillment/shippingContext';
import { FulfillmentHttpError } from '../services/fulfillment/types';
const capture = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule('../services/shippingDocumentService', () => ({ getShippingDocumentSource: capture }));
const { FulfillmentDashboardRepo, ShipmentRepo } = await import('../services/fulfillment/repository');
const { FulfillmentService } = await import('../services/fulfillment/service');

afterEach(() => jest.restoreAllMocks());
function fixture(quantity: number, packageId: string | null = 'package-1', shipDate: Date | null = null, transactionErrors: unknown[] = []) {
  const shippingContext = orderShippingContext({ id: 'order-20306', shipToCompany: 'Recipient', shipToAddress1: '12 Main', shipToCity: 'Phoenix', shipToState: 'AZ', shipToPostalCode: '85001' });
  const shipment: any = { id: 'shipment-1', organizationId: 'org', status: 'DRAFT', shippingContext, shipDate, carrier: null, trackingNumber: null };
  const items = [{ id: 'item-1', orderId: 'order-20306', orderLineItemId: 'line-1', packageId, quantity }];
  const order: any = { state: 'production_complete', status: 'ready_for_shipment', fulfillmentStatus: 'packed' };
  const events: any[] = [];
  let responses: any[][] = [];
  const locks: any[] = [];
  const attempts: any[] = [];
  const db: any = {
    transaction: jest.fn(async (callback: any) => {
      responses = [[shipment], items, [{ id: 'package-1' }], [{ orderId: 'order-20306', shippingMethod: 'ship' }], [{ orderedQty: 2 }], [{ shippedQty: quantity }], [{ id: 'line-1' }], []];
      const beforeShipment = structuredClone(shipment); const beforeOrder = structuredClone(order); const eventCount = events.length;
      // structuredClone returns host-realm Dates; the serializer uses Jest's Date.
      if (shipment.shipDate) beforeShipment.shipDate = new Date(shipment.shipDate.getTime());
      attempts.push({ shipment: beforeShipment, items: structuredClone(items), events: structuredClone(events) });
      try {
        const result = await callback(db);
        const error = transactionErrors.shift();
        if (error) throw error;
        return result;
      }
      catch (error) {
        for (const key of Object.keys(shipment)) delete shipment[key];
        Object.assign(shipment, beforeShipment); Object.assign(order, beforeOrder); events.length = eventCount;
        throw error;
      }
    }), execute: async () => [],
    select: () => {
      const rows = responses.shift() ?? [];
      const chain: any = { then: (resolve: any) => Promise.resolve(rows).then(resolve), limit: async () => rows };
      for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy']) chain[method] = () => chain;
      chain.for = (...args: any[]) => { locks.push(args); return chain; };
      return chain;
    },
    update: (table: any) => ({ set: (patch: any) => {
      if (table === shipments) {
        // Exercise the actual schema encoder that failed in production.
        expect(() => shipments.shipDate.mapToDriverValue(patch.shipDate)).not.toThrow();
        if (patch.status === 'SHIPPED') expect(patch.shippedAt).toBeInstanceOf(Date);
        Object.assign(shipment, patch);
      } else { expect(table).toBe(orders); Object.assign(order, patch); }
      return { where: () => ({ returning: async () => [shipment] }) };
    } }),
    insert: (table: any) => ({ values: async (event: any) => { expect(table).toBe(fulfillmentEvents); events.push(event); } }),
  };
  capture.mockImplementation(async (orgId, shipmentId, tx, options) => {
    expect(tx).toBe(db);
    expect(options).toEqual({ captureForShipping: true });
    expect(shipment.status).toBe('DRAFT');
    return { version: 1, basis: 'shipped', shipDate: shipment.shipDate.toISOString().slice(0, 10), lines: items.map(item => ({ quantity: item.quantity })) };
  });
  const eligibility = jest.spyOn(FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockResolvedValue([{ id: 'line-1', orderId: 'order-20306', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2, productionCompleteQuantity: 2 }) }]);
  return { repo: new ShipmentRepo(db), shipment, items, order, events, eligibility, db, attempts, locks };
}

test.each([1, 2])('ships %i of 2 with blank logistics, correct package quantities, and a serializable default date', async quantity => {
  const f = fixture(quantity);
  await expect(f.repo.markShipped('org', 'shipment-1')).resolves.toMatchObject({ ok: true });
  expect(f.items[0]).toMatchObject({ quantity, packageId: 'package-1' });
  expect(f.shipment).toMatchObject({ status: 'SHIPPED', carrier: null, trackingNumber: null });
  expect(f.shipment.shipDate.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  expect(f.shipment.documentSnapshot).toMatchObject({ shipDate: f.shipment.shipDate.toISOString().slice(0, 10), lines: [{ quantity }] });
  expect(resolveFulfillmentLineQuantity({ orderedQuantity: 2, shippedQuantity: quantity }).remainingQuantity).toBe(2 - quantity);
  expect(f.order.fulfillmentStatus).toBe(quantity === 2 ? 'shipped' : 'packed');
  expect(f.order.status).toBe('ready_for_shipment'); // existing completion service decides closure
  expect(f.events[0].eventType).toBe('SHIPMENT_SHIPPED');
});

test('preserves an operator calendar date and rejects missing packages or stale over-allocation', async () => {
  const dated = fixture(1, 'package-1', new Date('2026-09-29T00:00:00Z'));
  await dated.repo.markShipped('org', 'shipment-1');
  expect(dated.shipment.shipDate.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  const unpacked = fixture(1, null);
  await expect(unpacked.repo.markShipped('org', 'shipment-1')).resolves.toMatchObject({ ok: false, code: 'INVALID_PACKAGE_ALLOCATION' });
  expect(unpacked.events).toEqual([]);
  const stale = fixture(2);
  stale.eligibility.mockResolvedValue([{ id: 'line-1', orderId: 'order-20306', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2, administrativelyReconciledQuantity: 1 }) }]);
  await expect(stale.repo.markShipped('org', 'shipment-1')).resolves.toMatchObject({ ok: false, code: 'QTY_EXCEEDS_ORDER' });
  expect(stale.events).toEqual([]);
});

test('service ships the saved partial allocation without auto-expanding it', async () => {
  const item = { orderId: 'order-20306', orderLineItemId: 'line-1', quantity: 1, packageId: 'package-1' };
  const shipmentRepo = {
    getShipmentById: jest.fn(async () => ({ status: 'DRAFT', orders: [{ orderId: 'order-20306' }], items: [item], packages: [{ id: 'package-1' }] })),
    replaceDraftShipmentItems: jest.fn(),
    markShipped: jest.fn(async () => ({ ok: true, shipment: { id: 'shipment-1', status: 'SHIPPED' } })),
  };
  const dashboardRepo = { getOrdersForCombinedShipmentValidation: async () => [{ shippingMethod: 'ship' }], listLineEligibility: async () => [{ id: 'line-1', orderId: 'order-20306', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2 }) }], logChecklistVerified: jest.fn(async () => undefined) };
  const autoCloseReconciler = jest.fn(async () => undefined);
  const service = new FulfillmentService({ shipmentRepo: shipmentRepo as any, dashboardRepo: dashboardRepo as any, dbInstance: {} as any, autoCloseReconciler: autoCloseReconciler as any });
  await service.markShipmentShipped('org', 'shipment-1', null, { suppressBillingAutomation: true });
  expect(shipmentRepo.replaceDraftShipmentItems).not.toHaveBeenCalled();
  expect(shipmentRepo.markShipped).toHaveBeenCalledWith('org', 'shipment-1', null);
  expect(item.quantity).toBe(1);
  expect(autoCloseReconciler).toHaveBeenCalled();
});

test('failed document capture rolls back the final date/context and never records shipped evidence', async () => {
  const f = fixture(1);
  capture.mockRejectedValueOnce(new Error('Capture failed'));
  await expect(f.repo.markShipped('org', 'shipment-1')).rejects.toThrow('Capture failed');
  expect(f.shipment).toMatchObject({ status: 'DRAFT', shipDate: null });
  expect(f.shipment.documentSnapshot).toBeUndefined();
  expect(f.items[0].quantity).toBe(1);
  expect(f.events).toEqual([]);
});

test('incomplete blind context cannot ship and shipping never substitutes organization sender', async () => {
  const f = fixture(1);
  f.shipment.shippingContext.blindShipping = true;
  capture.mockClear();
  await expect(f.repo.markShipped('org', 'shipment-1')).rejects.toMatchObject({ status: 409, code: 'BLIND_SENDER_REQUIRED' });
  expect(f.shipment.status).toBe('DRAFT');
  expect(capture).not.toHaveBeenCalled();
  expect(f.events).toEqual([]);
  expect(f.db.transaction).toHaveBeenCalledTimes(1);
});

test.each(['direct', 'wrapped'])('%s PostgreSQL deadlock retries the rolled-back whole shipping transaction once', async wrapped => {
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const error = wrapped === 'wrapped' ? new Error('Drizzle query failed', { cause: new Error('Nested query failed', { cause: deadlock }) }) : deadlock;
  const f = fixture(1, 'package-1', new Date('2026-09-29T00:00:00Z'), [error]);
  capture.mockClear();
  await expect(f.repo.markShipped('org', 'shipment-1')).resolves.toMatchObject({ ok: true });
  expect(f.db.transaction).toHaveBeenCalledTimes(2);
  expect(f.eligibility).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(f.locks).toEqual([['no key update', { of: orders }], ['no key update', { of: orders }]]);
  expect(f.attempts[1]).toEqual(f.attempts[0]);
  expect(f.attempts[1].shipment).toMatchObject({ status: 'DRAFT', shipDate: new Date('2026-09-29T00:00:00Z') });
  expect(f.attempts[1].shipment.documentSnapshot).toBeUndefined();
  expect(f.shipment.documentSnapshot).toMatchObject({ shipDate: '2026-09-29', lines: [{ quantity: 1 }] });
  expect(f.shipment.shipDate.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  expect(f.items).toEqual(f.attempts[0].items);
  expect(f.events).toEqual([expect.objectContaining({ eventType: 'SHIPMENT_SHIPPED', payloadJson: { itemCount: 1 } })]);
  expect(f.order.fulfillmentStatus).toBe('packed');
});

test('three deadlock attempts are exhausted and the original final error is surfaced without shipped evidence', async () => {
  const errors = Array.from({ length: 3 }, (_, attempt) => Object.assign(new Error(`deadlock ${attempt}`), { code: '40P01' }));
  const lastError = errors[2];
  const f = fixture(1, 'package-1', null, [...errors]);
  capture.mockClear();
  await expect(f.repo.markShipped('org', 'shipment-1')).rejects.toBe(lastError);
  expect(f.db.transaction).toHaveBeenCalledTimes(3);
  expect(capture).toHaveBeenCalledTimes(3);
  expect(f.attempts[1]).toEqual(f.attempts[0]);
  expect(f.attempts[2]).toEqual(f.attempts[0]);
  expect(f.shipment).toMatchObject({ status: 'DRAFT', shipDate: null });
  expect(f.shipment.documentSnapshot).toBeUndefined();
  expect(f.events).toEqual([]);
  expect(f.items[0].quantity).toBe(1);
});

test('source validation errors are never retried even with a misleading deadlock code', async () => {
  const f = fixture(1);
  const error = new FulfillmentHttpError(409, 'Invalid shipping document source', '40P01');
  capture.mockClear().mockRejectedValueOnce(error);
  await expect(f.repo.markShipped('org', 'shipment-1')).rejects.toBe(error);
  expect(f.db.transaction).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(f.shipment).toMatchObject({ status: 'DRAFT', shipDate: null });
  expect(f.events).toEqual([]);
});

test.each(['08006', 'ECONNRESET'])('an ambiguous %s commit failure never reexecutes shipped data, even with a nested deadlock cause', async code => {
  const f = fixture(1);
  const committedTransaction = f.db.transaction.getMockImplementation();
  const error = Object.assign(new Error('COMMIT response connection lost'), { code, cause: Object.assign(new Error('Previous deadlock'), { code: '40P01' }) });
  f.db.transaction.mockImplementation(async (callback: any) => {
    await committedTransaction(callback);
    throw error;
  });
  await expect(f.repo.markShipped('org', 'shipment-1')).rejects.toBe(error);
  expect(f.db.transaction).toHaveBeenCalledTimes(1);
  expect(f.shipment.status).toBe('SHIPPED');
  expect(f.events).toHaveLength(1);
});

test('legacy DRAFT context resolves on read without persisting while terminal context stays recorded only', async () => {
  const legacy: any = { id: 'shipment-1', status: 'DRAFT', shippingContext: null, orders: [{ orderId: 'order-20306' }], packages: [] };
  const write = jest.fn(() => { throw new Error('GET must not write'); });
  const rows = [[{ id: 'order-20306', shipToCompany: 'Recipient', shipToAddress1: '12 Main', shipToCity: 'Phoenix', shipToState: 'AZ', shipToPostalCode: '85001', blindShipping: true }], [{ settings: {} }], [{ settings: {} }]];
  const database: any = { update: write, insert: write, delete: write, select: () => {
    const result = rows.shift() ?? []; const chain: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
    for (const method of ['from', 'where', 'leftJoin', 'limit']) chain[method] = () => chain;
    return chain;
  } };
  const service = new FulfillmentService({ shipmentRepo: { getShipmentById: async () => legacy } as any, dbInstance: database });
  await expect(service.getShipment('org', 'shipment-1')).resolves.toMatchObject({ shippingContext: { blindShipping: true, blindSender: null, sourceOrderId: 'order-20306' } });
  expect(legacy.shippingContext).toBeNull();
  legacy.status = 'SHIPPED';
  await expect(service.getShipment('org', 'shipment-1')).resolves.toMatchObject({ shippingContext: null });
  expect(write).not.toHaveBeenCalled();
});

test('document selection validates package ownership and type without shipping', async () => {
  const source = { packages: [{ id: 'package-1' }] };
  capture.mockResolvedValue(source);
  const write = jest.fn();
  const service = new FulfillmentService({ dbInstance: { update: write, insert: write, delete: write } as any });
  await expect(service.getShipmentDocument('org', 'shipment-1', 'package_ticket', 'foreign')).rejects.toMatchObject({ status: 404, code: 'PACKAGE_NOT_FOUND' });
  await expect(service.getShipmentDocument('org', 'shipment-1', 'packing_slip', 'package-1')).rejects.toMatchObject({ status: 400, code: 'INVALID_PACKAGE' });
  await expect(service.getShipmentDocument('org', 'shipment-1', 'package_ticket', 'package-1')).resolves.toBe(source);
  expect(write).not.toHaveBeenCalled();
});

test('draft replacement persists the reduced quantity on its canonical package and zero removes allocations', async () => {
  let saved: any[] = []; let locked = false;
  let responses: any[][] = [];
  const db: any = { transaction: async (cb: any) => cb(db), execute: async () => [], select: () => {
    const rows = responses.shift() ?? [];
    const chain: any = { for: () => { locked = true; return chain; }, limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) };
    for (const method of ['from', 'where', 'innerJoin']) chain[method] = () => chain;
    return chain;
  }, delete: (table: any) => ({ where: async () => { expect(table).toBe(shipmentItems); saved = []; } }), insert: (table: any) => ({ values: async (values: any[]) => { expect(table).toBe(shipmentItems); saved = values; } }) };
  const repo = new ShipmentRepo(db);
  jest.spyOn(FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockResolvedValue([{ id: 'line-1', orderId: 'order-20306', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2 }) }]);
  responses = [[{ id: 'shipment-1' }], [{ orderId: 'order-20306' }], [{ id: 'line-1', orderId: 'order-20306', quantity: 2 }], [{ id: 'package-1' }]];
  await expect(repo.replaceDraftShipmentItems('org', 'shipment-1', [{ orderId: 'order-20306', orderLineItemId: 'line-1', quantity: 1, packageId: 'package-1' }])).resolves.toEqual({ ok: true });
  expect(locked).toBe(true);
  expect(saved).toEqual([expect.objectContaining({ organizationId: 'org', shipmentId: 'shipment-1', packageId: 'package-1', quantity: 1 })]);
  responses = [[{ id: 'shipment-1' }], [{ orderId: 'order-20306' }]];
  await repo.replaceDraftShipmentItems('org', 'shipment-1', []);
  expect(saved).toEqual([]);
});
