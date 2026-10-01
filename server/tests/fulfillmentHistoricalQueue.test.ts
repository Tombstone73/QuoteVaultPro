import { describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { FulfillmentDashboardRepo } from '../services/fulfillment/repository';
import { FulfillmentService } from '../services/fulfillment/service';
import { resolveFulfillmentLineQuantity } from '../../shared/fulfillmentReadiness';

const order = { id: 'order-20306', orderNumber: '20306', customerName: 'DG Graphics', shippingMethod: 'ship', state: 'closed', status: 'operationally_complete', fulfillmentStatus: 'delivered', canceledAt: null, updatedAt: new Date('2026-09-01'), createdAt: new Date('2026-08-01'), productionCompletedAt: new Date('2026-08-30') };
const filters = { type: 'all' as const, status: 'all', showArchived: true, overdueOnly: false, search: '20306', page: 1, pageSize: 25, sortBy: 'orderNumber' as const, sortDirection: 'asc' as const };

function fixture(overrides = {}, quantities = {}) {
  const conditions: any[] = [];
  const responses = [[{ ...order, ...overrides }], [{ orderId: order.id, shippedAt: '2026-09-01' }], [{ id: 'shipment-1', orderId: order.id, status: 'SHIPPED' }], [], [], []];
  const db = { select: jest.fn(() => {
    const rows = responses.shift() ?? [];
    const chain: any = { then: (resolve: any) => Promise.resolve(rows).then(resolve) };
    for (const method of ['from', 'leftJoin', 'innerJoin', 'groupBy', 'orderBy']) chain[method] = () => chain;
    chain.where = (condition: any) => { conditions.push(condition); return chain; };
    return chain;
  }) };
  const repo = new FulfillmentDashboardRepo(db as any);
  jest.spyOn(repo, 'getPickupRetentionDays').mockResolvedValue(30);
  const projection = resolveFulfillmentLineQuantity({ orderedQuantity: 10, productionCompleteQuantity: 10, shippedQuantity: 10, ...quantities });
  jest.spyOn(repo, 'listLineEligibility').mockResolvedValue([{ orderId: order.id, projection }] as any);
  return { repo, conditions, projection };
}

describe('historical fulfillment search (Order 20306)', () => {
  test('returns Delivered history only on opt-in, retaining tenant/search predicates', async () => {
    const { repo, conditions } = fixture();
    const result = await repo.listFulfillmentQueue('org-1', filters);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ orderNumber: '20306', status: 'DELIVERED', isHistorical: true, overdue: false, remainingQuantity: 0, shipmentId: 'shipment-1' });
    const query = new PgDialect().sqlToQuery(conditions[0]);
    expect(query.params).toEqual(expect.arrayContaining(['org-1', '%20306%']));
    expect(query.sql).toContain('"orders"."canceled_at" is null');
    expect((await fixture().repo.listFulfillmentQueue('org-1', { ...filters, showArchived: false })).rows).toEqual([]);
    expect((await fixture().repo.listFulfillmentQueue('org-1', { ...filters, overdueOnly: true })).rows).toEqual([]);
  });

  test('history respects type/status filters and does not admit canceled or status-only records', async () => {
    for (const changed of [{ type: 'pickup' as const }, { status: 'ready' }]) {
      expect((await fixture().repo.listFulfillmentQueue('org-1', { ...filters, ...changed })).rows).toEqual([]);
    }
    expect((await fixture({ status: 'canceled' }).repo.listFulfillmentQueue('org-1', filters)).rows).toEqual([]);
    expect((await fixture({}, { shippedQuantity: 0 }).repo.listFulfillmentQueue('org-1', filters)).rows).toEqual([]);
  });

  test('picked-up and administratively reconciled history are labeled truthfully', async () => {
    const pickup = fixture({ shippingMethod: 'pickup' }, { shippedQuantity: 0, pickedUpQuantity: 10 });
    expect((await pickup.repo.listFulfillmentQueue('org-1', filters)).rows[0]).toMatchObject({ status: 'PICKED_UP', isHistorical: true });
    const administrative = fixture({}, { shippedQuantity: 0, administrativelyReconciledQuantity: 10 });
    expect((await administrative.repo.listFulfillmentQueue('org-1', filters)).rows[0]).toMatchObject({ status: 'COMPLETED', isHistorical: true, shippedQuantity: 0 });
  });

  test('reopened quantities remain active with either history setting', async () => {
    for (const showArchived of [true, false]) {
      const active = fixture({ state: 'production_complete', status: 'ready_for_shipment', fulfillmentStatus: 'packed' }, { shippedQuantity: 6 });
      expect((await active.repo.listFulfillmentQueue('org-1', { ...filters, showArchived })).rows[0]).toMatchObject({ remainingQuantity: 4, isHistorical: false });
    }
  });

  test('normal Order editing still rejects changing completed fulfillment', async () => {
    const { projection } = fixture();
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [order] }) }) }) };
    const service = new FulfillmentService({ dbInstance: db as any, dashboardRepo: { listLineEligibility: async () => [{ projection }] } as any, shipmentRepo: {} as any, pickupRepo: {} as any });
    await expect(service.assertFulfillmentMethodChangeAllowed('org-1', order.id, 'pickup')).rejects.toMatchObject({ status: 409, code: 'FULFILLMENT_METHOD_TERMINAL' });
  });

  test('existing authorized shipment correction reopens only reversed quantity and appends Order evidence', async () => {
    const updates: any[] = [];
    const events: any[] = [];
    const projection = resolveFulfillmentLineQuantity({ orderedQuantity: 10, productionCompleteQuantity: 10, shippedQuantity: 6 });
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [order] }) }) }),
      update: () => ({ set: (value: any) => ({ where: async () => { updates.push(value); } }) }),
      insert: () => ({ values: async (value: any) => { events.push(value); } }),
      transaction: async (callback: any) => callback(db),
    };
    const reverse = jest.fn(async () => ({ ok: true, orderId: order.id, replayed: false }));
    const service = new FulfillmentService({ dbInstance: db, dashboardRepo: { listLineEligibility: async () => [{ projection }] } as any, shipmentRepo: { reverseTerminalFulfillment: reverse } as any, pickupRepo: {} as any });
    const input = { sourceType: 'SHIPMENT' as const, sourceId: 'shipment-1', items: [{ orderLineItemId: 'line-1', quantity: 4 }], reason: 'Correct fulfillment', actorOrgRole: 'staff' };
    await expect(service.reverseTerminalFulfillment('org-1', input)).rejects.toMatchObject({ status: 403 });
    expect(reverse).not.toHaveBeenCalled();
    await service.reverseTerminalFulfillment('org-1', { ...input, actorOrgRole: 'owner' });
    expect(updates).toEqual([expect.objectContaining({ state: 'production_complete', status: 'ready_for_shipment', fulfillmentStatus: 'packed', routingTarget: 'fulfillment' })]);
    expect(events).toEqual([expect.objectContaining({ eventType: 'FULFILLMENT_TERMINAL_REOPENED', payloadJson: expect.objectContaining({ remainingQuantity: 4, fulfilledQuantity: 6, reason: input.reason }) })]);
  });
});
