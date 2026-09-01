import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Order Complete Production override contract", () => {
  const route = source("server/routes/orders.routes.ts");
  const completion = source("server/routes/productionJobs.routes.ts");
  const policy = source("server/services/orderProductionCompletionPolicy.ts");

  test("uses a side-effect-free preflight before confirmed bypass execution", () => {
    expect(route).toContain("listOrderProductionPrerequisitesToBypass");
    expect(route).toContain("bypasses.length > 0 && !confirmBypass");
    expect(route).toContain("PRODUCTION_BYPASS_CONFIRMATION_REQUIRED");
    expect(route).toContain("bypassesByLineId");
  });

  test("preserves canonical scope, active-run safety, and idempotency", () => {
    expect(route).toContain("requiresCanonicalProductionCompletion");
    expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
    expect(route).toContain("PRODUCTION_OWNERSHIP_CONFLICT");
    expect(route).toContain('order.state === "production_complete"');
    expect(route).toContain("markOrderReadyForFulfillmentIfProductionComplete");
    expect(route.indexOf("await assertNoActiveRunOwnsJobs(activeProductionJobs.map((job) => job.id))"))
      .toBeLessThan(route.indexOf("const stages = listOrderProductionPrerequisitesToBypass"));
  });

  test("records bypass provenance and avoids fabricated materials for manual work", () => {
    expect(route).toContain('source = "order_complete_production_override"');
    expect(route).toContain("production_prerequisites_bypassed");
    expect(route).toContain("ORDER_PRODUCTION_PREREQUISITES_BYPASSED");
    expect(route).toContain('designStatus: args.bypassedStages.includes("Design") ? "bypassed"');
    expect(completion).toContain("if (!manualOverride)");
    expect(completion).toContain("materialsConsumed: !manualOverride");
  });

  test("keeps an already-started production owner on normal completion semantics", () => {
    expect(policy).toContain("A real production-station owner means prior gates were already resolved");
    expect(policy).toContain('!["design", "prepress", "fulfillment"].includes(activeStation)');
    expect(completion).toContain('if (last?.type === "timer_started")');
  });

  test("requires an owner or administrator for the confirmed override", () => {
    expect(route).toContain("PRODUCTION_BYPASS_OVERRIDE_FORBIDDEN");
    expect(route).toContain("hasAdminOrOwnerOperationalRole(req)");
  });
});
