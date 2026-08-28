import { db } from '../db';
import { orders, orderLineItems, organizations, products } from '../../shared/schema';
import { and, eq, sql } from 'drizzle-orm';

export type BillingReadyPolicy = 'all_line_items_done' | 'manual' | 'none';

/**
 * Billing eligibility is financial, not operational. Production and fulfillment
 * progress may be useful context for a person preparing an invoice, but it must
 * never prevent one from being created.
 */
export function isLineItemReadyForBilling(lineItem: {
  status?: string | null;
  totalPrice?: unknown;
  workflowIntent?: string | null;
  allowZeroPrice?: boolean | null;
}): boolean {
  if (String(lineItem.workflowIntent || "").trim().toLowerCase() === "service_fee") {
    const total = Number(lineItem.totalPrice);
    return Number.isFinite(total) && (total > 0 || lineItem.allowZeroPrice === true);
  }

  // Quantity-only, fulfillment, and production lines are invoiceable regardless
  // of lifecycle status. Their price is captured on the order line item.
  return true;
}

export type InvoiceFinancialEligibility = {
  canCreateInvoice: boolean;
  code?: "ORDER_HAS_NO_BILLABLE_LINES" | "UNPRICED_SERVICE_FEE";
  message?: string;
};

/**
 * The only line-level invoice blockers are financial: an order must contain at
 * least one line and every service/fee line must have an explicit usable price.
 * In particular, this intentionally does not inspect production status.
 */
export function resolveInvoiceFinancialEligibility(lines: Array<{
  totalPrice?: unknown;
  workflowIntent?: string | null;
  allowZeroPrice?: boolean | null;
}>): InvoiceFinancialEligibility {
  if (lines.length === 0) {
    return {
      canCreateInvoice: false,
      code: "ORDER_HAS_NO_BILLABLE_LINES",
      message: "Add at least one billable line before creating an invoice.",
    };
  }

  const unpricedServiceFeeCount = lines.filter((line) => !isLineItemReadyForBilling(line)).length;
  if (unpricedServiceFeeCount > 0) {
    return {
      canCreateInvoice: false,
      code: "UNPRICED_SERVICE_FEE",
      message: `${unpricedServiceFeeCount} service/fee line${unpricedServiceFeeCount === 1 ? " is" : "s are"} missing a configured price.`,
    };
  }

  return { canCreateInvoice: true };
}
export type OrderBillingStatus = 'not_ready' | 'ready' | 'billed';

export async function getBillingReadyPolicyForOrg(organizationId: string, executor: any = db): Promise<BillingReadyPolicy> {
  const [org] = await executor
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
  executor?: any;
}): Promise<{ updated: boolean; from?: OrderBillingStatus; to?: OrderBillingStatus } | { updated: false } > {
  const { organizationId, orderId } = params;
  const executor = params.executor ?? db;

  const now = new Date();

  const [order] = await executor
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

    await executor
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
    : (await getBillingReadyPolicyForOrg(organizationId, executor));

  if (!allowedPolicies.has(policy)) {
    policy = await getBillingReadyPolicyForOrg(organizationId, executor);
  }

  let target: OrderBillingStatus = 'not_ready';
  if (policy === 'all_line_items_done') {
    const lineItems = await executor
      .select({
        status: orderLineItems.status,
        totalPrice: orderLineItems.totalPrice,
        workflowIntent: products.workflowIntent,
        allowZeroPrice: products.allowZeroPrice,
      })
      .from(orderLineItems)
      .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
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

  await executor
    .update(orders)
    .set(updates)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

  return { updated: true, from: current, to: shouldUpdateStatus ? target : current };
}
