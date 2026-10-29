import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { terminalReversalQuantitiesByLine } from '@shared/fulfillmentTerminalReversal';
import { orderShippingContext } from '../services/fulfillment/shippingContext';
import { filterActiveProductionOverviewFulfillmentJobs } from '../services/fulfillment/productionOverviewFulfillment';

jest.unstable_mockModule('../db', () => ({ db: {}, pool: {}, hasQuoteAttachmentPagesTable: async () => false }));
jest.unstable_mockModule('../services/shippingDocumentService', () => ({ getShippingDocumentSource: async () => ({ version: 1, basis: 'shipped' }) }));
jest.unstable_mockModule('../services/orderTravelerSourceService', () => ({ getOrderTravelerSource: async () => ({ orderId: 'order-1' }) }));
jest.unstable_mockModule('../emailService', () => ({ emailService: {} }));
jest.unstable_mockModule('../services/billingInvoiceAutomation', () => ({ billingInvoiceAutomationService: {} }));
let repositories: typeof import('../services/fulfillment/repository');
let FulfillmentService: typeof import('../services/fulfillment/service').FulfillmentService;
beforeAll(async () => { repositories = await import('../services/fulfillment/repository'); ({ FulfillmentService } = await import('../services/fulfillment/service')); });
afterEach(() => jest.restoreAllMocks());

/** Synthetic, serialized in-memory transaction adapter. Exercises real repository
 * mutations/projections and rollback; it does NOT emulate PostgreSQL lock behavior. */
function fixture(options: { quantity?: number; shipped?: number; picked?: number; produced?: number; state?: string; excluded?: boolean } = {}) {
  const quantity = options.quantity ?? 10;
  const f: any = {
    order: { id: 'order-1', organizationId: 'org-1', state: options.state ?? 'production_complete', status: 'ready_for_shipment', fulfillmentStatus: 'pending', routingTarget: 'fulfillment', shippingMethod: 'ship' },
    shipment: { id: 'shipment-1', organizationId: 'org-1', status: 'DRAFT', carrier: 'Manual', updatedAt: new Date(),
      shippingContext: orderShippingContext({ id: 'order-1', shipToCompany: 'QA Recipient', shipToAddress1: '1 Test Way', shipToCity: 'Test City', shipToState: 'IN', shipToPostalCode: '46201', shipToCountry: 'US' }) },
    lines: [{ id: 'line-1', orderId: 'order-1', quantity, workflowState: 'completed', status: 'complete' }],
    items: [{ id: 'allocation-1', organizationId: 'org-1', orderId: 'order-1', shipmentId: 'shipment-1', orderLineItemId: 'line-1', packageId: 'package-1', quantity: options.shipped ?? quantity }],
    ticket: { id: 'ticket-1', organizationId: 'org-1', orderId: 'order-1', status: 'READY_FOR_PICKUP' },
    handoffs: [], handoffItems: [], events: [], activeJobs: [], activeRuns: [], locks: [], writes: [], produced: options.produced ?? quantity,
    priorShipped: 0, priorPicked: options.picked ?? 0,
    invoice: { id: 'invoice-1', status: 'sent', balanceDue: '125.00', totalCents: 12500, payments: [], posted: true },
  };
  if (options.excluded) f.lines.push({ id: 'cancelled-line', orderId: 'order-1', quantity: 200, status: 'cancelled' });
  const projections = () => {
    const reversals = terminalReversalQuantitiesByLine(f.events, f.lines.map((line: any) => line.id));
    return f.lines.map((line: any) => ({ id: line.id, orderId: line.orderId, projection: resolveFulfillmentLineQuantity({
      orderedQuantity: line.quantity, lifecycleStatus: line.status, workflowState: line.workflowState,
      workflowIntent: line.workflowIntent ?? 'standard_production', lineItemRole: line.lineItemRole, requiresProductionJob: true, productionCompleteQuantity: f.produced,
      shippedQuantity: Math.max(0, f.priorShipped + (f.shipment.status === 'SHIPPED' ? f.items.filter((item: any) => item.orderLineItemId === line.id).reduce((sum: number, item: any) => sum + item.quantity, 0) : 0) - (reversals.shipment.get(line.id) ?? 0)),
      pickedUpQuantity: Math.max(0, f.priorPicked + f.handoffItems.filter((item: any) => item.orderLineItemId === line.id).reduce((sum: number, item: any) => sum + item.quantity, 0) - (reversals.pickup.get(line.id) ?? 0)),
      readyWaitingQuantity: quantity,
    }) }));
  };
  const dialect = new PgDialect();
  let transactionTail = Promise.resolve();
  const database: any = {
    execute: async (statement: any) => { f.locks.push(dialect.sqlToQuery(statement)); return []; },
    transaction: (work: any) => {
      const result = transactionTail.then(async () => {
        const before = structuredClone({ ...f, writes: [], locks: [] });
        try { return await work(database); } catch (error) { Object.assign(f, before); throw error; }
      });
      transactionTail = result.then(() => undefined, () => undefined); return result;
    },
    select: (fields?: any) => {
      let table: any; let params: any[] = [];
      const rows = () => {
        const name = getTableName(table);
        if ((name === 'orders' || name === 'pickup_tickets' || name === 'shipments') && !params.includes('org-1')) return [];
        if (name === 'orders') return [f.order];
        if (name === 'shipments') return [f.shipment];
        if (name === 'shipment_orders') return [{ orderId: f.order.id, ...f.order }];
        if (name === 'shipment_packages') return [{ id: 'package-1' }];
        if (name === 'pickup_tickets') return [f.ticket];
        if (name === 'pickup_handoffs') return f.handoffs.filter((row: any) => params.includes(row.clientRequestId) || params.includes(row.id));
        if (name === 'order_line_items') return fields?.orderedQty ? [{ orderedQty: f.lines.reduce((sum: number, line: any) => sum + line.quantity, 0) }] : f.lines;
        if (name === 'production_jobs') return f.activeJobs;
        if (name === 'production_runs') return f.activeRuns;
        if (name === 'shipment_items') return fields?.shippedQty ? [{ shippedQty: f.shipment.status === 'SHIPPED' ? f.items.reduce((sum: number, item: any) => sum + item.quantity, 0) : 0 }]
          : fields?.quantity && !fields?.orderId ? (f.shipment.status === 'SHIPPED' ? [{ id: 'line-1', quantity: f.priorShipped + f.items[0].quantity }] : f.priorShipped ? [{ id: 'line-1', quantity: f.priorShipped }] : []) : f.items;
        if (name === 'pickup_handoff_items') return fields?.quantity && !fields?.orderId ? [{ id: 'line-1', quantity: f.priorPicked + f.handoffItems.reduce((sum: number, item: any) => sum + item.quantity, 0) }] : f.handoffItems;
        if (name === 'fulfillment_events') return f.events.filter((event: any) => params.includes(event.eventType));
        return [];
      };
      const chain: any = { from: (value: any) => { table = value; return chain; }, where: (condition: any) => { params = dialect.sqlToQuery(condition).params; return chain; },
        for: (...args: any[]) => { f.locks.push({ table: getTableName(table), args, params }); return chain; },
        limit: () => chain, orderBy: () => chain, innerJoin: () => chain, leftJoin: () => chain, groupBy: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
      }; return chain;
    },
    update: (table: any) => ({ set: (patch: any) => ({ where: (condition: any) => {
      const apply = async () => {
        const name = getTableName(table); const query = dialect.sqlToQuery(condition);
        if (!['orders', 'shipments', 'pickup_tickets', 'fulfillment_ready_quantities'].includes(name)) throw new Error(`Forbidden business write: ${name}`);
        f.writes.push({ table: name, patch, query });
        const row = name === 'orders' ? f.order : name === 'shipments' ? f.shipment : f.ticket;
        if (name !== 'fulfillment_ready_quantities') Object.assign(row, patch);
        return [{ ...row }];
      };
      return { then: (resolve: any, reject: any) => apply().then(resolve, reject), returning: apply };
    } }) }),
    insert: (table: any) => ({ values: (values: any) => {
      const apply = async () => {
        const name = getTableName(table); const target = name === 'fulfillment_events' ? f.events : name === 'pickup_handoffs' ? f.handoffs : name === 'pickup_handoff_items' ? f.handoffItems : null;
        if (!target) throw new Error(`Forbidden business insert: ${name}`);
        const rows = (Array.isArray(values) ? values : [values]).map((value: any) => ({ id: `${name}-${target.length + 1}`, ...value }));
        target.push(...rows); return rows;
      };
      return { then: (resolve: any, reject: any) => apply().then(resolve, reject), returning: apply };
    } }),
  };
  jest.spyOn(repositories.FulfillmentDashboardRepo.prototype, 'listLineEligibility').mockImplementation(async (_org, _filter, runner) => { expect(runner ?? database).toBe(database); return projections(); });
  const dashboard = new repositories.FulfillmentDashboardRepo(database);
  const shipment = new repositories.ShipmentRepo(database);
  const pickup = new repositories.PickupRepo(database);
  const service = new FulfillmentService({ dbInstance: database, dashboardRepo: dashboard, shipmentRepo: shipment, pickupRepo: pickup,
    billingAutomationService: { ensureOrderBackedInvoiceForOrderTrigger: async () => { throw new Error('Billing unavailable'); } } as any,
    autoCloseReconciler: async () => null,
  });
  return { f, database, dashboard, shipment, pickup, service, projections };
}

describe('canonical physical fulfillment operational completion (mocked database)', () => {
  test('full shipment commits operational completion before any billing and excludes cancelled quantities', async () => {
    const x = fixture({ excluded: true, state: 'open' }); const financial = structuredClone(x.f.invoice);
    expect(await x.shipment.markShipped('org-1', 'shipment-1')).toMatchObject({ ok: true });
    expect(x.f.order).toMatchObject({ state: 'production_complete', status: 'operationally_complete', routingTarget: null, fulfillmentStatus: 'shipped' });
    expect(x.f.invoice).toEqual(financial);
    expect(filterActiveProductionOverviewFulfillmentJobs([{ stationKey: 'fulfillment', lineItemId: 'line-1' }], new Map(x.projections().map((line: any) => [line.id, line.projection])))).toEqual([]);
    const counts = { events: x.f.events.length, allocations: x.f.items.length };
    expect(await x.shipment.markShipped('org-1', 'shipment-1')).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    expect({ events: x.f.events.length, allocations: x.f.items.length }).toEqual(counts);
  });
  test.each([{ shipped: 10, picked: 0 }, { shipped: 4, picked: 6 }])('completed shipment/pickup totals reconcile together: %j', async options => {
    const x = fixture(options); await x.shipment.markShipped('org-1', 'shipment-1');
    expect(x.f.order.status).toBe('operationally_complete');
    expect(x.f.invoice.status).toBe('sent'); expect(x.f.invoice.balanceDue).toBe('125.00');
  });
  test('a partial shipment stays operationally active; label metadata alone fulfills nothing', async () => {
    const x = fixture({ shipped: 4 }); x.f.shipment.carrierShipmentId = 'label-metadata-only';
    await x.database.transaction((tx: any) => x.dashboard.reconcileOperationalCompletion('org-1', 'order-1', tx));
    expect(x.f.order.status).toBe('ready_for_shipment');
    await x.shipment.markShipped('org-1', 'shipment-1');
    expect(x.f.order.status).toBe('ready_for_shipment'); expect(x.projections()[0].projection.remainingQuantity).toBe(6);
  });
  test('full and partial pickup use the same operation; replay does not create another handoff or invoice', async () => {
    const x = fixture(); x.f.order.shippingMethod = 'pickup';
    const request = { items: [{ orderLineItemId: 'line-1', quantity: 4 }], clientRequestId: 'pickup-1', effectivePickupDate: '2026-10-29' };
    expect(await x.pickup.recordPartialPickup('org-1', 'ticket-1', request)).toMatchObject({ ok: true, terminal: false });
    expect(x.f.order.status).toBe('ready_for_shipment');
    await x.pickup.recordPartialPickup('org-1', 'ticket-1', { ...request, clientRequestId: 'pickup-2', items: [{ orderLineItemId: 'line-1', quantity: 6 }] });
    expect(x.f.order.status).toBe('operationally_complete'); expect(x.f.ticket.status).toBe('PICKED_UP');
    await x.pickup.recordPartialPickup('org-1', 'ticket-1', request);
    expect(x.f.handoffs).toHaveLength(2); expect(x.f.handoffItems).toHaveLength(2); expect(x.f.invoice.balanceDue).toBe('125.00');
  });
  test('competing reconciliation requests append one completion event under the shared parent/line protocol', async () => {
    const x = fixture(); x.f.shipment.status = 'SHIPPED';
    const invoke = () => x.database.transaction((tx: any) => x.dashboard.reconcileOperationalCompletion('org-1', 'order-1', tx));
    await Promise.all([invoke(), invoke(), invoke()]);
    expect(x.f.events.filter((event: any) => event.eventType === 'FULFILLMENT_OPERATIONALLY_COMPLETED')).toHaveLength(1);
    expect(x.f.locks[0]).toMatchObject({ table: 'orders', params: ['org-1', 'order-1'] });
    expect(x.f.locks.some((lock: any) => lock.sql?.includes('FOR UPDATE'))).toBe(true);
  });
  test.each(['quantity', 'owner', 'run'])('unfinished production %s blocks terminal completion without changing production or financials', async conflict => {
    const x = fixture({ produced: conflict === 'quantity' ? 5 : 10 });
    if (conflict === 'quantity') { x.f.lines[0].status = 'active'; x.f.lines[0].workflowState = 'in_progress'; }
    if (conflict === 'owner') x.f.activeJobs = [{ id: 'active-production' }];
    if (conflict === 'run') x.f.activeRuns = [{ id: 'active-run' }];
    await expect(x.shipment.markShipped('org-1', 'shipment-1')).rejects.toMatchObject({ status: 409 });
    expect(x.f.shipment.status).toBe('DRAFT'); expect(x.f.order.status).toBe('ready_for_shipment');
    expect(x.f.invoice.balanceDue).toBe('125.00');
  });
  test('tenant mismatch cannot complete an order', async () => {
    const x = fixture(); x.f.shipment.status = 'SHIPPED';
    expect(await x.database.transaction((tx: any) => x.dashboard.reconcileOperationalCompletion('other-org', 'order-1', tx))).toMatchObject({ complete: false });
    expect(x.f.writes).toEqual([]);
  });
  test('reconciliation preserves a delivered milestone once canonical quantities are verified complete', async () => {
    const x = fixture(); x.f.shipment.status = 'SHIPPED'; x.f.order.fulfillmentStatus = 'delivered';
    await x.database.transaction((tx: any) => x.dashboard.reconcileOperationalCompletion('org-1', 'order-1', tx));
    expect(x.f.order).toMatchObject({ status: 'operationally_complete', fulfillmentStatus: 'delivered' });
  });
  test('physical reconciliation does not bypass an open service-only Order lifecycle', async () => {
    const x = fixture({ state: 'open' }); x.f.lines[0].workflowIntent = 'service_fee';
    expect(await x.database.transaction((tx: any) => x.dashboard.reconcileOperationalCompletion('org-1', 'order-1', tx))).toMatchObject({ complete: false });
    expect(x.f.order.state).toBe('open'); expect(x.f.writes).toEqual([]);
  });
  test.each([
    { sourceType: 'SHIPMENT' as const, closed: false }, { sourceType: 'PICKUP_HANDOFF' as const, closed: false },
    { sourceType: 'SHIPMENT' as const, closed: true }, { sourceType: 'PICKUP_HANDOFF' as const, closed: true },
  ])('$sourceType reversal (closed=$closed) reopens net obligations and board visibility while retaining history and financials', async ({ sourceType, closed }) => {
    const x = fixture();
    if (sourceType === 'SHIPMENT') await x.shipment.markShipped('org-1', 'shipment-1');
    else {
      x.f.order.shippingMethod = 'pickup';
      await x.pickup.recordPartialPickup('org-1', 'ticket-1', { items: [{ orderLineItemId: 'line-1', quantity: 10 }], clientRequestId: 'pickup-full', effectivePickupDate: '2026-10-29' });
    }
    if (closed) {
      x.f.order.state = 'closed'; x.f.order.status = 'completed';
      Object.assign(x.f.invoice, { status: 'paid', balanceDue: '0.00', payments: [{ id: 'payment-1', amountCents: 12500, status: 'succeeded' }] });
    }
    const invoice = structuredClone(x.f.invoice);
    const request = { sourceType, sourceId: sourceType === 'SHIPMENT' ? 'shipment-1' : x.f.handoffs[0].id,
      items: [{ orderLineItemId: 'line-1', quantity: 3 }], reason: 'QA correction only', clientRequestId: 'reverse-1', actorOrgRole: 'owner' };
    await x.service.reverseTerminalFulfillment('org-1', request);
    expect(x.f.order).toMatchObject({ state: 'production_complete', status: 'ready_for_shipment', canonicalState: 'ready', routingTarget: 'fulfillment' });
    expect(x.projections()[0].projection.remainingQuantity).toBe(3);
    expect(filterActiveProductionOverviewFulfillmentJobs([{ stationKey: 'fulfillment', lineItemId: 'line-1' }], new Map(x.projections().map((line: any) => [line.id, line.projection])))).toHaveLength(1);
    const counts = { events: x.f.events.length, items: x.f.items.length, handoffs: x.f.handoffs.length };
    await x.service.reverseTerminalFulfillment('org-1', request);
    expect({ events: x.f.events.length, items: x.f.items.length, handoffs: x.f.handoffs.length }).toEqual(counts);
    expect(x.f.invoice).toEqual(invoice);
    if (sourceType === 'SHIPMENT') expect(x.f.shipment.status).toBe('SHIPPED');
    else expect(x.f.ticket.status).toBe('READY_FOR_PICKUP');
  });
  test('a downstream billing failure cannot prevent the physical transaction from recording operational completion', async () => {
    const x = fixture(); const invoice = structuredClone(x.f.invoice);
    jest.spyOn(x.dashboard, 'logChecklistVerified').mockResolvedValue(undefined);
    await expect(x.service.markShipmentShipped('org-1', 'shipment-1')).rejects.toThrow('Billing unavailable');
    expect(x.f.shipment.status).toBe('SHIPPED'); expect(x.f.order.status).toBe('operationally_complete');
    expect(x.f.invoice).toEqual(invoice);
  });
});
