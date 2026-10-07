import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deriveOrderCreditHold, unbilledOrderExposureCents } from '../../shared/orderCreditHold';

let rows: Record<string, any[]>;
let writes: any[];
let queries: string[];
const runner: any = {
  select: () => {
    let table = '';
    const q: any = {
      from: (t: any) => { table = getTableName(t); return q; },
      where: (condition: any) => { queries.push(new PgDialect().sqlToQuery(condition).sql); return q; },
      leftJoin: () => q, innerJoin: () => q, orderBy: () => q, for: () => q,
      limit: async () => (rows[table] ?? []).slice(0, 1),
      then: (resolve: any, reject: any) => Promise.resolve(rows[table] ?? []).then(resolve, reject),
    };
    return q;
  },
  insert: (table: any) => ({ values: async (value: any) => { writes.push(value); (rows[getTableName(table)] ??= []).unshift({ createdAt: new Date(), ...value }); } }),
  update: (table: any) => ({ set: (patch: any) => ({ where: async () => { for (const row of rows[getTableName(table)] ?? []) Object.assign(row, patch); } }) }),
  transaction: async (fn: any) => fn(runner),
};
jest.unstable_mockModule('../db', () => ({ db: runner }));
jest.unstable_mockModule('../services/canonicalPrepressOperations', () => ({ canonicalPrepressOperations: {} }));
jest.unstable_mockModule('../services/productionScheduling', () => ({ scheduleOrderLineItemsForProduction: jest.fn() }));
jest.unstable_mockModule('../services/orderProductionGate', () => ({ assertParentOrderInProductionForJob: jest.fn() }));
jest.unstable_mockModule('../routes/production.shared', () => ({ appendEvent: jest.fn(), getTimerStateForJob: async () => ({ isRunning: false }) }));
let policy: typeof import('../services/orderCreditHoldService');
let route: typeof import('../services/productionRoutingService').routeLineItemToProduction;
let transition: typeof import('../services/productionOwnership').transitionToStation;
let start: typeof import('../services/canonicalProductionOperations').canonicalProductionOperations;
beforeAll(async () => {
  policy = await import('../services/orderCreditHoldService');
  route = (await import('../services/productionRoutingService')).routeLineItemToProduction;
  transition = (await import('../services/productionOwnership')).transitionToStation;
  start = (await import('../services/canonicalProductionOperations')).canonicalProductionOperations;
});
beforeEach(() => {
  rows = {
    orders: [{ id: 'order', customerId: 'customer', total: '500.00', state: 'open', status: 'new' }],
    customers: [{ id: 'customer', creditLimit: '0.00', creditLimitConfiguredAt: new Date() }],
    invoices: [{ canonicalCustomerId: 'customer', invoice: { id: 'invoice', orderId: 'order', totalCents: 50000, status: 'billed' } }],
    payments: [], audit_logs: [], order_line_items: [{ id: 'line', orderId: 'order', productionBypassed: false }],
    production_jobs: [{ id: 'job', orderId: 'order', lineItemId: 'line', stationKey: 'roll', stepKey: 'queued', status: 'queued' }],
  };
  writes = []; queries = [];
});
const hold = async () => (await policy.getOrderCreditHold(runner, { organizationId: 'org', orderId: 'order' })).creditHold;
const payment = (amountCents: number, status = 'succeeded') => rows.payments.push({ invoiceId: 'invoice', amountCents, status });
describe('derived production credit position from canonical invoice/payment evidence', () => {
  test('zero credit permits capture but holds $500 of physical work', async () => {
    expect(await hold()).toMatchObject({ held: true, requiredPaymentCents: 50000 });
    expect(writes).toEqual([]);
  });
  test('unset credit permits capture but does not grant unlimited production credit', async () => {
    rows.customers[0].creditLimitConfiguredAt = null;
    expect(await hold()).toMatchObject({ held: true, creditLimitCents: 0 });
  });
  test('full payment automatically clears the derived hold without an Order edit', async () => {
    payment(50000); expect(await hold()).toMatchObject({ held: false, requiredPaymentCents: 0 }); expect(writes).toEqual([]);
  });
  test('partial payments plus available credit clear only the uncovered balance', async () => {
    rows.customers[0].creditLimit = '100.00'; payment(25000);
    expect(await hold()).toMatchObject({ held: true, requiredPaymentCents: 15000 });
    payment(15000); expect((await hold()).held).toBe(false);
  });
  test('sufficient terms credit has no hold', async () => {
    rows.customers[0].creditLimit = '2000.00'; expect((await hold()).held).toBe(false);
  });
  test('other A/R consumes the same credit facility', async () => {
    rows.customers[0].creditLimit = '600.00';
    rows.invoices.push({ canonicalCustomerId: 'customer', invoice: { id: 'older', totalCents: 20000, status: 'billed' } });
    expect(await hold()).toMatchObject({ held: true, exposureCents: 70000, requiredPaymentCents: 10000 });
  });
  test('paid invoice remains immutable while a commercial increase restores hold', async () => {
    payment(50000); expect((await hold()).held).toBe(false);
    rows.orders[0].total = '700.00'; expect(await hold()).toMatchObject({ held: true, requiredPaymentCents: 20000 });
    expect(rows.invoices[0].invoice.totalCents).toBe(50000); expect(writes).toEqual([]);
  });
  test('reversal reopens exposure despite a stale Paid workflow label', async () => {
    payment(50000); rows.invoices[0].invoice.status = 'paid'; expect((await hold()).held).toBe(false);
    payment(20000, 'refunded'); expect(await hold()).toMatchObject({ held: true, requiredPaymentCents: 20000 });
  });
  test.each(['closed', 'production_complete'])('historical %s Order never acquires hold', async state => {
    rows.orders[0].state = state; expect((await hold()).held).toBe(false);
  });
  test('queries carry organization scoping and missing Order fails closed', async () => {
    await hold(); expect(queries.filter(sql => sql.includes('organization_id')).length).toBeGreaterThanOrEqual(5);
    rows.orders = []; await expect(hold()).rejects.toMatchObject({ statusCode: 404 });
  });
});
describe('authoritative production boundaries', () => {
  test.each([{ stationKey: 'design' }, { stationKey: 'prepress' }, { stationKey: 'proofing' }, { stationKey: 'custom', stepKey: 'prepress' }, { stationKey: 'fulfillment' }])('allows preparation/fulfillment %p without credit reads', async destination => {
    await policy.assertProductionCredit(runner, { organizationId: 'org', orderId: 'order', ...destination }); expect(queries).toEqual([]);
  });
  test('cannot bypass physical destination with a design step', async () => {
    await expect(policy.assertProductionCredit(runner, { organizationId: 'org', orderId: 'order', stationKey: 'flatbed', stepKey: 'design' })).rejects.toMatchObject({ code: 'PRODUCTION_CREDIT_HOLD' });
  });
  test('direct route fails before physical job insertion', async () => {
    await expect(route({ tx: runner, organizationId: 'org', orderId: 'order', lineItemId: 'line', stationKey: 'roll', stepKey: 'queued', trigger: 'intake' })).rejects.toMatchObject({ code: 'PRODUCTION_CREDIT_HOLD' }); expect(writes).toEqual([]);
  });
  test('direct routing cannot recreate a production owner on a bypassed line', async () => {
    rows.order_line_items[0].productionBypassed = true;
    await expect(route({ tx: runner, organizationId: 'org', orderId: 'order', lineItemId: 'line', stationKey: 'roll', stepKey: 'queued', trigger: 'intake' }))
      .rejects.toMatchObject({ code: 'PRODUCTION_BYPASSED', statusCode: 409 });
    expect(writes).toEqual([]);
  });
  test('station handoff fails before closing the current preparatory owner', async () => {
    await expect(transition(runner, { organizationId: 'org', orderId: 'order', lineItemId: 'line', targetStationKey: 'flatbed', targetStepKey: 'queued', reason: 'handoff' })).rejects.toMatchObject({ code: 'PRODUCTION_CREDIT_HOLD' }); expect(writes).toEqual([]);
  });
  test('Start Production rechecks legacy queued jobs', async () => {
    await expect(start.startJobInTransaction(runner, { organizationId: 'org', jobId: 'job' })).rejects.toMatchObject({ code: 'PRODUCTION_CREDIT_HOLD', statusCode: 409 }); expect(writes).toEqual([]);
  });
  test('Start Production rejects a bypassed physical line before credit or timer changes', async () => {
    rows.order_line_items[0].productionBypassed = true;
    await expect(start.startJobInTransaction(runner, { organizationId: 'org', jobId: 'job' }))
      .rejects.toMatchObject({ code: 'PRODUCTION_BYPASSED', statusCode: 409 });
    expect(writes).toEqual([]);
  });
  test('Start Production remains available for a non-bypassed line after credit clears', async () => {
    payment(50000);
    await expect(start.startJobInTransaction(runner, { organizationId: 'org', jobId: 'job' }))
      .resolves.toMatchObject({ id: 'job', status: 'in_progress' });
  });
  test('after sufficient payment the authoritative guard allows release', async () => {
    payment(50000); await expect(policy.assertProductionCredit(runner, { organizationId: 'org', orderId: 'order', stationKey: 'roll' })).resolves.toBeUndefined();
  });
  test('override requires role, confirmation and reason, audits and expires on changed financial position', async () => {
    const input = { organizationId: 'org', orderId: 'order', actorUserId: 'owner', actorOrgRole: 'owner', reason: 'Approved exception', confirmed: true };
    await expect(policy.overrideOrderProductionCredit({ ...input, actorOrgRole: 'staff' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(policy.overrideOrderProductionCredit({ ...input, confirmed: false })).rejects.toMatchObject({ statusCode: 400 });
    await expect(policy.overrideOrderProductionCredit({ ...input, reason: '' })).rejects.toMatchObject({ statusCode: 400 });
    await policy.overrideOrderProductionCredit(input);
    expect(writes[0]).toMatchObject({ userId: 'owner', entityId: 'order', newValues: { reason: 'Approved exception', confirmed: true, orderTotalCents: 50000 } });
    expect(await hold()).toMatchObject({ held: false, overrideApplied: true });
    rows.orders[0].total = '700.00'; expect((await hold()).held).toBe(true);
  });
});
describe('unbilled commercial exposure', () => {
  test('unbilled delta never double counts the full invoiced Order', () => {
    expect(unbilledOrderExposureCents(50000, 50000)).toBe(0); expect(unbilledOrderExposureCents(70000, 50000)).toBe(20000);
  });
});
