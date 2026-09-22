import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveFulfillmentLineQuantity } from "@shared/fulfillmentReadiness";
import {
  filterActiveProductionOverviewFulfillmentJobs,
  isActiveProductionOverviewFulfillmentJob,
} from "../services/fulfillment/productionOverviewFulfillment";
import { countDistinctActiveProductionOverviewWork } from "../services/productionOverviewPopulation";

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
    const filterIndex = source.indexOf("await filterActiveProductionOverviewRows(");
    const hydrationIndex = source.indexOf("const jobIds = filteredRows.map");
    const population = readFileSync(path.join(process.cwd(), "server/services/productionOverviewPopulation.ts"), "utf8");
    expect(population).toContain("new FulfillmentDashboardRepo(executor).listLineEligibility");
    expect(filterIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeLessThan(hydrationIndex);
  });

  test("badge counts distinct active production lines and excludes fulfillment and history", () => {
    const rows = [
      { id: "print-owner", lineItemId: "line-1", stationKey: "roll", status: "in_progress" },
      { id: "duplicate", lineItemId: "line-1", stationKey: "finishing", status: "queued" },
      { id: "fulfillment", lineItemId: "line-2", stationKey: "fulfillment", status: "queued" },
      { id: "old", lineItemId: "line-3", stationKey: "roll", status: "done" },
    ];
    expect(countDistinctActiveProductionOverviewWork(rows)).toBe(1);
    expect(countDistinctActiveProductionOverviewWork(rows, false)).toBe(2);
    const summary = readFileSync(path.join(process.cwd(), "server/services/operationalSummary.ts"), "utf8");
    const route = readFileSync(path.join(process.cwd(), "server/routes/productionJobs.routes.ts"), "utf8");
    const hook = readFileSync(path.join(process.cwd(), "client/src/hooks/useProduction.ts"), "utf8");
    const overview = readFileSync(path.join(process.cwd(), "client/src/features/production/views/ProductionOverviewPage.tsx"), "utf8");
    expect(summary).toContain("filterActiveProductionOverviewRows(organizationId, candidates)");
    expect(summary).toContain("countDistinctActiveProductionOverviewWork(active, true)");
    expect(summary).toContain("lower(coalesce(${productionJobs.stationKey}, '')) <> 'fulfillment'");
    expect(route).toContain("productionOnly ? sql`lower(coalesce(${productionJobs.stationKey}, '')) <> 'fulfillment'`");
    expect(hook).toContain('params.set("productionOnly", "true")');
    expect(overview).toContain("useProductionJobs({ productionOnly: searchOnlyProduction })");
  });

  test("reserves card header regions and truncates long identity text", () => {
    const source = readFileSync(path.join(process.cwd(), "client/src/features/production/views/ProductionOverviewPage.tsx"), "utf8");
    expect(source).toContain("Customer and status have separate regions; the order lives below");
    expect(source).toContain("title={job.order.customerName}");
    expect(source).toContain("title={job.jobDescription || \"Untitled Job\"}");
    expect(source).toContain("title={`Order ${orderNumberLabel || job.order.orderNumber}`}");
  });
});
