import type { Express } from "express";
import { z } from "zod";
import { insertPrinterProfileSchema, updatePrinterProfileSchema } from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function sendError(res: any, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, code: "PRINTER_PROFILE_VALIDATION_ERROR", error: "Invalid printer profile data", details: error.errors });
  }
  const status = (error as any)?.statusCode ?? (error as any)?.status ?? 500;
  if (status >= 500) console.error("[PRINTER PROFILES] Error:", error);
  return res.status(status).json({
    success: false,
    code: (error as any)?.code ?? (status === 404 ? "PRINTER_PROFILE_NOT_FOUND" : "PRINTER_PROFILE_ERROR"),
    error: (error as any)?.message ?? fallback,
  });
}

export function registerPrinterProfileRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner } = middleware;

  app.get("/api/printer-profiles", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const profiles = await storage.listPrinterProfiles(organizationId, {
        activeOnly: req.query.active === "true",
        intendedUse: typeof req.query.intendedUse === "string" ? req.query.intendedUse : undefined,
        printerType: typeof req.query.printerType === "string" ? req.query.printerType : undefined,
      });
      res.json({ success: true, data: profiles });
    } catch (error) {
      sendError(res, error, "Failed to list printer profiles");
    }
  });

  app.post("/api/printer-profiles", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const parsed = insertPrinterProfileSchema.parse(req.body);
      const created = await storage.createPrinterProfile(organizationId, parsed, getUserId(req.user));
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      sendError(res, error, "Failed to create printer profile");
    }
  });

  app.patch("/api/printer-profiles/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const parsed = updatePrinterProfileSchema.parse(req.body);
      const updated = await storage.updatePrinterProfile(organizationId, req.params.id, parsed, getUserId(req.user));
      res.json({ success: true, data: updated });
    } catch (error) {
      sendError(res, error, "Failed to update printer profile");
    }
  });

  app.post("/api/printer-profiles/:id/default", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const updated = await storage.setDefaultPrinterProfile(organizationId, req.params.id, getUserId(req.user));
      res.json({ success: true, data: updated });
    } catch (error) {
      sendError(res, error, "Failed to set default printer profile");
    }
  });

  app.post("/api/printer-profiles/:id/deactivate", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const updated = await storage.deactivatePrinterProfile(organizationId, req.params.id, getUserId(req.user));
      res.json({ success: true, data: updated });
    } catch (error) {
      sendError(res, error, "Failed to deactivate printer profile");
    }
  });

  app.delete("/api/printer-profiles/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const result = await storage.deletePrinterProfile(organizationId, req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      sendError(res, error, "Failed to delete printer profile");
    }
  });

  app.post("/api/printer-profiles/:id/used", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      await storage.markPrinterProfileUsed(organizationId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, "Failed to record printer use");
    }
  });
}
