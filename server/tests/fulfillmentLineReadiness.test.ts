import { describe, expect, test } from "@jest/globals";
import { resolveFulfillmentAllocatableQuantity, resolveFulfillmentLineQuantity, resolveFulfillmentLineReadiness, summarizeFulfillmentOrderQuantities } from "@shared/fulfillmentReadiness";

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

describe("canonical fulfillment quantity projection", () => {
  test("requires a fulfillment confirmation instead of inferring readiness from production", () => {
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "fulfillment_only", requiresProductionJob: false, orderedQuantity: 7 }))
      .toMatchObject({ requiresFulfillment: true, productionRequired: false, readyWaitingQuantity: 0, notReadyQuantity: 7, status: "not_ready" });
  });

  test("excludes billing-only service fees and bundle parent wrappers", () => {
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "service_fee", orderedQuantity: 1 }).requiresFulfillment).toBe(false);
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", lineItemRole: "parent", orderedQuantity: 1 }).requiresFulfillment).toBe(false);
  });

  test("does not cap fulfillment readiness at reported production", () => {
    expect(resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production",
      requiresProductionJob: true,
      workflowState: "in_production",
      activeOwnerStationKey: "flatbed",
      activeOwnerStatus: "in_progress",
      orderedQuantity: 100,
      productionCompleteQuantity: 60, readyWaitingQuantity: 100,
    })).toMatchObject({ productionCompleteQuantity: 60, readyWaitingQuantity: 100, notReadyQuantity: 0, remainingQuantity: 100, status: "ready" });
  });

  test("tracks ready waiting separately from production while a line remains in production", () => {
    const line = resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production", requiresProductionJob: true, workflowState: "in_production",
      activeOwnerStationKey: "flatbed", activeOwnerStatus: "in_progress", orderedQuantity: 1000,
      productionCompleteQuantity: 400, pickedUpQuantity: 150, readyWaitingQuantity: 500,
    });
    expect(line).toMatchObject({
      productionCompleteQuantity: 400, pickedUpQuantity: 150, fulfilledQuantity: 150,
      readyWaitingQuantity: 500, notReadyQuantity: 350, remainingQuantity: 850, status: "partially_ready",
    });
  });

  test("keeps production reporting informational for a lifecycle-complete line", () => {
    expect(resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production",
      requiresProductionJob: true,
      workflowState: "completed",
      lifecycleStatus: "complete",
      orderedQuantity: 1000,
      productionCompleteQuantity: 600,
      readyWaitingQuantity: 1000,
    })).toMatchObject({
      productionCompleteQuantity: 600, readyWaitingQuantity: 1000, notReadyQuantity: 0, status: "ready",
    });
  });

  test("shares the fulfillment-ready pool between shipment and pickup handoffs", () => {
    const line = resolveFulfillmentLineQuantity({ orderedQuantity: 400, productionCompleteQuantity: 0, shippedQuantity: 150, pickedUpQuantity: 100, readyWaitingQuantity: 150 });
    expect(line).toMatchObject({ fulfilledQuantity: 250, readyWaitingQuantity: 150, notReadyQuantity: 0 });
  });

  test("never lets ready plus fulfilled exceed the order quantity", () => {
    const line = resolveFulfillmentLineQuantity({ orderedQuantity: 100, productionCompleteQuantity: 0, shippedQuantity: 60, readyWaitingQuantity: 100 });
    expect(line).toMatchObject({ readyWaitingQuantity: 40, notReadyQuantity: 0, remainingQuantity: 40, status: "ready" });
  });

  test("summarizes mixed readiness independently from queue visibility", () => {
    const summary = summarizeFulfillmentOrderQuantities([
      resolveFulfillmentLineQuantity({ workflowIntent: "fulfillment_only", orderedQuantity: 1, readyWaitingQuantity: 1 }),
      resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", orderedQuantity: 1, readyWaitingQuantity: 0 }),
      resolveFulfillmentLineQuantity({ workflowIntent: "service_fee", orderedQuantity: 1 }),
    ]);
    expect(summary).toMatchObject({ physicalLineCount: 2, orderedQuantity: 2, eligibleQuantity: 1, blockedQuantity: 1, status: "PARTIALLY_READY" });
  });

  test("auto-packing and split allocations cannot exceed ready and verified remainder", () => {
    const line = resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", orderedQuantity: 100, productionCompleteQuantity: 0, shippedQuantity: 20, readyWaitingQuantity: 40 });
    expect(resolveFulfillmentAllocatableQuantity(line, 50)).toBe(30);
    expect(resolveFulfillmentAllocatableQuantity(line, 100)).toBe(40);
  });
});
