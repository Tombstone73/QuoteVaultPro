import fs from "node:fs";
import path from "node:path";

describe("production run member recovery UI contract", () => {
  const root = process.cwd();
  const panel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunPanel.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useProduction.ts"), "utf8");

  test("supports selected-member recovery without replacing the whole-run action", () => {
    expect(panel).toContain("Return Selected to Prepress");
    expect(panel).toContain("Return {selectedReturnMemberIds.length} of {run.memberCount} members to Prepress?");
    expect(panel).toContain("Return Run to Prepress");
    expect(panel).toContain("selectedReturnMemberIds");
    expect(hooks).toContain("useReturnProductionRunMembersToPrepress");
    expect(hooks).toContain("return-selected-to-prepress");
  });
});
