import { isOpenOrderBadgeStatus, OPEN_ORDER_BADGE_STATUSES } from '../openOrderBadgePolicy';

test('V1 Orders badge includes only canonical new and in-production status', () => {
  expect(OPEN_ORDER_BADGE_STATUSES).toEqual(['new', 'in_production']);
  for (const status of ['new', 'in_production']) expect(isOpenOrderBadgeStatus(status)).toBe(true);
  for (const status of [
    'operationally_complete', 'production_complete', 'ready_for_shipment',
    'invoiced', 'completed', 'closed', 'canceled', 'archived', 'on_hold',
  ]) expect(isOpenOrderBadgeStatus(status)).toBe(false);
  expect(isOpenOrderBadgeStatus(null)).toBe(false);
});

test('transitions change the projected count only when leaving or entering the included set', () => {
  const count = (statuses: string[]) => statuses.filter(isOpenOrderBadgeStatus).length;
  expect(count(['new', 'in_production'])).toBe(2);
  expect(count(['in_production', 'in_production'])).toBe(2);
  expect(count(['operationally_complete', 'in_production'])).toBe(1);
  expect(count(['canceled', 'in_production'])).toBe(1);
  expect(count(['new', 'operationally_complete'])).toBe(1);
  expect(count(['new', 'in_production'])).toBe(2);
});
