import fs from "node:fs";
import path from "node:path";

describe("production run sheet-plan validation contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const plan = fs.readFileSync(path.join(root, "shared/combinedRunSheetPlan.ts"), "utf8");

  test("recomputes automatic plans from canonical inputs without trusting client output fields", () => {
    expect(service).toContain("hasMatchingCanonicalPlanInputs");
    expect(service).not.toContain("sameCalculatedPlan");
    expect(service).toContain("const calculated = snapshotCombinedRunSheetPlan(canonical)");
    expect(service).toContain("const plannedSheetCount = manualOverride ? overrideSheets : canonical.plannedSheetCount");
  });

  test("keeps material stale detection and manual override confirmation structured", () => {
    expect(service).toContain("describeStaleSheetPlan");
    expect(service).toContain("PRODUCTION_RUN_SHEET_PLAN_STALE");
    expect(service).toContain("PRODUCTION_RUN_SHEET_PLAN_OVERRIDE_STALE");
    expect(service).toContain("affectedMemberIds");
    expect(service).toContain("[production-run] sheet plan stale");
    expect(routes).toContain("details: error.details ?? null");
  });

  test("keeps file strategy and refresh metadata outside canonical layout identity", () => {
    expect(plan).toContain("canonicalItems(items)");
    expect(plan).toContain("COMBINED_RUN_SHEET_PLAN_CALCULATOR_VERSION");
    expect(plan).not.toContain("productionFileStrategy");
    expect(plan).not.toContain("thumbnail");
    expect(plan).not.toContain("signedUrl");
  });
});
