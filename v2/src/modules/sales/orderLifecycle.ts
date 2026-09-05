export type OrderWorkflowIntent = "standard_production" | "fulfillment_only" | "service_fee";

export type OrderCompletionLineEvidence = Readonly<{
  orderLineId: string;
  description: string;
  workflowIntent: OrderWorkflowIntent | null;
  requiresProduction: boolean;
  orderedQuantity: number;
  productionComplete: boolean;
  fulfilledQuantity: number;
  routeComplete: boolean;
  /** Current audited exception state; never rewrites frozen Product facts. */
  productionRequirement?: "required" | "not_required" | "satisfied";
}>;

export type OrderCompletionBlocker = Readonly<{
  orderLineId: string;
  kind: "production_incomplete" | "fulfillment_remaining" | "route_incomplete" | "workflow_unavailable";
  reason: string;
}>;

export type OrderCompletionEligibility = Readonly<{
  eligible: boolean;
  blockers: readonly OrderCompletionBlocker[];
  lines: readonly Readonly<{
    orderLineId: string;
    workflowIntent: OrderWorkflowIntent | "unavailable";
    productionRequired: boolean;
    fulfillmentRequired: boolean;
    routeRequired: boolean;
    productionComplete: boolean;
    fulfillmentComplete: boolean;
    routeComplete: boolean;
  }>[];
}>;

/**
 * Pure Order policy. Production and Fulfillment remain the owners of the facts
 * supplied here; Sales only decides whether the explicit terminal transition
 * is currently legal. Financial state is intentionally absent.
 */
export const orderCompletionEligibility = (
  lines: readonly OrderCompletionLineEvidence[],
): OrderCompletionEligibility => {
  const blockers: OrderCompletionBlocker[] = [];
  const projected = lines.map((line) => {
    const productionRequired = line.productionRequirement
      ? line.productionRequirement === "required"
      : line.requiresProduction;
    const productionComplete = line.productionRequirement === "satisfied"
      || !productionRequired
      || line.productionComplete;
    if (!line.workflowIntent) {
      blockers.push({ orderLineId: line.orderLineId, kind: "workflow_unavailable", reason: `${line.description}: frozen workflow requirements are unavailable.` });
      return { orderLineId: line.orderLineId, workflowIntent: "unavailable" as const, productionRequired, fulfillmentRequired: false, routeRequired: false, productionComplete: false, fulfillmentComplete: false, routeComplete: false };
    }
    const fulfillmentRequired = line.workflowIntent !== "service_fee";
    const routeRequired = line.workflowIntent === "standard_production";
    const fulfillmentComplete = !fulfillmentRequired || line.fulfilledQuantity >= line.orderedQuantity;
    if (productionRequired && !productionComplete)
      blockers.push({ orderLineId: line.orderLineId, kind: "production_incomplete", reason: `${line.description}: required Production is incomplete.` });
    if (!fulfillmentComplete)
      blockers.push({ orderLineId: line.orderLineId, kind: "fulfillment_remaining", reason: `${line.description}: ${Math.max(0, line.orderedQuantity - line.fulfilledQuantity)} item(s) remain to be fulfilled.` });
    if (routeRequired && !line.routeComplete)
      blockers.push({ orderLineId: line.orderLineId, kind: "route_incomplete", reason: `${line.description}: its frozen route is not complete.` });
    return {
      orderLineId: line.orderLineId,
      workflowIntent: line.workflowIntent,
      productionRequired,
      fulfillmentRequired,
      routeRequired,
      productionComplete,
      fulfillmentComplete,
      routeComplete: !routeRequired || line.routeComplete,
    };
  });
  if (!lines.length)
    blockers.push({ orderLineId: "order", kind: "workflow_unavailable", reason: "Order completion requires at least one canonical Order line." });
  return { eligible: blockers.length === 0, blockers, lines: projected };
};
