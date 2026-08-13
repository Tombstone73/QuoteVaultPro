import { and, eq, isNull, sql } from "drizzle-orm";
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
  return ["open", "production_complete"].includes(String(order.state || "").toLowerCase());
}

export function fulfillmentQueueEligibleOrderCondition(organizationId: string) {
  return and(
    eq(orders.organizationId, organizationId),
    sql`lower(coalesce(${orders.state}, '')) in ('open', 'production_complete')`,
    isNull(orders.canceledAt),
    sql`lower(coalesce(${orders.status}, '')) not in ('canceled', 'cancelled')`,
  );
}
