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

  test("keeps fulfillment and Combined Run ownership out of the shortcut", async () => {
    const route = await source("server/routes/orders.routes.ts");

    expect(route).toContain('!== "fulfillment"');
    expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
    expect(route).toContain("PRODUCTION_PREREQUISITE_NOT_READY");
    expect(route).toContain("PRODUCTION_OWNERSHIP_CONFLICT");
  });
});
