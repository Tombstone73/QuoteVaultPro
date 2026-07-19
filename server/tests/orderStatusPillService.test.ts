import { describe, expect, test } from '@jest/globals';
import type { OrderStatusPill } from '@shared/schema';

import {
  DEFAULT_ORDER_STATUS_PILLS,
  CANCELED_ORDER_STATUS_PILL_KEY,
  buildStatusPillChangeEvent,
  buildStatusPillUpdateData,
  planDefaultStatusPillSeed,
  slugifyStatusPillKey,
} from '../services/orderStatusPillService';

function pill(overrides: Partial<OrderStatusPill>): OrderStatusPill {
  return {
    id: 'pill-1', organizationId: 'org-1', key: 'needs_review', name: 'Needs Review',
    stateScope: 'open', color: '#7C3AED', category: 'intake', lifecycleMapping: 'open',
    customerVisible: false, notificationTriggerEligible: true, isDefault: false,
    isActive: true, sortOrder: 20, createdAt: '2026-07-17', updatedAt: '2026-07-17',
    ...overrides,
  };
}

describe('default operational order status pills', () => {
  test('an empty tenant receives the complete default set', () => {
    const planned = planDefaultStatusPillSeed([]);
    expect(planned.map((status) => status.name)).toEqual([
      'New', 'Needs Review', 'Waiting on Artwork', 'Design Needed', 'Proof Sent',
      'Waiting on Approval', 'Approved', 'Prepress', 'In Production', 'Fulfillment',
      'Ready for Pickup', 'Ready to Ship', 'Shipped', 'Picked Up', 'Invoiced',
      'Paid', 'Complete', 'Closed', 'On Hold', 'Problem', 'Canceled',
    ]);
    expect(planned).toHaveLength(21);
  });

  test('seeding is idempotent when every stable default key already exists', () => {
    const existing = DEFAULT_ORDER_STATUS_PILLS.map((status, index) => pill({
      id: `pill-${index}`,
      key: status.key,
      stateScope: status.stateScope,
      isDefault: status.isDefault,
    }));
    expect(planDefaultStatusPillSeed(existing)).toEqual([]);
  });

  test('an incomplete tenant receives only missing stable default keys', () => {
    const incompleteKeys = new Set([
      'new', 'needs_review', 'waiting_on_artwork', 'design_needed', 'proof_sent',
      'waiting_on_approval', 'approved', 'prepress', 'in_production', 'on_hold', 'problem',
    ]);
    const incomplete = DEFAULT_ORDER_STATUS_PILLS.filter((status) => incompleteKeys.has(status.key)).map((status, index) => pill({
      id: `pill-${index}`,
      key: status.key,
      stateScope: status.stateScope,
      isDefault: status.isDefault,
    }));
    expect(planDefaultStatusPillSeed(incomplete).map((status) => status.key)).toEqual([
      'fulfillment', 'ready_for_pickup', 'ready_to_ship', 'shipped', 'picked_up',
      'invoiced', 'paid', 'complete', 'closed', 'canceled',
    ]);
  });

  test('custom pills are preserved and do not prevent missing defaults from being planned', () => {
    const custom = pill({ key: 'waiting_on_vendor', name: 'Waiting on Vendor', isDefault: true });
    const planned = planDefaultStatusPillSeed([custom]);
    expect(planned).toHaveLength(21);
    expect(planned.some((status) => status.key === 'waiting_on_vendor')).toBe(false);
    expect(planned.find((status) => status.key === 'new')?.isDefault).toBe(false);
  });

  test('edited and inactive records retain their stable keys and are not recreated', () => {
    const edited = pill({ key: 'needs_review', name: 'Review Required' });
    const inactive = pill({ id: 'pill-inactive', key: 'ready_to_ship', name: 'Do Not Restore', isActive: false });
    const planned = planDefaultStatusPillSeed([edited, inactive]);
    expect(planned.some((status) => status.key === 'needs_review')).toBe(false);
    expect(planned.some((status) => status.key === 'ready_to_ship')).toBe(false);
  });

  test('stable keys are unique and independent from editable labels', () => {
    const keys = DEFAULT_ORDER_STATUS_PILLS.map((status) => status.key);
    expect(new Set(keys).size).toBe(keys.length);
    const renamed = { ...DEFAULT_ORDER_STATUS_PILLS[1], name: 'Review Required' };
    expect(renamed.key).toBe('needs_review');
    expect(slugifyStatusPillKey('Waiting on Customer / PO')).toBe('waiting_on_customer_po');
  });

  test('settings updates preserve stable keys while accepting label, color, and visibility fields', () => {
    const update = buildStatusPillUpdateData({
      name: 'Production Floor', color: '#123456', category: 'shop',
      lifecycleMapping: 'production', customerVisible: true,
      notificationTriggerEligible: false, isActive: false, sortOrder: 95,
    });
    expect(update).toMatchObject({
      name: 'Production Floor', color: '#123456', category: 'shop',
      lifecycleMapping: 'production', customerVisible: true,
      notificationTriggerEligible: false, isActive: false, sortOrder: 95,
    });
    expect(update).not.toHaveProperty('key');
    expect(update).not.toHaveProperty('stateScope');
  });

  test('proof and production pills remain operational signals within the open lifecycle', () => {
    expect(DEFAULT_ORDER_STATUS_PILLS.find((status) => status.key === 'proof_sent')).toMatchObject({ stateScope: 'open', lifecycleMapping: 'proof' });
    expect(DEFAULT_ORDER_STATUS_PILLS.find((status) => status.key === 'in_production')).toMatchObject({ stateScope: 'open', lifecycleMapping: 'production' });
    expect(CANCELED_ORDER_STATUS_PILL_KEY).toBe('canceled');
    expect(DEFAULT_ORDER_STATUS_PILLS.find((status) => status.key === CANCELED_ORDER_STATUS_PILL_KEY)).toMatchObject({ stateScope: 'canceled', lifecycleMapping: 'canceled' });
  });
});

describe('status pill change event contract', () => {
  test('records stable keys, actor, source, and notification eligibility', () => {
    const event = buildStatusPillChangeEvent({
      organizationId: 'org-1', orderId: 'order-1',
      previousPill: pill({ id: 'pill-from', key: 'needs_review', name: 'Needs Review' }),
      previousLabel: 'Needs Review',
      targetPill: pill({ id: 'pill-to', key: 'proof_sent', name: 'Proof Emailed', category: 'proofing' }),
      actorUserId: 'user-1', source: 'user', reason: 'Proof delivered',
      metadata: { channel: 'orders_list' }, stateScope: 'open',
    });

    expect(event).toMatchObject({
      eventType: 'status_pill_changed', fromStatusPillId: 'pill-from', toStatusPillId: 'pill-to',
      fromStatusKey: 'needs_review', toStatusKey: 'proof_sent', toStatusLabel: 'Proof Emailed',
      changedByUserId: 'user-1', source: 'user', reason: 'Proof delivered',
      metadata: { channel: 'orders_list', stateScope: 'open', notificationTriggerEligible: true },
    });
  });

  test.each(['system', 'automation'] as const)('preserves %s source for future notification rules', (source) => {
    const event = buildStatusPillChangeEvent({
      organizationId: 'org-1', orderId: 'order-1', previousPill: null, previousLabel: null,
      targetPill: pill({ id: 'pill-to', key: 'in_production', name: 'Production Floor' }),
      actorUserId: 'user-1', source, reason: 'Workflow transition',
      metadata: { workflowTriggerKey: 'sent_to_production' }, stateScope: 'open',
    });
    expect(event.source).toBe(source);
    expect(event.metadata).toMatchObject({
      workflowTriggerKey: 'sent_to_production',
      notificationTriggerEligible: true,
    });
  });
});
