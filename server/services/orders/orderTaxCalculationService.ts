import { and, eq, inArray } from "drizzle-orm";

import { customers, orderLineItems, orders, organizations, products } from "@shared/schema";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput, type OrderTaxPolicy } from "../../quoteOrderPricing";
import { db } from "../../db";
import { synchronizeOrderBackedInvoiceFromOrderInTransaction } from "../../invoicesService";
import { getBillableBundleRoots } from "../lineItemBundles";

type TaxableOrderLine = {
  id?: string;
  productId: string;
  totalPrice: string | number | null | undefined;
  parentLineItemId?: string | null;
  lineItemRole?: string | null;
  taxCategoryId?: string | null;
  taxabilityOverride?: boolean | null;
};

export function resolveEffectiveLineTaxability(
  taxabilityOverride: boolean | null | undefined,
  productIsTaxable: boolean | null | undefined,
) {
  return typeof taxabilityOverride === "boolean" ? taxabilityOverride : productIsTaxable ?? true;
}

export function resolveOrderTaxPolicy(
  taxOverrideMode: "auto" | "exempt" | "rate" | string | null | undefined,
  taxRateOverride: string | number | null | undefined,
): OrderTaxPolicy {
  const rawMode = String(taxOverrideMode ?? "auto").toLowerCase();
  if (rawMode === "exempt") return { mode: "exempt" };
  if (rawMode === "rate") {
    const parsedRate = Number(taxRateOverride ?? 0);
    return { mode: "rate", rate: Number.isFinite(parsedRate) ? Math.max(0, Math.min(1, parsedRate)) : 0 };
  }
  return { mode: "auto" };
}

async function calculateTaxForLines(executor: any, input: {
  organizationId: string;
  customerId?: string | null;
  lines: TaxableOrderLine[];
  taxOverrideMode?: "auto" | "exempt" | "rate" | string | null;
  taxRateOverride?: string | number | null;
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
    isTaxable: resolveEffectiveLineTaxability(
      line.taxabilityOverride,
      productMap.get(String(line.productId))?.isTaxable,
    ),
    taxCategoryId: line.taxCategoryId ?? null,
  }));
  const shipTo = customer ? {
    country: customer.country || "US",
    state: customer.state || (organization.settings as any)?.timezone?.split("/")[0] || "CA",
    city: customer.city,
    postalCode: customer.postalCode,
  } : null;
  const taxPolicy = resolveOrderTaxPolicy(input.taxOverrideMode, input.taxRateOverride);
  const totals = await calculateQuoteOrderTotals(taxLines, getOrganizationTaxSettings(organization), customer, null, shipTo, taxPolicy);
  return { billableLines, totals };
}

/** The sole server-side tax path for inbound conversion and editable saved-order rollups. */
export async function calculateAuthoritativeOrderTax(input: {
  organizationId: string;
  customerId?: string | null;
  lines: TaxableOrderLine[];
  taxOverrideMode?: "auto" | "exempt" | "rate" | string | null;
  taxRateOverride?: string | number | null;
  executor?: any;
}) {
  return calculateTaxForLines(input.executor ?? db, input);
}

/** Read-only canonical financial projection for an existing Order. Repair and
 * diagnostic tooling must use this rather than recreate Order arithmetic. */
export async function calculateEditableOrderFinancialSnapshot(executor: any, input: {
  organizationId: string;
  orderId: string;
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
    taxOverrideMode: (order as any).taxOverrideMode,
    taxRateOverride: (order as any).taxRateOverride,
  });
  const discount = Number(order.discount) || 0;
  const shipping = Math.max(0, Number(order.shippingCents) || 0) / 100;
  return {
    order,
    lines,
    billableLines,
    totals,
    discount,
    shipping,
    total: totals.subtotal - discount + totals.taxAmount + shipping,
  };
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
    const snapshot = await calculateEditableOrderFinancialSnapshot(executor, input);
    if (!snapshot) return null;
    const { order, billableLines, totals, total } = snapshot;
    await Promise.all(billableLines.map((line, index) => executor.update(orderLineItems).set({
      taxAmount: totals.lineItemsWithTax[index]!.taxAmount.toFixed(2),
      isTaxableSnapshot: totals.lineItemsWithTax[index]!.isTaxableSnapshot,
      updatedAt: new Date(),
    } as any).where(eq(orderLineItems.id, line.id!))));
    const [updated] = await executor.update(orders).set({
      subtotal: totals.subtotal.toFixed(2),
      tax: totals.taxAmount.toFixed(2),
      taxRate: totals.taxRate.toFixed(6),
      taxAmount: totals.taxAmount.toFixed(2),
      taxableSubtotal: totals.taxableSubtotal.toFixed(2),
      total: total.toFixed(2),
      updatedAt: new Date(),
    } as any).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).returning();
    await synchronizeOrderBackedInvoiceFromOrderInTransaction(executor, input);
    return updated ?? null;
}

export async function recalculateEditableOrderFinancials(input: {
  organizationId: string;
  orderId: string;
  actorUserId?: string | null;
}) {
  return db.transaction((tx) => recalculateEditableOrderFinancialsInTransaction(tx, input));
}
