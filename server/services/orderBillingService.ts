import { db } from '../db';
import { orders, orderLineItems, organizations } from '../../shared/schema';
import { and, eq } from 'drizzle-orm';

export type BillingReadyPolicy = 'all_line_items_done' | 'manual' | 'none';
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

  const [order] = await db
    .select({
      id: orders.id,
      billingStatus: orders.billingStatus,
      billingReadyOverride: orders.billingReadyOverride,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!order) return { updated: false };

  // Never auto-change if override is active
  if (order.billingReadyOverride) return { updated: false };

  // Never auto-change once billed
  if ((order.billingStatus as any) === 'billed') return { updated: false };

  const policy = await getBillingReadyPolicyForOrg(organizationId);
  if (policy === 'manual' || policy === 'none') return { updated: false };

  // all_line_items_done
  const lineItems = await db
    .select({ status: orderLineItems.status })
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, orderId));

  const allDone = lineItems.length > 0 && lineItems.every((li) => {
    const s = String(li.status || '').toLowerCase();
    return s === 'done' || s === 'canceled';
  });

  const target: OrderBillingStatus = allDone ? 'ready' : 'not_ready';
  const current = (order.billingStatus as OrderBillingStatus) ?? 'not_ready';

  if (current === target) return { updated: false };

  await db
    .update(orders)
    .set({ billingStatus: target, updatedAt: new Date().toISOString() as any })
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

  return { updated: true, from: current, to: target };
}
