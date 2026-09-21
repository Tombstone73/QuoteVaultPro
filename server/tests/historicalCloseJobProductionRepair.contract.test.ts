import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("historical Close Job repair is UUID-only, preview-first, and evidence-gated", () => {
  const service = read("server/services/historicalCloseJobProductionRepairService.ts");
  const script = read("scripts/historical-close-job-production-repair.ts");

  expect(service).toContain('eq(orders.id, orderId)');
  expect(service).toContain('found: false');
  expect(service).toContain('found: true');
  expect(service).not.toContain('.leftJoin(customers');
  expect(service).toContain('previewHistoricalCloseJobProductionRepair(database');
  expect(service).toContain('applyHistoricalCloseJobProductionRepair(database');
  expect(service).toContain('database.transaction');
  expect(service).toContain('clean(order.state) !== "production_complete"');
  expect(service).toContain("isProvenLegacyCloseJobOverrideEvidence");
  expect(service).toContain("ACTIVE_PRODUCTION_OWNER_CONFLICT");
  expect(service).toContain("ACTIVE_COMBINED_RUN_CONFLICT");
  expect(service).toContain('REPAIR_AUDIT_ACTION = "ORDER_HISTORICAL_CLOSE_JOB_PRODUCTION_REPAIRED"');
  expect(script).toContain('process.argv.includes("--apply")');
  expect(script).toContain("Public order numbers are not accepted");
  expect(script).toContain('drizzle-orm/node-postgres');
  expect(script).toContain('new Pool({ connectionString: databaseUrl })');
  expect(script).toContain('previewHistoricalCloseJobProductionRepair(repairDb');
  expect(script).toContain('applyHistoricalCloseJobProductionRepair(repairDb');
  expect(script).not.toContain('from "../server/db"');
});

test("the repair reuses canonical Close Job bootstrap but preserves the terminal parent", () => {
  const service = read("server/services/historicalCloseJobProductionRepairService.ts");
  const completion = read("server/routes/productionJobs.routes.ts");
  const ordersRoute = read("server/routes/orders.routes.ts");

  expect(service).toContain("bypassOrderProductionPrerequisites(tx");
  expect(service).toContain("closeJobOverride: true");
  expect(service).toContain("historicalRepairEvidence");
  expect(service).toContain('historicalTerminalRepair: { orderId: input.orderId }');
  expect(completion).toContain("if (!args.historicalTerminalRepair)");
  expect(completion).toContain("job.orderId !== args.historicalTerminalRepair.orderId");
  expect(ordersRoute).toContain("export async function bypassOrderProductionPrerequisites");
});
