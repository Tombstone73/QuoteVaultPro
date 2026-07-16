import { db } from '../db';
import { orders, orderLineItems, organizations, products } from '../../shared/schema';
import { and, eq, sql } from 'drizzle-orm';

export type BillingReadyPolicy = 'all_line_items_done' | 'manual' | 'none';

/** Service/fee lines are immediately billable once they carry a configured price. */
export function isLineItemReadyForBilling(lineItem: {
  status?: string | null;
  totalPrice?: unknown;
  workflowIntent?: string | null;
  allowZeroPrice?: boolean | null;
}): boolean {
  if (lineItem.workflowIntent === "service_fee") {
    const total = Number(lineItem.totalPrice);
    return Number.isFinite(total) && (total > 0 || lineItem.allowZeroPrice === true);
  }

  const status = String(lineItem.status || '').toLowerCase();
  return status === 'done' || status === 'canceled';
}
export type OrderBillingStatus = 'not_ready' | 'ready' | 'billed';

export async function getBillingReadyPolicyForOrg(organizationId: string): Promise<BillingReadyPolicy> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const policy = (org?.settings as any)?.preferences?.orders?.billingReadyPolicy as BillingReadyPolicy | undefined;
  return policy ?? 'all_line_items_done';
}

export async function recomputeOrderBillingStatus(params: {
  organizationId: string;
  orderId: string;
}): Promise<{ updated: boolean; from?: OrderBillingStatus; to?: OrderBillingStatus } | { updated: false } > {
  const { organizationId, orderId } = params;

  const now = new Date();

  const [order] = await db
    .select({
      id: orders.id,
      billingStatus: orders.billingStatus,
      billingReadyAt: orders.billingReadyAt,
      billingReadyPolicy: orders.billingReadyPolicy,
      billingReadyOverride: orders.billingReadyOverride,
      billingReadyOverrideAt: orders.billingReadyOverrideAt,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!order) return { updated: false };

  // Never auto-change once billed
  if ((order.billingStatus as any) === 'billed') return { updated: false };

  const current = (order.billingStatus as OrderBillingStatus) ?? 'not_ready';

  // Override is a manual force-ready switch.
  // If override is active, ensure status + timestamps are consistent.
  if (order.billingReadyOverride) {
    const updates: any = { updatedAt: sql`now()` as any };
    let changed = false;

    if (current !== 'ready') {
      updates.billingStatus = 'ready';
      changed = true;
    }

    if (!order.billingReadyAt) {
      updates.billingReadyAt = now as any;
      changed = true;
    }

    if (!order.billingReadyOverrideAt) {
      updates.billingReadyOverrideAt = now as any;
      changed = true;
    }

    if (!changed) return { updated: false };

    await db
      .update(orders)
      .set(updates)
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

    return { updated: true, from: current, to: 'ready' };
  }

  // If override is not active, clear any lingering override timestamp (defensive).
  const shouldClearOverrideAt = !!order.billingReadyOverrideAt;

  // Policy precedence: per-order column first; fallback to org default ONLY if NULL/empty.
  const rawOrderPolicy = typeof order.billingReadyPolicy === 'string' ? order.billingReadyPolicy.trim() : null;
  const allowedPolicies = new Set<string>(['all_line_items_done', 'manual', 'none']);
  let policy: BillingReadyPolicy = (rawOrderPolicy && allowedPolicies.has(rawOrderPolicy))
    ? (rawOrderPolicy as BillingReadyPolicy)
    : (await getBillingReadyPolicyForOrg(organizationId));

  if (!allowedPolicies.has(policy)) {
    policy = await getBillingReadyPolicyForOrg(organizationId);
  }

  let target: OrderBillingStatus = 'not_ready';
  if (policy === 'all_line_items_done') {
    const lineItems = await db
      .select({
        status: orderLineItems.status,
        totalPrice: orderLineItems.totalPrice,
        workflowIntent: products.workflowIntent,
        allowZeroPrice: products.allowZeroPrice,
      })
      .from(orderLineItems)
      .innerJoin(products, eq(products.id, orderLineItems.productId))
      .where(eq(orderLineItems.orderId, orderId));

    const allDone = lineItems.length > 0 && lineItems.every(isLineItemReadyForBilling);

    target = allDone ? 'ready' : 'not_ready';
  } else {
    // manual | none: never auto-ready
    target = 'not_ready';
  }

  const shouldUpdateStatus = current !== target;
  const shouldSetReadyAt = target === 'ready' && !order.billingReadyAt;
  const shouldClearReadyAt = target !== 'ready' && !!order.billingReadyAt;

  if (!shouldUpdateStatus && !shouldSetReadyAt && !shouldClearReadyAt && !shouldClearOverrideAt) {
    return { updated: false };
  }

  const updates: any = { updatedAt: now as any };
  if (shouldUpdateStatus) updates.billingStatus = target;
  if (shouldSetReadyAt) updates.billingReadyAt = now as any;
  if (shouldClearReadyAt) updates.billingReadyAt = null;
  if (shouldClearOverrideAt) updates.billingReadyOverrideAt = null;

  await db
    .update(orders)
    .set(updates)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

  return { updated: true, from: current, to: shouldUpdateStatus ? target : current };
}
