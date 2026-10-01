import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { shipments, shipmentPackages, shipmentItems, shipmentOrders, orderLineItems, fulfillmentEvents } from '@shared/schema';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { orderShippingContext } from '../services/fulfillment/shippingContext';
import { ShipmentRepo, FulfillmentDashboardRepo } from '../services/fulfillment/repository';

afterEach(() => jest.restoreAllMocks());

function fixture(status = 'DRAFT') {
  const context = orderShippingContext({ id: 'order-a', shipToCompany: 'Recipient', shipToAddress1: '12 Main', shipToCity: 'Phoenix', shipToState: 'AZ', shipToPostalCode: '85001' });
  let state: any = { shipment: { id: 'shipment-a', organizationId: 'org-a', status, carrier: 'Old', shippingContext: context },
    packages: [{ id: 'package-a', weightLbs: '4', dimLengthIn: '10', notes: 'Keep', ordinal: 1 }],
    items: [{ id: 'item-a', orderId: 'order-a', orderLineItemId: 'line-a', packageId: 'package-a', quantity: 2 }], events: [] };
  const locks: any[] = []; const queries: any[] = []; const writes: any[] = [];
  const dialect = new PgDialect();
  const db: any = {
    transaction: async (callback: any) => { const before = structuredClone(state); try { return await callback(db); } catch (error) { state = before; throw error; } },
    execute: async (query: any) => { locks.push(dialect.sqlToQuery(query)); return []; },
    select: (projection: any) => {
      let table: any;
      const rows = () => table === shipments ? [state.shipment] : table === shipmentOrders ? [{ orderId: 'order-a' }]
        : table === shipmentPackages ? projection?.count ? [{ count: state.packages.length, maxOrdinal: 1 }] : state.packages
        : table === shipmentItems ? state.items : table === orderLineItems ? [{ id: 'line-a', orderId: 'order-a', quantity: 2 }] : [];
      const chain: any = { from: (value: any) => { table = value; return chain; }, where: (predicate: any) => { queries.push(dialect.sqlToQuery(predicate)); return chain; },
        for: (...args: any[]) => { locks.push({ table, args }); return chain; }, limit: async () => rows(), then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      for (const method of ['innerJoin', 'leftJoin', 'orderBy']) chain[method] = () => chain;
      return chain;
    },
    update: (table: any) => ({ set: (patch: any) => ({ where: async (predicate: any) => {
      writes.push({ table, patch, query: dialect.sqlToQuery(predicate) });
      if (table === shipments) Object.assign(state.shipment, patch);
      else Object.assign(state.packages[0], patch);
    } }) }),
    delete: (table: any) => ({ where: (predicate: any) => {
      writes.push({ table, query: dialect.sqlToQuery(predicate) });
      const removed = state.packages[0];
      if (table === shipmentItems) state.items = [];
      else { state.packages = []; state.items = []; }
      return { returning: async () => [removed], then: (resolve: any) => Promise.resolve().then(resolve) };
    } }),
    insert: (table: any) => ({ values: async (values: any) => {
      writes.push({ table, values });
      if (table === fulfillmentEvents) state.events.push(values);
      else if (table === shipmentItems) state.items = values;
    } }),
  };
  // Returning is needed by the real metadata write, without changing the mock's
  // rollback model for awaited update statements.
  const update = db.update;
  db.update = (table: any) => ({ set: (patch: any) => ({ where: (predicate: any) => {
    const apply = () => update(table).set(patch).where(predicate);
    return { returning: async () => { await apply(); return [state.shipment]; }, then: (resolve: any) => apply().then(resolve) };
  } }) });
  jest.spyOn(FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockResolvedValue([{ id: 'line-a', orderId: 'order-a', projection: resolveFulfillmentLineQuantity({ orderedQuantity: 2 }) }]);
  return { repo: new ShipmentRepo(db), get state() { return state; }, db, locks, queries, writes };
}

describe('draft transaction and terminal package evidence', () => {
  test.each(['SHIPPED', 'VOIDED'])('%s rejects package create/patch/delete before touching evidence', async status => {
    for (const action of ['create', 'patch', 'delete']) {
      const f = fixture(status);
      const promise = action === 'create' ? f.repo.createShipmentPackage('org-a', 'shipment-a', {})
        : action === 'patch' ? f.repo.patchDraftShipmentPackages('org-a', 'shipment-a', [{ id: 'package-a', notes: 'Changed' }])
        : f.repo.deleteShipmentPackage('org-a', 'shipment-a', 'package-a');
      await expect(promise).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });
      expect(f.locks[0]).toMatchObject({ table: shipments, args: ['update'] });
      expect(f.queries[0].params).toEqual(['shipment-a', 'org-a']);
      expect(f.writes).toEqual([]);
      expect(f.state.items[0].quantity).toBe(2);
    }
  });

  test('save commits metadata, package patch, exact partial allocations and event together', async () => {
    const f = fixture();
    await f.repo.saveDraftShipment('org-a', 'shipment-a', { patch: { carrier: '', shipDate: new Date('2026-10-01T00:00:00Z') },
      packages: [{ id: 'package-a', notes: 'Updated' }], items: [{ orderId: 'order-a', orderLineItemId: 'line-a', packageId: 'package-a', quantity: 1 }] });
    expect(f.state.shipment.carrier).toBe('');
    expect(() => shipments.shipDate.mapToDriverValue(f.state.shipment.shipDate)).not.toThrow();
    expect(f.state.packages[0]).toMatchObject({ notes: 'Updated', weightLbs: '4', dimLengthIn: '10' });
    expect(f.state.items).toEqual([expect.objectContaining({ quantity: 1, packageId: 'package-a' })]);
    expect(f.state.events).toEqual([expect.objectContaining({ eventType: 'SHIPMENT_UPDATED' })]);
    expect(f.locks.some(lock => lock.sql?.includes('FOR UPDATE'))).toBe(true);
  });

  test.each(['foreign-package', 'too-many'])('invalid %s rolls back earlier metadata and packages with no update event', async invalid => {
    const f = fixture(); const before = structuredClone(f.state);
    await expect(f.repo.saveDraftShipment('org-a', 'shipment-a', { patch: { carrier: 'New' }, packages: [{ id: 'package-a', notes: 'New' }],
      items: [{ orderId: 'order-a', orderLineItemId: 'line-a', packageId: invalid === 'foreign-package' ? 'foreign' : 'package-a', quantity: invalid === 'too-many' ? 3 : 1 }] })).rejects.toMatchObject({ status: 409 });
    expect(f.state).toEqual(before);
  });

  test('zero allocations removes items, while stored context remains captured after unrelated edits', async () => {
    const f = fixture();
    await f.repo.saveDraftShipment('org-a', 'shipment-a', { patch: { internalNotes: 'Updated' }, items: [] });
    expect(f.state.items).toEqual([]);
    expect(f.state.shipment.shippingContext.destination.company).toBe('Recipient');
    expect(f.state.events).toHaveLength(1);
  });

  test('split package allocations retain separate rows and their aggregate is rechecked against remaining quantity', async () => {
    const f = fixture();
    f.state.packages.push({ id: 'package-b', ordinal: 2 });
    const split = [{ orderId: 'order-a', orderLineItemId: 'line-a', packageId: 'package-a', quantity: 1 },
      { orderId: 'order-a', orderLineItemId: 'line-a', packageId: 'package-b', quantity: 1 }];
    await f.repo.saveDraftShipment('org-a', 'shipment-a', { patch: {}, items: split });
    expect(f.state.items).toEqual(split.map(item => expect.objectContaining(item)));
    await expect(f.repo.saveDraftShipment('org-a', 'shipment-a', { patch: { carrier: 'Do not save' }, items: [...split, split[0]] })).rejects.toMatchObject({ code: 'QTY_EXCEEDS_ORDER' });
    expect(f.state.items).toEqual(split.map(item => expect.objectContaining(item)));
    expect(f.state.shipment.carrier).toBe('Old');
    expect(f.state.events).toHaveLength(1);
  });
});
