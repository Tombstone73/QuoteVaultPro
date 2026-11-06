import { isCanonicalOpenOrder, isManualOrderComplete, orderWorkQueueState } from '../openOrderBadgePolicy';
import { expect, test } from '@jest/globals';

test('Open operational queue excludes the current manual Complete selection', () => {
  for (const statusPillValue of ['New', 'Needs Review', 'Waiting on Artwork', 'Design Needed', 'Proof Sent', 'Approved', 'Prepress', 'In Production', 'Fulfillment', 'On Hold', 'Ready to Ship', 'Shipped', 'Invoiced', 'Picked Up', 'Paid']) {
    expect(isCanonicalOpenOrder({ state: 'open', statusPillValue })).toBe(true);
  }
  expect(isCanonicalOpenOrder({ state: 'open', statusPillKey: 'complete' })).toBe(false);
  expect(isCanonicalOpenOrder({ state: 'open', statusPillValue: 'Complete' })).toBe(false);
});

test('current stable identity wins over stale copied text and legacy Complete is supported', () => {
  expect(isManualOrderComplete({statusPillKey:'in_production',statusPillValue:'Complete'})).toBe(false);
  expect(isManualOrderComplete({statusPillKey:'complete',statusPillValue:'Shop finished'})).toBe(true);
  expect(isManualOrderComplete({statusPillValue:' COMPLETE '})).toBe(true);
  expect(orderWorkQueueState({state:'open',statusPillKey:'complete'})).toBe('production_complete');
});

test.each(['open','production_complete','closed','canceled'])('every supported lifecycle has one operational view: %s', state=>{
  const result=orderWorkQueueState({state,statusPillKey:'complete'});
  expect(result).toBe(state==='open'?'production_complete':state);
});

test.each(['production_complete', 'closed', 'canceled'])('excludes %s lifecycle buckets', (state) => {
  expect(isCanonicalOpenOrder({ state, statusPillValue: 'New' })).toBe(false);
});
