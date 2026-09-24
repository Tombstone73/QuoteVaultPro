import { beforeAll, describe, expect, jest, test } from '@jest/globals';
import { getTableColumns } from 'drizzle-orm';
import { auditLogs, fulfillmentEvents, invoices, orderAuditLog, orderLineItems, orders, productionJobs, productionRuns } from '@shared/schema';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
import { assessOrderAutoClose } from '../services/orderAutoClosePolicy';
import { isFulfillmentQueueEligibleOrder } from '../services/fulfillment/eligibility';
import { filterActiveProductionOverviewFulfillmentJobs } from '../services/fulfillment/productionOverviewFulfillment';

const runtimeDb: any = {};
jest.unstable_mockModule('../db', () => ({ db: runtimeDb }));
jest.unstable_mockModule('../services/workflowStatusPillService', () => ({ applyWorkflowStatusPillFailSoft: async () => null }));
jest.unstable_mockModule('../emailService', () => ({ emailService: {} }));
jest.unstable_mockModule('../services/billingInvoiceAutomation', () => ({ billingInvoiceAutomationService: {} }));

// In-memory adapter for service orchestration; no PostgreSQL behavior is claimed.
// Quantity semantics use the real shared production/fulfillment projection.
class FixtureRepository {
  constructor(private runner: any) {}
  async assertNoActiveProduction() {
    if (this.runner.fixture.activeJobs.length || this.runner.fixture.activeRuns.length) throw new Error('Production work remains');
  }
  async listLineEligibility() {
    const f = this.runner.fixture;
    return f.lines.map((line: any) => ({ id: line.id, orderId: f.order.id, projection: resolveFulfillmentLineQuantity({
      orderedQuantity: line.quantity, workflowIntent: 'standard_production', requiresProductionJob: true,
      lifecycleStatus: line.status, administrativelyReconciledQuantity: f.allocated,
    }) }));
  }
  async reconcileAdministrativeFulfillment() {
    const f = this.runner.fixture;
    const lines = await this.listLineEligibility();
    if (lines.some((line: any) => line.projection.productionCompleteQuantity < line.projection.orderedQuantity)) return { ok: false, code: 'PRODUCTION_NOT_COMPLETE', message: 'Production remains' };
    const remaining = lines.reduce((sum: number, line: any) => sum + line.projection.remainingQuantity, 0);
    f.allocated += remaining;
    if (f.failAfterAllocation) throw new Error('injected reconciliation failure');
    return { ok: true, allocations: remaining ? [{ lineItemId: 'line-1', quantity: remaining }] : [], remainingQuantity: 0, physicallyFulfilledQuantity: 0, administrativelyReconciledQuantity: f.allocated };
  }
}
jest.unstable_mockModule('../services/fulfillment/repository', () => ({
  FulfillmentDashboardRepo: FixtureRepository, ShipmentRepo: class {}, PickupRepo: class {}, resolveExistingActorUserId: async () => 'actor-1',
}));
const productionRepair = jest.fn(async (database: any) => database.transaction(async (tx: any) => {
  tx.fixture.lines.forEach((line: any) => { line.status = 'complete'; });
  return { status: 'applied' };
}));
jest.unstable_mockModule('../services/historicalCloseJobProductionRepairService', () => ({ applyHistoricalCloseJobProductionRepair: productionRepair }));
let FulfillmentService: typeof import('../services/fulfillment/service').FulfillmentService;
let repair: typeof import('../services/historicalCloseJobOperationalRepairService');
beforeAll(async () => {
  ({ FulfillmentService } = await import('../services/fulfillment/service'));
  repair = await import('../services/historicalCloseJobOperationalRepairService');
});

function fixture(options: { method?: string; allocated?: number; evidence?: boolean; status?: string; invoiceStatus?: string; balance?: string; lineStatus?: string } = {}) {
  const f: any = {
    order: { id: 'order-20492', orderNumber: '20492', organizationId: 'org-1', state: 'production_complete', status: options.status ?? 'ready_for_shipment', fulfillmentStatus: 'delivered', routingTarget: 'fulfillment', shippingMethod: options.method ?? 'ship' },
    lines: [{ id: 'line-1', quantity: 5, status: options.lineStatus ?? 'complete', updatedAt: '2026-09-20T10:00:00Z' }],
    allocated: options.allocated ?? 0, events: [], audits: [], orderAudits: [], activeJobs: [], activeRuns: [], mutations: [],
    invoice: { status: options.invoiceStatus ?? 'sent', balanceDue: options.balance ?? '125.00', subtotal: '100', tax: '25', approval: 'approved', sendHistory: ['send-1'], payments: [], quickbooksId: 'qb-1' },
  };
  if (options.evidence !== false) {
    f.events.push({ id: 'event-1', entityId: f.order.id, eventType: 'FULFILLMENT_HISTORICAL_RECONCILED', actorUserId: 'actor-1', createdAt: '2026-09-21T10:00:00Z', payloadJson: { source: 'administrative_historical_reconciliation', shipmentOrPickupEvidenceCreated: false, billingAutomationSuppressed: true } });
    f.audits.push({ id: 'audit-1', actionType: 'ORDER_HISTORICAL_FULFILLMENT_RECONCILED', entityType: 'order' });
  }
  const rows = (table: any) => table === orders ? [f.order] : table === orderLineItems ? f.lines : table === fulfillmentEvents ? f.events : table === auditLogs ? f.audits : table === orderAuditLog ? f.orderAudits : table === invoices ? [f.invoice] : table === productionJobs ? f.activeJobs : table === productionRuns ? f.activeRuns : [];
  const db: any = {
    fixture: f,
    select: (fields?: any) => ({ from: (table: any) => {
      const project = (row: any) => fields ? Object.fromEntries(Object.entries(fields).map(([key, column]) => {
        const source = Object.entries(getTableColumns(table)).find(([, value]) => value === column)?.[0];
        return [key, row[source ?? key]];
      })) : { ...row };
      const chain: any = { where: () => chain, limit: () => chain, for: () => chain, innerJoin: () => chain, orderBy: () => chain, then: (resolve: any, reject: any) => Promise.resolve(rows(table).map(project)).then(resolve, reject) };
      return chain;
    } }),
    execute: async () => [],
    update: (table: any) => ({ set: (values: any) => ({ where: () => {
      const mutate = async () => {
        if (table !== orders) throw new Error('Unexpected mutation');
        f.mutations.push(values); Object.assign(f.order, values); return [{ id: f.order.id }];
      };
      return { then: (resolve: any, reject: any) => mutate().then(resolve, reject), returning: mutate };
    } }) }),
    insert: (table: any) => ({ values: async (values: any) => {
      if (![fulfillmentEvents, auditLogs, orderAuditLog].includes(table)) throw new Error('Unexpected evidence or financial write');
      rows(table).push({ id: `new-${rows(table).length}`, createdAt: new Date().toISOString(), ...values });
    } }),
    transaction: async (fn: any) => {
      const snapshot = structuredClone(f);
      try { return await fn(db); } catch (error) { Object.assign(f, snapshot); throw error; }
    },
  };
  const billing = jest.fn(async () => { throw new Error('Financial automation forbidden'); });
  const service = new FulfillmentService({ dbInstance: db, dashboardRepo: new FixtureRepository(db) as any,
    billingAutomationService: { ensureOrderBackedInvoiceForOrderTrigger: billing } as any, autoCloseReconciler: async () => null });
  return { f, db, service, billing };
}
const input = { organizationId: 'org-1', orderId: 'order-20492' };

describe('Close Job operational completion', () => {
  test.each(['pickup', 'ship', 'delivery'])('%s override consumes obligations without physical or financial evidence', async method => {
    const { f, db, service, billing } = fixture({ method, evidence: false });
    const financialBefore = structuredClone(f.invoice);
    await service.reconcileHistoricalFulfillment('org-1', { orderId: f.order.id, reason: 'historical_backlog_cleanup' });
    const lines = await new FixtureRepository(db).listLineEligibility();
    expect(lines[0].projection).toMatchObject({ remainingQuantity: 0, productionCompleteQuantity: 5, fulfilledQuantity: 0 });
    expect(f.order).toMatchObject({ state: 'production_complete', status: 'operationally_complete', canonicalState: 'completed', routingTarget: null });
    expect(isFulfillmentQueueEligibleOrder(f.order)).toBe(false);
    expect(filterActiveProductionOverviewFulfillmentJobs([{ stationKey: 'fulfillment', lineItemId: 'line-1' }], new Map([['line-1', lines[0].projection]]))).toEqual([]);
    expect(f.invoice).toEqual(financialBefore);
    expect(billing).not.toHaveBeenCalled();
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ eventType: 'FULFILLMENT_HISTORICAL_RECONCILED', payloadJson: { shipmentOrPickupEvidenceCreated: false, billingAutomationSuppressed: true } });
  });

  test('20492: already-reconciled quantities still advance the stale parent, once', async () => {
    const { f, service } = fixture({ allocated: 5 });
    const invoke = () => service.reconcileHistoricalFulfillment('org-1', { orderId: f.order.id, reason: 'historical_backlog_cleanup' });
    await invoke();
    const after = structuredClone(f);
    await invoke();
    expect(f).toEqual(after);
    expect(f.order.status).toBe('operationally_complete');
  });

  test('unfinished production blocks reconciliation and remains operationally active', async () => {
    const { f, service } = fixture({ lineStatus: 'new' });
    f.order.fulfillmentStatus = 'pending';
    await expect(service.reconcileHistoricalFulfillment('org-1', { orderId: f.order.id, reason: 'historical_backlog_cleanup' })).rejects.toMatchObject({ code: 'PRODUCTION_NOT_COMPLETE' });
    expect(f.allocated).toBe(0);
    expect(isFulfillmentQueueEligibleOrder(f.order)).toBe(true);
  });

  test('production done with fulfillment remaining stays ready and actionable', async () => {
    const { f, db } = fixture(); f.order.fulfillmentStatus = 'pending';
    const [line] = await new FixtureRepository(db).listLineEligibility();
    expect(line.projection).toMatchObject({ productionCompleteQuantity: 5, remainingQuantity: 5 });
    expect(f.order.status).toBe('ready_for_shipment');
    expect(isFulfillmentQueueEligibleOrder(f.order)).toBe(true);
  });

  test.each([['sent', '125.00', 'not_eligible'], ['partial', '25.00', 'not_eligible'], ['paid', '0', 'closed']])('invoice %s preserves financial facts and downstream closure policy', async (invoiceStatus, balance, action) => {
    const { f, service } = fixture({ invoiceStatus, balance });
    const before = structuredClone(f.invoice);
    await service.reconcileHistoricalFulfillment('org-1', { orderId: f.order.id, reason: 'historical_backlog_cleanup' });
    expect(f.invoice).toEqual(before);
    expect(assessOrderAutoClose({ ...f.order, lineItems: [{ status: 'complete', workflowIntent: 'standard_production' }], invoices: [f.invoice] }).action).toBe(action);
    expect(f.order.state).toBe('production_complete');
  });
  test.each([['sent', '125.00', 'not_eligible'], ['partial', '25.00', 'not_eligible'], ['paid', '0', 'closed']])('actual auto-close service projects completion before considering %s payment', async (invoiceStatus, balance, action) => {
    const { f, db } = fixture({ invoiceStatus, balance, allocated: 5 });
    Object.assign(runtimeDb, db);
    const before = structuredClone(f.invoice);
    const { reconcileOrderAutoClose } = await import('../services/orderAutoCloseService');
    expect((await reconcileOrderAutoClose({ ...input, source: 'test' })).action).toBe(action);
    expect(f.invoice).toEqual(before);
    expect(f.order.status).toBe(action === 'closed' ? 'completed' : 'operationally_complete');
    expect(f.order.state).toBe(action === 'closed' ? 'closed' : 'production_complete');
  });
});

describe('Historical operational repair', () => {
  test('dry run selects durable evidence and reports quantities without writes', async () => {
    const { f, db } = fixture(); const before = structuredClone(f);
    const rows = await repair.listHistoricalCloseJobOperationalRepairs(db, 'org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderNumber: '20492', orderStatus: 'ready_for_shipment', remainingProductionQuantity: 0, remainingFulfillmentQuantity: 5, evidence: { eventId: 'event-1', auditId: 'audit-1' }, candidate: true, safe: true, proposedOperationalStatus: 'operationally_complete' });
    expect(f).toEqual(before);
  });
  test('apply repairs canonical obligations and a second run writes no records', async () => {
    const { f, db } = fixture();
    expect((await repair.applyHistoricalCloseJobOperationalRepair(db, input)).status).toBe('applied');
    const after = structuredClone(f);
    expect((await repair.applyHistoricalCloseJobOperationalRepair(db, input)).status).toBe('already_correct');
    expect(f).toEqual(after);
    expect(f.order.status).toBe('operationally_complete');
    expect(f.allocated).toBe(5);
  });
  test('missing historical production reuses the guarded production repair before fulfillment', async () => {
    const { f, db } = fixture({ lineStatus: 'new' });
    expect((await repair.previewHistoricalCloseJobOperationalRepair(db, input)).remainingProductionQuantity).toBe(5);
    await repair.applyHistoricalCloseJobOperationalRepair(db, input);
    expect(productionRepair).toHaveBeenCalled();
    expect(f.lines[0].status).toBe('complete');
    expect(f.allocated).toBe(5);
    expect(f.order.status).toBe('operationally_complete');
  });
  test('ordinary ready-for-shipment order without override evidence is untouched', async () => {
    const { f, db } = fixture({ evidence: false }); const before = structuredClone(f);
    expect(await repair.listHistoricalCloseJobOperationalRepairs(db, 'org-1')).toEqual([]);
    await expect(repair.applyHistoricalCloseJobOperationalRepair(db, input)).rejects.toThrow('UNPROVEN_SUCCESSFUL_OVERRIDE');
    expect(f).toEqual(before);
  });
  test.each(['audit', 'event'])('missing %s evidence blocks mutation', async kind => {
    const { f, db } = fixture(); f[kind === 'audit' ? 'audits' : 'events'] = [];
    expect((await repair.previewHistoricalCloseJobOperationalRepair(db, input)).safe).toBe(false);
    await expect(repair.applyHistoricalCloseJobOperationalRepair(db, input)).rejects.toThrow('UNPROVEN_SUCCESSFUL_OVERRIDE');
  });
  test.each(['owner', 'run', 'changed-line', 'reopened', 'canceled'])('%s is held for staff review', async conflict => {
    const { f, db } = fixture();
    if (conflict === 'owner') f.activeJobs = [{ id: 'owner', stationKey: 'flatbed' }];
    if (conflict === 'run') f.activeRuns = [{ id: 'run' }];
    if (conflict === 'changed-line') f.lines[0].updatedAt = '2026-09-24T10:00:00Z';
    if (conflict === 'reopened') f.order.state = 'open';
    if (conflict === 'canceled') f.order.state = 'canceled';
    expect((await repair.previewHistoricalCloseJobOperationalRepair(db, input)).safe).toBe(false);
    await expect(repair.applyHistoricalCloseJobOperationalRepair(db, input)).rejects.toThrow('Historical repair blocked');
  });
  test('a fulfillment failure rolls the transaction back', async () => {
    const { f, db } = fixture(); f.failAfterAllocation = true;
    const before = structuredClone(f);
    await expect(repair.applyHistoricalCloseJobOperationalRepair(db, input)).rejects.toThrow('injected reconciliation failure');
    expect(f).toEqual(before);
  });
  test('historically closed orders never regress to financially open', async () => {
    const { f, db } = fixture(); f.order.state = 'closed'; f.order.status = 'completed';
    await repair.applyHistoricalCloseJobOperationalRepair(db, input);
    expect(f.order).toMatchObject({ state: 'closed', status: 'completed' });
  });
});
