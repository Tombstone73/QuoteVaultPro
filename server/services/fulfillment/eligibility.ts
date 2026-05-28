import { and, eq, isNull, or, sql } from "drizzle-orm";
import { orders } from "@shared/schema";
import { isCanceledOrder } from "@shared/operationalState";

export type FulfillmentEligibilityOrder = {
  state?: string | null;
  shippingMethod?: string | null;
  routingTarget?: string | null;
  status?: string | null;
  canceledAt?: string | Date | null;
};

export function isProductionCompleteForFulfillment(order: Pick<FulfillmentEligibilityOrder, "state">): boolean {
  return String(order.state || "").toLowerCase() === "production_complete";
}

export function isFulfillmentQueueEligibleOrder(order: FulfillmentEligibilityOrder): boolean {
  if (isCanceledOrder(order)) return false;
  if (!isProductionCompleteForFulfillment(order)) return false;
  if (order.shippingMethod === "pickup") return true;
  return order.routingTarget === "fulfillment";
}

export function fulfillmentQueueEligibleOrderCondition(organizationId: string) {
  return and(
    eq(orders.organizationId, organizationId),
    eq(orders.state as any, "production_complete"),
    or(eq(orders.routingTarget as any, "fulfillment"), eq(orders.shippingMethod as any, "pickup")),
    isNull(orders.canceledAt),
    sql`lower(coalesce(${orders.status}, '')) not in ('canceled', 'cancelled')`,
  );
}
