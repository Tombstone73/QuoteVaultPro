import type { Express } from "express";
import { getRequestOrganizationId } from "../tenantContext";
import type { DailyProductionReportView } from "@shared/dailyProductionReport";

type DailyProductionPdfDependencies = {
  getReport: (organizationId: string) => Promise<any>;
  generatePdf: (report: any, view: DailyProductionReportView) => Promise<Uint8Array>;
  buildFilename: (organizationName: string, asOf: string) => string;
};

async function loadDailyProductionPdfDependencies(): Promise<DailyProductionPdfDependencies> {
  const [reportService, pdf] = await Promise.all([
    import("../services/dailyProductionReport"),
    import("../lib/dailyProductionReportPdf"),
  ]);
  return {
    getReport: reportService.getDailyProductionReport,
    generatePdf: pdf.generateDailyProductionReportPdfBytes,
    buildFilename: pdf.buildDailyProductionReportPdfFilename,
  };
}

export function createDailyProductionPdfHandler(
  loadDependencies: () => Promise<DailyProductionPdfDependencies> = loadDailyProductionPdfDependencies,
) {
  return async (req: any, res: any) => {
    try {
      const view = req.query?.view;
      if (!pdfViewIsValid(view)) {
        return res.status(400).json({ success: false, error: "Invalid Daily Production report view" });
      }
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, error: "Missing organization context" });
      }
      const { getReport, generatePdf, buildFilename } = await loadDependencies();
      const report = await getReport(organizationId);
      const pdfBytes = await generatePdf(report, view);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `inline; filename="${buildFilename(report.organizationName, report.asOf)}"`);
      return res.status(200).send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error("[DailyProductionReportPdf] Failed to generate PDF:", error);
      return res.status(500).json({ success: false, error: "Failed to generate the Daily Production List PDF" });
    }
  };
}

function pdfViewIsValid(value: unknown): value is DailyProductionReportView {
  return value === "overview" || value === "roll" || value === "flatbed" || value === "fulfillment";
}

export function registerDailyProductionReportRoutes(
  app: Express,
  middleware: { isAuthenticated: any; tenantContext: any },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  app.get("/api/reports/daily-production", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, error: "Missing organization context" });
      }

      // Keep data-layer dependencies out of the global server bootstrap graph. A report
      // error is isolated to this read-only endpoint and cannot prevent login/API startup.
      const { getDailyProductionReport } = await import("../services/dailyProductionReport");
      return res.json({ success: true, data: await getDailyProductionReport(organizationId) });
    } catch (error) {
      console.error("[DailyProductionReport] Failed to build report:", error);
      return res.status(500).json({ success: false, error: "Failed to build the Daily Production List" });
    }
  });

  // Keep report/PDF dependencies behind this authenticated request boundary so a
  // report-generation error can never affect application startup or login.
  app.get("/api/reports/daily-production/pdf", isAuthenticated, tenantContext, createDailyProductionPdfHandler());
}
