import { describe, expect, test } from "@jest/globals";

import {
  OWNERLESS_WORKFLOW_STATES,
  OWNERSHIP_REQUIRED_WORKFLOW_STATES,
  getInitialWorkflowState,
  workflowStateIsIntentionallyOwnerless,
  workflowStateRequiresActiveOwner,
} from "../services/lineItemWorkflowService";
import {
  ROUTING_EDIT_INTAKE_SAFE_STATES,
  canEditLineItemRouting,
} from "../routes/orders.routes";

describe("workflow contract policy", () => {
  test("ownership-required states match the stable contract", () => {
    // awaiting_proof_approval is now ownership-required (Titan default):
    // Prepress must own proof-required items so they appear in the Prepress
    // queue immediately for proof creation and sending.
    expect(OWNERSHIP_REQUIRED_WORKFLOW_STATES).toEqual([
      "needs_design",
      "in_design",
      "awaiting_proof_approval",
      "ready_for_prepress",
      "in_prepress",
      "ready_for_production",
      "in_production",
    ]);
  });

  test("ownerless states match the stable contract", () => {
    // awaiting_proof_approval removed: it is now owned by Prepress.
    expect(OWNERLESS_WORKFLOW_STATES).toEqual([
      "new",
      "on_hold",
      "completed",
      "canceled",
    ]);
  });

  test("ownership-required and ownerless states do not overlap", () => {
    for (const state of OWNERSHIP_REQUIRED_WORKFLOW_STATES) {
      expect(OWNERLESS_WORKFLOW_STATES).not.toContain(state);
    }
  });

  test.each(OWNERSHIP_REQUIRED_WORKFLOW_STATES)("%s requires an active owner", (state) => {
    expect(workflowStateRequiresActiveOwner(state)).toBe(true);
    expect(workflowStateIsIntentionallyOwnerless(state)).toBe(false);
  });

  test.each(OWNERLESS_WORKFLOW_STATES)("%s is intentionally ownerless", (state) => {
    expect(workflowStateIsIntentionallyOwnerless(state)).toBe(true);
    expect(workflowStateRequiresActiveOwner(state)).toBe(false);
  });

  test("awaiting_proof_approval requires an active owner (Prepress)", () => {
    expect(workflowStateRequiresActiveOwner("awaiting_proof_approval")).toBe(true);
    expect(workflowStateIsIntentionallyOwnerless("awaiting_proof_approval")).toBe(false);
  });

  test("initial workflow state derives from routing truth", () => {
    expect(getInitialWorkflowState({ requiresDesign: true, requiresPrepress: true })).toBe("needs_design");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresPrepress: true })).toBe("ready_for_prepress");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresPrepress: false })).toBe("ready_for_production");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresProofApproval: true, requiresPrepress: true })).toBe("awaiting_proof_approval");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresProofApproval: true, requiresPrepress: false })).toBe("awaiting_proof_approval");
    expect(getInitialWorkflowState({ requiresDesign: true, requiresProofApproval: true, requiresPrepress: true })).toBe("needs_design");
  });
});

describe("routing edit guard", () => {
  test("intake-safe states match the stable reroute policy", () => {
    expect(ROUTING_EDIT_INTAKE_SAFE_STATES).toEqual([
      "new",
      "needs_design",
      "ready_for_prepress",
      "ready_for_production",
    ]);
  });

  test.each(ROUTING_EDIT_INTAKE_SAFE_STATES)("allows reroute edits for intake-safe state %s when no active owner exists", (state) => {
    expect(canEditLineItemRouting({ workflowState: state, hasActiveJob: false })).toBe(true);
  });

  test.each(["in_design", "awaiting_proof_approval", "in_prepress", "in_production", "on_hold", "completed", "canceled"])(
    "blocks reroute edits for non-intake-safe state %s",
    (state) => {
      expect(canEditLineItemRouting({ workflowState: state, hasActiveJob: false })).toBe(false);
    },
  );

  test.each(["new", "needs_design", "ready_for_prepress", "ready_for_production", "in_production"])(
    "blocks reroute edits when an active owner exists, even if state is %s",
    (state) => {
      expect(canEditLineItemRouting({ workflowState: state, hasActiveJob: true })).toBe(false);
    },
  );

  test("awaiting_proof_approval is not intake-safe and blocks reroute edits", () => {
    // awaiting_proof_approval is now owned by Prepress (not ownerless),
    // and is still correctly blocked from routing edits.
    expect(workflowStateRequiresActiveOwner("awaiting_proof_approval")).toBe(true);
    expect(workflowStateIsIntentionallyOwnerless("awaiting_proof_approval")).toBe(false);
    expect(canEditLineItemRouting({ workflowState: "awaiting_proof_approval", hasActiveJob: false })).toBe(false);
  });
});
