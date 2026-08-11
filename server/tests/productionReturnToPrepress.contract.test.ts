import fs from "node:fs";
import path from "node:path";

describe("production Return to Prepress contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionReturnToPrepressService.ts"), "utf8");
  const jobsRoute = fs.readFileSync(path.join(root, "server/routes/productionJobs.routes.ts"), "utf8");
  const runService = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const runRoute = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "server/services/lineItemWorkflowService.ts"), "utf8");

  test("uses an all-or-nothing tenant-scoped transition and preserves historical run members", () => {
    expect(service).toContain("returnProductionJobsToPrepressInTransaction");
    expect(service).toContain("eq(productionJobs.organizationId, input.organizationId)");
    expect(service).toContain("inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES])");
    expect(service).toContain("coalesce(${productionRunMembers.remainingQuantity}, 0) > 0");
    expect(service).toContain('toState: "in_prepress"');
    expect(service).not.toContain("delete(productionRunMembers)");
  });

  test("blocks printing, paused, completed, and active-run jobs with explicit reasons", () => {
    expect(service).toContain('return "Currently printing"');
    expect(service).toContain('return "Production lock active"');
    expect(service).toContain('return "Completed job"');
    expect(service).toContain("RETURN_TO_PREPRESS_ACTIVE_RUN");
  });

  test("creates or reuses one active Prepress session and writes audit history", () => {
    expect(service).toContain("prepressSessions.status, \"active\"");
    expect(service).toContain("[RETURNED TO PREPRESS]");
    expect(service).toContain("Returned to Prepress from production board");
  });

  test("exposes the canonical bulk endpoint and makes legacy canceled-run reconciliation identify Prepress predecessors", () => {
    expect(jobsRoute).toContain('app.post("/api/production/jobs/return-to-prepress"');
    expect(jobsRoute).toContain("returnProductionJobsToPrepressInTransaction");
    expect(runService).toContain("prepressPredecessorIds");
    expect(runService).toContain("previousJobId");
  });

  test("keeps ordinary completed transitions terminal while allowing only explicit combined-run member recovery", () => {
    expect(workflow).toContain('Cannot transition terminal workflow state ${fromState}');
    expect(workflow).toContain("returnLineItemToPrepressForProductionRecovery");
    expect(workflow).toContain('allowTerminalRecovery: true');
    expect(runService).toContain("returnProductionRunMembersToPrepressInTransaction");
    expect(runService).toContain('recoveryDisposition: "return_to_prepress"');
    expect(runRoute).toContain('"/api/production/runs/:runId/return-selected-to-prepress"');
  });

  test("preserves completed quantities and historical run files during member recovery", () => {
    const memberRecovery = runService.slice(runService.indexOf("returnProductionRunMembersToPrepressInTransaction"), runService.indexOf("/** Return an entirely unproduced"));
    expect(memberRecovery).toContain("preservedHistoricalRun: true");
    expect(memberRecovery).not.toContain("successfulQuantity: 0");
    expect(memberRecovery).not.toContain("damagedQuantity: 0");
    expect(memberRecovery).not.toContain("delete(productionRunMembers)");
  });
});
