import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { customerContacts, customers, orderLineItems, orders, orderStatusPills } from "@shared/schema";
import { db } from "../db";
import { projectActiveProductionValue, type ActiveProductionValue } from "../lib/activeProductionValue";
import { currentProductionStatusPillPredicate } from "./dailyProductionReportStatus";

export async function listActiveProductionValueCandidates(organizationId: string) {
  // One set-based, tenant-scoped read. Do not join production_jobs or runs:
  // replacement owners and Combined Runs can both represent the same line.
  const lines = await db.select({
    id: orderLineItems.id,
    orderId: orders.id,
    lineDescription: orderLineItems.description,
    orderNumber: sql<string>`coalesce(${orders.displayNumber}, ${orders.orderNumber})`,
    jobLabel: orders.label,
    poNumber: orders.poNumber,
    dueDate: orders.dueDate,
    customerId: orders.customerId,
    customerName: sql<string | null>`coalesce(${customers.companyName}, nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), ''), ${customerContacts.email})`,
    organizationId: orders.organizationId,
    orderState: orders.state,
    orderStatus: orders.status,
    orderCanceledAt: orders.canceledAt,
    statusPillId: orders.statusPillId,
    statusPillKey: orderStatusPills.key,
    statusPillValue: orders.statusPillValue,
    workflowState: orderLineItems.workflowState,
    lifecycleStatus: orderLineItems.status,
    lineItemRole: orderLineItems.lineItemRole,
    parentLineItemId: orderLineItems.parentLineItemId,
    parentPriceMode: orderLineItems.parentPriceMode,
    valueCents: sql<number>`round(${orderLineItems.totalPrice} * 100)::bigint`,
  }).from(orderLineItems)
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .leftJoin(orderStatusPills, and(
      eq(orderStatusPills.id, orders.statusPillId),
      eq(orderStatusPills.organizationId, orders.organizationId),
    ))
    .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
    .leftJoin(customerContacts, and(eq(customerContacts.id, orders.contactId), eq(customerContacts.organizationId, organizationId)))
    .where(and(
      eq(orders.organizationId, organizationId),
      isNull(orders.canceledAt),
      currentProductionStatusPillPredicate(),
      or(isNotNull(orders.statusPillId), sql`trim(coalesce(${orders.statusPillValue}, '')) <> ''`),
    ));
  return lines;
}

export async function getActiveProductionValue(organizationId: string): Promise<ActiveProductionValue> {
  const lines = await listActiveProductionValueCandidates(organizationId);
  return projectActiveProductionValue(organizationId, lines);
}
