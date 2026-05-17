/**
 * operationalSummary.routes.ts
 *
 * Single endpoint that returns all sidebar operational badge counts.
 * One canonical aggregation call — sidebar consumes one payload.
 *
 *   GET /api/operational-summary
 *
 * Placement: server/routes/operationalSummary.routes.ts
 * Exported surface: registerOperationalSummaryRoutes
 */

import type { Express } from "express";
import { getRequestOrganizationId } from "../tenantContext";
import { computeOperationalSummary } from "../services/operationalSummary";

interface RouteMiddleware {
  isAuthenticated: any;
  tenantContext: any;
}

export function registerOperationalSummaryRoutes(
  app: Express,
  { isAuthenticated, tenantContext }: RouteMiddleware,
) {
  /**
   * GET /api/operational-summary
   *
   * Returns lightweight operational counts for the sidebar badges.
   * All counts are derived from existing canonical workflow state — read-only, no mutations.
   */
  app.get("/api/operational-summary", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ error: "Missing organization context" });
      }

      const summary = await computeOperationalSummary(organizationId);
      return res.json({ success: true, data: summary });
    } catch (error: any) {
      console.error("[OperationalSummary] Error computing operational summary:", error);
      return res.status(500).json({ error: error?.message || "Failed to compute operational summary" });
    }
  });
}
