import { describe, expect, test } from "@jest/globals";

import {
  isOrderShortcutCompletableProductionStation,
  listOrderProductionPrerequisitesToBypass,
  missingOwnerRepairState,
  requiresCanonicalProductionCompletion,
} from "../services/orderProductionCompletionPolicy";

describe("Order production completion shortcut policy", () => {
  test("targets only physical production obligations", () => {
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: true, workflowIntent: "standard_production" })).toBe(true);
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: false, workflowIntent: "fulfillment_only" })).toBe(false);
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: true, workflowIntent: "fulfillment_only" })).toBe(false);
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: true, workflowIntent: "service_fee" })).toBe(false);
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: true, workflowIntent: "standard_production", productionBypassed: true })).toBe(false);
    expect(requiresCanonicalProductionCompletion({ requiresProductionJob: true, workflowIntent: "standard_production", lineItemRole: "parent" })).toBe(false);
  });

  test("repairs only a missing production owner that is already production-ready", () => {
    expect(missingOwnerRepairState("ready_for_production")).toBe("ready_for_production");
    expect(missingOwnerRepairState("in_production")).toBe("in_production");
    expect(missingOwnerRepairState("ready_for_prepress")).toBeNull();
    expect(missingOwnerRepairState("awaiting_proof_approval")).toBeNull();
    expect(missingOwnerRepairState("completed")).toBeNull();
  });

  test("identifies incomplete Design, Proof, and Prepress for explicit override confirmation", () => {
    expect(listOrderProductionPrerequisitesToBypass({
      workflowState: "needs_design",
      designStatus: "needs_design",
      requiresDesign: true,
      requiresProofApproval: true,
      requiresPrepress: true,
      approvedProofVersionId: null,
      activeStationKey: "design",
    })).toEqual(["Design", "Proof"]);

    expect(listOrderProductionPrerequisitesToBypass({
      workflowState: "ready_for_prepress",
      requiresPrepress: true,
      activeStationKey: "prepress",
    })).toEqual(["Prepress"]);
  });

  test("does not request an override for a real production owner", () => {
    expect(listOrderProductionPrerequisitesToBypass({
      workflowState: "in_production",
      designStatus: "design_complete",
      requiresDesign: true,
      requiresProofApproval: true,
      requiresPrepress: true,
      approvedProofVersionId: "proof-1",
      activeStationKey: "flatbed",
    })).toEqual([]);
  });

  test("keeps Fulfillment outside the Order-level completion action", () => {
    expect(isOrderShortcutCompletableProductionStation("roll")).toBe(true);
    expect(isOrderShortcutCompletableProductionStation("finishing")).toBe(true);
    expect(isOrderShortcutCompletableProductionStation("design")).toBe(false);
    expect(isOrderShortcutCompletableProductionStation("prepress")).toBe(false);
    expect(isOrderShortcutCompletableProductionStation("fulfillment")).toBe(false);
  });
});
