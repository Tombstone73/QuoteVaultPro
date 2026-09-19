import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Dashboard invoices-sent KPI contract", () => {
  test("uses durable canonical send checkpoints, tenant scope, and organization-local aggregate windows", () => {
    const service = source("server/services/dashboardSummaryService.ts");
    expect(service).toContain("getInvoicesSentDashboardMetrics");
    expect(service).toContain("invoices.lastSentAt");
    expect(service).toContain("eq(invoices.organizationId, input.organizationId)");
    expect(service).toContain("date_trunc(${unit}, ${localNow}) AT TIME ZONE ${input.timezone}");
    expect(service).toContain("sum(${invoices.totalCents})");
    expect(service).toContain('"void", "voided", "canceled", "cancelled"');
  });

  test("returns all three periods and defaults the selector to this week without another query", () => {
    const [hook, card] = [source("client/src/hooks/useDashboardSummary.ts"), source("client/src/components/dashboard/FulfillmentFinanceCard.tsx")];
    expect(hook).toContain("invoicesSent");
    expect(card).toContain('useState<"today" | "thisWeek" | "thisMonth">("thisWeek")');
    expect(card).toContain("Invoices sent period");
    expect(card).toContain("invoicesSent?.[sentPeriod]");
  });
});
