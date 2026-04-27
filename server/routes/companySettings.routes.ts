/**
 * companySettings.routes.ts
 *
 * Company Settings routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET   /api/company-settings
 *   POST  /api/company-settings
 *   PATCH /api/company-settings/:id
 *
 * Placement: server/routes/companySettings.routes.ts
 * Registered by: server/routes.ts via registerCompanySettingsRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { insertCompanySettingsSchema, updateCompanySettingsSchema } from "@shared/schema";

export function registerCompanySettingsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = middleware;

  // Company Settings routes
  app.get("/api/company-settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getCompanySettings(organizationId);
      if (!settings) {
        return res.status(404).json({ message: "Company settings not found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.post("/api/company-settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = insertCompanySettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...settingsWithoutOrgId } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.createCompanySettings(organizationId, settingsWithoutOrgId);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating company settings:", error);
      res.status(500).json({ message: "Failed to create company settings" });
    }
  });

  app.patch("/api/company-settings/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = updateCompanySettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...updateData } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.updateCompanySettings(organizationId, req.params.id, updateData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });
}
