import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';

const dialect = new PgDialect();
let state: any;
let failReadiness = false;
let finishingMode = 'standard';
let transactionQueue = Promise.resolve();
const completeJob = jest.fn(async (_tx: any, args: any) => {
  state.job.status = 'done';
  state.line.workflowState = 'completed';
  state.line.status = 'complete';
  return { ...state.job, nextStationKey: 'fulfillment' };
});
const statusPill = jest.fn(async () => undefined);
const adjustReady = jest.fn(async (_tx: any, _org: string, _order: string, items: any[]) => {
  if (failReadiness) return { ok: false, code: 'QTY_NOT_READY', message: 'Readiness rejected' };
  state.ready += items[0].quantityDelta;
  return { ok: true };
});
const projection = () => resolveFulfillmentLineQuantity({ orderedQuantity: state.line.quantity,
  workflowState: state.line.workflowState, lifecycleStatus: state.line.status,
  workflowIntent: 'standard_production', requiresProductionJob: true,
  activeOwnerStationKey: state.job.status === 'done' ? 'fulfillment' : 'roll',
  productionCompleteQuantity: 0, readyWaitingQuantity: state.ready, shippedQuantity: state.shipped ?? 0 });

const tx: any = {
  select: () => {
    let table = '';
    let condition: any;
    const rows = () => {
      if (table === 'production_jobs') return condition?.params.includes(state.job.organizationId) ? [state.job] : [];
      if (table === 'orders') return [state.order];
      if (table === 'order_line_items') return [state.line];
      if (table === 'production_run_members') return state.runMembers;
      if (table === 'production_station_steps') return [{ triggers: [] }];
      if (table === 'fulfillment_events') {
        const requestId = condition?.params.find((value: unknown) => typeof value === 'string' && value.includes('0000-0000'));
        return state.events.filter((event: any) => event.payloadJson.clientRequestId === requestId);
      }
      return [];
    };
    const query: any = { from: (value: any) => { table = getTableName(value); return query; },
      where: (value: any) => { condition = dialect.sqlToQuery(value); return query; },
      for: () => query, limit: async () => rows().slice(0, 1),
      then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return query;
  },
  insert: (table: any) => ({ values: async (value: any) => {
    if (getTableName(table) === 'fulfillment_events') state.events.push(value);
  } }),
};

jest.unstable_mockModule('../db', () => ({ db: { transaction: async (callback: any) => {
  const prior = transactionQueue;
  let release!: () => void;
  transactionQueue = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  const snapshot = structuredClone(state);
  try { return await callback(tx); } catch (error) { state = snapshot; throw error; } finally { release(); }
} } }));
jest.unstable_mockModule('../routes/productionJobs.routes', () => ({ completeProductionJobWorkflow: completeJob }));
jest.unstable_mockModule('../routes/production.shared', () => ({ getProductionConfigForOrganization: async () => ({ finishingMode }) }));
jest.unstable_mockModule('../services/workflowStatusPillService', () => ({ applyWorkflowStatusPillFailSoft: statusPill }));
jest.unstable_mockModule('../services/fulfillment/repository', () => ({ FulfillmentDashboardRepo: class {
  async listLineEligibility() { return [{ id: 'line-1', orderId: 'order-1', projection: projection() }]; }
  adjustReadyQuantitiesInTransaction(...args: any[]) { return adjustReady(...(args as [any, any, any, any])); }
} }));

let complete: typeof import('../services/fulfillment/productionCompletion').completeProductionFromFulfillment;
beforeAll(async () => { complete = (await import('../services/fulfillment/productionCompletion')).completeProductionFromFulfillment; });
beforeEach(() => {
  state = { job: { id: 'job-1', orderId: 'order-1', lineItemId: 'line-1', organizationId: 'org-1',
    stationKey: 'roll', stepKey: 'queued', status: 'queued' },
    line: { id: 'line-1', orderId: 'order-1', quantity: 100, productionBypassed: false,
      workflowState: 'in_production', status: 'in_production' },
    order: { state: 'open', status: 'in_production', canceledAt: null },
    runMembers: [], ready: 0, events: [] };
  failReadiness = false;
  finishingMode = 'standard';
  completeJob.mockClear(); statusPill.mockClear(); adjustReady.mockClear();
  transactionQueue = Promise.resolve();
});
const request = { organizationId: 'org-1', orderId: 'order-1', lineItemId: 'line-1', jobId: 'job-1', quantity: 100,
  clientRequestId: '00000000-0000-4000-8000-000000000001', actorUserId: 'user-1', actorOrgRole: 'employee' };

describe('Fulfillment production completion', () => {
  test('uses canonical completion and makes the confirmed full line available to shipment allocation', async () => {
    const result = await complete(request);
    expect(result.replayed).toBe(false);
    expect(completeJob).toHaveBeenCalledWith(tx, expect.objectContaining({ skipProduction: false,
      fulfillmentCompletion: { quantity: 100, clientRequestId: request.clientRequestId } }));
    expect(state.job.status).toBe('done');
    expect(state.ready).toBe(100);
    expect(projection()).toMatchObject({ productionCompleteQuantity: 100, readyWaitingQuantity: 100, eligibleQuantity: 100 });
    expect(state.events[0].payloadJson).toMatchObject({ source: 'fulfillment', quantity: 100,
      previousProductionState: { jobStatus: 'queued' }, newProductionState: { jobStatus: 'done', readyWaitingQuantity: 100 } });
    expect(statusPill).toHaveBeenCalledTimes(1);
  });

  test('a double submission replays one completion; a new request cannot complete it again', async () => {
    const [first, retry] = await Promise.all([complete(request), complete(request)]);
    expect([first.replayed, retry.replayed]).toEqual([false, true]);
    expect(completeJob).toHaveBeenCalledTimes(1);
    expect(adjustReady).toHaveBeenCalledTimes(1);
    expect(state.events).toHaveLength(1);
    await expect(complete({ ...request, clientRequestId: '00000000-0000-4000-8000-000000000002' }))
      .rejects.toMatchObject({ code: 'PRODUCTION_ALREADY_COMPLETED' });
  });

  test('partial quantity and combined-run work remain in their production workflow', async () => {
    await expect(complete({ ...request, quantity: 60 })).rejects.toMatchObject({ code: 'PARTIAL_PRODUCTION_UNSUPPORTED' });
    state.runMembers = [{ id: 'member-1' }];
    await expect(complete(request)).rejects.toMatchObject({ code: 'COMBINED_RUN_COMPLETION_REQUIRED' });
    expect(completeJob).not.toHaveBeenCalled();
    expect(state.ready).toBe(0);
  });

  test('permission and canceled-work guards fail before production changes', async () => {
    await expect(complete({ ...request, actorOrgRole: 'member' })).rejects.toMatchObject({ status: 403 });
    await expect(complete({ ...request, organizationId: 'org-other' })).rejects.toMatchObject({ status: 404 });
    state.order.canceledAt = new Date().toISOString();
    await expect(complete(request)).rejects.toMatchObject({ code: 'ORDER_CANCELLED' });
    state.order.canceledAt = null;
    state.job.status = 'canceled';
    await expect(complete(request)).rejects.toMatchObject({ code: 'PRODUCTION_JOB_TERMINAL' });
    expect(completeJob).not.toHaveBeenCalled();
  });

  test('does not complete a print job that still routes through finishing', async () => {
    finishingMode = 'dedicated_finishing_queue';
    await expect(complete(request)).rejects.toMatchObject({ code: 'PRODUCTION_ROUTE_NOT_FINAL' });
    expect(completeJob).not.toHaveBeenCalled();
    expect(state.ready).toBe(0);
  });

  test('preserves existing terminal fulfillment history', async () => {
    state.shipped = 1;
    await expect(complete(request)).rejects.toMatchObject({ code: 'FULFILLMENT_HISTORY_CONFLICT' });
    expect(completeJob).not.toHaveBeenCalled();
  });

  test('readiness rejection rolls back the completion and allows a safe retry', async () => {
    failReadiness = true;
    await expect(complete(request)).rejects.toMatchObject({ code: 'QTY_NOT_READY' });
    expect(state.job.status).toBe('queued');
    expect(state.ready).toBe(0);
    expect(state.events).toHaveLength(0);
    failReadiness = false;
    expect((await complete(request)).replayed).toBe(false);
    expect(state.ready).toBe(100);
  });
});
