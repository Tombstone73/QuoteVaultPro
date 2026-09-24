import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, invoices, orderAuditLog, orderLineItems, orders, products } from "@shared/schema";
import { mapStateToLegacyStatus } from "./orderStateService";
import { assessOrderAutoClose, isApplicableOrderInvoice, type OrderAutoCloseDecision } from "./orderAutoClosePolicy";
import { FulfillmentDashboardRepo } from './fulfillment/repository';
import { operationalCompletionOrderPatch } from '@shared/orderOperationalStatus';

export type OrderAutoCloseResult = OrderAutoCloseDecision & { orderId: string };


/**
 * Event-driven and idempotent. Call only after a payment or terminal
 * fulfillment mutation commits; never from a read, page load, or scanner.
 */
export async function reconcileOrderAutoClose(input: {
  organizationId: string;
  orderId: string;
  actorUserId?: string | null;
  actorUserName?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
}): Promise<OrderAutoCloseResult> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`order-auto-close:${input.organizationId}:${input.orderId}`}))`);
    const [order] = await tx.select({
      id: orders.id,
      state: orders.state,
      status: orders.status,
      fulfillmentStatus: orders.fulfillmentStatus,
      routingTarget: orders.routingTarget,
    }).from(orders).where(and(
      eq(orders.organizationId, input.organizationId),
      eq(orders.id, input.orderId),
    )).for("update").limit(1);
    if (!order) return { action: "no_op", reason: "ORDER_NOT_FOUND" } as const;

    // Physical fulfillment and administrative fulfillment share the same
    // canonical quantities. Project operational completion before considering
    // payment, so unpaid invoices cannot leave a ready-for-shipment label.
    if (order.state === 'production_complete') {
      const repository = new FulfillmentDashboardRepo(tx as any);
      const lines = await repository.listLineEligibility(input.organizationId, { orderIds: [input.orderId] }, tx as any);
      const complete = lines.length > 0 && lines.every(({ projection: p }) =>
        p.remainingQuantity === 0 && (!p.requiresFulfillment || p.productionCompleteQuantity >= p.orderedQuantity));
      if (!complete) return { action: 'not_eligible', reason: 'OPERATIONAL_COMPLETION_REQUIRED' } as const;
      await repository.assertNoActiveProduction(input.organizationId, input.orderId, tx as any);
      if (order.status !== 'operationally_complete' || order.routingTarget === 'fulfillment') {
        await tx.update(orders).set({ ...operationalCompletionOrderPatch(order), updatedAt: sql`now()` as any })
          .where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId)));
        order.routingTarget = null;
      }
    }

    const lineRows = await tx.select({ productId: orderLineItems.productId, status: orderLineItems.status })
      .from(orderLineItems).where(eq(orderLineItems.orderId, input.orderId));
    const productIds = Array.from(new Set(lineRows.map((line) => line.productId)));
    const productRows = productIds.length > 0
      ? await tx.select({ id: products.id, workflowIntent: products.workflowIntent }).from(products)
        .where(and(eq(products.organizationId, input.organizationId), inArray(products.id, productIds)))
      : [];
    const workflowIntentByProductId = new Map(productRows.map((product) => [product.id, product.workflowIntent]));
    const invoiceRows = await tx.select({ status: invoices.status, balanceDue: invoices.balanceDue })
      .from(invoices).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.orderId, input.orderId)));
    const decision = assessOrderAutoClose({
      state: order.state,
      fulfillmentStatus: order.fulfillmentStatus,
      routingTarget: order.routingTarget,
      lineItems: lineRows.map((line) => ({ status: line.status, workflowIntent: workflowIntentByProductId.get(line.productId) })),
      invoices: invoiceRows,
    });
    if (decision.action !== "closed") return decision;

    const now = new Date().toISOString();
    const [updated] = await tx.update(orders).set({
      state: "closed",
      status: mapStateToLegacyStatus("closed") as any,
      closedAt: now,
      updatedAt: sql`now()` as any,
    }).where(and(
      eq(orders.organizationId, input.organizationId),
      eq(orders.id, input.orderId),
      eq(orders.state, "production_complete"),
    )).returning({ id: orders.id });
    if (!updated) return { action: "no_op", reason: "ORDER_CLOSED" } as const;

    await tx.insert(orderAuditLog).values({
      orderId: input.orderId,
      userId: input.actorUserId ?? null,
      userName: input.actorUserName ?? "System",
      actionType: "order_auto_closed",
      fromStatus: "production_complete",
      toStatus: "closed",
      note: "Order automatically closed after terminal fulfillment and settlement of all applicable invoices.",
      metadata: {
        source: input.source,
        autoClose: true,
        fulfillmentStatus: order.fulfillmentStatus,
        invoiceCount: invoiceRows.filter(isApplicableOrderInvoice).length,
        ...input.metadata,
      },
    } as any);
    return decision;
  });

  if (result.action === "closed") {
    const { applyWorkflowStatusPillFailSoft } = await import("./workflowStatusPillService");
    await applyWorkflowStatusPillFailSoft({
      organizationId: input.organizationId,
      orderId: input.orderId,
      triggerKey: "order_closed",
      actorUserId: input.actorUserId ?? null,
      actorUserName: input.actorUserName ?? "System",
      source: "system",
      reason: "Order automatically closed after fulfillment and payment completion.",
      metadata: { autoClose: true, reconciliationSource: input.source, ...input.metadata },
    });
  }
  return { ...result, orderId: input.orderId };
}

/** Auto-close is downstream; failures must not roll back the primary event. */
export async function reconcileOrderAutoCloseFailSoft(input: Parameters<typeof reconcileOrderAutoClose>[0]): Promise<OrderAutoCloseResult | null> {
  try {
    return await reconcileOrderAutoClose(input);
  } catch (error) {
    console.error("[OrderAutoClose] Reconciliation failed", { organizationId: input.organizationId, orderId: input.orderId, source: input.source, error });
    try {
      await db.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId ?? null,
        actionType: "ORDER_AUTO_CLOSE_RECONCILIATION_FAILED",
        entityType: "order",
        entityId: input.orderId,
        entityName: null,
        description: "Automatic Order close reconciliation failed after a primary payment or fulfillment event.",
        newValues: { source: input.source, error: String((error as Error)?.message || error).slice(0, 1000) },
      } as any);
    } catch (auditError) {
      console.error("[OrderAutoClose] Failed to record reconciliation error", auditError);
    }
    return null;
  }
}
