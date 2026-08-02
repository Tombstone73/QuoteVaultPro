import fs from "fs";
import path from "path";

describe("legacy completed-production recovery", () => {
  const root = process.cwd();
  const runService = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const jobsRoute = fs.readFileSync(path.join(root, "server/routes/productionJobs.routes.ts"), "utf8");

  test("recovers a completed combined run without fabricating a normal undo window", () => {
    expect(runService).toContain("const legacyRecovery = memberJobs.some");
    expect(runService).toContain("PRODUCTION_RUN_REOPEN_ACTIVE_REPRINT");
    expect(runService).toContain("PRODUCTION_RUN_REOPEN_ACTIVE_RUN_CONFLICT");
    expect(runService).toContain("PRODUCTION_RUN_REOPEN_FULFILLMENT_STARTED");
    expect(runService).toContain("PRODUCTION_RUN_REOPEN_FULFILLMENT_IRREVERSIBLE");
    expect(runService).toContain("legacyRecovery, restoredMemberJobIds");
  });

  test("keeps a standalone legacy endpoint separate and rejects combined-run members", () => {
    expect(jobsRoute).toContain("recover-legacy-completion");
    expect(jobsRoute).toContain("COMBINED_RUN_RECOVERY_REQUIRED");
    expect(jobsRoute).toContain("Recovery is blocked by an active reprint request.");
    expect(jobsRoute).toContain("no_active_line_owner_before_restore");
  });
});
