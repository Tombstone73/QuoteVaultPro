import { afterEach, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orders, fulfillmentEvents, fulfillmentAdministrativeReconciliations, pickupTickets } from '@shared/schema';
import { administrativeCorrectionPreview, administrativeReopenedByLine, administrativeReopenSchema } from '@shared/administrativeFulfillment';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { FulfillmentDashboardRepo } from '../services/fulfillment/repository';
import { FulfillmentService } from '../services/fulfillment/service';

afterEach(() => jest.restoreAllMocks());
function fixture({ physical = 0, administrative = 2, ordered = 2 } = {}) {
  const order: any = { id: 'order-20306', organizationId: 'org', state: 'closed', status: 'operationally_complete', fulfillmentStatus: 'delivered', shippingMethod: 'shipping', updatedAt: '2026-09-01' };
  const events: any[] = [];
  const resolutions = administrative ? [{ id: 'resolution-1', reconciledQuantity: administrative, source: 'close_job_override', lineItemId: 'line-1', orderId: order.id }] : [];
  const locks: any[] = [];
  const projection = () => resolveFulfillmentLineQuantity({ orderedQuantity: ordered, productionCompleteQuantity: ordered, shippedQuantity: physical, administrativelyReconciledQuantity: administrative - (administrativeReopenedByLine(events).get('line-1') ?? 0) });
  const db: any = {
    select: () => {
      let table: any, params: any[] = [];
      const rows = () => !params.includes('org') ? [] : table === orders ? [order] : table === fulfillmentAdministrativeReconciliations ? resolutions : table === fulfillmentEvents ? events.filter(e => params.includes(e.eventType)) : table === pickupTickets ? [] : [];
      const chain: any = { from: (t: any) => { table = t; return chain; }, innerJoin: () => chain, where: (q: any) => { params = new PgDialect().sqlToQuery(q).params; return chain; }, for: () => { locks.push('order'); return chain; }, limit: async () => rows(), orderBy: () => chain, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      return chain;
    },
    execute: async (sql: any) => { locks.push(new PgDialect().sqlToQuery(sql)); },
    insert: (table: any) => ({ values: async (value: any) => { expect(table).toBe(fulfillmentEvents); events.push({ ...value, id: `event-${events.length}` }); } }),
    update: (table: any) => ({ set: (value: any) => ({ where: async () => { expect(table).toBe(orders); Object.assign(order, value); } }) }),
    transaction: async (callback: any) => {
      const beforeOrder = { ...order }; const beforeEvents = [...events];
      try { return await callback(db); }
      catch (error) { for (const key of Object.keys(order)) delete order[key]; Object.assign(order, beforeOrder); events.splice(0, events.length, ...beforeEvents); throw error; }
    },
  };
  jest.spyOn(FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockImplementation(async () => [{ id: 'line-1', orderId: order.id, projection: projection() }]);
  const repo = new FulfillmentDashboardRepo(db);
  const service = new FulfillmentService({ dbInstance: db, dashboardRepo: repo });
  const request = async () => ({ expectedState: (await repo.getAdministrativeCorrectionPreview('org', order.id)).expectedState, clientRequestId: '11111111-1111-4111-8111-111111111111', reason: 'Correct administrative closure', items: [{ orderLineItemId: 'line-1', quantity: administrative || ordered - physical }] });
  return { db, order, events, resolutions, locks, projection, repo, service, request };
}

test.each([{ physical: 0, administrative: 2, ordered: 2 }, { physical: 6, administrative: 4, ordered: 10 }])('administrative correction preserves physical quantities: %j', async data => {
  const f = fixture(data); const input = await f.request();
  await f.service.reopenAdministrativeFulfillment('org', f.order.id, input, null, 'owner');
  expect(f.projection()).toMatchObject({ shippedQuantity: data.physical, administrativelyReconciledQuantity: 0, remainingQuantity: data.administrative });
  expect(f.resolutions[0].reconciledQuantity).toBe(data.administrative);
  expect(f.order).toMatchObject({ state: 'production_complete', status: 'ready_for_shipment', routingTarget: 'fulfillment' });
  expect(f.events.map(e => e.eventType)).toEqual(['ADMINISTRATIVE_FULFILLMENT_REOPENED', 'FULFILLMENT_TERMINAL_REOPENED']);
  expect(f.locks[1].params).toEqual(['org', 'order-20306']);
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, input, null, 'owner')).resolves.toMatchObject({ replayed: true });
  expect(f.events).toHaveLength(2);
});

test('partial administrative reopen is bounded and stale or unauthorized requests append nothing', async () => {
  const f = fixture({ ordered: 10, physical: 6, administrative: 4 }); const input = await f.request();
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, input, null, 'employee')).rejects.toMatchObject({ status: 403 });
  await expect(f.service.reopenAdministrativeFulfillment('other-org', f.order.id, input, null, 'owner')).rejects.toMatchObject({ status: 404 });
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, { ...input, expectedState: 'stale' }, null, 'owner')).rejects.toMatchObject({ status: 409 });
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, { ...input, items: [{ orderLineItemId: 'line-1', quantity: 5 }] }, null, 'owner')).rejects.toMatchObject({ status: 409 });
  expect(f.events).toHaveLength(0);
  await f.service.reopenAdministrativeFulfillment('org', f.order.id, { ...input, items: [{ orderLineItemId: 'line-1', quantity: 2 }] }, null, 'admin');
  expect(f.projection()).toMatchObject({ shippedQuantity: 6, administrativelyReconciledQuantity: 2, remainingQuantity: 2 });
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, { ...input, clientRequestId: '22222222-2222-4222-8222-222222222222' }, null, 'owner')).rejects.toMatchObject({ status: 409 });
});

test('legacy reconciliation records current correction without backdating physical or administrative evidence', async () => {
  const f = fixture({ administrative: 0 });
  const preview = await f.repo.getAdministrativeCorrectionPreview('org', f.order.id);
  expect(preview).toMatchObject({ mode: 'legacy', method: 'ship', lines: [{ orderedQuantity: 2, physicallyFulfilledQuantity: 0, administrativelyResolvedQuantity: 0, legacyClosedQuantity: 2 }] });
  await f.service.reopenAdministrativeFulfillment('org', f.order.id, await f.request(), null, 'owner');
  expect(f.resolutions).toEqual([]);
  expect(f.projection()).toMatchObject({ remainingQuantity: 2, fulfilledQuantity: 0 });
  expect(f.events[0].payloadJson.mode).toBe('legacy');
  expect(administrativeReopenedByLine(f.events).size).toBe(0);
});

test('failed Order reconciliation rolls back administrative reopen evidence', async () => {
  const f = fixture(); const input = await f.request();
  jest.spyOn(f.db, 'update').mockImplementationOnce(() => { throw new Error('reconciliation failed'); });
  await expect(f.service.reopenAdministrativeFulfillment('org', f.order.id, input, null, 'owner')).rejects.toThrow('reconciliation failed');
  expect(f.events).toEqual([]);
  expect(f.projection().administrativelyReconciledQuantity).toBe(2);
  expect(f.order.status).toBe('operationally_complete');
});

test('no correction for fully physical fulfillment, canceled orders, or incomplete production; reason required', () => {
  const line = { id: 'line', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2, shippedQuantity: 2, productionCompleteQuantity: 2 }) };
  expect(administrativeCorrectionPreview({ state: 'closed' }, [line]).mode).toBeNull();
  expect(administrativeCorrectionPreview({ status: 'canceled' }, [line]).blockedReason).toContain('Cancelled');
  expect(administrativeReopenSchema.safeParse({ reason: ' ' }).success).toBe(false);
});

test('historical Order notes append without physical identities, mutations, or workspace hydration', async () => {
  const f = fixture();
  jest.spyOn(f.repo, 'getFulfillmentDetail').mockRejectedValue(new Error('unrelated artwork hydration failed'));
  await expect(f.service.addOrderNote('org', f.order.id, 'Correction under review', null)).resolves.toEqual({ orderId: f.order.id });
  expect(f.events).toEqual([expect.objectContaining({ entityType: 'ORDER', entityId: f.order.id, eventType: 'FULFILLMENT_NOTE', payloadJson: { note: 'Correction under review' } })]);
  expect(f.order.status).toBe('operationally_complete');
  expect(f.projection().remainingQuantity).toBe(0);
  await expect(f.service.addOrderNote('other-org', f.order.id, 'No access', null)).rejects.toMatchObject({ status: 404 });
});
