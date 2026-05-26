import { and, eq, inArray, isNull } from "drizzle-orm";

import { orderLineItems, orders, type LineItemWorkflowState } from "@shared/schema";
import { isCanceledOrder } from "@shared/operationalState";

type DbLike = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

const OPERATIONAL_LINE_ITEM_STATES: LineItemWorkflowState[] = [
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
];

type OrderSyncResult = {
  orderId: string | null;
  changed: boolean;
  fromStatus: string | null;
  toStatus: string | null;
  triggerState: string | null;
};

async function loadOrderWithOperationalChild(tx: DbLike, args: {
  organizationId: string;
  orderId?: string | null;
  lineItemId?: string | null;
}) {
  const conditions = [
    eq(orders.organizationId, args.organizationId),
    inArray(orderLineItems.workflowState, OPERATIONAL_LINE_ITEM_STATES as any),
  ];

  if (args.orderId) {
    conditions.push(eq(orders.id, args.orderId));
  }

  if (args.lineItemId) {
    conditions.push(eq(orderLineItems.id, args.lineItemId));
  }

  const rows = await tx
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      orderState: orders.state,
      canceledAt: orders.canceledAt,
      startedProductionAt: orders.startedProductionAt,
      lineItemId: orderLineItems.id,
      workflowState: orderLineItems.workflowState,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

export async function syncParentOrderForOperationalChildren(tx: DbLike, args: {
  organizationId: string;
  orderId?: string | null;
  lineItemId?: string | null;
  actorUserId?: string | null;
  source: string;
}): Promise<OrderSyncResult> {
  const row = await loadOrderWithOperationalChild(tx, args);
  if (!row) {
    return {
      orderId: args.orderId ?? null,
      changed: false,
      fromStatus: null,
      toStatus: null,
      triggerState: null,
    };
  }

  if (isCanceledOrder({ status: row.orderStatus, state: row.orderState, canceledAt: row.canceledAt })) {
    console.warn("[OrderWorkflowSync] Operational line item found under canceled order", {
      source: args.source,
      organizationId: args.organizationId,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      lineItemId: row.lineItemId,
      workflowState: row.workflowState,
      orderStatus: row.orderStatus,
      orderState: row.orderState,
    });
    return {
      orderId: row.orderId,
      changed: false,
      fromStatus: row.orderStatus ?? null,
      toStatus: row.orderStatus ?? null,
      triggerState: row.workflowState ?? null,
    };
  }

  if (row.orderStatus === "in_production") {
    return {
      orderId: row.orderId,
      changed: false,
      fromStatus: row.orderStatus,
      toStatus: row.orderStatus,
      triggerState: row.workflowState ?? null,
    };
  }

  if (row.orderStatus !== "new") {
    console.warn("[OrderWorkflowSync] Operational line item found under non-production parent order", {
      source: args.source,
      organizationId: args.organizationId,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      lineItemId: row.lineItemId,
      workflowState: row.workflowState,
      orderStatus: row.orderStatus,
      orderState: row.orderState,
    });
    return {
      orderId: row.orderId,
      changed: false,
      fromStatus: row.orderStatus ?? null,
      toStatus: row.orderStatus ?? null,
      triggerState: row.workflowState ?? null,
    };
  }

  await tx
    .update(orders)
    .set({
      status: "in_production",
      startedProductionAt: row.startedProductionAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any)
    .where(
      and(
        eq(orders.id, row.orderId),
        eq(orders.organizationId, args.organizationId),
        eq(orders.status, "new"),
        isNull(orders.canceledAt),
      ),
    );

  return {
    orderId: row.orderId,
    changed: true,
    fromStatus: row.orderStatus,
    toStatus: "in_production",
    triggerState: row.workflowState ?? null,
  };
}
