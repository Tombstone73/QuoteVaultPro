/**
 * Order State Transition Service
 * 
 * Enforces business rules for order status changes.
 * Single source of truth for valid transitions and side effects.
 */

import type { Order, InsertOrder } from '@shared/schema';

export type OrderStatus = 'new' | 'in_production' | 'on_hold' | 'ready_for_shipment' | 'completed' | 'canceled';

export interface TransitionContext {
  order: Order;
  lineItemsCount: number;
  attachmentsCount?: number;
  fulfillmentStatus?: string;
  jobsCount?: number;
  hasShippedAt?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  code?: string;
  message?: string;
  warnings?: string[];
}

/**
 * Validates if a status transition is allowed based on business rules.
 */
export function validateOrderTransition(
  fromStatus: string,
  toStatus: string,
  ctx: TransitionContext
): TransitionResult {
  // Normalize status values
  const from = fromStatus as OrderStatus;
  const to = toStatus as OrderStatus;

  // Terminal states cannot transition
  if (from === 'completed') {
    return {
      ok: false,
      code: 'COMPLETED_TERMINAL',
      message: 'Completed orders cannot be changed. Contact an administrator if this order needs to be modified.',
    };
  }

  if (from === 'canceled') {
    return {
      ok: false,
      code: 'CANCELED_TERMINAL',
      message: 'Canceled orders cannot be changed. Create a new order if needed.',
    };
  }

  // Cannot transition to same status (no-op)
  if (from === to) {
    return {
      ok: false,
      code: 'SAME_STATUS',
      message: `Order is already in ${to} status.`,
    };
  }

  const warnings: string[] = [];

  // Validate specific transitions
  switch (from) {
    case 'new':
      if (to === 'in_production') {
        // Critical validation: Must have line items
        if (ctx.lineItemsCount === 0) {
          return {
            ok: false,
            code: 'NO_LINE_ITEMS',
            message: 'Cannot start production: Order must have at least one line item.',
          };
        }

        // Critical validation: Must have due date
        if (!ctx.order.dueDate) {
          return {
            ok: false,
            code: 'NO_DUE_DATE',
            message: 'Cannot start production: Due date is required.',
          };
        }

        // Critical validation: Must have billing info
        if (!ctx.order.billToName && !ctx.order.billToCompany) {
          return {
            ok: false,
            code: 'NO_BILLING_INFO',
            message: 'Cannot start production: Billing information (name or company) is required.',
          };
        }

        // Soft warning: No attachments
        if (ctx.attachmentsCount === 0) {
          warnings.push('No artwork/files attached - production may be delayed.');
        }

        return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
      }

      if (to === 'on_hold') {
        return { ok: true };
      }

      if (to === 'canceled') {
        return { ok: true };
      }

      // Invalid transition from new
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot transition from ${from} to ${to}. Valid options: in_production, on_hold, canceled.`,
      };

    case 'in_production':
      if (to === 'ready_for_shipment') {
        // Soft validation: Check if jobs are complete (if jobs integration exists)
        if (ctx.jobsCount && ctx.jobsCount > 0) {
          warnings.push('Order has active production jobs - verify all work is complete before marking ready for shipment.');
        }

        return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
      }

      if (to === 'on_hold') {
        return { ok: true };
      }

      if (to === 'canceled') {
        // Allow but require admin confirmation (handled at endpoint level)
        return { ok: true };
      }

      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot transition from ${from} to ${to}. Valid options: ready_for_shipment, on_hold, canceled.`,
      };

    case 'on_hold':
      if (to === 'in_production') {
        return { ok: true };
      }

      if (to === 'canceled') {
        return { ok: true };
      }

      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot transition from ${from} to ${to}. Valid options: in_production, canceled.`,
      };

    case 'ready_for_shipment':
      if (to === 'completed') {
        // Soft validation: Should have shipped or be pickup
        const isPickup = ctx.order.shippingMethod === 'pickup';
        const hasShipped = ctx.hasShippedAt || ctx.fulfillmentStatus === 'shipped' || ctx.fulfillmentStatus === 'delivered';

        if (!isPickup && !hasShipped) {
          warnings.push('Order has not been shipped yet - consider updating fulfillment status first.');
        }

        return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
      }

      if (to === 'on_hold') {
        // Allow going back on hold (issue discovered before shipment)
        return { ok: true };
      }

      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot transition from ${from} to ${to}. Valid options: completed, on_hold.`,
      };

    default:
      return {
        ok: false,
        code: 'UNKNOWN_STATUS',
        message: `Unknown order status: ${from}`,
      };
  }
}

/**
 * Get allowed next statuses for a given current status.
 */
export function getAllowedNextStatuses(currentStatus: OrderStatus): OrderStatus[] {
  switch (currentStatus) {
    case 'new':
      return ['in_production', 'on_hold', 'canceled'];
    case 'in_production':
      return ['ready_for_shipment', 'on_hold', 'canceled'];
    case 'on_hold':
      return ['in_production', 'canceled'];
    case 'ready_for_shipment':
      return ['completed', 'on_hold'];
    case 'completed':
      return []; // Terminal
    case 'canceled':
      return []; // Terminal
    default:
      return [];
  }
}

/**
 * Check if a status is terminal (no further transitions allowed).
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'completed' || status === 'canceled';
}

/**
 * Check if an order can be edited based on its status.
 * This is for general field edits, not status transitions.
 */
export function isOrderEditable(order: Order): boolean {
  // Completed and canceled orders are fully locked
  return order.status !== 'completed' && order.status !== 'canceled';
}

/**
 * Check if line items can be edited for an order.
 * Line items are locked once production starts.
 */
export function areLineItemsEditable(order: Order): boolean {
  return order.status === 'new';
}

/**
 * Check if pricing fields can be edited for an order.
 * Pricing is locked once production starts.
 */
export function isPricingEditable(order: Order): boolean {
  return order.status === 'new';
}
