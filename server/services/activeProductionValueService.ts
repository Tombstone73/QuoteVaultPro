import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { orderLineItems, orders, orderStatusPills } from "@shared/schema";
import { db } from "../db";
import { projectActiveProductionValue, type ActiveProductionValue } from "../lib/activeProductionValue";
import { currentProductionStatusPillPredicate } from "./dailyProductionReportStatus";

export async function getActiveProductionValue(organizationId: string): Promise<ActiveProductionValue> {
  // One set-based, tenant-scoped read. Do not join production_jobs or runs:
  // replacement owners and Combined Runs can both represent the same line.
  const lines = await db.select({
    id: orderLineItems.id,
    orderId: orders.id,
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
    .where(and(
      eq(orders.organizationId, organizationId),
      eq(orders.state, "open"),
      isNull(orders.canceledAt),
      currentProductionStatusPillPredicate(),
      or(isNotNull(orders.statusPillId), sql`trim(coalesce(${orders.statusPillValue}, '')) <> ''`),
    ));
  return projectActiveProductionValue(organizationId, lines);
}
