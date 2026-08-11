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
        requiresPrepress: true,
        proofGateAllowed: true,
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

  test("a cleared proof gate advances a proof-blocked item to prepress", () => {
    const transition = deriveProofRecoveryWorkflowTransition({
      lineItemId: "line-item-2",
      workflowState: "awaiting_proof_approval",
      requiresPrepress: true,
      proofGateAllowed: true,
    });

    expect(transition.toState).toBe("ready_for_prepress");
    expect(transition.toState).not.toBe("awaiting_proof_approval");
  });

  test("an unresolved proof gate leaves the awaiting-proof state in place", () => {
    expect(
      deriveProofRecoveryWorkflowTransition({
        lineItemId: "line-item-2b",
        workflowState: "awaiting_proof_approval",
        requiresPrepress: true,
        proofGateAllowed: false,
      }).toState,
    ).toBe("awaiting_proof_approval");
  });

  test("a cleared proof gate advances directly to production when prepress is skipped", () => {
    expect(
      deriveProofRecoveryWorkflowTransition({
        lineItemId: "line-item-3",
        workflowState: "awaiting_proof_approval",
        requiresPrepress: false,
        proofGateAllowed: true,
      }).toState,
    ).toBe("ready_for_production");
  });

  test("a repeated reconciliation is idempotent once the item is already ready for prepress", () => {
    expect(
      deriveProofRecoveryWorkflowTransition({
        lineItemId: "line-item-4",
        workflowState: "ready_for_prepress",
        requiresPrepress: true,
        proofGateAllowed: true,
      }).toState,
    ).toBe("ready_for_prepress");
  });
});
