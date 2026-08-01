import fs from "node:fs";
import path from "node:path";

describe("canceled Combined Run reconciliation UI contract", () => {
  const root = process.cwd();
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");
  const panel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunPanel.tsx"), "utf8");
  const prepress = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  test("uses the canonical authenticated reconciliation endpoint and refreshes operational views", () => {
    expect(hooks).toContain("useReconcileCanceledProductionRun");
    expect(hooks).toContain("reconcile-canceled-members");
    expect(hooks).toContain('method: "POST"');
    expect(hooks).toContain('credentials: "include"');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/production/runs"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/prepress/queue"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/orders"] })');
  });

  test("limits the repair action to admins with unfinished canceled-run members", () => {
    expect(panel).toContain("isAdminOrOwner");
    expect(panel).toContain('run.runStatus === "canceled"');
    expect(panel).toContain("unfinishedMembers.length > 0");
    expect(panel).toContain("Restore Members to Prepress");
  });

  test("confirms the run, members, station, and preserved files before repair", () => {
    expect(panel).toContain("Restore members to Prepress?");
    expect(panel).toContain("The canceled run and its files will remain in History.");
    expect(panel).toContain("Current run station:");
    expect(panel).toContain("Preserved run files:");
    expect(panel).toContain("Restore Members");
  });

  test("shows restored and skipped member outcomes with owner, destination, and session checks", () => {
    expect(panel).toContain("Canceled-run reconciliation result");
    expect(panel).toContain("Requires review:");
    expect(panel).toContain("finalWorkflowOwner");
    expect(panel).toContain("productionDestination");
    expect(panel).toContain("duplicateActivePrepressSession");
    expect(panel).toContain("No stranded members require reconciliation.");
  });

  test("keeps history available and offers navigation to the refreshed Prepress queue", () => {
    expect(panel).toContain("View Restored Jobs in Prepress");
    expect(prepress).toContain("onViewRestoredJobs");
    expect(prepress).toContain('setWorkspaceTab("queue")');
    expect(prepress).toContain('queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  });
});
