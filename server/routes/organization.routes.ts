/**
 * organization.routes.ts
 *
 * Organization Management, Organization Preferences, List Settings,
 * and Org Danger Zone routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/organizations
 *   POST   /api/organizations/:id/set-default
 *
 *   GET    /api/organization/current
 *   GET    /api/organization/preferences
 *   PUT    /api/organization/preferences
 *   PATCH  /api/organization/preferences/inventory-policy
 *
 *   GET    /api/list-settings/:listKey
 *   PUT    /api/list-settings/:listKey
 *
 *   POST   /api/admin/org/reset
 *   POST   /api/admin/org/disable
 *   DELETE /api/admin/org
 *
 * Placement: server/routes/organization.routes.ts
 * Registered by: server/routes.ts via registerOrganizationRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { organizations, auditLogs, listSettings } from "@shared/schema";
import {
  getRequestOrganizationId,
  getUserOrganizations,
  setDefaultOrganization,
} from "../tenantContext";
import { resolveInventoryPolicyFromOrgPreferences } from "@shared/inventoryPolicy";
import {
  mergeInventoryPolicyIntoPreferences,
  normalizeInventoryPolicyPatch,
} from "@shared/inventoryPolicyPreferences";
import { resolveQuickBooksPreferencesFromOrgPreferences } from "@shared/quickBooksPreferences";
import { resolveMaterialsOverrideModeFromOrgPreferences } from "@shared/materialsOverrideMode";
import { resolveBillingInvoiceTriggerPolicyFromOrgPreferences } from "@shared/billingInvoicePolicy";
import { resolveProofApprovalLockEnabledFromOrgPreferences, resolveProofingPolicyFromOrgPreferences } from "@shared/proofApprovalLock";
import {
  inboundEmailIntakeSettingsPatchSchema,
  resolveInboundEmailIntakeSettingsFromPreferences,
} from "@shared/inboundEmailIntakeSettings";
import { inboundEmailIntakeSettingsService } from "../services/inboundEmailIntakeSettingsService";
import { resetTransactionalData, resetQuickBooksImportData } from "../services/orgResetService";
import { resolveFileUploadNamingPolicyFromPreferences } from "../prepressFileService";
import { hasOwnerOnlyAdminToolsRole } from "@shared/roleAccess";
import { resolveInvoiceSendAutomationPreferences } from "@shared/invoiceSendAutomation";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

const TITAN_GRAPHICS_ORGANIZATION_ID = "org_titan_001";

function resolveQuotePreferencesFromOrgPreferences(preferences: unknown, organizationId: string) {
  const rawQuotes = (preferences as any)?.quotes;
  const quotes = rawQuotes && typeof rawQuotes === "object" ? rawQuotes : {};
  return {
    ...quotes,
    savedQuotesVisibleInPortalByDefault:
      typeof quotes.savedQuotesVisibleInPortalByDefault === "boolean"
        ? quotes.savedQuotesVisibleInPortalByDefault
        : organizationId === TITAN_GRAPHICS_ORGANIZATION_ID,
  };
}

export function registerOrganizationRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = middleware;
  const requireAdminToolsOwner = (req: any, res: any, next: any) => {
    const role = req.actorOrgRole ?? req.orgRole;
    if (hasOwnerOnlyAdminToolsRole(role)) return next();
    return res.status(403).json({ message: "Access denied. Organization Owner role required for Admin Tools." });
  };
  const adminToolsGuards = [isAuthenticated, tenantContext, requireOrgOwnerAdmin, requireAdminToolsOwner];

  // ============================================================
  // ORGANIZATION MANAGEMENT ROUTES (Multi-Tenant)
  // ============================================================

  // Get current user's organizations
  app.get('/api/organizations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const orgs = await getUserOrganizations(userId);
      res.json(orgs);
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  // Set default organization
  app.post('/api/organizations/:id/set-default', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      await setDefaultOrganization(userId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error setting default organization:", error);
      res.status(500).json({ message: "Failed to set default organization" });
    }
  });

  // Get current organization context (for debugging/verification)
  app.get('/api/organization/current', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!req.organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, req.organizationId))
        .limit(1);

      res.json(org);
    } catch (error) {
      console.error("Error fetching current organization:", error);
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  // Get organization preferences (from settings.preferences)
  app.get('/api/organization/preferences', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      // Only allow owners/admins to read preferences
      const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: "Only owners and admins can view preferences" });
      }

      const [org] = await db
        .select({
          settings: organizations.settings,
          prepressDefaultEnabled: organizations.prepressDefaultEnabled,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Extract preferences from settings.preferences, default to empty object
      const rawPreferences = (org.settings as any)?.preferences;
      const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};

      // Extract email templates from settings.emailTemplates
      const emailTemplates = (org.settings as any)?.emailTemplates || {};

      // Ensure stable defaults for inventory policy toggles
      const inventoryPolicy = resolveInventoryPolicyFromOrgPreferences(preferences);

      // Ensure stable defaults for QuickBooks preferences
      const quickBooks = resolveQuickBooksPreferencesFromOrgPreferences(preferences);
      const inboundEmail = resolveInboundEmailIntakeSettingsFromPreferences(preferences);

      const materialsOverrideMode = resolveMaterialsOverrideModeFromOrgPreferences(preferences);
      const fileUploadNaming = resolveFileUploadNamingPolicyFromPreferences(preferences, organizationId);
      const billingInvoiceTriggerPolicy = resolveBillingInvoiceTriggerPolicyFromOrgPreferences(preferences);
      const invoiceSendAutomation = resolveInvoiceSendAutomationPreferences(preferences);
      const quotePreferences = resolveQuotePreferencesFromOrgPreferences(preferences, organizationId);
      const rawProofing = (preferences as any)?.proofing && typeof (preferences as any).proofing === "object"
        ? (preferences as any).proofing
        : {};
      const proofing = {
        ...rawProofing,
        proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences(preferences),
        policy: resolveProofingPolicyFromOrgPreferences(preferences),
      };

      const rawBasic = (preferences as any)?.basic && typeof (preferences as any).basic === "object"
        ? (preferences as any).basic
        : {};

      res.json({
        ...(preferences as any),
        basic: {
          ...rawBasic,
          attachQuotePdfByDefault: rawBasic.attachQuotePdfByDefault !== false,
          attachOrderPdfByDefault: rawBasic.attachOrderPdfByDefault !== false,
        },
        quotes: quotePreferences,
        proofing,
        billingInvoiceTriggerPolicy,
        invoiceSendAutomation,
        fileUploadNaming,
        prepressDefaultEnabled: org.prepressDefaultEnabled,
        production: {
          ...(((preferences as any)?.production && typeof (preferences as any).production === "object") ? (preferences as any).production : {}),
          materialsOverrideMode,
        },
        inventoryPolicy,
        quickBooks,
        inboundEmail,
        emailTemplates,
      });
    } catch (error) {
      console.error("Error fetching organization preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Update organization preferences (merge into settings.preferences)
  app.put('/api/organization/preferences', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      // Only allow owners/admins to update preferences
      const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: "Only owners and admins can update preferences" });
      }

      const newPreferences = req.body;

      // Extract emailTemplates if present (will be stored at settings.emailTemplates)
      const { emailTemplates, prepressDefaultEnabled, ...otherPreferences } = newPreferences;

      // Get current settings
      const [org] = await db
        .select({
          settings: organizations.settings,
          prepressDefaultEnabled: organizations.prepressDefaultEnabled,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Merge new preferences into existing settings
      const currentSettings = (org.settings || {}) as any;
      const currentPreferences = (currentSettings.preferences && typeof currentSettings.preferences === "object")
        ? currentSettings.preferences
        : {};
      const nextPreferences = Object.keys(otherPreferences).length > 0 ? otherPreferences : currentPreferences;
      const updatedSettings = {
        ...currentSettings,
        preferences: nextPreferences,
        ...(emailTemplates && { emailTemplates }),
      };

      // Update organization settings
      await db
        .update(organizations)
        .set({
          settings: updatedSettings as any,
          ...(typeof prepressDefaultEnabled === "boolean" ? { prepressDefaultEnabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      res.json({
        success: true,
        preferences: nextPreferences,
        emailTemplates,
        prepressDefaultEnabled:
          typeof prepressDefaultEnabled === "boolean"
            ? prepressDefaultEnabled
            : org.prepressDefaultEnabled,
      });
    } catch (error) {
      console.error("Error updating organization preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  app.patch('/api/organization/preferences/inbound-email-intake', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, message: "No organization context" });
      }

      const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ success: false, message: "Only owners and admins can update inbound email intake settings" });
      }

      const patch = inboundEmailIntakeSettingsPatchSchema.parse(req.body ?? {});
      const updated = await inboundEmailIntakeSettingsService.updateSettings(organizationId, patch, {
        userId: getUserId(req.user) ?? null,
        userName: req.user?.email ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.get?.("user-agent") ?? null,
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message });
      }

      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      console.error("Error updating inbound email intake settings:", error);
      res.status(500).json({ success: false, message: "Failed to update inbound email intake settings" });
    }
  });

  // Safely patch ONLY the inventory policy preferences (does not overwrite other keys)
  app.patch('/api/organization/preferences/inventory-policy', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, message: "No organization context" });
      }

      // Only allow owners/admins to update preferences
      const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ success: false, message: "Only owners and admins can update preferences" });
      }

      const patchSchema = z
        .object({
          enabled: z.boolean().optional(),
          reservationsEnabled: z.boolean().optional(),
          mode: z.enum(["off", "advisory", "enforced"]).optional(),
          enforcementMode: z.enum(["off", "warn_only", "block_on_shortage"]).optional(),
          autoReserveOnApplyPbV2: z.boolean().optional(),
          autoReserveOnOrderConfirm: z.boolean().optional(),
          allowNegative: z.boolean().optional(),
        })
        .strict()
        .refine((obj) => Object.keys(obj).length > 0, {
          message: "At least one inventory policy field is required",
        })
        .superRefine((obj, ctx) => {
          if (
            typeof obj.enabled === "boolean" &&
            typeof obj.reservationsEnabled === "boolean" &&
            obj.enabled !== obj.reservationsEnabled
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "enabled and reservationsEnabled must match when both are provided",
              path: ["reservationsEnabled"],
            });
          }
        });

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        const message = fromZodError(parsed.error).toString();
        return res.status(400).json({ success: false, message });
      }

      // Load current settings
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      const currentSettings = (org.settings || {}) as any;
      const currentPreferences = (currentSettings as any)?.preferences || {};

      const normalized = normalizeInventoryPolicyPatch(parsed.data);
      const updatedPreferences = mergeInventoryPolicyIntoPreferences(currentPreferences, normalized.patch);

      // Update organization settings without clobbering unrelated settings keys
      const updatedSettings = {
        ...currentSettings,
        preferences: updatedPreferences,
      };

      await db
        .update(organizations)
        .set({
          settings: updatedSettings as any,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      // TODO(org-preferences-audit): add audit log event for org preference patches

      // Return canonical preferences payload (same shape as GET)
      const canonicalPreferences = {
        ...(updatedPreferences as any),
        inventoryPolicy: resolveInventoryPolicyFromOrgPreferences(updatedPreferences),
        quickBooks: resolveQuickBooksPreferencesFromOrgPreferences(updatedPreferences),
      };

      return res.json({
        success: true,
        data: canonicalPreferences,
        message: "Inventory policy updated",
        ...(normalized.warnings.length > 0 ? { meta: { warnings: normalized.warnings } } : {}),
      });
    } catch (error) {
      console.error("Error patching inventory policy:", error);
      return res.status(500).json({ success: false, message: "Failed to update inventory policy" });
    }
  });

  // ============================================================
  // List Settings (column visibility, order, custom labels, date format)
  // ============================================================

  app.get("/api/list-settings/:listKey", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "User ID not found" });
      const { listKey } = req.params;

      const [settings] = await db
        .select()
        .from(listSettings)
        .where(
          and(
            eq(listSettings.organizationId, organizationId),
            eq(listSettings.userId, userId),
            eq(listSettings.listKey, listKey)
          )
        )
        .limit(1);

      res.json({ settings: settings?.settingsJson || {} });
    } catch (error) {
      console.error("Error fetching list settings:", error);
      res.status(500).json({ message: "Failed to fetch list settings" });
    }
  });

  app.put("/api/list-settings/:listKey", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const { listKey } = req.params;
      const { settings } = req.body;

      const [updated] = await db
        .insert(listSettings)
        .values({
          organizationId,
          userId,
          listKey,
          settingsJson: settings,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [listSettings.organizationId, listSettings.userId, listSettings.listKey],
          set: {
            settingsJson: settings,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json({ success: true, settings: updated.settingsJson });
    } catch (error) {
      console.error("Error updating list settings:", error);
      res.status(500).json({ message: "Failed to update list settings" });
    }
  });

  // ============================================================
  // DANGER ZONE: Organization Reset/Disable/Delete (Stubs)
  // ============================================================

  /**
   * POST /api/admin/org/reset
   * Reset organization transactional data (orders, invoices, quotes, production records).
   * Preserves organization, users, products, materials, pricing, OAuth, and all config.
   * Requires owner role.
   */
  app.post("/api/admin/org/reset", ...adminToolsGuards, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);

      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }

      const result = await resetTransactionalData(organizationId, userId);
      return res.json(result);
    } catch (error: any) {
      console.error("[Org Reset] Error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to reset organization transactional data",
      });
    }
  });

  /**
   * POST /api/admin/org/reset-quickbooks-import
   * Selectively remove QuickBooks-imported data without wiping other tenant data.
   * Optional body: { disconnectOAuth?: boolean, deleteQBCustomers?: boolean }
   * Preserves org, users, products, materials, and QB OAuth by default.
   * Requires owner role.
   */
  app.post("/api/admin/org/reset-quickbooks-import", ...adminToolsGuards, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);

      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }

      const bodySchema = z.object({
        disconnectOAuth: z.boolean().default(false),
        deleteQBCustomers: z.boolean().default(true),
      });

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: fromZodError(parsed.error).message,
        });
      }

      const result = await resetQuickBooksImportData(organizationId, userId, parsed.data);
      return res.json(result);
    } catch (error: any) {
      console.error("[QB Import Reset] Error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to reset QuickBooks import data",
      });
    }
  });

  /**
   * POST /api/admin/org/disable
   * Disable organization - prevents non-admin access.
   * Organization remains in system.
   * Requires owner role.
   */
  app.post("/api/admin/org/disable", ...adminToolsGuards, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);

      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId,
        actionType: "org.disable.requested",
        entityType: "organization",
        entityId: organizationId,
        description: "Organization disable requested",
        newValues: {},
      });

      // Return 501 Not Implemented
      return res.status(501).json({
        code: "NOT_IMPLEMENTED",
        message: "Organization disable functionality is not yet implemented. Please contact system administrator.",
      });
    } catch (error: any) {
      console.error("[Org Disable] Error:", error);
      res.status(500).json({ message: error.message || "Failed to disable organization" });
    }
  });

  /**
   * DELETE /api/admin/org
   * Request organization deletion (sets pending_delete state).
   * Only org owner can request. Platform admin must finalize.
   * Requires owner role.
   */
  app.delete("/api/admin/org", ...adminToolsGuards, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);

      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }

      // Get current org state
      const [org] = await db
        .select({
          id: organizations.id,
          deleteState: organizations.deleteState,
          slug: organizations.slug,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Validate org is active (not already pending/deleted)
      if (org.deleteState !== 'active') {
        return res.status(409).json({
          code: "ORG_ALREADY_PENDING_DELETE",
          message: `Organization is already in ${org.deleteState} state`,
          deleteState: org.deleteState,
        });
      }

      // Extract optional reason from body
      const { reason } = req.body || {};

      // Update org to pending_delete state
      await db
        .update(organizations)
        .set({
          deleteState: 'pending_delete',
          deleteRequestedAt: new Date(),
          deleteRequestedByUserId: userId,
          deleteReason: reason || null,
        })
        .where(eq(organizations.id, organizationId));

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId,
        actionType: "org.delete.requested",
        entityType: "organization",
        entityId: organizationId,
        description: `Organization deletion requested${reason ? `: ${reason}` : ''}`,
        newValues: {
          deleteState: 'pending_delete',
          reason: reason || null,
        },
      });

      // Notify devs
      const { notifyDev } = await import('../services/devNotify');
      await notifyDev({
        eventName: 'org.delete.requested',
        priority: 'high',
        organizationId,
        userId,
        message: `Organization "${org.slug}" deletion requested by user ${userId}`,
        metadata: {
          orgId: organizationId,
          orgSlug: org.slug,
          reason: reason || 'No reason provided',
        },
      });

      return res.json({
        success: true,
        message: "Deletion request submitted. A platform administrator must finalize this action.",
        deleteState: 'pending_delete',
      });
    } catch (error: any) {
      console.error("[Org Delete Request] Error:", error);
      res.status(500).json({ message: error.message || "Failed to request organization deletion" });
    }
  });
}
