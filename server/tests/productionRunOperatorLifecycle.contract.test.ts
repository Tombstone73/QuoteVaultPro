import fs from "node:fs";
import path from "node:path";

describe("combined run operator lifecycle contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const panel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunPanel.tsx"), "utf8");

  it("normalizes invalid reopened production state from persisted starts", () => {
    expect(service).toContain("resolveCanonicalReopenedRunState");
    expect(service).toContain("status: canonicalReopenState.status");
    expect(service).toContain("status: canonical.status");
  });

  it("starts exactly the member jobs, supports pause and requires a machine for printer stations", () => {
    expect(service).toContain("PRODUCTION_RUN_MACHINE_REQUIRED");
    expect(service).toContain('status: "in_progress", startedAt: run.startedAt ?? now');
    expect(service).toContain('input.action === "start" && run.status === "in_production" && run.startedAt');
    expect(service).toContain("PRODUCTION_RUN_NOT_PAUSABLE");
    expect(routes).toContain('"pause"');
  });

  it("returns only an unproduced run to Prepress and preserves its history", () => {
    expect(service).toContain("export async function returnProductionRunToPrepress");
    expect(service).toContain("PRODUCTION_RUN_RETURN_RECOVERY_REQUIRED");
    expect(service).toContain('source: "combined_run_return_to_prepress"');
    expect(service).toContain('status: "canceled"');
    expect(routes).toContain("return-to-prepress");
  });

  it("preflights every member before mutation and provides an atomic canceled-run repair", () => {
    expect(service).toContain("const preflight = await Promise.all");
    expect(service).toContain("PRODUCTION_RUN_RETURN_OWNER_CONFLICT");
    expect(service).toContain("PRODUCTION_RUN_RETURN_DUPLICATE_PREPRESS_SESSION");
    expect(service).toContain("PRODUCTION_RUN_RETURN_MEMBER_BLOCKED");
    expect(service).toContain("completeCanceledProductionRunReturnToPrepress");
    expect(routes).toContain("complete-return-to-prepress");
  });

  it("renders an explicit operator next step, result workspace, and return action", () => {
    expect(panel).toContain("Current state:");
    expect(panel).toContain("Next:");
    expect(panel).toContain("Start Run");
    expect(panel).toContain("Resume Run");
    expect(panel).toContain("Return Run to Prepress");
    expect(panel).toContain("Production Results by Member");
    expect(panel).toContain("sticky bottom-3");
  });
});
