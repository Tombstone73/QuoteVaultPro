import { describe, expect, it, jest } from "@jest/globals";
import {
  getOrderLineItemActiveWorkWarning,
  buildOrderLineNumberMap,
  applyOrderLineItemReorder,
  buildOrderLineItemReorderPayload,
  buildOrderLineItemProductionActionRequests,
  getOrderLineItemEditorUiPolicy,
  getOrderLineItemSelectAllState,
  getLineItemWorkflowActionLabel,
  getGroupedOrderLineItemProductionActions,
  getProductionScheduleTargetIds,
  getSelectableProductionLineItemIds,
  getOrderLineItemProductionActions,
  isChildLineItem,
  resolveOrderLineItemOperationalDisplay,
  toggleAllOrderLineItemSelections,
  moveOrderLineItemIds,
  persistOrderLineItemReorder,
  sortOrderLineItemsByPersistedOrder,
} from "./orderLineItemEditorUi";

describe("order line item editor UI policy", () => {
  it("numbers line items from persisted sort order and updates after reorder", () => {
    const sorted = sortOrderLineItemsByPersistedOrder([
      { id: "line-b", sortOrder: 2 },
      { id: "line-a", sortOrder: 0 },
      { id: "line-c", sortOrder: 1 },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["line-a", "line-c", "line-b"]);
    expect(Object.fromEntries(buildOrderLineNumberMap(sorted.map((item) => item.id)))).toEqual({
      "line-a": 1,
      "line-c": 2,
      "line-b": 3,
    });
    expect(Object.fromEntries(buildOrderLineNumberMap(["line-b", "line-a", "line-c"]))).toEqual({
      "line-b": 1,
      "line-a": 2,
      "line-c": 3,
    });
  });

  it("moves line 6 above line 5 and builds the atomic persistence payload", () => {
    const reordered = moveOrderLineItemIds(
      ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6"],
      "line-6",
      "line-5",
    );

    expect(reordered).toEqual(["line-1", "line-2", "line-3", "line-4", "line-6", "line-5"]);
    expect(buildOrderLineItemReorderPayload(reordered)).toEqual({
      items: reordered.map((id, sortOrder) => ({ id, sortOrder })),
    });
    expect(Object.fromEntries(buildOrderLineNumberMap(reordered))).toMatchObject({
      "line-6": 5,
      "line-5": 6,
    });
  });

  it("hydrates line items in the persisted order returned by a reorder", () => {
    const entries = buildOrderLineItemReorderPayload(["line-2", "line-1"]).items;
    expect(applyOrderLineItemReorder([
      { id: "line-1", sortOrder: 0 },
      { id: "line-2", sortOrder: 1 },
    ], entries)).toEqual([
      { id: "line-2", sortOrder: 0 },
      { id: "line-1", sortOrder: 1 },
    ]);
  });

  it("sends the complete ordered ID and sort-value payload in one request", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, items: [
        { id: "line-2", sortOrder: 0 },
        { id: "line-1", sortOrder: 1 },
      ] }),
    })) as unknown as typeof fetch;

    await expect(persistOrderLineItemReorder("order-1", ["line-2", "line-1"], fetcher)).resolves.toEqual([
      { id: "line-2", sortOrder: 0 },
      { id: "line-1", sortOrder: 1 },
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/orders/order-1/line-items/reorder", expect.objectContaining({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ items: [
        { id: "line-2", sortOrder: 0 },
        { id: "line-1", sortOrder: 1 },
      ] }),
    }));
  });

  it("surfaces persistence errors so the editor can roll back its optimistic order", async () => {
    const fetcher = jest.fn(async () => ({
      ok: false,
      json: async () => ({ message: "Line items changed while reordering. Refresh and try again." }),
    })) as unknown as typeof fetch;

    await expect(persistOrderLineItemReorder("order-1", ["line-2", "line-1"], fetcher))
      .rejects.toThrow("Line items changed while reordering. Refresh and try again.");
  });
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

  it("excludes a line already owned by Flatbed from bulk production selection", () => {
    expect(getSelectableProductionLineItemIds([
      { id: "line-1", productId: "print", status: "new", activeOwnerJobId: "job-1", activeOwnerStationKey: "flatbed" },
    ], [{ id: "print", requiresProductionJob: true, workflowIntent: "standard_production" }])).toEqual([]);
  });

  it("uses a parent as the production control for its child lines", () => {
    const products = [{ id: "print", requiresProductionJob: true, workflowIntent: "standard_production" }];
    const lines = [
      { id: "parent", productId: "print", status: "new", lineItemRole: "parent" },
      { id: "child", productId: "print", status: "new", lineItemRole: "child", parentLineItemId: "parent" },
      { id: "standalone", productId: "print", status: "new", lineItemRole: "standalone" },
    ];

    expect(isChildLineItem(lines[1])).toBe(true);
    expect(getSelectableProductionLineItemIds(lines, products)).toEqual(["parent", "standalone"]);
    expect(getProductionScheduleTargetIds("parent", lines, products)).toEqual(["child"]);
    expect(getProductionScheduleTargetIds("child", lines, products)).toEqual([]);
    expect(getProductionScheduleTargetIds("standalone", lines, products)).toEqual(["standalone"]);
  });

  it("makes parent workflow labels explicit without changing standalone terminology", () => {
    expect(getLineItemWorkflowActionLabel("Send to Production", true)).toBe("Send Group to Production");
    expect(getLineItemWorkflowActionLabel("Return to Prepress", true)).toBe("Return Group to Prepress");
    expect(getLineItemWorkflowActionLabel("Bypass Production", false)).toBe("Bypass Production");
  });

  it("uses the active Flatbed job as the operational display authority", () => {
    expect(resolveOrderLineItemOperationalDisplay({
      workflowState: "ready_for_production",
      activeOwnerJobId: "job-1",
      activeOwnerStationKey: "flatbed",
      activeOwnerStatus: "in_progress",
    })).toEqual({
      statusLabel: "Flatbed in progress",
      nextStepLabel: "Flatbed in progress",
      ownerLabel: "Flatbed",
      isProductionOwned: true,
    });
  });

  it("derives production action eligibility from the active job status", () => {
    expect(getOrderLineItemProductionActions({ activeOwnerJobId: "job-1", activeOwnerStationKey: "flatbed", activeOwnerStatus: "queued" }))
      .toEqual(["start", "hold", "return_to_prepress"]);
    expect(getOrderLineItemProductionActions({ activeOwnerJobId: "job-1", activeOwnerStationKey: "flatbed", activeOwnerStatus: "paused" }))
      .toEqual(["resume", "return_to_prepress"]);
  });

  it("only exposes a group production action when every active child supports it", () => {
    expect(getGroupedOrderLineItemProductionActions([
      { activeOwnerJobId: "job-1", activeOwnerStationKey: "flatbed", activeOwnerStatus: "queued" },
      { activeOwnerJobId: "job-2", activeOwnerStationKey: "roll", activeOwnerStatus: "queued" },
    ])).toEqual(["start", "hold", "return_to_prepress"]);
    expect(getGroupedOrderLineItemProductionActions([
      { activeOwnerJobId: "job-1", activeOwnerStationKey: "flatbed", activeOwnerStatus: "queued" },
      { activeOwnerJobId: "job-2", activeOwnerStationKey: "roll", activeOwnerStatus: "paused" },
    ])).toEqual(["return_to_prepress"]);
  });

  it("routes production actions through the production and prepress workflow endpoints", () => {
    expect(buildOrderLineItemProductionActionRequests({ action: "start", lineItemId: "line-1", jobId: "job-1" }))
      .toEqual([{ url: "/api/production/jobs/job-1/start", method: "POST" }]);
    expect(buildOrderLineItemProductionActionRequests({ action: "hold", lineItemId: "line-1", jobId: "job-1" }))
      .toEqual([
        { url: "/api/production/jobs/job-1/stop", method: "POST" },
        { url: "/api/production/jobs/job-1/status", method: "PATCH", body: { status: "paused" } },
      ]);
    expect(buildOrderLineItemProductionActionRequests({ action: "return_to_prepress", lineItemId: "line-1", jobId: "job-1" })[0].url)
      .toBe("/api/production/line-item/line-1/send-to-prepress");
  });

  it("reflects hold and return-to-prepress owner updates without a page reload", () => {
    expect(resolveOrderLineItemOperationalDisplay({
      workflowState: "in_production",
      activeOwnerJobId: "job-1",
      activeOwnerStationKey: "flatbed",
      activeOwnerStatus: "paused",
    })).toMatchObject({ statusLabel: "Flatbed on hold", nextStepLabel: "Resume production" });

    expect(resolveOrderLineItemOperationalDisplay({
      workflowState: "completed",
      activeOwnerJobId: "fulfillment-job",
      activeOwnerStationKey: "fulfillment",
      activeOwnerStatus: "queued",
    })).toMatchObject({ statusLabel: "Production complete, awaiting fulfillment", nextStepLabel: "Prepare pickup or shipment" });

    expect(resolveOrderLineItemOperationalDisplay({
      workflowState: "in_prepress",
      activeOwnerJobId: "prepress-job",
      activeOwnerStationKey: "prepress",
      activeOwnerStepKey: "prepress",
      activeOwnerStatus: "queued",
    })).toMatchObject({ statusLabel: "In Prepress", nextStepLabel: "Finish prepress", isProductionOwned: false });
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
