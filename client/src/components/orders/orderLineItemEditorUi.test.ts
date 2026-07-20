import { describe, expect, it } from "@jest/globals";
import {
  getOrderLineItemActiveWorkWarning,
  getOrderLineItemEditorUiPolicy,
  getOrderLineItemSelectAllState,
  getSelectableProductionLineItemIds,
  toggleAllOrderLineItemSelections,
} from "./orderLineItemEditorUi";

describe("order line item editor UI policy", () => {
  it("selects and deselects every selectable line item", () => {
    const selectable = ["line-1", "line-2"];
    const selected = toggleAllOrderLineItemSelections(new Set(), selectable);
    expect(Array.from(selected)).toEqual(selectable);
    expect(getOrderLineItemSelectAllState(selected, selectable)).toBe(true);
    expect(Array.from(toggleAllOrderLineItemSelections(selected, selectable))).toEqual([]);
  });

  it("reports an indeterminate state when only some selectable items are selected", () => {
    expect(getOrderLineItemSelectAllState(new Set(["line-1"]), ["line-1", "line-2"])).toBe("indeterminate");
  });

  it("excludes canceled, fulfillment-only, and service lines from bulk production selection", () => {
    const products = [
      { id: "print", requiresProductionJob: true, workflowIntent: "standard_production" },
      { id: "fee", requiresProductionJob: false, workflowIntent: "service_fee" },
      { id: "fulfillment", requiresProductionJob: false, workflowIntent: "fulfillment_only" },
    ];
    expect(getSelectableProductionLineItemIds([
      { id: "line-1", productId: "print", status: "new" },
      { id: "line-2", productId: "print", status: "canceled" },
      { id: "line-3", productId: "fee", status: "new" },
      { id: "line-4", productId: "fulfillment", status: "new" },
    ], products)).toEqual(["line-1"]);
  });

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

  it("hides fulfillment routing overrides initially and keeps internal notes collapsed behind their indicator", () => {
    const policy = getOrderLineItemEditorUiPolicy({
      fulfillmentOnly: true,
      internalNoteCount: 1,
      requiresDesign: false,
      requiresPrepress: false,
      requiresProofApproval: false,
    });

    expect(policy.hideRoutingByDefault).toBe(true);
    expect(policy.internalNotesInitiallyOpen).toBe(false);
    expect(policy.operationsNotesLabel).toBe("Fulfillment Notes (internal)");
  });
});
