import { readFileSync } from "node:fs";
import path from "node:path";
import { jest } from "@jest/globals";

await jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: jest.fn(() => "org-1") }));
const { createDailyProductionPdfHandler } = await import("../routes/dailyProductionReport.routes");

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
    expect(source).toContain('value === "fulfillment"');
    expect(source).toContain("res.status(400)");
    expect(source).toContain("generatePdf(report, view)");
  });

  test("forwards each valid view and rejects malformed views before loading dependencies", async () => {
    const report = { organizationName: "Titan", asOf: "2026-09-14" };
    const getReport = jest.fn(async () => report);
    const generatePdf = jest.fn(async () => new Uint8Array([1, 2, 3]));
    const loadDependencies = jest.fn(async () => ({ getReport, generatePdf, buildFilename: jest.fn(() => "daily.pdf") }));
    const handler = createDailyProductionPdfHandler(loadDependencies);
    const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn(), send: jest.fn() });

    for (const view of ["overview", "roll", "flatbed", "fulfillment"]) {
      const res = response();
      await handler({ query: { view } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }
    expect(generatePdf.mock.calls.map(([, view]: [unknown, string]) => view)).toEqual(["overview", "roll", "flatbed", "fulfillment"]);

    loadDependencies.mockClear();
    for (const view of [undefined, "breakdown", ["overview"], { value: "overview" }]) {
      const res = response();
      await handler({ query: { view } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    }
    expect(loadDependencies).not.toHaveBeenCalled();
  });
});
