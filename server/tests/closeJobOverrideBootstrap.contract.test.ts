import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("confirmed Close Job Override bootstraps a never-started owner inside canonical production completion", () => {
  const route = read("server/routes/orders.routes.ts");
  const completion = read("server/routes/productionJobs.routes.ts");

  expect(route).toContain("confirmProductionBootstrap");
  expect(route).toContain("PRODUCTION_BOOTSTRAP_CONFIRMATION_REQUIRED");
  expect(route).toContain("close_job_override_production_bootstrap");
  expect(route).toContain("productionBootstrap: true");
  expect(route).toContain("status: \"in_production\"");
  expect(route).toContain("await bypassOrderProductionPrerequisites(tx");
  expect(route).toContain("await completeProductionJobWorkflow(tx");
  expect(route).toContain("sourceInvoiceId: request.data.sourceInvoiceId ?? null");
  expect(completion).toContain("materialsConsumed: !manualOverride");
});

test("the administrative bootstrap retains canonical safety and idempotency guards", () => {
  const route = read("server/routes/orders.routes.ts");

  expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
  expect(route).toContain("PRODUCTION_OWNERSHIP_CONFLICT");
  expect(route).toContain('order.state === "production_complete"');
  expect(route).toContain("markOrderReadyForFulfillmentIfProductionComplete");
  expect(route).toContain("PRODUCTION_BYPASS_OVERRIDE_FORBIDDEN");
});
