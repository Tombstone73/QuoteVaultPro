import { and, eq, inArray } from 'drizzle-orm';
import { orderLineItems, orders, products } from '../../shared/schema';
import { db } from '../db';

/**
 * Adds product identity to invoice-line snapshots in bounded batch queries.
 * The invoice snapshot remains the fallback so standalone and deleted-product
 * invoices remain readable.
 */
export async function hydrateInvoiceLineItemsWithProductIdentity<T extends Record<string, any>>(input: {
  organizationId: string;
  lineItems: T[];
}): Promise<Array<T & { productName: string | null }>> {
  if (!input.lineItems.length) return input.lineItems.map((line) => ({ ...line, productName: line.productName ?? null }));

  const orderLineItemIds = [...new Set(input.lineItems
    .map((line) => typeof line.orderLineItemId === 'string' ? line.orderLineItemId : null)
    .filter((id): id is string => Boolean(id)))];
  const sourceLines = orderLineItemIds.length
    ? await db.select({ id: orderLineItems.id, productId: orderLineItems.productId, name: orderLineItems.name })
      .from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .where(and(eq(orders.organizationId, input.organizationId), inArray(orderLineItems.id, orderLineItemIds)))
    : [];
  const sourceLineById = new Map(sourceLines.map((line) => [line.id, line]));
  const productIds = [...new Set(input.lineItems
    .flatMap((line) => [line.productId, sourceLineById.get(line.orderLineItemId)?.productId])
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const productRows = productIds.length
    ? await db.select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.organizationId, input.organizationId), inArray(products.id, productIds)))
    : [];
  const productNameById = new Map(productRows.map((product) => [product.id, product.name]));

  return input.lineItems.map((line) => {
    const sourceLine = sourceLineById.get(line.orderLineItemId);
    const productName = productNameById.get(line.productId)
      || productNameById.get(sourceLine?.productId)
      || sourceLine?.name
      || line.name
      || null;
    return { ...line, productName };
  });
}
