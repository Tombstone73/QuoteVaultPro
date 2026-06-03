import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { auditLogs } from "@shared/schema";
import { aiProviderResolver } from "../services/ai/aiProviderResolver";
import { AiSettingsServiceError, aiSettingsService } from "../services/ai/aiSettingsService";

function getUserId(user: any): string | null {
  return user?.claims?.sub ?? user?.id ?? null;
}

function getUserEmail(user: any): string | null {
  return user?.email ?? user?.claims?.email ?? null;
}

function isOrgOwnerAdmin(req: any): boolean {
  const role = String(req.actorOrgRole ?? req.orgRole ?? "").toLowerCase();
  return role === "owner" || role === "admin";
}

function safeErrorPayload(error: unknown) {
  if (error instanceof AiSettingsServiceError) {
    return {
      statusCode: error.statusCode,
      payload: { success: false, code: error.code, message: error.message },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      statusCode: 400,
      payload: { success: false, code: "AI_SETTINGS_INVALID", message: error.errors.map((item) => item.message).join("; ") },
    };
  }
  return {
    statusCode: 500,
    payload: { success: false, code: "AI_SETTINGS_ERROR", message: "Failed to process AI settings request." },
  };
}

async function auditAiSettingsUpdate(req: any, orgId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: orgId,
      userId: getUserId(req.user),
      userName: getUserEmail(req.user),
      actionType: "UPDATE",
      entityType: "organization_ai_settings",
      entityId: orgId,
      entityName: "AI Settings",
      description: "Organization AI settings updated.",
      newValues: data,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
  } catch (error) {
    console.error("[AiFoundation] Failed to write AI settings audit log:", error);
  }
}

export function registerAiFoundationRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = middleware;

  app.get("/api/ai/capabilities", isAuthenticated, tenantContext, async (req: any, res) => {
    const orgId = getRequestOrganizationId(req);
    if (!orgId) return res.status(500).json({ success: false, message: "Missing organization context" });

    try {
      const canManageSettings = isOrgOwnerAdmin(req);
      const data = await aiProviderResolver.getCapabilities(orgId, {
        canManageSettings,
        canRunBugReview: canManageSettings,
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[AiFoundation] Failed to fetch capabilities:", error);
      return res.status(500).json({ success: false, code: "AI_CAPABILITIES_ERROR", message: "Failed to fetch AI capabilities." });
    }
  });

  app.get("/api/ai/settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    const orgId = getRequestOrganizationId(req);
    if (!orgId) return res.status(500).json({ success: false, message: "Missing organization context" });

    try {
      const data = await aiSettingsService.getSettings(orgId);
      return res.json({ success: true, data });
    } catch (error) {
      const safe = safeErrorPayload(error);
      console.error("[AiFoundation] Failed to fetch AI settings:", { code: safe.payload.code });
      return res.status(safe.statusCode).json(safe.payload);
    }
  });

  app.patch("/api/ai/settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    const orgId = getRequestOrganizationId(req);
    if (!orgId) return res.status(500).json({ success: false, message: "Missing organization context" });

    try {
      const data = await aiSettingsService.updateSettings(orgId, req.body);
      await auditAiSettingsUpdate(req, orgId, {
        mode: data.mode,
        provider: data.provider,
        model: data.model,
        isEnabled: data.isEnabled,
        hasApiKey: data.hasApiKey,
        features: data.features,
        monthlyUsageLimit: data.monthlyUsageLimit,
      });
      return res.json({ success: true, data });
    } catch (error) {
      const safe = safeErrorPayload(error);
      console.error("[AiFoundation] Failed to update AI settings:", { code: safe.payload.code });
      return res.status(safe.statusCode).json(safe.payload);
    }
  });
}
