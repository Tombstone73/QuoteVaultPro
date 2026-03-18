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
    expect(OWNERSHIP_REQUIRED_WORKFLOW_STATES).toEqual([
      "needs_design",
      "in_design",
      "ready_for_prepress",
      "in_prepress",
      "ready_for_production",
      "in_production",
    ]);
  });

  test("ownerless states match the stable contract", () => {
    expect(OWNERLESS_WORKFLOW_STATES).toEqual([
      "new",
      "awaiting_proof_approval",
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

  test("initial workflow state derives from routing truth", () => {
    expect(getInitialWorkflowState({ requiresDesign: true, requiresPrepress: true })).toBe("needs_design");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresPrepress: true })).toBe("ready_for_prepress");
    expect(getInitialWorkflowState({ requiresDesign: false, requiresPrepress: false })).toBe("ready_for_production");
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

  test("awaiting proof approval remains ownerless and blocks reroute edits", () => {
    expect(workflowStateIsIntentionallyOwnerless("awaiting_proof_approval")).toBe(true);
    expect(workflowStateRequiresActiveOwner("awaiting_proof_approval")).toBe(false);
    expect(canEditLineItemRouting({ workflowState: "awaiting_proof_approval", hasActiveJob: false })).toBe(false);
  });
});
