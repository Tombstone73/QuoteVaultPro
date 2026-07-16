import { describe, expect, it } from "@jest/globals";
import {
  getOrderLineItemActiveWorkWarning,
  getOrderLineItemEditorUiPolicy,
} from "./orderLineItemEditorUi";

describe("order line item editor UI policy", () => {
  it("does not show a stale prepress warning for a fulfillment item waiting to be picked", () => {
    expect(getOrderLineItemActiveWorkWarning({
      fulfillmentOnly: true,
      workflowState: "ready_for_production",
      hasActiveOwner: false,
    })).toBeNull();
  });

  it("uses a fulfillment-specific warning when pick/pack work is active", () => {
    expect(getOrderLineItemActiveWorkWarning({
      fulfillmentOnly: true,
      workflowState: "in_production",
      hasActiveOwner: true,
    })).toMatchObject({ title: "Active fulfillment work" });
  });

  it("keeps production controls visible for standard-production items", () => {
    const policy = getOrderLineItemEditorUiPolicy({
      fulfillmentOnly: false,
      internalNoteCount: 0,
      requiresDesign: false,
      requiresPrepress: true,
      requiresProofApproval: false,
    });

    expect(policy.hideRoutingByDefault).toBe(false);
    expect(policy.operationsNotesLabel).toBe("Production Notes (internal)");
  });

  it("hides fulfillment routing overrides initially but keeps existing internal notes open", () => {
    const policy = getOrderLineItemEditorUiPolicy({
      fulfillmentOnly: true,
      internalNoteCount: 1,
      requiresDesign: false,
      requiresPrepress: false,
      requiresProofApproval: false,
    });

    expect(policy.hideRoutingByDefault).toBe(true);
    expect(policy.internalNotesInitiallyOpen).toBe(true);
    expect(policy.operationsNotesLabel).toBe("Fulfillment Notes (internal)");
  });
});
