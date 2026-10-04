import fs from "node:fs";
import path from "node:path";

describe("Order PBV2 material lookup regression", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
  const start = source.indexOf("async function evaluatePbv2SnapshotForProduct");
  const end = source.indexOf("\nfunction toChildItemProposalsWithIndexFromSnapshot", start);
  const evaluator = source.slice(start, end);

  test("uses the tenant-scoped materials table without shadowing its import", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(evaluator).not.toMatch(/\b(?:let|const|var)\s+materials\b/);
    expect(evaluator).toContain("id: materials.id");
    expect(evaluator).toContain(".from(materials)");
    expect(evaluator).toContain("eq(materials.organizationId, organizationId)");
    expect(evaluator).toContain("materials: materialEffects");
  });
});
