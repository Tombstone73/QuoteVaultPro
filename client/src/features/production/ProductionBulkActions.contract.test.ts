import fs from "node:fs";
import path from "node:path";

describe("operation-aware production bulk action contract", () => {
  const root = process.cwd();
  const bulk = fs.readFileSync(path.join(root, "client/src/features/production/ProductionBulkActions.tsx"), "utf8");
  const flatbed = fs.readFileSync(path.join(root, "client/src/features/production/views/FlatbedProductionView.tsx"), "utf8");
  const roll = fs.readFileSync(path.join(root, "client/src/features/production/views/RollProductionView.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");
  const jobsRoute = fs.readFileSync(path.join(root, "server/routes/productionJobs.routes.ts"), "utf8");

  test("uses a persistent, explicit action bar with clear selection and precise confirmation lists", () => {
    expect(bulk).toContain("sticky bottom-3");
    expect(bulk).toContain("Clear selection");
    expect(bulk).toContain("Select all visible");
    expect(bulk).toContain("selectedVisibleCount");
    expect(bulk).toContain("SelectedJobsList");
  });

  test("keeps operation eligibility separate and provides Roll the same Return to Prepress affordance", () => {
    for (const source of [flatbed, roll]) {
      expect(source).toContain("allReturnToPrepressEligibleJobs");
      expect(source).toContain("selectionDisabledReason");
      expect(source).toContain("visibleReturnToPrepressEligibleJobs");
      expect(source).toContain("setBulkSelectedJobIds((current) => new Set(Array.from(current).filter");
    }
    expect(bulk).toContain("hasIncompatibleProductionSelection");
    expect(bulk).toContain("hasIncompatibleReturnSelection");
  });

  test("uses a single tenant-scoped server mutation for printer assignment", () => {
    expect(hooks).toContain("useBulkAssignProductionPrinter");
    expect(hooks).toContain('"/api/production/jobs/bulk-printer-assignment"');
    expect(jobsRoute).toContain('app.patch("/api/production/jobs/bulk-printer-assignment"');
    expect(jobsRoute).toContain('action: "bulk assign production printer"');
    expect(jobsRoute).toContain('type: "printer_assigned"');
    expect(jobsRoute).toContain("bulk_selection_owned_by_active_run");
  });
});
