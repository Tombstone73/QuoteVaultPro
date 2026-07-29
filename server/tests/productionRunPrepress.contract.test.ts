import fs from "node:fs";
import path from "node:path";

describe("prepress production run creation contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");

  test("exposes a dedicated prepress endpoint without replacing the existing create-run route", () => {
    expect(routes).toContain('app.post("/api/production/runs"');
    expect(routes).toContain('app.post("/api/production/runs/prepress"');
    expect(routes).toContain("createPrepressProductionRun");
    expect(routes).toContain("createProductionRun");
  });

  test("prepress creation routes selected line items and creates run membership transactionally", () => {
    expect(service).toContain("export async function createPrepressProductionRun");
    expect(service).toContain("return db.transaction(async (tx)");
    expect(service).toContain("transitionLineItemWorkflowState(tx");
    expect(service).toContain("toState: \"ready_for_production\"");
    expect(service).toContain("createProductionRunInTransaction(tx");
  });

  test("prepress creation keeps core eligibility and allocation guards", () => {
    expect(service).toContain("PRODUCTION_RUN_DUPLICATE_MEMBER");
    expect(service).toContain("PRODUCTION_RUN_MEMBER_INELIGIBLE");
    expect(service).toContain("PRODUCTION_RUN_FINAL_FILE_REQUIRED");
    expect(service).toContain("PRODUCTION_RUN_ALLOCATION_INVALID");
    expect(service).toContain("inArray(lineItemFiles.lineItemId, uniqueLineItemIds)");
  });
});
