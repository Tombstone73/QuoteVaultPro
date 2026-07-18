import { describe, expect, test } from '@jest/globals';
import type { OrderStatusPill } from '@/hooks/useOrderStatusPills';

import { buildOrderStatusPillsUrl, orderMatchesStatusPillFilter, resolveOrderStatusPillId } from './orderStatusPills';

const pills = [
  { id: 'pill-new', key: 'new', name: 'New' },
  { id: 'pill-proof', key: 'proof_sent', name: 'Proof Sent' },
] as OrderStatusPill[];

describe('order status pill list and filter resolution', () => {
  test('uses the stable assignment id when present', () => {
    expect(resolveOrderStatusPillId('pill-proof', 'Old label snapshot', pills)).toBe('pill-proof');
  });

  test('supports pre-migration orders by resolving their label snapshot', () => {
    expect(resolveOrderStatusPillId(null, 'Proof Sent', pills)).toBe('pill-proof');
  });

  test('status filtering uses stable pill ids and retains the all option', () => {
    expect(orderMatchesStatusPillFilter({ statusPillId: 'pill-new' }, 'pill-new', pills)).toBe(true);
    expect(orderMatchesStatusPillFilter({ statusPillValue: 'Proof Sent' }, 'pill-proof', pills)).toBe(true);
    expect(orderMatchesStatusPillFilter({ statusPillId: 'pill-new' }, 'all', pills)).toBe(true);
  });

  test('the Orders filter requests the full tenant status catalog', () => {
    expect(buildOrderStatusPillsUrl()).toBe('/api/order-status-pills');
  });

  test('order assignment selectors retain canonical state-scoped catalogs', () => {
    expect(buildOrderStatusPillsUrl('open')).toBe('/api/order-status-pills?state=open');
    expect(buildOrderStatusPillsUrl('canceled')).toBe('/api/order-status-pills?state=canceled');
  });
});
