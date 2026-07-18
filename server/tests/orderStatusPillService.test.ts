import { describe, expect, test } from '@jest/globals';
import type { OrderStatusPill } from '@shared/schema';

import {
  DEFAULT_ORDER_STATUS_PILLS,
  buildStatusPillChangeEvent,
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
    const planned = planDefaultStatusPillSeed(0);
    expect(planned.map((status) => status.name)).toEqual([
      'New', 'Needs Review', 'Waiting on Artwork', 'Design Needed', 'Proof Sent',
      'Waiting on Approval', 'Approved', 'Prepress', 'In Production', 'On Hold',
      'Problem', 'Ready for Pickup', 'Ready to Ship', 'Shipped', 'Picked Up',
      'Complete', 'Canceled',
    ]);
  });

  test('seeding is idempotent and does not overwrite a tenant with any existing pill', () => {
    expect(planDefaultStatusPillSeed(DEFAULT_ORDER_STATUS_PILLS.length)).toEqual([]);
    expect(planDefaultStatusPillSeed(1)).toEqual([]);
  });

  test('stable keys are unique and independent from editable labels', () => {
    const keys = DEFAULT_ORDER_STATUS_PILLS.map((status) => status.key);
    expect(new Set(keys).size).toBe(keys.length);
    const renamed = { ...DEFAULT_ORDER_STATUS_PILLS[1], name: 'Review Required' };
    expect(renamed.key).toBe('needs_review');
    expect(slugifyStatusPillKey('Waiting on Customer / PO')).toBe('waiting_on_customer_po');
  });

  test('proof and production pills remain operational signals within the open lifecycle', () => {
    expect(DEFAULT_ORDER_STATUS_PILLS.find((status) => status.key === 'proof_sent')).toMatchObject({ stateScope: 'open', category: 'proofing' });
    expect(DEFAULT_ORDER_STATUS_PILLS.find((status) => status.key === 'in_production')).toMatchObject({ stateScope: 'open', category: 'production' });
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
});
