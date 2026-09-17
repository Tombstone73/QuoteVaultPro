import crypto from "crypto";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import type { Express } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { ObjectStorageService } from "../objectStorage";
import { auditLogs, customers, directPrintJobs, localBridgeAgents, localFileCopyJobs, localFileDestinations, lineItemFiles, orders, printerProfiles, productionRuns } from "@shared/schema";
import { getRequestOrganizationId } from "../tenantContext";
import { getOrderTravelerSource } from "../services/orderTravelerSourceService";
import { buildClaimedTravelerWebUrl, getCanonicalTravelerWebOrigin } from "../lib/directTravelerPrintUrl";
import { getPublicWebOrigin } from "../lib/appRuntimeConfig";
import { getPrintAgentRealtimeConfiguration } from "../services/printAgentWake";
import { isNumericAgentVersion } from "../lib/directPrintAgentCapabilities";
import type { PickupTravelerPrintContext } from "@shared/productionTicket";

const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
function pickupTravelerContext(value: unknown): PickupTravelerPrintContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<PickupTravelerPrintContext>;
  if (context.fulfillmentMode !== "pickup" || !Number.isInteger(context.boxCount) || (context.boxCount ?? 0) < 1 || !Array.isArray(context.lineQuantities)) return null;
  const lineQuantities = context.lineQuantities.filter((item): item is { orderLineItemId: string; quantity: number } => Boolean(item && typeof item.orderLineItemId === "string" && Number.isInteger(item.quantity) && item.quantity > 0));
  return lineQuantities.length === context.lineQuantities.length ? { fulfillmentMode: "pickup", boxCount: context.boxCount!, lineQuantities } : null;
}
const travelerPrintAgentPackageName = "PrintersHero-Traveler-Print-Agent-win-x64.zip";
const bridgeAuth = async (req: any, res: any, next: any) => { const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); if (!raw) return res.status(401).json({ error: "Bridge token required" }); const [agent] = await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.tokenHash, tokenHash(raw)), eq(localBridgeAgents.status, "active"))).limit(1); if (!agent) return res.status(401).json({ error: "Invalid or revoked bridge token" }); req.bridgeAgent = agent; next(); };
const recordBridgeActivity = (agentId: string) => db.update(localBridgeAgents).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(localBridgeAgents.id, agentId));
export function registerLocalBridgeRoutes(app: Express, deps: { isAuthenticated: any; tenantContext: any; requireOrgOwnerAdmin: any }) {
  const admin = [deps.isAuthenticated, deps.tenantContext, deps.requireOrgOwnerAdmin];
  app.post("/api/local-bridge/admin/agents", ...admin, async (req: any, res) => { const organizationId = getRequestOrganizationId(req); const rawToken = crypto.randomBytes(32).toString("base64url"); const [agent] = await db.insert(localBridgeAgents).values({ organizationId, name: String(req.body?.name || "Local Bridge"), tokenHash: tokenHash(rawToken), status: "active" }).returning(); res.json({ success: true, data: { agent, token: rawToken } }); });
  // Revoked credentials remain in the database for audit purposes, but are
  // intentionally not returned to the operator UI because they cannot pair
  // or receive work again.
  app.get("/api/local-bridge/admin/agents", ...admin, async (req: any, res) => { const organizationId = getRequestOrganizationId(req); res.json({ success: true, data: await db.select().from(localBridgeAgents).where(and(eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.status, "active"))).orderBy(desc(localBridgeAgents.updatedAt)) }); });
  app.post("/api/local-bridge/admin/agents/:id/revoke", ...admin, async (req: any, res) => { const organizationId = getRequestOrganizationId(req); await db.update(localBridgeAgents).set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(localBridgeAgents.id, req.params.id), eq(localBridgeAgents.organizationId, organizationId))); res.json({ success: true, data: {} }); });
  app.post("/api/local-bridge/admin/destinations", ...admin, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req); const customerId = String(req.body?.customerId || ""); const localPath = String(req.body?.localPath || "").trim();
    if (!customerId || !localPath) return res.status(400).json({ success: false, error: "customerId and localPath are required" });
    const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).limit(1);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
    const [existing] = await db.select({ id: localFileDestinations.id }).from(localFileDestinations).where(and(eq(localFileDestinations.organizationId, organizationId), eq(localFileDestinations.customerId, customerId), eq(localFileDestinations.destinationType, "customer_art_folder"))).orderBy(desc(localFileDestinations.updatedAt)).limit(1);
    const [destination] = existing
      ? await db.update(localFileDestinations).set({ localPath, enabled: req.body?.enabled !== false, updatedAt: new Date() }).where(eq(localFileDestinations.id, existing.id)).returning()
      : await db.insert(localFileDestinations).values({ organizationId, customerId, localPath, destinationType: "customer_art_folder", enabled: req.body?.enabled !== false }).returning();
    res.json({ success: true, data: destination });
  });
  app.delete("/api/local-bridge/admin/destinations", ...admin, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req); const customerId = String(req.body?.customerId || "");
    if (!customerId) return res.status(400).json({ success: false, error: "customerId is required" });
    const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).limit(1);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
    const updated = await db.update(localFileDestinations).set({ enabled: false, updatedAt: new Date() }).where(and(eq(localFileDestinations.organizationId, organizationId), eq(localFileDestinations.customerId, customerId), eq(localFileDestinations.destinationType, "customer_art_folder"))).returning();
    res.json({ success: true, data: updated[0] ?? null });
  });
  app.get("/api/local-bridge/admin/destinations", ...admin, async (req: any, res) => { const organizationId = getRequestOrganizationId(req); const customerId = String(req.query.customerId || ""); if (!customerId) return res.status(400).json({ error: "customerId is required" }); const [destination] = await db.select().from(localFileDestinations).where(and(eq(localFileDestinations.organizationId, organizationId), eq(localFileDestinations.customerId, customerId), eq(localFileDestinations.destinationType, "customer_art_folder"))).orderBy(desc(localFileDestinations.updatedAt)).limit(1); res.json({ success: true, data: destination ?? null }); });
  app.get("/api/local-bridge/admin/jobs", ...admin, async (req: any, res) => { const organizationId = getRequestOrganizationId(req); res.json({ success: true, data: await db.select().from(localFileCopyJobs).where(eq(localFileCopyJobs.organizationId, organizationId)).limit(50) }); });
  app.get("/api/local-bridge/admin/agent-package", ...admin, async (_req: any, res) => { const dir = [path.resolve(process.cwd(), "dist/local-bridge-agent"), path.resolve(process.cwd(), "local-bridge-agent")].find(fs.existsSync); if (!dir) return res.status(404).json({ error: "Agent package unavailable" }); res.attachment("printershero-local-bridge-agent-v1.zip"); const zip = archiver("zip"); zip.pipe(res); zip.directory(dir, "printershero-local-bridge-agent"); await zip.finalize(); });
  app.get("/api/local-bridge/admin/traveler-print-agent-package", ...admin, async (_req: any, res) => {
    const packagePath = [
      path.resolve(process.cwd(), "dist", "print-agent", travelerPrintAgentPackageName),
      path.resolve(process.cwd(), "server", "assets", "print-agent", travelerPrintAgentPackageName),
    ].find(fs.existsSync);
    if (!packagePath) return res.status(404).json({ error: "Traveler Print Agent package unavailable" });
    return res.download(packagePath, travelerPrintAgentPackageName);
  });
  app.post("/api/local-bridge/heartbeat", bridgeAuth, async (req: any, res) => {
    const agent = req.bridgeAgent;
    const reportedVersion = typeof req.body?.agentVersion === "string" ? req.body.agentVersion.trim() : undefined;
    // Diagnostics may prove that a paired machine is reachable, but only the
    // executable may replace its known version. Invalid/missing values retain
    // the version already tied to this token's single agent identity.
    const agentVersion = isNumericAgentVersion(reportedVersion) ? reportedVersion : agent.agentVersion;
    await db.update(localBridgeAgents).set({ lastSeenAt: new Date(), machineLabel: String(req.body?.name || agent.name), agentVersion, updatedAt: new Date() }).where(eq(localBridgeAgents.id, agent.id));
    res.json({ success: true, data: { status: "active", agentVersion } });
  });
  // The installer may configure only its own paired agent. It never sends the
  // printer inventory to the server; only the explicit selection is persisted.
  app.post("/api/local-bridge/direct-print/configuration", bridgeAuth, async (req: any, res) => {
    const agent = req.bridgeAgent;
    const realtime = getPrintAgentRealtimeConfiguration();
    if (!realtime) return res.status(503).json({ error: "Print Agent realtime configuration is unavailable. Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY." });
    const queueName = String(req.body?.travelerPrinterName || "").trim();
    if (!queueName || queueName.length > 255) return res.status(400).json({ error: "A valid Traveler printer name is required." });

    await db.update(localBridgeAgents)
      .set({ configuredTravelerPrinterName: queueName, updatedAt: new Date() })
      .where(eq(localBridgeAgents.id, agent.id));

    // Prefer an existing unpaired profile using this exact Windows queue. This
    // preserves the operator's destination label/location while connecting it
    // to the agent that selected the queue. Profiles paired to another agent
    // are never changed by this endpoint.
    let existing = (await db.select({ id: printerProfiles.id })
      .from(printerProfiles)
      .where(and(
        eq(printerProfiles.organizationId, agent.organizationId),
        isNull(printerProfiles.printAgentId),
        eq(printerProfiles.windowsQueueName, queueName),
        sql`${printerProfiles.supportedDocuments} ? 'traveler'`,
      ))
      .limit(1))[0];

    if (!existing) {
      existing = (await db.select({ id: printerProfiles.id })
        .from(printerProfiles)
        .where(and(
          eq(printerProfiles.organizationId, agent.organizationId),
          eq(printerProfiles.printAgentId, agent.id),
          sql`${printerProfiles.supportedDocuments} ? 'traveler'`,
        ))
        .limit(1))[0];
    }

    const [destination] = existing
      ? await db.update(printerProfiles)
        .set({ windowsQueueName: queueName, printAgentId: agent.id, isActive: true, updatedAt: new Date() })
        .where(eq(printerProfiles.id, existing.id))
        .returning()
      : await db.insert(printerProfiles).values({
        organizationId: agent.organizationId,
        displayName: "Traveler",
        printerType: "production_ticket",
        intendedUse: "production_ticket",
        windowsQueueName: queueName,
        printAgentId: agent.id,
        supportedDocuments: ["traveler"],
        defaultCopies: 1,
        trailingFeedMm: "0",
        scope: "organization",
        isActive: true,
        isDefault: false,
      }).returning();

    await recordBridgeActivity(agent.id);
    res.json({ success: true, data: { travelerPrinterName: queueName, destinationId: destination.id, realtime } });
  });
  // A print host only sees jobs assigned to its paired identity. Claiming is a
  // single conditional update so two agents cannot submit the same Traveler.
  app.get("/api/local-bridge/direct-print/jobs", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; await recordBridgeActivity(agent.id); const rows = await db.select({ id: directPrintJobs.id, orderId: directPrintJobs.orderId, documentType: directPrintJobs.documentType, printContext: directPrintJobs.printContext, copies: directPrintJobs.copies, printNote: directPrintJobs.printNote, trailingFeedMm: directPrintJobs.trailingFeedMm, queueName: printerProfiles.windowsQueueName, destinationName: printerProfiles.displayName, location: printerProfiles.location }).from(directPrintJobs).innerJoin(printerProfiles, eq(directPrintJobs.destinationId, printerProfiles.id)).where(and(eq(directPrintJobs.organizationId, agent.organizationId), eq(directPrintJobs.agentId, agent.id), eq(directPrintJobs.status, "queued"))).limit(10); res.json({ success: true, data: rows }); });
  app.post("/api/local-bridge/direct-print/jobs/:id/claim", bridgeAuth, async (req: any, res) => {
    let canonicalWebOrigin: string; try { canonicalWebOrigin = getCanonicalTravelerWebOrigin(getPublicWebOrigin()); } catch (error: any) { return res.status(503).json({ error: error?.message || "Print web application origin is unavailable." }); }

    const agent = req.bridgeAgent;
    const [job] = await db.update(directPrintJobs).set({ status: "claimed", claimedAt: new Date(), attempts: sql`${directPrintJobs.attempts} + 1`, updatedAt: new Date() }).where(and(eq(directPrintJobs.id, req.params.id), eq(directPrintJobs.organizationId, agent.organizationId), eq(directPrintJobs.agentId, agent.id), eq(directPrintJobs.status, "queued"))).returning();
    if (!job) return res.status(409).json({ error: "Print job is no longer available" });
    await recordBridgeActivity(agent.id);

    const [destination] = await db.select({ windowsQueueName: printerProfiles.windowsQueueName }).from(printerProfiles).where(and(eq(printerProfiles.id, job.destinationId), eq(printerProfiles.organizationId, agent.organizationId))).limit(1);
    return res.json({
      success: true,
      data: {
        ...job,
        queueName: destination?.windowsQueueName ?? null,
        travelerUrl: job.documentType === "quick_note" ? `${canonicalWebOrigin}/print/quick-note?${new URLSearchParams({ directPrintJobId: job.id }).toString()}` : buildClaimedTravelerWebUrl(canonicalWebOrigin, job.orderId!, job.id),
      },
    });
  });
  // This endpoint is deliberately job-scoped: it returns the exact source
  // consumed by the existing React Traveler page, never an arbitrary URL or
  // file. A claimed job is the only way an agent credential can read it.
  app.get("/api/local-bridge/direct-print/jobs/:id/traveler", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const [job] = await db.select({ orderId: directPrintJobs.orderId, documentType: directPrintJobs.documentType, printContext: directPrintJobs.printContext }).from(directPrintJobs).where(and(eq(directPrintJobs.id, req.params.id), eq(directPrintJobs.agentId, agent.id), eq(directPrintJobs.organizationId, agent.organizationId), eq(directPrintJobs.status, "claimed"))).limit(1); if (!job) return res.status(404).json({ error: "Print job not claimed" }); const context = job.documentType === "pickup_traveler" ? pickupTravelerContext(job.printContext) : null; if (job.documentType === "pickup_traveler" && !context) return res.status(409).json({ error: "Pickup traveler print context is unavailable" }); const traveler = await (context ? getOrderTravelerSource(agent.organizationId, job.orderId, context) : getOrderTravelerSource(agent.organizationId, job.orderId)); if (!traveler) return res.status(404).json({ error: "Order not found" }); res.json({ success: true, data: traveler }); });
  app.get("/api/local-bridge/direct-print/jobs/:id/quick-note", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const [job] = await db.select({ documentType: directPrintJobs.documentType, printContext: directPrintJobs.printContext }).from(directPrintJobs).where(and(eq(directPrintJobs.id, req.params.id), eq(directPrintJobs.agentId, agent.id), eq(directPrintJobs.organizationId, agent.organizationId), eq(directPrintJobs.status, "claimed"))).limit(1); const context = job?.printContext as any; if (!job || job.documentType !== "quick_note" || !context || typeof context.headline !== "string" || typeof context.body !== "string") return res.status(404).json({ error: "Quick Note print job not claimed" }); return res.json({ success: true, data: { headline: context.headline, body: context.body, receiptWidthMm: Number(context.receiptWidthMm) || 80 } }); });
  app.post("/api/local-bridge/direct-print/jobs/:id/:outcome", bridgeAuth, async (req: any, res) => { const outcome = req.params.outcome; if (outcome !== "submitted" && outcome !== "failed") return res.status(400).json({ error: "Invalid print outcome" }); const agent = req.bridgeAgent; const [job] = await db.update(directPrintJobs).set({ status: outcome, submittedAt: outcome === "submitted" ? new Date() : null, failedAt: outcome === "failed" ? new Date() : null, lastError: outcome === "failed" ? String(req.body?.error || "Windows print host failed") : null, updatedAt: new Date() }).where(and(eq(directPrintJobs.id, req.params.id), eq(directPrintJobs.organizationId, agent.organizationId), eq(directPrintJobs.agentId, agent.id), eq(directPrintJobs.status, "claimed"))).returning(); if (!job) return res.status(409).json({ error: "Print job is not claimed by this agent" }); await recordBridgeActivity(agent.id); res.json({ success: true, data: job }); });
  app.get("/api/local-bridge/jobs", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const jobs = await db.select({ id: localFileCopyJobs.id, outputFilename: localFileCopyJobs.outputFilename, destinationPath: localFileDestinations.localPath }).from(localFileCopyJobs).innerJoin(localFileDestinations, eq(localFileCopyJobs.destinationId, localFileDestinations.id)).where(and(eq(localFileCopyJobs.organizationId, agent.organizationId), eq(localFileCopyJobs.status, "pending"), eq(localFileDestinations.destinationType, "customer_art_folder"))).limit(20); res.json({ success: true, data: jobs }); });
  app.post("/api/local-bridge/jobs/:id/claim", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const [job] = await db.update(localFileCopyJobs).set({ status: "claimed", claimedByAgentId: agent.id, claimedAt: new Date(), attempts: sql`${localFileCopyJobs.attempts} + 1`, updatedAt: new Date() }).where(and(eq(localFileCopyJobs.id, req.params.id), eq(localFileCopyJobs.organizationId, agent.organizationId), eq(localFileCopyJobs.status, "pending"))).returning(); if (!job) return res.status(409).json({ error: "Job is no longer available" }); res.json({ success: true, data: { ...job, downloadUrl: `/api/local-bridge/jobs/${job.id}/download`, destinationPath: (await db.select({ localPath: localFileDestinations.localPath }).from(localFileDestinations).where(eq(localFileDestinations.id, job.destinationId)).limit(1))[0]?.localPath } }); });
  app.get("/api/local-bridge/jobs/:id/download", bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const [row] = await db.select({ key: lineItemFiles.storageKey, path: lineItemFiles.storagePath, outputFilename: localFileCopyJobs.outputFilename }).from(localFileCopyJobs).innerJoin(lineItemFiles, eq(localFileCopyJobs.sourceFileId, lineItemFiles.id)).where(and(eq(localFileCopyJobs.id, req.params.id), eq(localFileCopyJobs.organizationId, agent.organizationId), eq(localFileCopyJobs.claimedByAgentId, agent.id), eq(localFileCopyJobs.status, "claimed"))).limit(1); if (!row) return res.status(403).json({ error: "Job download is not authorized" }); const storage = new ObjectStorageService(); res.attachment(row.outputFilename); return storage.downloadObject(await storage.getObjectEntityFile(row.key || row.path), res, 0); });
  for (const outcome of ["succeeded", "failed"] as const) app.post(`/api/local-bridge/jobs/:id/${outcome}`, bridgeAuth, async (req: any, res) => { const agent = req.bridgeAgent; const [job] = await db.update(localFileCopyJobs).set({ status: outcome, completedAt: outcome === "succeeded" ? new Date() : null, lastError: outcome === "failed" ? String(req.body?.error || "Bridge copy failed") : null, updatedAt: new Date() }).where(and(eq(localFileCopyJobs.id, req.params.id), eq(localFileCopyJobs.organizationId, agent.organizationId), eq(localFileCopyJobs.claimedByAgentId, agent.id), eq(localFileCopyJobs.status, "claimed"))).returning(); if (!job) return res.status(409).json({ error: "Job is not claimed by this bridge" }); const [runFile] = await db.select({ productionRunId: lineItemFiles.productionRunId, runNumber: productionRuns.runNumber, fileName: lineItemFiles.originalFilename }).from(lineItemFiles).leftJoin(productionRuns, eq(productionRuns.id, lineItemFiles.productionRunId)).where(and(eq(lineItemFiles.id, job.sourceFileId), eq(lineItemFiles.organizationId, agent.organizationId))).limit(1); if (runFile?.productionRunId) await db.insert(auditLogs).values({ organizationId: agent.organizationId, userId: null, actionType: "UPDATE", entityType: "production_run", entityId: runFile.productionRunId, entityName: runFile.runNumber ? `PR-${String(runFile.runNumber).padStart(4, "0")}` : null, description: outcome === "succeeded" ? "Local Bridge copy completed for shared run file" : "Local Bridge copy failed for shared run file", newValues: { fileId: job.sourceFileId, filename: runFile.fileName, copyJobId: job.id, status: outcome, error: outcome === "failed" ? job.lastError : null } } as any); res.json({ success: true, data: job }); });
}
