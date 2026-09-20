import { describe, expect, test } from "@jest/globals";
import {
  hasOutstandingCanonicalProductionObligations,
  isOrderShortcutCompletableProductionStation,
  listOrderProductionPrerequisitesToBypass,
  missingOwnerRepairState,
  projectCanonicalProductionObligations,
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
      workflowState: "needs_design", designStatus: "needs_design", requiresDesign: true,
      requiresProofApproval: true, requiresPrepress: true, approvedProofVersionId: null, activeStationKey: "design",
    })).toEqual(["Design", "Proof"]);
    expect(listOrderProductionPrerequisitesToBypass({
      workflowState: "ready_for_prepress", requiresPrepress: true, activeStationKey: "prepress",
    })).toEqual(["Prepress"]);
  });

  test("does not request an override for a real production owner", () => {
    expect(listOrderProductionPrerequisitesToBypass({
      workflowState: "in_production", designStatus: "design_complete", requiresDesign: true,
      requiresProofApproval: true, requiresPrepress: true, approvedProofVersionId: "proof-1", activeStationKey: "flatbed",
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

const physical = (id: string, workflowState = "new", lifecycleStatus = "new") => ({
  id,
  lineItemRole: "standalone",
  productionBypassed: false,
  requiresProductionJob: true,
  workflowIntent: "standard_production",
  workflowState,
  lifecycleStatus,
});

describe("canonical Order production obligations", () => {
  test("does not hand off a multi-line historical override until its final obligation completes", () => {
    const activeOwners = new Map<string, number>();
    const lines = [physical("line-1"), physical("line-2"), physical("line-3")];

    expect(hasOutstandingCanonicalProductionObligations(projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: activeOwners }))).toBe(true);
    lines[0] = physical("line-1", "completed", "complete");
    expect(hasOutstandingCanonicalProductionObligations(projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: activeOwners }))).toBe(true);
    lines[1] = physical("line-2", "completed", "complete");
    expect(hasOutstandingCanonicalProductionObligations(projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: activeOwners }))).toBe(true);
    lines[2] = physical("line-3", "completed", "complete");
    expect(hasOutstandingCanonicalProductionObligations(projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: activeOwners }))).toBe(false);
  });

  test("classifies mixed active and unowned physical lines independently", () => {
    const obligations = projectCanonicalProductionObligations({
      lines: [physical("active", "in_production", "in_progress"), physical("missing")],
      activeOwnerCountByLineItemId: new Map([["active", 1]]),
    });
    expect(obligations).toEqual([
      expect.objectContaining({ lineItemId: "active", state: "active_owner", activeOwnerCount: 1 }),
      expect.objectContaining({ lineItemId: "missing", state: "needs_bootstrap", activeOwnerCount: 0 }),
    ]);
  });

  test("does not treat canceled, service-fee, fulfillment-only, or parent structure lines as outstanding production", () => {
    const obligations = projectCanonicalProductionObligations({
      lines: [
        physical("canceled", "canceled", "canceled"),
        { ...physical("service"), workflowIntent: "service_fee", requiresProductionJob: false },
        { ...physical("fulfillment"), workflowIntent: "fulfillment_only", requiresProductionJob: false },
        { ...physical("parent"), lineItemRole: "parent" },
      ],
    });
    expect(hasOutstandingCanonicalProductionObligations(obligations)).toBe(false);
  });

  test("retains ownership-conflict and active-owner protections as incomplete obligations", () => {
    const obligations = projectCanonicalProductionObligations({
      lines: [physical("conflict", "in_production", "in_progress"), physical("active", "in_production", "in_progress")],
      activeOwnerCountByLineItemId: new Map([["conflict", 2], ["active", 1]]),
    });
    expect(obligations.map((item) => item.state)).toEqual(["ownership_conflict", "active_owner"]);
    expect(hasOutstandingCanonicalProductionObligations(obligations)).toBe(true);
  });
});
