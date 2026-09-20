import { and, eq } from "drizzle-orm";

import { orderAuditLog, orders } from "@shared/schema";

const RECOVERABLE_STALE_OPEN_STATUSES = new Set(["ready_for_shipment", "completed", "complete"]);

export function requiresParentProductionRecovery(input: { state?: string | null; status?: string | null; productionIncomplete: boolean }) {
  return input.productionIncomplete
    && String(input.state || "").toLowerCase() === "open"
    && RECOVERABLE_STALE_OPEN_STATUSES.has(String(input.status || "").toLowerCase());
}

export async function reconcileParentOrderForHistoricalProductionOverride(tx: any, args: {
  organizationId: string; order: any; productionIncomplete: boolean; requiresProductionBootstrap: boolean;
  closeJobOverride: boolean; confirmBypass: boolean; confirmProductionBootstrap: boolean;
  actorUserId: string; actorUserName: string | null; sourceInvoiceId?: string | null;
  reconciliationReason?: string | null; reconciliationNote?: string | null; remainingProductionQuantity?: number | null;
}) {
  if (!args.closeJobOverride || !args.confirmBypass) return { recovered: false };
  const state = String(args.order.state || "").toLowerCase();
  if (state === "canceled" || state === "closed") {
    throw Object.assign(new Error(`Close Job Override cannot recover an order in ${state} state.`), {
      statusCode: 409, code: "CLOSE_JOB_OVERRIDE_TERMINAL_ORDER",
      details: { orderId: args.order.id, orderNumber: args.order.orderNumber, orderState: args.order.state, orderStatus: args.order.status },
    });
  }
  if (!requiresParentProductionRecovery({ state: args.order.state, status: args.order.status, productionIncomplete: args.productionIncomplete })) {
    return { recovered: false };
  }
  if (args.requiresProductionBootstrap && !args.confirmProductionBootstrap) {
    throw Object.assign(new Error("Confirm the production bootstrap before recovering this historical Order."), {
      statusCode: 409, code: "PRODUCTION_BOOTSTRAP_CONFIRMATION_REQUIRED", details: { orderId: args.order.id, orderNumber: args.order.orderNumber },
    });
  }
  const previous = { state: args.order.state, status: args.order.status, routingTarget: args.order.routingTarget, productionCompletedAt: args.order.productionCompletedAt };
  const now = new Date();
  await tx.update(orders).set({ state: "open", status: "in_production", routingTarget: null, productionCompletedAt: null, updatedAt: now } as any).where(and(
    eq(orders.organizationId, args.organizationId), eq(orders.id, args.order.id), eq(orders.state, "open"), eq(orders.status, args.order.status),
  ));
  await tx.insert(orderAuditLog).values({
    orderId: args.order.id, userId: args.actorUserId, userName: args.actorUserName,
    actionType: "order.production_parent_reconciled_for_close_override", fromStatus: args.order.status ?? null, toStatus: "in_production",
    note: args.reconciliationNote || "Historical production remained incomplete while the parent Order was ready for shipment.",
    metadata: {
      source: "close_job_override", sourceInvoiceId: args.sourceInvoiceId ?? null, reconciliationReason: args.reconciliationReason ?? null,
      previous, recovered: { state: "open", status: "in_production", routingTarget: null, productionCompletedAt: null },
      remainingProductionQuantity: args.remainingProductionQuantity ?? null, confirmProductionBootstrap: args.confirmProductionBootstrap,
    },
  } as any);
  return { recovered: true, previous };
}
