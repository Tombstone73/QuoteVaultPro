/**
 * adminStorage.routes.ts
 *
 * Admin Storage Settings routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET  /api/admin/storage-settings
 *   POST /api/admin/storage-settings/validate
 *   PUT  /api/admin/storage-settings
 *   POST /api/admin/storage-settings/activate
 *
 * Placement: server/routes/adminStorage.routes.ts
 * Registered by: server/routes.ts via registerAdminStorageRoutes
 */

import type { Express } from "express";
import { fromZodError } from "zod-validation-error";
import { getRequestOrganizationId } from "../tenantContext";
import { organizationStorageSettingsService } from "../services/storage/OrganizationStorageSettingsService";

export function registerAdminStorageRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  app.get('/api/admin/storage-settings', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, error: 'No organization context' });
      }

      const settings = await organizationStorageSettingsService.getSettings(organizationId);
      return res.json({ success: true, data: settings });
    } catch (error: any) {
      console.error('[StorageSettings:GET] Error:', error);
      return res.status(500).json({ success: false, error: error?.message || 'Failed to fetch storage settings' });
    }
  });

  app.post('/api/admin/storage-settings/validate', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, error: 'No organization context' });
      }

      const validation = await organizationStorageSettingsService.validateRequest(organizationId, req.body ?? {});
      return res.json({ success: true, data: validation });
    } catch (error: any) {
      console.error('[StorageSettings:VALIDATE] Error:', error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, error: fromZodError(error).message });
      }
      return res.status(500).json({ success: false, error: error?.message || 'Failed to validate storage settings' });
    }
  });

  app.put('/api/admin/storage-settings', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, error: 'No organization context' });
      }

      const settings = await organizationStorageSettingsService.saveRequest(organizationId, req.body ?? {});
      return res.json({ success: true, data: settings });
    } catch (error: any) {
      console.error('[StorageSettings:PUT] Error:', error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, error: fromZodError(error).message });
      }
      return res.status(500).json({ success: false, error: error?.message || 'Failed to save storage settings' });
    }
  });

  app.post('/api/admin/storage-settings/activate', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, error: 'No organization context' });
      }

      const providerConfigId = typeof req.body?.providerConfigId === 'string' ? req.body.providerConfigId : '';
      if (!providerConfigId) {
        return res.status(400).json({ success: false, error: 'providerConfigId is required' });
      }

      const settings = await organizationStorageSettingsService.activateProvider(organizationId, providerConfigId);
      return res.json({ success: true, data: settings });
    } catch (error: any) {
      console.error('[StorageSettings:ACTIVATE] Error:', error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, error: fromZodError(error).message });
      }
      return res.status(500).json({ success: false, error: error?.message || 'Failed to activate storage provider' });
    }
  });
}
