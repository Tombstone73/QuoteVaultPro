import { describe, expect, test } from "@jest/globals";
import { resolveFulfillmentLineReadiness } from "@shared/fulfillmentReadiness";

describe("canonical fulfillment line readiness", () => {
  test("treats a queued fulfillment handoff after completed production as eligible", () => {
    expect(resolveFulfillmentLineReadiness({ workflowState: "completed", lifecycleStatus: "complete", activeOwnerStationKey: "fulfillment", activeOwnerStatus: "queued" }))
      .toMatchObject({ eligible: true, status: "production_complete", label: "Production complete, awaiting fulfillment" });
  });

  test("does not let stale completed history override active non-fulfillment work", () => {
    expect(resolveFulfillmentLineReadiness({ workflowState: "in_production", lifecycleStatus: "in_production", activeOwnerStationKey: "flatbed", activeOwnerStatus: "queued" }))
      .toMatchObject({ eligible: false, status: "awaiting_production" });
  });
});
