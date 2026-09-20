import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Order commercial financial repair command", () => {
  it("defaults to dry run and requires explicit production identity and apply attribution", () => {
    const repair = source("scripts/repair-order-commercial-financials.ts");

    expect(repair).toContain('const apply = process.argv.includes("--apply")');
    expect(repair).toContain('if (apply && !actorUserId)');
    expect(repair).toContain('environment.databaseRuntime !== "production-cloud" || environment.appRuntime !== "production"');
    expect(repair).toContain('dry run only; rerun with --apply and --actor-user-id');
  });

  it("uses the canonical persisted-line snapshot and transactional recalculator rather than hard-coded Order 20365 arithmetic", () => {
    const repair = source("scripts/repair-order-commercial-financials.ts");
    const taxService = source("server/services/orders/orderTaxCalculationService.ts");

    expect(repair).toContain("calculateEditableOrderFinancialSnapshot");
    expect(repair).toContain("recalculateEditableOrderFinancialsInTransaction");
    expect(repair).toContain("FOR UPDATE");
    expect(repair).not.toContain("445.25");
    expect(repair).not.toContain("460.00");
    expect(taxService).toContain("export async function calculateEditableOrderFinancialSnapshot");
    expect(taxService).toContain("total: totals.subtotal - discount + totals.taxAmount + shipping,");
  });
});
