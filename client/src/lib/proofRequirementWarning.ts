const DOWNSTREAM_PROOF_STATES = new Set(["ready_for_prepress", "in_prepress", "ready_for_production", "in_production"]);

export function requiresExplicitProofReturn(workflowState: string | null | undefined): boolean {
  return DOWNSTREAM_PROOF_STATES.has(String(workflowState || "").toLowerCase());
}

export function shouldWarnAfterProofRequirementSave(input: {
  previousRequiresProof: boolean | null | undefined;
  savedRequiresProof: boolean | null | undefined;
  workflowState: string | null | undefined;
}): boolean {
  return input.previousRequiresProof === false && input.savedRequiresProof === true &&
    requiresExplicitProofReturn(input.workflowState);
}
