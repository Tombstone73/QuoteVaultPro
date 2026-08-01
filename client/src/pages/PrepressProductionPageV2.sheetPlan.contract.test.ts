import fs from "node:fs";
import path from "node:path";

describe("Combined Run sheet-plan stale recovery contract", () => {
  const root = process.cwd();
  const page = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");

  test("retains wizard state and focuses plan review for a structured stale response", () => {
    expect(page).toContain("combinedRunSheetPlanStaleMessage");
    expect(page).toContain('setCombinedRunWizardStep(3)');
    expect(page).toContain("refreshPrepressQueue()");
    expect(page).toContain("refreshCombinedRunArtworkForLineItem");
    expect(page).toContain("Review the refreshed server-calculated plan before continuing.");
  });

  test("preserves response code and details from prepress run creation", () => {
    expect(hooks).toContain("details: json?.details ?? null");
    expect(hooks).toContain("code: json?.code");
  });
});
