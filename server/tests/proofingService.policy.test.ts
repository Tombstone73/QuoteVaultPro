import { describe, expect, test } from "@jest/globals";

import { deriveProofResponseWorkflowState } from "../services/proofingService";

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
});