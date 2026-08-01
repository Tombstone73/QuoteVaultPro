import fs from "node:fs";
import path from "node:path";

describe("Flatbed Return to Prepress selection contract", () => {
  const root = process.cwd();
  const flatbed = fs.readFileSync(path.join(root, "client/src/features/production/views/FlatbedProductionView.tsx"), "utf8");
  const bulk = fs.readFileSync(path.join(root, "client/src/features/production/ProductionBulkActions.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");

  test("separates Return to Prepress eligibility from production grouping", () => {
    expect(flatbed).toContain("returnToPrepressEligibleJobs");
    expect(bulk).toContain("returnToPrepressEligibleJobs");
    expect(bulk).toContain("hasIncompatibleProductionSelection");
    expect(bulk).toContain("hasIncompatibleReturnSelection");
  });

  test("explains disabled selection and exposes a real bulk action", () => {
    expect(flatbed).toContain("selectionDisabledReason");
    expect(flatbed).toContain("returnToPrepressBlockedReason");
    expect(bulk).toContain("Return Selected to Prepress");
    expect(bulk).toContain("Return selected jobs to Prepress");
  });

  test("invalidates Flatbed, Prepress, runs, and navigation state after a return", () => {
    expect(hooks).toContain("useReturnProductionJobsToPrepress");
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/prepress/queue"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/production/runs"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  });
});
