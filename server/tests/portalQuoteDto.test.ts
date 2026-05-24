import { mapPortalQuoteStatus } from "../services/portal.service";

describe("portal quote status mapping", () => {
  test("maps visible quote states to customer-safe labels", () => {
    expect(mapPortalQuoteStatus({ status: "active" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "pending" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "pending_approval" })).toBe("Ready for Review");
    expect(mapPortalQuoteStatus({ status: "accepted" })).toBe("Accepted");
    expect(mapPortalQuoteStatus({ status: "rejected" })).toBe("Declined");
    expect(mapPortalQuoteStatus({ status: "canceled" })).toBe("Unavailable");
    expect(mapPortalQuoteStatus({ status: "mystery_internal_state" })).toBe("Under Review");
  });

  test("expired and converted states are clear without exposing internals", () => {
    expect(mapPortalQuoteStatus({ status: "active", validUntil: "2000-01-01T00:00:00.000Z" })).toBe("Expired");
    expect(mapPortalQuoteStatus({ status: "active", convertedToOrderId: "order_123" })).toBe("Converted to Order");
  });
});
