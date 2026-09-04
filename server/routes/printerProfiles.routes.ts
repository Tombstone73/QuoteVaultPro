import type { Express } from "express";
import { z } from "zod";
import { insertPrinterProfileSchema, updatePrinterProfileSchema } from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { directPrintJobs, localBridgeAgents, orders, printerProfiles } from "@shared/schema";

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

  // Direct printing exposes only destination metadata. A browser never receives
  // a raw queue name and can submit only a tenant-owned profile id.
  app.get("/api/direct-print/traveler-destinations", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    const destinations = await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location, defaultCopies: printerProfiles.defaultCopies, trailingFeedMm: printerProfiles.trailingFeedMm, isDefault: printerProfiles.isDefault, agentId: printerProfiles.printAgentId, agentName: localBridgeAgents.name, lastSeenAt: localBridgeAgents.lastSeenAt, queueMapped: printerProfiles.windowsQueueName }).from(printerProfiles).leftJoin(localBridgeAgents, eq(printerProfiles.printAgentId, localBridgeAgents.id)).where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`));
    const now = Date.now();
    res.json({ success: true, data: destinations.map((item) => ({ ...item, available: Boolean(item.agentId && item.queueMapped && item.lastSeenAt && now - new Date(item.lastSeenAt).getTime() < 120000) })) });
  });

  app.post("/api/orders/:orderId/direct-print/traveler", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req); const orderId = String(req.params.orderId || "");
      const destinationId = String(req.body?.destinationId || ""); const copies = Number(req.body?.copies);
      const printNote = typeof req.body?.printNote === "string" ? req.body.printNote.trim() : "";
      if (!organizationId || !orderId || !destinationId || !Number.isInteger(copies) || copies < 1 || copies > 99 || printNote.length > 1000) return res.status(400).json({ success: false, code: "DIRECT_PRINT_VALIDATION", error: "Select a destination and enter 1–99 copies." });
      const [order] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId))).limit(1);
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`)).limit(1);
      if (!order || !destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Traveler destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent?.lastSeenAt || Date.now() - new Date(agent.lastSeenAt).getTime() > 120000) return res.status(409).json({ success: false, code: "PRINT_AGENT_OFFLINE", error: "The mapped Print Agent is offline." });
      const [job] = await db.insert(directPrintJobs).values({ organizationId, orderId, destinationId, agentId: agent.id, copies, printNote: printNote || null, trailingFeedMm: destination.trailingFeedMm, createdByUserId: getUserId(req.user) ?? null }).returning();
      res.status(202).json({ success: true, data: { id: job.id, status: job.status, destination: destination.displayName } });
    } catch (error) { sendError(res, error, "Failed to queue Traveler print"); }
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
