import { and, eq } from "drizzle-orm";

import { orders } from "../../shared/schema";
import { db } from "../db";

export type InvoiceOrderContext = {
  orderNumber: string | null;
  poNumber: string | null;
  jobLabel: string | null;
};

/**
 * Resolves display-only invoice context from the invoice's linked order. The
 * order remains the source of truth; no PO or label is copied onto invoices.
 */
export async function getInvoiceOrderContext(input: {
  organizationId: string;
  orderId: string | null | undefined;
  customerId?: string | null;
}): Promise<InvoiceOrderContext | null> {
  const orderId = String(input.orderId || "").trim();
  if (!orderId) return null;

  const scopes = [
    eq(orders.id, orderId),
    eq(orders.organizationId, input.organizationId),
    ...(input.customerId ? [eq(orders.customerId, input.customerId)] : []),
  ];
  const [order] = await db
    .select({
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      jobLabel: orders.label,
    })
    .from(orders)
    .where(and(...scopes))
    .limit(1);

  if (!order) return null;
  return {
    orderNumber: order.orderNumber ?? null,
    poNumber: order.poNumber ?? null,
    jobLabel: order.jobLabel ?? null,
  };
}
