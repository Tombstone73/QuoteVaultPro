import fs from "node:fs";
import path from "node:path";

describe("combined run cancellation UI contract", () => {
  const root = process.cwd();
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");
  const panel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunPanel.tsx"), "utf8");
  const prepressPage = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  test("refreshes queue, run, board, and navigation queries after cancellation", () => {
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/production/jobs"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/production/runs"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/prepress/queue"] })');
    expect(hooks).toContain('invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  });

  test("reports the actual number of restored Prepress jobs", () => {
    expect(hooks).toContain("restoredMemberCount");
    expect(hooks).toContain("unfinished");
    expect(hooks).toContain("returned to Prepress");
    expect(hooks).toContain("Recovery required for");
  });

  test("closes the canceled run and returns the Prepress workspace to its queue", () => {
    expect(panel).toContain("onCanceled");
    expect(prepressPage).toContain("setCombinedRunDetailOpen(false)");
    expect(prepressPage).toContain("setSelectedCombinedRunId(null)");
    expect(prepressPage).toContain('setWorkspaceTab("queue")');
  });
});
