/**
 * TitanOS Order Status Pill Service
 * 
 * Manages org-configurable status pills scoped within canonical states.
 * Pills are display labels that don't affect workflow guardrails.
 */

import { db } from '../db';
import { orderStatusPills, orders, orderAuditLog } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { OrderStatusPill, InsertOrderStatusPill } from '@shared/schema';
import type { OrderState } from './orderStateService';

function normalizePillValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isInProductionPillValue(value: string | null | undefined) {
  if (!value) return false;
  return normalizePillValue(value) === 'in production';
}

/**
 * List status pills for an organization and state scope
 */
export async function listStatusPills(
  organizationId: string,
  stateScope?: OrderState,
  activeOnly = true
): Promise<OrderStatusPill[]> {
  const conditions = [eq(orderStatusPills.organizationId, organizationId)];

  if (stateScope) {
    conditions.push(eq(orderStatusPills.stateScope, stateScope));
  }

  if (activeOnly) {
    conditions.push(eq(orderStatusPills.isActive, true));
  }

  const pills = await db
    .select()
    .from(orderStatusPills)
    .where(and(...conditions))
    .orderBy(orderStatusPills.sortOrder, orderStatusPills.name);

  return pills;
}

/**
 * Get default pill for a state scope
 */
export async function getDefaultPill(
  organizationId: string,
  stateScope: OrderState
): Promise<OrderStatusPill | null> {
  const [pill] = await db
    .select()
    .from(orderStatusPills)
    .where(
      and(
        eq(orderStatusPills.organizationId, organizationId),
        eq(orderStatusPills.stateScope, stateScope),
        eq(orderStatusPills.isDefault, true),
        eq(orderStatusPills.isActive, true)
      )
    )
    .limit(1);

  return pill || null;
}

/**
 * Create a new status pill
 */
export async function createStatusPill(
  organizationId: string,
  data: Omit<InsertOrderStatusPill, 'organizationId'>
): Promise<OrderStatusPill> {
  // If this pill is marked as default, unset other defaults in the same state scope
  if (data.isDefault) {
    await db
      .update(orderStatusPills)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(orderStatusPills.organizationId, organizationId),
          eq(orderStatusPills.stateScope, data.stateScope),
          eq(orderStatusPills.isDefault, true)
        )
      );
  }

  // Create the new pill
  const [pill] = await db
    .insert(orderStatusPills)
    .values({
      ...data,
      organizationId,
    })
    .returning();

  return pill;
}

/**
 * Update an existing status pill
 */
export async function updateStatusPill(
  organizationId: string,
  pillId: string,
  data: Partial<Omit<InsertOrderStatusPill, 'organizationId'>>
): Promise<OrderStatusPill> {
  // Load existing pill to verify org ownership
  const [existing] = await db
    .select()
    .from(orderStatusPills)
    .where(and(eq(orderStatusPills.id, pillId), eq(orderStatusPills.organizationId, organizationId)))
    .limit(1);

  if (!existing) {
    throw new Error('Status pill not found');
  }

  // If setting this as default, unset other defaults in the same state scope
  if (data.isDefault === true) {
    await db
      .update(orderStatusPills)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(orderStatusPills.organizationId, organizationId),
          eq(orderStatusPills.stateScope, existing.stateScope),
          eq(orderStatusPills.isDefault, true)
        )
      );
  }

  // Update the pill
  const [updated] = await db
    .update(orderStatusPills)
    .set({
      ...data,
      updatedAt: sql`now()`,
    })
    .where(eq(orderStatusPills.id, pillId))
    .returning();

  return updated;
}

/**
 * Soft delete (deactivate) a status pill
 */
export async function deleteStatusPill(organizationId: string, pillId: string): Promise<void> {
  // Load existing pill to verify org ownership
  const [existing] = await db
    .select()
    .from(orderStatusPills)
    .where(and(eq(orderStatusPills.id, pillId), eq(orderStatusPills.organizationId, organizationId)))
    .limit(1);

  if (!existing) {
    throw new Error('Status pill not found');
  }

  // Cannot delete the default pill
  if (existing.isDefault) {
    throw new Error('Cannot delete the default status pill. Promote another pill to default first.');
  }

  // Check if any orders are using this pill
  const [ordersUsingPill] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.statusPillValue, existing.name)
      )
    );

  if (ordersUsingPill && ordersUsingPill.count > 0) {
    throw new Error(`Cannot delete status pill: ${ordersUsingPill.count} order(s) are currently using it.`);
  }

  // Soft delete by setting is_active = false
  await db
    .update(orderStatusPills)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(eq(orderStatusPills.id, pillId));
}

/**
 * Set a pill as the default for its state scope
 */
export async function setDefaultPill(organizationId: string, pillId: string): Promise<OrderStatusPill> {
  // Load existing pill to verify org ownership and get state scope
  const [existing] = await db
    .select()
    .from(orderStatusPills)
    .where(and(eq(orderStatusPills.id, pillId), eq(orderStatusPills.organizationId, organizationId)))
    .limit(1);

  if (!existing) {
    throw new Error('Status pill not found');
  }

  // Unset other defaults in the same state scope
  await db
    .update(orderStatusPills)
    .set({ isDefault: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(orderStatusPills.organizationId, organizationId),
        eq(orderStatusPills.stateScope, existing.stateScope),
        eq(orderStatusPills.isDefault, true)
      )
    );

  // Set this pill as default
  const [updated] = await db
    .update(orderStatusPills)
    .set({ isDefault: true, updatedAt: sql`now()` })
    .where(eq(orderStatusPills.id, pillId))
    .returning();

  return updated;
}

/**
 * Ensure at least one default pill exists for a state scope
 * If no default exists and pills are available, promote the first one
 */
export async function ensureDefaultPill(organizationId: string, stateScope: OrderState): Promise<void> {
  const pills = await listStatusPills(organizationId, stateScope, true);

  if (pills.length === 0) {
    // No pills exist for this state scope - nothing to do
    return;
  }

  const hasDefault = pills.some(p => p.isDefault);

  if (!hasDefault) {
    // Promote first pill to default
    await db
      .update(orderStatusPills)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(eq(orderStatusPills.id, pills[0].id));
  }
}

/**
 * Assign a status pill to an order (must match current state scope)
 */
export async function assignOrderStatusPill(args: {
  organizationId: string;
  orderId: string;
  statusPillValue: string | null;
  actorUserId: string;
  actorUserName?: string;
}): Promise<void> {
  const { organizationId, orderId, statusPillValue, actorUserId, actorUserName } = args;

  // Load order with org scope
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!order) {
    throw new Error('Order not found');
  }

  const currentState = order.state as OrderState;
  const previousPillValue = order.statusPillValue;
  const shouldScheduleProductionJobs =
    currentState === 'open' &&
    isInProductionPillValue(statusPillValue) &&
    !isInProductionPillValue(previousPillValue);

  // If setting a pill (not clearing), validate it exists and matches state scope
  if (statusPillValue) {
    const pills = await listStatusPills(organizationId, currentState, true);
    const pillExists = pills.some(p => p.name === statusPillValue);

    if (!pillExists) {
      throw new Error(`Status pill "${statusPillValue}" does not exist for state "${currentState}" in this organization`);
    }
  }

  // Update order
  await db
    .update(orders)
    .set({
      statusPillValue,
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, orderId));

  if (shouldScheduleProductionJobs) {
    const [{ scheduleOrderLineItemsForProduction }, { loadProductionLineItemStatusRulesForOrganization, appendEvent }] =
      await Promise.all([
        import('./productionScheduling'),
        import('../productionHelpers'),
      ]);

    await scheduleOrderLineItemsForProduction({
      organizationId,
      orderId,
      loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
      appendEvent,
    });
  }

  // Create audit log entry
  try {
    await db.insert(orderAuditLog).values({
      orderId,
      userId: actorUserId,
      userName: actorUserName || 'System',
      actionType: 'status_pill_changed',
      fromStatus: previousPillValue || '(none)',
      toStatus: statusPillValue || '(none)',
      note: statusPillValue
        ? `Status pill changed to "${statusPillValue}"`
        : 'Status pill cleared',
      metadata: {
        currentState,
        productionJobsScheduled: shouldScheduleProductionJobs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (auditError) {
    console.error('[OrderStatusPillService] Failed to create audit log:', auditError);
    // Don't fail the assignment if audit fails
  }
}

/**
 * Seed default status pills for a new organization
 */
export async function seedDefaultPillsForOrg(organizationId: string): Promise<void> {
  // Check if pills already exist
  const existing = await listStatusPills(organizationId, undefined, false);
  if (existing.length > 0) {
    console.log(`[OrderStatusPillService] Pills already exist for org ${organizationId}, skipping seed`);
    return;
  }

  // Seed default pills for each state scope
  const defaultPills: Omit<InsertOrderStatusPill, 'organizationId'>[] = [
    // Open state pills
    { stateScope: 'open', name: 'New', color: '#3b82f6', isDefault: true, isActive: true, sortOrder: 0 },
    { stateScope: 'open', name: 'In Production', color: '#f97316', isDefault: false, isActive: true, sortOrder: 1 },
    { stateScope: 'open', name: 'On Hold', color: '#eab308', isDefault: false, isActive: true, sortOrder: 2 },
    // Production complete state pills
    { stateScope: 'production_complete', name: 'Ready', color: '#8b5cf6', isDefault: true, isActive: true, sortOrder: 0 },
    // Closed state pills
    { stateScope: 'closed', name: 'Completed', color: '#22c55e', isDefault: true, isActive: true, sortOrder: 0 },
    // Canceled state pills
    { stateScope: 'canceled', name: 'Canceled', color: '#64748b', isDefault: true, isActive: true, sortOrder: 0 },
  ];

  // Insert all default pills (safe: array has items)
  await db.insert(orderStatusPills).values(
    defaultPills.map(pill => ({
      ...pill,
      organizationId,
    }))
  );

  console.log(`[OrderStatusPillService] Seeded ${defaultPills.length} default pills for org ${organizationId}`);
}
