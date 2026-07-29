import fs from "node:fs";
import path from "node:path";

describe("mounted Prepress combined run file UI contract", () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  test("mounted Prepress page exposes a Combined Runs area and detail panel", () => {
    expect(source).toContain("Combined Runs");
    expect(source).toContain("Manage shared nested production files without leaving Prepress.");
    expect(source).toContain("useProductionRuns");
    expect(source).toContain("<ProductionRunPanel run={selectedCombinedRun}");
  });

  test("successful Prepress run creation opens the created run detail", () => {
    expect(source).toContain("const result = await createCombinedRunMutation.mutateAsync");
    expect(source).toContain("setSelectedCombinedRunId(createdRunId)");
    expect(source).toContain("setCombinedRunDetailOpen(true)");
    expect(source).toContain("is ready for shared file upload");
  });

  test("Prepress run discovery supports search, status, history, and attention filtering", () => {
    expect(source).toContain("productionRunNeedsPrepressAttention");
    expect(source).toContain("filterPrepressCombinedRuns");
    expect(source).toContain("combinedRunSearchQuery");
    expect(source).toContain("combinedRunStatusFilter");
    expect(source).toContain("combinedRunIncludeHistory");
    expect(source).toContain("Needs Prepress attention");
  });
});
