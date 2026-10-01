import { and, eq, isNull, sql } from "drizzle-orm";
import { orders } from "@shared/schema";
import { isCanceledOrder } from "@shared/operationalState";
import type { FulfillmentOrderQuantitySummary } from "@shared/fulfillmentReadiness";

export type FulfillmentEligibilityOrder = {
  state?: string | null;
  shippingMethod?: string | null;
  routingTarget?: string | null;
  status?: string | null;
  canceledAt?: string | Date | null;
  fulfillmentStatus?: string | null;
};

export function isProductionCompleteForFulfillment(order: Pick<FulfillmentEligibilityOrder, "state">): boolean {
  return String(order.state || "").toLowerCase() === "production_complete";
}

export function isFulfillmentQueueEligibleOrder(order: FulfillmentEligibilityOrder): boolean {
  if (isCanceledOrder(order)) return false;
  // Invoice Job Status maps these same persisted parent values to
  // “Fulfillment Complete”. A terminal parent cannot remain in the active
  // operations queue; legacy contradictions are reported by the integrity
  // audit and repaired only through the explicit backfill workflow.
  if (["shipped", "delivered"].includes(String(order.fulfillmentStatus || "").toLowerCase())) return false;
  return ["open", "production_complete"].includes(String(order.state || "").toLowerCase());
}

/** History is opt-in and must have canonical quantity evidence, not just a
 * terminal parent label. This does not change active operational eligibility. */
export function fulfillmentQueueVisibility(
  order: FulfillmentEligibilityOrder,
  quantities: FulfillmentOrderQuantitySummary,
  showArchived: boolean,
): "active" | "historical" | null {
  if (isCanceledOrder(order) || quantities.physicalLineCount === 0) return null;
  if (isFulfillmentQueueEligibleOrder(order) && quantities.remainingQuantity > 0) return "active";
  if (showArchived && quantities.operationallyFulfilledQuantity > 0) return "historical";
  if (showArchived && quantities.remainingQuantity > 0 && (order.state === 'closed' || order.status === 'operationally_complete' || ['shipped', 'delivered'].includes(String(order.fulfillmentStatus).toLowerCase()))) return "historical";
  return null;
}

export function fulfillmentQueueEligibleOrderCondition(organizationId: string) {
  return and(
    eq(orders.organizationId, organizationId),
    sql`lower(coalesce(${orders.state}, '')) in ('open', 'production_complete')`,
    isNull(orders.canceledAt),
    sql`lower(coalesce(${orders.status}, '')) not in ('canceled', 'cancelled')`,
    sql`lower(coalesce(${orders.fulfillmentStatus}, '')) not in ('shipped', 'delivered')`,
  );
}
