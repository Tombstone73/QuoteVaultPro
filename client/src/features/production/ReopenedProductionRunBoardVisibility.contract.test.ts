import fs from "fs";
import path from "path";

describe("reopened Combined Run board visibility", () => {
  const root = process.cwd();
  const flatbed = fs.readFileSync(path.join(root, "client/src/features/production/views/FlatbedProductionView.tsx"), "utf8");
  const roll = fs.readFileSync(path.join(root, "client/src/features/production/views/RollProductionView.tsx"), "utf8");

  for (const [name, source] of [["Flatbed", flatbed], ["Roll", roll]] as const) {
    test(`${name} always fetches run containers when standalone jobs are injected`, () => {
      expect(source).toContain("useProductionRuns(");
      expect(source).toContain("{ enabled: true }");
      expect(source).toContain("const runs = (runData ?? []).map(productionRunToBoardItem)");
      expect(source).not.toContain("shouldFetchJobs ? (runData ?? []).map(productionRunToBoardItem) : []");
    });
  }
});
