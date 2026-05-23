import { and, eq } from "drizzle-orm";

import { orderLineItems, orders } from "@shared/schema";

type DbLike = {
  select: (...args: any[]) => any;
};

type ProductionOwnerRef = {
  id?: string | null;
  orderId?: string | null;
  lineItemId?: string | null;
};

function blocked(message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: "PARENT_ORDER_NOT_IN_PRODUCTION",
    details,
  });
}

async function loadOrderForProductionOwner(tx: DbLike, args: {
  organizationId: string;
  orderId?: string | null;
  lineItemId?: string | null;
}) {
  if (args.orderId) {
    const rows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        state: orders.state,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(and(eq(orders.id, args.orderId), eq(orders.organizationId, args.organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  if (args.lineItemId) {
    const rows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        state: orders.state,
        orderNumber: orders.orderNumber,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  return null;
}

export async function assertParentOrderInProduction(tx: DbLike, args: {
  organizationId: string;
  orderId?: string | null;
  lineItemId?: string | null;
  action: string;
}) {
  const order = await loadOrderForProductionOwner(tx, args);
  if (!order) {
    throw blocked("Cannot advance production workflow: parent order was not found.", {
      action: args.action,
      orderId: args.orderId ?? null,
      lineItemId: args.lineItemId ?? null,
    });
  }

  if (order.status !== "in_production") {
    throw blocked(
      `Cannot ${args.action}: parent order ${order.orderNumber ?? order.id} is ${order.status}, not in_production.`,
      {
        action: args.action,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        orderState: order.state,
      },
    );
  }

  return order;
}

export async function assertParentOrderInProductionForJob(tx: DbLike, args: {
  organizationId: string;
  job: ProductionOwnerRef;
  action: string;
}) {
  return assertParentOrderInProduction(tx, {
    organizationId: args.organizationId,
    orderId: args.job.orderId ?? null,
    lineItemId: args.job.lineItemId ?? null,
    action: args.action,
  });
}
