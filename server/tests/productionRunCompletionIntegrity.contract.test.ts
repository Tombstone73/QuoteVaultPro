import fs from "fs";
import path from "path";

describe("combined production run completion integrity", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");

  test("requires a started run before automatic completion", () => {
    expect(service).toContain('if (run.status !== "in_production") throw new ProductionRunError("PRODUCTION_RUN_NOT_STARTED"');
    expect(service).toContain('input.action === "release"');
    expect(service).toContain('input.action === "start"');
    expect(service).toContain('status: "in_production", startedAt: run.startedAt ?? now');
  });

  test("routes fully completed members through the configured fulfillment route", () => {
    expect(service).toContain("routeCompletedRunMember");
    expect(service).toContain("resolveProductionCompletionRoute");
    expect(service).toContain("routeLineItemToProduction");
    expect(service).toContain("markCompletedRunOrdersReadyForFulfillment");
    expect(service).toContain("PRODUCTION_RUN_COMPLETION_ROUTE_MISSING");
  });

  test("exposes an admin-only, reasoned completion recovery endpoint", () => {
    expect(service).toContain("reopenCompletedProductionRun");
    expect(service).toContain("PRODUCTION_RUN_REOPEN_FULFILLMENT_STARTED");
    expect(routes).toContain("/api/production/runs/:runId/reopen-completed");
    expect(routes).toContain("Only an administrator may reopen a completed production run.");
    expect(service).toContain("repairCompletedProductionRunFulfillmentHandoff");
    expect(routes).toContain("repair-fulfillment-handoff");
  });
});
