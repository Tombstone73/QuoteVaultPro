import { and, eq, inArray } from "drizzle-orm";
import { buildArtworkAllocationStatus } from "@shared/artworkAllocation";
import { orderAttachments, orderAuditLog, orderLineItems, orders, products } from "@shared/schema";
import { normalizeOrderSaveRoutingMode, resolveOrderSaveRouteTarget, type OrderSaveRoutingMode } from "@shared/orderSaveRouting";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";

export { normalizeOrderSaveRoutingMode, resolveOrderSaveRouteTarget, type OrderSaveRoutingMode } from "@shared/orderSaveRouting";

export type OrderSaveRoutingLineResult = {
  lineItemId: string;
  destination?: "Design" | "Proofing" | "Prepress";
  status: "routed" | "already_routed" | "blocked" | "failed" | "skipped";
  reason?: string;
};

/**
 * This runs only after order persistence and TEMP artwork promotion. It keeps
 * routing independent from commercial saving: one blocked line never rolls a
 * valid order back, and transitionLineItemWorkflowState remains the sole owner
 * of sessions and workflow idempotency.
 */
export async function routeEligibleOrderLineItems(tx: any, args: {
  organizationId: string;
  orderId: string;
  actorUserId: string;
  actorName: string;
  mode: OrderSaveRoutingMode;
}): Promise<OrderSaveRoutingLineResult[]> {
  const lines = await tx
    .select({
      id: orderLineItems.id,
      quantity: orderLineItems.quantity,
      workflowState: orderLineItems.workflowState,
      requiresDesign: orderLineItems.requiresDesign,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      requiresPrepress: orderLineItems.requiresPrepress,
      productId: orderLineItems.productId,
      artworkPolicy: products.artworkPolicy,
    })
    .from(orderLineItems)
    .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, args.organizationId)))
    .leftJoin(products, eq(products.id, orderLineItems.productId))
    .where(eq(orderLineItems.orderId, args.orderId));

  if (args.mode !== "route_eligible") {
    return lines.map((line: any) => ({ lineItemId: String(line.id), status: "skipped" as const, reason: "Save only was selected." }));
  }

  const lineIds = lines.map((line: any) => String(line.id));
  const artwork = lineIds.length === 0 ? [] : await tx
    .select({
      lineItemId: orderAttachments.orderLineItemId,
      id: orderAttachments.id,
      role: orderAttachments.role,
      side: orderAttachments.side,
      productionQuantity: orderAttachments.productionQuantity,
      productionGroupId: orderAttachments.productionGroupId,
    })
    .from(orderAttachments)
    .where(and(eq(orderAttachments.orderId, args.orderId), inArray(orderAttachments.orderLineItemId, lineIds)));
  const artworkByLine = new Map<string, any[]>();
  for (const file of artwork) {
    if (!file.lineItemId || !["artwork", "output"].includes(String(file.role))) continue;
    const current = artworkByLine.get(String(file.lineItemId)) ?? [];
    current.push(file);
    artworkByLine.set(String(file.lineItemId), current);
  }

  const results: OrderSaveRoutingLineResult[] = [];
  for (const line of lines as any[]) {
    const lineItemId = String(line.id);
    const target = resolveOrderSaveRouteTarget({
      requiresDesign: Boolean(line.requiresDesign),
      requiresProofApproval: Boolean(line.requiresProofApproval),
      requiresPrepress: Boolean(line.requiresPrepress),
    });
    if (!target) {
      results.push({ lineItemId, status: "skipped", reason: "No Proofing or Prepress route is required." });
      continue;
    }

    // Design may start before customer artwork exists. Every other automatic
    // path requires the same explicit artwork-allocation gate used by Prepress.
    if (target.destination !== "Design" && String(line.artworkPolicy ?? "not_required") === "required") {
      const files = artworkByLine.get(lineItemId) ?? [];
      if (files.length === 0) {
        results.push({ lineItemId, status: "blocked", reason: "Production artwork is missing." });
        continue;
      }
      const allocation = buildArtworkAllocationStatus({
        lineQuantity: line.quantity,
        members: files.map((file) => ({
          id: String(file.id), role: file.role, side: file.side,
          productionQuantity: file.productionQuantity, productionGroupId: file.productionGroupId,
        })),
      });
      if (!allocation.valid) {
        results.push({ lineItemId, status: "blocked", reason: allocation.issue ?? "Artwork quantity allocation is unresolved." });
        continue;
      }
    }

    try {
      const transition = await transitionLineItemWorkflowState(tx, {
        organizationId: args.organizationId,
        lineItemId,
        toState: target.state,
        actorUserId: args.actorUserId,
        note: "Routed after order save.",
        metadata: { source: "order_save_routing", destination: target.destination },
      });
      const alreadyRouted = transition.fromState === target.state && transition.ownershipAction === "none";
      await tx.insert(orderAuditLog).values({
        orderId: args.orderId,
        orderLineItemId: lineItemId,
        userId: args.actorUserId,
        userName: args.actorName,
        actionType: "route_after_save",
        fromStatus: transition.fromState,
        toStatus: target.destination,
        note: alreadyRouted ? "Line was already routed after order save." : "Line routed after order save.",
        metadata: { destination: target.destination, ownershipAction: transition.ownershipAction },
      } as any);
      results.push({ lineItemId, destination: target.destination, status: alreadyRouted ? "already_routed" : "routed" });
    } catch (error: any) {
      results.push({ lineItemId, destination: target.destination, status: "failed", reason: error?.message || "Routing failed." });
    }
  }
  return results;
}
