/**
 * Canonical line-item readiness for fulfillment. A queued Fulfillment job is
 * an ownership handoff after production, not unfinished production.
 */
export type FulfillmentLineReadiness = {
  eligible: boolean;
  status: "production_complete" | "awaiting_production";
  label: string;
  reason: "completed_lifecycle" | "fulfillment_handoff" | "active_production" | "incomplete_lifecycle";
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveFulfillmentLineReadiness(input: {
  workflowState?: string | null;
  lifecycleStatus?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  activeOwnerStatus?: string | null;
}): FulfillmentLineReadiness {
  const workflowState = normalize(input.workflowState);
  const lifecycleStatus = normalize(input.lifecycleStatus);
  const ownerStation = normalize(input.activeOwnerStationKey);
  const ownerStep = normalize(input.activeOwnerStepKey);
  const hasActiveOwner = Boolean(ownerStation || ownerStep || normalize(input.activeOwnerStatus));
  const isFulfillmentHandoff = ownerStation === "fulfillment" || ownerStep === "fulfillment";
  const completedLifecycle = workflowState === "completed" || lifecycleStatus === "complete" || lifecycleStatus === "completed";

  if (completedLifecycle && (!hasActiveOwner || isFulfillmentHandoff)) {
    return {
      eligible: true,
      status: "production_complete",
      label: "Production complete, awaiting fulfillment",
      reason: isFulfillmentHandoff ? "fulfillment_handoff" : "completed_lifecycle",
    };
  }
  if (hasActiveOwner && !isFulfillmentHandoff) {
    return { eligible: false, status: "awaiting_production", label: "Production in progress", reason: "active_production" };
  }
  return { eligible: false, status: "awaiting_production", label: "Awaiting production", reason: "incomplete_lifecycle" };
}
