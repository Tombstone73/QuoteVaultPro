import { afterEach, expect, jest, test } from '@jest/globals';
import { shipments, shipmentItems, orders, fulfillmentEvents } from '@shared/schema';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { FulfillmentDashboardRepo, ShipmentRepo } from '../services/fulfillment/repository';
import { FulfillmentService } from '../services/fulfillment/service';

afterEach(() => jest.restoreAllMocks());
function fixture(quantity: number, packageId: string | null = 'package-1', shipDate: Date | null = null) {
  const shipment: any = { id: 'shipment-1', organizationId: 'org', status: 'DRAFT', shipDate, carrier: null, trackingNumber: null };
  const items = [{ id: 'item-1', orderId: 'order-20306', orderLineItemId: 'line-1', packageId, quantity }];
  const order: any = { state: 'production_complete', status: 'ready_for_shipment', fulfillmentStatus: 'packed' };
  const events: any[] = [];
  const responses: any[][] = [[shipment], items, [{ id: 'package-1' }], [{ orderedQty: 2 }], [{ shippedQty: quantity }], [{ id: 'line-1' }], []];
  const db: any = {
    transaction: async (callback: any) => callback(db), execute: async () => [],
    select: () => {
      const rows = responses.shift() ?? [];
      const chain: any = { then: (resolve: any) => Promise.resolve(rows).then(resolve), limit: async () => rows };
      for (const method of ['from', 'innerJoin', 'where', 'groupBy']) chain[method] = () => chain;
      return chain;
    },
    update: (table: any) => ({ set: (patch: any) => {
      if (table === shipments) {
        // Exercise the actual schema encoder that failed in production.
        expect(() => shipments.shipDate.mapToDriverValue(patch.shipDate)).not.toThrow();
        expect(patch.shippedAt).toBeInstanceOf(Date);
        Object.assign(shipment, patch);
      } else { expect(table).toBe(orders); Object.assign(order, patch); }
      return { where: () => ({ returning: async () => [shipment] }) };
    } }),
    insert: (table: any) => ({ values: async (event: any) => { expect(table).toBe(fulfillmentEvents); events.push(event); } }),
  };
  const eligibility = jest.spyOn(FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockResolvedValue([{ id: 'line-1', orderId: 'order-20306', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2, productionCompleteQuantity: 2 }) }]);
  return { repo: new ShipmentRepo(db), shipment, items, order, events, eligibility };
}

test.each([1, 2])('ships %i of 2 with blank logistics, correct package quantities, and a serializable default date', async quantity => {
  const f = fixture(quantity);
  await expect(f.repo.markShipped('org', 'shipment-1')).resolves.toMatchObject({ ok: true });
  expect(f.items[0]).toMatchObject({ quantity, packageId: 'package-1' });
  expect(f.shipment).toMatchObject({ status: 'SHIPPED', carrier: null, trackingNumber: null });
  expect(f.shipment.shipDate.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
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

test('draft replacement persists the reduced quantity on its canonical package and zero removes allocations', async () => {
  let saved: any[] = []; let locked = false;
  let responses: any[][] = [];
  const db: any = { transaction: async (cb: any) => cb(db), select: () => {
    const rows = responses.shift() ?? [];
    const chain: any = { for: () => { locked = true; return chain; }, limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) };
    for (const method of ['from', 'where', 'innerJoin']) chain[method] = () => chain;
    return chain;
  }, delete: (table: any) => ({ where: async () => { expect(table).toBe(shipmentItems); saved = []; } }), insert: (table: any) => ({ values: async (values: any[]) => { expect(table).toBe(shipmentItems); saved = values; } }) };
  const repo = new ShipmentRepo(db);
  responses = [[{ id: 'shipment-1' }], [{ orderId: 'order-20306' }], [{ id: 'line-1', orderId: 'order-20306', quantity: 2 }], [{ id: 'package-1' }]];
  await expect(repo.replaceDraftShipmentItems('org', 'shipment-1', [{ orderId: 'order-20306', orderLineItemId: 'line-1', quantity: 1, packageId: 'package-1' }])).resolves.toEqual({ ok: true });
  expect(locked).toBe(true);
  expect(saved).toEqual([expect.objectContaining({ organizationId: 'org', shipmentId: 'shipment-1', packageId: 'package-1', quantity: 1 })]);
  responses = [[{ id: 'shipment-1' }], [{ orderId: 'order-20306' }]];
  await repo.replaceDraftShipmentItems('org', 'shipment-1', []);
  expect(saved).toEqual([]);
});
