import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("dashboard canonical metric contract", () => {
  test("counts only distinct Orders with ready quantity remaining for fulfillment", () => {
    const dashboard = source("server/services/dashboardSummaryService.ts");
    const fulfillment = source("server/services/fulfillment/repository.ts");
    expect(dashboard).toContain("countReadyForFulfillment(organizationId)");
    expect(fulfillment).toContain("row.remainingQuantity > 0 && row.readyWaitingQuantity > 0");
  });

  test("uses organization-local windows for shipment and canonical A/R remaining balance", () => {
    const dashboard = source("server/services/dashboardSummaryService.ts");
    expect(dashboard).toContain('paymentDateWindow("today", organizationTimezone, now)');
    expect(dashboard).toContain("summary.totalOutstandingCents");
    expect(dashboard).not.toContain("todayStartIso");
  });
});
