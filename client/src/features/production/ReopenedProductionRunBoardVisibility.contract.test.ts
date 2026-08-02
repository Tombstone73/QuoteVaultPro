import fs from "fs";
import path from "path";

describe("reopened Combined Run board visibility", () => {
  const root = process.cwd();
  const board = fs.readFileSync(path.join(root, "client/src/pages/production.tsx"), "utf8");
  const flatbed = fs.readFileSync(path.join(root, "client/src/features/production/views/FlatbedProductionView.tsx"), "utf8");
  const roll = fs.readFileSync(path.join(root, "client/src/features/production/views/RollProductionView.tsx"), "utf8");

  test("uses one canonical run query for both active tab counts and rendered board containers", () => {
    expect(board).toContain("useProductionRuns(");
    expect(board).toContain("const stationBoardItems");
    expect(board).toContain("...(stationRuns ?? []).map(productionRunToBoardItem)");
    expect(board).toContain("getProductionTabCountsWithRecentlyCompleted(stationBoardItems");
    expect(board).toContain("runs={stationRuns ?? []}");
  });

  for (const [name, source] of [["Flatbed", flatbed], ["Roll", roll]] as const) {
    test(`${name} renders supplied canonical containers and surfaces a visibility attention state`, () => {
      expect(source).toContain("const runs = props.runs.map(productionRunToBoardItem)");
      expect(source).toContain("props.runsError && tabJobs.length === 0");
      expect(source).toContain("Combined Run visibility needs attention");
    });
  }
});
