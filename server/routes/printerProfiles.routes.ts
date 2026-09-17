import type { Express } from "express";
import { z } from "zod";
import { insertPrinterProfileSchema, updatePrinterProfileSchema } from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { directPrintJobs, localBridgeAgents, orders, printerProfiles } from "@shared/schema";
import { publishPrintAgentWake } from "../services/printAgentWake";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import type { PickupTravelerPrintContext } from "@shared/productionTicket";

const pickupTravelerPrintSchema = z.object({
  destinationId: z.string().min(1),
  boxCount: z.coerce.number().int().min(1).max(100),
  lineQuantities: z.array(z.object({
    orderLineItemId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
  })).min(1).max(100),
  requestKey: z.string().min(1).max(160).optional(),
});
const quickNotePrintSchema = z.object({
  destinationId: z.string().min(1),
  headline: z.string().max(240).optional().default(""),
  note: z.string().max(4000).optional().default(""),
  copies: z.coerce.number().int().min(1).max(25),
  requestKey: z.string().min(1).max(160).optional(),
});

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
    const destinations = await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location, defaultCopies: printerProfiles.defaultCopies, trailingFeedMm: printerProfiles.trailingFeedMm, isDefault: printerProfiles.isDefault, agentId: printerProfiles.printAgentId, agentName: localBridgeAgents.name, lastSeenAt: localBridgeAgents.lastSeenAt, configuredQueueName: localBridgeAgents.configuredTravelerPrinterName, queueMapped: printerProfiles.windowsQueueName }).from(printerProfiles).leftJoin(localBridgeAgents, eq(printerProfiles.printAgentId, localBridgeAgents.id)).where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`));
    // Realtime wake keeps a durable queue viable while a workstation is
    // temporarily disconnected. `lastSeenAt` is therefore informational,
    // never a gate that makes an otherwise mapped destination unqueueable.
    res.json({ success: true, data: destinations.map((item) => ({ ...item, available: Boolean(item.agentId && item.queueMapped && item.configuredQueueName && item.queueMapped === item.configuredQueueName) })) });
  });

  app.post("/api/orders/:orderId/direct-print/traveler", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req); const orderId = String(req.params.orderId || "");
      const destinationId = String(req.body?.destinationId || ""); const copies = Number(req.body?.copies);
      const printNote = typeof req.body?.printNote === "string" ? req.body.printNote.trim() : "";
      const requestKey = String(req.header("Idempotency-Key") || req.body?.requestKey || "").trim();
      if (!organizationId || !orderId || !destinationId || !Number.isInteger(copies) || copies < 1 || copies > 99 || printNote.length > 1000 || !requestKey || requestKey.length > 160) return res.status(400).json({ success: false, code: "DIRECT_PRINT_VALIDATION", error: "Select a destination, enter 1–99 copies, and provide a valid print request key." });
      const [order] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId))).limit(1);
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`)).limit(1);
      if (!order || !destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Traveler destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent?.configuredTravelerPrinterName || agent.configuredTravelerPrinterName !== destination.windowsQueueName) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The Print Agent's selected Traveler printer does not match this destination." });
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId, destinationId, agentId: agent.id, copies, printNote: printNote || null, trailingFeedMm: destination.trailingFeedMm, requestKey, createdByUserId: getUserId(req.user) ?? null }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ success: false, code: "DIRECT_PRINT_CREATE_FAILED", error: "Could not create the Traveler print job." });
      const wake = await publishPrintAgentWake(agent.tokenHash);
      res.status(created[0] ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status, destination: destination.displayName, duplicate: !created[0], durablyQueued: true, wake: { status: wake.published ? "published" : "not_published", attempts: wake.attempts } } });
    } catch (error) { sendError(res, error, "Failed to queue Traveler print"); }
  });

  app.get("/api/direct-print/quick-note-destinations", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    const destinations = await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location, defaultCopies: printerProfiles.defaultCopies, receiptWidthMm: printerProfiles.receiptWidthMm, isDefault: printerProfiles.isDefault, agentId: printerProfiles.printAgentId, configuredQueueName: localBridgeAgents.configuredTravelerPrinterName, queueMapped: printerProfiles.windowsQueueName }).from(printerProfiles).leftJoin(localBridgeAgents, eq(printerProfiles.printAgentId, localBridgeAgents.id)).where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'quick_note'`));
    res.json({ success: true, data: destinations.map((item) => ({ ...item, available: Boolean(item.agentId && item.queueMapped && item.configuredQueueName && item.queueMapped === item.configuredQueueName) })) });
  });

  app.post("/api/direct-print/quick-note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const parsed = quickNotePrintSchema.parse(req.body || {});
      const headline = parsed.headline.trim(); const note = parsed.note.trim();
      const requestKey = String(req.header("Idempotency-Key") || parsed.requestKey || "").trim();
      if (!organizationId || (!headline && !note) || !requestKey || requestKey.length > 160) return res.status(400).json({ success: false, code: "QUICK_NOTE_VALIDATION", error: "Enter a headline or note, select a destination, and provide a valid print request key." });
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, parsed.destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'quick_note'`)).limit(1);
      if (!destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Quick Note destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent?.configuredTravelerPrinterName || agent.configuredTravelerPrinterName !== destination.windowsQueueName) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The Print Agent's selected printer does not match this destination." });
      const printContext = { headline, body: note, receiptWidthMm: Number(destination.receiptWidthMm) || 80 };
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId: null, destinationId: destination.id, agentId: agent.id, documentType: "quick_note", copies: parsed.copies, printContext, trailingFeedMm: destination.trailingFeedMm, requestKey, createdByUserId: getUserId(req.user) ?? null }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ success: false, code: "QUICK_NOTE_CREATE_FAILED", error: "Could not create the Quick Note print job." });
      const existingContext = job.printContext as { headline?: unknown; body?: unknown } | null;
      if (!created[0] && (job.documentType !== "quick_note" || job.destinationId !== destination.id || job.copies !== parsed.copies || existingContext?.headline !== headline || existingContext?.body !== note)) {
        return res.status(409).json({ success: false, code: "QUICK_NOTE_IDEMPOTENCY_CONFLICT", error: "This print request key was already used for different Quick Note content." });
      }
      const wake = await publishPrintAgentWake(agent.tokenHash);
      return res.status(created[0] ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status, destination: destination.displayName, duplicate: !created[0], durablyQueued: true, wake: { status: wake.published ? "published" : "not_published", attempts: wake.attempts } } });
    } catch (error) { return sendError(res, error, "Failed to queue Quick Note print"); }
  });

  // Pickup tags use the same durable Traveler job and Windows agent. The
  // print-only context is validated against current remaining quantities but
  // never writes fulfillment, order, or line-item state.
  app.post("/api/orders/:orderId/direct-print/pickup-travelers", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const orderId = String(req.params.orderId || "");
      const parsed = pickupTravelerPrintSchema.parse(req.body || {});
      const requestKey = String(req.header("Idempotency-Key") || parsed.requestKey || "").trim();
      if (!organizationId || !orderId || !requestKey || requestKey.length > 160) {
        return res.status(400).json({ success: false, code: "PICKUP_TRAVELER_VALIDATION", error: "A valid pickup traveler print request is required." });
      }

      const detail = await canonicalFulfillmentOperations.getOrderDetail(organizationId, orderId);
      if (detail.fulfillmentType !== "PICKUP") {
        return res.status(409).json({ success: false, code: "PICKUP_TRAVELER_NOT_PICKUP", error: "Pickup travelers are available only for pickup orders." });
      }
      const remainingByLine = new Map(detail.lineItems.map((line) => [line.id, line.production.remainingQuantity]));
      const seen = new Set<string>();
      for (const item of parsed.lineQuantities) {
        const remaining = remainingByLine.get(item.orderLineItemId);
        if (seen.has(item.orderLineItemId) || remaining === undefined || item.quantity > remaining) {
          return res.status(400).json({ success: false, code: "PICKUP_TRAVELER_QUANTITY_INVALID", error: "Pickup quantities must be positive, unique line items, and no greater than the current remaining quantity." });
        }
        seen.add(item.orderLineItemId);
      }

      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, parsed.destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`)).limit(1);
      if (!destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Traveler destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent?.configuredTravelerPrinterName || agent.configuredTravelerPrinterName !== destination.windowsQueueName) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The Print Agent's selected Traveler printer does not match this destination." });

      const printContext: PickupTravelerPrintContext = { fulfillmentMode: "pickup", lineQuantities: parsed.lineQuantities, boxCount: parsed.boxCount };
      // Copies remains one: the canonical traveler page renders one sequential
      // label per box so each tag receives its own deterministic box number.
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId, destinationId: destination.id, agentId: agent.id, documentType: "pickup_traveler", copies: 1, printContext, trailingFeedMm: destination.trailingFeedMm, requestKey, createdByUserId: getUserId(req.user) ?? null }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ success: false, code: "PICKUP_TRAVELER_CREATE_FAILED", error: "Could not queue pickup travelers." });
      const wake = await publishPrintAgentWake(agent.tokenHash);
      return res.status(created[0] ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status, boxCount: parsed.boxCount, destination: destination.displayName, duplicate: !created[0], durablyQueued: true, wake: { status: wake.published ? "published" : "not_published", attempts: wake.attempts } } });
    } catch (error) { return sendError(res, error, "Failed to queue pickup travelers"); }
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
