/**
 * Narrow policy helpers for the Order-level "Complete Production" shortcut.
 * They intentionally decide only whether the shortcut may delegate to the
 * canonical production-job workflow; they never mutate line or job state.
 */

export type OrderProductionCompletionCandidate = {
  lineItemRole?: string | null;
  productionBypassed?: boolean | null;
  requiresProductionJob?: boolean | null;
  workflowIntent?: string | null;
};

export function requiresCanonicalProductionCompletion(candidate: OrderProductionCompletionCandidate): boolean {
  const workflowIntent = String(candidate.workflowIntent || "").trim().toLowerCase();
  return candidate.productionBypassed !== true
    && candidate.lineItemRole !== "parent"
    && candidate.requiresProductionJob === true
    && workflowIntent !== "service_fee"
    && workflowIntent !== "fulfillment_only";
}

/**
 * Only these states can safely repair a missing owner.  Design, proofing, and
 * prepress are deliberate prerequisites and must remain in their own flows.
 */
export function missingOwnerRepairState(workflowState: unknown): "ready_for_production" | "in_production" | null {
  const state = String(workflowState || "").trim().toLowerCase();
  return state === "ready_for_production" || state === "in_production"
    ? state
    : null;
}

/** Order completion may finish production stations, never Design, Prepress, or Fulfillment. */
export function isOrderShortcutCompletableProductionStation(stationKey: unknown): boolean {
  const station = String(stationKey || "").trim().toLowerCase();
  return Boolean(station)
    && !["design", "proofing", "prepress", "fulfillment", "done", "completed"].includes(station);
}
