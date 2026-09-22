import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveFulfillmentLineQuantity } from "@shared/fulfillmentReadiness";
import {
  filterActiveProductionOverviewFulfillmentJobs,
  isActiveProductionOverviewFulfillmentJob,
} from "../services/fulfillment/productionOverviewFulfillment";

const fulfilledBy = (input: { shipped?: number; administrativelyReconciled?: number; ordered?: number } = {}) =>
  resolveFulfillmentLineQuantity({
    workflowIntent: "standard_production",
    requiresProductionJob: true,
    workflowState: "completed",
    lifecycleStatus: "complete",
    activeOwnerStationKey: "fulfillment",
    orderedQuantity: input.ordered ?? 3,
    shippedQuantity: input.shipped ?? 0,
    administrativelyReconciledQuantity: input.administrativelyReconciled ?? 0,
  });

describe("Production Overview Fulfillment projection", () => {
  test("removes a line whose physical fulfillment reduces remaining quantity to zero", () => {
    const projection = fulfilledBy({ shipped: 3 });
    expect(isActiveProductionOverviewFulfillmentJob({ stationKey: "fulfillment", lineItemId: "physical" }, new Map([["physical", projection]]))).toBe(false);
  });

  test("removes a Close Job Override administrative reconciliation without requiring a shipment", () => {
    const projection = fulfilledBy({ administrativelyReconciled: 3 });
    expect(projection).toMatchObject({ fulfilledQuantity: 0, administrativelyReconciledQuantity: 3, remainingQuantity: 0 });
    expect(isActiveProductionOverviewFulfillmentJob({ stationKey: "fulfillment", lineItemId: "override" }, new Map([["override", projection]]))).toBe(false);
  });

  test("removes valid historical administrative reconciliation through the same durable quantity", () => {
    const historicalProjection = fulfilledBy({ administrativelyReconciled: 3 });
    const jobs = filterActiveProductionOverviewFulfillmentJobs([
      { id: "historical", stationKey: "fulfillment", lineItemId: "historical" },
      { id: "still-active", stationKey: "fulfillment", lineItemId: "active" },
    ], new Map([
      ["historical", historicalProjection],
      ["active", fulfilledBy({ administrativelyReconciled: 2 })],
    ]));
    expect(jobs.map((job) => job.id)).toEqual(["still-active"]);
  });

  test("keeps a genuine remaining fulfillment obligation regardless of parent terminal status", () => {
    const remainingProjection = fulfilledBy({ administrativelyReconciled: 1 });
    expect(remainingProjection.remainingQuantity).toBe(2);
    expect(isActiveProductionOverviewFulfillmentJob({ stationKey: "fulfillment", lineItemId: "remaining" }, new Map([["remaining", remainingProjection]]))).toBe(true);
  });

  test("does not let an unscoped fulfillment job inflate the active board", () => {
    expect(filterActiveProductionOverviewFulfillmentJobs([
      { id: "missing-line", stationKey: "fulfillment", lineItemId: null },
      { id: "roll", stationKey: "roll", lineItemId: "not-a-fulfillment-line" },
    ], new Map()).map((job) => job.id)).toEqual(["roll"]);
  });

  test("filters the Overview route before its expensive job hydration", () => {
    const source = readFileSync(path.join(process.cwd(), "server/routes/productionJobs.routes.ts"), "utf8");
    const canonicalProjectionIndex = source.indexOf("const fulfillmentLineItemIds");
    const filterIndex = source.indexOf("filteredRows = filterActiveProductionOverviewFulfillmentJobs(", canonicalProjectionIndex);
    const hydrationIndex = source.indexOf("const jobIds = filteredRows.map");
    expect(source).toContain("new FulfillmentDashboardRepo(db).listLineEligibility");
    expect(canonicalProjectionIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeLessThan(hydrationIndex);
  });

  test("reserves a dedicated grid cell for the card status and truncates long order labels", () => {
    const source = readFileSync(path.join(process.cwd(), "client/src/features/production/views/ProductionOverviewPage.tsx"), "utf8");
    expect(source).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]");
    expect(source).toContain("block max-w-full truncate text-xs font-medium");
  });
});
