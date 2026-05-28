import { describe, expect, test } from "@jest/globals";

import { deriveProofRecoveryWorkflowTransition, deriveProofResponseWorkflowState } from "../services/proofingService";

describe("proofing policy", () => {
  test("approved proofs hand off to prepress when prepress is required", () => {
    expect(
      deriveProofResponseWorkflowState({
        decision: "approved",
        requiresPrepress: true,
      }),
    ).toBe("ready_for_prepress");
  });

  test("approved proofs hand off directly to production when prepress is not required", () => {
    expect(
      deriveProofResponseWorkflowState({
        decision: "approved",
        requiresPrepress: false,
      }),
    ).toBe("ready_for_production");
  });

  test.each(["rejected", "revision_requested"] as const)(
    "%s returns the line item to design",
    (decision) => {
      expect(
        deriveProofResponseWorkflowState({
          decision,
          requiresPrepress: true,
        }),
      ).toBe("needs_design");
    },
  );

  test("proof recovery actions clear proof blocking without faking design completion", () => {
    expect(
      deriveProofRecoveryWorkflowTransition({
        lineItemId: "line-item-1",
        workflowState: "in_design",
        lifecycleStatus: "new",
      }),
    ).toMatchObject({
      lineItemId: "line-item-1",
      fromState: "in_design",
      toState: "in_design",
      lifecycleStatus: "new",
      ownershipAction: "none",
    });
  });

  test("proof recovery actions do not route incomplete design directly to prepress", () => {
    const transition = deriveProofRecoveryWorkflowTransition({
      lineItemId: "line-item-2",
      workflowState: "awaiting_proof_approval",
    });

    expect(transition.toState).toBe("awaiting_proof_approval");
    expect(transition.toState).not.toBe("ready_for_prepress");
  });
});
