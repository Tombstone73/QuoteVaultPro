import type { Express } from "express";
import { getRequestOrganizationId } from "../tenantContext";
import { getDailyProductionReport } from "../services/dailyProductionReport";

export function registerDailyProductionReportRoutes(
  app: Express,
  middleware: { isAuthenticated: any; tenantContext: any },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  app.get("/api/reports/daily-production", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      return res.json({ success: true, data: await getDailyProductionReport(organizationId) });
    } catch (error: any) {
      console.error("[DailyProductionReport] Failed to build report:", error);
      return res.status(500).json({ success: false, error: "Failed to build the Daily Production List" });
    }
  });
}
