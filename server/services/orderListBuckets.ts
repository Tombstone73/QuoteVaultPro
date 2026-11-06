import { and, eq } from "drizzle-orm";
import { orders } from "@shared/schema";
import { CANONICAL_OPEN_ORDER_STATE } from "@shared/openOrderBadgePolicy";

/**
 * Shared database predicate for the Orders page's unfiltered Open work bucket.
 * Neither legacy status nor an informational pill can hide an open obligation.
 */
export function canonicalOpenOrderBucketPredicate(organizationId: string) {
  return and(
    eq(orders.state, CANONICAL_OPEN_ORDER_STATE),
    eq(orders.organizationId, organizationId),
  );
}
