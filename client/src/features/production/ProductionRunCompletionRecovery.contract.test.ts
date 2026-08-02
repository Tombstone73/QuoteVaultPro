import fs from "fs";
import path from "path";

describe("combined run completion recovery UI contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "client/src/features/production/ProductionRunPanel.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(process.cwd(), "client/src/hooks/useProduction.ts"), "utf8");

  test("keeps the normal release, start, complete sequence and exposes guarded recovery", () => {
    expect(source).toContain('if (runStatus === "draft") return "release"');
    expect(source).toContain('if (runStatus === "ready_for_production") return "start"');
    expect(source).toContain('if (runStatus === "in_production") return "complete"');
    expect(source).toContain("Reopen Mistaken Completion");
    expect(source).toContain("Recovery reason");
    expect(hooks).toContain("useReopenCompletedProductionRun");
    expect(hooks).toContain("reopen-completed");
  });
});
