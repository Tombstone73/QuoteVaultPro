import { remainingFulfillmentSelection } from './bulkFulfillmentSelection';
import type { BulkFulfillmentPreview, BulkFulfillmentResult } from '@shared/bulkFulfillment';
const unit = (key: string, orderId: string, lines: string[], eligible = true) => ({ key, orderIds: [orderId], orderNumber: orderId, eligible, requirements: [],
  items: lines.map(orderLineItemId => ({ orderId, orderLineItemId, label: orderLineItemId, quantity: 2, eligible, requirements: [] })) });
const preview = (units: ReturnType<typeof unit>[]): BulkFulfillmentPreview => ({ units, action: 'picked_up', eligibleCount: 1, skippedCount: 1, selectedOrderCount: 2, previewToken: 'token' });
const result = (rows: Array<{ key: string; orderId: string; lines: string[]; status: 'succeeded' | 'failed' | 'skipped' }>): BulkFulfillmentResult => ({ requestId: 'request', results: rows.map(row => ({ ...row, orderIds: [row.orderId], message: row.status, items: row.lines.map(orderLineItemId => ({ orderId: row.orderId, orderLineItemId })) })) });
test('only confirmed successes clear; another page/filter selection and failed lines remain', () => {
  const plan = preview([unit('a', 'one', ['a', 'b']), unit('c', 'two', ['c'], false)]);
  plan.units[0].items[1].eligible = false;
  const saved = result([{ key: 'a', orderId: 'one', lines: ['a'], status: 'succeeded' }, { key: 'c', orderId: 'two', lines: [], status: 'skipped' }]);
  expect(remainingFulfillmentSelection([{ orderId: 'one' }, { orderId: 'two' }, { orderId: 'another-filter' }], plan, saved)).toEqual([
    { orderId: 'one', items: [{ orderLineItemId: 'b' }] }, { orderId: 'two' }, { orderId: 'another-filter' }]);
});
test('a line shared by successful and failed shipment operations stays selected', () => {
  const plan = preview([unit('ship-1', 'one', ['a']), unit('ship-2', 'one', ['a'])]);
  const selected = [{ orderId: 'one', items: [{ orderLineItemId: 'a', quantity: 4 }] }];
  expect(remainingFulfillmentSelection(selected, plan, result([{ key: 'ship-1', orderId: 'one', lines: ['a'], status: 'succeeded' }, { key: 'ship-2', orderId: 'one', lines: ['a'], status: 'failed' }]))).toEqual(selected);
});
test('whole-order and explicit-quantity selections clear after all their operations succeed', () => {
  const plan = preview([unit('one', 'one', ['a']), unit('two', 'two', ['b'])]);
  expect(remainingFulfillmentSelection([{ orderId: 'one' }, { orderId: 'two', items: [{ orderLineItemId: 'b', quantity: 2 }] }], plan,
    result([{ key: 'one', orderId: 'one', lines: ['a'], status: 'succeeded' }, { key: 'two', orderId: 'two', lines: ['b'], status: 'succeeded' }]))).toEqual([]);
});
