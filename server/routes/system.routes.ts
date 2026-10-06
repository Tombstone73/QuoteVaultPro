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
import { getDashboardSummary, getLowInventoryDashboardItems } from "../services/dashboardSummaryService";
import { getAppEnv, getCookieDomain, getPublicWebOrigin } from "../lib/appRuntimeConfig";
import { getRuntimeEnvironmentSummary } from "../lib/runtimeEnvironment";
import { getRequestOrganizationId } from "../tenantContext";
import { canReadWorkValue } from "@shared/workValueAccess";
import { getWorkValuePage } from "../services/workValueService";
import type { WorkValueDuePreset, WorkValueStatus } from "../lib/workValueProjection";

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
  const canReadFinance = (req: any) => canReadWorkValue(req.orgRole);

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

      const data = await getDashboardSummary(organizationId, new Date(), { canReadFinance: canReadFinance(req) });
      return res.json({ success: true, data, message: 'Dashboard summary fetched' });
    } catch (error) {
      console.error('[DashboardSummary:GET] failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch dashboard summary' });
    }
  });

  app.get('/api/dashboard/work-value', isAuthenticated, tenantContext, async (req: any, res) => {
    if (!canReadFinance(req)) return res.status(403).json({ success: false, message: 'Financial access required' });
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
    const one = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const status = one(req.query.status) || 'active_production';
    const duePreset = one(req.query.duePreset) || 'all';
    const dateFrom = one(req.query.dateFrom);
    const dateTo = one(req.query.dateTo);
    const validDay = (value: string) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
    };
    const requestedPage = Number(one(req.query.page) || '1');
    if (!(['active_production', 'new', 'in_production', 'complete_not_sent'] as string[]).includes(status)
      || !(['all', 'today', 'tomorrow', 'this_week', 'overdue', 'custom'] as string[]).includes(duePreset)
      || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000
      || !validDay(dateFrom) || !validDay(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)
      || one(req.query.search).length > 200) return res.status(400).json({ success: false, message: 'Invalid Work Value filters' });
    try {
      const data = await getWorkValuePage(organizationId, {
        status: status as WorkValueStatus, duePreset: duePreset as WorkValueDuePreset,
        customerId: one(req.query.customerId) || undefined,
        dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
        search: one(req.query.search) || undefined, page: requestedPage,
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('[WorkValue:GET] failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch Work Value' });
    }
  });

  app.get('/api/dashboard/low-inventory', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, message: 'Missing organization context' });
      }

      const limit = Number(req.query?.limit ?? 25);
      const items = await getLowInventoryDashboardItems(organizationId, limit);
      return res.json({ success: true, data: { items }, message: 'Low inventory details fetched' });
    } catch (error) {
      console.error('[DashboardLowInventory:GET] failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch low inventory details' });
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
        environment: getRuntimeEnvironmentSummary({
          requestHost: req.get("host") ?? null,
          requestOrigin: req.get("origin") ?? null,
        }),
      });
    } catch (error: any) {
      console.error('[System Status] Error:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  });

  /**
   * GET /api/system/environment
   * Sanitized runtime summary for UI safety indicators.
   */
  app.get('/api/system/environment', isAuthenticated, async (req: any, res) => {
    try {
      res.json({
        success: true,
        data: getRuntimeEnvironmentSummary({
          requestHost: req.get("host") ?? null,
          requestOrigin: req.get("origin") ?? null,
        }),
      });
    } catch (error: any) {
      console.error('[System Environment] Error:', error);
      res.status(500).json({ success: false, message: 'Failed to get system environment' });
    }
  });
}
