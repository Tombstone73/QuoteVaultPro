/**
 * TitanOS Order Status Pill Service
 * 
 * Manages org-configurable status pills scoped within canonical states.
 * Pills are display labels that don't affect workflow guardrails.
 */

import { db } from '../db';
import { orderStatusPills, orders, orderAuditLog, orderStatusEvents } from '@shared/schema';
import { eq, and, sql, or } from 'drizzle-orm';
import type { OrderStatusPill, InsertOrderStatusPill } from '@shared/schema';
import type { OrderState } from './orderStateService';

type DbExecutor = any;
export type StatusChangeSource = 'user' | 'system' | 'automation';
export const CANCELED_ORDER_STATUS_PILL_KEY = 'canceled';

export const DEFAULT_ORDER_STATUS_PILLS: ReadonlyArray<Omit<InsertOrderStatusPill, 'organizationId'>> = [
  { key: 'new', stateScope: 'open', name: 'New', color: '#2563EB', category: 'intake', lifecycleMapping: 'intake', customerVisible: false, notificationTriggerEligible: true, isDefault: true, isActive: true, sortOrder: 10 },
  { key: 'needs_review', stateScope: 'open', name: 'Needs Review', color: '#7C3AED', category: 'intake', lifecycleMapping: 'intake', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 20 },
  { key: 'waiting_on_artwork', stateScope: 'open', name: 'Waiting on Artwork', color: '#C2410C', category: 'artwork', lifecycleMapping: 'artwork', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 30 },
  { key: 'design_needed', stateScope: 'open', name: 'Design Needed', color: '#9333EA', category: 'design', lifecycleMapping: 'design', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 40 },
  { key: 'proof_sent', stateScope: 'open', name: 'Proof Sent', color: '#0369A1', category: 'proof', lifecycleMapping: 'proof', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 50 },
  { key: 'waiting_on_approval', stateScope: 'open', name: 'Waiting on Approval', color: '#A16207', category: 'proof', lifecycleMapping: 'proof', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 60 },
  { key: 'approved', stateScope: 'open', name: 'Approved', color: '#047857', category: 'order', lifecycleMapping: 'order', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 70 },
  { key: 'prepress', stateScope: 'open', name: 'Prepress', color: '#0F766E', category: 'prepress', lifecycleMapping: 'prepress', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 80 },
  { key: 'in_production', stateScope: 'open', name: 'In Production', color: '#C2410C', category: 'production', lifecycleMapping: 'production', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 90 },
  { key: 'fulfillment', stateScope: 'production_complete', name: 'Fulfillment', color: '#0E7490', category: 'fulfillment', lifecycleMapping: 'fulfillment', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 100 },
  { key: 'ready_for_pickup', stateScope: 'production_complete', name: 'Ready for Pickup', color: '#0369A1', category: 'fulfillment', lifecycleMapping: 'fulfillment', customerVisible: false, notificationTriggerEligible: true, isDefault: true, isActive: true, sortOrder: 110 },
  { key: 'ready_to_ship', stateScope: 'production_complete', name: 'Ready to Ship', color: '#0F766E', category: 'fulfillment', lifecycleMapping: 'fulfillment', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 120 },
  { key: 'shipped', stateScope: 'production_complete', name: 'Shipped', color: '#475569', category: 'fulfillment', lifecycleMapping: 'fulfillment', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 130 },
  { key: 'picked_up', stateScope: 'production_complete', name: 'Picked Up', color: '#475569', category: 'fulfillment', lifecycleMapping: 'fulfillment', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 140 },
  { key: 'invoiced', stateScope: 'production_complete', name: 'Invoiced', color: '#4338CA', category: 'invoicing', lifecycleMapping: 'invoicing', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 150 },
  { key: 'paid', stateScope: 'production_complete', name: 'Paid', color: '#15803D', category: 'payment', lifecycleMapping: 'payment', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 160 },
  { key: 'complete', stateScope: 'closed', name: 'Complete', color: '#166534', category: 'complete', lifecycleMapping: 'complete', customerVisible: false, notificationTriggerEligible: true, isDefault: true, isActive: true, sortOrder: 170 },
  { key: 'closed', stateScope: 'closed', name: 'Closed', color: '#334155', category: 'closed', lifecycleMapping: 'closed', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 180 },
  { key: 'on_hold', stateScope: 'open', name: 'On Hold', color: '#854D0E', category: 'hold', lifecycleMapping: 'hold', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 190 },
  { key: 'problem', stateScope: 'open', name: 'Problem', color: '#B91C1C', category: 'exception', lifecycleMapping: 'exception', customerVisible: false, notificationTriggerEligible: true, isDefault: false, isActive: true, sortOrder: 200 },
  { key: 'canceled', stateScope: 'canceled', name: 'Canceled', color: '#475569', category: 'canceled', lifecycleMapping: 'canceled', customerVisible: false, notificationTriggerEligible: true, isDefault: true, isActive: true, sortOrder: 210 },
] as const;

export function slugifyStatusPillKey(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key || 'status';
}

type ExistingStatusPillSeedIdentity = Pick<OrderStatusPill, 'key' | 'stateScope' | 'isDefault'>;

export function planDefaultStatusPillSeed(existingPills: ReadonlyArray<ExistingStatusPillSeedIdentity>) {
  const existingKeys = new Set(existingPills.map((pill) => pill.key));
  const scopesWithDefaults = new Set(existingPills.filter((pill) => pill.isDefault).map((pill) => pill.stateScope));

  return DEFAULT_ORDER_STATUS_PILLS
    .filter((pill) => !existingKeys.has(pill.key))
    .map((pill) => {
      if (!pill.isDefault || !scopesWithDefaults.has(pill.stateScope)) {
        if (pill.isDefault) scopesWithDefaults.add(pill.stateScope);
        return pill;
      }
      return { ...pill, isDefault: false };
    });
}

export function buildStatusPillChangeEvent(args: {
  organizationId: string;
  orderId: string;
  previousPill: OrderStatusPill | null;
  previousLabel: string | null;
  targetPill: OrderStatusPill | null;
  actorUserId: string;
  source: StatusChangeSource;
  reason: string | null;
  metadata: Record<string, unknown>;
  stateScope: OrderState;
}) {
  return {
    organizationId: args.organizationId,
    orderId: args.orderId,
    eventType: 'status_pill_changed' as const,
    fromStatusPillId: args.previousPill?.id ?? null,
    toStatusPillId: args.targetPill?.id ?? null,
    fromStatusKey: args.previousPill?.key ?? null,
    toStatusKey: args.targetPill?.key ?? null,
    fromStatusLabel: args.previousPill?.name ?? args.previousLabel,
    toStatusLabel: args.targetPill?.name ?? null,
    changedByUserId: args.actorUserId,
    changedAt: new Date(),
    source: args.source,
    reason: args.reason,
    note: args.reason,
    metadata: {
      ...args.metadata,
      stateScope: args.stateScope,
      notificationTriggerEligible: args.targetPill?.notificationTriggerEligible ?? false,
    },
  };
}

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
  activeOnly = true,
  executor: DbExecutor = db,
): Promise<OrderStatusPill[]> {
  const conditions = [eq(orderStatusPills.organizationId, organizationId)];

  if (stateScope) {
    conditions.push(eq(orderStatusPills.stateScope, stateScope));
  }

  if (activeOnly) {
    conditions.push(eq(orderStatusPills.isActive, true));
  }

  const pills = await executor
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
  data: Omit<InsertOrderStatusPill, 'organizationId' | 'key'> & { key?: string }
): Promise<OrderStatusPill> {
  const baseKey = slugifyStatusPillKey(data.key || data.name);
  const existingKeys = await db
    .select({ key: orderStatusPills.key })
    .from(orderStatusPills)
    .where(eq(orderStatusPills.organizationId, organizationId));
  const usedKeys = new Set(existingKeys.map((row) => row.key));
  let key = baseKey;
  for (let suffix = 2; usedKeys.has(key); suffix += 1) key = `${baseKey}_${suffix}`;

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
      key,
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
  data: Partial<Omit<InsertOrderStatusPill, 'organizationId' | 'key'>>
): Promise<OrderStatusPill> {
  if ('key' in (data as object)) {
    throw new Error('Status pill keys are immutable. Change the label instead.');
  }
  // Load existing pill to verify org ownership
  const [existing] = await db
    .select()
    .from(orderStatusPills)
    .where(and(eq(orderStatusPills.id, pillId), eq(orderStatusPills.organizationId, organizationId)))
    .limit(1);

  if (!existing) {
    throw new Error('Status pill not found');
  }
  if (data.stateScope && data.stateScope !== existing.stateScope) {
    throw new Error('Status pill lifecycle scope cannot be changed after creation.');
  }
  const safeData: Partial<Omit<InsertOrderStatusPill, 'organizationId' | 'key' | 'stateScope'>> = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.color !== undefined ? { color: data.color } : {}),
    ...(data.category !== undefined ? { category: data.category } : {}),
    ...(data.lifecycleMapping !== undefined ? { lifecycleMapping: data.lifecycleMapping } : {}),
    ...(data.customerVisible !== undefined ? { customerVisible: data.customerVisible } : {}),
    ...(data.notificationTriggerEligible !== undefined ? { notificationTriggerEligible: data.notificationTriggerEligible } : {}),
    ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
  };

  return db.transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx
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

    const [updated] = await tx
      .update(orderStatusPills)
      .set({ ...safeData, updatedAt: sql`now()` })
      .where(and(eq(orderStatusPills.id, pillId), eq(orderStatusPills.organizationId, organizationId)))
      .returning();

    if (!updated) throw new Error('Status pill not found');
    if (data.name && data.name !== existing.name) {
      await tx
        .update(orders)
        .set({ statusPillValue: data.name, updatedAt: sql`now()` })
        .where(and(eq(orders.organizationId, organizationId), eq(orders.statusPillId, pillId)));
    }
    return updated;
  });
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
        or(eq(orders.statusPillId, existing.id), eq(orders.statusPillValue, existing.name))
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
  statusPillId?: string | null;
  statusPillKey?: string | null;
  statusPillValue?: string | null;
  actorUserId: string;
  actorUserName?: string;
  source?: StatusChangeSource;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  scheduleProductionJobs?: boolean;
}): Promise<{ eventId: string | null; statusPill: OrderStatusPill | null }> {
  const {
    organizationId, orderId, statusPillId, statusPillKey, statusPillValue, actorUserId, actorUserName,
    source = 'user', reason = null, metadata = {}, scheduleProductionJobs = true,
  } = args;

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
  const [previousPill] = order.statusPillId
    ? await db.select().from(orderStatusPills).where(and(
        eq(orderStatusPills.id, order.statusPillId),
        eq(orderStatusPills.organizationId, organizationId),
      )).limit(1)
    : previousPillValue
      ? await db.select().from(orderStatusPills).where(and(
          eq(orderStatusPills.organizationId, organizationId),
          eq(orderStatusPills.name, previousPillValue),
        )).limit(1)
      : [];

  let targetPill: OrderStatusPill | null = null;
  if (statusPillId || statusPillKey || statusPillValue) {
    const identifier = statusPillId || statusPillKey || statusPillValue || '';
    const [resolved] = await db
      .select()
      .from(orderStatusPills)
      .where(and(
        eq(orderStatusPills.organizationId, organizationId),
        eq(orderStatusPills.stateScope, currentState),
        eq(orderStatusPills.isActive, true),
        statusPillId
          ? eq(orderStatusPills.id, identifier)
          : statusPillKey
            ? eq(orderStatusPills.key, identifier)
            : or(eq(orderStatusPills.key, identifier), eq(orderStatusPills.name, identifier)),
      ))
      .limit(1);
    if (!resolved) {
      throw new Error(`Status pill does not exist for state "${currentState}" in this organization`);
    }
    targetPill = resolved;
  }

  const nextPillValue = targetPill?.name ?? null;
  const shouldScheduleProductionJobs =
    scheduleProductionJobs &&
    currentState === 'open' &&
    targetPill?.key === 'in_production' &&
    previousPill?.key !== 'in_production' &&
    !isInProductionPillValue(previousPillValue);

  const previousIdentity = order.statusPillId ?? previousPill?.id ?? (previousPillValue ? `legacy:${previousPillValue}` : null);
  const sameAssignment = previousIdentity === (targetPill?.id ?? null);
  const change = await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        statusPillId: targetPill?.id ?? null,
        statusPillValue: nextPillValue,
        statusPillAssignedByUserId: actorUserId,
        statusPillAssignedAt: new Date(),
        statusPillReason: reason,
        updatedAt: sql`now()`,
      })
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

    if (sameAssignment) return { eventId: null };

    const [event] = await tx
      .insert(orderStatusEvents)
      .values(buildStatusPillChangeEvent({
        organizationId, orderId, previousPill: previousPill ?? null,
        previousLabel: previousPillValue ?? null, targetPill, actorUserId,
        source, reason, metadata, stateScope: currentState,
      }))
      .returning({ id: orderStatusEvents.id });
    if (!event) throw new Error('Failed to record status pill change event');
    return { eventId: event.id };
  });

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

  // Keep the human-readable audit ledger aligned with the durable event stream.
  if (change.eventId) {
    try {
      await db.insert(orderAuditLog).values({
      orderId,
      userId: actorUserId,
      userName: actorUserName || 'System',
      actionType: 'status_pill_changed',
      fromStatus: previousPillValue || '(none)',
      toStatus: nextPillValue || '(none)',
      note: nextPillValue
        ? `Status pill changed to "${nextPillValue}"`
        : 'Status pill cleared',
      metadata: {
        currentState,
        eventId: change.eventId,
        fromStatusKey: previousPill?.key ?? null,
        toStatusKey: targetPill?.key ?? null,
        source,
        reason,
        productionJobsScheduled: shouldScheduleProductionJobs,
        timestamp: new Date().toISOString(),
      },
      });
    } catch (auditError) {
      console.error('[OrderStatusPillService] Failed to create audit log:', auditError);
      // Don't fail the assignment if audit fails
    }
  }

  return { eventId: change.eventId, statusPill: targetPill };
}

/**
 * Reconcile missing default status-pill keys for a new or existing organization.
 */
export async function seedDefaultPillsForOrg(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<{ created: number; skipped: boolean }> {
  const existing = await listStatusPills(organizationId, undefined, false, executor);
  const defaults = planDefaultStatusPillSeed(existing);
  const inserted = defaults.length === 0
    ? []
    : await executor.insert(orderStatusPills).values(
        defaults.map((pill) => ({
          ...pill,
          organizationId,
        }))
      ).onConflictDoNothing().returning({ id: orderStatusPills.id });

  // Every onboarding/bootstrap/copy path already reconciles pills here. Seed
  // workflow mappings at the same boundary without making runtime fallback rules.
  const { seedDefaultWorkflowStatusPillMappingsForOrg } = await import('./workflowStatusPillService');
  await seedDefaultWorkflowStatusPillMappingsForOrg(organizationId, executor);
  return { created: inserted.length, skipped: inserted.length === 0 };
}
