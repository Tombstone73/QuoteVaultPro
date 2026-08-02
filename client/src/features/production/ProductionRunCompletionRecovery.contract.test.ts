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
    expect(source).toContain("Recovery reason:");
    expect(source).toContain("Recovery reason");
    expect(hooks).toContain("useReopenCompletedProductionRun");
    expect(hooks).toContain("reopen-completed");
  });

  test("keeps active-run production controls visible and blocks completion before reconciled results", () => {
    expect(source).toContain("Production Results by Member");
    expect(source).toContain("Mark all run quantities good");
    expect(source).toContain("Complete blocked:");
    expect(source).toContain("Primary production file — PRINT THIS FILE");
    expect(source).toContain("Machine assignment");
    expect(source).toContain("Sheet progress");
    expect(source).toContain("sticky bottom-3");
  });
});
