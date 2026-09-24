import { expect, test } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { operationalCompletionOrderPatch } from '@shared/orderOperationalStatus';
import { activeOrderDuePredicates } from '../lib/orderDueDate';
import { mapLegacyStatusToCategory } from '../services/orderWorkflowService';
import { validateOrderTransition } from '../services/orderTransition';

test('the persisted operational status projects to completed for dashboard workflow consumers', () => {
  const patch = operationalCompletionOrderPatch({ state: 'production_complete' });
  expect(patch).toMatchObject({ state: 'production_complete', status: 'operationally_complete', canonicalState: 'completed', routingTarget: null });
  expect(mapLegacyStatusToCategory(patch.status!)).toBe('completed');
  expect(operationalCompletionOrderPatch({ state: 'closed' })).toEqual({});
});
test('dashboard actionable due predicates exclude operational completion without consulting payments', () => {
  const query = new PgDialect().sqlToQuery(sql.join(activeOrderDuePredicates('today', '2026-09-24'), sql` AND `));
  expect(query.params).toContain('operationally_complete');
  expect(query.sql).toContain('"orders"."status"');
  expect(query.sql).not.toMatch(/invoice|payment/i);
});
test('generic status changes cannot fabricate operational completion or undo it', () => {
  const context = { order: {} as any, lineItemsCount: 1 };
  expect(validateOrderTransition('ready_for_shipment', 'operationally_complete', context)).toMatchObject({ ok: false, code: 'USE_CANONICAL_OPERATION' });
  expect(validateOrderTransition('operationally_complete', 'ready_for_shipment', context)).toMatchObject({ ok: false, code: 'USE_CANONICAL_OPERATION' });
});
