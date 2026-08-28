import { and, eq, inArray } from "drizzle-orm";

import { customers, orderLineItems, orders, organizations, products } from "@shared/schema";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput } from "../../quoteOrderPricing";
import { db } from "../../db";
import { synchronizeDraftInvoiceFromOrderInTransaction } from "../../invoicesService";
import { getBillableBundleRoots } from "../lineItemBundles";

type TaxableOrderLine = {
  id?: string;
  productId: string;
  totalPrice: string | number | null | undefined;
  parentLineItemId?: string | null;
  lineItemRole?: string | null;
  taxCategoryId?: string | null;
};

async function calculateTaxForLines(executor: any, input: {
  organizationId: string;
  customerId?: string | null;
  lines: TaxableOrderLine[];
}) {
  const [organization] = await executor.select().from(organizations)
    .where(eq(organizations.id, input.organizationId)).limit(1);
  if (!organization) throw new Error("Organization not found for order tax calculation.");

  const billableLines = getBillableBundleRoots(input.lines);
  const productIds = Array.from(new Set(billableLines.map((line) => String(line.productId)).filter(Boolean)));
  const productRows = productIds.length
    ? await executor.select().from(products).where(and(
      eq(products.organizationId, input.organizationId),
      inArray(products.id, productIds),
    ))
    : [];
  const productMap = new Map(productRows.map((product: any) => [String(product.id), product]));

  let customer: any = null;
  if (input.customerId) {
    [customer] = await executor.select().from(customers)
      .where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, input.customerId))).limit(1);
  }

  const taxLines: LineItemInput[] = billableLines.map((line) => ({
    productId: String(line.productId),
    linePrice: Number(line.totalPrice) || 0,
    isTaxable: productMap.get(String(line.productId))?.isTaxable ?? true,
    taxCategoryId: line.taxCategoryId ?? null,
  }));
  const shipTo = customer ? {
    country: customer.country || "US",
    state: customer.state || (organization.settings as any)?.timezone?.split("/")[0] || "CA",
    city: customer.city,
    postalCode: customer.postalCode,
  } : null;
  const totals = await calculateQuoteOrderTotals(taxLines, getOrganizationTaxSettings(organization), customer, null, shipTo);
  return { billableLines, totals };
}

/** The sole server-side tax path for inbound conversion and editable saved-order rollups. */
export async function calculateAuthoritativeOrderTax(input: {
  organizationId: string;
  customerId?: string | null;
  lines: TaxableOrderLine[];
  executor?: any;
}) {
  return calculateTaxForLines(input.executor ?? db, input);
}

/**
 * Recomputes commercial order totals from persisted lines and synchronizes its
 * one native editable draft invoice in the same database transaction.
 */
export async function recalculateEditableOrderFinancialsInTransaction(executor: any, input: {
  organizationId: string;
  orderId: string;
  actorUserId?: string | null;
}) {
    const [order] = await executor.select().from(orders).where(and(
      eq(orders.id, input.orderId),
      eq(orders.organizationId, input.organizationId),
    )).limit(1);
    if (!order) return null;
    const lines = await executor.select().from(orderLineItems).where(eq(orderLineItems.orderId, input.orderId));
    const { billableLines, totals } = await calculateTaxForLines(executor, {
      organizationId: input.organizationId,
      customerId: order.customerId,
      lines,
    });
    await Promise.all(billableLines.map((line, index) => executor.update(orderLineItems).set({
      taxAmount: totals.lineItemsWithTax[index]!.taxAmount.toFixed(2),
      isTaxableSnapshot: totals.lineItemsWithTax[index]!.isTaxableSnapshot,
      updatedAt: new Date(),
    } as any).where(eq(orderLineItems.id, line.id!))));
    const discount = Number(order.discount) || 0;
    const shipping = Math.max(0, Number(order.shippingCents) || 0) / 100;
    const total = totals.subtotal - discount + totals.taxAmount + shipping;
    const [updated] = await executor.update(orders).set({
      subtotal: totals.subtotal.toFixed(2),
      tax: totals.taxAmount.toFixed(2),
      taxRate: totals.taxRate.toFixed(6),
      taxAmount: totals.taxAmount.toFixed(2),
      taxableSubtotal: totals.taxableSubtotal.toFixed(2),
      total: total.toFixed(2),
      updatedAt: new Date(),
    } as any).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).returning();
    await synchronizeDraftInvoiceFromOrderInTransaction(executor, input);
    return updated ?? null;
}

export async function recalculateEditableOrderFinancials(input: {
  organizationId: string;
  orderId: string;
  actorUserId?: string | null;
}) {
  return db.transaction((tx) => recalculateEditableOrderFinancialsInTransaction(tx, input));
}
