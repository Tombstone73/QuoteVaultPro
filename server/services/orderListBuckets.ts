import { and, eq, sql } from "drizzle-orm";
import { orders, orderStatusPills } from "@shared/schema";
import {
  CANONICAL_OPEN_ORDER_STATE,
  COMPLETE_ORDER_STATUS_PILL_KEY,
} from "@shared/openOrderBadgePolicy";

/**
 * Shared database predicate for the Orders page's unfiltered Open work bucket.
 * It deliberately does not use the stale low-level `orders.status` projection.
 */
export function canonicalOpenOrderBucketPredicate(organizationId: string) {
  return and(
    eq(orders.state, CANONICAL_OPEN_ORDER_STATE),
    sql`lower(trim(coalesce(${orders.statusPillValue}, ''))) <> 'complete'`,
    sql`not exists (
      select 1
      from ${orderStatusPills}
      where ${orderStatusPills.organizationId} = ${organizationId}
        and ${orderStatusPills.id} = ${orders.statusPillId}
        and lower(${orderStatusPills.key}) = ${COMPLETE_ORDER_STATUS_PILL_KEY}
    )`,
  );
}
