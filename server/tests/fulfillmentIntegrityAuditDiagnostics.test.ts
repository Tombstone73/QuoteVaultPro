import { describe, expect, test } from "@jest/globals";
import { buildFulfillmentIntegrityTargetSummary } from "../services/fulfillment/integrityAuditDiagnostics";

describe("fulfillment integrity audit target diagnostics", () => {
  test("reports an existing healthy order even when it is not an anomaly", () => {
    expect(buildFulfillmentIntegrityTargetSummary({
      requestedOrderNumber: "20466",
      diagnostic: {
        found: true,
        requestedOrderNumber: "20466",
        reason: "FOUND",
        order: { id: "order-20466", orderNumber: "20466" },
        activeFulfillment: false,
      },
      audit: { legacyCloseJobOverrideCandidates: [] },
    })).toMatchObject({
      found: true,
      candidate: false,
      publicOrderNumber: "20466",
      activeFulfillment: false,
    });
  });

  test("does not confuse a public order number with a UUID", () => {
    expect(buildFulfillmentIntegrityTargetSummary({
      requestedOrderNumber: "20466",
      diagnostic: {
        found: true,
        requestedOrderNumber: "20466",
        reason: "FOUND",
        order: { id: "cde97f19-3ca9-4a60-a6c9-f569ae312678", orderNumber: "20466" },
      },
      audit: { legacyCloseJobOverrideCandidates: [{ order: { id: "cde97f19-3ca9-4a60-a6c9-f569ae312678" } }] },
    })).toMatchObject({ found: true, candidate: true, publicOrderNumber: "20466" });
  });

  test("reports a wrong organization as an explicit not-found target", () => {
    expect(buildFulfillmentIntegrityTargetSummary({
      requestedOrderNumber: "20466",
      diagnostic: { found: false, requestedOrderNumber: "20466", reason: "ORDER_NOT_FOUND_IN_SCOPE" },
      audit: { legacyCloseJobOverrideCandidates: [] },
    })).toEqual({
      requestedOrderNumber: "20466",
      found: false,
      candidate: false,
      reason: "ORDER_NOT_FOUND_IN_SCOPE",
    });
  });
});
