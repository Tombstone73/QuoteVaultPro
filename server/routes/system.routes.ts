/**
 * system.routes.ts
 *
 * System/infrastructure route cluster extracted from server/routes.ts.
 *
 * Routes:
 *   GET /api/health           (no auth)
 *   GET /api/dashboard/summary
 *   GET /api/media
 *   POST /api/media
 *   DELETE /api/media/:id
 *   GET /api/system/status
 *
 * Placement: server/routes/system.routes.ts
 * Registered by: server/routes.ts via registerSystemRoutes
 */

import type { Express } from "express";
import { storage } from "../storage";
import { getDashboardSummary } from "../services/dashboardSummaryService";
import { getAppEnv, getCookieDomain, getPublicWebOrigin } from "../lib/appRuntimeConfig";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerSystemRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // Health check endpoint (no auth required)
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      env: getAppEnv(),
      publicWebOrigin: getPublicWebOrigin(),
      cookieDomain: getCookieDomain() ?? null,
      apiHost: req.get('host') ?? null,
      time: new Date().toISOString(),
    });
  });

  // Dashboard summary (KPI cards only, org-scoped)
  app.get('/api/dashboard/summary', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, message: 'Missing organization context' });
      }

      const data = await getDashboardSummary(organizationId);
      return res.json({ success: true, data, message: 'Dashboard summary fetched' });
    } catch (error) {
      console.error('[DashboardSummary:GET] failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch dashboard summary' });
    }
  });

  app.get("/api/media", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const assets = await storage.getAllMediaAssets(organizationId);
      res.json(assets);
    } catch (error) {
      console.error("Error fetching media assets:", error);
      res.status(500).json({ message: "Failed to fetch media assets" });
    }
  });

  app.post("/api/media", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { filename, url, fileSize, mimeType } = req.body;

      if (!filename || !url || fileSize === undefined || !mimeType) {
        return res.status(400).json({ message: "filename, url, fileSize, and mimeType are required" });
      }

      const userId = getUserId(req.user);
      const asset = await storage.createMediaAsset(organizationId, {
        filename,
        url,
        uploadedBy: userId!,
        fileSize,
        mimeType,
      });

      res.json(asset);
    } catch (error) {
      console.error("Error creating media asset:", error);
      res.status(500).json({ message: "Failed to create media asset" });
    }
  });

  app.delete("/api/media/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteMediaAsset(organizationId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting media asset:", error);
      res.status(500).json({ message: "Failed to delete media asset" });
    }
  });

  /**
   * GET /api/system/status
   * Get system status including feature flags
   */
  app.get('/api/system/status', isAuthenticated, async (req: any, res) => {
    try {
      const { isThumbnailGenerationEnabled } = await import('../services/thumbnailGenerator');
      res.json({
        thumbnailsEnabled: isThumbnailGenerationEnabled(),
      });
    } catch (error: any) {
      console.error('[System Status] Error:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  });
}
