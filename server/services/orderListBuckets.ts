import { and, eq, not, or, sql } from "drizzle-orm";
import { orders, orderStatusPills } from "@shared/schema";
import { CANONICAL_OPEN_ORDER_STATE, COMPLETE_ORDER_STATUS_PILL_KEY } from "@shared/openOrderBadgePolicy";

/** Same precedence as isManualOrderComplete: current tenant catalog key, then legacy saved value. */
function currentManualCompletePredicate(organizationId: string) {
  return sql<boolean>`coalesce(
    (select lower(trim(${orderStatusPills.key})) = ${COMPLETE_ORDER_STATUS_PILL_KEY}
     from ${orderStatusPills}
     where ${orderStatusPills.organizationId} = ${organizationId} and ${orderStatusPills.id} = ${orders.statusPillId}),
    lower(trim(coalesce(${orders.statusPillValue}, ''))) = 'complete'
  )`;
}

/**
 * Operational work-queue predicate shared by list and sidebar. It never writes
 * lifecycle, production quantities, fulfillment, or financial state.
 */
export function canonicalOpenOrderBucketPredicate(organizationId: string) {
  return and(
    eq(orders.state, CANONICAL_OPEN_ORDER_STATE),
    eq(orders.organizationId, organizationId),
    not(currentManualCompletePredicate(organizationId)),
  );
}

export function productionCompleteOrderBucketPredicate(organizationId: string) {
  return and(eq(orders.organizationId, organizationId), or(
    eq(orders.state, 'production_complete'),
    and(eq(orders.state, CANONICAL_OPEN_ORDER_STATE), currentManualCompletePredicate(organizationId)),
  ));
}
