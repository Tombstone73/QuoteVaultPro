import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order Complete Production canonical workflow contract", () => {
  test("delegates production completion to the canonical job workflow", async () => {
    const route = await source("server/routes/orders.routes.ts");
    const jobsRoute = await source("server/routes/productionJobs.routes.ts");

    expect(jobsRoute).toContain("export async function completeProductionJobWorkflow");
    expect(route).toContain("await completeProductionJobWorkflow(tx");
    expect(route).toContain('skipProduction: "auto"');
    expect(route).not.toContain("order_complete_production_auto_mark");
  });

  test("uses a confirmed prerequisite bypass without fabricating normal completion", async () => {
    const route = await source("server/routes/orders.routes.ts");
    const productionJobsRoute = await source("server/routes/productionJobs.routes.ts");

    expect(route).toContain('!== "fulfillment"');
    expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
    expect(route).toContain("PRODUCTION_BYPASS_CONFIRMATION_REQUIRED");
    expect(route).toContain("confirmBypass");
    expect(route).toContain("bypassOrderProductionPrerequisites");
    expect(route).toContain('status: "void"');
    expect(route).toContain("production_prerequisites_bypassed");
    expect(route).toContain("ORDER_PRODUCTION_PREREQUISITES_BYPASSED");
    expect(productionJobsRoute).toContain("manualOverride");
    expect(productionJobsRoute).toContain("materialsConsumed: !manualOverride");
  });

  test("keeps fulfillment and structural ownership safety intact", async () => {
    const route = await source("server/routes/orders.routes.ts");

    expect(route).toContain('!== "fulfillment"');
    expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
    expect(route).toContain("PRODUCTION_OWNERSHIP_CONFLICT");
    expect(route).toContain("markOrderReadyForFulfillmentIfProductionComplete");
  });
});
