import { describe, expect, test } from "@jest/globals";
import { getProductWorkflowDefaults } from "../productWorkflowIntent";

describe("product workflow intent", () => {
  test("keeps normal printed products on the existing production workflow", () => {
    expect(getProductWorkflowDefaults({ workflowIntent: "standard_production", requiresProductionJob: true })).toEqual({
      intent: "standard_production",
      requiresDesign: undefined,
      requiresPrepress: undefined,
      requiresProofApproval: undefined,
      requiresProductionJob: true,
    });
  });

  test("fulfillment-only products suppress artwork and prepress defaults", () => {
    expect(getProductWorkflowDefaults({ workflowIntent: "fulfillment_only", requiresProductionJob: true })).toEqual({
      intent: "fulfillment_only",
      requiresDesign: false,
      requiresPrepress: false,
      requiresProofApproval: false,
      requiresProductionJob: false,
    });
  });
});
