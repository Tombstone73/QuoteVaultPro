import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Work Value server contracts", () => {
  test("the completed-unsent category delegates to the Invoice list working set and its count/value aggregate", () => {
    const work = source("server/services/workValueService.ts");
    const invoices = source("server/invoicesService.ts");
    expect(work).toContain("listInvoicesPageForOrganization({");
    expect(work).toContain("...readyToFinalizeFilters");
    expect(work).toContain("completeSummaryPage.totalValueCents");
    expect(work).toContain("invoicePage.totalValueCents");
    expect(invoices).toContain("if (sendStatus === 'never_sent') return sql`${effectiveLastSentAt} is null`");
    expect(invoices).toContain("if (sendStatus === 'sent') return sql`${effectiveLastSentAt} is not null");
    expect(invoices).toContain("coalesce(sum(${invoices.totalCents}), 0)::bigint");
  });

  test("the API denies finance-read failures before tenant data reads", () => {
    const routes = source("server/routes/system.routes.ts");
    const dashboard = source("server/services/dashboardSummaryService.ts");
    expect(routes).toContain("app.get('/api/dashboard/work-value', isAuthenticated, tenantContext");
    expect(routes).toContain("if (!canReadFinance(req)) return res.status(403)");
    expect(routes).toContain("getWorkValuePage(organizationId");
    expect(routes).toContain("canReadFinance: canReadFinance(req)");
    expect(dashboard).toContain("if (canReadFinance) try {");
    expect(dashboard).toContain("const accountsReceivableReport = canReadFinance ?");
  });

  test("active work uses the same tenant-scoped Order-line query without production representation joins", () => {
    const active = source("server/services/activeProductionValueService.ts");
    const work = source("server/services/workValueService.ts");
    expect(work).toContain("listActiveProductionValueCandidates(organizationId)");
    expect(work).toContain("projectActiveProductionValueContributions(organizationId, candidates)");
    expect(active).toContain("eq(orders.organizationId, organizationId)");
    expect(active).not.toContain(".join(productionJobs");
    expect(active).not.toContain(".join(productionRuns");
  });
});
