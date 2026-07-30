import fs from "node:fs";
import path from "node:path";

describe("production run shared file lifecycle contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const prepressFileService = fs.readFileSync(path.join(root, "server/prepressFileService.ts"), "utf8");
  const localBridgeRoutes = fs.readFileSync(path.join(root, "server/routes/localBridge.routes.ts"), "utf8");

  test("exposes predictable run-owned file endpoints", () => {
    expect(routes).toContain('app.get("/api/production/runs/:runId/files"');
    expect(routes).toContain('app.post("/api/production/runs/:runId/files/upload"');
    expect(routes).toContain('app.post("/api/production/runs/:runId/files/:fileId/replace"');
    expect(routes).toContain('app.post("/api/production/runs/:runId/files/:fileId/retire"');
    expect(routes).toContain('app.get("/api/production/runs/:runId/files/:fileId/download"');
  });

  test("stores one shared final file on the production run without per-member duplication", () => {
    expect(service).toContain("productionRunId: run.id");
    expect(service).toContain("lineItemId: representative.orderLineItemId");
    expect(service).toContain("representativeLine.orderId");
    expect(service).not.toContain("run.members.map((member) => uploadLineItemFile");
    expect(prepressFileService).toContain("productionRunId?: string | null");
    expect(prepressFileService).toContain("productionRunId: productionRunId ?? null");
  });

  test("supports list, replace, retire, bridge safety, and replacement-required state", () => {
    expect(service).toContain("export async function listProductionRunFiles");
    expect(service).toContain("export async function replaceProductionRunFile");
    expect(service).toContain("export async function retireProductionRunFile");
    expect(service).toContain("LOCAL_BRIDGE_COPY_IN_PROGRESS");
    expect(service).toContain("status: \"superseded\"");
    expect(service).toContain("status: \"retired\"");
    expect(service).toContain("replacementRequired");
    expect(service).toContain("pendingBridgeJobsCanceled");
  });

  test("keeps audit and readiness boundaries explicit", () => {
    expect(service).toContain("Shared production run file uploaded");
    expect(service).toContain("Shared production run file replaced");
    expect(service).toContain("Shared production run file retired");
    expect(service).toContain("PRODUCTION_RUN_FILE_REQUIRED");
    expect(service).toContain("Shared nested production file required before release.");
    expect(service).toContain("Upload or replace the shared nested final production file before completing this run.");
    expect(service).toContain("countActiveProductionRunFiles");
    expect(localBridgeRoutes).toContain("Local Bridge copy completed for shared run file");
    expect(localBridgeRoutes).toContain("Local Bridge copy failed for shared run file");
  });
});
