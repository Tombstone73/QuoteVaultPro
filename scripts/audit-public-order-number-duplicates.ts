import "dotenv/config";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { customers, orders } from "@shared/schema";
import { db } from "../server/db";

/**
 * Read-only audit for legacy/public order-number collisions. Operational repair
 * commands must accept `orders.id` only; this report makes collisions explicit.
 */
async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  if (!organizationId) throw new Error("ORGANIZATION_ID (UUID) is required.");

  const orderNumberDuplicates = await db
    .select({ orderNumber: orders.orderNumber, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.organizationId, organizationId))
    .groupBy(orders.orderNumber)
    .having(sql`count(*) > 1`);
  const displayNumberDuplicates = await db
    .select({ displayNumber: orders.displayNumber, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.organizationId, organizationId))
    .groupBy(orders.displayNumber)
    .having(sql`${orders.displayNumber} is not null and count(*) > 1`);
  const orderNumbers = orderNumberDuplicates.map((row) => row.orderNumber);
  const displayNumbers = displayNumberDuplicates.map((row) => row.displayNumber).filter((value): value is string => Boolean(value));
  const rows = orderNumbers.length === 0 && displayNumbers.length === 0 ? [] : await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerName: customers.companyName,
      state: orders.state,
      status: orders.status,
      fulfillmentStatus: orders.fulfillmentStatus,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(
      eq(orders.organizationId, organizationId),
      or(
        orderNumbers.length ? inArray(orders.orderNumber, orderNumbers) : sql`false`,
        displayNumbers.length ? inArray(orders.displayNumber, displayNumbers) : sql`false`,
      ),
    ))
    .orderBy(orders.orderNumber, orders.id);

  console.log(JSON.stringify({
    mode: "read_only",
    organizationId,
    duplicateOrderNumberCount: orderNumberDuplicates.length,
    duplicateDisplayNumberCount: displayNumberDuplicates.length,
    duplicateOrderCount: rows.length,
    orderNumberDuplicates,
    displayNumberDuplicates,
    orders: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit-public-order-number-duplicates]", error);
  process.exit(1);
});
