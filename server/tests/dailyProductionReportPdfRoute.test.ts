import { readFileSync } from "node:fs";
import path from "node:path";

describe("Daily Production List PDF route contract", () => {
  const source = readFileSync(path.join(process.cwd(), "server/routes/dailyProductionReport.routes.ts"), "utf8");

  test("keeps the PDF generation lazy, authenticated, tenant-scoped, and DTO-backed", () => {
    expect(source).toContain('app.get("/api/reports/daily-production/pdf", isAuthenticated, tenantContext, createDailyProductionPdfHandler())');
    expect(source).toContain('import("../services/dailyProductionReport")');
    expect(source).toContain('import("../lib/dailyProductionReportPdf")');
    expect(source).toContain("getRequestOrganizationId(req)");
    expect(source).toContain("getReport(organizationId)");
    expect(source).toContain('res.setHeader("Content-Type", "application/pdf")');
    expect(source).toContain("Content-Disposition");
  });
});
