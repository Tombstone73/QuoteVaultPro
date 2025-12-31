/**
 * TitanOS Order State Service
 * 
 * Manages canonical order states (open, production_complete, closed, canceled)
 * and state transitions with business rule enforcement.
 */

import { db } from '../db';
import { orders, orderLineItems, orderAuditLog } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { Order } from '@shared/schema';

export type OrderState = 'open' | 'production_complete' | 'closed' | 'canceled';

export interface OrgPreferences {
  orders?: {
    requireDueDateForProduction?: boolean;
    requireBillingAddressForProduction?: boolean;
    requireShippingAddressForProduction?: boolean;
    requireLineItemsDoneToComplete?: boolean;
  };
}

export interface StateTransitionContext {
  order: Order;
  lineItemsCount: number;
  orgPreferences?: OrgPreferences;
}

export interface StateTransitionResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * Get allowed next states for a given current state
 */
export function getAllowedNextStates(currentState: OrderState): OrderState[] {
  switch (currentState) {
    case 'open':
      return ['production_complete', 'canceled'];
    case 'production_complete':
      return ['closed', 'canceled'];
    case 'closed':
      return []; // Terminal state (use reopenOrder for special escape)
    case 'canceled':
      return []; // Terminal state
    default:
      return [];
  }
}

/**
 * Check if a state is terminal (cannot transition without special action)
 */
export function isTerminalState(state: OrderState): boolean {
  return state === 'closed' || state === 'canceled';
}

/**
 * Validate if a state transition is allowed
 */
export function validateOrderStateTransition(
  currentState: OrderState,
  nextState: OrderState,
  ctx: StateTransitionContext
): StateTransitionResult {
  // Cannot transition from terminal states (use reopen instead)
  if (isTerminalState(currentState)) {
    return {
      ok: false,
      code: 'TERMINAL_STATE',
      message: `Cannot transition from ${currentState} state. Use the Reopen action if needed.`,
    };
  }

  // Check if transition is in allowed list
  const allowedStates = getAllowedNextStates(currentState);
  if (!allowedStates.includes(nextState)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Cannot transition from ${currentState} to ${nextState}. Allowed: ${allowedStates.join(', ')}`,
    };
  }

  // Cannot transition to same state (no-op)
  if (currentState === nextState) {
    return {
      ok: false,
      code: 'SAME_STATE',
      message: `Order is already in ${nextState} state.`,
    };
  }

  // State-specific validations
  if (nextState === 'production_complete') {
    // Check org preferences for production readiness
    const requireDueDate = ctx.orgPreferences?.orders?.requireDueDateForProduction ?? false;
    const requireBillingAddress = ctx.orgPreferences?.orders?.requireBillingAddressForProduction ?? false;
    const requireShippingAddress = ctx.orgPreferences?.orders?.requireShippingAddressForProduction ?? false;
    const requireLineItemsDone = ctx.orgPreferences?.orders?.requireLineItemsDoneToComplete ?? false;

    if (requireDueDate && !ctx.order.dueDate) {
      return {
        ok: false,
        code: 'NO_DUE_DATE',
        message: 'Cannot complete production: Order must have a due date set.',
      };
    }

    if (requireBillingAddress && !ctx.order.billToAddress1) {
      return {
        ok: false,
        code: 'NO_BILLING_ADDRESS',
        message: 'Cannot complete production: Billing address is required.',
      };
    }

    if (requireShippingAddress && !ctx.order.shipToAddress1 && ctx.order.shippingMethod !== 'pickup') {
      return {
        ok: false,
        code: 'NO_SHIPPING_ADDRESS',
        message: 'Cannot complete production: Shipping address is required for non-pickup orders.',
      };
    }

    // Check if line items are done (if required by org)
    if (requireLineItemsDone && ctx.lineItemsCount > 0) {
      // This will be checked in the route handler with actual line item data
      // Service layer just validates the requirement exists
    }
  }

  if (nextState === 'closed') {
    // Optional: Check if invoice exists (soft validation for now)
    // Future enhancement: enforce invoice requirement via org preference
    // For now, just allow it
  }

  return { ok: true };
}

/**
 * Determine routing target based on shipping method
 */
export function determineRoutingTarget(order: Order): 'fulfillment' | 'invoicing' {
  // Pickup orders go directly to invoicing (no shipping needed)
  if (order.shippingMethod === 'pickup') {
    return 'invoicing';
  }
  // All other orders (ship, deliver) go to fulfillment first
  return 'fulfillment';
}

/**
 * Map state to backward-compatible status for existing code
 */
export function mapStateToLegacyStatus(state: OrderState): string {
  switch (state) {
    case 'open':
      return 'in_production'; // Default for open state
    case 'production_complete':
      return 'ready_for_shipment';
    case 'closed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return 'new';
  }
}

/**
 * Execute state transition with side effects and audit logging
 */
export async function transitionOrderState(args: {
  organizationId: string;
  orderId: string;
  nextState: OrderState;
  actorUserId: string;
  actorUserName?: string;
  notes?: string;
  metadata?: Record<string, any>;
}): Promise<Order> {
  const { organizationId, orderId, nextState, actorUserId, actorUserName, notes, metadata } = args;

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
  const now = new Date().toISOString();

  // Prepare update data
  const updateData: Partial<Order> = {
    state: nextState,
    updatedAt: sql`now()` as any,
  };

  // Set state-specific timestamps and routing
  if (nextState === 'production_complete') {
    updateData.productionCompletedAt = now;
    updateData.routingTarget = determineRoutingTarget(order);
  } else if (nextState === 'closed') {
    updateData.closedAt = now;
  } else if (nextState === 'canceled') {
    updateData.canceledAt = now;
    if (notes) {
      updateData.cancellationReason = notes;
    }
  }

  // Update backward-compatible status field
  updateData.status = mapStateToLegacyStatus(nextState) as any;

  // Execute update in transaction
  const [updatedOrder] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();

  // Create audit log entry
  try {
    await db.insert(orderAuditLog).values({
      orderId,
      userId: actorUserId,
      userName: actorUserName || 'System',
      actionType: 'state_transition',
      fromStatus: currentState,
      toStatus: nextState,
      note: notes || `State changed from ${currentState} to ${nextState}`,
      metadata: {
        ...metadata,
        routingTarget: updateData.routingTarget,
        timestamp: now,
      },
    });
  } catch (auditError) {
    console.error('[OrderStateService] Failed to create audit log:', auditError);
    // Don't fail the transition if audit fails
  }

  return updatedOrder;
}

/**
 * Reopen a closed order (special escape from terminal state)
 * 
 * IMPORTANT: Does NOT void invoices, does NOT change payments, does NOT erase logs.
 * Reason is REQUIRED for audit trail.
 */
export async function reopenOrder(args: {
  organizationId: string;
  orderId: string;
  actorUserId: string;
  actorUserName?: string;
  reason: string; // REQUIRED
  targetState?: OrderState; // Optional, defaults to 'production_complete'
}): Promise<Order> {
  const { organizationId, orderId, actorUserId, actorUserName, reason, targetState = 'production_complete' } = args;

  if (!reason || reason.trim().length === 0) {
    throw new Error('Reason is required to reopen an order');
  }

  // Load order with org scope
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!order) {
    throw new Error('Order not found');
  }

  // Must be in closed state to reopen
  if (order.state !== 'closed') {
    throw new Error(`Cannot reopen order: current state is ${order.state}, must be closed`);
  }

  // Validate target state
  if (targetState !== 'open' && targetState !== 'production_complete') {
    throw new Error('Target state must be either "open" or "production_complete"');
  }

  const now = new Date().toISOString();

  // Prepare update data
  const updateData: Partial<Order> = {
    state: targetState,
    updatedAt: sql`now()` as any,
    status: mapStateToLegacyStatus(targetState) as any,
  };

  // Note: reopened_at, reopen_count columns don't exist yet (Phase 3)
  // Store reopen metadata in audit log only for now

  // Execute update
  const [updatedOrder] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();

  // Create audit log entry with reopen context
  try {
    await db.insert(orderAuditLog).values({
      orderId,
      userId: actorUserId,
      userName: actorUserName || 'System',
      actionType: 'order_reopened',
      fromStatus: 'closed',
      toStatus: targetState,
      note: `Order reopened: ${reason}`,
      metadata: {
        reason,
        targetState,
        reopenedAt: now,
        previousClosedAt: order.closedAt,
      },
    });
  } catch (auditError) {
    console.error('[OrderStateService] Failed to create reopen audit log:', auditError);
    // Don't fail the reopen if audit fails
  }

  return updatedOrder;
}
