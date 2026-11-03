import { expect, jest, test } from '@jest/globals';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orderShippingProgressLabel } from '@shared/shipmentTracking';

jest.unstable_mockModule('../db', () => ({ db: {}, pool: {}, hasQuoteAttachmentPagesTable: () => false, hasPageCountStatusColumn: () => false, probeDatabaseSchema: async () => undefined }));
const { loadOrderTrackingSummaries, loadPortalShipments } = await import('../services/shipmentTrackingService');
const { buildFulfillmentSummary } = await import('../services/portal.service');
const dialect = new PgDialect();
type Row = Record<string, unknown>;
function fixture(orderCount = 1) {
  const data: Record<string, Row[]> = {
    orders: Array.from({ length: orderCount }, (_, i) => ({ id: `order-${i}`, organizationId: 'org-a', customerId: 'customer-a', fulfillmentStatus: 'packed', shippingMethod: 'ship', trackingNumber: null })),
    shipments: Array.from({ length: orderCount }, (_, i) => ({ id: `ship-${i}`, orderId: `order-${i}`, primaryOrderId: `order-${i}`, organizationId: 'org-a', status: 'SHIPPED', carrier: 'UPS', trackingNumber: `1Z000000000000${String(i).padStart(4, '0')}`, serviceLevel: 'Ground', internalNotes: 'PRIVATE-NOTE', carrierRawResponse: { private: 'PRIVATE-RESPONSE' } })),
    ups_label_purchases: [], ups_package_labels: [], shipment_packages: [], shipment_tracking_states: [], shipment_items: [],
  };
  const calls: Array<{ table: string; params: unknown[]; sql: string }> = [];
  const connection = { select(fields?: Row) {
    let table = ''; const joins: SQL[] = [];
    const chain = {
      from(source: Parameters<typeof getTableName>[0]) { table = getTableName(source); return chain; },
      leftJoin(_source: unknown, condition: SQL) { joins.push(condition); return chain; },
      innerJoin(_source: unknown, condition: SQL) { joins.push(condition); return chain; },
      async where(condition: SQL) {
        const compiled = [...joins, condition].map(query => dialect.sqlToQuery(query));
        const params = compiled.flatMap(query => query.params);
        calls.push({ table, params, sql: compiled.map(query => query.sql).join(' ') });
        if (table === 'orders') return data.orders.filter(order => params.includes(order.organizationId) && params.includes(order.id));
        if (table === 'shipments' && fields?.shipmentId) return data.shipments.flatMap(shipment => data.orders
          .filter(order => params.includes(order.id) && params.includes(order.organizationId) && (!calls.at(-1)!.sql.includes('"orders"."customer_id"') || params.includes(order.customerId)))
          .filter(order => order.id === shipment.orderId || (data.shipment_orders ?? []).some(link => link.shipmentId === shipment.id && link.orderId === order.id)).map(order => ({ shipmentId: shipment.id, orderId: order.id })));
        return data[table] ?? [];
      },
    };
    return chain;
  } };
  return { data, calls, connection: connection as unknown as NonNullable<Parameters<typeof loadOrderTrackingSummaries>[2]> };
}

test('Order tracking summaries are batched for 200 Orders, contain no private fields, and never infer full shipment from a package', async () => {
  const f = fixture(200);
  const result = await loadOrderTrackingSummaries('org-a', f.data.orders.map(order => String(order.id)), f.connection);
  expect(result.size).toBe(200); expect(f.calls).toHaveLength(8);
  expect(result.get('order-0')).toMatchObject({ statusLabel: 'Partially shipped', hasShipments: true, trackingPackages: [{ carrier: 'UPS', status: 'unavailable' }] });
  expect(JSON.stringify([...result.values()])).not.toContain('PRIVATE-');
  expect(f.calls.every(call => call.params.includes('org-a'))).toBe(true);
});

test('tenant ownership is rechecked even for supplied Order IDs, while portal keeps its customer predicate', async () => {
  const f = fixture();
  expect((await loadOrderTrackingSummaries('other-org', ['order-0'], f.connection)).size).toBe(0);
  expect((await loadPortalShipments('org-a', 'wrong-customer', ['order-0'], f.connection)).size).toBe(0);
  const join = f.calls.find(call => call.sql.includes('"orders"."customer_id"'))!;
  expect(join.params).toEqual(expect.arrayContaining(['org-a', 'wrong-customer', 'order-0']));
  expect((await loadPortalShipments('org-a', 'customer-a', ['order-0'], f.connection)).get('order-0')?.[0].trackingPackages).toHaveLength(1);
});

test('multiple shipments, pickup, missing tracking and voided history retain canonical identities and neutral carrier status', async () => {
  const f = fixture(3); f.data.orders[1].shippingMethod = 'pickup'; f.data.orders[1].fulfillmentStatus = 'delivered';
  f.data.shipments[1].trackingNumber = null; f.data.shipments[2].status = 'VOIDED'; f.data.orders[2].trackingNumber = 'OLD-VOIDED';
  f.data.shipments.push({ ...f.data.shipments[0], id: 'ship-extra', carrier: 'Other courier', trackingNumber: 'LOCAL-12345' });
  const result = await loadOrderTrackingSummaries('org-a', ['order-0', 'order-1', 'order-2'], f.connection);
  expect(result.get('order-0')?.trackingPackages).toHaveLength(2);
  expect(result.get('order-0')?.trackingPackages[1]).toMatchObject({ carrier: 'Other courier', trackingUrl: null, status: 'unavailable' });
  expect(result.get('order-1')).toMatchObject({ statusLabel: 'Picked up', trackingPackages: [] });
  expect(result.get('order-2')?.trackingPackages).toEqual([]);
});

test('a verified cached scan is reused without changing internal fulfillment or calling a carrier', async () => {
  const f = fixture();
  f.data.shipment_tracking_states = [{ shipmentId: 'ship-0', carrier: 'UPS', trackingNumber: f.data.shipments[0].trackingNumber, status: 'delivered', lastEventAt: new Date('2026-11-01T12:00:00Z'), deliveredAt: new Date('2026-11-01T12:00:00Z'), lastCheckedAt: new Date('2026-11-01T13:00:00Z') }];
  const result = await loadOrderTrackingSummaries('org-a', ['order-0'], f.connection);
  expect(result.get('order-0')).toMatchObject({ statusLabel: 'Partially shipped', trackingPackages: [{ status: 'delivered', lastCarrierUpdateAt: '2026-11-01T12:00:00.000Z' }] });
  expect(f.data.orders[0].fulfillmentStatus).toBe('packed');
});

test('portal fulfillment summary uses whole-Order completion rather than a single shipped package', () => {
  const order = { shippingMethod: 'ship', fulfillmentStatus: 'packed', shippedAt: null, trackingNumber: null } as Parameters<typeof buildFulfillmentSummary>[0];
  const shipment = { orderId: 'order-0', primaryOrderId: 'order-0', status: 'SHIPPED', trackingNumber: '123456789', shippedAt: new Date(), carrier: 'UPS' };
  expect(buildFulfillmentSummary(order, [shipment], null).statusLabel).toBe('Partially shipped');
  expect(buildFulfillmentSummary({ ...order, fulfillmentStatus: 'shipped' }, [shipment], null).statusLabel).toBe('Shipped');
});

test.each([['pending', true, 'Not shipped'], ['packed', false, 'Ready to ship'], ['shipped', true, 'Shipped'], ['delivered', true, 'Fulfilled'], [null, false, 'Not shipped']])('formats internal progress %s independently of carrier delivery', (status, hasShipped, expected) => {
  expect(orderShippingProgressLabel(status as string | null, hasShipped as boolean)).toBe(expected);
});


test('portal customer scope fails closed when absent and combined packages stay bound to each Order', async () => {
  const f = fixture(2);
  expect((await loadPortalShipments('org-a', '', ['order-0'], f.connection)).size).toBe(0);
  expect(f.calls).toHaveLength(0);
  f.data.orders[1].customerId = 'customer-b';
  f.data.shipments = [{ ...f.data.shipments[0], scope: 'MULTI_ORDER' }];
  f.data.shipment_orders = [{ shipmentId: 'ship-0', orderId: 'order-0' }, { shipmentId: 'ship-0', orderId: 'order-1' }];
  f.data.ups_label_purchases = [{ id: 'purchase', shipmentId: 'ship-0', status: 'PURCHASED', environment: 'live' }];
  f.data.shipment_packages = [{ id: 'package-a', shipmentId: 'ship-0' }, { id: 'package-b', shipmentId: 'ship-0' }];
  f.data.ups_package_labels = [{ purchaseId: 'purchase', packageId: 'package-a', trackingNumber: '1Z1111111111111111' }, { purchaseId: 'purchase', packageId: 'package-b', trackingNumber: '1Z2222222222222222' }];
  f.data.shipment_items = [{ packageId: 'package-a', orderId: 'order-0' }, { packageId: 'package-b', orderId: 'order-1' }];
  const internal = await loadOrderTrackingSummaries('org-a', ['order-0', 'order-1'], f.connection);
  expect(internal.get('order-0')?.trackingPackages.map(pkg => pkg.packageId)).toEqual(['package-a']);
  expect(internal.get('order-1')?.trackingPackages.map(pkg => pkg.packageId)).toEqual(['package-b']);
  const portal = await loadPortalShipments('org-a', 'customer-a', ['order-0', 'order-1'], f.connection);
  expect([...portal.keys()]).toEqual(['order-0']);
  expect(portal.get('order-0')?.[0].trackingPackages.map(pkg => pkg.packageId)).toEqual(['package-a']);
});
