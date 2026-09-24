import { beforeAll, expect, jest, test } from '@jest/globals';
import { fulfillmentAdministrativeReconciliations, productionJobs } from '@shared/schema';
import { resolveFulfillmentLineQuantity } from '@shared/fulfillmentReadiness';
jest.unstable_mockModule('../db', () => ({ db: {} }));
let FulfillmentDashboardRepo: typeof import('../services/fulfillment/repository').FulfillmentDashboardRepo;
beforeAll(async () => { ({ FulfillmentDashboardRepo } = await import('../services/fulfillment/repository')); });

function chain(rows: any[]) {
  const query: any = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => rows };
  return query;
}

test('real administrative ledger writes only remaining quantities and retires fulfillment owners idempotently', async () => {
  let allocated = 0;
  let activeOwner = true;
  const inserts: any[] = [];
  const updates: any[] = [];
  const tx: any = {
    execute: jest.fn(async () => []),
    select: () => chain([]),
    insert: (table: any) => ({ values: async (rows: any[]) => {
      expect(table).toBe(fulfillmentAdministrativeReconciliations);
      inserts.push(...rows); allocated += rows.reduce((sum, row) => sum + row.reconciledQuantity, 0);
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: () => ({ returning: async () => {
      expect(table).toBe(productionJobs);
      if (!activeOwner) return [];
      updates.push(values); activeOwner = false; return [{ id: 'fulfillment-owner' }];
    } }) }) }),
  };
  const repository = new FulfillmentDashboardRepo(tx);
  jest.spyOn(repository, 'listLineEligibility').mockImplementation(async () => [{ id: 'line-1', orderId: 'order-1', projection: resolveFulfillmentLineQuantity({
    orderedQuantity: 8, lifecycleStatus: 'complete', requiresProductionJob: true, shippedQuantity: 3, administrativelyReconciledQuantity: allocated,
  }) }]);
  const input = { orderId: 'order-1', reason: 'historical_backlog_cleanup' };
  expect(await repository.reconcileAdministrativeFulfillment('org-1', input, tx)).toMatchObject({ ok: true, remainingQuantity: 0, physicallyFulfilledQuantity: 3, administrativelyReconciledQuantity: 5, completedFulfillmentJobIds: ['fulfillment-owner'] });
  expect(await repository.reconcileAdministrativeFulfillment('org-1', input, tx)).toMatchObject({ ok: true, allocations: [], completedFulfillmentJobIds: [] });
  expect(inserts).toHaveLength(1);
  expect(inserts[0]).toMatchObject({ source: 'close_job_override', reconciledQuantity: 5 });
  expect(updates).toHaveLength(1);
  expect(updates[0].status).toBe('done');
});

test.each(['owner', 'run'])('real administrative ledger blocks active production %s', async conflict => {
  const tx: any = { select: jest.fn()
    .mockReturnValueOnce(chain(conflict === 'owner' ? [{ id: 'active' }] : []))
    .mockReturnValueOnce(chain([{ id: 'run' }])) };
  const repository = new FulfillmentDashboardRepo(tx);
  await expect(repository.assertNoActiveProduction('org-1', 'order-1', tx)).rejects.toMatchObject({ code: conflict === 'owner' ? 'PRODUCTION_NOT_COMPLETE' : 'ACTIVE_COMBINED_RUN_CONFLICT' });
});
