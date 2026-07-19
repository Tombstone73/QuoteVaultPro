import { describe, expect, test } from '@jest/globals';
import type { OrderStatusPill } from '@/hooks/useOrderStatusPills';

import fs from 'node:fs';
import path from 'node:path';
import { buildOrderStatusPillChoices, buildOrderStatusPillsUrl, orderMatchesStatusPillFilter, resolveOrderStatusPillId } from './orderStatusPills';

const pills = [
  { id: 'pill-new', key: 'new', name: 'New', stateScope: 'open', isActive: true, color: '#2563eb' },
  { id: 'pill-proof', key: 'proof_sent', name: 'Proof Sent', stateScope: 'open', isActive: true, color: '#0369a1' },
  { id: 'pill-fulfillment', key: 'fulfillment', name: 'Fulfillment', stateScope: 'production_complete', isActive: true, color: '#0e7490' },
  { id: 'pill-closed', key: 'closed', name: 'Closed', stateScope: 'closed', isActive: true, color: '#334155' },
  { id: 'pill-inactive', key: 'old_status', name: 'Old Status', stateScope: 'open', isActive: false, color: '#64748b' },
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

  test('state-scoped URLs remain available without being used by Orders assignment controls', () => {
    expect(buildOrderStatusPillsUrl('open')).toBe('/api/order-status-pills?state=open');
    expect(buildOrderStatusPillsUrl('canceled')).toBe('/api/order-status-pills?state=canceled');
  });

  test('assignment choices include active pills across lifecycle scopes and exclude inactive pills', () => {
    const choices = buildOrderStatusPillChoices(pills);
    expect(choices.map((pill) => pill.key)).toEqual(['new', 'proof_sent', 'fulfillment', 'closed']);
    expect(choices.every((pill) => pill.assignable)).toBe(true);
  });

  test('an assigned inactive pill remains displayable but cannot be newly assigned', () => {
    const activeCatalog = pills.filter((pill) => pill.isActive);
    const choices = buildOrderStatusPillChoices(activeCatalog, 'pill-inactive', 'Old Status');
    expect(choices.at(-1)).toMatchObject({ id: 'pill-inactive', name: 'Old Status', assignable: false, currentInactive: true });
    const legacyChoices = buildOrderStatusPillChoices(activeCatalog, null, 'Legacy Inactive');
    expect(legacyChoices.at(-1)).toMatchObject({ name: 'Legacy Inactive', assignable: false, currentInactive: true });
  });

  test('Orders row and shared selector use the full catalog while lifecycle tabs remain intact', () => {
    const ordersSource = fs.readFileSync(path.join(process.cwd(), 'client/src/pages/orders.tsx'), 'utf8');
    const selectorSource = fs.readFileSync(path.join(process.cwd(), 'client/src/components/OrderStatusPillSelector.tsx'), 'utf8');
    expect(ordersSource).toContain('<OrderStatusPillSelector');
    expect(ordersSource).not.toContain('function OrderStatusPillCell(');
    expect(selectorSource).toContain('const { data: pills, isLoading } = useOrderStatusPills();');
    expect(ordersSource).toContain('<TabsTrigger value="production_complete">');
    expect(ordersSource).toContain('<TabsTrigger value="closed">');
    expect(ordersSource).toContain('<TabsTrigger value="canceled">');
    expect(ordersSource).toContain('<TabsTrigger value="all">');
  });
});
