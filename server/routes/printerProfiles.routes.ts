import { buildPickupTravelerProgressSnapshot, pickupTravelerBoxSchema, pickupTravelerContext } from "@shared/pickupTravelerProgress";
import { randomUUID } from "node:crypto";
import { loadSavedPickupTraveler } from "../services/pickupTravelerLifecycle";
import { getOrderTravelerSource } from "../services/orderTravelerSourceService";
import type { Express } from "express";
import { z } from "zod";
import { insertPrinterProfileSchema, updatePrinterProfileSchema } from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { directPrintJobs, listSettings, localBridgeAgents, orders, printerProfiles } from "@shared/schema";
import { TRAVELER_PRINTER_PREFERENCE_LIST_KEY, travelerPrinterPreferenceSchema } from "@shared/travelerPrinterPreferences";
import { publishPrintAgentWake } from "../services/printAgentWake";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import type { PickupTravelerPrintContext } from "@shared/productionTicket";
import { supportsProfileTestAgent, supportsQuickNoteAgent, supportsShippingDocumentAgent, supportsUpsLabelAgent } from "../lib/directPrintAgentCapabilities";
import { shippingDocumentTypeSchema } from "@shared/shippingDocuments";
import { matchesShippingPrintRequest, shippingDirectPrintRequestSchema, upsLabelDirectPrintRequestSchema } from "@shared/directPrintDocuments";
import { getShippingDocumentSource } from "../services/shippingDocumentService";
import { getUpsLabelHistory } from "../services/ups/upsLabels";
import { canAgentServeQueue } from "../services/printAgentQueueMapping";

const pickupTravelerPrintSchema = z.union([
  z.object({ destinationId: z.string().min(1), reprintJobId: z.string().min(1), requestKey: z.string().min(1).max(160).optional() }).strict(),
  z.object({
    destinationId: z.string().min(1), currentBox: z.unknown().optional(), totalBoxes: z.unknown().optional(), printBlankBoxFields: z.boolean().optional(),
    lineQuantities: z.array(z.object({ orderLineItemId: z.string().min(1), quantity: z.coerce.number().int().positive() })).min(1).max(100),
    requestKey: z.string().min(1).max(160).optional(),
  }).strict(),
]);
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

type DirectPrintProfile = {
  isActive?: boolean | null;
  printAgentId?: string | null;
  supportedDocuments?: string[] | null;
  windowsQueueName?: string | null;
};

// Quick Notes were introduced after existing Traveler printer profiles. A
// mapped, active Traveler profile is therefore a compatible Quick Note
// destination unless an operator has opted into a Quick Note-specific profile.
// Keep Traveler itself explicit so Quick Note-only profiles never become
// Traveler destinations.
function supportsDirectPrintDocument(profile: DirectPrintProfile, document: "traveler" | "quick_note") {
  const supportedDocuments = profile.supportedDocuments ?? [];
  if (supportedDocuments.includes(document)) return true;
  return document === "quick_note"
    && profile.isActive === true
    && supportedDocuments.includes("traveler")
    && Boolean(profile.printAgentId)
    && Boolean(profile.windowsQueueName);
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

async function getAvailableTravelerDestination(organizationId: string, destinationId: string) {
  const [destination] = await db.select({
    id: printerProfiles.id,
    printAgentId: printerProfiles.printAgentId,
    windowsQueueName: printerProfiles.windowsQueueName,
  }).from(printerProfiles).where(and(
    eq(printerProfiles.id, destinationId),
    eq(printerProfiles.organizationId, organizationId),
    eq(printerProfiles.isActive, true),
    sql`${printerProfiles.supportedDocuments} ? 'traveler'`,
  )).limit(1);
  if (!destination?.printAgentId || !destination.windowsQueueName) return null;

  const [agent] = await db.select({ configuredTravelerPrinterName: localBridgeAgents.configuredTravelerPrinterName,
    knownWindowsQueues: localBridgeAgents.knownWindowsQueues, agentVersion: localBridgeAgents.agentVersion })
    .from(localBridgeAgents)
    .where(and(
      eq(localBridgeAgents.id, destination.printAgentId),
      eq(localBridgeAgents.organizationId, organizationId),
      eq(localBridgeAgents.status, "active"),
    ))
    .limit(1);

  return canAgentServeQueue(agent, destination.windowsQueueName) ? destination : null;
}

async function isValidPrintAgentMapping(organizationId: string, agentId: string, queueName: string | null | undefined): Promise<boolean> {
  if (!queueName) return false;
  const [agent] = await db.select({ configuredTravelerPrinterName: localBridgeAgents.configuredTravelerPrinterName,
    knownWindowsQueues: localBridgeAgents.knownWindowsQueues, agentVersion: localBridgeAgents.agentVersion })
    .from(localBridgeAgents)
    .where(and(eq(localBridgeAgents.id, agentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active")))
    .limit(1);
  return canAgentServeQueue(agent, queueName);
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

  app.get("/api/fulfillment/shipping-print-destinations", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(401).json({ error: "Organization required" });
      const documentType = z.union([shippingDocumentTypeSchema, z.literal('ups_label')]).parse(req.query.documentType);
      const destinations = await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location,
        defaultCopies: printerProfiles.defaultCopies, isDefault: printerProfiles.isDefault, agentId: printerProfiles.printAgentId,
        printerType: printerProfiles.printerType,
        queueName: printerProfiles.windowsQueueName, configuredQueueName: localBridgeAgents.configuredTravelerPrinterName,
        knownWindowsQueues: localBridgeAgents.knownWindowsQueues, agentVersion: localBridgeAgents.agentVersion, agentStatus: localBridgeAgents.status }).from(printerProfiles)
        .leftJoin(localBridgeAgents, and(eq(printerProfiles.printAgentId, localBridgeAgents.id), eq(localBridgeAgents.organizationId, organizationId)))
        .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? ${documentType}`));
      return res.json({ success: true, data: destinations.map((item) => {
        const unavailableReason = documentType === 'ups_label' && item.printerType !== 'shipping_label' ? 'UPS_LABEL_PRINTER_TYPE'
          : !item.agentId || item.agentStatus !== "active" ? "DIRECT_PRINT_UNAVAILABLE"
          : !(documentType === 'ups_label' ? supportsUpsLabelAgent(item.agentVersion) : supportsShippingDocumentAgent(item.agentVersion)) ? "PRINT_AGENT_UPDATE_REQUIRED"
          : !canAgentServeQueue({ agentVersion: item.agentVersion, configuredTravelerPrinterName: item.configuredQueueName,
            knownWindowsQueues: item.knownWindowsQueues }, item.queueName) ? "PRINT_AGENT_CONFIGURATION_MISMATCH" : null;
        return { id: item.id, displayName: item.displayName, location: item.location, defaultCopies: item.defaultCopies,
          isDefault: item.isDefault, agentVersion: item.agentVersion, available: !unavailableReason, unavailableReason };
      }) });
    } catch (error) { return sendError(res, error, "Could not load shipping print destinations"); }
  });

  app.post("/api/fulfillment/shipments/:shipmentId/direct-print", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const shipmentId = String(req.params.shipmentId || "");
      const parsed = shippingDirectPrintRequestSchema.parse(req.body);
      if (!organizationId || !shipmentId) return res.status(401).json({ error: "Organization and shipment required" });
      const headerKey = req.header("Idempotency-Key");
      if (headerKey && headerKey !== parsed.requestKey) return res.status(400).json({ error: "Print request keys must match" });
      const findExisting = async () => (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, parsed.requestKey))).limit(1))[0];
      const respond = async (job: typeof directPrintJobs.$inferSelect, duplicate: boolean) => {
        if (!matchesShippingPrintRequest(job, shipmentId, parsed)) return res.status(409).json({ success: false, code: "SHIPPING_PRINT_IDEMPOTENCY_CONFLICT", error: "This request key was used for a different print request." });
        const [assignedAgent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, job.agentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
        const wake = assignedAgent && job.status === "queued" ? await publishPrintAgentWake(assignedAgent.tokenHash) : null;
        return res.status(duplicate ? 200 : 202).json({ success: true, data: { id: job.id, status: job.status, duplicate, durablyQueued: true,
          wake: { status: wake?.published ? "published" : "not_published", attempts: wake?.attempts ?? 0 } } });
      };
      // Replay the saved semantic request before resolving a potentially edited draft.
      const existing = await findExisting();
      if (existing) return respond(existing, true);
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, parsed.printerProfileId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? ${parsed.documentType}`)).limit(1);
      if (!destination?.printAgentId || !destination.windowsQueueName || !destination.supportedDocuments.includes(parsed.documentType)) return res.status(409).json({ code: "DIRECT_PRINT_UNAVAILABLE", error: "Select a printer configured for this shipping document." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent || !supportsShippingDocumentAgent(agent.agentVersion)) return res.status(409).json({ code: "PRINT_AGENT_UPDATE_REQUIRED", error: "Shipping documents require Windows Print Agent 1.0.25 or newer." });
      if (!canAgentServeQueue(agent, destination.windowsQueueName)) return res.status(409).json({ code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The selected queue is not in this paired agent's reported Windows printer inventory." });
      const source = await getShippingDocumentSource(organizationId, shipmentId);
      if (!source || source.organizationId !== organizationId || source.shipmentId !== shipmentId) return res.status(404).json({ error: "Shipment document not found" });
      if (parsed.packageId && !source.packages.some((item) => item.id === parsed.packageId)) return res.status(404).json({ error: "Shipment package not found" });
      if (parsed.documentType === "package_ticket" && !source.packages.length) return res.status(409).json({ error: "Save at least one shipment package before printing Package Tickets." });
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId: null, destinationId: destination.id, agentId: agent.id,
        documentType: parsed.documentType, copies: parsed.copies, requestKey: parsed.requestKey,
        printContext: { shipmentId, packageId: parsed.packageId ?? null, source }, trailingFeedMm: destination.trailingFeedMm, createdByUserId: getUserId(req.user) ?? null })
        .onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? await findExisting();
      if (!job) return res.status(500).json({ error: "Could not queue shipping print job" });
      return respond(job, !created[0]);
    } catch (error) { return sendError(res, error, "Could not queue shipping document"); }
  });

  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/packages/:packageId/direct-print', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { shipmentId, purchaseId, packageId } = req.params;
      const parsed = upsLabelDirectPrintRequestSchema.parse(req.body);
      if (req.header('Idempotency-Key') && req.header('Idempotency-Key') !== parsed.requestKey)
        return res.status(400).json({ error: 'Print request keys must match.' });
      const [existing] = await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId),
        eq(directPrintJobs.requestKey, parsed.requestKey))).limit(1);
      const sameRequest = (job: typeof directPrintJobs.$inferSelect) => {
        const context = job.printContext as { shipmentId?: string; purchaseId?: string; packageId?: string } | null;
        return job.documentType === 'ups_label' && job.destinationId === parsed.printerProfileId && job.copies === parsed.copies &&
          context?.shipmentId === shipmentId && context?.purchaseId === purchaseId && context?.packageId === packageId;
      };
      if (existing) return sameRequest(existing)
        ? res.json({ success: true, data: { id: existing.id, status: existing.status, duplicate: true } })
        : res.status(409).json({ code: 'UPS_PRINT_IDEMPOTENCY_CONFLICT', error: 'Print request key belongs to another job.' });
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.organizationId, organizationId),
        eq(printerProfiles.id, parsed.printerProfileId), eq(printerProfiles.isActive, true),
        eq(printerProfiles.printerType, 'shipping_label'), sql`${printerProfiles.supportedDocuments} ? 'ups_label'`)).limit(1);
      if (!destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ code: 'DIRECT_PRINT_UNAVAILABLE', error: 'Select an active 4 × 6 inch Shipping Label printer profile.' });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId),
        eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, 'active'))).limit(1);
      if (!agent || !supportsUpsLabelAgent(agent.agentVersion)) return res.status(409).json({ code: 'PRINT_AGENT_UPDATE_REQUIRED', error: 'UPS labels require Windows Print Agent 1.0.26 or newer.' });
      if (!canAgentServeQueue(agent, destination.windowsQueueName)) return res.status(409).json({ code: 'PRINT_AGENT_CONFIGURATION_MISMATCH', error: 'The label queue is not in this paired agent\'s reported Windows printer inventory.' });
      const history = await getUpsLabelHistory(organizationId, shipmentId);
      const purchase = history.find(row => row.id === purchaseId);
      if (!purchase?.labels.some(label => label.packageId === packageId)) return res.status(404).json({ error: 'UPS package label not found.' });
      if (purchase.status !== 'PURCHASED' || purchase.environment !== 'live' || purchase.labels.some(label => label.trackingNumber.toUpperCase() === '1ZXXXXXXXXXXXXXXXX'))
        return res.status(409).json({ code: 'UPS_LABEL_NOT_PRINTABLE', error: 'Only verified live UPS labels can be queued for printing.' });
      const [created] = await db.insert(directPrintJobs).values({ organizationId, orderId: null,
        destinationId: destination.id, agentId: agent.id, documentType: 'ups_label', copies: parsed.copies,
        requestKey: parsed.requestKey, printContext: { shipmentId, purchaseId, packageId },
        trailingFeedMm: '0', createdByUserId: getUserId(req.user) ?? null })
        .onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId),
        eq(directPrintJobs.requestKey, parsed.requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ error: 'Could not queue UPS label print job.' });
      if (!sameRequest(job)) return res.status(409).json({ code: 'UPS_PRINT_IDEMPOTENCY_CONFLICT', error: 'Print request key belongs to another job.' });
      const wake = job.status === 'queued' ? await publishPrintAgentWake(agent.tokenHash) : null;
      return res.status(created ? 202 : 200).json({ success: true,
        data: { id: job.id, status: job.status, duplicate: !created, durablyQueued: true,
          wake: { status: wake?.published ? 'published' : 'not_published' } } });
    } catch (error) { return sendError(res, error, 'Could not queue UPS label print job.'); }
  });

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
    const destinations = await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location, defaultCopies: printerProfiles.defaultCopies, trailingFeedMm: printerProfiles.trailingFeedMm, isDefault: printerProfiles.isDefault, agentId: printerProfiles.printAgentId, agentName: localBridgeAgents.name, agentStatus: localBridgeAgents.status, lastSeenAt: localBridgeAgents.lastSeenAt, configuredQueueName: localBridgeAgents.configuredTravelerPrinterName, knownWindowsQueues: localBridgeAgents.knownWindowsQueues, agentVersion: localBridgeAgents.agentVersion, queueMapped: printerProfiles.windowsQueueName }).from(printerProfiles).leftJoin(localBridgeAgents, eq(printerProfiles.printAgentId, localBridgeAgents.id)).where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`));
    // Realtime wake keeps a durable queue viable while a workstation is
    // temporarily disconnected. `lastSeenAt` is therefore informational,
    // never a gate that makes an otherwise mapped destination unqueueable.
    res.json({ success: true, data: destinations.map((item) => ({ ...item, available: Boolean(item.agentId && item.agentStatus === "active" && canAgentServeQueue({ agentVersion: item.agentVersion, configuredTravelerPrinterName: item.configuredQueueName, knownWindowsQueues: item.knownWindowsQueues }, item.queueMapped)) })) });
  });

  // This preference is intentionally separate from Quick Note destinations:
  // Traveler selection is a per-user, per-organization operational default.
  app.get("/api/direct-print/traveler-preferences", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId || !userId) return res.status(401).json({ success: false, error: "Authentication is required" });
      const [stored] = await db.select({ settingsJson: listSettings.settingsJson })
        .from(listSettings)
        .where(and(
          eq(listSettings.organizationId, organizationId),
          eq(listSettings.userId, userId),
          eq(listSettings.listKey, TRAVELER_PRINTER_PREFERENCE_LIST_KEY),
        ))
        .limit(1);
      const savedDestinationId = typeof stored?.settingsJson?.defaultDestinationId === "string"
        ? stored.settingsJson.defaultDestinationId
        : null;
      return res.json({ success: true, data: { defaultDestinationId: savedDestinationId, hasSavedDefault: Boolean(savedDestinationId) } });
    } catch (error) {
      return sendError(res, error, "Could not load your Traveler printer preference");
    }
  });

  app.put("/api/direct-print/traveler-preferences", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId || !userId) return res.status(401).json({ success: false, error: "Authentication is required" });
      const { defaultDestinationId } = travelerPrinterPreferenceSchema.parse(req.body || {});
      const destination = await getAvailableTravelerDestination(organizationId, defaultDestinationId);
      if (!destination) {
        return res.status(409).json({ success: false, code: "TRAVELER_DESTINATION_UNAVAILABLE", error: "This Traveler destination is not available for your organization." });
      }
      const settingsJson = { defaultDestinationId: destination.id };
      await db.insert(listSettings).values({
        organizationId,
        userId,
        listKey: TRAVELER_PRINTER_PREFERENCE_LIST_KEY,
        settingsJson,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [listSettings.organizationId, listSettings.userId, listSettings.listKey],
        set: { settingsJson, updatedAt: new Date() },
      });
      return res.json({ success: true, data: { defaultDestinationId: destination.id, hasSavedDefault: true } });
    } catch (error) {
      return sendError(res, error, "Could not save your Traveler printer preference");
    }
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
      if (!canAgentServeQueue(agent, destination.windowsQueueName)) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "This Traveler queue is not reported by the paired Print Agent." });
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId, destinationId, agentId: agent.id, copies, printNote: printNote || null, trailingFeedMm: destination.trailingFeedMm, requestKey, createdByUserId: getUserId(req.user) ?? null }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ success: false, code: "DIRECT_PRINT_CREATE_FAILED", error: "Could not create the Traveler print job." });
      const wake = await publishPrintAgentWake(agent.tokenHash);
      res.status(created[0] ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status, destination: destination.displayName, duplicate: !created[0], durablyQueued: true, wake: { status: wake.published ? "published" : "not_published", attempts: wake.attempts } } });
    } catch (error) { sendError(res, error, "Failed to queue Traveler print"); }
  });

  app.get("/api/direct-print/quick-note-destinations", isAuthenticated, tenantContext, async (req: any, res) => {
    let organizationId: string | undefined;
    try {
      organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, code: "QUICK_NOTE_DESTINATIONS_UNAVAILABLE", error: "Could not load Quick Note destinations." });
      const destinations = (await db.select({ id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location, defaultCopies: printerProfiles.defaultCopies, receiptWidthMm: printerProfiles.receiptWidthMm, isDefault: printerProfiles.isDefault, isActive: printerProfiles.isActive, supportedDocuments: printerProfiles.supportedDocuments, agentId: printerProfiles.printAgentId, agentVersion: localBridgeAgents.agentVersion, configuredQueueName: localBridgeAgents.configuredTravelerPrinterName, knownWindowsQueues: localBridgeAgents.knownWindowsQueues, queueMapped: printerProfiles.windowsQueueName }).from(printerProfiles).leftJoin(localBridgeAgents, eq(printerProfiles.printAgentId, localBridgeAgents.id)).where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true)))).filter((item) => supportsDirectPrintDocument({ isActive: item.isActive, supportedDocuments: item.supportedDocuments, printAgentId: item.agentId, windowsQueueName: item.queueMapped }, "quick_note"));
      return res.json({ success: true, data: destinations.map((item) => {
        const quickNoteSupported = supportsQuickNoteAgent(item.agentVersion);
        const mapped = Boolean(item.agentId && canAgentServeQueue({ agentVersion: item.agentVersion, configuredTravelerPrinterName: item.configuredQueueName, knownWindowsQueues: item.knownWindowsQueues }, item.queueMapped));
        return { ...item, quickNoteSupported, available: mapped && quickNoteSupported, unavailableReason: !item.agentId || !item.queueMapped ? "DIRECT_PRINT_UNAVAILABLE" : !quickNoteSupported ? "PRINT_AGENT_UPDATE_REQUIRED" : !mapped ? "PRINT_AGENT_CONFIGURATION_MISMATCH" : null };
      }) });
    } catch (error) {
      const databaseError = error as { code?: unknown; message?: unknown };
      console.error("[QUICK NOTE DESTINATIONS] Failed", {
        operation: "list_quick_note_destinations",
        organizationId,
        code: typeof databaseError?.code === "string" ? databaseError.code : "UNKNOWN",
        message: typeof databaseError?.message === "string" ? databaseError.message : "Unknown database error",
      });
      return res.status(500).json({ success: false, code: "QUICK_NOTE_DESTINATIONS_UNAVAILABLE", error: "Could not load Quick Note destinations." });
    }
  });

  app.post("/api/direct-print/quick-note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const parsed = quickNotePrintSchema.parse(req.body || {});
      const headline = parsed.headline.trim(); const note = parsed.note.trim();
      const requestKey = String(req.header("Idempotency-Key") || parsed.requestKey || "").trim();
      if (!organizationId || (!headline && !note) || !requestKey || requestKey.length > 160) return res.status(400).json({ success: false, code: "QUICK_NOTE_VALIDATION", error: "Enter a headline or note, select a destination, and provide a valid print request key." });
      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, parsed.destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true))).limit(1);
      if (!destination || !supportsDirectPrintDocument(destination, "quick_note") || !destination.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Quick Note destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!agent || !supportsQuickNoteAgent(agent.agentVersion)) return res.status(409).json({ success: false, code: "PRINT_AGENT_UPDATE_REQUIRED", error: "This printer's Windows Print Agent must be updated before it can print Quick Notes." });
      if (!canAgentServeQueue(agent, destination.windowsQueueName)) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "This Quick Note queue is not reported by the paired Print Agent." });
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

      let printContext: PickupTravelerPrintContext;
      if ("reprintJobId" in parsed) {
        const saved = await loadSavedPickupTraveler(db, organizationId, orderId, parsed.reprintJobId);
        if (!saved) return res.status(404).json({ success: false, error: "Saved Pickup Traveler not found." });
        printContext = { ...saved, reprintOf: saved.reprintOf ?? parsed.reprintJobId };
      } else {
        const box = pickupTravelerBoxSchema.parse(parsed);
        const detail = await canonicalFulfillmentOperations.getOrderDetail(organizationId, orderId);
        if (detail.fulfillmentType !== "PICKUP") return res.status(409).json({ success: false, code: "PICKUP_TRAVELER_NOT_PICKUP", error: "Pickup travelers are available only for pickup orders." });
        const remainingByLine = new Map(detail.lineItems.map((line) => [line.id, line.production.remainingQuantity]));
        const seen = new Set<string>();
        for (const item of parsed.lineQuantities) {
          const remaining = remainingByLine.get(item.orderLineItemId);
          if (seen.has(item.orderLineItemId) || remaining === undefined || item.quantity > remaining) {
            return res.status(400).json({ success: false, code: "PICKUP_TRAVELER_QUANTITY_INVALID", error: "Pickup quantities must be positive, unique line items, and no greater than the current remaining quantity." });
          }
          seen.add(item.orderLineItemId);
        }
        printContext = { fulfillmentMode: "pickup", lineQuantities: parsed.lineQuantities, boxCount: 1, box, printBlankBoxFields: parsed.printBlankBoxFields ?? false,
          progressSnapshot: buildPickupTravelerProgressSnapshot(detail.lineItems, parsed.lineQuantities, new Date().toISOString()) };
        const source = await getOrderTravelerSource(organizationId, orderId, printContext);
        if (!source) return res.status(404).json({ success: false, error: "Order not found." });
        const { pickupPrintContext: ignoredContext, pickupStatus: ignoredStatus, ...documentSnapshot } = source;
        printContext.documentSnapshot = documentSnapshot;
      }

      const [destination] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, parsed.destinationId), eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true), sql`${printerProfiles.supportedDocuments} ? 'traveler'`)).limit(1);
      if (!destination?.printAgentId || !destination.windowsQueueName) return res.status(409).json({ success: false, code: "DIRECT_PRINT_UNAVAILABLE", error: "This Traveler destination is not available for direct printing." });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, destination.printAgentId), eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).limit(1);
      if (!canAgentServeQueue(agent, destination.windowsQueueName)) return res.status(409).json({ success: false, code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "This Pickup Traveler queue is not reported by the paired Print Agent." });

      // One manual package label per new job; legacy reprints retain their original batch.
      const created = await db.insert(directPrintJobs).values({ organizationId, orderId, destinationId: destination.id, agentId: agent.id, documentType: "pickup_traveler", copies: 1, printContext: { ...printContext }, trailingFeedMm: destination.trailingFeedMm, requestKey, createdByUserId: getUserId(req.user) ?? null }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created[0] ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job) return res.status(500).json({ success: false, code: "PICKUP_TRAVELER_CREATE_FAILED", error: "Could not queue pickup travelers." });
      const wake = await publishPrintAgentWake(agent.tokenHash);
      return res.status(created[0] ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status, boxCount: printContext.boxCount, destination: destination.displayName, duplicate: !created[0], durablyQueued: true, wake: { status: wake.published ? "published" : "not_published", attempts: wake.attempts } } });
    } catch (error) { return sendError(res, error, "Failed to queue pickup travelers"); }
  });

  app.post("/api/printer-profiles", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const parsed = insertPrinterProfileSchema.parse(req.body);
      if (parsed.printAgentId && !await isValidPrintAgentMapping(organizationId, parsed.printAgentId, parsed.windowsQueueName))
        return res.status(409).json({ code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The selected Print Agent must be active in this organization and configured for this exact Windows printer queue." });
      if (parsed.supportedDocuments.includes('ups_label') && parsed.printerType !== 'shipping_label')
        return res.status(400).json({ code: 'UPS_LABEL_PRINTER_TYPE', error: 'UPS labels require a Shipping Label printer profile.' });
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
      if (parsed.printAgentId !== undefined || parsed.windowsQueueName !== undefined) {
        const [current] = await db.select({ printAgentId: printerProfiles.printAgentId, windowsQueueName: printerProfiles.windowsQueueName })
          .from(printerProfiles).where(and(eq(printerProfiles.id, req.params.id), eq(printerProfiles.organizationId, organizationId))).limit(1);
        if (!current) return res.status(404).json({ code: "PRINTER_PROFILE_NOT_FOUND", error: "Printer profile not found." });
        const agentId = parsed.printAgentId === undefined ? current.printAgentId : parsed.printAgentId;
        const queueName = parsed.windowsQueueName === undefined ? current.windowsQueueName : parsed.windowsQueueName;
        if (agentId && !await isValidPrintAgentMapping(organizationId, agentId, queueName))
          return res.status(409).json({ code: "PRINT_AGENT_CONFIGURATION_MISMATCH", error: "The selected Print Agent must be active in this organization and configured for this exact Windows printer queue." });
      }
      if (parsed.supportedDocuments?.includes('ups_label') || parsed.printerType && parsed.printerType !== 'shipping_label') {
        const [current] = await db.select({ printerType: printerProfiles.printerType,
          supportedDocuments: printerProfiles.supportedDocuments }).from(printerProfiles).where(and(
          eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, req.params.id))).limit(1);
        if ((parsed.supportedDocuments ?? current?.supportedDocuments ?? []).includes('ups_label') &&
          (parsed.printerType ?? current?.printerType) !== 'shipping_label')
          return res.status(400).json({ code: 'UPS_LABEL_PRINTER_TYPE', error: 'UPS labels require a Shipping Label printer profile.' });
      }
      const updated = await storage.updatePrinterProfile(organizationId, req.params.id, parsed, getUserId(req.user));
      res.json({ success: true, data: updated });
    } catch (error) {
      sendError(res, error, "Failed to update printer profile");
    }
  });

  app.post("/api/printer-profiles/:id/test-print", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const [profile] = await db.select().from(printerProfiles).where(and(eq(printerProfiles.id, req.params.id),
        eq(printerProfiles.organizationId, organizationId))).limit(1);
      if (!profile) return res.status(404).json({ code: 'PRINTER_PROFILE_NOT_FOUND', error: 'Saved printer profile not found.' });
      if (!profile.isActive) return res.status(409).json({ code: 'PRINTER_PROFILE_INACTIVE', error: 'Activate and save this printer profile before testing it.' });
      if (profile.printerType === 'other') return res.status(409).json({ code: 'TEST_MEDIA_UNSUPPORTED', error: 'Choose a supported printer type and save this profile before testing its paper layout.' });
      if (!profile.printAgentId) return res.status(409).json({ code: 'PRINT_AGENT_UNASSIGNED', error: 'Select and save a paired Print Agent for this profile.' });
      if (!profile.windowsQueueName) return res.status(409).json({ code: 'PRINT_QUEUE_MISSING', error: 'Enter and save the exact Windows printer queue.' });
      if (profile.printerType === 'shipping_label' && !profile.supportedDocuments.includes('ups_label'))
        return res.status(409).json({ code: 'TEST_MEDIA_UNSUPPORTED', error: 'Enable UPS 4 × 6 label support and save this Shipping Label profile.' });
      const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.id, profile.printAgentId),
        eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, 'active'))).limit(1);
      if (!agent) return res.status(409).json({ code: 'PRINT_AGENT_UNAVAILABLE', error: 'The paired Print Agent is inactive or no longer belongs to this organization. Select another agent.' });
      if (!canAgentServeQueue(agent, profile.windowsQueueName))
        return res.status(409).json({ code: 'PRINT_AGENT_CONFIGURATION_MISMATCH', error: 'The paired agent is configured for a different Windows queue. Match the queue and save this profile.' });
      if (!supportsProfileTestAgent(agent.agentVersion))
        return res.status(409).json({ code: 'PRINT_AGENT_UPDATE_REQUIRED', error: 'Install Print Agent 1.0.27 or newer on this workstation to use Test Print.' });
      const requestKey = String(req.header('Idempotency-Key') || randomUUID()).slice(0, 160);
      const [created] = await db.insert(directPrintJobs).values({ organizationId, orderId: null,
        destinationId: profile.id, agentId: agent.id, documentType: 'profile_test', copies: 1,
        requestKey, printContext: { mediaKind: profile.printerType === 'shipping_label' ? 'label' : profile.printerType === 'production_ticket' ? 'receipt' : 'document',
          receiptWidthMm: Number(profile.receiptWidthMm) || 80 },
        trailingFeedMm: '0', createdByUserId: getUserId(req.user) ?? null })
        .onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
      const job = created ?? (await db.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, organizationId),
        eq(directPrintJobs.requestKey, requestKey))).limit(1))[0];
      if (!job || job.documentType !== 'profile_test' || job.destinationId !== profile.id)
        return res.status(409).json({ code: 'TEST_PRINT_REQUEST_CONFLICT', error: 'This test-print request key belongs to a different job. Retry from this page.' });
      const wake = job.status === 'queued' ? await publishPrintAgentWake(agent.tokenHash) : null;
      return res.status(created ? 202 : 200).json({ success: true, data: { id: job.id, status: job.status,
        agentLastSeenAt: agent.lastSeenAt, wakePublished: Boolean(wake?.published), duplicate: !created } });
    } catch (error) { return sendError(res, error, 'Could not queue printer test.'); }
  });

  app.get("/api/printer-profiles/:id/test-print/:jobId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const [job] = await db.select({ id: directPrintJobs.id, status: directPrintJobs.status, lastError: directPrintJobs.lastError,
      submittedAt: directPrintJobs.submittedAt, claimedAt: directPrintJobs.claimedAt })
      .from(directPrintJobs).where(and(eq(directPrintJobs.id, req.params.jobId), eq(directPrintJobs.destinationId, req.params.id),
        eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.documentType, 'profile_test'))).limit(1);
    if (!job) return res.status(404).json({ code: 'TEST_PRINT_NOT_FOUND', error: 'Test print job not found.' });
    return res.json({ success: true, data: { ...job,
      lastError: job.lastError ? job.lastError.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 240) : null } });
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
