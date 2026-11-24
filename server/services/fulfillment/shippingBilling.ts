import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { auditLogs, invoices, orders } from '@shared/schema';
import type { db } from '../../db';
import { FulfillmentHttpError } from './types';

/** Only the Pickup-to-Shipping workflow introduces this billing checkpoint.
 * Legacy shipments and replacement labels keep their existing policies. */
export async function assertChangedOrderShippingBilled(
  tx: Pick<typeof db, 'select'>, organizationId: string, orderIds: string[],
) {
  if (!orderIds.length) return;
  const changed = await tx.select({
    id: orders.id, shippingCents: orders.shippingCents, decision: orders.shippingChargeDecision,
  }).from(orders).where(and(eq(orders.organizationId, organizationId), inArray(orders.id, orderIds),
    sql`exists (select 1 from ${auditLogs}
      where ${auditLogs.organizationId} = ${organizationId} and ${auditLogs.entityType} = 'order'
        and ${auditLogs.entityId} = ${orders.id} and ${auditLogs.actionType} = 'FULFILLMENT_METHOD_CHANGED'
        and ${auditLogs.newValues}->>'requiresShippingDecision' = 'true')`,
  ));
  if (!changed.length) return;
  const linked = await tx.select({ orderId: invoices.orderId, shippingCents: invoices.shippingCents }).from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), inArray(invoices.orderId, changed.map(order => order.id)), ne(invoices.status, 'void')));
  for (const order of changed) {
    const active = linked.filter(invoice => invoice.orderId === order.id);
    const billed = active.filter(invoice => invoice.shippingCents > 0);
    if (order.decision !== 'unset' && (order.shippingCents === 0
      ? order.decision === 'free' && billed.length === 0
      : billed.length === 1 && billed[0].shippingCents === order.shippingCents)) continue;
    throw new FulfillmentHttpError(409,
      'Complete Shipping billing before dispatch. Bill the customer charge, confirm free shipping, or review an existing invoice in Accounting.',
      'SHIPPING_BILLING_REQUIRED');
  }
}
