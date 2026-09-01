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

export type OrderProductionPrerequisiteStage = "Design" | "Proof" | "Prepress";

export type OrderProductionPrerequisiteCandidate = {
  workflowState?: string | null;
  designStatus?: string | null;
  requiresDesign?: boolean | null;
  requiresProofApproval?: boolean | null;
  requiresPrepress?: boolean | null;
  approvedProofVersionId?: string | null;
  activeStationKey?: string | null;
  activeStepKey?: string | null;
};

const DESIGN_WORKFLOW_STATES = new Set(["needs_design", "in_design"]);
const PREPRESS_WORKFLOW_STATES = new Set(["ready_for_prepress", "in_prepress"]);

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * Identifies prerequisites that an authorized Order-level completion override
 * would skip. This is intentionally read-only; the command re-evaluates it
 * under transaction locks before applying an override.
 */
export function listOrderProductionPrerequisitesToBypass(
  candidate: OrderProductionPrerequisiteCandidate,
): OrderProductionPrerequisiteStage[] {
  const workflowState = normalized(candidate.workflowState);
  const designStatus = normalized(candidate.designStatus);
  const activeStation = normalized(candidate.activeStationKey);
  const activeStep = normalized(candidate.activeStepKey);
  // A real production-station owner means prior gates were already resolved
  // through the normal route (or a historical override). Completing that
  // started work must retain normal timer/material semantics.
  if (activeStation && !["design", "prepress", "fulfillment"].includes(activeStation)) {
    return [];
  }
  const stages: OrderProductionPrerequisiteStage[] = [];

  if (
    activeStation === "design"
    || activeStep === "design"
    || (candidate.requiresDesign === true && (DESIGN_WORKFLOW_STATES.has(workflowState) || ["needs_design", "in_design"].includes(designStatus)))
  ) {
    stages.push("Design");
  }
  if (candidate.requiresProofApproval === true && !String(candidate.approvedProofVersionId || "").trim()) {
    stages.push("Proof");
  }
  if (
    activeStation === "prepress"
    || activeStep === "prepress"
    || (candidate.requiresPrepress === true && PREPRESS_WORKFLOW_STATES.has(workflowState))
  ) {
    stages.push("Prepress");
  }

  return stages;
}

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
