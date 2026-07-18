import crypto from 'node:crypto';
import { afterEach, describe, expect, test } from '@jest/globals';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { orderStatusPills, organizations } from '@shared/schema';
import { DEFAULT_ORDER_STATUS_PILLS, seedDefaultPillsForOrg } from '../services/orderStatusPillService';

const organizationIds: string[] = [];

async function createOrganization() {
  const suffix = crypto.randomUUID();
  const [organization] = await db.insert(organizations).values({
    name: `Status Seed ${suffix}`,
    slug: `status-seed-${suffix}`,
    type: 'external_saas',
    status: 'active',
  }).returning({ id: organizations.id });
  organizationIds.push(organization.id);
  return organization.id;
}

afterEach(async () => {
  for (const organizationId of organizationIds.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});

describe('status-pill default reconciliation', () => {
  test('a tenant with zero pills receives all 21 defaults exactly once', async () => {
    const organizationId = await createOrganization();

    await expect(seedDefaultPillsForOrg(organizationId)).resolves.toEqual({ created: 21, skipped: false });
    await expect(seedDefaultPillsForOrg(organizationId)).resolves.toEqual({ created: 0, skipped: true });

    const rows = await db.select().from(orderStatusPills)
      .where(eq(orderStatusPills.organizationId, organizationId));
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map((row) => row.key)).size).toBe(21);
  });

  test('an incomplete tenant keeps custom, edited, and inactive pills while receiving missing keys', async () => {
    const organizationId = await createOrganization();
    const needsReview = DEFAULT_ORDER_STATUS_PILLS.find((pill) => pill.key === 'needs_review')!;
    const readyToShip = DEFAULT_ORDER_STATUS_PILLS.find((pill) => pill.key === 'ready_to_ship')!;
    await db.insert(orderStatusPills).values([
      { ...needsReview, organizationId, name: 'Review Required', color: '#111827' },
      { ...readyToShip, organizationId, name: 'Disabled Shipping Signal', isActive: false },
      {
        organizationId,
        key: 'waiting_on_vendor',
        name: 'Waiting on Vendor',
        stateScope: 'open',
        color: '#6B7280',
        category: 'custom',
        lifecycleMapping: 'exception',
        customerVisible: false,
        notificationTriggerEligible: true,
        isDefault: false,
        isActive: true,
        sortOrder: 500,
      },
    ]);

    await expect(seedDefaultPillsForOrg(organizationId)).resolves.toEqual({ created: 19, skipped: false });
    const rows = await db.select().from(orderStatusPills)
      .where(eq(orderStatusPills.organizationId, organizationId));

    expect(rows).toHaveLength(22);
    expect(rows.find((row) => row.key === 'needs_review')).toMatchObject({ name: 'Review Required', color: '#111827' });
    expect(rows.find((row) => row.key === 'ready_to_ship')).toMatchObject({ name: 'Disabled Shipping Signal', isActive: false });
    expect(rows.find((row) => row.key === 'waiting_on_vendor')?.name).toBe('Waiting on Vendor');
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});
