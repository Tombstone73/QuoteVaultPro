import { jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../../shared/schema';

const datasets = new Map<unknown, any[]>();
const predicates = new Map<unknown, any[]>();
const dialect = new PgDialect();
const fakeDb = {
  select: () => {
    let table: unknown;
    const query: any = {
      from: (value: unknown) => { table = value; return query; },
      innerJoin: () => query,
      leftJoin: () => query,
      where: (value: any) => {
        predicates.set(table, [...(predicates.get(table) ?? []), dialect.sqlToQuery(value)]);
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      then: (resolve: any, reject: any) => Promise.resolve(datasets.get(table) ?? []).then(resolve, reject),
    };
    return query;
  },
};
jest.unstable_mockModule('../db', () => ({ db: fakeDb }));
jest.unstable_mockModule('../storage', () => ({ storage: {} }));
jest.unstable_mockModule('../tenantContext', () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));
const { registerTimelineRoutes } = await import('../routes/timeline.routes');

async function timeline(orderId = 'secondary-order') {
  const handlers = new Map<string, any>();
  registerTimelineRoutes({ get: (path: string, ...callbacks: any[]) => handlers.set(path, callbacks.at(-1)) } as any,
    { isAuthenticated: () => {}, tenantContext: () => {}, isOwner: () => {} });
  let response: any;
  const res: any = { json: (value: any) => { response = value; return res; }, status: () => res };
  await handlers.get('/api/timeline')({ organizationId: 'org-one', query: { orderId, limit: '100' } }, res);
  return response;
}

describe('canonical fulfillment events in the existing Order timeline', () => {
  beforeEach(() => {
    datasets.clear(); predicates.clear();
    datasets.set(schema.orders, [{ id: 'secondary-order', quoteId: null }]);
    datasets.set(schema.shipmentOrders, [{ shipmentId: 'combined-shipment' }]);
    datasets.set(schema.shipments, [
      { id: 'combined-shipment', orderId: 'primary-order', status: 'SHIPPED', shippedAt: new Date('2026-10-01T12:00:00Z'), createdByUserId: null, trackingNumber: null },
      { id: 'draft-shipment', orderId: 'secondary-order', status: 'DRAFT', shippedAt: null, createdByUserId: null },
      { id: 'void-shipment', orderId: 'secondary-order', status: 'VOIDED', shippedAt: null, createdByUserId: null },
    ]);
    datasets.set(schema.fulfillmentEvents, [
      { id: 'ship-event', entityType: 'SHIPMENT', entityId: 'combined-shipment', eventType: 'SHIPMENT_SHIPPED', actorUserId: 'shipping-actor', createdAt: new Date('2026-10-01T12:00:00Z'), payloadJson: { itemCount: 2 } },
      { id: 'admin-event', entityType: 'ORDER', entityId: 'secondary-order', eventType: 'ADMINISTRATIVE_FULFILLMENT_REOPENED', actorUserId: null, createdAt: new Date('2026-10-01T13:00:00Z'), payloadJson: { method: 'ship', reason: 'Correct allocation', items: [{ orderLineItemId: 'line-one', quantity: 1 }] } },
      { id: 'other-reversal', entityType: 'SHIPMENT', entityId: 'combined-shipment', eventType: 'SHIPMENT_REVERSED', actorUserId: null, createdAt: new Date(), payloadJson: { orderId: 'primary-order' } },
    ]);
  });

  it('includes combined shipment and correction evidence with the ledger actor, without duplicate shipped rows', async () => {
    const result = await timeline();
    expect(result.success).toBe(true);
    const shipped = result.data.filter((event: any) => event.eventType === 'SHIPMENT_SHIPPED' || event.eventType === 'shipped');
    expect(shipped).toHaveLength(1);
    expect(shipped[0].actorUserId).toBe('shipping-actor');
    expect(result.data.find((event: any) => event.id === 'fulfillment_event:admin-event').metadata.payload.reason).toBe('Correct allocation');
    expect(result.data.some((event: any) => event.id === 'fulfillment_event:other-reversal')).toBe(false);
    expect(result.data.some((event: any) => event.id === 'shipment_shipped:draft-shipment' || event.id === 'shipment_shipped:void-shipment')).toBe(false);
  });

  it('bounds each fulfillment lookup by organization and Order membership', async () => {
    await timeline();
    expect(predicates.get(schema.shipmentOrders)?.[0].params).toEqual(expect.arrayContaining(['org-one', 'secondary-order']));
    expect(predicates.get(schema.shipments)?.[0].params).toEqual(expect.arrayContaining(['org-one', 'secondary-order', 'combined-shipment']));
    expect(predicates.get(schema.fulfillmentEvents)?.[0].params).toEqual(expect.arrayContaining(['org-one', 'ORDER', 'secondary-order', 'SHIPMENT', 'combined-shipment']));
  });

  it('retains only actual historical shipped rows when legacy evidence predates the ledger', async () => {
    datasets.set(schema.fulfillmentEvents, []);
    const result = await timeline();
    const shipped = result.data.filter((event: any) => event.eventType === 'shipped');
    expect(shipped).toHaveLength(1);
    expect(shipped[0].id).toBe('shipment_shipped:combined-shipment');
    expect(shipped[0].message).not.toContain('undefined');
  });
});
