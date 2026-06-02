import {
  getPortalQuoteVisibilityReason,
  isPortalQuoteInCustomerScope,
  isPortalQuoteVisibleToCustomer,
  mapPortalQuoteStatus,
} from "../services/portal.service";

describe("portal quote status mapping", () => {
  test("maps visible quote states to customer-safe labels", () => {
    expect(mapPortalQuoteStatus({ status: "active" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "pending" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "pending_approval" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "accepted" })).toBe("Accepted");
    expect(mapPortalQuoteStatus({ status: "rejected" })).toBe("Declined");
    expect(mapPortalQuoteStatus({ status: "canceled" })).toBe("Unavailable");
    expect(mapPortalQuoteStatus({ status: "canceled", workflowStatus: "rejected" })).toBe("Declined");
    expect(mapPortalQuoteStatus({ status: "active", workflowStatus: "customer_revision_requested" })).toBe("Revision Requested");
    expect(mapPortalQuoteStatus({ status: "active", workflowStatus: "customer_approved" })).toBe("Accepted");
    expect(mapPortalQuoteStatus({ status: "mystery_internal_state" })).toBe("Under Review");
  });

  test("expired and converted states are clear without exposing internals", () => {
    expect(mapPortalQuoteStatus({ status: "active", validUntil: "2000-01-01T00:00:00.000Z" })).toBe("Expired");
    expect(mapPortalQuoteStatus({ status: "active", convertedToOrderId: "order_123" })).toBe("Converted to Order");
  });
});

describe("portal quote hydration visibility", () => {
  test("shows saved sent quotes for the logged-in portal customer", () => {
    expect(isPortalQuoteVisibleToCustomer({ status: "pending" })).toBe(true);
    expect(getPortalQuoteVisibilityReason({ status: "pending" })).toBe("sent");
    expect(isPortalQuoteVisibleToCustomer({ status: "active", workflowStatus: "pending_customer_approval" })).toBe(true);
    expect(getPortalQuoteVisibilityReason({ status: "active", workflowStatus: "pending_customer_approval" })).toBe("sent");
  });

  test("does not show draft or internal approval quotes by default", () => {
    expect(isPortalQuoteVisibleToCustomer({ status: "draft" })).toBe(false);
    expect(isPortalQuoteVisibleToCustomer({ status: "pending_approval" })).toBe(false);
    expect(isPortalQuoteVisibleToCustomer({ status: "active", workflowStatus: "staff_approved" })).toBe(false);
  });

  test("keeps customer-actioned and converted quotes visible as account history", () => {
    expect(isPortalQuoteVisibleToCustomer({ status: "active" })).toBe(true);
    expect(isPortalQuoteVisibleToCustomer({ status: "pending", workflowStatus: "customer_revision_requested" })).toBe(true);
    expect(isPortalQuoteVisibleToCustomer({ status: "active", workflowStatus: "customer_approved" })).toBe(true);
    expect(isPortalQuoteVisibleToCustomer({ status: "canceled" })).toBe(true);
    expect(isPortalQuoteVisibleToCustomer({ status: "canceled", workflowStatus: "rejected" })).toBe(true);
    expect(isPortalQuoteVisibleToCustomer({ status: "active", convertedToOrderId: "order_123" })).toBe(true);
  });

  test("filters quotes by tenant and customer scope, not contact ownership", () => {
    const scope = { organizationId: "org_1", customerId: "cust_1" };

    expect(isPortalQuoteInCustomerScope({ organizationId: "org_1", customerId: "cust_1" }, scope)).toBe(true);
    expect(isPortalQuoteInCustomerScope({ organizationId: "org_1", customerId: "cust_2" }, scope)).toBe(false);
    expect(isPortalQuoteInCustomerScope({ organizationId: "org_2", customerId: "cust_1" }, scope)).toBe(false);
  });
});
