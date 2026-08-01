import fs from "node:fs";
import path from "node:path";

describe("combined production run cancellation contract", () => {
  const root = process.cwd();
  const lifecycle = fs.readFileSync(path.join(root, "shared/productionRunLifecycle.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const jobsRoute = fs.readFileSync(path.join(root, "server/routes/productionJobs.routes.ts"), "utf8");
  const runRoute = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const flatbed = fs.readFileSync(path.join(root, "client/src/features/production/views/FlatbedProductionView.tsx"), "utf8");
  const roll = fs.readFileSync(path.join(root, "client/src/features/production/views/RollProductionView.tsx"), "utf8");

  test("classifies only operational run states as active and requires unfinished member work", () => {
    expect(lifecycle).toContain('"draft"');
    expect(lifecycle).toContain('"ready_for_production"');
    expect(lifecycle).toContain('"in_production"');
    expect(lifecycle).toContain('"partially_completed"');
    expect(lifecycle).toContain("isUnfinishedProductionRunMember");
    expect(lifecycle).not.toContain('"canceled",');
  });

  test("hides standalone jobs only for active, unfinished run members", () => {
    expect(jobsRoute).toContain("ACTIVE_PRODUCTION_RUN_STATUSES");
    expect(jobsRoute).toContain("inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES])");
    expect(jobsRoute).toContain("coalesce(${productionRunMembers.remainingQuantity}, 0) > 0");
    expect(flatbed).toContain("useProductionJobs");
    expect(roll).toContain("useProductionJobs");
  });

  test("cancels unstarted prepress runs transactionally and preserves historical rows", () => {
    expect(service).toContain("restoreCanceledPrepressRunMembersInTransaction");
    expect(service).toContain('toState: "in_prepress"');
    expect(service).toContain('source: "combined_run_cancellation_recovery"');
    expect(service).toContain("[COMBINED RUN CANCELED]");
    expect(service).toContain("restoredMemberCount");
    expect(service).toContain("return db.transaction(async (tx)");
  });

  test("blocks started or partially completed runs from being reset by cancellation", () => {
    expect(service).toContain('run.status === "in_production" || run.status === "partially_completed"');
    expect(service).toContain("PRODUCTION_RUN_CANCEL_RECOVERY_REQUIRED");
    expect(service).toContain("PRODUCTION_RUN_RESTORE_REQUIRED");
  });

  test("provides an admin-only, idempotent repair path for legacy canceled runs", () => {
    expect(service).toContain("export async function reconcileCanceledProductionRun");
    expect(service).toContain("alreadyRestoredMemberCount");
    expect(service).toContain("memberResults");
    expect(service).toContain("activePrepressSessionCount");
    expect(service).toContain("duplicateActivePrepressSession");
    expect(service).toContain("reconciliationRequired");
    expect(runRoute).toContain('reconcile-canceled-members');
    expect(runRoute).toContain("actorIsAdmin(req)");
  });

  test("keeps run file history separate from cancellation recovery", () => {
    expect(service).toContain("productionRunId: run.id");
    expect(service).not.toContain("delete(productionRunMembers)");
    expect(service).not.toContain("delete(lineItemFiles)");
  });
});
