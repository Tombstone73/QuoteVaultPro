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
  test("makes fulfillment-only quantities ready without a production prerequisite", () => {
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "fulfillment_only", requiresProductionJob: false, orderedQuantity: 7 }))
      .toMatchObject({ requiresFulfillment: true, productionRequired: false, eligibleQuantity: 7, blockedQuantity: 0, status: "ready" });
  });

  test("excludes billing-only service fees and bundle parent wrappers", () => {
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "service_fee", orderedQuantity: 1 }).requiresFulfillment).toBe(false);
    expect(resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", lineItemRole: "parent", orderedQuantity: 1 }).requiresFulfillment).toBe(false);
  });

  test("caps a partially produced line at its canonical successful quantity", () => {
    expect(resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production",
      requiresProductionJob: true,
      workflowState: "in_production",
      activeOwnerStationKey: "flatbed",
      activeOwnerStatus: "in_progress",
      orderedQuantity: 100,
      productionCompleteQuantity: 60,
    })).toMatchObject({ eligibleQuantity: 60, blockedQuantity: 40, remainingQuantity: 100, status: "partially_ready" });
  });

  test("keeps usable partial production available while the line remains in production", () => {
    const line = resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production", requiresProductionJob: true, workflowState: "in_production",
      activeOwnerStationKey: "flatbed", activeOwnerStatus: "in_progress", orderedQuantity: 1000,
      productionCompleteQuantity: 400, pickedUpQuantity: 150,
    });
    expect(line).toMatchObject({
      productionCompleteQuantity: 400, pickedUpQuantity: 150, fulfilledQuantity: 150,
      eligibleQuantity: 250, blockedQuantity: 600, remainingQuantity: 850, status: "partially_ready",
    });
  });

  test("does not turn a lifecycle-complete line into unproduced inventory", () => {
    expect(resolveFulfillmentLineQuantity({
      workflowIntent: "standard_production",
      requiresProductionJob: true,
      workflowState: "completed",
      lifecycleStatus: "complete",
      orderedQuantity: 1000,
      productionCompleteQuantity: 600,
    })).toMatchObject({
      productionCompleteQuantity: 600,
      eligibleQuantity: 600,
      blockedQuantity: 400,
      status: "partially_ready",
    });
  });

  test("shares the produced cap between shipment and pickup handoffs", () => {
    const line = resolveFulfillmentLineQuantity({ orderedQuantity: 400, productionCompleteQuantity: 400, shippedQuantity: 150, pickedUpQuantity: 100 });
    expect(line).toMatchObject({ fulfilledQuantity: 250, eligibleQuantity: 150, blockedQuantity: 0 });
  });

  test("subtracts prior shipped quantity and releases the remainder when production completes", () => {
    const partial = resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", orderedQuantity: 100, productionCompleteQuantity: 60, shippedQuantity: 60 });
    expect(partial).toMatchObject({ eligibleQuantity: 0, blockedQuantity: 40, remainingQuantity: 40 });
    const complete = resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", workflowState: "completed", lifecycleStatus: "complete", orderedQuantity: 100, productionCompleteQuantity: 100, shippedQuantity: 60 });
    expect(complete).toMatchObject({ eligibleQuantity: 40, blockedQuantity: 0, remainingQuantity: 40, status: "ready" });
  });

  test("summarizes mixed readiness independently from queue visibility", () => {
    const summary = summarizeFulfillmentOrderQuantities([
      resolveFulfillmentLineQuantity({ workflowIntent: "fulfillment_only", orderedQuantity: 1 }),
      resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", orderedQuantity: 1 }),
      resolveFulfillmentLineQuantity({ workflowIntent: "service_fee", orderedQuantity: 1 }),
    ]);
    expect(summary).toMatchObject({ physicalLineCount: 2, orderedQuantity: 2, eligibleQuantity: 1, blockedQuantity: 1, status: "PARTIALLY_READY" });
  });

  test("auto-packing and split allocations cannot exceed both ready and verified remainder", () => {
    const line = resolveFulfillmentLineQuantity({ workflowIntent: "standard_production", orderedQuantity: 100, productionCompleteQuantity: 60, shippedQuantity: 20 });
    expect(resolveFulfillmentAllocatableQuantity(line, 50)).toBe(30);
    expect(resolveFulfillmentAllocatableQuantity(line, 100)).toBe(40);
  });
});
