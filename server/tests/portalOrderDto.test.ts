import { mapPortalLineItemStatus, mapPortalOrderStatus } from "../services/portal.service";

describe("portal order status mapping", () => {
  test("maps internal order states to customer-safe labels", () => {
    expect(mapPortalOrderStatus({ state: "open", status: "new" })).toBe("Received");
    expect(mapPortalOrderStatus({ state: "open", status: "in_production" })).toBe("In Production");
    expect(mapPortalOrderStatus({ state: "production_complete", shippingMethod: "pickup" })).toBe("Ready for Pickup");
    expect(mapPortalOrderStatus({ state: "production_complete", shippingMethod: "ship" })).toBe("Ready to Ship");
    expect(mapPortalOrderStatus({ fulfillmentStatus: "shipped" })).toBe("Shipped");
    expect(mapPortalOrderStatus({ state: "closed" })).toBe("Completed");
    expect(mapPortalOrderStatus({ state: "mystery_state" })).toBe("In Progress");
  });

  test("proof action overrides vague in-progress order state safely", () => {
    expect(mapPortalOrderStatus({ state: "open", status: "in_production", proofActionRequired: true })).toBe(
      "Awaiting Proof Approval",
    );
  });

  test("maps line item status without exposing workflow internals", () => {
    expect(
      mapPortalLineItemStatus({
        status: "new",
        workflowState: "ready_for_production",
        requiresProofApproval: true,
        approvedProofVersionId: null,
      }),
    ).toBe("Awaiting Proof Approval");
    expect(
      mapPortalLineItemStatus({
        workflowState: "ready_for_production",
        requiresProofApproval: true,
        proofStatuses: ["revision_requested"],
      }),
    ).toBe("Revision Requested");
    expect(mapPortalLineItemStatus({ workflowState: "in_production" })).toBe("In Production");
    expect(mapPortalLineItemStatus({ workflowState: "unknown_internal_status" })).toBe("In Progress");
  });
});
