export type ProductionCompletionLineItemState = {
  workflowState: "completed";
  status: "complete";
};

/**
 * A line item becomes fulfillment-ready as soon as its production completion
 * route reaches the fulfillment station. This is intentionally independent of
 * the later physical pickup/shipment event.
 */
export function resolveProductionCompletionLineItemState(
  targetStationKey: string | null | undefined,
): ProductionCompletionLineItemState | null {
  return String(targetStationKey || "").trim().toLowerCase() === "fulfillment"
    ? { workflowState: "completed", status: "complete" }
    : null;
}
